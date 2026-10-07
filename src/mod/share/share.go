package share

/*
	Arozos File Share Manager
	author: tobychui

	This module handle file share request and other stuffs
*/

import (
	"compress/flate"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"io/fs"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang/freetype"
	"github.com/nfnt/resize"
	uuid "github.com/satori/go.uuid"

	"imuslab.com/arozos/mod/auth"
	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/notification"
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

	//Optional. Delivers the "a file was shared with you" notice to invited
	//users; usually the core's preference aware notification router.
	NotificationSender func(*notification.NotificationPayload) error
}

// ZipJob tracks the state of an async zip operation
type ZipJob struct {
	mu          sync.Mutex
	Status      string  // "buffering" | "zipping" | "done" | "error"
	Progress    float64 // 0–100
	CurrentFile string
	Error       string
	OutputPath  string
	Filename    string
	CreatedAt   time.Time
	localBuff   string // temp dir to clean up after zipping
}

type Manager struct {
	options Options
	zipJobs sync.Map // map[string]*ZipJob
	guard   *accessGuard
}

// Create a new Share Manager
func NewShareManager(options Options) *Manager {
	//Return a new manager object
	manager := &Manager{
		options: options,
	}
	manager.guard = manager.newAccessGuard()
	return manager
}

func (s *Manager) HandleOPGServing(w http.ResponseWriter, r *http.Request, shareID string) {
	shareEntry := s.lookupActiveShare(shareID)
	if shareEntry == nil || shareEntry.HasPassword() {
		//This share is not valid, or its name is behind a password
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
	// Handle async zip status/download endpoints early — these use the job ID as an auth token
	// and do not require a share entry lookup.
	{
		cleanParts := strings.Split(strings.TrimPrefix(filepath.ToSlash(filepath.Clean(r.URL.Path)), "/"), "/")
		if len(cleanParts) >= 3 {
			switch cleanParts[1] {
			case "zip-status":
				s.handleZipStatus(w, r, cleanParts[2])
				return
			case "zip-download":
				s.handleZipDownload(w, r, cleanParts[2])
				return
			case "auth":
				//Password form of a protected share: /share/auth/{uuid}
				s.handlePasswordSubmit(w, r, cleanParts[2])
				return
			case "upload":
				//Upload into an editable folder share: /share/upload/{uuid}/{subfolder...}
				s.handleShareUpload(w, r, cleanParts[2], strings.Join(cleanParts[3:], "/"))
				return
			}
		}
	}

	//New download method variables
	subpathElements := []string{}
	directDownload := false
	directServe := false
	prepareZip := false
	relpath := ""

	compressionLevel := flate.DefaultCompression
	if compressionStr := r.URL.Query().Get("compression_level"); compressionStr != "" {
		if val, err := strconv.Atoi(compressionStr); err == nil {
			// Validate compression level range (-2 to 9)
			if val >= -2 && val <= 9 {
				compressionLevel = val
			}
			// Optional: else could return an error or just silently use default value
		}
	}

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

				//Preview of a file inside a shared folder
				if len(subpathElements) > 3 {
					relpath = strings.Join(subpathElements[3:], "/")
				}
			} else if subpathElements[1] == "prepare-zip" {
				prepareZip = true
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

	//Check if id exists (expired shares are treated as gone)
	shareOption := s.lookupActiveShare(id)
	if shareOption != nil {
		//Check for audience and password
		rawRequest := directDownload || directServe || prepareZip
		if !s.authorizeShareAccess(w, r, shareOption, rawRequest) {
			return
		}

		if (directDownload || prepareZip) && !shareOption.AllowDownload {
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("403 - Download is disabled for this share"))
			return
		}

		if relpath != "" && !shareOption.ShowFileList {
			//The folder content is hidden, so are the files inside it
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("403 - The content of this folder is not shared"))
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
					targetFilepath, err := arozfs.ResolvePathWithinRoot(fileRuntimeAbsPath, relpath)
					if err != nil {
						w.WriteHeader(http.StatusBadRequest)
						w.Write([]byte("400 - Bad Request: Invalid relative path"))
						return
					}

					//Check if file exists
					if !targetFshAbs.FileExists(targetFilepath) {
						http.NotFound(w, r)
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
									logger.PrintAndLog("Share", fmt.Sprint("[Share] Buffer and zip download operation failed: ", err), nil)
								}
								defer f.Close()
								dest, err := os.OpenFile(localPath, os.O_CREATE|os.O_WRONLY, 0775)
								if err != nil {
									logger.PrintAndLog("Share", fmt.Sprint("[Share] Buffer and zip download operation failed: ", err), nil)
								}
								defer dest.Close()
								_, err = io.Copy(dest, f)
								if err != nil {
									logger.PrintAndLog("Share", fmt.Sprint("[Share] Buffer and zip download operation failed: ", err), nil)
								}

							}
							return nil
						})

						zippingSource = localBuff
						zippingSourceFsh = nil
					}

					//Build a filelist
					err := filesystem.ArozZipFileWithCompressionLevel([]*filesystem.FileSystemHandler{zippingSourceFsh}, []string{zippingSource}, nil, targetZipFilename, false, compressionLevel)
					if err != nil {
						//Failed to create zip file
						w.WriteHeader(http.StatusInternalServerError)
						w.Write([]byte("500 - Internal Server Error: Zip file creation failed"))
						logger.PrintAndLog("Share", "Failed to create zip file for share download: "+err.Error(), nil)
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

			} else if prepareZip {
				// Async zip: start a background job and return the job ID immediately
				jobID := uuid.NewV4().String()
				tmpFolder := filepath.Join(s.options.TmpFolder, "share-cache")
				os.MkdirAll(tmpFolder, 0755)
				targetZipFilename := filepath.Join(tmpFolder, jobID+".zip")

				localBuffDir := ""
				if targetFsh.RequireBuffer {
					localBuffDir = filepath.Join(tmpFolder, jobID+"_buff")
				}

				job := &ZipJob{
					Status:     "zipping",
					OutputPath: targetZipFilename,
					Filename:   arozfs.Base(shareOption.FileRealPath) + ".zip",
					CreatedAt:  time.Now(),
					localBuff:  localBuffDir,
				}
				if targetFsh.RequireBuffer {
					job.Status = "buffering"
				}
				s.zipJobs.Store(jobID, job)

				// Capture variables for the goroutine
				capturedFshAbs := targetFshAbs
				capturedSrcPath := fileRuntimeAbsPath
				capturedSrcFsh := targetFsh
				capturedRequireBuffer := targetFsh.RequireBuffer
				capturedLocalBuff := filepath.Join(localBuffDir, arozfs.Base(fileRuntimeAbsPath))
				capturedCompressionLevel := compressionLevel

				go func() {
					actualSource := capturedSrcPath
					var actualFsh *filesystem.FileSystemHandler = capturedSrcFsh

					if capturedRequireBuffer {
						os.MkdirAll(capturedLocalBuff, 0755)
						capturedFshAbs.Walk(capturedSrcPath, func(path string, info fs.FileInfo, err error) error {
							if err != nil {
								return nil
							}
							relPath := strings.TrimPrefix(filepath.ToSlash(path), filepath.ToSlash(capturedSrcPath))
							localPath := filepath.Join(capturedLocalBuff, relPath)
							if info.IsDir() {
								os.MkdirAll(localPath, 0755)
							} else {
								f, err := capturedFshAbs.ReadStream(path)
								if err != nil {
									return nil
								}
								defer f.Close()
								dest, err := os.OpenFile(localPath, os.O_CREATE|os.O_WRONLY, 0775)
								if err != nil {
									return nil
								}
								defer dest.Close()
								io.Copy(dest, f)
							}
							return nil
						})
						actualSource = capturedLocalBuff
						actualFsh = nil
						job.mu.Lock()
						job.Status = "zipping"
						job.mu.Unlock()
					}

					fshs := []*filesystem.FileSystemHandler{actualFsh}
					zipErr := filesystem.ArozZipFileWithProgressAndCompression(fshs, []string{actualSource}, nil, targetZipFilename, false, capturedCompressionLevel, func(filename string, current, total int, progress float64) int {
						job.mu.Lock()
						job.CurrentFile = filename
						job.Progress = progress
						job.mu.Unlock()
						return 0
					})

					job.mu.Lock()
					if zipErr != nil {
						job.Status = "error"
						job.Error = zipErr.Error()
					} else {
						job.Status = "done"
						job.Progress = 100
					}
					job.mu.Unlock()

					if capturedRequireBuffer {
						os.RemoveAll(localBuffDir)
					}

					// Auto-expire the job and zip file after 1 hour
					go func() {
						time.Sleep(time.Hour)
						s.zipJobs.Delete(jobID)
						os.Remove(targetZipFilename)
					}()
				}()

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"jobId": jobID})
				return

			} else if directServe {
				if relpath == "" {
					//Folder provide no direct serve method.
					w.WriteHeader(http.StatusBadRequest)
					w.Write([]byte("400 - Cannot preview folder type shares"))
					return
				}

				//Preview a file inside the shared folder
				targetFilepath, err := arozfs.ResolvePathWithinRoot(fileRuntimeAbsPath, relpath)
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					w.Write([]byte("400 - Bad Request: Invalid relative path"))
					return
				}
				if !targetFshAbs.FileExists(targetFilepath) || targetFshAbs.IsDir(targetFilepath) {
					http.NotFound(w, r)
					return
				}
				s.servePreview(w, r, targetFsh, targetFilepath)
				return
			} else {
				//Show download page. Do not allow serving

				//Get file size
				fsize, fcount := targetFsh.GetDirctorySizeFromRealPath(fileRuntimeAbsPath, false)

				//Build the tree list of the folder (only if its content is shared)
				treeList := map[string][]File{}
				err = nil
				if shareOption.ShowFileList {
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
				}

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
					"hostname":      s.options.HostName,
					"host":          r.Host,
					"reqid":         id,
					"mime":          "application/x-directory",
					"size":          filesystem.GetFileDisplaySize(fsize, 2),
					"filecount":     strconv.Itoa(fcount),
					"modtime":       timeString,
					"downloadurl":   "../../share/download/" + id,
					"filename":      arozfs.Base(fileRuntimeAbsPath),
					"reqtime":       strconv.Itoa(int(time.Now().Unix())),
					"requri":        "//" + r.Host + r.URL.Path,
					"opg_image":     "/share/opg/" + strconv.Itoa(int(time.Now().Unix())) + "/" + id,
					"treelist":      string(tl),
					"downloaduuid":  id,
					"sharesettings": pageSettingsJSON(shareOption),
				})
				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte("500 - Internal Server Error"))
					return
				}

				w.Header().Set("Content-Type", "text/html; charset=utf-8")
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
				s.servePreview(w, r, targetFsh, fileRuntimeAbsPath)
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
				} else if ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" || metadata.IsRawImageFile(fileRuntimeAbsPath) {
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
					"hostname":      s.options.HostName,
					"host":          r.Host,
					"reqid":         id,
					"requri":        "//" + r.Host + r.URL.Path,
					"mime":          mime,
					"ext":           displayExt,
					"size":          filesystem.GetFileDisplaySize(fsize, 2),
					"modtime":       timeString,
					"downloadurl":   "/share/download/" + id + "/" + arozfs.Base(fileRuntimeAbsPath),
					"preview_url":   "/share/preview/" + id + "/",
					"filename":      arozfs.Base(fileRuntimeAbsPath),
					"opg_image":     "/share/opg/" + strconv.Itoa(int(time.Now().Unix())) + "/" + id,
					"reqtime":       strconv.Itoa(int(time.Now().Unix())),
					"sharesettings": pageSettingsJSON(shareOption),
				}

				for key, value := range data {
					key = "{{" + key + "}}"
					content = []byte(strings.ReplaceAll(string(content), key, value))
				}

				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Write([]byte(content))
				return
			}
		}

	} else {
		//This share not exists
		if directDownload || directServe || prepareZip {
			//Send 404 header
			http.NotFound(w, r)
			return
		} else {
			//Send not found page
			s.serveNotFoundPage(w, r, id)
			return
		}

	}

}

// handleZipStatus returns the current status of an async zip job as JSON.
func (s *Manager) handleZipStatus(w http.ResponseWriter, r *http.Request, jobID string) {
	v, ok := s.zipJobs.Load(jobID)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "job not found"})
		return
	}

	job := v.(*ZipJob)
	job.mu.Lock()
	resp := map[string]interface{}{
		"status":      job.Status,
		"progress":    job.Progress,
		"currentFile": job.CurrentFile,
		"error":       job.Error,
		"filename":    job.Filename,
	}
	job.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleZipDownload serves a completed async zip file.
func (s *Manager) handleZipDownload(w http.ResponseWriter, r *http.Request, jobID string) {
	v, ok := s.zipJobs.Load(jobID)
	if !ok {
		http.NotFound(w, r)
		return
	}

	job := v.(*ZipJob)
	job.mu.Lock()
	status := job.Status
	outputPath := job.OutputPath
	filename := job.Filename
	job.mu.Unlock()

	if status != "done" {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte("202 - Zip operation still in progress"))
		return
	}

	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(filename), "+", "%20"))
	w.Header().Set("Content-Type", "application/zip")
	http.ServeFile(w, r, outputPath)
}

// previewDisposition returns the Content-Disposition header for a file served
// by /share/preview: inline, with the file name (RFC 2231 encoded when it is
// not plain ASCII). It returns "" when no valid header can be built.
func previewDisposition(filename string) string {
	if filename == "" || filename == "." || filename == "/" {
		return ""
	}
	return mime.FormatMediaType("inline", map[string]string{"filename": filename})
}

// servePreview streams a shared file inline for in-browser viewing
func (s *Manager) servePreview(w http.ResponseWriter, r *http.Request, targetFsh *filesystem.FileSystemHandler, fileRuntimeAbsPath string) {
	targetFshAbs := targetFsh.FileSystemAbstraction
	contentType := mime.TypeByExtension(filepath.Ext(fileRuntimeAbsPath))
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	// Name the file for cross-origin readers (e.g. the standalone
	// Office web edition opening a shared .docx), which cannot see
	// the download page. inline keeps in-browser previews working.
	if disposition := previewDisposition(arozfs.Base(fileRuntimeAbsPath)); disposition != "" {
		w.Header().Set("Content-Disposition", disposition)
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
	}
	if metadata.IsRawImageFile(fileRuntimeAbsPath) {
		// Convert RAW image to JPEG for browser display
		jpegData, err := metadata.RenderRAWImage(targetFsh, fileRuntimeAbsPath)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("500 - Failed to render RAW image: " + err.Error()))
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write(jpegData)
	} else if targetFsh.RequireBuffer {
		w.Header().Set("Content-Type", contentType)
		f, err := targetFshAbs.ReadStream(fileRuntimeAbsPath)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("500 - Internal Server Error: " + err.Error()))
			return
		}
		defer f.Close()
		io.Copy(w, f)
	} else {
		w.Header().Set("Content-Type", contentType)
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

// pageSettingsJSON is the share settings the public share pages need, as a
// JSON object literal for the {{sharesettings}} template slot.
func pageSettingsJSON(so *shareEntry.ShareOption) string {
	js, _ := json.Marshal(map[string]interface{}{
		"allowDownload": so.AllowDownload,
		"showFileList":  so.ShowFileList,
		"canUpload":     so.CanUpload(),
		"expireAt":      so.ExpireAt,
	})
	return string(js)
}
