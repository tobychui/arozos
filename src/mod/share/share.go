package share

/*
	Arozos File Share Manager
	author: tobychui

	This module handle file share request and other stuffs
*/

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/valyala/fasttemplate"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/common"
	"imuslab.com/arozos/mod/database"
	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/user"
)

type Options struct {
	AuthAgent   *auth.AuthAgent
	Database    *database.Database
	UserHandler *user.UserHandler
	HostName    string
	TmpFolder   string
}

type ShareOption struct {
	UUID             string
	FileRealPath     string
	Owner            string
	Accessibles      []string //Use to store username or group names if permission is groups or users
	Permission       string   //Access permission, allow {anyone / signedin / samegroup / groups / users}
	AllowLivePreview bool
}

type Manager struct {
	fileToUrlMap *sync.Map
	urlToFileMap *sync.Map
	options      Options
}

//Create a new Share Manager
func NewShareManager(options Options) *Manager {
	//Create the share table if not exists
	db := options.Database
	db.NewTable("share")

	fileToUrlMap := sync.Map{}
	urlToFileMap := sync.Map{}

	//Load the old share links
	entries, _ := db.ListTable("share")
	for _, keypairs := range entries {
		shareObject := new(ShareOption)
		json.Unmarshal(keypairs[1], &shareObject)
		if shareObject != nil {
			//Append this to the maps
			fileToUrlMap.Store(shareObject.FileRealPath, shareObject)
			urlToFileMap.Store(shareObject.UUID, shareObject)
		}

	}

	//Return a new manager object
	return &Manager{
		options:      options,
		fileToUrlMap: &fileToUrlMap,
		urlToFileMap: &urlToFileMap,
	}
}

//Main function for handle share. Must be called with http.HandleFunc (No auth)
func (s *Manager) HandleShareAccess(w http.ResponseWriter, r *http.Request) {
	id, err := mv(r, "id", false)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	directDownload := false
	directServe := false
	download, _ := mv(r, "download", false)
	if download == "true" {
		directDownload = true
	}

	serve, _ := mv(r, "serve", false)
	if serve == "true" {
		directServe = true
	}

	relpath, _ := mv(r, "rel", false)

	//Check if id exists
	val, ok := s.urlToFileMap.Load(id)
	if ok {
		//Parse the option structure
		shareOption := val.(*ShareOption)

		//Check for permission
		if shareOption.Permission == "anyone" {
			//OK to proceed
		} else if shareOption.Permission == "signedin" {
			if s.options.AuthAgent.CheckAuth(r) == false {
				//Redirect to login page
				if directDownload || directServe {
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte("401 - Unauthorized"))
				} else {
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share?id="+id, 307)
				}
				return
			} else {
				//Ok to proccedd
			}
		} else if shareOption.Permission == "samegroup" {
			thisuserinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				if directDownload || directServe {
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte("401 - Unauthorized"))
				} else {
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share?id="+id, 307)
				}
				return
			}

			//Check if all the user groups are inside the share owner groups
			valid := true
			thisUsersGroupByName := []string{}
			for _, pg := range thisuserinfo.PermissionGroup {
				thisUsersGroupByName = append(thisUsersGroupByName, pg.Name)
			}

			for _, allowedpg := range shareOption.Accessibles {
				if inArray(thisUsersGroupByName, allowedpg) {
					//This required group is inside this user's group. OK
				} else {
					//This required group is not inside user's group. Reject
					valid = false
				}
			}

			if !valid {
				//Serve permission denied page
				if directDownload || directServe {
					w.WriteHeader(http.StatusForbidden)
					w.Write([]byte("401 - Forbidden"))
				} else {
					ServePermissionDeniedPage(w)
				}
				return
			}

		} else if shareOption.Permission == "users" {
			thisuserinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				//User not logged in. Redirect to login page
				if directDownload || directServe {
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte("401 - Unauthorized"))
				} else {
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share?id="+id, 307)
				}
				return
			}

			//Check if username in the allowed user list
			if !inArray(shareOption.Accessibles, thisuserinfo.Username) {
				//Serve permission denied page
				//Serve permission denied page
				if directDownload || directServe {
					w.WriteHeader(http.StatusForbidden)
					w.Write([]byte("401 - Forbidden"))
				} else {
					ServePermissionDeniedPage(w)
				}
				return
			}

		} else if shareOption.Permission == "groups" {
			thisuserinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				//User not logged in. Redirect to login page
				if directDownload || directServe {
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte("401 - Unauthorized"))
				} else {
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share?id="+id, 307)
				}
				return
			}

			allowAccess := false

			thisUsersGroupByName := []string{}
			for _, pg := range thisuserinfo.PermissionGroup {
				thisUsersGroupByName = append(thisUsersGroupByName, pg.Name)
			}

			for _, thisUserPg := range thisUsersGroupByName {
				if inArray(shareOption.Accessibles, thisUserPg) {
					allowAccess = true
				}
			}

			if !allowAccess {
				//Serve permission denied page
				if directDownload || directServe {
					w.WriteHeader(http.StatusForbidden)
					w.Write([]byte("401 - Forbidden"))
				} else {
					ServePermissionDeniedPage(w)
				}
				return
			}

		} else {
			//Unsupported mode. Show notfound
			http.NotFound(w, r)
			return
		}

		//Serve the download page
		if isDir(shareOption.FileRealPath) {
			type File struct {
				Filename string
				RelPath  string
				Filesize string
				IsDir    bool
			}
			if directDownload == true {
				if relpath != "" {
					//User specified a specific file within the directory. Escape the relpath
					targetFilepath := filepath.Join(shareOption.FileRealPath, relpath)

					//Check if file exists
					if !fileExists(targetFilepath) {
						http.NotFound(w, r)
						return
					}

					//Validate the absolute path to prevent path escape
					absroot, _ := filepath.Abs(shareOption.FileRealPath)
					abstarget, _ := filepath.Abs(targetFilepath)

					if len(abstarget) <= len(absroot) || abstarget[:len(absroot)] != absroot {
						//Directory escape detected
						w.WriteHeader(http.StatusBadRequest)
						w.Write([]byte("400 - Bad Request: Invalid relative path"))
						return
					}

					//Serve the target file
					w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(filepath.Base(targetFilepath)), "+", "%20"))
					w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
					http.ServeFile(w, r, targetFilepath)

					sendOK(w)
				} else {
					//Download this folder as zip
					//Build the filelist to download

					//Create a zip using ArOZ Zipper, tmp zip files are located under tmp/share-cache/*.zip
					tmpFolder := s.options.TmpFolder
					tmpFolder = filepath.Join(tmpFolder, "share-cache")
					os.MkdirAll(tmpFolder, 0755)
					targetZipFilename := filepath.Join(tmpFolder, filepath.Base(shareOption.FileRealPath)) + ".zip"

					//Build a filelist
					err := filesystem.ArozZipFile([]string{shareOption.FileRealPath}, targetZipFilename, false)
					if err != nil {
						//Failed to create zip file
						w.WriteHeader(http.StatusInternalServerError)
						w.Write([]byte("500 - Internal Server Error: Zip file creation failed"))
						log.Println("Failed to create zip file for share download: " + err.Error())
						return
					}

					//Serve thje zip file
					w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(filepath.Base(shareOption.FileRealPath)), "+", "%20")+".zip")
					w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
					http.ServeFile(w, r, targetZipFilename)
				}

			} else {
				//Show download page. Do not allow serving
				content, err := ioutil.ReadFile("./system/share/downloadPageFolder.html")
				if err != nil {
					http.NotFound(w, r)
					return
				}

				//Get file size
				fsize, fcount := filesystem.GetDirctorySize(shareOption.FileRealPath, false)

				//Build the tree list of the folder
				treeList := map[string][]File{}
				err = filepath.Walk(filepath.Clean(shareOption.FileRealPath), func(file string, info os.FileInfo, err error) error {
					if err != nil {
						//If error skip this
						return nil
					}
					if filepath.Base(file)[:1] != "." {
						fileSize := filesystem.GetFileSize(file)
						if filesystem.IsDir(file) {
							fileSize, _ = filesystem.GetDirctorySize(file, false)
						}

						relPath, err := filepath.Rel(shareOption.FileRealPath, file)
						if err != nil {
							relPath = ""
						}

						relPath = filepath.ToSlash(filepath.Clean(relPath))
						relDir := filepath.ToSlash(filepath.Dir(relPath))

						if relPath == "." {
							//The root file object. Skip this
							return nil
						}

						treeList[relDir] = append(treeList[relDir], File{
							Filename: filepath.Base(file),
							RelPath:  filepath.ToSlash(relPath),
							Filesize: filesystem.GetFileDisplaySize(fileSize, 2),
							IsDir:    filesystem.IsDir(file),
						})
					}
					return nil
				})

				tl, _ := json.Marshal(treeList)

				//Get modification time
				fmodtime, _ := filesystem.GetModTime(shareOption.FileRealPath)
				timeString := time.Unix(fmodtime, 0).Format("02-01-2006 15:04:05")

				t := fasttemplate.New(string(content), "{{", "}}")
				s := t.ExecuteString(map[string]interface{}{
					"hostname":     s.options.HostName,
					"reqid":        id,
					"mime":         "application/x-directory",
					"size":         filesystem.GetFileDisplaySize(fsize, 2),
					"filecount":    strconv.Itoa(fcount),
					"modtime":      timeString,
					"downloadurl":  "./share?id=" + id + "&download=true",
					"filename":     filepath.Base(shareOption.FileRealPath),
					"reqtime":      strconv.Itoa(int(time.Now().Unix())),
					"treelist":     tl,
					"downloaduuid": id,
				})

				w.Write([]byte(s))
				return

			}
		} else {
			if directDownload {
				//Serve the file directly
				w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(filepath.Base(shareOption.FileRealPath)), "+", "%20"))
				w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
				http.ServeFile(w, r, shareOption.FileRealPath)
			} else if directServe {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
				http.ServeFile(w, r, shareOption.FileRealPath)
			} else {
				//Serve the download page
				content, err := ioutil.ReadFile("./system/share/downloadPage.html")
				if err != nil {
					http.NotFound(w, r)
					return
				}

				//Get file mime type
				mime, ext, err := filesystem.GetMime(shareOption.FileRealPath)
				if err != nil {
					mime = "Unknown"
				}

				//Load the preview template
				templateRoot := "./system/share/"
				previewTemplate := filepath.Join(templateRoot, "defaultTemplate.html")
				if ext == ".mp4" || ext == ".webm" {
					previewTemplate = filepath.Join(templateRoot, "video.html")
				} else if ext == ".mp3" || ext == ".wav" || ext == ".flac" || ext == ".ogg" {
					previewTemplate = filepath.Join(templateRoot, "audio.html")
				} else if ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" {
					previewTemplate = filepath.Join(templateRoot, "image.html")
				} else if ext == ".pdf" {
					previewTemplate = filepath.Join(templateRoot, "iframe.html")
				} else {
					//Format do not support preview. Use the default.html
					previewTemplate = filepath.Join(templateRoot, "default.html")
				}

				tp, err := ioutil.ReadFile(previewTemplate)
				if err != nil {
					tp = []byte("")
				}

				//Merge two templates
				content = []byte(strings.ReplaceAll(string(content), "{{previewer}}", string(tp)))

				//Get file size
				fsize := filesystem.GetFileSize(shareOption.FileRealPath)

				//Get modification time
				fmodtime, _ := filesystem.GetModTime(shareOption.FileRealPath)
				timeString := time.Unix(fmodtime, 0).Format("02-01-2006 15:04:05")

				t := fasttemplate.New(string(content), "{{", "}}")
				s := t.ExecuteString(map[string]interface{}{
					"hostname":    s.options.HostName,
					"reqid":       id,
					"mime":        mime,
					"ext":         ext,
					"size":        filesystem.GetFileDisplaySize(fsize, 2),
					"modtime":     timeString,
					"downloadurl": "/share?id=" + id + "&download=true",
					"preview_url": "/share?id=" + id + "&serve=true",
					"filename":    filepath.Base(shareOption.FileRealPath),
					"reqtime":     strconv.Itoa(int(time.Now().Unix())),
				})

				w.Write([]byte(s))
				return
			}
		}

	} else {
		//This share not exists
		if err != nil {
			//Template not found. Just send a 404 Not Found
			http.NotFound(w, r)
			return
		}

		if directDownload == true {
			//Send 404 header
			http.NotFound(w, r)
			return
		} else {
			//Send not found page
			content, err := ioutil.ReadFile("./system/share/notfound.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			t := fasttemplate.New(string(content), "{{", "}}")
			s := t.ExecuteString(map[string]interface{}{
				"hostname": s.options.HostName,
				"reqid":    id,
				"reqtime":  strconv.Itoa(int(time.Now().Unix())),
			})

			w.Write([]byte(s))
			return
		}

	}

}

//Check if a file is shared
func (s *Manager) HandleShareCheck(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := mv(r, "path", true)
	if err != nil {
		sendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get realpath from userinfo
	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		sendErrorResponse(w, "Unable to resolve realpath")
		return
	}

	type Result struct {
		IsShared  bool
		ShareUUID *ShareOption
	}

	//Check if share exists
	shareExists := s.FileIsShared(rpath)
	if !shareExists {
		//Share not exists
		js, _ := json.Marshal(Result{
			IsShared:  false,
			ShareUUID: &ShareOption{},
		})
		sendJSONResponse(w, string(js))

	} else {
		//Share exists
		thisSharedInfo := s.GetShareObjectFromRealPath(rpath)
		js, _ := json.Marshal(Result{
			IsShared:  true,
			ShareUUID: thisSharedInfo,
		})
		sendJSONResponse(w, string(js))
	}

}

//Create new share from the given path
func (s *Manager) HandleCreateNewShare(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := mv(r, "path", true)
	if err != nil {
		sendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	share, err := s.CreateNewShare(userinfo, vpath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(share)
	sendJSONResponse(w, string(js))
}

// Handle Share Edit.
// For allowing groups / users, use the following syntax
// groups:group1,group2,group3
// users:user1,user2,user3
// For basic modes, use the following keywords
// anyone / signedin / samegroup
// anyone: Anyone who has the link
// signedin: Anyone logged in to this system
// samegroup: The requesting user has the same (or more) user group as the share owner
func (s *Manager) HandleEditShare(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	uuid, err := mv(r, "uuid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid path given")
		return
	}

	shareMode, _ := mv(r, "mode", true)
	if shareMode == "" {
		shareMode = "signedin"
	}

	//Check if share exists
	so := s.GetShareObjectFromUUID(uuid)
	if so == nil {
		//This share url not exists
		sendErrorResponse(w, "Share UUID not exists")
		return
	}

	//Check if the user has permission to edit this share
	if so.Owner != userinfo.Username && userinfo.IsAdmin() == false {
		//This file is not shared by this user and this user is not admin. Block this request
		sendErrorResponse(w, "Permission denied")
		return
	}

	//Validate and extract the storage mode
	ok, sharetype, settings := validateShareModes(shareMode)
	if !ok {
		sendErrorResponse(w, "Invalid share setting")
		return
	}

	//Analysis the sharetype
	if sharetype == "anyone" || sharetype == "signedin" || sharetype == "samegroup" {
		//Basic types.
		so.Permission = sharetype

		if sharetype == "samegroup" {
			//Write user groups into accessible (Must be all match inorder to allow access)
			userpg := []string{}
			for _, pg := range userinfo.PermissionGroup {
				userpg = append(userpg, pg.Name)
			}
			so.Accessibles = userpg
		}

		//Write changes to database
		s.options.Database.Write("share", uuid, so)

	} else if sharetype == "groups" || sharetype == "users" {
		//Username or group is listed = ok
		so.Permission = sharetype
		so.Accessibles = settings

		//Write changes to database
		s.options.Database.Write("share", uuid, so)
	}

	sendOK(w)

}

func (s *Manager) HandleDeleteShare(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := mv(r, "path", true)
	if err != nil {
		sendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Delete the share setting
	err = s.DeleteShare(userinfo, vpath)

	if err != nil {
		sendErrorResponse(w, err.Error())
	} else {
		sendOK(w)
	}
}

//Craete a new file or folder share
func (s *Manager) CreateNewShare(userinfo *user.User, vpath string) (*ShareOption, error) {
	//Translate the vpath to realpath
	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		return nil, errors.New("Unable to find the file on disk")
	}

	rpath = filepath.ToSlash(filepath.Clean(rpath))
	//Check if source file exists
	if !fileExists(rpath) {
		return nil, errors.New("Unable to find the file on disk")
	}

	//Check if the share already exists. If yes, use the previous link
	val, ok := s.fileToUrlMap.Load(rpath)
	if ok {
		//Exists. Send back the old share url
		ShareOption := val.(*ShareOption)
		return ShareOption, nil

	} else {
		//Create new link for this file
		shareUUID := uuid.NewV4().String()

		//user groups when share
		groups := []string{}
		for _, pg := range userinfo.GetUserPermissionGroup() {
			groups = append(groups, pg.Name)
		}

		//Create a share object
		shareOption := ShareOption{
			UUID:             shareUUID,
			FileRealPath:     rpath,
			Owner:            userinfo.Username,
			Accessibles:      groups,
			Permission:       "anyone",
			AllowLivePreview: true,
		}

		//Store results on two map to make sure O(1) Lookup time
		s.fileToUrlMap.Store(rpath, &shareOption)
		s.urlToFileMap.Store(shareUUID, &shareOption)

		//Write object to database
		s.options.Database.Write("share", shareUUID, shareOption)

		return &shareOption, nil
	}
}

//Delete the share on this vpath
func (s *Manager) DeleteShare(userinfo *user.User, vpath string) error {
	//Translate the vpath to realpath
	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		return errors.New("Unable to find the file on disk")
	}

	//Check if the share already exists. If yes, use the previous link
	val, ok := s.fileToUrlMap.Load(rpath)
	if ok {
		//Exists. Send back the old share url
		uuid := val.(*ShareOption).UUID

		//Remove this from the database
		err = s.options.Database.Delete("share", uuid)
		if err != nil {
			return err
		}

		//Remove this form the current sync map
		s.urlToFileMap.Delete(uuid)
		s.fileToUrlMap.Delete(rpath)

		return nil

	} else {
		//Already deleted from buffered record.
		return nil
	}

}

func (s *Manager) GetShareUUIDFromPath(rpath string) string {
	targetShareObject := s.GetShareObjectFromRealPath(rpath)
	if (targetShareObject) != nil {
		return targetShareObject.UUID
	}
	return ""
}

func (s *Manager) GetShareObjectFromRealPath(rpath string) *ShareOption {
	rpath = filepath.ToSlash(filepath.Clean(rpath))
	var targetShareOption *ShareOption
	s.fileToUrlMap.Range(func(k, v interface{}) bool {
		filePath := k.(string)
		shareObject := v.(*ShareOption)

		if filepath.ToSlash(filepath.Clean(filePath)) == rpath {
			targetShareOption = shareObject
		}

		return true
	})

	return targetShareOption
}

func (s *Manager) GetShareObjectFromUUID(uuid string) *ShareOption {
	var targetShareOption *ShareOption
	s.urlToFileMap.Range(func(k, v interface{}) bool {
		thisUuid := k.(string)
		shareObject := v.(*ShareOption)

		if thisUuid == uuid {
			targetShareOption = shareObject
		}

		return true
	})

	return targetShareOption
}

func (s *Manager) FileIsShared(rpath string) bool {
	shareUUID := s.GetShareUUIDFromPath(rpath)
	return shareUUID != ""
}

func ServePermissionDeniedPage(w http.ResponseWriter) {
	w.WriteHeader(http.StatusForbidden)
	pageContent := []byte("Permissioned Denied")
	if fileExists("system/share/permissionDenied.html") {
		content, err := ioutil.ReadFile("system/share/permissionDenied.html")
		if err == nil {
			pageContent = content
		}
	}
	w.Write([]byte(pageContent))
}

/*
	Validate Share Mode string
	will return
	1. bool => Is valid
	2. permission type: {basic / groups / users}
	3. mode string

*/
func validateShareModes(mode string) (bool, string, []string) {
	// user:a,b,c,d
	validModes := []string{"anyone", "signedin", "samegroup"}
	if inArray(validModes, mode) {
		//Standard modes
		return true, mode, []string{}
	} else if len(mode) > 7 && mode[:7] == "groups:" {
		//Handle custom group case like groups:a,b,c,d
		groupList := mode[7:]
		if len(groupList) > 0 {
			groups := strings.Split(groupList, ",")
			return true, "groups", groups
		} else {
			//Invalid configuration
			return false, "groups", []string{}
		}
	} else if len(mode) > 6 && mode[:6] == "users:" {
		//Handle custom usersname like users:a,b,c,d
		userList := mode[6:]
		if len(userList) > 0 {
			users := strings.Split(userList, ",")
			return true, "users", users
		} else {
			//Invalid configuration
			return false, "users", []string{}
		}
	}

	return false, "", []string{}
}

func (s *Manager) RemoveShareByRealpath(rpath string) error {
	_, ok := s.fileToUrlMap.Load(rpath)
	if ok {
		s.fileToUrlMap.Delete(rpath)
	} else {
		return errors.New("Share with given realpath not exists")
	}
	return nil
}

func (s *Manager) RemoveShareByUUID(uuid string) error {
	_, ok := s.urlToFileMap.Load(uuid)
	if ok {
		s.urlToFileMap.Delete(uuid)
	} else {
		return errors.New("Share with given uuid not exists")
	}
	return nil
}

//Check and clear shares that its pointinf files no longe exists
func (s *Manager) ValidateAndClearShares() {
	//Iterate through all shares within the system
	s.fileToUrlMap.Range(func(k, v interface{}) bool {
		thisRealPath := k.(string)
		if !fileExists(thisRealPath) {
			//This share source file don't exists anymore. Remove it
			thisFileShareOption := v.(*ShareOption)

			//Delete this task from both sync map
			s.RemoveShareByRealpath(thisRealPath)
			s.RemoveShareByUUID(thisFileShareOption.UUID)

			//Remove share from database
			s.options.Database.Delete("share", thisFileShareOption.UUID)

			log.Println("*Share* Removing share to file: " + thisRealPath + " as it no longer exists")
		}
		return true
	})

}
