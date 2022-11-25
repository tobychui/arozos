package webdav

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/network/webdav"
)

type FshWebDAVAdapter struct {
	fsh      *filesystem.FileSystemHandler
	username string
}

func NewFshWebDAVAdapter(fsh *filesystem.FileSystemHandler, username string) *FshWebDAVAdapter {
	return &FshWebDAVAdapter{
		fsh,
		username,
	}
}

func (a *FshWebDAVAdapter) requestPathToRealPath(name string) (string, error) {
	fullVpath := a.fsh.UUID + ":" + name
	realRequestPath, err := a.fsh.FileSystemAbstraction.VirtualPathToRealPath(fullVpath, a.username)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(realRequestPath), nil
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
		//WIP

		return nil, errors.New("work in progress")
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
	return a.fsh.FileSystemAbstraction.Stat(realRequestPath)
}
