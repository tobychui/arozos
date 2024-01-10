package share

/*
	Arozos File Share Manager
	author: tobychui

	This module handle file share request and other stuffs
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"io/fs"
	"log"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golang/freetype"
	"github.com/nfnt/resize"
	uuid "github.com/satori/go.uuid"

	"imuslab.com/arozos/mod/auth"
	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
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

// Create a new Share Manager
func NewShareManager(options Options) *Manager {
	//Return a new manager object
	return &Manager{
		options: options,
	}
}

func (s *Manager) HandleOPGServing(w http.ResponseWriter, r *http.Request, shareID string) {
	shareEntry := s.GetShareObjectFromUUID(shareID)
	if shareEntry == nil {
		//This share is not valid
		http.NotFound(w, r)
		return
	}

	//Overlap and generate opg
	//Load in base template
	baseTemplate, err := os.Open("./system/share/default_opg.png")
	if err != nil {
		fmt.Println("[share/opg] " + err.Error())
		http.NotFound(w, r)
		return
	}

	base, _, err := image.Decode(baseTemplate)
	if err != nil {
		fmt.Println("[share/opg] " + err.Error())
		http.NotFound(w, r)
		return
	}

	//Create base canvas
	rx := image.Rectangle{image.Point{0, 0}, base.Bounds().Size()}
	resultopg := image.NewRGBA(rx)
	draw.Draw(resultopg, base.Bounds(), base, image.Point{0, 0}, draw.Src)

	//Append filename to the image
	fontBytes, err := os.ReadFile("./system/share/fonts/TaipeiSansTCBeta-Light.ttf")
	if err != nil {
		fmt.Println("[share/opg] " + err.Error())
		http.NotFound(w, r)
		return
	}

	utf8Font, err := freetype.ParseFont(fontBytes)
	if err != nil {
		fmt.Println("[share/opg] " + err.Error())
		http.NotFound(w, r)
		return
	}

	fontSize := float64(42)
	ctx := freetype.NewContext()
	ctx.SetDPI(72)
	ctx.SetFont(utf8Font)
	ctx.SetFontSize(fontSize)
	ctx.SetClip(resultopg.Bounds())
	ctx.SetDst(resultopg)
	ctx.SetSrc(image.NewUniform(color.RGBA{255, 255, 255, 255}))

	//Check if we need to split the filename into two lines
	filename := arozfs.Base(shareEntry.FileRealPath)
	filenameOnly := strings.TrimSuffix(filename, filepath.Ext(filename))

	//Get the file information from target fsh
	ownerinfo, err := s.options.UserHandler.GetUserInfoFromUsername(shareEntry.Owner)
	if err != nil {
		fmt.Println("[share/opg] " + err.Error())
		http.NotFound(w, r)
		return
	}

	fsh, err := ownerinfo.GetFileSystemHandlerFromVirtualPath(shareEntry.FileVirtualPath)
	if err != nil {
		fmt.Println("[share/opg] " + err.Error())
		http.NotFound(w, r)
		return
	}

	fs := fsh.FileSystemAbstraction.GetFileSize(shareEntry.FileRealPath)
	shareMeta := filepath.Ext(shareEntry.FileRealPath) + " / " + filesystem.GetFileDisplaySize(fs, 2)
	if fsh.FileSystemAbstraction.IsDir(shareEntry.FileRealPath) {
		if fsh.IsNetworkDrive() {
			fileCount := 0
			folderCount := 0
			dirEntries, _ := fsh.FileSystemAbstraction.ReadDir(shareEntry.FileRealPath)
			for _, di := range dirEntries {
				if di.IsDir() {
					folderCount++
				} else {
					fileCount++
				}
			}
			shareMeta = strconv.Itoa(fileCount) + " File"
			if (fileCount) > 1 {
				shareMeta += "s"
			}
			if folderCount > 0 {
				shareMeta += " / " + strconv.Itoa(folderCount) + " Subfolder"
				if folderCount > 1 {
					shareMeta += "s"
				}
			}
		} else {
			fs, fc := filesystem.GetDirctorySize(shareEntry.FileRealPath, false)
			shareMeta = strconv.Itoa(fc) + " items / " + filesystem.GetFileDisplaySize(fs, 2)
		}

	}

	if len([]rune(filename)) > 20 {
		//Split into lines
		lines := []string{}
		for i := 0; i < len([]rune(filenameOnly)); i += 20 {
			endPos := int(math.Min(float64(len([]rune(filenameOnly))), float64(i+20)))
			lines = append(lines, string([]rune(filenameOnly)[i:endPos]))
		}

		for j, line := range lines {
			pt := freetype.Pt(100, (j+1)*60+int(ctx.PointToFixed(fontSize)>>6))
			_, err = ctx.DrawString(line, pt)
			if err != nil {
				fmt.Println("[share/opg] " + err.Error())
				return
			}
		}

		fontSize = 36
		ctx.SetFontSize(fontSize)
		pt := freetype.Pt(100, (len(lines)+1)*60+int(ctx.PointToFixed(fontSize)>>6))
		_, err = ctx.DrawString(shareMeta, pt)
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}

	} else {
		//One liner
		pt := freetype.Pt(100, 60+int(ctx.PointToFixed(fontSize)>>6))
		_, err = ctx.DrawString(filenameOnly, pt)
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}

		fontSize = 36
		ctx.SetFontSize(fontSize)
		pt = freetype.Pt(100, 120+int(ctx.PointToFixed(fontSize)>>6))
		_, err = ctx.DrawString(shareMeta, pt)
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}
	}

	//Get thumbnail
	rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(shareEntry.FileVirtualPath, shareEntry.Owner)
	cacheFileImagePath, err := metadata.GetCacheFilePath(fsh, rpath)
	if err == nil {
		//We got a thumbnail for this file. Render it as well
		thumbnailFile, err := fsh.FileSystemAbstraction.ReadStream(cacheFileImagePath)
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}

		thumb, _, err := image.Decode(thumbnailFile)
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}

		resizedThumb := resize.Resize(250, 0, thumb, resize.Lanczos3)
		draw.Draw(resultopg, resultopg.Bounds(), resizedThumb, image.Point{-(resultopg.Bounds().Dx() - resizedThumb.Bounds().Dx() - 90), -60}, draw.Over)
	} else if utils.IsDir(shareEntry.FileRealPath) {
		//Is directory but no thumbnail. Use default foldr share thumbnail
		thumbnailFile, err := os.Open("./system/share/folder.png")
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}

		thumb, _, err := image.Decode(thumbnailFile)
		if err != nil {
			fmt.Println("[share/opg] " + err.Error())
			http.NotFound(w, r)
			return
		}

		resizedThumb := resize.Resize(250, 0, thumb, resize.Lanczos3)
		draw.Draw(resultopg, resultopg.Bounds(), resizedThumb, image.Point{-(resultopg.Bounds().Dx() - resizedThumb.Bounds().Dx() - 90), -60}, draw.Over)
	}

	w.Header().Set("Content-Type", "image/jpeg")
	jpeg.Encode(w, resultopg, nil)

}

// Main function for handle share. Must be called with http.HandleFunc (No auth)
func (s *Manager) HandleShareAccess(w http.ResponseWriter, r *http.Request) {
	//New download method variables
	subpathElements := []string{}
	directDownload := false
	directServe := false
	relpath := ""

	id, err := utils.GetPara(r, "id")
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
				if subpathElements[1] == "opg" {
					//Handle serving opg preview image, usually with
					// /share/opg/{req.timestamp}/{uuid}
					s.HandleOPGServing(w, r, subpathElements[3])
					return
				}

				//Invalid operation type
				w.WriteHeader(http.StatusBadRequest)
				w.Header().Set("Content-Type", "text/plain") // this
				w.Write([]byte("400 - Operation type not supported: " + subpathElements[1]))
				return
			}
		} else if len(subpathElements) == 1 {
			//ID is missing. Serve the id input page
			content, err := os.ReadFile("system/share/index.html")
			if err != nil {
				//Handling index not found. Is server updated correctly?
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("500 - Internal Server Error"))
				return
			}

			content = []byte(strings.ReplaceAll(string(content), "{{hostname}}", s.options.HostName))
			w.Write([]byte(content))
			return
		} else {
			http.NotFound(w, r)
			return
		}
	} else {

		//Parse and redirect to new share path
		download, _ := utils.GetPara(r, "download")
		if download == "true" {
			directDownload = true
		}

		serve, _ := utils.GetPara(r, "serve")
		if serve == "true" {
			directServe = true
		}

		relpath, _ = utils.GetPara(r, "rel")

		redirectURL := "./" + id + "/"
		if directDownload == true {
			redirectURL = "./download/" + id + "/"
		}
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
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
					http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/"+id, 307)
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
					http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/"+id, 307)
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
				if utils.StringInArray(thisUsersGroupByName, allowedpg) {
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
					http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/"+id, 307)
				}
				return
			}

			//Check if username in the allowed user list
			if !utils.StringInArray(shareOption.Accessibles, thisuserinfo.Username) && shareOption.Owner != thisuserinfo.Username {
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
					http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect=/share/"+id, 307)
				}
				return
			}

			allowAccess := false

			thisUsersGroupByName := []string{}
			for _, pg := range thisuserinfo.PermissionGroup {
				thisUsersGroupByName = append(thisUsersGroupByName, pg.Name)
			}

			for _, thisUserPg := range thisUsersGroupByName {
				if utils.StringInArray(shareOption.Accessibles, thisUserPg) {
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

		//Resolve the fsh from the entry
		owner, err := s.options.UserHandler.GetUserInfoFromUsername(shareOption.Owner)
		if err != nil {
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("401 - Share account not exists"))
			return
		}

		targetFsh, err := owner.GetFileSystemHandlerFromVirtualPath(shareOption.FileVirtualPath)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("500 - Unable to load Shared File"))
			return
		}
		targetFshAbs := targetFsh.FileSystemAbstraction
		fileRuntimeAbsPath, _ := targetFshAbs.VirtualPathToRealPath(shareOption.FileVirtualPath, owner.Username)
		if !targetFshAbs.FileExists(fileRuntimeAbsPath) {
			http.NotFound(w, r)
			return
		}

		//Serve the download page
		if targetFshAbs.IsDir(fileRuntimeAbsPath) {
			//This share is a folder
			type File struct {
				Filename string
				RelPath  string
				Filesize string
				IsDir    bool
			}
			if directDownload {
				if relpath != "" {
					//User specified a specific file within the directory. Escape the relpath
					targetFilepath := filepath.Join(fileRuntimeAbsPath, relpath)

					//Check if file exists
					if !targetFshAbs.FileExists(targetFilepath) {
						http.NotFound(w, r)
						return
					}

					//Validate the absolute path to prevent path escape
					reqPath := filepath.ToSlash(filepath.Clean(targetFilepath))
					rootPath, _ := targetFshAbs.VirtualPathToRealPath(shareOption.FileVirtualPath, shareOption.Owner)
					if !strings.HasPrefix(arozfs.ToSlash(reqPath), arozfs.ToSlash(rootPath)) {
						//Directory escape detected
						w.WriteHeader(http.StatusBadRequest)
						w.Write([]byte("400 - Bad Request: Invalid relative path"))
						return
					}

					//Serve the target file
					w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(arozfs.Base(targetFilepath)), "+", "%20"))
					w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
					//http.ServeFile(w, r, targetFilepath)

					if targetFsh.RequireBuffer {
						f, err := targetFshAbs.ReadStream(targetFilepath)
						if err != nil {
							w.WriteHeader(http.StatusInternalServerError)
							w.Write([]byte("500 - Internal Server Error: " + err.Error()))
							return
						}
						defer f.Close()
						io.Copy(w, f)
					} else {
						f, err := targetFshAbs.Open(targetFilepath)
						if err != nil {
							w.WriteHeader(http.StatusInternalServerError)
							w.Write([]byte("500 - Internal Server Error: " + err.Error()))
							return
						}
						defer f.Close()
						fi, _ := f.Stat()
						http.ServeContent(w, r, arozfs.Base(targetFilepath), fi.ModTime(), f)
					}

				} else {
					//Download this folder as zip
					//Create a zip using ArOZ Zipper, tmp zip files are located under tmp/share-cache/*.zip
					tmpFolder := s.options.TmpFolder
					tmpFolder = filepath.Join(tmpFolder, "share-cache")
					os.MkdirAll(tmpFolder, 0755)
					targetZipFilename := filepath.Join(tmpFolder, arozfs.Base(fileRuntimeAbsPath)) + ".zip"

					//Check if the target fs require buffer
					zippingSource := shareOption.FileRealPath
					localBuff := ""
					zippingSourceFsh := targetFsh
					if targetFsh.RequireBuffer {
						//Buffer all the required files for zipping
						localBuff = filepath.Join(tmpFolder, uuid.NewV4().String(), arozfs.Base(fileRuntimeAbsPath))
						os.MkdirAll(localBuff, 0755)

						//Buffer all files into tmp folder
						targetFshAbs.Walk(fileRuntimeAbsPath, func(path string, info fs.FileInfo, err error) error {
							relPath := strings.TrimPrefix(filepath.ToSlash(path), filepath.ToSlash(fileRuntimeAbsPath))
							localPath := filepath.Join(localBuff, relPath)
							if info.IsDir() {
								os.MkdirAll(localPath, 0755)
							} else {
								f, err := targetFshAbs.ReadStream(path)
								if err != nil {
									log.Println("[Share] Buffer and zip download operation failed: ", err)
								}
								defer f.Close()
								dest, err := os.OpenFile(localPath, os.O_CREATE|os.O_WRONLY, 0775)
								if err != nil {
									log.Println("[Share] Buffer and zip download operation failed: ", err)
								}
								defer dest.Close()
								_, err = io.Copy(dest, f)
								if err != nil {
									log.Println("[Share] Buffer and zip download operation failed: ", err)
								}

							}
							return nil
						})

						zippingSource = localBuff
						zippingSourceFsh = nil
					}

					//Build a filelist
					err := filesystem.ArozZipFile([]*filesystem.FileSystemHandler{zippingSourceFsh}, []string{zippingSource}, nil, targetZipFilename, false)
					if err != nil {
						//Failed to create zip file
						w.WriteHeader(http.StatusInternalServerError)
						w.Write([]byte("500 - Internal Server Error: Zip file creation failed"))
						log.Println("Failed to create zip file for share download: " + err.Error())
						return
					}

					//Serve thje zip file
					w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(arozfs.Base(shareOption.FileRealPath)), "+", "%20")+".zip")
					w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
					http.ServeFile(w, r, targetZipFilename)

					//Remove the buffer file if exists
					if targetFsh.RequireBuffer {
						os.RemoveAll(filepath.Dir(localBuff))
					}
				}

			} else if directServe {
				//Folder provide no direct serve method.
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte("400 - Cannot preview folder type shares"))
				return
			} else {
				//Show download page. Do not allow serving

				//Get file size
				fsize, fcount := targetFsh.GetDirctorySizeFromRealPath(fileRuntimeAbsPath, false)

				//Build the tree list of the folder
				treeList := map[string][]File{}
				err = targetFshAbs.Walk(filepath.Clean(fileRuntimeAbsPath), func(file string, info os.FileInfo, err error) error {
					if err != nil {
						//If error skip this
						return nil
					}
					if arozfs.Base(file)[:1] != "." {
						fileSize := targetFshAbs.GetFileSize(file)
						if targetFshAbs.IsDir(file) {
							fileSize, _ = targetFsh.GetDirctorySizeFromRealPath(file, false)
						}

						relPath := strings.TrimPrefix(filepath.ToSlash(file), filepath.ToSlash(fileRuntimeAbsPath))
						relDir := strings.TrimPrefix(filepath.ToSlash(filepath.Dir(file)), filepath.ToSlash(fileRuntimeAbsPath))
						if relPath == "." || relPath == "" {
							//The root file object. Skip this
							return nil
						}

						if relDir == "" {
							relDir = "."
						}

						treeList[relDir] = append(treeList[relDir], File{
							Filename: arozfs.Base(file),
							RelPath:  filepath.ToSlash(relPath),
							Filesize: filesystem.GetFileDisplaySize(fileSize, 2),
							IsDir:    targetFshAbs.IsDir(file),
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
				fmodtime, _ := targetFshAbs.GetModTime(fileRuntimeAbsPath)
				timeString := time.Unix(fmodtime, 0).Format("02-01-2006 15:04:05")

				content, err := utils.Templateload("./system/share/downloadPageFolder.html", map[string]string{
					"hostname":     s.options.HostName,
					"host":         r.Host,
					"reqid":        id,
					"mime":         "application/x-directory",
					"size":         filesystem.GetFileDisplaySize(fsize, 2),
					"filecount":    strconv.Itoa(fcount),
					"modtime":      timeString,
					"downloadurl":  "../../share/download/" + id,
					"filename":     arozfs.Base(fileRuntimeAbsPath),
					"reqtime":      strconv.Itoa(int(time.Now().Unix())),
					"requri":       "//" + r.Host + r.URL.Path,
					"opg_image":    "/share/opg/" + strconv.Itoa(int(time.Now().Unix())) + "/" + id,
					"treelist":     string(tl),
					"downloaduuid": id,
				})
				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte("500 - Internal Server Error"))
					return
				}

				w.Write([]byte(content))
				return

			}
		} else {
			//This share is a file
			contentType := mime.TypeByExtension(filepath.Ext(fileRuntimeAbsPath))
			if directDownload {
				//Serve the file directly
				w.Header().Set("Content-Disposition", "attachment; filename=\""+arozfs.Base(shareOption.FileVirtualPath)+"\"")
				w.Header().Set("Content-Type", contentType)
				w.Header().Set("Content-Length", strconv.Itoa(int(targetFshAbs.GetFileSize(fileRuntimeAbsPath))))

				if filesystem.FileExists(fileRuntimeAbsPath) {
					//This file exists in local file system. Serve it directly
					http.ServeFile(w, r, fileRuntimeAbsPath)
				} else {
					if targetFsh.RequireBuffer {
						f, err := targetFshAbs.ReadStream(fileRuntimeAbsPath)
						if err != nil {
							w.WriteHeader(http.StatusInternalServerError)
							w.Write([]byte("500 - Internal Server Error: " + err.Error()))
							return
						}
						defer f.Close()
						io.Copy(w, f)
					} else {
						f, err := targetFshAbs.Open(fileRuntimeAbsPath)
						if err != nil {
							w.WriteHeader(http.StatusInternalServerError)
							w.Write([]byte("500 - Internal Server Error: " + err.Error()))
							return
						}
						defer f.Close()
						fi, _ := f.Stat()
						http.ServeContent(w, r, arozfs.Base(fileRuntimeAbsPath), fi.ModTime(), f)
					}
				}
			} else if directServe {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Content-Type", contentType)
				if targetFsh.RequireBuffer {
					f, err := targetFshAbs.ReadStream(fileRuntimeAbsPath)
					if err != nil {
						w.WriteHeader(http.StatusInternalServerError)
						w.Write([]byte("500 - Internal Server Error: " + err.Error()))
						return
					}
					defer f.Close()
					io.Copy(w, f)
				} else {
					f, err := targetFshAbs.Open(fileRuntimeAbsPath)
					if err != nil {
						w.WriteHeader(http.StatusInternalServerError)
						w.Write([]byte("500 - Internal Server Error: " + err.Error()))
						return
					}
					defer f.Close()
					fi, _ := f.Stat()
					http.ServeContent(w, r, arozfs.Base(fileRuntimeAbsPath), fi.ModTime(), f)
				}
			} else {
				//Serve the download page
				content, err := os.ReadFile("./system/share/downloadPage.html")
				if err != nil {
					http.NotFound(w, r)
					return
				}

				//Get file mime type
				mime, ext, err := filesystem.GetMime(fileRuntimeAbsPath)
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

				tp, err := os.ReadFile(previewTemplate)
				if err != nil {
					tp = []byte("")
				}

				//Merge two templates
				content = []byte(strings.ReplaceAll(string(content), "{{previewer}}", string(tp)))

				//Get file size
				fsize := targetFshAbs.GetFileSize(fileRuntimeAbsPath)

				//Get modification time
				fmodtime, _ := targetFshAbs.GetModTime(fileRuntimeAbsPath)
				timeString := time.Unix(fmodtime, 0).Format("02-01-2006 15:04:05")

				//Check if ext match with filepath ext
				displayExt := ext
				if ext != filepath.Ext(fileRuntimeAbsPath) {
					displayExt = filepath.Ext(fileRuntimeAbsPath) + " (" + ext + ")"
				}

				data := map[string]string{
					"hostname":    s.options.HostName,
					"host":        r.Host,
					"reqid":       id,
					"requri":      "//" + r.Host + r.URL.Path,
					"mime":        mime,
					"ext":         displayExt,
					"size":        filesystem.GetFileDisplaySize(fsize, 2),
					"modtime":     timeString,
					"downloadurl": "/share/download/" + id + "/" + arozfs.Base(fileRuntimeAbsPath),
					"preview_url": "/share/preview/" + id + "/",
					"filename":    arozfs.Base(fileRuntimeAbsPath),
					"opg_image":   "/share/opg/" + strconv.Itoa(int(time.Now().Unix())) + "/" + id,
					"reqtime":     strconv.Itoa(int(time.Now().Unix())),
				}

				for key, value := range data {
					key = "{{" + key + "}}"
					content = []byte(strings.ReplaceAll(string(content), key, value))
				}

				w.Write([]byte(content))
				return
			}
		}

	} else {
		//This share not exists
		if directDownload {
			//Send 404 header
			http.NotFound(w, r)
			return
		} else {
			//Send not found page
			content, err := utils.Templateload("./system/share/notfound.html", map[string]string{
				"hostname": s.options.HostName,
				"reqid":    id,
				"reqtime":  strconv.Itoa(int(time.Now().Unix())),
			})

			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(content))
			return
		}

	}

}

// Check if a file is shared
func (s *Manager) HandleShareCheck(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	fsh, _ := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	pathHash, err := shareEntry.GetPathHash(fsh, vpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, "Unable to get share from given path")
		return
	}
	type Result struct {
		IsShared  bool
		ShareUUID *shareEntry.ShareOption
	}

	//Check if share exists
	shareExists := s.options.ShareEntryTable.FileIsShared(pathHash)
	if !shareExists {
		//Share not exists
		js, _ := json.Marshal(Result{
			IsShared:  false,
			ShareUUID: &shareEntry.ShareOption{},
		})
		utils.SendJSONResponse(w, string(js))

	} else {
		//Share exists
		thisSharedInfo := s.options.ShareEntryTable.GetShareObjectFromPathHash(pathHash)
		js, _ := json.Marshal(Result{
			IsShared:  true,
			ShareUUID: thisSharedInfo,
		})
		utils.SendJSONResponse(w, string(js))
	}

}

// Create new share from the given path
func (s *Manager) HandleCreateNewShare(w http.ResponseWriter, r *http.Request) {
	//Get the vpath from paramters
	vpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get the target fsh that this vpath come from
	vpathSourceFsh := userinfo.GetRootFSHFromVpathInUserScope(vpath)
	if vpathSourceFsh == nil {
		utils.SendErrorResponse(w, "Invalid vpath given")
		return
	}

	share, err := s.CreateNewShare(userinfo, vpathSourceFsh, vpath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(share)
	utils.SendJSONResponse(w, string(js))
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
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid path given")
		return
	}

	shareMode, _ := utils.PostPara(r, "mode")
	if shareMode == "" {
		shareMode = "signedin"
	}

	//Check if share exists
	so := s.options.ShareEntryTable.GetShareObjectFromUUID(uuid)
	if so == nil {
		//This share url not exists
		utils.SendErrorResponse(w, "Share UUID not exists")
		return
	}

	//Check if the user has permission to edit this share
	if !s.CanModifyShareEntry(userinfo, so.FileVirtualPath) {
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	//Validate and extract the storage mode
	ok, sharetype, settings := validateShareModes(shareMode)
	if !ok {
		utils.SendErrorResponse(w, "Invalid share setting")
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

	utils.SendOK(w)

}

func (s *Manager) HandleDeleteShare(w http.ResponseWriter, r *http.Request) {
	//Get userinfo
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get the vpath from paramters
	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		//Try to get it from vpath
		vpath, err := utils.PostPara(r, "vpath")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid uuid or vpath given")
			return
		}

		targetSa := s.GetShareObjectFromUserAndVpath(userinfo, vpath)
		if targetSa == nil {
			utils.SendErrorResponse(w, "Invalid uuid or vpath given")
			return
		}
		uuid = targetSa.UUID
	}

	//Delete the share setting
	err = s.DeleteShareByUUID(userinfo, uuid)

	if err != nil {
		utils.SendErrorResponse(w, err.Error())
	} else {
		utils.SendOK(w)
	}
}

func (s *Manager) HandleListAllShares(w http.ResponseWriter, r *http.Request) {
	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	fshId, _ := utils.GetPara(r, "fsh")
	results := []*shareEntry.ShareOption{}
	if fshId == "" {
		//List all
		allFsh := userinfo.GetAllFileSystemHandler()
		for _, thisFsh := range allFsh {
			allShares := s.ListAllShareByFshId(thisFsh.UUID, userinfo)
			for _, thisShare := range allShares {
				if s.ShareIsValid(thisShare) {
					results = append(results, thisShare)
				}
			}

		}
	} else {
		//List fsh only
		targetFsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(fshId)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		sharesInThisFsh := s.ListAllShareByFshId(targetFsh.UUID, userinfo)
		for _, thisShare := range sharesInThisFsh {
			if s.ShareIsValid(thisShare) {
				results = append(results, thisShare)
			}
		}
	}

	//Reduce the data
	type Share struct {
		UUID                 string
		FileVirtualPath      string
		Owner                string
		Permission           string
		IsFolder             bool
		IsOwnerOfShare       bool
		CanAccess            bool
		CanOpenInFileManager bool
		CanDelete            bool
	}

	reducedResult := []*Share{}
	for _, result := range results {
		permissionText := result.Permission
		if result.Permission == "groups" || result.Permission == "users" {
			permissionText = permissionText + " (" + strings.Join(result.Accessibles, ", ") + ")"
		}
		thisShareInfo := Share{
			UUID:                 result.UUID,
			FileVirtualPath:      result.FileVirtualPath,
			Owner:                result.Owner,
			Permission:           permissionText,
			IsFolder:             result.IsFolder,
			IsOwnerOfShare:       userinfo.Username == result.Owner,
			CanAccess:            result.IsAccessibleBy(userinfo.Username, userinfo.GetUserPermissionGroupNames()),
			CanOpenInFileManager: s.UserCanOpenShareInFileManager(result, userinfo),
			CanDelete:            s.CanModifyShareEntry(userinfo, result.FileVirtualPath),
		}

		reducedResult = append(reducedResult, &thisShareInfo)
	}

	js, _ := json.Marshal(reducedResult)
	utils.SendJSONResponse(w, string(js))
}

/*
Check if the user can open the share in File Manager

There are two conditions where the user can open the file in file manager
1. If the user is the owner of the file
2. If the user is NOT the owner of the file but the target fsh is public accessible and in user's fsh list
*/
func (s *Manager) UserCanOpenShareInFileManager(share *shareEntry.ShareOption, userinfo *user.User) bool {
	if share.Owner == userinfo.Username {
		return true
	}

	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(share.FileVirtualPath)
	if err != nil {
		//User do not have permission to access this fsh
		return false
	}

	rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(share.FileVirtualPath, userinfo.Username)
	if fsh.Hierarchy == "public" && fsh.FileSystemAbstraction.FileExists(rpath) {
		return true
	}

	return false
}

// Craete a new file or folder share
func (s *Manager) CreateNewShare(userinfo *user.User, srcFsh *filesystem.FileSystemHandler, vpath string) (*shareEntry.ShareOption, error) {
	//Translate the vpath to realpath
	return s.options.ShareEntryTable.CreateNewShare(srcFsh, vpath, userinfo.Username, userinfo.GetUserPermissionGroupNames())

}

func ServePermissionDeniedPage(w http.ResponseWriter) {
	w.WriteHeader(http.StatusForbidden)
	pageContent := []byte("Permissioned Denied")
	if utils.FileExists("system/share/permissionDenied.html") {
		content, err := os.ReadFile("system/share/permissionDenied.html")
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
	if utils.StringInArray(validModes, mode) {
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

func (s *Manager) ListAllShareByFshId(fshId string, userinfo *user.User) []*shareEntry.ShareOption {
	results := []*shareEntry.ShareOption{}
	s.options.ShareEntryTable.FileToUrlMap.Range(func(k, v interface{}) bool {
		thisShareOption := v.(*shareEntry.ShareOption)
		if (!userinfo.IsAdmin() && thisShareOption.IsAccessibleBy(userinfo.Username, userinfo.GetUserPermissionGroupNames())) || userinfo.IsAdmin() {
			id, _, _ := filesystem.GetIDFromVirtualPath(thisShareOption.FileVirtualPath)
			if id == fshId {
				results = append(results, thisShareOption)
			}

		}
		return true
	})

	sort.Slice(results, func(i, j int) bool {
		return results[i].UUID < results[j].UUID
	})

	return results
}

func (s *Manager) ShareIsValid(thisShareOption *shareEntry.ShareOption) bool {
	vpath := thisShareOption.FileVirtualPath
	userinfo, _ := s.options.UserHandler.GetUserInfoFromUsername(thisShareOption.Owner)
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return false
	}

	fshAbs := fsh.FileSystemAbstraction
	rpath, _ := fshAbs.VirtualPathToRealPath(vpath, userinfo.Username)

	if !fshAbs.FileExists(rpath) {
		return false
	}

	return true
}

func (s *Manager) GetPathHashFromShare(thisShareOption *shareEntry.ShareOption) (string, error) {
	vpath := thisShareOption.FileVirtualPath
	userinfo, _ := s.options.UserHandler.GetUserInfoFromUsername(thisShareOption.Owner)
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return "", err
	}
	return shareEntry.GetPathHash(fsh, vpath, userinfo.Username)
}

// Check and clear shares that its pointinf files no longe exists
func (s *Manager) ValidateAndClearShares() {
	//Iterate through all shares within the system
	s.options.ShareEntryTable.FileToUrlMap.Range(func(k, v interface{}) bool {
		thisShareOption := v.(*shareEntry.ShareOption)
		pathHash, err := s.GetPathHashFromShare(thisShareOption)
		if err != nil {
			//Unable to resolve path hash. Filesystem handler is gone?
			//s.options.ShareEntryTable.RemoveShareByUUID(thisShareOption.UUID)
			return true
		}
		if !s.ShareIsValid(thisShareOption) {
			//This share source file don't exists anymore. Remove it
			err = s.options.ShareEntryTable.RemoveShareByPathHash(pathHash)
			if err != nil {
				log.Println("[Share] Failed to remove share", err)
			}
			log.Println("[Share] Removing share to file: " + thisShareOption.FileRealPath + " as it no longer exists")
		}
		return true
	})

}

// Check if the user has the permission to modify this share entry
func (s *Manager) CanModifyShareEntry(userinfo *user.User, vpath string) bool {
	shareEntry := s.GetShareObjectFromUserAndVpath(userinfo, vpath)
	if shareEntry == nil {
		//Share entry not found
		return false
	}

	//Check if the user is the share owner or the user is admin
	if userinfo.IsAdmin() {
		return true
	} else if userinfo.Username == shareEntry.Owner {
		return true
	}

	//Public fsh where the user and owner both can access
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return false
	}
	rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, userinfo.Username)
	if userinfo.CanWrite(vpath) && fsh.Hierarchy == "public" && fsh.FileSystemAbstraction.FileExists(rpath) {
		return true
	}

	return false
}

func (s *Manager) DeleteShareByVpath(userinfo *user.User, vpath string) error {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return err
	}
	if !s.CanModifyShareEntry(userinfo, vpath) {
		return errors.New("Permission denied")
	}
	return s.options.ShareEntryTable.DeleteShareByPathHash(ps)
}

func (s *Manager) DeleteShareByUUID(userinfo *user.User, uuid string) error {
	so := s.GetShareObjectFromUUID(uuid)
	if so == nil {
		return errors.New("Invalid share uuid")
	}

	if !s.CanModifyShareEntry(userinfo, so.FileVirtualPath) {
		return errors.New("Permission denied")
	}

	return s.options.ShareEntryTable.DeleteShareByUUID(uuid)
}

func (s *Manager) GetShareUUIDFromUserAndVpath(userinfo *user.User, vpath string) string {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return ""
	}
	return s.options.ShareEntryTable.GetShareUUIDFromPathHash(ps)
}

func (s *Manager) GetShareObjectFromUserAndVpath(userinfo *user.User, vpath string) *shareEntry.ShareOption {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return nil
	}
	return s.options.ShareEntryTable.GetShareObjectFromPathHash(ps)
}

func (s *Manager) GetShareObjectFromUUID(uuid string) *shareEntry.ShareOption {
	return s.options.ShareEntryTable.GetShareObjectFromUUID(uuid)
}

func (s *Manager) FileIsShared(userinfo *user.User, vpath string) bool {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return false
	}

	return s.options.ShareEntryTable.FileIsShared(ps)
}

func (s *Manager) RemoveShareByUUID(userinfo *user.User, uuid string) error {
	shareObject := s.GetShareObjectFromUUID(uuid)
	if shareObject == nil {
		return errors.New("Share entry not found")
	}
	if !s.CanModifyShareEntry(userinfo, shareObject.FileVirtualPath) {
		return errors.New("Permission denied")
	}
	return s.options.ShareEntryTable.RemoveShareByUUID(uuid)
}

func getPathHashFromUsernameAndVpath(userinfo *user.User, vpath string) (string, error) {
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return "", err
	}
	return shareEntry.GetPathHash(fsh, vpath, userinfo.Username)
}
