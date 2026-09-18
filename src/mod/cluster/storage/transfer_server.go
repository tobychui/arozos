package storage

/*
	Chunked transfer protocol - server side (signed ACN endpoints, this node's
	volumes only):

		POST store/begin      {VolumeID, Path, Size, Checksum, FileID} -> {SessionID, Have}
		POST store/chunk?session=&index=   raw bytes + X-Aroz-Chunk-Sha256
		POST store/commit     {SessionID} -> {Checksum, Size}
		POST store/abort      {SessionID}
		GET  store/read?volume=&path=&offset=&length=   raw bytes
		GET  store/stat?volume=&path=
		POST store/mkdir | store/delete | store/rename  {VolumeID, Path, NewPath, Recursive}
		GET  store/list?volume=&path=
		POST store/checksum   {VolumeID, Path}
		POST store/place      {Size, Path, PreferNode, PreferVolume} (leader only)
*/

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/metadata"
)

const (
	pathBegin    = acn.BasePath + "/store/begin"
	pathChunk    = acn.BasePath + "/store/chunk"
	pathCommit   = acn.BasePath + "/store/commit"
	pathAbort    = acn.BasePath + "/store/abort"
	pathRead     = acn.BasePath + "/store/read"
	pathStatFile = acn.BasePath + "/store/stat"
	pathMkdir    = acn.BasePath + "/store/mkdir"
	pathDelete   = acn.BasePath + "/store/delete"
	pathRename   = acn.BasePath + "/store/rename"
	pathList     = acn.BasePath + "/store/list"
	pathChecksum = acn.BasePath + "/store/checksum"
	pathPlace    = acn.BasePath + "/store/place"

	HeaderChunkSha = "X-Aroz-Chunk-Sha256"
	HeaderFileSize = "X-Aroz-File-Size"
)

type BeginRequest struct {
	VolumeID string `json:"volumeId"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Checksum string `json:"checksum"`
	FileID   string `json:"fileId"`
}

type BeginResponse struct {
	SessionID string `json:"sessionId"`
	Have      []int  `json:"have"`
}

type SessionRequest struct {
	SessionID string `json:"sessionId"`
}

type CommitResponse struct {
	Checksum string `json:"checksum"`
	Size     int64  `json:"size"`
}

type PathRequest struct {
	VolumeID  string `json:"volumeId"`
	Path      string `json:"path"`
	NewPath   string `json:"newPath,omitempty"`
	Recursive bool   `json:"recursive,omitempty"`
}

type StatResponse struct {
	Exists  bool  `json:"exists"`
	IsDir   bool  `json:"isDir"`
	Size    int64 `json:"size"`
	ModTime int64 `json:"modTime"`
}

type ListEntry struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

type ChecksumResponse struct {
	Checksum string `json:"checksum"`
	Size     int64  `json:"size"`
}

// session is one in-progress upload onto a local volume.
type session struct {
	ID       string
	VolumeID string
	Path     string
	Size     int64
	Checksum string
	FileID   string
	partPath string
	received map[int]bool
	created  time.Time
	updated  time.Time
}

func (s *Service) registerACNHandlers() {
	srv := s.m.Server()
	srv.HandleFunc(pathBegin, s.handleBegin)
	srv.HandleFunc(pathChunk, s.handleChunk)
	srv.HandleFunc(pathCommit, s.handleCommit)
	srv.HandleFunc(pathAbort, s.handleAbort)
	srv.HandleFunc(pathRead, s.handleRead)
	srv.HandleFunc(pathStatFile, s.handleStatFile)
	srv.HandleFunc(pathMkdir, s.handleMkdir)
	srv.HandleFunc(pathDelete, s.handleDelete)
	srv.HandleFunc(pathRename, s.handleRename)
	srv.HandleFunc(pathList, s.handleList)
	srv.HandleFunc(pathChecksum, s.handleChecksum)
	srv.HandleFunc(pathPlace, s.handlePlace)
}

// localVolumePath resolves a request onto a local volume path.
func (s *Service) localVolumePath(volumeID string, logical string) (*metadata.Volume, string, error) {
	vol, ok := s.meta.Volume(volumeID)
	if !ok || vol.Removed {
		return nil, "", errors.New("volume not found")
	}
	if vol.NodeID != s.m.NodeID() {
		return nil, "", ErrNotLocalVolume
	}
	real, err := s.realPath(vol, logical)
	if err != nil {
		return nil, "", err
	}
	return vol, real, nil
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrNotLocalVolume), errors.Is(err, os.ErrNotExist):
		return http.StatusNotFound
	case errors.Is(err, ErrPathEscape):
		return http.StatusBadRequest
	case errors.Is(err, ErrChecksum):
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}

func (s *Service) handleBegin(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req BeginRequest
	if err := json.Unmarshal(body, &req); err != nil || req.Size < 0 || req.Checksum == "" {
		acn.WriteError(w, http.StatusBadRequest, "invalid begin request")
		return
	}
	_, real, err := s.localVolumePath(req.VolumeID, req.Path)
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(real), 0755); err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.sessMu.Lock()
	defer s.sessMu.Unlock()
	//Resume an unfinished session for the same file version
	for _, sess := range s.sessions {
		if sess.VolumeID == req.VolumeID && sess.Path == metadata.NormalizePath(req.Path) && sess.Checksum == req.Checksum && sess.Size == req.Size {
			sess.updated = time.Now()
			acn.WriteJSON(w, BeginResponse{SessionID: sess.ID, Have: sess.haveList()})
			return
		}
	}
	sess := &session{
		ID:       uuid.NewV4().String(),
		VolumeID: req.VolumeID,
		Path:     metadata.NormalizePath(req.Path),
		Size:     req.Size,
		Checksum: req.Checksum,
		FileID:   req.FileID,
		received: map[int]bool{},
		created:  time.Now(),
		updated:  time.Now(),
	}
	sess.partPath = real + ".part-" + sess.ID
	f, err := os.Create(sess.partPath)
	if err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if req.Size > 0 {
		f.Truncate(req.Size)
	}
	f.Close()
	s.sessions[sess.ID] = sess
	acn.WriteJSON(w, BeginResponse{SessionID: sess.ID, Have: []int{}})
}

func (sess *session) haveList() []int {
	out := make([]int, 0, len(sess.received))
	for i := range sess.received {
		out = append(out, i)
	}
	return out
}

func (sess *session) chunkCount() int {
	if sess.Size == 0 {
		return 0
	}
	return int((sess.Size + ChunkSize - 1) / ChunkSize)
}

func (s *Service) getSession(id string) (*session, bool) {
	s.sessMu.Lock()
	defer s.sessMu.Unlock()
	sess, ok := s.sessions[id]
	if ok {
		sess.updated = time.Now()
	}
	return sess, ok
}

func (s *Service) dropSession(id string, removePart bool) {
	s.sessMu.Lock()
	sess, ok := s.sessions[id]
	delete(s.sessions, id)
	s.sessMu.Unlock()
	if ok && removePart {
		os.Remove(sess.partPath)
	}
}

func (s *Service) handleChunk(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	q := r.URL.Query()
	sess, ok := s.getSession(q.Get("session"))
	if !ok {
		acn.WriteError(w, http.StatusNotFound, "unknown upload session")
		return
	}
	index, err := strconv.Atoi(q.Get("index"))
	if err != nil || index < 0 || index >= sess.chunkCount() {
		acn.WriteError(w, http.StatusBadRequest, "chunk index out of range")
		return
	}
	if len(body) == 0 || len(body) > MaxChunkSize {
		acn.WriteError(w, http.StatusBadRequest, "chunk size invalid")
		return
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != strings.ToLower(r.Header.Get(HeaderChunkSha)) {
		acn.WriteError(w, http.StatusConflict, "chunk checksum mismatch")
		return
	}
	offset := int64(index) * ChunkSize
	if offset+int64(len(body)) > sess.Size {
		acn.WriteError(w, http.StatusBadRequest, "chunk exceeds file size")
		return
	}
	f, err := os.OpenFile(sess.partPath, os.O_WRONLY, 0644)
	if err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = f.WriteAt(body, offset)
	f.Close()
	if err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.sessMu.Lock()
	sess.received[index] = true
	n := len(sess.received)
	s.sessMu.Unlock()
	acn.WriteJSON(w, map[string]int{"index": index, "received": n})
}

func (s *Service) handleCommit(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req SessionRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	sess, ok := s.getSession(req.SessionID)
	if !ok {
		acn.WriteError(w, http.StatusNotFound, "unknown upload session")
		return
	}
	if len(sess.received) != sess.chunkCount() {
		acn.WriteError(w, http.StatusConflict, "upload incomplete")
		return
	}
	sum, size, err := fileChecksum(sess.partPath)
	if err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if size != sess.Size || sum != strings.ToLower(sess.Checksum) {
		s.dropSession(sess.ID, true)
		acn.WriteError(w, http.StatusConflict, ErrChecksum.Error())
		return
	}
	_, real, err := s.localVolumePath(sess.VolumeID, sess.Path)
	if err != nil {
		s.dropSession(sess.ID, true)
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	if err := os.Rename(sess.partPath, real); err != nil {
		s.dropSession(sess.ID, true)
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dropSession(sess.ID, false)
	acn.WriteJSON(w, CommitResponse{Checksum: sum, Size: size})
}

func (s *Service) handleAbort(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req SessionRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	s.dropSession(req.SessionID, true)
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (s *Service) handleRead(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	q := r.URL.Query()
	_, real, err := s.localVolumePath(q.Get("volume"), q.Get("path"))
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	offset, _ := strconv.ParseInt(q.Get("offset"), 10, 64)
	length, _ := strconv.ParseInt(q.Get("length"), 10, 64)
	if offset < 0 || length <= 0 || length > MaxChunkSize {
		acn.WriteError(w, http.StatusBadRequest, "invalid range")
		return
	}
	f, err := os.Open(real)
	if err != nil {
		acn.WriteError(w, http.StatusNotFound, "file not found on volume")
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		acn.WriteError(w, http.StatusNotFound, "not a file")
		return
	}
	if offset > fi.Size() {
		acn.WriteError(w, http.StatusBadRequest, "offset beyond end of file")
		return
	}
	if offset+length > fi.Size() {
		length = fi.Size() - offset
	}
	buf := make([]byte, length)
	n, err := f.ReadAt(buf, offset)
	if err != nil && err != io.EOF {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	buf = buf[:n]
	sum := sha256.Sum256(buf)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set(HeaderChunkSha, hex.EncodeToString(sum[:]))
	w.Header().Set(HeaderFileSize, strconv.FormatInt(fi.Size(), 10))
	w.Header().Set("Content-Length", strconv.Itoa(n))
	w.Write(buf)
}

func (s *Service) handleStatFile(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	q := r.URL.Query()
	_, real, err := s.localVolumePath(q.Get("volume"), q.Get("path"))
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	fi, err := os.Stat(real)
	if err != nil {
		acn.WriteJSON(w, StatResponse{Exists: false})
		return
	}
	acn.WriteJSON(w, StatResponse{Exists: true, IsDir: fi.IsDir(), Size: fi.Size(), ModTime: fi.ModTime().Unix()})
}

func (s *Service) handleMkdir(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req PathRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	_, real, err := s.localVolumePath(req.VolumeID, req.Path)
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	if err := os.MkdirAll(real, 0755); err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req PathRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	vol, real, err := s.localVolumePath(req.VolumeID, req.Path)
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	root, _ := s.volumeRoot(vol)
	if real == root {
		acn.WriteError(w, http.StatusBadRequest, "refusing to delete the volume root")
		return
	}
	if req.Recursive {
		err = os.RemoveAll(real)
	} else {
		err = os.Remove(real)
	}
	if err != nil && !os.IsNotExist(err) {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (s *Service) handleRename(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req PathRequest
	if err := json.Unmarshal(body, &req); err != nil || req.NewPath == "" {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	vol, src, err := s.localVolumePath(req.VolumeID, req.Path)
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	dst, err := s.realPath(vol, req.NewPath)
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := os.Rename(src, dst); err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	q := r.URL.Query()
	_, real, err := s.localVolumePath(q.Get("volume"), q.Get("path"))
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	entries, err := os.ReadDir(real)
	if err != nil {
		acn.WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	out := []ListEntry{}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".part-") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, ListEntry{Name: e.Name(), IsDir: e.IsDir(), Size: fi.Size(), ModTime: fi.ModTime().Unix()})
	}
	acn.WriteJSON(w, out)
}

func (s *Service) handleChecksum(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req PathRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	_, real, err := s.localVolumePath(req.VolumeID, req.Path)
	if err != nil {
		acn.WriteError(w, statusFor(err), err.Error())
		return
	}
	sum, size, err := fileChecksum(real)
	if err != nil {
		acn.WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	acn.WriteJSON(w, ChecksumResponse{Checksum: sum, Size: size})
}

func (s *Service) handlePlace(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !s.meta.IsLeader() {
		acn.WriteError(w, http.StatusConflict, "this node is not the metadata leader")
		return
	}
	var req PlaceRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	var exclude []string
	if req.ExcludeVolume != "" {
		exclude = []string{req.ExcludeVolume}
	}
	vol, err := s.pickVolume(req.Size, req.PreferNode, req.PreferVolume, exclude)
	if err != nil {
		acn.WriteError(w, http.StatusInsufficientStorage, err.Error())
		return
	}
	acn.WriteJSON(w, PlaceResponse{VolumeID: vol.ID})
}

// sweepSessions drops abandoned uploads and their part files.
func (s *Service) sweepSessions() {
	cutoff := time.Now().Add(-SessionTTL)
	s.sessMu.Lock()
	stale := []*session{}
	for id, sess := range s.sessions {
		if sess.updated.Before(cutoff) {
			stale = append(stale, sess)
			delete(s.sessions, id)
		}
	}
	s.sessMu.Unlock()
	for _, sess := range stale {
		os.Remove(sess.partPath)
	}
}
