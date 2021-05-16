package www

import (
	"io/ioutil"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/user"
)

/*
	www package

	This package is the replacement handler for global homepage function in ArozOS.
	This allow users to host and create their website using any folder within the user
	access file system.

*/

type Options struct {
	UserHandler *user.UserHandler
	Database    *database.Database
}

type Handler struct {
	Options Options
}

/*
	New WebRoot Handler create a new handler for handling and routing webroots
*/
func NewWebRootHandler(options Options) *Handler {
	//Create the homepage database table
	options.Database.NewTable("www")

	//Return the handler object
	return &Handler{
		Options: options,
	}
}

func (h *Handler) RouteRequest(w http.ResponseWriter, r *http.Request) {
	//Check if it is reaching www root folder or any files directly under www.
	if filepath.ToSlash(filepath.Clean(r.RequestURI)) == "/www" {
		//Direct access of the root folder. Serve the homepage description.
		http.ServeFile(w, r, "web/SystemAO/www/index.html")
		return
	} else if filepath.ToSlash(filepath.Dir(r.RequestURI)) == "/www" {
		//Reaching file under www root and not root. Redirect to www root
		http.Redirect(w, r, "/www/", 307)
		return
	}

	//Escape the URL
	decodedValue, err := url.QueryUnescape(r.RequestURI)
	if err != nil {
		//failed to decode. Just use its raw value
		decodedValue = r.RequestURI
	}

	//Check the user name of the user root
	parsedRequestURL := strings.Split(filepath.ToSlash(filepath.Clean(decodedValue)[1:]), "/")
	//Malparsed URL. Ignore request
	if len(parsedRequestURL) < 2 {

		http.NotFound(w, r)
		return
	}

	//Extract user information
	username := parsedRequestURL[1]

	userinfo, err := h.Options.UserHandler.GetUserInfoFromUsername(username)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	//Check if this user enabled homepage
	enabled := h.CheckUserHomePageEnabled(userinfo.Username)
	if !enabled {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("404 - Page not found"))
		return
	}

	//Check if the user have his webroot correctly configured
	webroot, err := h.GetUserWebRoot(userinfo.Username)
	if err != nil {
		//User do not have a correctly configured webroot. Serve instruction
		w.WriteHeader(http.StatusInternalServerError)
		if fileExists("./system/www/nowebroot.html") {
			content, err := ioutil.ReadFile("./system/www/nowebroot.html")
			if err != nil {
				w.Write([]byte("500 - Internal Server Error"))
			} else {
				w.Write(content)
			}

		} else {
			w.Write([]byte("500 - Internal Server Error"))
		}
		return
	}

	//User webroot real path conversion
	webrootRealpath, err := userinfo.VirtualPathToRealPath(webroot)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error"))
		return
	}

	//Perform path rewrite
	rewrittenPath := strings.Join(parsedRequestURL[2:], "/")

	//Actual accessing file path
	targetFilePath := filepath.ToSlash(filepath.Join(webrootRealpath, rewrittenPath))

	//Check if the file exists
	if !fileExists(targetFilePath) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("404 - Page not found"))
		return
	}

	//Fix mimetype of js files on Windows 10 bug
	if filepath.Ext(targetFilePath) == ".js" {
		w.Header().Set("Content-Type", "application/javascript")
	}

	//Record the client IP for analysis, to be added in the future if needed

	//Serve the file
	http.ServeFile(w, r, targetFilePath)

}
