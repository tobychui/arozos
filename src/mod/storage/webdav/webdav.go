package webdav

/*
	WebDAV File Server
	author: tobychui

	This module handles file sharing via WebDAV protocol.
	In theory, this should be compatible with Windows 10 and possibily
	replacing the need for samba
*/
import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/network/webdav"
	"imuslab.com/arozos/mod/user"
)

type Server struct {
	hostname    string            //The hostname of this devices
	userHandler *user.UserHandler //The central userHandler
	filesystems sync.Map          //The syncmap for storing opened file server
	prefix      string            //The prefix to strip away from filepath
	tlsMode     bool              //Bypass tls windows mode if enabled
	Enabled     bool              //If the server is enabled. Set this to false for disable this service

	//Windows related authentication using Web interface
	readOnlyFileSystemHandler *webdav.Handler
	windowsClientNotLoggedIn  sync.Map //Map to store not logged in windows WebDAV Client
	windowsClientLoggedIn     sync.Map //Map to store logged in Windows WebDAV Client
}

type WindowClientInfo struct {
	Agent                   string
	LastConnectionTimestamp int64
	UUID                    string
	Username                string
	ClientIP                string
}

//NewServer create a new WebDAV server object required by arozos
func NewServer(hostname string, prefix string, tmpdir string, tlsMode bool, userHandler *user.UserHandler) *Server {
	//Generate a default handler
	os.MkdirAll(filepath.Join(tmpdir, "webdav"), 0777)

	rofs := &webdav.Handler{
		Prefix:     prefix,
		FileSystem: webdav.Dir(filepath.Join(tmpdir, "webdav")),
		LockSystem: webdav.NewMemLS(),
	}

	return &Server{
		hostname:                  hostname,
		userHandler:               userHandler,
		filesystems:               sync.Map{},
		prefix:                    prefix,
		tlsMode:                   tlsMode,
		Enabled:                   true,
		readOnlyFileSystemHandler: rofs,
	}
}

func (s *Server) HandleClearAllPending(w http.ResponseWriter, r *http.Request) {
	//Clear all pending client requests
	keys := []string{}
	s.windowsClientNotLoggedIn.Range(func(key, value interface{}) bool {
		keys = append(keys, key.(string))
		return true
	})

	//Clear all pending requests
	for _, key := range keys {
		s.windowsClientNotLoggedIn.Delete(key)
	}

	sendOK(w)
}

//Handle allow and remove permission of a windows WebDAV Client
func (s *Server) HandlePermissionEdit(w http.ResponseWriter, r *http.Request) {
	opr, err := mv(r, "opr", true)
	if err != nil {
		sendErrorResponse(w, "Invalid operations")
		return
	}

	uuid, err := mv(r, "uuid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid uuid")
		return
	}

	userinfo, err := s.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	if opr == "set" {
		//Set the given uuid into the user permission folder
		value, ok := s.windowsClientNotLoggedIn.Load(uuid)
		if !ok {
			sendErrorResponse(w, "Client registry not exists!")
			return
		}

		//Add the value into the logged in list with this username
		ConnectionObject := value.(*WindowClientInfo)
		ConnectionObject.Username = userinfo.Username
		s.windowsClientLoggedIn.Store(uuid, ConnectionObject)

		//Remove the value from the not logged in list
		s.windowsClientNotLoggedIn.Delete(uuid)

		sendOK(w)
	} else if opr == "remove" {
		value, ok := s.windowsClientLoggedIn.Load(uuid)
		if !ok {
			sendErrorResponse(w, "Client registry not exists!")
			return
		}

		//Move the object back to the not logged in one and remove username
		ConnectionObject := value.(*WindowClientInfo)
		ConnectionObject.Username = ""
		s.windowsClientNotLoggedIn.Store(uuid, ConnectionObject)

		//Remove the object from logged in list
		s.windowsClientLoggedIn.Delete(uuid)

		sendOK(w)
	} else {
		sendErrorResponse(w, "Unsupported operation")
		return
	}

}

func (s *Server) HandleConnectionList(w http.ResponseWriter, r *http.Request) {
	target, _ := mv(r, "target", false)
	results := []*WindowClientInfo{}
	if target == "" {
		//List not logged in clients
		s.windowsClientNotLoggedIn.Range(func(key, value interface{}) bool {
			targetWindowClientInfo := value.(*WindowClientInfo)
			results = append(results, targetWindowClientInfo)
			return true
		})
	} else if target == "loggedin" {
		userinfo, err := s.userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			sendErrorResponse(w, "User not logged in")
			return
		}

		userIsAdmin := userinfo.IsAdmin()

		//List logged in clients
		s.windowsClientLoggedIn.Range(func(key, value interface{}) bool {
			targetWindowClientInfo := value.(*WindowClientInfo)
			if userIsAdmin {
				//Allow access to all user's permission
				results = append(results, targetWindowClientInfo)
			} else {
				//Check if username match before append
				if targetWindowClientInfo.Username == userinfo.Username {
					results = append(results, targetWindowClientInfo)
				}
			}

			return true
		})
	}

	//Sort the results
	sort.Slice(results, func(i, j int) bool {
		return results[i].LastConnectionTimestamp > results[j].LastConnectionTimestamp
	})

	js, _ := json.Marshal(results)
	sendJSONResponse(w, string(js))

}

func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) {
	//log.Println(r.Header)
	//log.Println("Request Method: ", r.Method)

	//Check if this is enabled
	if !s.Enabled {
		http.NotFound(w, r)
		return
	}

	if r.URL.Path == "/webdav" {
		//No vRoot defined. Reject connection
		http.NotFound(w, r)
		return
	}

	reqInfo := strings.Split(r.URL.RequestURI()[1:], "/")
	reqRoot := "user"
	if len(reqInfo) > 1 {
		reqRoot = reqInfo[1]
	}

	//Windows File Explorer. Handle with special case
	if r.Header["User-Agent"] != nil && strings.Contains(r.Header["User-Agent"][0], "Microsoft-WebDAV-MiniRedir") && r.TLS == nil {
		log.Println("Windows File Explorer Connection. Routing using alternative handler")
		s.HandleWindowClientAccess(w, r, reqRoot)
		return
	}

	username, password, ok := r.BasicAuth()
	if !ok {
		//User not logged in.
		//log.Println("Not logged in!")
		w.Header().Set("WWW-Authenticate", `Basic realm="Login with your `+s.hostname+` account"`)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	//validate username and password
	authAgent := s.userHandler.GetAuthAgent()

	//Validate request origin
	allowAccess, err := authAgent.ValidateLoginRequest(w, r)
	if !allowAccess {
		log.Println("Someone from " + r.RemoteAddr + " try to log into " + username + " WebDAV endpoint but got rejected: " + err.Error())
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	passwordValid, rejectionReason := authAgent.ValidateUsernameAndPasswordWithReason(username, password)
	if !passwordValid {
		authAgent.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "webdav")
		log.Println("Someone from " + r.RemoteAddr + " try to log into " + username + " WebDAV endpoint but got rejected: " + rejectionReason)
		http.Error(w, rejectionReason, http.StatusUnauthorized)
		return
	}

	//Resolve the vroot to realpath
	userinfo, err := s.userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		log.Println(err.Error())
		http.Error(w, "Invalid username or password", http.StatusUnauthorized)
		return
	}

	//Try to resolve the realpath of the vroot
	realRoot, err := userinfo.VirtualPathToRealPath(reqRoot + ":/")
	if err != nil {
		log.Println(err.Error())
		http.Error(w, "Invalid ", http.StatusUnauthorized)
		return
	}

	//Ok. Check if the file server of this root already exists
	fs := s.getFsFromRealRoot(realRoot, filepath.ToSlash(filepath.Join(s.prefix, reqRoot)))

	//Serve the content
	fs.ServeHTTP(w, r)

}

/*
	Serve ReadOnly WebDAV Server

	This section exists because Windows WebDAV Services require a
	success connection in order to store the cookie. If nothing is served,
	File Explorer will not cache the cookie in its cache
*/
func (s *Server) serveReadOnlyWebDav(w http.ResponseWriter, r *http.Request) {
	if r.Method == "PUT" || r.Method == "POST" || r.Method == "MKCOL" ||
		r.Method == "DELETE" || r.Method == "COPY" || r.Method == "MOVE" {
		//Not allowed
		w.WriteHeader(http.StatusForbidden)
	} else {
		r.URL.Path = "/webdav/"
		s.readOnlyFileSystemHandler.ServeHTTP(w, r)
	}
}

func (s *Server) getFsFromRealRoot(realRoot string, prefix string) *webdav.Handler {
	tfs, ok := s.filesystems.Load(realRoot)
	if !ok {
		//This file system handle hasn't been created. Create it now
		fs := &webdav.Handler{
			Prefix:     prefix,
			FileSystem: webdav.Dir(realRoot),
			LockSystem: webdav.NewMemLS(),
		}

		//Store the file system handler
		s.filesystems.Store(realRoot, fs)

		return fs
	} else {
		return tfs.(*webdav.Handler)
	}
}
