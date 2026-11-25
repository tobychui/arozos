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
func New(uuid string, backend Backend) (out0 *ClusterFileSystem) {
	defer logger.Out1(logger.In2("filesystem/abstractions/clusterfs", "New", "uuid", uuid, "&backend", &backend), &out0)
	return &ClusterFileSystem{UUID: uuid, backend: backend}
}

// normalize turns any path form into "/a/b".
func normalize(p string) (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "normalize", "p", p), &out0)
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

func (f fileInfo) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "fileInfo.Name", "&f", &f), &out0)
	return path.Base(f.info.Path)
}
func (f fileInfo) Size() (out0 int64) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "fileInfo.Size", "&f", &f), &out0)
	return f.info.Size
}
func (f fileInfo) Mode() (out0 os.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "fileInfo.Mode", "&f", &f), &out0)
	if f.info.IsDir {
		return os.ModeDir | 0755
	}
	return 0644
}
func (f fileInfo) ModTime() (out0 time.Time) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "fileInfo.ModTime", "&f", &f), &out0)
	return time.Unix(f.info.ModTime, 0)
}
func (f fileInfo) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "fileInfo.IsDir", "&f", &f), &out0)
	return f.info.IsDir
}
func (f fileInfo) Sys() (out0 interface{}) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "fileInfo.Sys", "&f", &f), &out0)
	return nil
}

type dirEntry struct{ info Info }

func (d dirEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "dirEntry.Name", "&d", &d), &out0)
	return path.Base(d.info.Path)
}
func (d dirEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "dirEntry.IsDir", "&d", &d), &out0)
	return d.info.IsDir
}
func (d dirEntry) Type() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "dirEntry.Type", "&d", &d), &out0)
	return fileInfo{d.info}.Mode().Type()
}
func (d dirEntry) Info() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/clusterfs", "dirEntry.Info", "&d", &d), &out0, &out1)
	return fileInfo{d.info}, nil
}

/*
	FileSystemAbstraction
*/

func (c *ClusterFileSystem) Chmod(string, os.FileMode) (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Chmod", "c", c), &out0)
	return errUnsupported
}
func (c *ClusterFileSystem) Chown(string, int, int) (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Chown", "c", c), &out0)
	return errUnsupported
}
func (c *ClusterFileSystem) Chtimes(string, time.Time, time.Time) (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Chtimes", "c", c), &out0)
	return errUnsupported
}
func (c *ClusterFileSystem) Create(string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Create", "c", c), &out0, &out1)
	return nil, errUnsupported
}
func (c *ClusterFileSystem) Open(string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Open", "c", c), &out0, &out1)
	return nil, errUnsupported
}
func (c *ClusterFileSystem) OpenFile(string, int, os.FileMode) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.OpenFile", "c", c), &out0, &out1)
	return nil, errUnsupported
}

func (c *ClusterFileSystem) Mkdir(p string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.Mkdir", "c", c, "p", p, "&mode", &mode), &out0)
	return c.backend.Mkdir(normalize(p), "")
}

func (c *ClusterFileSystem) MkdirAll(p string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.MkdirAll", "c", c, "p", p, "&mode", &mode), &out0)
	return c.backend.Mkdir(normalize(p), "")
}

func (c *ClusterFileSystem) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Name", "c", c), &out0)
	return "cluster"
}

func (c *ClusterFileSystem) Remove(p string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.Remove", "c", c, "p", p), &out0)
	return c.backend.Remove(normalize(p), false)
}

func (c *ClusterFileSystem) RemoveAll(p string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.RemoveAll", "c", c, "p", p), &out0)
	return c.backend.Remove(normalize(p), true)
}

func (c *ClusterFileSystem) Rename(oldname, newname string) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.Rename", "c", c, "oldname", oldname, "newname", newname), &out0)
	return c.backend.Rename(normalize(oldname), normalize(newname))
}

func (c *ClusterFileSystem) Stat(p string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.Stat", "c", c, "p", p), &out0, &out1)
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return nil, err
	}
	return fileInfo{info}, nil
}

func (c *ClusterFileSystem) Close() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Close", "c", c), &out0)
	return nil
}

func (c *ClusterFileSystem) VirtualPathToRealPath(subpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.VirtualPathToRealPath", "c", c, "subpath", subpath, "username", username), &out0, &out1)
	subpath = strings.TrimPrefix(strings.TrimSpace(subpath), c.UUID+":")
	return normalize(subpath), nil
}

func (c *ClusterFileSystem) RealPathToVirtualPath(rpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.RealPathToVirtualPath", "c", c, "rpath", rpath, "username", username), &out0, &out1)
	return c.UUID + ":" + normalize(rpath), nil
}

func (c *ClusterFileSystem) FileExists(p string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.FileExists", "c", c, "p", p), &out0)
	_, err := c.backend.Stat(normalize(p))
	return err == nil
}

func (c *ClusterFileSystem) IsDir(p string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.IsDir", "c", c, "p", p), &out0)
	info, err := c.backend.Stat(normalize(p))
	return err == nil && info.IsDir
}

// Glob emulates a depth-limited glob over directory listings, like webdavfs.
func (c *ClusterFileSystem) Glob(wildcard string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.Glob", "c", c, "wildcard", wildcard), &out0, &out1)
	wildcard = normalize(wildcard)
	chunks := strings.Split(strings.TrimPrefix(wildcard, "/"), "/")
	return c.globPath("/", chunks)
}

func (c *ClusterFileSystem) globPath(base string, chunks []string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.globPath", "c", c, "base", base, "chunks", chunks), &out0, &out1)
	if len(chunks) == 0 {
		return []string{base}, nil
	}
	entries, err := c.backend.List(base)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
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

func (c *ClusterFileSystem) GetFileSize(p string) (out0 int64) {
	defer logger.Out1(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.GetFileSize", "c", c, "p", p), &out0)
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return 0
	}
	return info.Size
}

func (c *ClusterFileSystem) GetModTime(p string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.GetModTime", "c", c, "p", p), &out0, &out1)
	info, err := c.backend.Stat(normalize(p))
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return 0, err
	}
	return info.ModTime, nil
}

func (c *ClusterFileSystem) WriteFile(p string, content []byte, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/clusterfs", "ClusterFileSystem.WriteFile", "c", c, "p", p, "content", content, "&mode", &mode), &out0)
	return c.backend.Write(normalize(p), strings.NewReader(string(content)), "")
}

func (c *ClusterFileSystem) ReadFile(p string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.ReadFile", "c", c, "p", p), &out0, &out1)
	r, err := c.backend.OpenRead(normalize(p))
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func (c *ClusterFileSystem) ReadDir(p string) (out0 []fs.DirEntry, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.ReadDir", "c", c, "p", p), &out0, &out1)
	entries, err := c.backend.List(normalize(p))
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return nil, err
	}
	out := make([]fs.DirEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, dirEntry{e})
	}
	return out, nil
}

func (c *ClusterFileSystem) WriteStream(p string, stream io.Reader, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/clusterfs", "ClusterFileSystem.WriteStream", "c", c, "p", p, "stream", stream, "&mode", &mode), &out0)
	return c.backend.Write(normalize(p), stream, "")
}

func (c *ClusterFileSystem) ReadStream(p string) (out0 io.ReadCloser, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.ReadStream", "c", c, "p", p), &out0, &out1)
	return c.backend.OpenRead(normalize(p))
}

func (c *ClusterFileSystem) Walk(root string, walkFn filepath.WalkFunc) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/clusterfs", "ClusterFileSystem.Walk", "c", c, "root", root, "&walkFn", &walkFn), &out0)
	root = normalize(root)
	info, err := c.backend.Stat(root)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return walkFn(root, nil, err)
	}
	return c.walk(root, info, walkFn)
}

func (c *ClusterFileSystem) walk(p string, info Info, walkFn filepath.WalkFunc) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/clusterfs", "ClusterFileSystem.walk", "c", c, "p", p, "&info", &info, "&walkFn", &walkFn), &out0)
	err := walkFn(p, fileInfo{info}, nil)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
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
		logger.DebugErr("filesystem/abstractions/clusterfs", err)
		return walkFn(p, fileInfo{info}, err)
	}
	for _, e := range entries {
		if err := c.walk(e.Path, e, walkFn); err != nil {
			logger.DebugErr("filesystem/abstractions/clusterfs", err)
			return err
		}
	}
	return nil
}

// StorageInfo resolves the replicas of one namespace path through the
// backend. It is what makes cluster:/ files show where their copies are.
func (c *ClusterFileSystem) StorageInfo(p string) (out0 arozfs.StorageInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.StorageInfo", "c", c, "p", p), &out0, &out1)
	backend, ok := c.backend.(InfoBackend)
	if !ok {
		return arozfs.StorageInfo{}, errNoStorageInfo
	}
	return backend.StorageInfo(normalize(p))
}

// ThumbnailKey identifies the content of a file for the thumbnail cache.
func (c *ClusterFileSystem) ThumbnailKey(p string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.ThumbnailKey", "c", c, "p", p), &out0, &out1)
	backend, ok := c.backend.(ThumbnailBackend)
	if !ok {
		return "", arozfs.ErrNoThumbnail
	}
	return backend.ThumbnailKey(normalize(p))
}

// RenderThumbnail has a node holding a copy of the file render its thumbnail.
func (c *ClusterFileSystem) RenderThumbnail(p string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/clusterfs", "ClusterFileSystem.RenderThumbnail", "c", c, "p", p), &out0, &out1)
	backend, ok := c.backend.(ThumbnailBackend)
	if !ok {
		return nil, arozfs.ErrNoThumbnail
	}
	return backend.RenderThumbnail(normalize(p))
}

func (c *ClusterFileSystem) Heartbeat() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/clusterfs", "ClusterFileSystem.Heartbeat", "c", c), &out0)
	if !c.backend.Ready() {
		return errors.New("cluster storage not ready")
	}
	return nil
}
