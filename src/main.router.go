package main

/*
	ArOZ Online System Main Request Router

	This is used to check authentication before actually serving file to the target client
	This function also handle the special page (login.system and user.system) delivery
*/


import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"path/filepath"
	//"log"

	fs "imuslab.com/aroz_online/mod/filesystem"
)

func mroutner(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		/*
			You can also check the path for url using r.URL.Path
		*/

		if r.URL.Path == "/favicon.ico" || r.URL.Path == "/manifest.webmanifest" {
			//Serving favicon or manifest. Allow no auth access.
			h.ServeHTTP(w, r)
		} else if r.URL.Path == "/login.system" {
			//Login page. Require special treatment for template.
			//Get the redirection address from the request URL
			red, _ := mv(r, "redirect", false)

			//Append the redirection addr into the template
			imgsrc := "./web/" + iconSystem
			if !fileExists(imgsrc) {
				imgsrc = "./web/img/public/auth_icon.png"
			}
			imageBase64, _ := LoadImageAsBase64(imgsrc)
			parsedPage, err := template_load("web/login.system", map[string]interface{}{
				"redirection_addr": red,
				"usercount":        strconv.Itoa(authAgent.GetUserCounts()),
				"service_logo":     imageBase64,
			})
			if err != nil {
				panic("Error. Unable to parse login page. Is web directory data exists?")
			}
			w.Write([]byte(parsedPage))
		} else if r.URL.Path == "/reset.system" && authAgent.GetUserCounts() > 0 {
			//Password restart page. Allow access only when user number > 0
			system_resetpw_handlePasswordReset(w, r)
		} else if r.URL.Path == "/user.system" && authAgent.GetUserCounts() == 0 {
			//Serve user management page. This only allows serving of such page when the total usercount = 0 (aka System Initiation)
			h.ServeHTTP(w, r)

		} else if (len(r.URL.Path) > 11 && r.URL.Path[:11] == "/img/public") || (len(r.URL.Path) > 7 && r.URL.Path[:7] == "/script") {
			//Public image directory. Allow anyone to access resources inside this directory.
			if filepath.Ext("web"+fs.DecodeURI(r.RequestURI)) == ".js" {
				//Fixed serve js meme type invalid bug on Firefox
				w.Header().Add("Content-Type", "application/javascript; charset=UTF-8")
			}
			h.ServeHTTP(w, r)
		} else if r.URL.Path == "/" && authAgent.CheckAuth(r) {
			//Index. Serve the user's interface module
			w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
			userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
			if (err != nil){
				//ERROR!! Server default
				h.ServeHTTP(w, r)
			}else{
				interfaceModule := userinfo.GetInterfaceModules();
				if (len(interfaceModule) == 1 && interfaceModule[0] == "Desktop"){
					http.Redirect(w, r, "desktop.system", 307);
				}else if (len(interfaceModule) == 1){
					//User with default interface module not desktop
					modileInfo := system_module_getModuleInfoByID(interfaceModule[0]);
					http.Redirect(w, r, modileInfo.StartDir, 307);
				}else if (len(interfaceModule) > 1){
					//Redirect to module selector
					http.Redirect(w, r, "SystemAO/boot/interface_selector.html", 307);
				}else if (len(interfaceModule) == 0){
					//Redirect to error page
					http.Redirect(w, r, "SystemAO/boot/no_interfaceing.html", 307);
				}else{
					//For unknown operations, send it to desktop
					http.Redirect(w, r, "desktop.system", 307);
				}
			}
			
			
		} else if authAgent.CheckAuth(r) {
			//User logged in. Continue to serve the file the client want
			authAgent.UpdateSessionExpireTime(w, r)
			if build_version == "development" {
				//Disable caching when under development build
				//w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
			}
			if filepath.Ext("web"+ fs.DecodeURI(r.RequestURI)) == ".js" {
				//Fixed serve js meme type invalid bug on Firefox
				w.Header().Add("Content-Type", "application/javascript; charset=UTF-8")
			}

			//Check if this path is reverse proxy path. If yes, serve with proxyserver
			isRP, proxy, rewriteURL := system_subservice_checkIfReverseProxyPath(r)
			
			if isRP {
				//Perform reverse proxy serving
				r.URL, _ = url.Parse(rewriteURL)
				username, _ := authAgent.GetUserName(w, r)
				r.Header.Set("aouser", username)
				r.Header.Set("X-Forwarded-Host", r.Host)
				r.Host = r.URL.Host
				proxy.ServeHTTP(w, r)
			} else {
				if *enable_dir_listing == false{
					if strings.HasSuffix(r.URL.Path, "/") {
						//User trying to access a directory. Send NOT FOUND.
						http.NotFound(w, r)
						return
					}
				}
				h.ServeHTTP(w, r)
			}

		} else {
			//User not logged in. Check if the path end with public/. If yes, allow public access
			if r.URL.Path[len(r.URL.Path) -1 :] != "/" && filepath.Base(filepath.Dir(r.URL.Path)) == "public"{
				//This file path end with public/. Allow public access
				h.ServeHTTP(w, r)
			}else{
				//Other paths
				w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
				http.Redirect(w, r, "/login.system?redirect="+r.URL.Path, 307)
			}
			
		}

	})
}