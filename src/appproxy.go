package main

/*
	appproxy.go

	Top-level wiring for container apps: web servers (usually Docker
	containers) that an administrator publishes through the built-in reverse
	proxy, so they are reachable on the same port as ArozOS (and therefore
	through Cloudflare / a single forwarded port) and can be pinned to the
	desktop by every user.

	- mrouter calls appProxyManager.HandleRequest first (see main.router.go)
	- admins publish / edit apps in the Container Apps web app, or from the
	  "Publish" action of Docker Manager
	- users get a simplified list of the apps they may open and pin them as
	  "app" desktop shortcuts, which always resolve through /app/<slug>/
*/

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"imuslab.com/arozos/mod/appproxy"
	"imuslab.com/arozos/mod/docker"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

var appProxyManager *appproxy.Manager

// appProxyIdentity converts an ArozOS user into the proxy's identity
func appProxyIdentity(username string, groups []string, isAdmin bool) *appproxy.Identity {
	return &appproxy.Identity{Username: username, Groups: groups, IsAdmin: isAdmin}
}

func AppProxyInit() {
	manager, err := appproxy.NewManager(appproxy.Options{
		Store:    sysdb,
		SelfPort: *listen_port,
		ResolveUser: func(w http.ResponseWriter, r *http.Request) *appproxy.Identity {
			if !authAgent.CheckAuth(r) {
				return nil
			}
			userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				return nil
			}
			//Using an app counts as activity on the desktop session
			authAgent.UpdateSessionExpireTime(w, r)
			return appProxyIdentity(userinfo.Username, userinfo.GetUserPermissionGroupNames(), userinfo.IsAdmin())
		},
		LookupUser: func(username string) *appproxy.Identity {
			if !authAgent.UserExists(username) {
				return nil
			}
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			if err != nil {
				return nil
			}
			return appProxyIdentity(userinfo.Username, userinfo.GetUserPermissionGroupNames(), userinfo.IsAdmin())
		},
		LoginURL: func(returnTo string) string {
			return "/login.html?redirect=" + url.QueryEscape(returnTo)
		},
		StripCookies: []string{"ao_auth", "ao_acc"},
		Log: func(message string, err error) {
			systemWideLogger.PrintAndLog("AppProxy", message, err)
		},
	})
	if err != nil {
		systemWideLogger.PrintAndLog("AppProxy", "Unable to start the container app proxy", err)
		return
	}
	appProxyManager = manager

	//Any logged in user: the simplified app list and shortcut launch info
	userRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "",
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})
	userRouter.HandleFunc("/system/appproxy/apps", manager.HandleUserApps)
	userRouter.HandleFunc("/system/appproxy/launch", manager.HandleLaunch)

	//Administrators: publish, edit, remove and analyse apps
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})
	adminRouter.HandleFunc("/system/appproxy/admin/list", manager.HandleAdminList)
	adminRouter.HandleFunc("/system/appproxy/admin/save", manager.HandleAdminSave)
	adminRouter.HandleFunc("/system/appproxy/admin/delete", manager.HandleAdminDelete)
	adminRouter.HandleFunc("/system/appproxy/admin/probe", manager.HandleAdminProbe)
	adminRouter.HandleFunc("/system/appproxy/admin/containers", handleAppProxyContainers)

	//Every user opens and pins apps here; administrators also publish from it,
	//including web servers that are not Docker containers
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Container Apps",
		Desc:        "Open web apps running in containers and pin them to the desktop",
		Group:       "Utilities",
		IconPath:    "ContainerApps/img/icon.svg",
		Version:     "1.0",
		StartDir:    "ContainerApps/index.html",
		SupportFW:   true,
		LaunchFWDir: "ContainerApps/index.html",
		InitFWSize:  []int{900, 600},
	})

	systemWideLogger.PrintAndLog("AppProxy", "Container app proxy ready with "+strconv.Itoa(manager.Count())+" published app(s)", nil)
}

// appProxyContainer is a Docker container offered for publishing
type appProxyContainer struct {
	ID        string
	Name      string
	Image     string
	State     string
	Ports     []docker.PublishedPort
	Targets   []string
	Published []string //Slugs of apps already pointing at this container
}

// handleAppProxyContainers lists Docker containers with their published web ports
func handleAppProxyContainers(w http.ResponseWriter, r *http.Request) {
	if dockerManager == nil {
		utils.SendJSONResponse(w, "[]")
		return
	}
	containers, err := dockerManager.ListContainers()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	published := map[string][]string{}
	for _, ep := range appProxyManager.List() {
		if ep.Container != "" {
			published[ep.Container] = append(published[ep.Container], ep.Slug)
		}
	}
	results := []appProxyContainer{}
	for _, c := range containers {
		ports := docker.ParsePublishedPorts(c.Ports)
		targets := []string{}
		for _, p := range ports {
			targets = append(targets, p.Target())
		}
		results = append(results, appProxyContainer{
			ID:        c.ID,
			Name:      c.Names,
			Image:     c.Image,
			State:     c.State,
			Ports:     ports,
			Targets:   targets,
			Published: published[c.Names],
		})
	}
	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}
