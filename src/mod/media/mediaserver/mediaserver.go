package mediaserver

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/compatibility"
	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/media/transcoder"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	Media Server

	This script handle serving of media file types and abstractize the
	legacy media.go file

	author: tobychui 2024
*/

type Options struct {
	BufferPoolSize      int    //Buffer pool size for all media files buffered in this host
	BufferFileMaxSize   int    //Max size per file in buffer pool
	EnableFileBuffering bool   //Allow remote file system to buffer files to this host tmp folder for faster access
	TmpDirectory        string //Directory to store the buffer pool. will create a folder named "fsbuffpool" inside the given path

	Authagent   *auth.AuthAgent
	UserHandler *user.UserHandler
	Logger      *logger.Logger
}

type Instance struct {
	options             *Options
	VirtualPathResolver func(string) (*fs.FileSystemHandler, string, error) //Virtual path to File system handler resolver, must be provided externally
}

// Initialize a new media server instance
func NewMediaServer(options *Options) *Instance {
	return &Instance{
		options: options,
		VirtualPathResolver: func(s string) (*fs.FileSystemHandler, string, error) {
			return nil, "", errors.New("no virtual path resolver assigned")
		},
	}
}

// Set the virtual path resolver for this media instance
func (s *Instance) SetVirtualPathResolver(resolver func(string) (*fs.FileSystemHandler, string, error)) {
	s.VirtualPathResolver = resolver
}

// This function validate the incoming media request and return fsh, vpath, rpath and err if any
func (s *Instance) ValidateSourceFile(w http.ResponseWriter, r *http.Request) (*filesystem.FileSystemHandler, string, string, error) {
	username, err := s.options.Authagent.GetUserName(w, r)
	if err != nil {
		return nil, "", "", errors.New("User not logged in")
	}

	userinfo, _ := s.options.UserHandler.GetUserInfoFromUsername(username)

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
	fsh, subpath, err := s.VirtualPathResolver(targetfile)
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
			s.options.Logger.PrintAndLog("Media Server", "Error when trying to serve file in compatibility mode", err)
			return nil, "", "", errors.New("Error when trying to serve file in compatibility mode")
		}
		if fshAbs.FileExists(possibleRealpath) {
			realFilepath = possibleRealpath
			s.options.Logger.PrintAndLog("Media Server", "Serving file "+filepath.Base(possibleRealpath)+" in compatibility mode. Do not to use '&' or '+' sign in filename! ", nil)
			return fsh, targetfile, realFilepath, nil
		} else {
			return nil, "", "", errors.New("File not exists")
		}
	}

	return fsh, targetfile, realFilepath, nil
}

func (s *Instance) ServeMediaMime(w http.ResponseWriter, r *http.Request) {
	targetFsh, _, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	// RAW images are served as JPEG
	if metadata.IsRawImageFile(realFilepath) {
		utils.SendTextResponse(w, "image/jpeg")
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

// Serve any media from any file system handler to client
func (s *Instance) ServerMedia(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	//Serve normal media files
	targetFsh, vpath, realFilepath, err := s.ValidateSourceFile(w, r)
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

	// Check if nocache mode
	nocacheMode, _ := utils.GetBool(r, "nocache")

	//New download implementations, allow /download to be used instead of &download=true
	if strings.Contains(r.RequestURI, "media/download/?file=") {
		downloadMode = true
	}

	// Check if this is a RAW image file and render it as JPEG (preview only, not download)
	if !downloadMode && metadata.IsRawImageFile(realFilepath) {
		jpegData, err := metadata.RenderRAWImage(targetFsh, realFilepath)
		if err != nil {
			// If RAW rendering fails, fall back to serving the raw file
			s.options.Logger.PrintAndLog("Media Server", "Failed to render RAW image: "+err.Error(), nil)
		} else {
			// Successfully rendered RAW image, serve as JPEG
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Content-Length", strconv.Itoa(len(jpegData)))
			w.Write(jpegData)
			return
		}
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
		if nocacheMode {
			// Add no-cache headers to prevent browser caching, useful for development and testing
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}
		if targetFsh.RequireBuffer {
			w.Header().Set("Content-Length", strconv.Itoa(int(targetFshAbs.GetFileSize(realFilepath))))
			//Check buffer exists
			ps, _ := targetFsh.GetUniquePathHash(vpath, userinfo.Username)
			buffpool := filepath.Join(s.options.TmpDirectory, "fsbuffpool")
			buffFile := filepath.Join(buffpool, ps)
			if fs.FileExists(buffFile) {
				//Stream the buff file if hash matches
				remoteFileHash, err := s.GetHashFromRemoteFile(targetFsh.FileSystemAbstraction, realFilepath)
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

			if s.options.EnableFileBuffering {
				os.MkdirAll(buffpool, 0775)
				go func() {
					s.BufferRemoteFileToTmp(buffFile, targetFsh, realFilepath)
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

// Serve video file with real-time transcoder
func (s *Instance) ServeVideoWithTranscode(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	//Serve normal media files
	targetFsh, vpath, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	resolution, err := utils.GetPara(r, "res")
	if err != nil {
		resolution = ""
	}

	transcodeOutputResolution := transcoder.TranscodeResolution_original
	if resolution == "1080p" {
		transcodeOutputResolution = transcoder.TranscodeResolution_1080p
	} else if resolution == "720p" {
		transcodeOutputResolution = transcoder.TranscodeResolution_720p
	} else if resolution == "360p" {
		transcodeOutputResolution = transcoder.TranscodeResolution_360p
	}

	var startTime float64
	if startTimeStr, _ := utils.GetPara(r, "start"); startTimeStr != "" {
		startTime, _ = strconv.ParseFloat(startTimeStr, 64)
	}

	//TODO: Cleanup unused code
	//targetFshAbs := targetFsh.FileSystemAbstraction
	transcodeSourceFile := realFilepath
	if filesystem.FileExists(transcodeSourceFile) {
		//This is a file from the local file system.
		//Stream it out with transcoder
		transcodeSrcFileAbsPath, err := filepath.Abs(realFilepath)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		transcoder.TranscodeAndStream(w, r, transcodeSrcFileAbsPath, transcodeOutputResolution, startTime)
		return
	} else {
		//This file is from a remote file system. Check if it already has a local buffer
		ps, _ := targetFsh.GetUniquePathHash(vpath, userinfo.Username)
		buffpool := filepath.Join(s.options.TmpDirectory, "fsbuffpool")
		buffFile := filepath.Join(buffpool, ps)
		if fs.FileExists(buffFile) {
			//Stream the buff file if hash matches
			remoteFileHash, err := s.GetHashFromRemoteFile(targetFsh.FileSystemAbstraction, realFilepath)
			if err == nil {
				localFileHash, err := os.ReadFile(buffFile + ".hash")
				if err == nil {
					if string(localFileHash) == remoteFileHash {
						//Hash matches. Serve local buffered file
						buffFileAbs, _ := filepath.Abs(buffFile)
						transcoder.TranscodeAndStream(w, r, buffFileAbs, transcodeOutputResolution, startTime)
						return
					}
				}
			}
		}

		//Buffer file not exists. Buffer it to local now
		if s.options.EnableFileBuffering {
			os.MkdirAll(buffpool, 0775)
			s.options.Logger.PrintAndLog("Media Server", "Buffering video from remote file system handler (might take a while)", nil)
			err = s.BufferRemoteFileToTmp(buffFile, targetFsh, realFilepath)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
				return
			}

			//Buffer completed. Start transcode
			buffFileAbs, _ := filepath.Abs(buffFile)
			transcoder.TranscodeAndStream(w, r, buffFileAbs, transcodeOutputResolution, startTime)
			return
		} else {
			utils.SendErrorResponse(w, "unable to transcode remote file with file buffer disabled")
			return
		}
	}

	//Check if it is a remote file system. FFmpeg can only works with local files
	//if the file is from a remote source, buffer it to local before transcoding.
	/*
		if targetFsh.RequireBuffer {
			w.Header().Set("Content-Length", strconv.Itoa(int(targetFshAbs.GetFileSize(realFilepath))))

			remoteStream, err := targetFshAbs.ReadStream(realFilepath)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
				return
			}
			defer remoteStream.Close()
			io.Copy(w, remoteStream)

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
	*/
}

func (s *Instance) BufferRemoteFileToTmp(buffFile string, fsh *filesystem.FileSystemHandler, rpath string) error {
	if fs.FileExists(buffFile + ".download") {
		return errors.New("another buffer process running")
	}

	//Generate a stat file for the buffer
	hash, err := s.GetHashFromRemoteFile(fsh.FileSystemAbstraction, rpath)
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
	for int(dirsize) > s.options.BufferPoolSize<<20 {
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

func (s *Instance) GetHashFromRemoteFile(fshAbs filesystem.FileSystemAbstraction, rpath string) (string, error) {
	filestat, err := fshAbs.Stat(rpath)
	if err != nil {
		//Always pull from remote
		return "", err
	}

	if filestat.Size() >= int64(s.options.BufferPoolSize<<20) {
		return "", errors.New("Unable to buffer: file larger than buffpool size")
	}

	if filestat.Size() >= int64(s.options.BufferFileMaxSize<<20) {
		return "", errors.New("File larger than max buffer file size")
	}

	statHash := strconv.Itoa(int(filestat.ModTime().Unix() + filestat.Size()))
	hash := md5.Sum([]byte(statHash))
	return hex.EncodeToString(hash[:]), nil
}

// Serve audio file with real-time transcoder, supporting seeking via &start= parameter
func (s *Instance) ServeAudioWithTranscode(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	targetFsh, vpath, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	// Parse sample rate (default 48000)
	sampleRateStr, _ := utils.GetPara(r, "samplerate")
	sampleRateInt, _ := strconv.Atoi(sampleRateStr)
	var sampleRate transcoder.TranscodeAudioSampleRate
	switch sampleRateInt {
	case 16000:
		sampleRate = transcoder.TranscodeAudio_16kHz
	case 24000:
		sampleRate = transcoder.TranscodeAudio_24kHz
	default:
		sampleRate = transcoder.TranscodeAudio_48kHz
	}

	// Parse start time for seeking (default 0)
	startStr, _ := utils.GetPara(r, "start")
	startTime, _ := strconv.ParseFloat(startStr, 64)

	if filesystem.FileExists(realFilepath) {
		absPath, err := filepath.Abs(realFilepath)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		transcoder.TranscodeAndStreamAudio(w, r, absPath, sampleRate, startTime)
		return
	}

	// Remote file: try local buffer first, then download and transcode
	ps, _ := targetFsh.GetUniquePathHash(vpath, userinfo.Username)
	buffpool := filepath.Join(s.options.TmpDirectory, "fsbuffpool")
	buffFile := filepath.Join(buffpool, ps)
	if fs.FileExists(buffFile) {
		remoteFileHash, err := s.GetHashFromRemoteFile(targetFsh.FileSystemAbstraction, realFilepath)
		if err == nil {
			localFileHash, err := os.ReadFile(buffFile + ".hash")
			if err == nil && string(localFileHash) == remoteFileHash {
				buffFileAbs, _ := filepath.Abs(buffFile)
				transcoder.TranscodeAndStreamAudio(w, r, buffFileAbs, sampleRate, startTime)
				return
			}
		}
	}

	if !s.options.EnableFileBuffering {
		utils.SendErrorResponse(w, "unable to transcode remote file with file buffer disabled")
		return
	}

	os.MkdirAll(buffpool, 0775)
	s.options.Logger.PrintAndLog("Media Server", "Buffering audio from remote file system for transcode", nil)
	if err := s.BufferRemoteFileToTmp(buffFile, targetFsh, realFilepath); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	buffFileAbs, _ := filepath.Abs(buffFile)
	transcoder.TranscodeAndStreamAudio(w, r, buffFileAbs, sampleRate, startTime)
}

// GetAudioDuration returns the duration of a local audio file in seconds using ffprobe
func (s *Instance) GetAudioDuration(w http.ResponseWriter, r *http.Request) {
	targetFsh, _, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if targetFsh.RequireBuffer || !filesystem.FileExists(realFilepath) {
		js, _ := json.Marshal(map[string]interface{}{"duration": 0, "error": "remote file"})
		w.Header().Set("Content-Type", "application/json")
		w.Write(js)
		return
	}

	duration, err := transcoder.GetAudioDuration(realFilepath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(map[string]float64{"duration": duration})
	w.Header().Set("Content-Type", "application/json")
	w.Write(js)
}
