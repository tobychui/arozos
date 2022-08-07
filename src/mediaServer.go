package main

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/common"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/network/gzipmiddleware"
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
	if *enable_gzip {
		http.HandleFunc("/media/", gzipmiddleware.CompressFunc(serverMedia))
		http.HandleFunc("/media/getMime/", gzipmiddleware.CompressFunc(serveMediaMime))
	} else {
		http.HandleFunc("/media/", serverMedia)
		http.HandleFunc("/media/getMime/", serveMediaMime)
	}

	//Download API always bypass gzip no matter if gzip mode is enabled
	http.HandleFunc("/media/download/", serverMedia)
}

//This function validate the incoming media request and return the real path for the targed file
func media_server_validateSourceFile(w http.ResponseWriter, r *http.Request) (string, error) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		return "", errors.New("User not logged in")
	}

	userinfo, _ := userHandler.GetUserInfoFromUsername(username)

	//Validate url valid
	if strings.Count(r.URL.String(), "?") > 1 {
		return "", errors.New("Invalid paramters. Multiple ? found")
	}

	targetfile, _ := common.Mv(r, "file", false)
	targetfile, err = url.QueryUnescape(targetfile)
	if err != nil {
		return "", err
	}
	if targetfile == "" {
		return "", errors.New("Missing paramter 'file'")
	}

	//Translate the virtual directory to realpath
	realFilepath, err := userinfo.VirtualPathToRealPath(targetfile)
	if fs.FileExists(realFilepath) && fs.IsDir(realFilepath) {
		return "", errors.New("Given path is not a file.")
	}
	if err != nil {
		return "", errors.New("Unable to translate the given filepath")
	}

	if !fs.FileExists(realFilepath) {
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
		possibleRealpath, err := userinfo.VirtualPathToRealPath(possibleVirtualFilePath)
		if err != nil {
			log.Println("Error when trying to serve file in compatibility mode", err.Error())
			return "", errors.New("Error when trying to serve file in compatibility mode")
		}
		if fs.FileExists(possibleRealpath) {
			realFilepath = possibleRealpath
			log.Println("[Media Server] Serving file " + filepath.Base(possibleRealpath) + " in compatibility mode. Do not to use '&' or '+' sign in filename! ")
			return realFilepath, nil
		} else {
			return "", errors.New("File not exists")
		}
	}

	return realFilepath, nil
}

func serveMediaMime(w http.ResponseWriter, r *http.Request) {
	realFilepath, err := media_server_validateSourceFile(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	mime := "text/directory"
	if !fs.IsDir(realFilepath) {
		m, _, err := fs.GetMime(realFilepath)
		if err != nil {
			mime = ""
		}
		mime = m
	}

	common.SendTextResponse(w, mime)
}

func serverMedia(w http.ResponseWriter, r *http.Request) {
	//Serve normal media files
	realFilepath, err := media_server_validateSourceFile(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	//Check if downloadMode
	downloadMode := false
	dw, _ := common.Mv(r, "download", false)
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
			common.SendErrorResponse(w, err.Error())
			return
		}
		filename := filepath.Base(escapedRealFilepath)

		/*
			//12 Jul 2022 Update: Deprecated the browser detection logic
			userAgent := r.Header.Get("User-Agent")
			if strings.Contains(userAgent, "Safari/")) {
				//This is Safari. Use speial header
				w.Header().Set("Content-Disposition", "attachment; filename="+filepath.Base(realFilepath))
			} else {
				//Fixing the header issue on Golang url encode lib problems
				w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+filename)
			}
		*/

		w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		w.Header().Set("Content-Type", r.Header.Get("Content-Type"))

		http.ServeFile(w, r, escapedRealFilepath)
	} else {
		http.ServeFile(w, r, realFilepath)
	}

}
