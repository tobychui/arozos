package webdav

/*
	WebDAV virtual root

	Serves every storage a user can reach under one WebDAV endpoint, the
	same way the FTP server does: the root is a read-only in-memory listing
	with one folder per storage (named by its UUID), and every path below
	such a folder is handed to that storage's FshWebDAVAdapter. So
	/webdav/user/Video maps to user:/Video, which also keeps the old
	per-root URLs (/webdav/{vroot_name}) working.
*/

import (
	"context"
	"os"
	"path"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/webdav"
)

type RootFsWebDAVAdapter struct {
	fshs     []*filesystem.FileSystemHandler
	adapters map[string]*FshWebDAVAdapter
}

// NewRootFsWebDAVAdapter builds the virtual root over the given storages.
// It is built per request, so newly mounted or closed storages show up
// immediately.
func NewRootFsWebDAVAdapter(fshs []*filesystem.FileSystemHandler, username string, canWrite WriteChecker) *RootFsWebDAVAdapter {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "NewRootFsWebDAVAdapter: len(fshs)=%d username=%.120q", len(fshs), username)
	}
	adapters := map[string]*FshWebDAVAdapter{}
	for _, fsh := range fshs {
		adapters[fsh.UUID] = NewFshWebDAVAdapter(fsh, username, canWrite)
	}
	return &RootFsWebDAVAdapter{
		fshs:     fshs,
		adapters: adapters,
	}
}

// splitRootPath cleans a request path and splits it into the storage UUID
// and the path inside that storage. An empty UUID means the root itself.
func splitRootPath(name string) (string, string) {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "splitRootPath: name=%.120q", name)
	}
	name = path.Clean("/" + name)
	if name == "/" {
		return "", "/"
	}
	parts := strings.SplitN(name[1:], "/", 2)
	if len(parts) == 1 {
		return parts[0], "/"
	}
	return parts[0], "/" + parts[1]
}

// isRootLevel reports whether name is the root or an entry directly inside
// it. Those entries are the storages themselves and cannot be changed.
func isRootLevel(name string) bool {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "isRootLevel: name=%.120q", name)
	}
	_, subpath := splitRootPath(name)
	return subpath == "/"
}

// resolve returns the adapter of the storage that holds name and the path
// inside it. adapter is nil (with a nil error) for the root itself.
func (a *RootFsWebDAVAdapter) resolve(name string) (*FshWebDAVAdapter, string, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.resolve: name=%.120q", name)
	}
	uuid, subpath := splitRootPath(name)
	if uuid == "" {
		return nil, "/", nil
	}
	adapter, ok := a.adapters[uuid]
	if !ok {
		return nil, "", os.ErrNotExist
	}
	return adapter, subpath, nil
}

// rootFs builds the root listing as an in-memory file system holding one
// folder per storage.
func (a *RootFsWebDAVAdapter) rootFs(ctx context.Context) webdav.FileSystem {
	logger.Debug("storage/webdav", "RootFsWebDAVAdapter.rootFs")
	memfs := webdav.NewMemFS()
	for _, fsh := range a.fshs {
		memfs.Mkdir(ctx, "/"+fsh.UUID, 0555)
	}
	return memfs
}

// VirtualPath maps a request path to an arozos virtual path (e.g. user:/Video)
// and its storage. It fails for the root, which has no virtual path.
func (a *RootFsWebDAVAdapter) VirtualPath(name string) (*filesystem.FileSystemHandler, string, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.VirtualPath: name=%.120q", name)
	}
	adapter, subpath, err := a.resolve(name)
	if err != nil {
		return nil, "", err
	}
	if adapter == nil {
		return nil, "", os.ErrInvalid
	}
	return adapter.fsh, adapter.fsh.UUID + ":" + subpath, nil
}

func (a *RootFsWebDAVAdapter) Mkdir(ctx context.Context, name string, perm os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.Mkdir: name=%.120q", name)
	}
	if isRootLevel(name) {
		return os.ErrPermission
	}
	adapter, subpath, err := a.resolve(name)
	if err != nil {
		return err
	}
	return adapter.Mkdir(ctx, subpath, perm)
}

func (a *RootFsWebDAVAdapter) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (webdav.File, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.OpenFile: name=%.120q flag=%d", name, flag)
	}
	if isRootLevel(name) && flag&(os.O_WRONLY|os.O_RDWR|os.O_CREATE|os.O_TRUNC|os.O_APPEND) != 0 {
		return nil, os.ErrPermission
	}
	adapter, subpath, err := a.resolve(name)
	if err != nil {
		return nil, err
	}
	if adapter == nil {
		return a.rootFs(ctx).OpenFile(ctx, "/", os.O_RDONLY, 0)
	}

	f, err := adapter.OpenFile(ctx, subpath, flag, perm)
	if err != nil || subpath != "/" {
		return f, err
	}
	return renamedFile{f, adapter.fsh.UUID}, nil
}

func (a *RootFsWebDAVAdapter) RemoveAll(ctx context.Context, name string) error {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.RemoveAll: name=%.120q", name)
	}
	if isRootLevel(name) {
		return os.ErrPermission
	}
	adapter, subpath, err := a.resolve(name)
	if err != nil {
		return err
	}
	return adapter.RemoveAll(ctx, subpath)
}

func (a *RootFsWebDAVAdapter) Rename(ctx context.Context, oldName, newName string) error {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.Rename: oldName=%.120q newName=%.120q", oldName, newName)
	}
	if isRootLevel(oldName) || isRootLevel(newName) {
		return os.ErrPermission
	}
	srcAdapter, srcPath, err := a.resolve(oldName)
	if err != nil {
		return err
	}
	destAdapter, destPath, err := a.resolve(newName)
	if err != nil {
		return err
	}

	if srcAdapter == destAdapter {
		//Renaming in same fsh
		return srcAdapter.Rename(ctx, srcPath, destPath)
	}

	//Cross fsh move. Copy everything over, then remove the source
	if err := srcAdapter.checkWrite(srcPath); err != nil {
		return err
	}
	if err := destAdapter.checkWrite(destPath); err != nil {
		return err
	}
	realSrc, err := srcAdapter.requestPathToRealPath(srcPath)
	if err != nil {
		return err
	}
	realDest, err := destAdapter.requestPathToRealPath(destPath)
	if err != nil {
		return err
	}
	srcFsa := srcAdapter.fsh.FileSystemAbstraction
	err = copyAcrossFsh(srcFsa, realSrc, destAdapter.fsh.FileSystemAbstraction, realDest)
	if err != nil {
		return err
	}
	return srcFsa.RemoveAll(realSrc)
}

func (a *RootFsWebDAVAdapter) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/webdav", "RootFsWebDAVAdapter.Stat: name=%.120q", name)
	}
	adapter, subpath, err := a.resolve(name)
	if err != nil {
		return nil, err
	}
	if adapter == nil {
		return a.rootFs(ctx).Stat(ctx, "/")
	}

	s, err := adapter.Stat(ctx, subpath)
	if err != nil {
		return nil, err
	}
	if subpath == "/" {
		//Show the storage folder under its UUID instead of the name of its
		//folder on disk
		return renamedFileInfo{s, adapter.fsh.UUID}, nil
	}
	return s, nil
}

// copyAcrossFsh copies a file or folder tree from one storage to another.
func copyAcrossFsh(srcFsa filesystem.FileSystemAbstraction, src string, destFsa filesystem.FileSystemAbstraction, dest string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/webdav", "copyAcrossFsh: src=%.120q dest=%.120q", src, dest)
	}
	s, err := srcFsa.Stat(src)
	if err != nil {
		return err
	}

	if !s.IsDir() {
		f, err := srcFsa.ReadStream(src)
		if err != nil {
			return err
		}
		defer f.Close()
		return destFsa.WriteStream(dest, f, 0775)
	}

	err = destFsa.MkdirAll(dest, 0775)
	if err != nil {
		return err
	}
	entries, err := srcFsa.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		err = copyAcrossFsh(srcFsa, path.Join(src, entry.Name()), destFsa, path.Join(dest, entry.Name()))
		if err != nil {
			return err
		}
	}
	return nil
}

// renamedFileInfo reports a different name for an existing FileInfo.
type renamedFileInfo struct {
	os.FileInfo
	name string
}

func (r renamedFileInfo) Name() string {
	logger.DebugTrace("storage/webdav", "renamedFileInfo.Name")
	return r.name
}

// renamedFile is the root folder of a storage opened through the virtual
// root, which reports the storage UUID as its name like Stat does.
type renamedFile struct {
	webdav.File
	name string
}

func (r renamedFile) Stat() (os.FileInfo, error) {
	logger.Debug("storage/webdav", "renamedFile.Stat")
	s, err := r.File.Stat()
	if err != nil {
		return nil, err
	}
	return renamedFileInfo{s, r.name}, nil
}
