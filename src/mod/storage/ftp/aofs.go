package ftp

//arozos virtual path translation handler
//author: tobychui

import (
	"errors"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/afero"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/user"
)

var (
	aofsCanRead  = 1
	aofsCanWrite = 2
)

type aofs struct {
	userinfo  *user.User
	tmpFolder string
}

func (a aofs) Create(name string) (afero.File, error) {
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Create(rewritePath)
}

func (a aofs) Chown(name string, uid, gid int) error {
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Chown(rewritePath, uid, gid)
}

func (a aofs) Mkdir(name string, perm os.FileMode) error {
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Mkdir(rewritePath, perm)
}

func (a aofs) MkdirAll(path string, perm os.FileMode) error {
	fsh, rewritePath, err := a.pathRewrite(path)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.MkdirAll(rewritePath, perm)
}

func (a aofs) Open(name string) (afero.File, error) {
	//fmt.Println("FTP OPEN")
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Open(rewritePath)
}

func (a aofs) Stat(name string) (os.FileInfo, error) {
	//fmt.Println("FTP STAT")
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanRead) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Stat(rewritePath)
}

func (a aofs) OpenFile(name string, flag int, perm os.FileMode) (afero.File, error) {
	//fmt.Println("FTP OPEN FILE")
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.OpenFile(rewritePath, flag, perm)
}

func (a aofs) AllocateSpace(size int) error {
	if a.userinfo.StorageQuota.HaveSpace(int64(size)) {
		return nil
	}
	return errors.New("Storage Quota Fulled")
}

func (a aofs) Remove(name string) error {
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}

	return fsh.FileSystemAbstraction.Remove(rewritePath)
}

func (a aofs) RemoveAll(path string) error {
	fsh, rewritePath, err := a.pathRewrite(path)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.RemoveAll(rewritePath)
}

func (a aofs) Rename(oldname, newname string) error {
	fshsrc, rewritePathsrc, err := a.pathRewrite(oldname)
	if err != nil {
		return err
	}

	fshdest, rewritePathdest, err := a.pathRewrite(newname)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fshsrc, rewritePathsrc, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	if !a.checkAllowAccess(fshdest, rewritePathdest, aofsCanWrite) {
		return errors.New("Permission denied")
	}

	if !fshdest.FileSystemAbstraction.FileExists(filepath.Dir(rewritePathdest)) {
		fshdest.FileSystemAbstraction.MkdirAll(filepath.Dir(rewritePathdest), 0775)
	}

	if fshsrc.UUID == fshdest.UUID {
		//Renaming in same fsh
		return fshsrc.FileSystemAbstraction.Rename(rewritePathsrc, rewritePathdest)
	} else {
		//Cross fsh read write.
		f, err := fshsrc.FileSystemAbstraction.ReadStream(rewritePathsrc)
		if err != nil {
			return err
		}
		defer f.Close()

		err = fshdest.FileSystemAbstraction.WriteStream(rewritePathdest, f, 0775)
		if err != nil {
			return err
		}

		err = fshsrc.FileSystemAbstraction.RemoveAll(rewritePathsrc)
		if err != nil {
			return err
		}
	}
	return nil
}

func (a aofs) Name() string {
	return "arozos virtualFS"
}

func (a aofs) Chmod(name string, mode os.FileMode) error {
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Chmod(rewritePath, mode)
}

func (a aofs) Chtimes(name string, atime time.Time, mtime time.Time) error {
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Chtimes(rewritePath, atime, mtime)
}

//arozos adaptive functions
//This function rewrite the path from ftp representation to real filepath on disk
func (a aofs) pathRewrite(path string) (*filesystem.FileSystemHandler, string, error) {
	path = filepath.ToSlash(filepath.Clean(path))
	//log.Println("Original path: ", path)
	if path == "/" {
		//Roots. Show ftpbuf root
		fshs := a.userinfo.GetAllFileSystemHandler()
		for _, fsh := range fshs {
			//Create a folder representation for this virtual directory
			if !fsh.RequireBuffer {
				fsh.FileSystemAbstraction.Mkdir(filepath.Join(a.tmpFolder, fsh.UUID), 0755)
			}
		}

		readmeContent, err := ioutil.ReadFile("./system/ftp/README.txt")
		if err != nil {
			readmeContent = []byte("DO NOT UPLOAD FILES INTO THE ROOT DIRECTORY")
		}
		ioutil.WriteFile(filepath.Join(a.tmpFolder, "README.txt"), readmeContent, 0755)

		//Return the tmpFolder root
		tmpfs, _ := a.userinfo.GetFileSystemHandlerFromVirtualPath("tmp:/")
		return tmpfs, a.tmpFolder, nil
	} else if path == "/README.txt" {
		tmpfs, _ := a.userinfo.GetFileSystemHandlerFromVirtualPath("tmp:/")
		return tmpfs, a.tmpFolder + "README.txt", nil
	} else if len(path) > 0 {
		//Rewrite the path for any alternative filepath
		//Get the uuid of the filepath
		path := path[1:]
		subpaths := strings.Split(path, "/")
		fsHandlerUUID := subpaths[0]
		remainingPaths := subpaths[1:]

		fsh, err := a.userinfo.GetFileSystemHandlerFromVirtualPath(fsHandlerUUID + ":")
		if err != nil {
			return nil, "", errors.New("File System Abstraction not found")
		}

		/*
			if fsh.RequireBuffer {
				//Not supported
				return nil, "", errors.New("Buffered file system not supported by FTP driver")
			}
		*/

		rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(fsh.UUID+":/"+strings.Join(remainingPaths, "/"), a.userinfo.Username)
		if err != nil {
			return nil, "", errors.New("File System Handler Hierarchy not supported by FTP driver")
		}
		return fsh, rpath, nil
	} else {
		//fsh not found.
		return nil, "", errors.New("Invalid path")
	}
}

//Check if user has access to the given path, mode can be string {read / write}
func (a aofs) checkAllowAccess(fsh *filesystem.FileSystemHandler, path string, mode int) bool {
	vpath, err := fsh.FileSystemAbstraction.RealPathToVirtualPath(path, a.userinfo.Username)
	if err != nil {
		return false
	}

	if mode == aofsCanRead {
		return a.userinfo.CanRead(vpath)
	} else if mode == aofsCanWrite {
		return a.userinfo.CanWrite(vpath)
	} else {
		return false
	}
}
