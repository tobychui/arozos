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
	"encoding/json"
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

// clientIDFromRequest reads the optional "client" parameter identifying the
// player. It lets a seek retire the transcode it replaces instead of leaving it
// running (see transcoder.HLSManager.GetOrCreate); an absent id is not an
// error, only a less precise answer to "which transcode is this replacing".
func clientIDFromRequest(r *http.Request) string {
	clientID, err := utils.GetPara(r, "client")
	if err != nil {
		return ""
	}
	//Only ever compared for equality, so anything unexpected can simply be
	//dropped rather than sanitised.
	if len(clientID) > 64 {
		return ""
	}
	for _, c := range clientID {
		if !(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '-' && c != '_' {
			return ""
		}
	}
	return clientID
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

// ServeMediaProbe reports the codecs a file contains and whether a mainstream
// browser can play it without transcoding.
//
// The player needs this because a container extension says nothing about
// decodability: an .mp4 holding HEVC or 10-bit H.264 looks directly playable
// and then fails with a bare decode error.
func (s *Instance) ServeMediaProbe(w http.ResponseWriter, r *http.Request) {
	targetFsh, _, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Native check on purpose: ffprobe has to read the file directly, and
	//buffering a remote file in full just to read its header is not worth it.
	if targetFsh.RequireBuffer || !filesystem.FileExists(realFilepath) {
		utils.SendErrorResponse(w, "codec probe not supported for this file system")
		return
	}

	info, err := transcoder.ProbeMediaCodecs(realFilepath)
	if err != nil {
		s.options.Logger.PrintAndLog("Media Server",
			"Codec probe failed for "+filepath.Base(realFilepath), err)
		utils.SendErrorResponse(w, "could not probe media codecs")
		return
	}

	js, _ := json.Marshal(info)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Write(js)
}

// ServeHLSPlaylist starts (or joins) an HLS transcode of the requested file and
// returns its playlist once the first segment is ready.
func (s *Instance) ServeHLSPlaylist(w http.ResponseWriter, r *http.Request) {
	//Errors here are reported with an HTTP status rather than a JSON body: the
	//caller is a <video> element or an HLS player, and a 200 carrying JSON is
	//indistinguishable to it from a playlist it cannot parse - which surfaces to
	//the viewer as a bare "cannot play this format" with the real reason lost.
	if s.hlsManager == nil {
		http.Error(w, "HLS output is not available on this host", http.StatusNotImplemented)
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		http.Error(w, "User not logged in", http.StatusUnauthorized)
		return
	}

	//ValidateSourceFile authenticates the request and resolves the vpath
	sourceFile, ok := s.resolveLocalTranscodeSource(w, r)
	if !ok {
		return
	}

	session, err := s.hlsManager.GetOrCreate(userinfo.Username, clientIDFromRequest(r), sourceFile,
		transcodeResolutionFromRequest(r), startTimeFromRequest(r))
	if err != nil {
		s.options.Logger.PrintAndLog("Media Server", "Unable to start HLS session", err)
		http.Error(w, "Unable to start HLS transcode", http.StatusInternalServerError)
		return
	}

	if err := session.WaitForPlaylist(transcoder.HLSPlaylistWaitTimeout); err != nil {
		//ffmpeg's own last words explain a failed transcode - a seek past the
		//end of the file, an unreadable stream - and nothing else does.
		if tail := session.StderrTail(); tail != "" {
			s.options.Logger.PrintAndLog("Media Server", "HLS transcode output: "+tail, nil)
		}
		s.options.Logger.PrintAndLog("Media Server", "HLS session produced no playable segment", err)
		http.Error(w, "Transcode did not produce a playable stream", http.StatusServiceUnavailable)
		return
	}

	//Served from memory rather than with ServeFile because the init segment URI
	//has to be rewritten onto the segment endpoint before the client sees it.
	playlist, err := s.hlsManager.ReadPlaylist(session)
	if err != nil {
		s.options.Logger.PrintAndLog("Media Server", "Unable to read HLS playlist", err)
		http.Error(w, "Unable to read the transcode playlist", http.StatusInternalServerError)
		return
	}

	//The playlist grows as the transcode advances, so it must never be cached.
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write(playlist)
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
	//for the lifetime of the session. Segments are fragmented MP4 (including the
	//init segment), which is what MediaSource can append without demuxing.
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, segmentPath)
}

// resolveLocalTranscodeSource validates the request and returns an absolute
// path to the source file on local disk. ffmpeg cannot read a remote file
// system directly, so a file living on one is buffered locally first (reusing
// an existing buffer when its hash still matches).
//
// It writes the error response itself and returns ok=false when the file cannot
// be made available. Like the endpoints it serves, it answers with an HTTP
// status rather than a JSON body, since the caller is always a media element.
func (s *Instance) resolveLocalTranscodeSource(w http.ResponseWriter, r *http.Request) (string, bool) {
	userinfo, _ := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	targetFsh, vpath, realFilepath, err := s.ValidateSourceFile(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return "", false
	}

	if filesystem.FileExists(realFilepath) {
		//Already on the local file system
		absPath, err := filepath.Abs(realFilepath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, "unable to transcode remote file with file buffer disabled", http.StatusNotImplemented)
		return "", false
	}

	os.MkdirAll(buffpool, 0775)
	s.options.Logger.PrintAndLog("Media Server", "Buffering video from remote file system handler (might take a while)", nil)
	if err := s.BufferRemoteFileToTmp(buffFile, targetFsh, realFilepath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return "", false
	}

	buffFileAbs, _ := filepath.Abs(buffFile)
	return buffFileAbs, true
}
