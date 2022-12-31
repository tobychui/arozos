package webdav

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"log"
	"os"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/network/webdav"
)

type FshWebDAVAdapter struct {
	fsh      *filesystem.FileSystemHandler
	username string
}

type BufferFsIoHandler struct {
	fsa       filesystem.FileSystemAbstraction
	realpath  string
	filebytes []byte
	reader    *bytes.Reader
}

func (b BufferFsIoHandler) Close() error {
	return nil
}

func newBufferFsIoHandler(fsa filesystem.FileSystemAbstraction, realpath string) (*BufferFsIoHandler, error) {
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
			return nil, err
		}
		b.filebytes = c
		b.reader = bytes.NewReader(b.filebytes)
	}

	return &b, nil
}

func (b BufferFsIoHandler) Read(p []byte) (n int, err error) {
	//fmt.Println("READ", b.realpath)
	return b.reader.Read(p)
}

func (b BufferFsIoHandler) Seek(offset int64, whence int) (int64, error) {
	//fmt.Println("SEEK", b.realpath)
	return b.reader.Seek(offset, whence)
}

func (b BufferFsIoHandler) Readdir(count int) ([]fs.FileInfo, error) {
	//fmt.Println("READDIR", b.realpath)
	de, err := b.fsa.ReadDir(b.realpath)
	if err != nil {
		return []fs.FileInfo{}, err
	}

	if len(de) < count {
		de = de[:count]
	}

	results := []fs.FileInfo{}
	for _, e := range de {
		i, err := e.Info()
		if err != nil {
			continue
		}
		results = append(results, i)
	}

	return results, nil
}

func (b BufferFsIoHandler) Stat() (fs.FileInfo, error) {
	//fmt.Println("FSTAT", b.realpath)
	return b.fsa.Stat(b.realpath)
}

func (b BufferFsIoHandler) Write(p []byte) (n int, err error) {
	//fmt.Println("WRITE", b.realpath)
	r := bytes.NewReader(p)
	err = b.fsa.WriteStream(b.realpath, r, 0777)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

func NewFshWebDAVAdapter(fsh *filesystem.FileSystemHandler, username string) *FshWebDAVAdapter {
	return &FshWebDAVAdapter{
		fsh,
		username,
	}
}

func (a *FshWebDAVAdapter) requestPathToRealPath(name string) (string, error) {
	if len(name) == 0 || name[0:1] != "/" {
		name = "/" + name
	}
	fullVpath := a.fsh.UUID + ":" + name
	realRequestPath, err := a.fsh.FileSystemAbstraction.VirtualPathToRealPath(fullVpath, a.username)
	if err != nil {
		return "", err
	}

	realRequestPath = arozfs.ToSlash(realRequestPath)
	return realRequestPath, nil
}

func (a *FshWebDAVAdapter) Mkdir(ctx context.Context, name string, perm os.FileMode) error {
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		return err
	}
	return a.fsh.FileSystemAbstraction.Mkdir(realRequestPath, perm)
}
func (a *FshWebDAVAdapter) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (webdav.File, error) {
	//The name come in as the relative path of the request vpath (e.g. user:/Video/test.mp4 will get requested as /Video/test.mp4)
	//Merge it into a proper vpath and perform abstraction path translation
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		log.Println(err)
		return nil, err
	}

	if a.fsh.RequireBuffer {
		//Buffer the remote content to local for access
		return newBufferFsIoHandler(a.fsh.FileSystemAbstraction, realRequestPath)
	} else {
		return a.fsh.FileSystemAbstraction.OpenFile(realRequestPath, flag, perm)
	}
}
func (a *FshWebDAVAdapter) RemoveAll(ctx context.Context, name string) error {
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		return err
	}
	return a.fsh.FileSystemAbstraction.RemoveAll(realRequestPath)
}
func (a *FshWebDAVAdapter) Rename(ctx context.Context, oldName, newName string) error {
	realOldname, err := a.requestPathToRealPath(oldName)
	if err != nil {
		return err
	}

	realNewname, err := a.requestPathToRealPath(newName)
	if err != nil {
		return err
	}

	return a.fsh.FileSystemAbstraction.Rename(realOldname, realNewname)
}
func (a *FshWebDAVAdapter) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	realRequestPath, err := a.requestPathToRealPath(name)
	if err != nil {
		return nil, err
	}

	s, e := a.fsh.FileSystemAbstraction.Stat(realRequestPath)
	//fmt.Println("STAT ", realRequestPath, s, e)
	return s, e
}
