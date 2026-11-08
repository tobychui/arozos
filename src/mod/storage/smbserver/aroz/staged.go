package aroz

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver"
)

/*
	staged.go

	S3, FTP, WebDAV and cluster drives can only read or write a file whole.
	SMB reads and writes anywhere in a file, so such a file is staged: copied
	to a local file, worked on there, and sent back whole when it closes.

	The copy starts at the first read and runs in the background, and a read is
	answered as soon as its part has arrived. Copying a file out therefore
	starts at once, instead of after the whole file came down. A write waits
	for the whole copy, because the upload has to contain all of it.

	If the upload at close fails, the staged file is kept in the failed folder
	and the error goes back to the client, so nothing written is lost silently.
*/

// DefaultStageLimit is the largest file a buffered drive serves over SMB.
const DefaultStageLimit = 4 << 30

const failedFolder = "failed"

// stageConfig says where staged copies live and how big they may be.
type stageConfig struct {
	dir     string
	keepDir string //For copies whose upload failed
	limit   int64  //Negative is no limit
}

// stagedFile is one open file on a buffered drive.
type stagedFile struct {
	fsh       *filesystem.FileSystemHandler
	rpath     string
	vpath     string //For the log and the name of a kept copy
	localPath string
	local     *os.File
	keepDir   string

	mu      sync.Mutex
	changed *sync.Cond
	started bool  //The download began
	loaded  bool  //The local copy is complete
	have    int64 //Bytes of the remote file copied so far
	loadErr error
	stream  io.ReadCloser
	dirty   bool
	closed  bool
}

// openStaged opens a file of a buffered drive. truncate and create follow the
// os flags: a file that starts empty needs nothing downloaded.
func openStaged(fsh *filesystem.FileSystemHandler, rpath, vpath string, flag int, cfg stageConfig) (*stagedFile, error) {
	fsa := fsh.FileSystemAbstraction
	exists := fsa.FileExists(rpath)
	if flag&os.O_CREATE != 0 && flag&os.O_EXCL != 0 && exists {
		return nil, os.ErrExist
	}
	if !exists && flag&os.O_CREATE == 0 {
		return nil, os.ErrNotExist
	}
	empty := !exists || flag&os.O_TRUNC != 0
	if !empty {
		info, err := fsa.Stat(rpath)
		if err != nil {
			return nil, err
		}
		if info.IsDir() {
			return nil, errors.New("smbserver/aroz: a folder cannot be opened as a file")
		}
		if cfg.limit > 0 && info.Size() > cfg.limit {
			return nil, smbserver.ErrFileTooLarge
		}
	}

	if err := os.MkdirAll(cfg.dir, 0700); err != nil {
		return nil, err
	}
	local, err := os.CreateTemp(cfg.dir, "stage-*")
	if err != nil {
		return nil, err
	}
	s := &stagedFile{fsh: fsh, rpath: rpath, vpath: vpath, localPath: local.Name(), local: local, keepDir: cfg.keepDir}
	s.changed = sync.NewCond(&s.mu)

	if empty {
		//The file must exist, and be empty, the moment the open succeeds:
		//others listing the folder see it, as on a local drive
		if err := fsa.WriteStream(rpath, bytes.NewReader(nil), 0775); err != nil {
			local.Close()
			os.Remove(s.localPath)
			return nil, err
		}
		s.started, s.loaded = true, true
	}
	return s, nil
}

// startDownload begins the background copy, once.
func (s *stagedFile) startDownload() {
	if s.started {
		return
	}
	s.started = true
	stream, err := s.fsh.FileSystemAbstraction.ReadStream(s.rpath)
	if err != nil {
		s.loadErr = err
		s.changed.Broadcast()
		return
	}
	s.stream = stream
	go s.download(stream)
}

func (s *stagedFile) download(stream io.ReadCloser) {
	defer stream.Close()
	buf := make([]byte, 1<<20)
	var offset int64
	for {
		n, err := stream.Read(buf)
		if n > 0 {
			if _, werr := s.local.WriteAt(buf[:n], offset); werr != nil {
				err = werr
			}
			offset += int64(n)
			s.mu.Lock()
			s.have = offset
			s.changed.Broadcast()
			s.mu.Unlock()
		}
		if err != nil {
			s.mu.Lock()
			if errors.Is(err, io.EOF) {
				s.loaded = true
			} else if !s.closed {
				s.loadErr = err
			}
			s.changed.Broadcast()
			s.mu.Unlock()
			return
		}
	}
}

// waitFor blocks until the first end bytes are local, or the copy ended.
// The caller holds s.mu.
func (s *stagedFile) waitFor(end int64) error {
	s.startDownload()
	for !s.loaded && s.loadErr == nil && !s.closed && s.have < end {
		s.changed.Wait()
	}
	if s.loadErr != nil {
		return s.loadErr
	}
	if s.closed {
		return os.ErrClosed
	}
	return nil
}

func (s *stagedFile) ReadAt(b []byte, off int64) (int, error) {
	s.mu.Lock()
	err := s.waitFor(off + int64(len(b)))
	s.mu.Unlock()
	if err != nil {
		return 0, err
	}
	return s.local.ReadAt(b, off)
}

// whole waits for the complete copy, which every change needs.
func (s *stagedFile) whole() error {
	for {
		if err := s.waitFor(1 << 62); err != nil {
			return err
		}
		if s.loaded {
			return nil
		}
	}
}

func (s *stagedFile) WriteAt(b []byte, off int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.whole(); err != nil {
		return 0, err
	}
	s.dirty = true
	return s.local.WriteAt(b, off)
}

func (s *stagedFile) Truncate(size int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.whole(); err != nil {
		return err
	}
	s.dirty = true
	return s.local.Truncate(size)
}

// PendingSize reports the size of a copy that has changes the drive has not
// received yet.
func (s *stagedFile) PendingSize() (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty || s.closed {
		return 0, false
	}
	fi, err := s.local.Stat()
	if err != nil {
		return 0, false
	}
	return fi.Size(), true
}

// Sync keeps the data local. It reaches the drive at close, in one piece.
func (s *stagedFile) Sync() error { return nil }

// Close uploads what was written. A failed upload keeps the staged copy.
func (s *stagedFile) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	dirty := s.dirty
	if s.stream != nil && !s.loaded {
		//Stop a download nobody needs any more
		s.stream.Close()
	}
	s.changed.Broadcast()
	s.mu.Unlock()

	if !dirty {
		s.local.Close()
		return os.Remove(s.localPath)
	}

	if _, err := s.local.Seek(0, io.SeekStart); err != nil {
		return s.keep(err)
	}
	if err := s.fsh.FileSystemAbstraction.WriteStream(s.rpath, s.local, 0775); err != nil {
		return s.keep(err)
	}
	s.local.Close()
	return os.Remove(s.localPath)
}

// keep moves a staged file whose upload failed out of the way, where an admin
// can find it, and passes the error on.
func (s *stagedFile) keep(cause error) error {
	s.local.Close()
	name := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(s.vpath)
	target := filepath.Join(s.keepDir, fmt.Sprintf("%s.%d", name, time.Now().Unix()))
	if err := moveFile(s.localPath, target); err != nil {
		logger.PrintAndLog("SMB", "Upload to "+s.vpath+" failed, the data is still in "+s.localPath, cause)
		return cause
	}
	logger.PrintAndLog("SMB", "Upload to "+s.vpath+" failed, the data was kept in "+target, cause)
	return cause
}

// moveFile renames, or copies when the folders are on different disks.
func moveFile(from, to string) error {
	if err := os.MkdirAll(filepath.Dir(to), 0700); err != nil {
		return err
	}
	if err := os.Rename(from, to); err == nil {
		return nil
	}
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(to)
		return err
	}
	if err := dst.Close(); err != nil {
		os.Remove(to)
		return err
	}
	src.Close()
	return os.Remove(from)
}
