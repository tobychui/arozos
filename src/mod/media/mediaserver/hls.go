package mediaserver

/*
	hls.go

	HLS delivery endpoints for transcoded video.

	This module adds support for HLS based streaming to the media server.

	Two endpoints make up the format:
	  /media/hls/          ?file=<vpath>[&res=][&start=]  -> the .m3u8 playlist
	  /media/hls/segment   ?sid=<session>&name=<segment>  -> one .ts segment

	The playlist request creates (or joins) a transcode session; every segment
	line inside it points back at the segment endpoint carrying that session id.
*/

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/media/transcoder"
	"imuslab.com/arozos/mod/utils"
)

// HLSSegmentEndpoint is the URL path that serves individual segments. It is
// baked into every playlist ffmpeg writes, so it must match the route
// registered in mediaServer.go.
const HLSSegmentEndpoint = "/media/hls/segment"

// transcodeResolutionFromRequest reads the optional "res" parameter.
// An unrecognised value falls back to the source resolution, matching the
// behaviour the MP4 endpoint has always had.
func transcodeResolutionFromRequest(r *http.Request) transcoder.TranscodeOutputResolution {
	resolution, err := utils.GetPara(r, "res")
	if err != nil {
		return transcoder.TranscodeResolution_original
	}
	switch resolution {
	case "1080p":
		return transcoder.TranscodeResolution_1080p
	case "720p":
		return transcoder.TranscodeResolution_720p
	case "360p":
		return transcoder.TranscodeResolution_360p
	}
	return transcoder.TranscodeResolution_original
}

// startTimeFromRequest reads the optional "start" seek offset in seconds.
func startTimeFromRequest(r *http.Request) float64 {
	startTimeStr, _ := utils.GetPara(r, "start")
	if startTimeStr == "" {
		return 0
	}
	startTime, err := strconv.ParseFloat(startTimeStr, 64)
	if err != nil || startTime < 0 {
		return 0
	}
	return startTime
}

// ServeHLSPlaylist starts (or joins) an HLS transcode of the requested file and
// returns its playlist once the first segment is ready.
func (s *Instance) ServeHLSPlaylist(w http.ResponseWriter, r *http.Request) {
	if s.hlsManager == nil {
		utils.SendErrorResponse(w, "HLS output is not available on this host")
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//ValidateSourceFile authenticates the request and resolves the vpath
	sourceFile, ok := s.resolveLocalTranscodeSource(w, r)
	if !ok {
		return
	}

	session, err := s.hlsManager.GetOrCreate(userinfo.Username, sourceFile,
		transcodeResolutionFromRequest(r), startTimeFromRequest(r))
	if err != nil {
		s.options.Logger.PrintAndLog("Media Server", "Unable to start HLS session", err)
		utils.SendErrorResponse(w, "Unable to start HLS transcode")
		return
	}

	if err := session.WaitForPlaylist(transcoder.HLSPlaylistWaitTimeout); err != nil {
		s.options.Logger.PrintAndLog("Media Server", "HLS session produced no playable segment", err)
		utils.SendErrorResponse(w, "Transcode did not produce a playable stream")
		return
	}

	//The playlist grows as the transcode advances, so it must never be cached.
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	http.ServeFile(w, r, session.PlaylistPath())
}

// ServeHLSSegment serves one segment of a running HLS session. Segments are
// readable only by the user whose session produced them.
func (s *Instance) ServeHLSSegment(w http.ResponseWriter, r *http.Request) {
	if s.hlsManager == nil {
		http.Error(w, "HLS output is not available on this host", http.StatusNotFound)
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		http.Error(w, "User not logged in", http.StatusUnauthorized)
		return
	}

	sessionID, err := utils.GetPara(r, "sid")
	if err != nil {
		http.Error(w, "Missing parameter 'sid'", http.StatusBadRequest)
		return
	}
	segmentName, err := utils.GetPara(r, "name")
	if err != nil {
		http.Error(w, "Missing parameter 'name'", http.StatusBadRequest)
		return
	}

	session := s.hlsManager.Session(sessionID)
	if session == nil {
		//Either a stale playlist from a reaped session, or a guessed id
		http.Error(w, "No such HLS session", http.StatusNotFound)
		return
	}
	if session.Owner != userinfo.Username {
		http.Error(w, "Permission Denied", http.StatusForbidden)
		return
	}

	segmentPath, err := session.SegmentPath(segmentName)
	if err != nil {
		http.Error(w, "Invalid segment name", http.StatusBadRequest)
		return
	}

	//A segment never changes once the playlist lists it, so it is safe to cache
	//for the lifetime of the session.
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, segmentPath)
}

// resolveLocalTranscodeSource validates the request and returns an absolute
// path to the source file on local disk. ffmpeg cannot read a remote file
// system directly, so a file living on one is buffered locally first (reusing
// an existing buffer when its hash still matches).
//
// It writes the error response itself and returns ok=false when the file cannot
// be made available.
func (s *Instance) resolveLocalTranscodeSource(w http.ResponseWriter, r *http.Request) (string, bool) {
	userinfo, _ := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	targetFsh, vpath, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return "", false
	}

	if filesystem.FileExists(realFilepath) {
		//Already on the local file system
		absPath, err := filepath.Abs(realFilepath)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return "", false
		}
		return absPath, true
	}

	//Remote file system: reuse the local buffer when it is still current
	ps, _ := targetFsh.GetUniquePathHash(vpath, userinfo.Username)
	buffpool := filepath.Join(s.options.TmpDirectory, "fsbuffpool")
	buffFile := filepath.Join(buffpool, ps)
	if fs.FileExists(buffFile) {
		remoteFileHash, err := s.GetHashFromRemoteFile(targetFsh.FileSystemAbstraction, realFilepath)
		if err == nil {
			localFileHash, err := os.ReadFile(buffFile + ".hash")
			if err == nil && string(localFileHash) == remoteFileHash {
				buffFileAbs, _ := filepath.Abs(buffFile)
				return buffFileAbs, true
			}
		}
	}

	if !s.options.EnableFileBuffering {
		utils.SendErrorResponse(w, "unable to transcode remote file with file buffer disabled")
		return "", false
	}

	os.MkdirAll(buffpool, 0775)
	s.options.Logger.PrintAndLog("Media Server", "Buffering video from remote file system handler (might take a while)", nil)
	if err := s.BufferRemoteFileToTmp(buffFile, targetFsh, realFilepath); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return "", false
	}

	buffFileAbs, _ := filepath.Abs(buffFile)
	return buffFileAbs, true
}
