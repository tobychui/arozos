package main

import (
	"net/http"
	"path/filepath"
	"net/url"
	"log"
	"strings"
	"errors"

	fs "imuslab.com/aroz_online/mod/filesystem"
)

/*
Media Server
This function serve large file objects like video and audio file via asynchronize go routine :)

Example usage:
/media/?file=user:/Desktop/test/02.Orchestra- エミール (Addendum version).mp3
/media/?file=user:/Desktop/test/02.Orchestra- エミール (Addendum version).mp3&download=true

This will serve / download the file located at files/users/{username}/Desktop/test/02.Orchestra- エミール (Addendum version).mp3

>>> PLEASE ALWAYS USE URLENCODE IN THE LINK PASSED INTO THE /media ENDPOINT <<<
*/

func mediaServer_init(){
	http.HandleFunc("/media/", serverMedia);
	http.HandleFunc("/media/getMime/", serveMediaMime);
}

//This function validate the incoming media request and return the real path for the targed file
func media_server_validateSourceFile(w http.ResponseWriter, r *http.Request) (string, error){
	username, err := authAgent.GetUserName(w,r);
	if (err != nil){
		return "", errors.New("User not logged in");
	}

	userinfo, _ := userHandler.GetUserInfoFromUsername(username);

	//Validate url valid
	if (strings.Count(r.URL.String(), "?") > 1){
		return "", errors.New("Invalid paramters. Multiple ? found")
	}
	
	targetfile, _ := mv(r,"file",false)
	targetfile, _ = url.QueryUnescape(targetfile)
	if (targetfile == ""){
		return "", errors.New("Missing paramter 'file'");
	}

	//Translate the virtual directory to realpath
	realFilepath, err := userinfo.VirtualPathToRealPath(targetfile);
	if (fileExists(realFilepath) && IsDir(realFilepath)){
		return "", errors.New("Given path is not a file.")
	}
	if (err != nil){
		return "", errors.New("Unable to translate the given filepath")
	}

	if (!fileExists(realFilepath)){
		//Sometime if url is not URL encoded, this error might be shown as well

		//Try to use manual segmentation

		originalURL := r.URL.String();
		//Must be pre-processed with system special URI Decode function to handle edge cases
		originalURL = fs.DecodeURI(originalURL);
		if (strings.Contains(originalURL, "&download=true")){
			originalURL = strings.ReplaceAll(originalURL, "&download=true", "")
		}else if (strings.Contains(originalURL, "download=true")){
			originalURL = strings.ReplaceAll(originalURL, "download=true", "")
		}
		if (strings.Contains(originalURL, "&file=")){
			originalURL = strings.ReplaceAll(originalURL, "&file=", "file=")
		}
		urlInfo := strings.Split(originalURL, "file=")
		possibleVirtualFilePath := urlInfo[len(urlInfo) - 1]
		possibleRealpath, err := userinfo.VirtualPathToRealPath(possibleVirtualFilePath);
		if (err != nil){
			log.Println("Error when trying to serve file in compatibility mode", err.Error());
			return "", errors.New("Error when trying to serve file in compatibility mode");
		}
		if (fileExists(possibleRealpath)){
			realFilepath = possibleRealpath;
			log.Println("[Media Server] Serving file " + filepath.Base(possibleRealpath) + " in compatibility mode. Do not to use '&' or '+' sign in filename! ")
			return realFilepath, nil
		}else{
			return "", errors.New("File not exists")
		}
	}
	
	return realFilepath, nil
}

func serveMediaMime(w http.ResponseWriter, r *http.Request){
	realFilepath, err := media_server_validateSourceFile(w,r)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}
	mime := "text/directory"
	if !IsDir(realFilepath){
		m, _, err := fs.GetMime(realFilepath)
		if (err != nil){
			mime = ""
		}
		mime = m
	}

	sendTextResponse(w, mime);
}


func serverMedia(w http.ResponseWriter, r *http.Request) {
	//Serve normal media files
	realFilepath, err := media_server_validateSourceFile(w,r)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}

	//Check if downloadMode
	downloadMode := false
	dw, _ := mv(r, "download",false)
	if (dw == "true"){
		downloadMode = true;
	}

	//Serve the file
	if (downloadMode){
		//Fixing the header issue on Golang url encode lib problems
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''" + strings.ReplaceAll(url.QueryEscape(filepath.Base(realFilepath)),"+","%20"))
		w.Header().Set("Content-Type", r.Header.Get("Content-Type"))
	}

	http.ServeFile(w, r, realFilepath)
}
