package main

import (
	"encoding/json"
	"log"
	"net/http"

	permission "imuslab.com/arozos/mod/permission"
	prout "imuslab.com/arozos/mod/prouter"
)

func permissionNewHandler() {
	ph, err := permission.NewPermissionHandler(sysdb)
	if err != nil {
		log.Println("Permission Handler creation failed.")
		panic(err)
	}
	permissionHandler = ph
	permissionHandler.LoadPermissionGroupsFromDatabase()

}

func permissionInit() {
	//Register the permission handler, require authentication except listgroup
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Must be handled by default router
	http.HandleFunc("/system/permission/listgroup", func(w http.ResponseWriter, r *http.Request) {
		if authAgent.GetUserCounts() == 0 {
			//There is no user within the system. Only allow register of admin account
			js, _ := json.Marshal([]string{"administrator"})
			sendJSONResponse(w, string(js))
			//permissionHandler.HandleListGroup(w, r)
		} else {
			//There are already users in the system. Only allow authorized users
			if authAgent.CheckAuth(r) {
				permissionHandler.HandleListGroup(w, r)
			} else {
				errorHandleNotLoggedIn(w, r)
				return
			}
		}

	})
	adminRouter.HandleFunc("/system/permission/newgroup", permissionHandler.HandleGroupCreate)
	adminRouter.HandleFunc("/system/permission/editgroup", permissionHandler.HandleGroupEdit)
	adminRouter.HandleFunc("/system/permission/delgroup", permissionHandler.HandleGroupRemove)

	registerSetting(settingModule{
		Name:         "Permission Groups",
		Desc:         "Handle the permission of access in groups",
		IconPath:     "SystemAO/users/img/small_icon.png",
		Group:        "Users",
		StartDir:     "SystemAO/users/group.html",
		RequireAdmin: true,
	})
}
