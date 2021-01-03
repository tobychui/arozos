package prouter

/*
	ArOZ Online System Permission Router
	author: tobychui

	This request router implement the permission handling of aroz online
	user authentication systems, permission system and user system
	and is used as a wrapper to handle all http request within the system
	(aka. the replacement for http.HandleFunc)

*/
import (
	"errors"
	"log"
	"net/http"

	user "imuslab.com/arozos/mod/user"
)

type RouterOption struct {
	ModuleName    string                                   //The name of module that permission is based on
	AdminOnly     bool                                     //Require admin permission to use this API endpoint
	RequireLAN    bool                                     //Require LAN connection (aka no external access)
	UserHandler   *user.UserHandler                        //System user handler
	DeniedHandler func(http.ResponseWriter, *http.Request) //Things to do when request is rejected
}

type RouterDef struct {
	moduleUUID              string
	adminOnly               bool
	requireLAN              bool
	userHandler             *user.UserHandler
	endpoints               map[string]func(http.ResponseWriter, *http.Request)
	permissionDeniedHandler func(http.ResponseWriter, *http.Request)
}

func NewModuleRouter(option RouterOption) *RouterDef {
	return &RouterDef{
		moduleUUID:              option.ModuleName,
		adminOnly:               option.AdminOnly,
		userHandler:             option.UserHandler,
		requireLAN:              option.RequireLAN,
		endpoints:               map[string]func(http.ResponseWriter, *http.Request){},
		permissionDeniedHandler: option.DeniedHandler,
	}
}

func (router *RouterDef) HandleFunc(endpoint string, handler func(http.ResponseWriter, *http.Request)) error {
	//Check if the endpoint already registered
	if _, exist := router.endpoints[endpoint]; exist {
		log.Println("WARNING! Duplicated registering of web endpoint: " + endpoint)
		return errors.New("Endpoint register duplicated")
	}

	authAgent := router.userHandler.GetAuthAgent()

	//OK. Register handler
	http.HandleFunc(endpoint, func(w http.ResponseWriter, r *http.Request) {
		//Check authentication of the user
		authAgent.HandleCheckAuth(w, r, func(w http.ResponseWriter, r *http.Request) {
			//Check if the user has permission to access this module
			userinfo, err := router.userHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				router.permissionDeniedHandler(w, r)
				return
			}

			//Check if the connection fits the RequireLAN requirement
			if router.requireLAN == true && checkIfLAN(r) == false {
				router.permissionDeniedHandler(w, r)
				return
			}

			//Check if this is a universal accessable router
			if router.moduleUUID == "" {
				//That means this router can serve anyone as soon as its fit the admin setting
				if router.adminOnly && !userinfo.IsAdmin() {
					router.permissionDeniedHandler(w, r)
				} else {
					handler(w, r)
				}
				return
			}

			//Check user permission to this module
			if userinfo.GetModuleAccessPermission(router.moduleUUID) {
				if router.adminOnly == true {
					//This module require admin. Check user is admin
					if userinfo.IsAdmin() == true {
						handler(w, r)
					} else {
						router.permissionDeniedHandler(w, r)
						return
					}
				} else {
					//This module do not require admin. Allow serving
					handler(w, r)
				}
			} else {
				//User has no permission to access this module
				router.permissionDeniedHandler(w, r)
				return
			}
		})
	})

	router.endpoints[endpoint] = handler

	return nil
}
