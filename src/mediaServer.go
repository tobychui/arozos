package main

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/compatibility"
	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/utils"
)

/*
Media Server
This function serve large file objects like video and audio file via asynchronize go routine :)

Example usage:
/media/?file=user:/Desktop/test/02.Orchestra- エミール (Addendum version).mp3
/media/?file=user:/Desktop/test/02.Orchestra- エミール (Addendum version).mp3&download=true

This will serve / download the file located at files/users/{username}/Desktop/test/02.Orchestra- エミール (Addendum version).mp3

PLEASE ALWAYS USE URLENCODE IN THE LINK PASSED INTO THE /media ENDPOINT
*/

func mediaServer_init() {
	http.HandleFunc("/media/", serverMedia)
	http.HandleFunc("/media/getMime/", serveMediaMime)
	http.HandleFunc("/media/download/", serverMedia)
}

// This function validate the incoming media request and return fsh, vpath, rpath and err if any
func media_server_validateSourceFile(w http.ResponseWriter, r *http.Request) (*filesystem.FileSystemHandler, string, string, error) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		return nil, "", "", errors.New("User not logged in")
	}

	userinfo, _ := userHandler.GetUserInfoFromUsername(username)

	//Validate url valid
	if strings.Count(r.URL.String(), "?") > 1 {
		return nil, "", "", errors.New("Invalid paramters. Multiple ? found")
	}

	targetfile, _ := utils.GetPara(r, "file")
	targetfile, err = url.QueryUnescape(targetfile)
	if err != nil {
		return nil, "", "", err
	}
	if targetfile == "" {
		return nil, "", "", errors.New("Missing paramter 'file'")
	}

	//Translate the virtual directory to realpath
	fsh, subpath, err := GetFSHandlerSubpathFromVpath(targetfile)
	if err != nil {
		return nil, "", "", errors.New("Unable to load from target file system")
	}
	fshAbs := fsh.FileSystemAbstraction
	realFilepath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if fshAbs.FileExists(realFilepath) && fshAbs.IsDir(realFilepath) {
		return nil, "", "", errors.New("Given path is not a file")
	}
	if err != nil {
		return nil, "", "", errors.New("Unable to translate the given filepath")
	}

	if !fshAbs.FileExists(realFilepath) {
		//Sometime if url is not URL encoded, this error might be shown as well

		//Try to use manual segmentation

		originalURL := r.URL.String()
		//Must be pre-processed with system special URI Decode function to handle edge cases
		originalURL = fs.DecodeURI(originalURL)
		if strings.Contains(originalURL, "&download=true") {
			originalURL = strings.ReplaceAll(originalURL, "&download=true", "")
		} else if strings.Contains(originalURL, "download=true") {
			originalURL = strings.ReplaceAll(originalURL, "download=true", "")
		}
		if strings.Contains(originalURL, "&file=") {
			originalURL = strings.ReplaceAll(originalURL, "&file=", "file=")
		}
		urlInfo := strings.Split(originalURL, "file=")
		possibleVirtualFilePath := urlInfo[len(urlInfo)-1]
		possibleRealpath, err := fshAbs.VirtualPathToRealPath(possibleVirtualFilePath, userinfo.Username)
		if err != nil {
			systemWideLogger.PrintAndLog("Media Server", "Error when trying to serve file in compatibility mode", err)
			return nil, "", "", errors.New("Error when trying to serve file in compatibility mode")
		}
		if fshAbs.FileExists(possibleRealpath) {
			realFilepath = possibleRealpath
			systemWideLogger.PrintAndLog("Media Server", "Serving file "+filepath.Base(possibleRealpath)+" in compatibility mode. Do not to use '&' or '+' sign in filename! ", nil)
			return fsh, targetfile, realFilepath, nil
		} else {
			return nil, "", "", errors.New("File not exists")
		}
	}

	return fsh, targetfile, realFilepath, nil
}

func serveMediaMime(w http.ResponseWriter, r *http.Request) {
	targetFsh, _, realFilepath, err := media_server_validateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	targetFshAbs := targetFsh.FileSystemAbstraction
	if targetFsh.RequireBuffer {
		//File is not on local. Guess its mime by extension
		utils.SendTextResponse(w, "application/"+filepath.Ext(realFilepath)[1:])
		return
	}

	mime := "text/directory"
	if !targetFshAbs.IsDir(realFilepath) {
		m, _, err := fs.GetMime(realFilepath)
		if err != nil {
			mime = ""
		}
		mime = m
	}

	utils.SendTextResponse(w, mime)
}

func serverMedia(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	//Serve normal media files
	targetFsh, vpath, realFilepath, err := media_server_validateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	targetFshAbs := targetFsh.FileSystemAbstraction

	//Check if downloadMode
	downloadMode := false
	dw, _ := utils.GetPara(r, "download")
	if dw == "true" {
		downloadMode = true
	}

	//New download implementations, allow /download to be used instead of &download=true
	if strings.Contains(r.RequestURI, "media/download/?file=") {
		downloadMode = true
	}

	//Serve the file
	if downloadMode {
		escapedRealFilepath, err := url.PathUnescape(realFilepath)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		filename := filepath.Base(escapedRealFilepath)

		w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		w.Header().Set("Content-Type", compatibility.BrowserCompatibilityOverrideContentType(r.UserAgent(), filename, r.Header.Get("Content-Type")))
		if targetFsh.RequireBuffer || !filesystem.FileExists(realFilepath) {
			//Stream it directly from remote
			w.Header().Set("Content-Length", strconv.Itoa(int(targetFshAbs.GetFileSize(realFilepath))))
			remoteStream, err := targetFshAbs.ReadStream(realFilepath)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
				return
			}
			io.Copy(w, remoteStream)
			remoteStream.Close()
		} else {
			http.ServeFile(w, r, escapedRealFilepath)
		}

	} else {
		if targetFsh.RequireBuffer {
			w.Header().Set("Content-Length", strconv.Itoa(int(targetFshAbs.GetFileSize(realFilepath))))
			//Check buffer exists
			ps, _ := targetFsh.GetUniquePathHash(vpath, userinfo.Username)
			buffpool := filepath.Join(*tmp_directory, "fsbuffpool")
			buffFile := filepath.Join(buffpool, ps)
			if fs.FileExists(buffFile) {
				//Stream the buff file if hash matches
				remoteFileHash, err := getHashFromRemoteFile(targetFsh.FileSystemAbstraction, realFilepath)
				if err == nil {
					localFileHash, err := os.ReadFile(buffFile + ".hash")
					if err == nil {
						if string(localFileHash) == remoteFileHash {
							//Hash matches. Serve local buffered file
							http.ServeFile(w, r, buffFile)
							return
						}
					}
				}

			}

			remoteStream, err := targetFshAbs.ReadStream(realFilepath)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
				return
			}
			defer remoteStream.Close()
			io.Copy(w, remoteStream)

			if *enable_buffering {
				os.MkdirAll(buffpool, 0775)
				go func() {
					BufferRemoteFileToTmp(buffFile, targetFsh, realFilepath)
				}()
			}

		} else if !filesystem.FileExists(realFilepath) {
			//Streaming from remote file system that support fseek
			f, err := targetFsh.FileSystemAbstraction.Open(realFilepath)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("500 - Internal Server Error"))
				return
			}
			fstat, _ := f.Stat()
			defer f.Close()
			http.ServeContent(w, r, filepath.Base(realFilepath), fstat.ModTime(), f)
		} else {
			http.ServeFile(w, r, realFilepath)
		}

	}

}

func BufferRemoteFileToTmp(buffFile string, fsh *filesystem.FileSystemHandler, rpath string) error {
	if fs.FileExists(buffFile + ".download") {
		return errors.New("another buffer process running")
	}

	//Generate a stat file for the buffer
	hash, err := getHashFromRemoteFile(fsh.FileSystemAbstraction, rpath)
	if err != nil {
		//Do not buffer
		return err
	}
	os.WriteFile(buffFile+".hash", []byte(hash), 0775)

	//Buffer the file from remote to local
	f, err := fsh.FileSystemAbstraction.ReadStream(rpath)
	if err != nil {
		os.Remove(buffFile + ".hash")
		return err
	}
	defer f.Close()

	dest, err := os.OpenFile(buffFile+".download", os.O_CREATE|os.O_WRONLY, 0775)
	if err != nil {
		os.Remove(buffFile + ".hash")
		return err
	}
	defer dest.Close()

	io.Copy(dest, f)
	f.Close()
	dest.Close()

	os.Rename(buffFile+".download", buffFile)

	//Clean the oldest buffpool item if size too large
	dirsize, _ := fs.GetDirctorySize(filepath.Dir(buffFile), false)
	oldestModtime := time.Now().Unix()
	oldestFile := ""
	for int(dirsize) > *bufferPoolSize<<20 {
		//fmt.Println("CLEARNING BUFF", dirsize)
		files, _ := filepath.Glob(filepath.ToSlash(filepath.Dir(buffFile)) + "/*")
		for _, file := range files {
			if filepath.Ext(file) == ".hash" {
				continue
			}
			thisModTime, _ := fs.GetModTime(file)
			if thisModTime < oldestModtime {
				oldestModtime = thisModTime
				oldestFile = file
			}
		}

		os.Remove(oldestFile)
		os.Remove(oldestFile + ".hash")

		dirsize, _ = fs.GetDirctorySize(filepath.Dir(buffFile), false)
		oldestModtime = time.Now().Unix()
	}
	return nil
}

func getHashFromRemoteFile(fshAbs filesystem.FileSystemAbstraction, rpath string) (string, error) {
	filestat, err := fshAbs.Stat(rpath)
	if err != nil {
		//Always pull from remote
		return "", err
	}

	if filestat.Size() >= int64(*bufferPoolSize<<20) {
		return "", errors.New("Unable to buffer: file larger than buffpool size")
	}

	if filestat.Size() >= int64(*bufferFileMaxSize<<20) {
		return "", errors.New("File larger than max buffer file size")
	}

	statHash := strconv.Itoa(int(filestat.ModTime().Unix() + filestat.Size()))
	hash := md5.Sum([]byte(statHash))
	return hex.EncodeToString(hash[:]), nil
}
