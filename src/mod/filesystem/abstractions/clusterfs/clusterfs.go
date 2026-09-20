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

var errUnsupported = errors.New("filesystem type not supported")

var errNoStorageInfo = errors.New("storage info not available")

// ClusterFileSystem is the abstraction.
type ClusterFileSystem struct {
	UUID    string
	backend Backend
}

// New creates the abstraction over a backend.
func New(uuid string, backend Backend) *ClusterFileSystem {
	return &ClusterFileSystem{UUID: uuid, backend: backend}
}

// normalize turns any path form into "/a/b".
func normalize(p string) string {
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

func (f fileInfo) Name() string { return path.Base(f.info.Path) }
func (f fileInfo) Size() int64  { return f.info.Size }
func (f fileInfo) Mode() os.FileMode {
	if f.info.IsDir {
		return os.ModeDir | 0755
	}
	return 0644
}
func (f fileInfo) ModTime() time.Time { return time.Unix(f.info.ModTime, 0) }
func (f fileInfo) IsDir() bool        { return f.info.IsDir }
func (f fileInfo) Sys() interface{}   { return nil }

type dirEntry struct{ info Info }

func (d dirEntry) Name() string               { return path.Base(d.info.Path) }
func (d dirEntry) IsDir() bool                { return d.info.IsDir }
func (d dirEntry) Type() fs.FileMode          { return fileInfo{d.info}.Mode().Type() }
func (d dirEntry) Info() (fs.FileInfo, error) { return fileInfo{d.info}, nil }

/*
	FileSystemAbstraction
*/

func (c *ClusterFileSystem) Chmod(string, os.FileMode) error            { return errUnsupported }
func (c *ClusterFileSystem) Chown(string, int, int) error               { return errUnsupported }
func (c *ClusterFileSystem) Chtimes(string, time.Time, time.Time) error { return errUnsupported }
func (c *ClusterFileSystem) Create(string) (arozfs.File, error)         { return nil, errUnsupported }
func (c *ClusterFileSystem) Open(string) (arozfs.File, error)           { return nil, errUnsupported }
func (c *ClusterFileSystem) OpenFile(string, int, os.FileMode) (arozfs.File, error) {
	return nil, errUnsupported
}

func (c *ClusterFileSystem) Mkdir(p string, mode os.FileMode) error {
	return c.backend.Mkdir(normalize(p), "")
}

func (c *ClusterFileSystem) MkdirAll(p string, mode os.FileMode) error {
	return c.backend.Mkdir(normalize(p), "")
}

func (c *ClusterFileSystem) Name() string { return "cluster" }

func (c *ClusterFileSystem) Remove(p string) error {
	return c.backend.Remove(normalize(p), false)
}

func (c *ClusterFileSystem) RemoveAll(p string) error {
	return c.backend.Remove(normalize(p), true)
}

func (c *ClusterFileSystem) Rename(oldname, newname string) error {
	return c.backend.Rename(normalize(oldname), normalize(newname))
}

func (c *ClusterFileSystem) Stat(p string) (os.FileInfo, error) {
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		return nil, err
	}
	return fileInfo{info}, nil
}

func (c *ClusterFileSystem) Close() error { return nil }

func (c *ClusterFileSystem) VirtualPathToRealPath(subpath string, username string) (string, error) {
	subpath = strings.TrimPrefix(strings.TrimSpace(subpath), c.UUID+":")
	return normalize(subpath), nil
}

func (c *ClusterFileSystem) RealPathToVirtualPath(rpath string, username string) (string, error) {
	return c.UUID + ":" + normalize(rpath), nil
}

func (c *ClusterFileSystem) FileExists(p string) bool {
	_, err := c.backend.Stat(normalize(p))
	return err == nil
}

func (c *ClusterFileSystem) IsDir(p string) bool {
	info, err := c.backend.Stat(normalize(p))
	return err == nil && info.IsDir
}

// Glob emulates a depth-limited glob over directory listings, like webdavfs.
func (c *ClusterFileSystem) Glob(wildcard string) ([]string, error) {
	wildcard = normalize(wildcard)
	chunks := strings.Split(strings.TrimPrefix(wildcard, "/"), "/")
	return c.globPath("/", chunks)
}

func (c *ClusterFileSystem) globPath(base string, chunks []string) ([]string, error) {
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
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		return 0
	}
	return info.Size
}

func (c *ClusterFileSystem) GetModTime(p string) (int64, error) {
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		return 0, err
	}
	return info.ModTime, nil
}

func (c *ClusterFileSystem) WriteFile(p string, content []byte, mode os.FileMode) error {
	return c.backend.Write(normalize(p), strings.NewReader(string(content)), "")
}

func (c *ClusterFileSystem) ReadFile(p string) ([]byte, error) {
	r, err := c.backend.OpenRead(normalize(p))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func (c *ClusterFileSystem) ReadDir(p string) ([]fs.DirEntry, error) {
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
	return c.backend.Write(normalize(p), stream, "")
}

func (c *ClusterFileSystem) ReadStream(p string) (io.ReadCloser, error) {
	return c.backend.OpenRead(normalize(p))
}

func (c *ClusterFileSystem) Walk(root string, walkFn filepath.WalkFunc) error {
	root = normalize(root)
	info, err := c.backend.Stat(root)
	if err != nil {
		return walkFn(root, nil, err)
	}
	return c.walk(root, info, walkFn)
}

func (c *ClusterFileSystem) walk(p string, info Info, walkFn filepath.WalkFunc) error {
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
	backend, ok := c.backend.(InfoBackend)
	if !ok {
		return arozfs.StorageInfo{}, errNoStorageInfo
	}
	return backend.StorageInfo(normalize(p))
}

func (c *ClusterFileSystem) Heartbeat() error {
	if !c.backend.Ready() {
		return errors.New("cluster storage not ready")
	}
	return nil
}
