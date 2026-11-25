package webdav

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/webdav"
)

// WriteChecker reports whether the user may change a virtual path. The adapters
// write straight to the drive, past the checks of the file handlers, and a user
// may well see a drive their groups can only read.
type WriteChecker func(vpath string) bool

type FshWebDAVAdapter struct {
	fsh      *filesystem.FileSystemHandler
	username string
	canWrite WriteChecker
}

type BufferFsIoHandler struct {
	fsa       filesystem.FileSystemAbstraction
	realpath  string
	filebytes []byte
	reader    *bytes.Reader
}

func (b BufferFsIoHandler) Close() (out0 error) {
	defer logger.Out1(logger.In1("storage/webdav", "BufferFsIoHandler.Close", "&b", &b), &out0)
	return nil
}

func newBufferFsIoHandler(fsa filesystem.FileSystemAbstraction, realpath string) (out0 *BufferFsIoHandler, out1 error) {
	defer logger.Out2(logger.In2("storage/webdav", "newBufferFsIoHandler", "&fsa", &fsa, "realpath", realpath), &out0, &out1)
	if !fsa.FileExists(realpath) {
		return nil, os.ErrExist
	}

	b := BufferFsIoHandler{
		fsa:       fsa,
		realpath:  realpath,
		filebytes: []byte{},
		reader:    nil,
	}

	s, err := b.fsa.Stat(b.realpath)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return nil, err
	}

	if s.Size() > int64(28<<20) {
		//Larger than 28MB, do not allow buffering
		return nil, errors.New("file too large")
	}

	//Buffer remote file to local and store it in file bytes
	if !s.IsDir() {
		c, err := b.fsa.ReadFile(b.realpath)
		if err != nil {
			logger.DebugErr("storage/webdav", err)
			return nil, err
		}
		b.filebytes = c
		b.reader = bytes.NewReader(b.filebytes)
	}

	return &b, nil
}

func (b BufferFsIoHandler) Read(p []byte) (n int, err error) {
	logger.DebugTrace("storage/webdav", "BufferFsIoHandler.Read")
	//fmt.Println("READ", b.realpath)
	return b.reader.Read(p)
}

func (b BufferFsIoHandler) Seek(offset int64, whence int) (int64, error) {
	logger.DebugTrace("storage/webdav", "BufferFsIoHandler.Seek")
	//fmt.Println("SEEK", b.realpath)
	return b.reader.Seek(offset, whence)
}

func (b BufferFsIoHandler) Readdir(count int) (out0 []fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/webdav", "BufferFsIoHandler.Readdir", "&b", &b, "count", count), &out0, &out1)
	//fmt.Println("READDIR", b.realpath)
	de, err := b.fsa.ReadDir(b.realpath)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return []fs.FileInfo{}, err
	}

	if len(de) < count {
		de = de[:count]
	}

	results := []fs.FileInfo{}
	for _, e := range de {
		i, err := e.Info()
		if err != nil {
			logger.DebugErr("storage/webdav", err)
			continue
		}
		results = append(results, i)
	}

	return results, nil
}

func (b BufferFsIoHandler) Stat() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("storage/webdav", "BufferFsIoHandler.Stat", "&b", &b), &out0, &out1)
	//fmt.Println("FSTAT", b.realpath)
	return b.fsa.Stat(b.realpath)
}

func (b BufferFsIoHandler) Write(p []byte) (n int, err error) {
	logger.DebugTrace("storage/webdav", "BufferFsIoHandler.Write")
	//fmt.Println("WRITE", b.realpath)
	r := bytes.NewReader(p)
	err = b.fsa.WriteStream(b.realpath, r, 0777)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return 0, err
	}
	return len(p), nil
}

func NewFshWebDAVAdapter(fsh *filesystem.FileSystemHandler, username string, canWrite WriteChecker) (out0 *FshWebDAVAdapter) {
	defer logger.Out1(logger.In3("storage/webdav", "NewFshWebDAVAdapter", "fsh", fsh, "username", username, "&canWrite", &canWrite), &out0)
	return &FshWebDAVAdapter{
		fsh,
		username,
		canWrite,
	}
}

// requestPathToVpath merges a request path into the virtual path of this drive
func (a *FshWebDAVAdapter) requestPathToVpath(name string) (out0 string) {
	defer logger.Out1(logger.In2("storage/webdav", "FshWebDAVAdapter.requestPathToVpath", "a", a, "name", name), &out0)
	if len(name) == 0 || name[0:1] != "/" {
		name = "/" + name
	}
	return a.fsh.UUID + ":" + name
}

// checkWrite returns an error unless the user may change this request path
func (a *FshWebDAVAdapter) checkWrite(name string) (out0 error) {
	defer logger.Out1(logger.In2("storage/webdav", "FshWebDAVAdapter.checkWrite", "a", a, "name", name), &out0)
	if !a.canWrite(a.requestPathToVpath(name)) {
		return os.ErrPermission
	}
	return nil
}

func (a *FshWebDAVAdapter) requestPathToRealPath(name string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("storage/webdav", "FshWebDAVAdapter.requestPathToRealPath", "a", a, "name", name), &out0, &out1)
	fullVpath := a.requestPathToVpath(name)
	realRequestPath, err := a.fsh.FileSystemAbstraction.VirtualPathToRealPath(fullVpath, a.username)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return "", err
	}

	realRequestPath = arozfs.ToSlash(realRequestPath)
	return realRequestPath, nil
}

func (a *FshWebDAVAdapter) Mkdir(ctx context.Context, name string, perm os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("storage/webdav", "FshWebDAVAdapter.Mkdir", "a", a, "ctx", ctx, "name", name, "&perm", &perm), &out0)
	if err := a.checkWrite(name); err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}
	return a.fsh.FileSystemAbstraction.Mkdir(realRequestPath, perm)
}
func (a *FshWebDAVAdapter) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (out0 webdav.File, out1 error) {
	defer logger.Out2(logger.In5("storage/webdav", "FshWebDAVAdapter.OpenFile", "a", a, "ctx", ctx, "name", name, "flag", flag, "&perm", &perm), &out0, &out1)
	if flag&(os.O_WRONLY|os.O_RDWR|os.O_CREATE|os.O_TRUNC|os.O_APPEND) != 0 {
		if err := a.checkWrite(name); err != nil {
			logger.DebugErr("storage/webdav", err)
			return nil, err
		}
	}

	//The name come in as the relative path of the request vpath (e.g. user:/Video/test.mp4 will get requested as /Video/test.mp4)
	//Merge it into a proper vpath and perform abstraction path translation
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		logger.PrintAndLog("Webdav", fmt.Sprint(err), nil)
		return nil, err
	}

	if a.fsh.RequireBuffer {
		//Buffer the remote content to local for access
		return newBufferFsIoHandler(a.fsh.FileSystemAbstraction, realRequestPath)
	} else {
		return a.fsh.FileSystemAbstraction.OpenFile(realRequestPath, flag, perm)
	}
}
func (a *FshWebDAVAdapter) RemoveAll(ctx context.Context, name string) (out0 error) {
	defer logger.Out1(logger.In3("storage/webdav", "FshWebDAVAdapter.RemoveAll", "a", a, "ctx", ctx, "name", name), &out0)
	if err := a.checkWrite(name); err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}
	return a.fsh.FileSystemAbstraction.RemoveAll(realRequestPath)
}
func (a *FshWebDAVAdapter) Rename(ctx context.Context, oldName, newName string) (out0 error) {
	defer logger.Out1(logger.In4("storage/webdav", "FshWebDAVAdapter.Rename", "a", a, "ctx", ctx, "oldName", oldName, "newName", newName), &out0)
	if err := a.checkWrite(oldName); err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}
	if err := a.checkWrite(newName); err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}
	realOldname, err := a.requestPathToRealPath(oldName)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}

	realNewname, err := a.requestPathToRealPath(newName)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return err
	}

	return a.fsh.FileSystemAbstraction.Rename(realOldname, realNewname)
}
func (a *FshWebDAVAdapter) Stat(ctx context.Context, name string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In3("storage/webdav", "FshWebDAVAdapter.Stat", "a", a, "ctx", ctx, "name", name), &out0, &out1)
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		logger.DebugErr("storage/webdav", err)
		return nil, err
	}

	s, e := a.fsh.FileSystemAbstraction.Stat(realRequestPath)
	//fmt.Println("STAT ", realRequestPath, s, e)
	return s, e
}
