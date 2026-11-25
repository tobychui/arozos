package clusterfs

/*
	cluster:/ file system abstraction

	Presents the cluster namespace (mod/cluster/storage + metadata) as an
	ordinary ArozOS file system handler, so File Manager, WebDAV, the AGI
	filelib and every web app use it like any other drive. It is a buffered
	file system (RequireBuffer = true): the core stages uploads locally and
	hands them over as streams, like the WebDAV backend.

	All paths handed to this abstraction are logical namespace paths
	("/photos/a.jpg"); the hierarchy is always public.
*/

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

// Info is what the backend reports about an entry.
type Info struct {
	Path    string
	IsDir   bool
	Size    int64
	ModTime int64
}

// Backend is implemented by mod/cluster/storage.Service (adapted in the core).
type Backend interface {
	Stat(logical string) (Info, error)
	List(logical string) ([]Info, error)
	Mkdir(logical string, owner string) error
	Remove(logical string, recursive bool) error
	Rename(oldPath string, newPath string) error
	OpenRead(logical string) (io.ReadCloser, error)
	Write(logical string, r io.Reader, owner string) error
	Ready() bool
}

// InfoBackend is an optional Backend extension: a backend that implements it
// can explain where a file physically lives (which nodes hold a copy of it
// and in what state), which the File Manager properties dialog shows.
type InfoBackend interface {
	StorageInfo(logical string) (arozfs.StorageInfo, error)
}

// ThumbnailBackend is an optional Backend extension: a backend that
// implements it has thumbnails rendered by a node holding a copy of the file,
// which makes the abstraction an arozfs.ThumbnailRenderer.
type ThumbnailBackend interface {
	ThumbnailKey(logical string) (string, error)
	RenderThumbnail(logical string) ([]byte, error)
}

var errUnsupported = errors.New("filesystem type not supported")

var errNoStorageInfo = errors.New("storage info not available")

// ClusterFileSystem is the abstraction.
type ClusterFileSystem struct {
	UUID    string
	backend Backend
}

// New creates the abstraction over a backend.
func New(uuid string, backend Backend) *ClusterFileSystem {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "New: uuid=%.120q", uuid)
	}
	return &ClusterFileSystem{UUID: uuid, backend: backend}
}

// normalize turns any path form into "/a/b".
func normalize(p string) string {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "normalize: p=%.120q", p)
	}
	p = strings.ReplaceAll(strings.TrimSpace(p), "\\", "/")
	if i := strings.Index(p, ":"); i >= 0 && i < 16 && !strings.Contains(p[:i], "/") {
		p = p[i+1:]
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)
	if p == "." {
		p = "/"
	}
	return p
}

/*
	os.FileInfo / fs.DirEntry adapters
*/

type fileInfo struct{ info Info }

func (f fileInfo) Name() string {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "fileInfo.Name")
	return path.Base(f.info.Path)
}
func (f fileInfo) Size() int64 {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "fileInfo.Size")
	return f.info.Size
}
func (f fileInfo) Mode() os.FileMode {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "fileInfo.Mode")
	if f.info.IsDir {
		return os.ModeDir | 0755
	}
	return 0644
}
func (f fileInfo) ModTime() time.Time {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "fileInfo.ModTime")
	return time.Unix(f.info.ModTime, 0)
}
func (f fileInfo) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "fileInfo.IsDir")
	return f.info.IsDir
}
func (f fileInfo) Sys() interface{} {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "fileInfo.Sys")
	return nil
}

type dirEntry struct{ info Info }

func (d dirEntry) Name() string {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "dirEntry.Name")
	return path.Base(d.info.Path)
}
func (d dirEntry) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "dirEntry.IsDir")
	return d.info.IsDir
}
func (d dirEntry) Type() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "dirEntry.Type")
	return fileInfo{d.info}.Mode().Type()
}
func (d dirEntry) Info() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "dirEntry.Info")
	return fileInfo{d.info}, nil
}

/*
	FileSystemAbstraction
*/

func (c *ClusterFileSystem) Chmod(string, os.FileMode) error {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Chmod")
	return errUnsupported
}
func (c *ClusterFileSystem) Chown(string, int, int) error {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Chown")
	return errUnsupported
}
func (c *ClusterFileSystem) Chtimes(string, time.Time, time.Time) error {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Chtimes")
	return errUnsupported
}
func (c *ClusterFileSystem) Create(string) (arozfs.File, error) {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Create")
	return nil, errUnsupported
}
func (c *ClusterFileSystem) Open(string) (arozfs.File, error) {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Open")
	return nil, errUnsupported
}
func (c *ClusterFileSystem) OpenFile(string, int, os.FileMode) (arozfs.File, error) {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.OpenFile")
	return nil, errUnsupported
}

func (c *ClusterFileSystem) Mkdir(p string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.Mkdir: p=%.120q", p)
	}
	return c.backend.Mkdir(normalize(p), "")
}

func (c *ClusterFileSystem) MkdirAll(p string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.MkdirAll: p=%.120q", p)
	}
	return c.backend.Mkdir(normalize(p), "")
}

func (c *ClusterFileSystem) Name() string {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Name")
	return "cluster"
}

func (c *ClusterFileSystem) Remove(p string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.Remove: p=%.120q", p)
	}
	return c.backend.Remove(normalize(p), false)
}

func (c *ClusterFileSystem) RemoveAll(p string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.RemoveAll: p=%.120q", p)
	}
	return c.backend.Remove(normalize(p), true)
}

func (c *ClusterFileSystem) Rename(oldname, newname string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.Rename: oldname=%.120q newname=%.120q", oldname, newname)
	}
	return c.backend.Rename(normalize(oldname), normalize(newname))
}

func (c *ClusterFileSystem) Stat(p string) (os.FileInfo, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.Stat: p=%.120q", p)
	}
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		return nil, err
	}
	return fileInfo{info}, nil
}

func (c *ClusterFileSystem) Close() error {
	logger.DebugTrace("filesystem/abstractions/clusterfs", "ClusterFileSystem.Close")
	return nil
}

func (c *ClusterFileSystem) VirtualPathToRealPath(subpath string, username string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.VirtualPathToRealPath: subpath=%.120q username=%.120q", subpath, username)
	}
	subpath = strings.TrimPrefix(strings.TrimSpace(subpath), c.UUID+":")
	return normalize(subpath), nil
}

func (c *ClusterFileSystem) RealPathToVirtualPath(rpath string, username string) (string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.RealPathToVirtualPath: rpath=%.120q username=%.120q", rpath, username)
	}
	return c.UUID + ":" + normalize(rpath), nil
}

func (c *ClusterFileSystem) FileExists(p string) bool {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.FileExists: p=%.120q", p)
	}
	_, err := c.backend.Stat(normalize(p))
	return err == nil
}

func (c *ClusterFileSystem) IsDir(p string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.IsDir: p=%.120q", p)
	}
	info, err := c.backend.Stat(normalize(p))
	return err == nil && info.IsDir
}

// Glob emulates a depth-limited glob over directory listings, like webdavfs.
func (c *ClusterFileSystem) Glob(wildcard string) ([]string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.Glob: wildcard=%.120q", wildcard)
	}
	wildcard = normalize(wildcard)
	chunks := strings.Split(strings.TrimPrefix(wildcard, "/"), "/")
	return c.globPath("/", chunks)
}

func (c *ClusterFileSystem) globPath(base string, chunks []string) ([]string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.globPath: base=%.120q len(chunks)=%d", base, len(chunks))
	}
	if len(chunks) == 0 {
		return []string{base}, nil
	}
	entries, err := c.backend.List(base)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, e := range entries {
		name := path.Base(e.Path)
		matched, _ := filepath.Match(chunks[0], name)
		if !matched {
			continue
		}
		if len(chunks) == 1 {
			out = append(out, e.Path)
			continue
		}
		if e.IsDir {
			sub, err := c.globPath(e.Path, chunks[1:])
			if err == nil {
				out = append(out, sub...)
			}
		}
	}
	return out, nil
}

func (c *ClusterFileSystem) GetFileSize(p string) int64 {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.GetFileSize: p=%.120q", p)
	}
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		return 0
	}
	return info.Size
}

func (c *ClusterFileSystem) GetModTime(p string) (int64, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.GetModTime: p=%.120q", p)
	}
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		return 0, err
	}
	return info.ModTime, nil
}

func (c *ClusterFileSystem) WriteFile(p string, content []byte, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.WriteFile: p=%.120q", p)
	}
	return c.backend.Write(normalize(p), strings.NewReader(string(content)), "")
}

func (c *ClusterFileSystem) ReadFile(p string) ([]byte, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.ReadFile: p=%.120q", p)
	}
	r, err := c.backend.OpenRead(normalize(p))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func (c *ClusterFileSystem) ReadDir(p string) ([]fs.DirEntry, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.ReadDir: p=%.120q", p)
	}
	entries, err := c.backend.List(normalize(p))
	if err != nil {
		return nil, err
	}
	out := make([]fs.DirEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, dirEntry{e})
	}
	return out, nil
}

func (c *ClusterFileSystem) WriteStream(p string, stream io.Reader, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.WriteStream: p=%.120q", p)
	}
	return c.backend.Write(normalize(p), stream, "")
}

func (c *ClusterFileSystem) ReadStream(p string) (io.ReadCloser, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.ReadStream: p=%.120q", p)
	}
	return c.backend.OpenRead(normalize(p))
}

func (c *ClusterFileSystem) Walk(root string, walkFn filepath.WalkFunc) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.Walk: root=%.120q", root)
	}
	root = normalize(root)
	info, err := c.backend.Stat(root)
	if err != nil {
		return walkFn(root, nil, err)
	}
	return c.walk(root, info, walkFn)
}

func (c *ClusterFileSystem) walk(p string, info Info, walkFn filepath.WalkFunc) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/clusterfs", "ClusterFileSystem.walk: p=%.120q", p)
	}
	err := walkFn(p, fileInfo{info}, nil)
	if err != nil {
		if info.IsDir && err == filepath.SkipDir {
			return nil
		}
		return err
	}
	if !info.IsDir {
		return nil
	}
	entries, err := c.backend.List(p)
	if err != nil {
		return walkFn(p, fileInfo{info}, err)
	}
	for _, e := range entries {
		if err := c.walk(e.Path, e, walkFn); err != nil {
			return err
		}
	}
	return nil
}

// StorageInfo resolves the replicas of one namespace path through the
// backend. It is what makes cluster:/ files show where their copies are.
func (c *ClusterFileSystem) StorageInfo(p string) (arozfs.StorageInfo, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.StorageInfo: p=%.120q", p)
	}
	backend, ok := c.backend.(InfoBackend)
	if !ok {
		return arozfs.StorageInfo{}, errNoStorageInfo
	}
	return backend.StorageInfo(normalize(p))
}

// ThumbnailKey identifies the content of a file for the thumbnail cache.
func (c *ClusterFileSystem) ThumbnailKey(p string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.ThumbnailKey: p=%.120q", p)
	}
	backend, ok := c.backend.(ThumbnailBackend)
	if !ok {
		return "", arozfs.ErrNoThumbnail
	}
	return backend.ThumbnailKey(normalize(p))
}

// RenderThumbnail has a node holding a copy of the file render its thumbnail.
func (c *ClusterFileSystem) RenderThumbnail(p string) ([]byte, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/clusterfs", "ClusterFileSystem.RenderThumbnail: p=%.120q", p)
	}
	backend, ok := c.backend.(ThumbnailBackend)
	if !ok {
		return nil, arozfs.ErrNoThumbnail
	}
	return backend.RenderThumbnail(normalize(p))
}

func (c *ClusterFileSystem) Heartbeat() error {
	logger.Debug("filesystem/abstractions/clusterfs", "ClusterFileSystem.Heartbeat")
	if !c.backend.Ready() {
		return errors.New("cluster storage not ready")
	}
	return nil
}
