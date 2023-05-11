package www

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/agi"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
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
	AgiGateway  *agi.Gateway
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
	if filepath.ToSlash(filepath.Clean(r.URL.Path)) == "/www" {
		//Direct access of the root folder. Serve the homepage description.
		http.ServeFile(w, r, "web/SystemAO/www/index.html")
		return
	} else if filepath.ToSlash(filepath.Dir(r.URL.Path)) == "/www" {
		//Missing the last / at the end of the path
		r.URL.Path = r.URL.Path + "/"
		http.Redirect(w, r, filepath.ToSlash(filepath.Dir(r.URL.Path))+"/", http.StatusTemporaryRedirect)
		return
	}

	//Escape the URL
	decodedValue, err := url.QueryUnescape(r.URL.Path)
	if err != nil {
		//failed to decode. Just use its raw value
		decodedValue = r.URL.Path
	}

	//Check the user name of the user root
	parsedRequestURL := strings.Split(filepath.ToSlash(filepath.Clean(decodedValue)[1:]), "/")
	//Malparsed URL. Ignore request
	if len(parsedRequestURL) < 2 {
		serveNotFoundTemplate(w, r)
		return
	}

	//Extract user information
	username := parsedRequestURL[1]

	userinfo, err := h.Options.UserHandler.GetUserInfoFromUsername(username)
	if err != nil {
		serveNotFoundTemplate(w, r)
		return
	}

	//Check if this user enabled homepage
	enabled := h.CheckUserHomePageEnabled(userinfo.Username)
	if !enabled {
		serveNotFoundTemplate(w, r)
		return
	}

	//Check if the user have his webroot correctly configured
	webroot, err := h.GetUserWebRoot(userinfo.Username)
	if err != nil {
		//User do not have a correctly configured webroot. Serve instruction
		handleWebrootError(w)
		return
	}

	//User webroot real path conversion
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(webroot)
	if err != nil {
		handleWebrootError(w)
		return
	}

	webrootRealpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(webroot, userinfo.Username)
	if err != nil {
		handleWebrootError(w)
		return
	}

	//Perform path rewrite
	rewrittenPath := strings.Join(parsedRequestURL[2:], "/")

	//Actual accessing file path
	targetFilePath := filepath.ToSlash(filepath.Join(webrootRealpath, rewrittenPath))

	//Check if the file exists
	if !fsh.FileSystemAbstraction.FileExists(targetFilePath) {
		serveNotFoundTemplate(w, r)
		return
	}

	//Fix mimetype of js files on Windows 10 bug
	if filepath.Ext(targetFilePath) == ".js" {
		w.Header().Set("Content-Type", "application/javascript")
	}

	if filepath.Ext(targetFilePath) == "" {
		//Reading a folder. Check if index.htm or index.html exists.
		if fsh.FileSystemAbstraction.FileExists(filepath.Join(targetFilePath, "index.html")) {
			targetFilePath = filepath.ToSlash(filepath.Join(targetFilePath, "index.html"))
		} else if fsh.FileSystemAbstraction.FileExists(filepath.Join(targetFilePath, "index.htm")) {
			targetFilePath = filepath.ToSlash(filepath.Join(targetFilePath, "index.htm"))
		} else {
			//Not allow listing folder
			http.ServeFile(w, r, "system/errors/forbidden.html")
			return
		}

	}

	//Record the client IP for analysis, to be added in the future if needed

	//Execute it if it is agi file
	if fsh.FileSystemAbstraction.FileExists(targetFilePath) && filepath.Ext(targetFilePath) == ".agi" {
		result, err := h.Options.AgiGateway.ExecuteAGIScriptAsUser(fsh, targetFilePath, userinfo, w, r)
		if err != nil {
			w.Write([]byte("500 - Internal Server Error \n" + err.Error()))
			return
		}

		w.Write([]byte(result))
		return
	}

	//Serve the file
	if fsh.FileSystemAbstraction.FileExists(targetFilePath) {
		http.ServeFile(w, r, targetFilePath)
	} else {
		f, err := fsh.FileSystemAbstraction.ReadStream(targetFilePath)
		if err != nil {
			w.Write([]byte(err.Error()))
			return
		}
		io.Copy(w, f)
		f.Close()
	}

}

func serveNotFoundTemplate(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "system/errors/notfound.html")
}

func handleWebrootError(w http.ResponseWriter) {
	w.WriteHeader(http.StatusInternalServerError)
	if utils.FileExists("./system/www/nowebroot.html") {
		content, err := os.ReadFile("./system/www/nowebroot.html")
		if err != nil {
			w.Write([]byte("500 - Internal Server Error"))
		} else {
			w.Write(content)
		}

	} else {
		w.Write([]byte("500 - Internal Server Error"))
	}
}
