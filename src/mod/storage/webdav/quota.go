package webdav

/*
	Storage quota

	Two checks hold the writes of a user to their quota. A request that says
	what it will write (an upload with its length, a copy) is refused before
	anything is touched, because the protocol handler empties or deletes what
	it replaces before it writes. The files being written are also checked as
	they grow (see quotafs), for the uploads that do not say.
*/

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/webdav"
	"imuslab.com/arozos/mod/storage/quotafs"
)

// How long the changes of a user must pause before their usage is recalculated.
// Recalculating walks every file of the user, so not after each of the many
// requests of a folder upload.
const defaultRecountDelay = 5 * time.Second

// quotaError marks a quota refusal so that the protocol handler answers it
// with 507 Insufficient Storage
func quotaError(err error) error {
	if errors.Is(err, quotafs.ErrQuotaExceeded) {
		return fmt.Errorf("%w: %w", webdav.ErrInsufficientStorage, err)
	}
	return err
}

// uploadFile is a file being replaced on a drive that counts against the quota
type uploadFile struct {
	*quotafs.File
	drive quotafs.Drive
	rpath string
}

func (f *uploadFile) Write(p []byte) (int, error) {
	n, err := f.File.Write(p)
	return n, quotaError(err)
}

func (f *uploadFile) ReadFrom(r io.Reader) (int64, error) {
	return io.Copy(struct{ io.Writer }{f}, r)
}

// Close removes the file if it was refused, as a cut off upload is of no use
// and would fill up what is left of the quota
func (f *uploadFile) Close() error {
	err := f.File.Close()
	if f.File.Refused() {
		if removeErr := f.drive.Remove(f.rpath); removeErr != nil {
			logger.PrintAndLog("Webdav", "Failed to remove an upload that was over quota: "+f.rpath, removeErr)
		}
	}
	return err
}

// target resolves a request path the user may change. ok is false for anything
// else, which the protocol handler refuses in its own way.
func (a *RootFsWebDAVAdapter) target(name string) (drive quotafs.Drive, rpath string, ok bool) {
	if isRootLevel(name) {
		return drive, "", false
	}
	adapter, subpath, err := a.resolve(name)
	if err != nil || adapter.checkWrite(subpath) != nil {
		return drive, "", false
	}
	rpath, err = adapter.requestPathToRealPath(subpath)
	if err != nil {
		return drive, "", false
	}
	return quotafs.For(adapter.fsh, a.quota), rpath, true
}

// uploadLength is the size a PUT announced, or -1. macOS Finder sends chunked
// uploads with the length in a header of its own.
func uploadLength(r *http.Request) int64 {
	if r.ContentLength >= 0 {
		return r.ContentLength
	}
	length, err := strconv.ParseInt(r.Header.Get("X-Expected-Entity-Length"), 10, 64)
	if err != nil {
		return -1
	}
	return length
}

// requestFits reports whether what a request is about to write fits in the
// quota, as far as the request tells before it is carried out
func (a *RootFsWebDAVAdapter) requestFits(prefix string, r *http.Request) bool {
	requestPath := strings.TrimPrefix(r.URL.Path, prefix)
	switch r.Method {
	case http.MethodPut:
		drive, rpath, ok := a.target(requestPath)
		length := uploadLength(r)
		if !ok || !drive.Tracked() || length < 0 {
			return true
		}
		return drive.HaveSpace(length - drive.Size(rpath))

	case "COPY", "MOVE":
		destination, err := url.Parse(r.Header.Get("Destination"))
		if err != nil {
			return true
		}
		destDrive, destPath, ok := a.target(strings.TrimPrefix(destination.Path, prefix))
		if !ok || !destDrive.Tracked() {
			return true
		}
		source, subpath, err := a.resolve(requestPath)
		if err != nil || source == nil {
			return true
		}
		sourcePath, err := source.requestPathToRealPath(subpath)
		if err != nil {
			return true
		}
		sourceDrive := quotafs.For(source.fsh, a.quota)
		overwrite := r.Header.Get("Overwrite") != "F"
		if r.Method == "MOVE" {
			//A move between drives that both count changes nothing
			if sourceDrive.Tracked() || source.checkWrite(subpath) != nil {
				return true
			}
			overwrite = r.Header.Get("Overwrite") == "T"
		}
		info, err := source.fsh.FileSystemAbstraction.Stat(sourcePath)
		if err != nil || (info.IsDir() && r.Header.Get("Depth") == "0") {
			return true
		}
		if !overwrite && destDrive.Size(destPath) > 0 {
			return true //Refused for the existing destination
		}
		return destDrive.HaveSpace(sourceDrive.Size(sourcePath) - destDrive.Size(destPath))
	}
	return true
}

// quotaHandler serves a user whose writes are held to a quota
type quotaHandler struct {
	dav     *webdav.Handler
	rootfs  *RootFsWebDAVAdapter
	changed func() //Called after a request that may have changed the usage
}

func (h quotaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.rootfs.requestFits(h.dav.Prefix, r) {
		logger.PrintAndLog("Webdav", "Refused a "+r.Method+" of "+r.URL.Path+": "+quotafs.ErrQuotaExceeded.Error(), nil)
		http.Error(w, quotafs.ErrQuotaExceeded.Error(), http.StatusInsufficientStorage)
		return
	}

	h.dav.ServeHTTP(w, r)

	switch r.Method {
	case http.MethodPut, http.MethodDelete, "COPY", "MOVE":
		h.changed()
	}
}

// scheduleRecount recalculates the usage of a user once their changes pause
func (s *Server) scheduleRecount(username string, userQuota quotafs.Quota) {
	delay := s.recountDelay
	if delay == 0 {
		delay = defaultRecountDelay
	}
	s.recountLock.Lock()
	defer s.recountLock.Unlock()
	if pending, ok := s.recounts[username]; ok {
		pending.Stop()
	}
	if s.recounts == nil {
		s.recounts = map[string]*time.Timer{}
	}
	s.recounts[username] = time.AfterFunc(delay, userQuota.CalculateQuotaUsage)
}
