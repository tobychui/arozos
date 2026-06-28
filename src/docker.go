package main

/*
	docker.go

	Top-level wiring for the optional Docker management feature. Mirrors the
	shape of disk.go's RAIDServiceInit: build the manager, and only when it
	constructs successfully (Docker is actually usable on this host) register the
	settings page, the admin-only HTTP endpoints and the desktop app. When Docker
	is absent / the daemon is unreachable, the whole feature stays invisible and
	the server boots normally.

	Gated additionally by the -enable_docker flag (default true) so an admin can
	hard-disable the feature even on a host that has Docker installed.
*/

import (
	"net/http"

	"imuslab.com/arozos/mod/docker"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

func DockerServiceInit() {
	//Respect the admin kill-switch first, before probing the host.
	if !*allow_docker_management {
		return
	}

	dm, err := docker.NewDockerManager(docker.Options{
		Logger:       systemWideLogger,
		StackBaseDir: "./system/docker/stacks",
	})
	if err != nil {
		//Docker not usable on this host. Log once and leave the feature off.
		systemWideLogger.PrintAndLog("Docker", "Docker management unavailable on this host: "+err.Error(), nil)
		return
	}
	dockerManager = dm

	//Register the "Containers" settings group tabs in display order:
	//Docker Daemon -> Docker Engine -> Docker List.
	registerSetting(settingModule{
		Name:         "Docker Daemon",
		Desc:         "Start, stop and configure the Docker daemon service",
		IconPath:     "SystemAO/docker/img/small_icon.svg",
		Group:        "Container",
		StartDir:     "SystemAO/docker/daemon.html",
		RequireAdmin: true,
	})
	registerSetting(settingModule{
		Name:         "Docker Engine",
		Desc:         "Docker version, daemon status, disk usage and cleanup",
		IconPath:     "SystemAO/docker/img/small_icon.svg",
		Group:        "Container",
		StartDir:     "SystemAO/docker/index.html",
		RequireAdmin: true,
	})
	registerSetting(settingModule{
		Name:         "Docker List",
		Desc:         "Running containers overview and quick access to Docker Manager",
		IconPath:     "SystemAO/docker/img/small_icon.svg",
		Group:        "Container",
		StartDir:     "SystemAO/docker/list.html",
		RequireAdmin: true,
	})

	//Admin-only router. Docker access is effectively root on the host, so every
	//endpoint is restricted to administrators.
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Engine status / info endpoints (more endpoints added in later phases).
	adminRouter.HandleFunc("/system/docker/engine/status", dm.HandleEngineStatus)

	//Container lifecycle endpoints.
	adminRouter.HandleFunc("/system/docker/containers/list", dm.HandleContainerList)
	adminRouter.HandleFunc("/system/docker/containers/inspect", dm.HandleContainerInspect)
	adminRouter.HandleFunc("/system/docker/containers/start", dm.HandleContainerStart)
	adminRouter.HandleFunc("/system/docker/containers/stop", dm.HandleContainerStop)
	adminRouter.HandleFunc("/system/docker/containers/restart", dm.HandleContainerRestart)
	adminRouter.HandleFunc("/system/docker/containers/remove", dm.HandleContainerRemove)
	adminRouter.HandleFunc("/system/docker/containers/logs", dm.HandleContainerLogs)

	//Image endpoints.
	adminRouter.HandleFunc("/system/docker/images/list", dm.HandleImageList)
	adminRouter.HandleFunc("/system/docker/images/remove", dm.HandleImageRemove)
	adminRouter.HandleFunc("/system/docker/images/pull", dm.HandleImagePull)

	//Registry endpoints.
	adminRouter.HandleFunc("/system/docker/registry/list", dm.HandleRegistryList)
	adminRouter.HandleFunc("/system/docker/registry/login", dm.HandleRegistryLogin)
	adminRouter.HandleFunc("/system/docker/registry/logout", dm.HandleRegistryLogout)
	adminRouter.HandleFunc("/system/docker/registry/search", dm.HandleRegistrySearch)

	//Direct run + container config endpoints.
	adminRouter.HandleFunc("/system/docker/containers/run", dm.HandleContainerRun)
	adminRouter.HandleFunc("/system/docker/containers/create", dm.HandleContainerCreate)
	adminRouter.HandleFunc("/system/docker/containers/update", dm.HandleContainerUpdate)
	adminRouter.HandleFunc("/system/docker/containers/rename", dm.HandleContainerRename)
	adminRouter.HandleFunc("/system/docker/containers/recreate", dm.HandleContainerRecreate)

	//Compose stack endpoints.
	adminRouter.HandleFunc("/system/docker/compose/list", dm.HandleComposeList)
	adminRouter.HandleFunc("/system/docker/compose/get", dm.HandleComposeGet)
	adminRouter.HandleFunc("/system/docker/compose/save", dm.HandleComposeSave)
	adminRouter.HandleFunc("/system/docker/compose/deploy", dm.HandleComposeDeploy)
	adminRouter.HandleFunc("/system/docker/compose/down", dm.HandleComposeDown)
	adminRouter.HandleFunc("/system/docker/compose/delete", dm.HandleComposeDelete)
	adminRouter.HandleFunc("/system/docker/compose/disable", dm.HandleComposeDisable)
	adminRouter.HandleFunc("/system/docker/compose/status", dm.HandleComposeStatus)
	adminRouter.HandleFunc("/system/docker/compose/logs", dm.HandleComposeLogs)

	//Interactive exec console (websocket; PTY-backed on Linux/macOS).
	adminRouter.HandleFunc("/system/docker/console/exec", dm.HandleExecConsole)

	//Engine maintenance: disk usage + prune, daemon.json view/edit.
	adminRouter.HandleFunc("/system/docker/engine/df", dm.HandleDiskUsage)
	adminRouter.HandleFunc("/system/docker/engine/prune", dm.HandlePrune)
	adminRouter.HandleFunc("/system/docker/daemon/get", dm.HandleDaemonGet)
	adminRouter.HandleFunc("/system/docker/daemon/save", dm.HandleDaemonSave)

	//Daemon service lifecycle control (systemd on Linux).
	adminRouter.HandleFunc("/system/docker/service/status", dm.HandleServiceStatus)
	adminRouter.HandleFunc("/system/docker/service/action", dm.HandleServiceAction)

	//Register the desktop app. Deliberately NOT group "Utilities"/"System Tools"
	//(those would make it visible to every user via UniversalModules); group
	//"Development" falls through to the normal IsAdmin permission check, so only
	//admins see it by default.
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Docker Manager",
		Desc:        "Manage Docker containers, images and Compose stacks",
		Group:       "Development",
		IconPath:    "DockerManager/img/icon.svg",
		Version:     "1.0",
		StartDir:    "DockerManager/index.html",
		SupportFW:   true,
		LaunchFWDir: "DockerManager/index.html",
		InitFWSize:  []int{1100, 680},
		SupportEmb:  false,
	})

	//Bring up any compose stack that is not marked .disabled (mirrors how
	//SubserviceInit auto-starts non-suspended subservices at boot).
	dm.AutoStartStacks()

	systemWideLogger.PrintAndLog("Docker", "Docker management enabled (engine "+dm.GetEngineStatus().ServerVersion+")", nil)
}
