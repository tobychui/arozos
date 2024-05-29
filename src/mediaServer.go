package main

import (
	"net/http"
	"net/url"

	"imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/media/mediaserver"
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
	//Create a media server
	mediaServer = mediaserver.NewMediaServer(&mediaserver.Options{
		BufferPoolSize:      *bufferPoolSize,
		BufferFileMaxSize:   *bufferFileMaxSize,
		EnableFileBuffering: *enable_buffering,
		TmpDirectory:        *tmp_directory,
		Authagent:           authAgent,
		UserHandler:         userHandler,
		Logger:              systemWideLogger,
	})

	//Setup the virtual path resolver
	mediaServer.SetVirtualPathResolver(GetFSHandlerSubpathFromVpath)

	//Register media serving endpoints
	http.HandleFunc("/media/", mediaServer.ServerMedia)
	http.HandleFunc("/media/download/", mediaServer.ServerMedia) //alias for &download=xxx
	http.HandleFunc("/media/getMime/", mediaServer.ServeMediaMime)

	//Check if ffmpeg exists
	ffmpegInstalled, _ := apt.PackageExists("ffmpeg")
	if ffmpegInstalled {
		//ffmpeg installed. allow transcode
		http.HandleFunc("/media/transcode/", mediaServer.ServeVideoWithTranscode)
	} else {
		//ffmpeg not installed. Redirect transcode endpoint back to /media/
		http.HandleFunc("/media/transcode/", func(w http.ResponseWriter, r *http.Request) {
			// Extract the original query parameters
			originalURL := r.URL
			queryParams := originalURL.RawQuery

			// Define the new base URL for redirection
			newBaseURL := "/media/"

			// Parse the new base URL
			newURL, err := url.Parse(newBaseURL)
			if err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			// Append the original query parameters to the new URL
			newURL.RawQuery = queryParams

			// Perform the redirection
			http.Redirect(w, r, newURL.String(), http.StatusFound)
		})
	}

}
