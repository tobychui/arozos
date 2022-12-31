package dirserv

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/user"
)

/*
	dirserv.go

	This module help serve the virtual file system in apache like directory listing interface
	Suitable for legacy web browser
*/

type Option struct {
	Sysdb       *database.Database
	UserManager *user.UserHandler
	ServerPort  int
	ServerUUID  string
}

type Manager struct {
	enabled bool
	option  *Option
}

//Create a new web directory server
func NewDirectoryServer(option *Option) *Manager {
	//Create a table to store which user enabled dirlisting on their own root
	option.Sysdb.NewTable("dirserv")

	defaultEnable := false
	if option.Sysdb.KeyExists("dirserv", "enabled") {
		option.Sysdb.Read("dirserv", "enabled", &defaultEnable)
	}

	return &Manager{
		enabled: defaultEnable,
		option:  option,
	}
}

func (m *Manager) DirServerEnabled() bool {
	return m.enabled
}

func (m *Manager) Toggle(enabled bool) error {
	m.enabled = enabled
	m.option.Sysdb.Write("dirserv", "enabled", m.enabled)
	return nil
}

func (m *Manager) ListEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	results := []*fileservers.Endpoint{}
	results = append(results, &fileservers.Endpoint{
		ProtocolName: "//",
		Port:         m.option.ServerPort,
		Subpath:      "/fileview",
	})
	return results
}

/*
	Router request handler
*/

func (m *Manager) ServerWebFileRequest(w http.ResponseWriter, r *http.Request) {
	if !m.enabled {
		//Dirlisting is not enabled.
		http.NotFound(w, r)
		return
	}
	//Request basic auth
	username, password, ok := r.BasicAuth()
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="`+m.option.ServerUUID+`", charset="UTF-8"`)
		http.Error(w, "401 - Unauthorized", http.StatusUnauthorized)
		return
	}

	//Validate username and password
	allowAccess, reason := m.option.UserManager.GetAuthAgent().ValidateUsernameAndPasswordWithReason(username, password)
	if !allowAccess {
		w.Header().Set("WWW-Authenticate", `Basic realm="`+m.option.ServerUUID+`", charset="UTF-8"`)
		http.Error(w, "401 - Unauthorized: "+reason, http.StatusUnauthorized)
		return
	}

	//Get user info
	userinfo, err := m.option.UserManager.GetUserInfoFromUsername(username)
	if err != nil {
		http.Error(w, "500 - Internal Server Error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	requestPath := arozfs.ToSlash(filepath.Clean(r.RequestURI))
	requestPath = requestPath[1:]                     //Trim away the first "/"
	pathChunks := strings.Split(requestPath, "/")[1:] //Trim away the fileview prefix

	html := ""
	if len(pathChunks) == 0 {
		//Show root
		html += getPageHeader("/")
		fshs := userinfo.GetAllFileSystemHandler()
		for _, fsh := range fshs {
			html += getItemHTML(fsh.Name, arozfs.ToSlash(filepath.Join(r.RequestURI, fsh.UUID)), true, "-", "-")
		}
		html += getPageFooter()
		w.Write([]byte(html))

	} else {
		//Show path inside fsh
		fshId := pathChunks[0]
		subpath := strings.Join(pathChunks[1:], "/")
		targetFsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(fshId + ":/")
		if err != nil {
			http.Error(w, "404 - Not Found: "+err.Error(), http.StatusNotFound)
			return
		}

		sp, err := url.QueryUnescape(subpath)
		if err != nil {
			sp = subpath
		}
		subpath = sp
		html += getPageHeader(fshId + ":/" + subpath)
		fshAbs := targetFsh.FileSystemAbstraction
		rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
		if err != nil {
			http.Error(w, "500 - Virtual Path Conversion Failed: "+err.Error(), http.StatusNotFound)
			return
		}
		if fshAbs.IsDir(rpath) {
			//Append a back button
			html += getBackButton(r.RequestURI)

			//Load Directory
			entries, err := fshAbs.ReadDir(rpath)
			if err != nil {
				http.Error(w, "500 - Internal Server Error: "+err.Error(), http.StatusInternalServerError)
				return
			}

			for _, entry := range entries {
				finfo, err := entry.Info()
				if err != nil {
					continue
				}
				html += getItemHTML(entry.Name(), arozfs.ToSlash(filepath.Join(r.RequestURI, entry.Name())), entry.IsDir(), finfo.ModTime().Format("2006-01-02 15:04:05"), byteCountIEC(finfo.Size()))
			}

			html += getPageFooter()
			w.Write([]byte(html))

		} else {
			//Serve the file
			f, err := fshAbs.ReadStream(rpath)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "500 - Internal Server Error: "+err.Error(), http.StatusInternalServerError)
				return
			}
			defer f.Close()

			io.Copy(w, f)
		}
	}

}
