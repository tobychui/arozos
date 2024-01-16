package main

/*
	ArOZ Online System Main Request Router

	This is used to check authentication before actually serving file to the target client
	This function also handle the special page (login.system and user.system) delivery
*/

import (
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/network/gzipmiddleware"
	"imuslab.com/arozos/mod/utils"
)

func mrouter(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		/*
			You can also check the path for url using r.URL.Path
		*/

		if r.URL.Path == "/favicon.ico" || r.URL.Path == "/manifest.webmanifest" || r.URL.Path == "/robots.txt" || r.URL.Path == "/humans.txt" {
			//Serving web specification files. Allow no auth access.
			h.ServeHTTP(w, r)
		} else if r.URL.Path == "/login.system" {
			//Login page. Require special treatment for template.
			//Get the redirection address from the request URL
			red, _ := utils.GetPara(r, "redirect")

			//Append the redirection addr into the template
			imgsrc := filepath.Join(vendorResRoot, "auth_icon.png")
			if !fs.FileExists(imgsrc) {
				imgsrc = "./web/img/public/auth_icon.png"
			}
			imageBase64, _ := utils.LoadImageAsBase64(imgsrc)
			parsedPage, err := utils.Templateload("web/login.system", map[string]string{
				"redirection_addr": red,
				"usercount":        strconv.Itoa(authAgent.GetUserCounts()),
				"service_logo":     imageBase64,
				"login_addr":       "system/auth/login",
			})
			if err != nil {
				panic("Error. Unable to parse login page. Is web directory data exists?")
			}
			w.Header().Add("Content-Type", "text/html; charset=UTF-8")
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

		} else if len(r.URL.Path) >= len("/webdav") && r.URL.Path[:7] == "/webdav" {
			//WebDAV sub-router
			if WebDAVManager == nil {
				errorHandleInternalServerError(w, r)
				return
			}
			WebDAVManager.HandleRequest(w, r)
		} else if len(r.URL.Path) >= len("/share") && r.URL.Path[:6] == "/share" {
			//Share Manager sub-router
			if shareManager == nil {
				errorHandleInternalServerError(w, r)
				return
			}
			shareManager.HandleShareAccess(w, r)
		} else if len(r.URL.Path) >= len("/api/remote") && r.URL.Path[:11] == "/api/remote" {
			//Serverless sub-router
			if AGIGateway == nil {
				errorHandleInternalServerError(w, r)
				return
			}
			AGIGateway.ExtAPIHandler(w, r)
		} else if len(r.URL.Path) >= len("/fileview") && r.URL.Path[:9] == "/fileview" {
			//File server sub-router
			if DirListManager == nil {
				errorHandleInternalServerError(w, r)
				return
			}
			DirListManager.ServerWebFileRequest(w, r)
		} else if r.URL.Path == "/" && authAgent.CheckAuth(r) {
			//Use logged in and request the index. Serve the user's interface module
			w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
			userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				//ERROR!! Server default
				h.ServeHTTP(w, r)
			} else {
				interfaceModule := userinfo.GetInterfaceModules()
				if len(interfaceModule) == 1 && interfaceModule[0] == "Desktop" {
					http.Redirect(w, r, "./desktop.system", http.StatusTemporaryRedirect)
				} else if len(interfaceModule) == 1 {
					//User with default interface module not desktop
					modileInfo := moduleHandler.GetModuleInfoByID(interfaceModule[0])
					if modileInfo == nil {
						//The module is not found or not enabled
						http.Redirect(w, r, "./SystemAO/boot/interface_disabled.html", http.StatusTemporaryRedirect)
						return
					}
					http.Redirect(w, r, modileInfo.StartDir, http.StatusTemporaryRedirect)
				} else if len(interfaceModule) > 1 {
					//Redirect to module selector
					http.Redirect(w, r, "./SystemAO/boot/interface_selector.html", http.StatusTemporaryRedirect)
				} else if len(interfaceModule) == 0 {
					//Redirect to error page
					http.Redirect(w, r, "./SystemAO/boot/no_interfaceing.html", http.StatusTemporaryRedirect)
				} else {
					//For unknown operations, send it to desktop
					http.Redirect(w, r, "./desktop.system", http.StatusTemporaryRedirect)
				}
			}
		} else if ((len(r.URL.Path) >= 5 && r.URL.Path[:5] == "/www/") || r.URL.Path == "/www") && *allow_homepage {
			//Serve the custom homepage of the user defined. Hand over to the www router
			userWwwHandler.RouteRequest(w, r)
		} else if authAgent.CheckAuth(r) {
			//User logged in. Continue to serve the file the client want
			authAgent.UpdateSessionExpireTime(w, r)
			if build_version == "development" {
				//Do something if development build
				//w.Header().Add("Cross-Origin-Opener-Policy", "same-origin")
				//w.Header().Add("Cross-Origin-Embedder-Policy", "require-corp")
			}
			if filepath.Ext("web"+fs.DecodeURI(r.RequestURI)) == ".js" {
				//Fixed serve js meme type invalid bug on Firefox
				w.Header().Add("Content-Type", "application/javascript; charset=UTF-8")
			}

			if !*disable_subservices {
				//Enable subservice access
				//Check if this path is reverse proxy path. If yes, serve with proxyserver
				isRP, proxy, rewriteURL, subserviceObject := ssRouter.CheckIfReverseProxyPath(r)
				if isRP {
					//Check user permission on that module
					ssRouter.HandleRoutingRequest(w, r, proxy, subserviceObject, rewriteURL)
					return
				}
			}

			//Not subservice routine. Handle file server
			if !*enable_dir_listing {
				if strings.HasSuffix(r.URL.Path, "/") {
					//User trying to access a directory. Send NOT FOUND.
					if fs.FileExists("web" + r.URL.Path + "index.html") {
						//Index exists. Allow passthrough

					} else {
						errorHandleNotFound(w, r)
						return
					}
				}
			}
			if !fs.FileExists("web" + r.URL.Path) {
				//File not found
				errorHandleNotFound(w, r)
				return
			}
			routerStaticContentServer(h, w, r)
		} else {
			//User not logged in. Check if the path end with public/. If yes, allow public access
			if !fs.FileExists(filepath.Join("./web", r.URL.Path)) {
				//Requested file not exists on the server. Return not found
				errorHandleNotFound(w, r)
			} else if r.URL.Path[len(r.URL.Path)-1:] != "/" && filepath.Base(filepath.Dir(r.URL.Path)) == "public" {
				//This file path end with public/. Allow public access
				routerStaticContentServer(h, w, r)
			} else if *allow_homepage && len(r.URL.Path) >= 5 && r.URL.Path[:5] == "/www/" {
				//Handle public home serving if homepage mode is enabled
				routerStaticContentServer(h, w, r)
			} else {
				//Other paths
				//Rediect to login page
				w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
				http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect="+r.URL.String(), 307)
			}

		}

	})
}

func routerStaticContentServer(h http.Handler, w http.ResponseWriter, r *http.Request) {
	if *enable_gzip {
		gzipmiddleware.Compress(h).ServeHTTP(w, r)
	} else {
		h.ServeHTTP(w, r)
	}
}
