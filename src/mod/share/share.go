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
	"time"

	"github.com/valyala/fasttemplate"

	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/common"
	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/user"
)

type Options struct {
	AuthAgent       *auth.AuthAgent
	UserHandler     *user.UserHandler
	ShareEntryTable *shareEntry.ShareEntryTable
	HostName        string
	TmpFolder       string
}

type Manager struct {
	options Options
}

//Create a new Share Manager
func NewShareManager(options Options) *Manager {
	//Return a new manager object
	return &Manager{
		options: options,
	}
}

//Main function for handle share. Must be called with http.HandleFunc (No auth)
func (s *Manager) HandleShareAccess(w http.ResponseWriter, r *http.Request) {
	//New download method variables
	subpathElements := []string{}
	directDownload := false
	directServe := false
	relpath := ""

	id, err := mv(r, "id", false)
	if err != nil {
		//ID is not defined in the URL paramter. New ID defination is based on the subpath content
		requestURI := filepath.ToSlash(filepath.Clean(r.URL.Path))
		subpathElements = strings.Split(requestURI[1:], "/")
		if len(subpathElements) == 2 {
			//E.g. /share/{id} => Show the download page
			id = subpathElements[1]

			//Check if there is missing / at the end. Redirect if true
			if r.URL.Path[len(r.URL.Path)-1:] != "/" {
				http.Redirect(w, r, r.URL.Path+"/", http.StatusTemporaryRedirect)
				return
			}

		} else if len(subpathElements) >= 3 {
			//E.g. /share/download/{uuid} or /share/preview/{uuid}
			id = subpathElements[2]
			if subpathElements[1] == "download" {
				directDownload = true

				//Check if this contain a subpath
				if len(subpathElements) > 3 {
					relpath = strings.Join(subpathElements[3:], "/")
				}
			} else if subpathElements[1] == "preview" {
				directServe = true
			} else if len(subpathElements) == 3 {
				//Check if the last element is the filename
				if strings.Contains(subpathElements[2], ".") {
					//Share link contain filename. Redirect to share interface
					http.Redirect(w, r, "./", http.StatusTemporaryRedirect)
					return
				} else {
					//Incorrect operation type
					w.WriteHeader(http.StatusBadRequest)
					w.Header().Set("Content-Type", "text/plain") // this
					w.Write([]byte("400 - Operation type not supported: " + subpathElements[1]))
					return
				}
			} else if len(subpathElements) >= 4 {
				//Invalid operation type
				w.WriteHeader(http.StatusBadRequest)
				w.Header().Set("Content-Type", "text/plain") // this
				w.Write([]byte("400 - Operation type not supported: " + subpathElements[1]))
				return
			}
		} else if len(subpathElements) == 1 {
			//ID is missing. Serve the id input page
			content, err := ioutil.ReadFile("system/share/index.html")
			if err != nil {
				//Handling index not found. Is server updated correctly?
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("500 - Internal Server Error"))
				return
			}

			t := fasttemplate.New(string(content), "{{", "}}")
			s := t.ExecuteString(map[string]interface{}{
				"hostname": s.options.HostName,
			})

			w.Write([]byte(s))
			return
		} else {
			http.NotFound(w, r)
			return
		}
	} else {

		//Parse and redirect to new share path
		download, _ := mv(r, "download", false)
		if download == "true" {
			directDownload = true
		}

		serve, _ := mv(r, "serve", false)
		if serve == "true" {
			directServe = true
		}

		relpath, _ = mv(r, "rel", false)

		redirectURL := "./" + id + "/"
		if directDownload == true {
			redirectURL = "./download/" + id + "/"
		}
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
	}

	//Check if id exists
	val, ok := s.options.ShareEntryTable.UrlToFileMap.Load(id)
	if ok {
		//Parse the option structure
		shareOption := val.(*shareEntry.ShareOption)

		//Check for permission
		if shareOption.Permission == "anyone" {
			//OK to proceed
		} else if shareOption.Permission == "signedin" {
			if !s.options.AuthAgent.CheckAuth(r) {
				//Redirect to login page
				if directDownload || directServe {
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte("401 - Unauthorized"))
				} else {
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/preview/?id="+id, 307)
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
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/preview/?id="+id, 307)
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
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/"+id, 307)
				}
				return
			}

			//Check if username in the allowed user list
			if !inArray(shareOption.Accessibles, thisuserinfo.Username) && shareOption.Owner != thisuserinfo.Username {
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
					http.Redirect(w, r, common.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/"+id, 307)
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
			if directDownload {
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

			} else if directServe {
				//Folder provide no direct serve method.
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte("400 - Cannot preview folder type shares"))
				return
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

				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte("500 - Internal Server Error"))
					return
				}

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
					"downloadurl":  "../../share/download/" + id,
					"filename":     filepath.Base(shareOption.FileRealPath),
					"reqtime":      strconv.Itoa(int(time.Now().Unix())),
					"treelist":     tl,
					"downloaduuid": id,
				})

				w.Write([]byte(s))
				return

			}
		} else {
			//This share is a file
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
				previewTemplate := ""
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

				//Check if ext match with filepath ext
				displayExt := ext
				if ext != filepath.Ext(shareOption.FileRealPath) {
					displayExt = filepath.Ext(shareOption.FileRealPath) + " (" + ext + ")"
				}
				t := fasttemplate.New(string(content), "{{", "}}")
				s := t.ExecuteString(map[string]interface{}{
					"hostname":    s.options.HostName,
					"reqid":       id,
					"mime":        mime,
					"ext":         displayExt,
					"size":        filesystem.GetFileDisplaySize(fsize, 2),
					"modtime":     timeString,
					"downloadurl": "../../share/download/" + id + "/" + filepath.Base(shareOption.FileRealPath),
					"preview_url": "/share/preview/" + id + "/",
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

		if directDownload {
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
		ShareUUID *shareEntry.ShareOption
	}

	//Check if share exists
	shareExists := s.options.ShareEntryTable.FileIsShared(rpath)
	if !shareExists {
		//Share not exists
		js, _ := json.Marshal(Result{
			IsShared:  false,
			ShareUUID: &shareEntry.ShareOption{},
		})
		sendJSONResponse(w, string(js))

	} else {
		//Share exists
		thisSharedInfo := s.options.ShareEntryTable.GetShareObjectFromRealPath(rpath)
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

	//Check if this is in the share folder
	vrootID, subpath, err := filesystem.GetIDFromVirtualPath(vpath)
	if err != nil {
		sendErrorResponse(w, "Unable to resolve virtual path")
		return
	}
	if vrootID == "share" {
		shareObject, err := s.options.ShareEntryTable.ResolveShareOptionFromShareSubpath(subpath)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Check if this share is own by or accessible by the current user. Reject share modification if not
		if !shareObject.IsOwnedBy(userinfo.Username) && !userinfo.CanWrite(vpath) {
			sendErrorResponse(w, "Permission Denied: You are not the file owner nor can write to this file")
			return
		}
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
	so := s.options.ShareEntryTable.GetShareObjectFromUUID(uuid)
	if so == nil {
		//This share url not exists
		sendErrorResponse(w, "Share UUID not exists")
		return
	}

	//Check if the user has permission to edit this share
	if so.Owner != userinfo.Username && !userinfo.IsAdmin() {
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
		s.options.ShareEntryTable.Database.Write("share", uuid, so)

	} else if sharetype == "groups" || sharetype == "users" {
		//Username or group is listed = ok
		so.Permission = sharetype
		so.Accessibles = settings

		//Write changes to database
		s.options.ShareEntryTable.Database.Write("share", uuid, so)
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
func (s *Manager) CreateNewShare(userinfo *user.User, vpath string) (*shareEntry.ShareOption, error) {
	//Translate the vpath to realpath
	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		return nil, errors.New("Unable to find the file on disk")
	}

	return s.options.ShareEntryTable.CreateNewShare(rpath, userinfo.Username, userinfo.GetUserPermissionGroupNames())

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

//Check and clear shares that its pointinf files no longe exists
func (s *Manager) ValidateAndClearShares() {
	//Iterate through all shares within the system
	s.options.ShareEntryTable.FileToUrlMap.Range(func(k, v interface{}) bool {
		thisRealPath := k.(string)
		if !fileExists(thisRealPath) {
			//This share source file don't exists anymore. Remove it
			s.options.ShareEntryTable.RemoveShareByRealpath(thisRealPath)
			log.Println("*Share* Removing share to file: " + thisRealPath + " as it no longer exists")
		}
		return true
	})

}

func (s *Manager) DeleteShare(userinfo *user.User, vpath string) error {
	//Translate the vpath to realpath
	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		return errors.New("Unable to find the file on disk")
	}

	return s.options.ShareEntryTable.DeleteShare(rpath)
}

func (s *Manager) GetShareUUIDFromPath(rpath string) string {
	return s.options.ShareEntryTable.GetShareUUIDFromPath(rpath)
}

func (s *Manager) GetShareObjectFromRealPath(rpath string) *shareEntry.ShareOption {
	return s.options.ShareEntryTable.GetShareObjectFromRealPath(rpath)
}

func (s *Manager) GetShareObjectFromUUID(uuid string) *shareEntry.ShareOption {
	return s.options.ShareEntryTable.GetShareObjectFromUUID(uuid)
}

func (s *Manager) FileIsShared(rpath string) bool {
	return s.options.ShareEntryTable.FileIsShared(rpath)
}

func (s *Manager) RemoveShareByRealpath(rpath string) error {
	return s.RemoveShareByRealpath(rpath)
}

func (s *Manager) RemoveShareByUUID(uuid string) error {
	return s.options.ShareEntryTable.RemoveShareByUUID(uuid)
}
