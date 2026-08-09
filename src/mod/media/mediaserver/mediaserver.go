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
	"sync"
	"time"

	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/compatibility"
	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	hidden "imuslab.com/arozos/mod/filesystem/hidden"
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
	hlsManager          *transcoder.HLSManager                              //Manages live HLS transcode sessions; nil if it could not be started
}

// Initialize a new media server instance
func NewMediaServer(options *Options) *Instance {
	instance := &Instance{
		options: options,
		VirtualPathResolver: func(s string) (*fs.FileSystemHandler, string, error) {
			return nil, "", errors.New("no virtual path resolver assigned")
		},
	}

	//Prepare the HLS session store. A failure here only disables HLS output;
	//the MP4 transcode path keeps working.
	hlsManager, err := transcoder.NewHLSManager(options.TmpDirectory, HLSSegmentEndpoint)
	if err != nil {
		options.Logger.PrintAndLog("Media Server", "Unable to initiate HLS session store, HLS output disabled", err)
	} else {
		instance.hlsManager = hlsManager
	}

	return instance
}

// Close releases the resources held by this media server, stopping any running
// HLS transcode and removing its working directory.
func (s *Instance) Close() {
	if s.hlsManager != nil {
		s.hlsManager.Close()
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
	//Resolve to a local file first; ffmpeg cannot read a remote file system
	sourceFile, ok := s.resolveLocalTranscodeSource(w, r)
	if !ok {
		return
	}

	transcoder.TranscodeAndStream(w, r, sourceFile,
		transcodeResolutionFromRequest(r), startTimeFromRequest(r))

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

// ServeEmbeddedSubtitles exposes the subtitle tracks and font attachments muxed
// inside a container (typically MKV).
//
//	?file=<vpath>            -> JSON listing of tracks and fonts
//	?file=<vpath>&track=<n>  -> that subtitle track, converted to SubRip
//	?file=<vpath>&font=<n>   -> that font attachment, as binary
//
// Nothing is cached: subtitle and font streams are small and extraction is
// quick relative to the container scan, so a cache would mostly add staleness.
func (s *Instance) ServeEmbeddedSubtitles(w http.ResponseWriter, r *http.Request) {
	targetFsh, _, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	// Native check on purpose: ffmpeg has to read the container directly, and
	// buffering a remote file in full just to read its subtitles is not worth it.
	if targetFsh.RequireBuffer || !filesystem.FileExists(realFilepath) {
		utils.SendErrorResponse(w, "embedded subtitles not supported for this file system")
		return
	}

	if fontParam := r.FormValue("font"); fontParam != "" {
		s.serveEmbeddedFont(w, realFilepath, fontParam)
		return
	}
	if trackParam := r.FormValue("track"); trackParam != "" {
		s.serveEmbeddedSubtitleTrack(w, r, realFilepath, trackParam)
		return
	}

	info, err := transcoder.ProbeEmbeddedTracksWithFontNames(realFilepath, s.options.TmpDirectory)
	if err != nil {
		utils.SendErrorResponse(w, "could not read embedded tracks")
		return
	}

	js, _ := json.Marshal(info)
	w.Header().Set("Content-Type", "application/json")
	w.Write(js)
}

// serveEmbeddedSubtitleTrack returns one track, either converted to SubRip or —
// with &format=ass — copied out in its native form so the player can render the
// original styling, positioning and layering.
func (s *Instance) serveEmbeddedSubtitleTrack(w http.ResponseWriter, r *http.Request, realFilepath string, trackParam string) {
	streamIndex, err := strconv.Atoi(trackParam)
	if err != nil || streamIndex < 0 {
		utils.SendErrorResponse(w, "invalid subtitle track index")
		return
	}

	var payload []byte
	if r.FormValue("format") == "ass" {
		payload, err = transcoder.ExtractRawSubtitleTrack(realFilepath, streamIndex, "ass")
	} else {
		payload, err = transcoder.ExtractSubtitleTrack(realFilepath, streamIndex)
	}
	if err != nil {
		s.options.Logger.PrintAndLog("Subtitle",
			"extraction failed for "+filepath.Base(realFilepath), err)
		utils.SendErrorResponse(w, "could not extract subtitle track")
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Write(payload)
}

// serveEmbeddedFont returns one font attachment so the player can register it
// with @font-face and render subtitles in the typeface the release shipped.
func (s *Instance) serveEmbeddedFont(w http.ResponseWriter, realFilepath string, fontParam string) {
	fontIndex, err := strconv.Atoi(fontParam)
	if err != nil || fontIndex < 0 {
		utils.SendErrorResponse(w, "invalid font attachment index")
		return
	}

	data, err := transcoder.ExtractFontAttachment(realFilepath, fontIndex, s.options.TmpDirectory)
	if err != nil {
		s.options.Logger.PrintAndLog("Subtitle",
			"font extraction failed for "+filepath.Base(realFilepath), err)
		utils.SendErrorResponse(w, "could not extract font attachment")
		return
	}

	w.Header().Set("Content-Type", "font/ttf")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(data)
}

// storyboardLocks serialises generation per source file so that several viewers
// opening the same video cannot each start their own ffmpeg pass.
var storyboardLocks sync.Map

// ServeStoryboard serves the scrub-preview storyboard for a video.
//
//	?file=<vpath>            -> JSON layout describing the sheet
//	?file=<vpath>&image=1    -> the tiled JPEG itself
//
// The sheet is cached beside the video inside the same file system abstraction,
// under <video folder>/.metadata/.storyboard/, so it travels with the media and
// is discarded along with the folder it belongs to. The ffmpeg cost is therefore
// paid once per video, not once per session.
func (s *Instance) ServeStoryboard(w http.ResponseWriter, r *http.Request) {
	targetFsh, _, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	// Deliberately a native existence check, not an abstraction one: this asks
	// whether ffmpeg can *read* the source directly. A remote-backed video would
	// have to be buffered to local disk in full first, which is far too
	// expensive to do just for hover previews. The generated sheet is a separate
	// matter and is always stored back through the abstraction below.
	if targetFsh.RequireBuffer || !filesystem.FileExists(realFilepath) {
		utils.SendErrorResponse(w, "storyboard not supported for this file system")
		return
	}
	if targetFsh.ReadOnly {
		utils.SendErrorResponse(w, "storyboard cache not writable on a read only file system")
		return
	}

	fshAbs := targetFsh.FileSystemAbstraction
	cacheFolder := transcoder.StoryboardCacheFolder(realFilepath)
	basename := filepath.Base(realFilepath)
	imagePath := cacheFolder + basename + ".jpg"
	metaPath := cacheFolder + basename + ".json"

	layout, err := s.ensureStoryboard(targetFsh, realFilepath, cacheFolder, imagePath, metaPath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if r.FormValue("image") != "" {
		stream, err := fshAbs.ReadStream(imagePath)
		if err != nil {
			utils.SendErrorResponse(w, "storyboard image unavailable")
			return
		}
		defer stream.Close()
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		io.Copy(w, stream)
		return
	}

	js, _ := json.Marshal(layout)
	w.Header().Set("Content-Type", "application/json")
	w.Write(js)
}

// ensureStoryboard returns the cached layout for a video, rendering the sheet
// first if it is missing or out of date.
func (s *Instance) ensureStoryboard(fsh *filesystem.FileSystemHandler, realFilepath string, cacheFolder string, imagePath string, metaPath string) (*transcoder.StoryboardLayout, error) {
	fshAbs := fsh.FileSystemAbstraction

	if layout := readStoryboardMeta(fshAbs, realFilepath, imagePath, metaPath); layout != nil {
		return layout, nil
	}

	lockAny, _ := storyboardLocks.LoadOrStore(imagePath, &sync.Mutex{})
	lock := lockAny.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	defer storyboardLocks.Delete(imagePath)

	// Another request may have finished generating while we waited for the lock.
	if layout := readStoryboardMeta(fshAbs, realFilepath, imagePath, metaPath); layout != nil {
		return layout, nil
	}

	if err := fshAbs.MkdirAll(cacheFolder, 0755); err != nil {
		return nil, errors.New("could not create storyboard cache folder")
	}
	// Keep the metadata folders out of the way in file listings, as the
	// thumbnail cache does.
	hidden.HideFile(filepath.Dir(filepath.Clean(cacheFolder)))
	hidden.HideFile(cacheFolder)

	duration, err := transcoder.GetAudioDuration(realFilepath)
	if err != nil || duration <= 0 {
		return nil, errors.New("could not determine media duration")
	}

	// ffmpeg renders into local scratch space and hands the bytes back, so the
	// sheet can be stored through the abstraction that owns the video rather
	// than written to whatever native path happens to match. Without this a
	// remote-backed video would leave its cache stranded in the local tmp dir.
	sheet, layout, err := transcoder.GenerateStoryboard(realFilepath, s.options.TmpDirectory, duration)
	if err != nil {
		s.options.Logger.PrintAndLog("Storyboard", "generation failed for "+filepath.Base(realFilepath), err)
		return nil, errors.New("storyboard generation failed")
	}

	if err := fshAbs.WriteFile(imagePath, sheet, 0644); err != nil {
		s.options.Logger.PrintAndLog("Storyboard", "could not store sheet for "+filepath.Base(realFilepath), err)
		return nil, errors.New("could not store storyboard")
	}

	// Written after the sheet so a reader never finds metadata without an image.
	if js, err := json.Marshal(layout); err == nil {
		if err := fshAbs.WriteFile(metaPath, js, 0644); err != nil {
			s.options.Logger.PrintAndLog("Storyboard", "could not store layout for "+filepath.Base(realFilepath), err)
		}
	}
	return &layout, nil
}

// readStoryboardMeta loads a cached layout, treating a missing, unreadable or
// stale cache as a miss. A sheet is stale once the video has been modified more
// recently than the sheet itself, so a re-encode re-renders the previews.
func readStoryboardMeta(fshAbs filesystem.FileSystemAbstraction, realFilepath string, imagePath string, metaPath string) *transcoder.StoryboardLayout {
	if !fshAbs.FileExists(imagePath) || !fshAbs.FileExists(metaPath) {
		return nil
	}

	videoModTime, videoErr := fshAbs.GetModTime(realFilepath)
	sheetModTime, sheetErr := fshAbs.GetModTime(imagePath)
	if videoErr == nil && sheetErr == nil && videoModTime > sheetModTime {
		return nil
	}

	raw, err := fshAbs.ReadFile(metaPath)
	if err != nil {
		return nil
	}
	var layout transcoder.StoryboardLayout
	if err := json.Unmarshal(raw, &layout); err != nil {
		return nil
	}
	if layout.Interval <= 0 || layout.Count <= 0 || layout.TileWidth <= 0 || layout.TileHeight <= 0 {
		return nil
	}
	return &layout
}
