package tftp

// arozos virtual path translation handler for TFTP
// Similar to FTP aofs implementation but adapted for TFTP

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/afero"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
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

func (a aofs) Create(name string) (out0 afero.File, out1 error) {
	defer logger.Out2(logger.In2("storage/tftp", "aofs.Create", "&a", &a, "name", name), &out0, &out1)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Create(rewritePath)
}

func (a aofs) Chown(name string, uid, gid int) (out0 error) {
	defer logger.Out1(logger.In4("storage/tftp", "aofs.Chown", "&a", &a, "name", name, "uid", uid, "gid", gid), &out0)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Chown(rewritePath, uid, gid)
}

func (a aofs) Mkdir(name string, perm os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("storage/tftp", "aofs.Mkdir", "&a", &a, "name", name, "&perm", &perm), &out0)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Mkdir(rewritePath, perm)
}

func (a aofs) MkdirAll(path string, perm os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("storage/tftp", "aofs.MkdirAll", "&a", &a, "path", path, "&perm", &perm), &out0)
	fsh, rewritePath, err := a.pathRewrite(path)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.MkdirAll(rewritePath, perm)
}

func (a aofs) Open(name string) (out0 afero.File, out1 error) {
	defer logger.Out2(logger.In2("storage/tftp", "aofs.Open", "&a", &a, "name", name), &out0, &out1)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanRead) {
		return nil, errors.New("Permission denied")
	}

	return fsh.FileSystemAbstraction.Open(rewritePath)
}

func (a aofs) Stat(name string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/tftp", "aofs.Stat", "&a", &a, "name", name), &out0, &out1)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanRead) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Stat(rewritePath)
}

func (a aofs) OpenFile(name string, flag int, perm os.FileMode) (out0 afero.File, out1 error) {
	defer logger.Out2(logger.In4("storage/tftp", "aofs.OpenFile", "&a", &a, "name", name, "flag", flag, "&perm", &perm), &out0, &out1)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return nil, err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return nil, errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.OpenFile(rewritePath, flag, perm)
}

func (a aofs) AllocateSpace(size int) (out0 error) {
	defer logger.Out1(logger.In2("storage/tftp", "aofs.AllocateSpace", "&a", &a, "size", size), &out0)
	if a.userinfo.StorageQuota.HaveSpace(int64(size)) {
		return nil
	}
	return errors.New("Storage Quota Full")
}

func (a aofs) Remove(name string) (out0 error) {
	defer logger.Out1(logger.In2("storage/tftp", "aofs.Remove", "&a", &a, "name", name), &out0)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}

	return fsh.FileSystemAbstraction.Remove(rewritePath)
}

func (a aofs) RemoveAll(path string) (out0 error) {
	defer logger.Out1(logger.In2("storage/tftp", "aofs.RemoveAll", "&a", &a, "path", path), &out0)
	fsh, rewritePath, err := a.pathRewrite(path)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.RemoveAll(rewritePath)
}

func (a aofs) Rename(oldname, newname string) (out0 error) {
	defer logger.Out1(logger.In3("storage/tftp", "aofs.Rename", "&a", &a, "oldname", oldname, "newname", newname), &out0)
	fshsrc, rewritePathsrc, err := a.pathRewrite(oldname)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}

	fshdest, rewritePathdest, err := a.pathRewrite(newname)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
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
			logger.DebugErr("storage/tftp", err)
			return err
		}
		defer f.Close()

		err = fshdest.FileSystemAbstraction.WriteStream(rewritePathdest, f, 0775)
		if err != nil {
			logger.DebugErr("storage/tftp", err)
			return err
		}

		err = fshsrc.FileSystemAbstraction.RemoveAll(rewritePathsrc)
		if err != nil {
			logger.DebugErr("storage/tftp", err)
			return err
		}
	}
	return nil
}

func (a aofs) Name() (out0 string) {
	defer logger.Out1(logger.In1("storage/tftp", "aofs.Name", "&a", &a), &out0)
	return "arozos virtualFS (TFTP)"
}

func (a aofs) Chmod(name string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("storage/tftp", "aofs.Chmod", "&a", &a, "name", name, "&mode", &mode), &out0)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Chmod(rewritePath, mode)
}

func (a aofs) Chtimes(name string, atime time.Time, mtime time.Time) (out0 error) {
	defer logger.Out1(logger.In4("storage/tftp", "aofs.Chtimes", "&a", &a, "name", name, "&atime", &atime, "&mtime", &mtime), &out0)
	fsh, rewritePath, err := a.pathRewrite(name)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
		return err
	}
	if !a.checkAllowAccess(fsh, rewritePath, aofsCanWrite) {
		return errors.New("Permission denied")
	}
	return fsh.FileSystemAbstraction.Chtimes(rewritePath, atime, mtime)
}

// arozos adaptive functions
// This function rewrite the path from tftp representation to real filepath on disk
func (a aofs) pathRewrite(path string) (out0 *filesystem.FileSystemHandler, out1 string, out2 error) {
	defer logger.Out3(logger.In2("storage/tftp", "aofs.pathRewrite", "&a", &a, "path", path), &out0, &out1, &out2)
	path = filepath.ToSlash(filepath.Clean(path))

	if path == "/" {
		//Roots. Return TFTP do not list directory error
		return nil, "", errors.New("TFTP does not support directory listing. Use use a valid file path like user:/Desktop/foo.txt")
	} else if len(path) > 0 {
		//Rewrite the path for any alternative filepath
		//Get the uuid of the filepath
		path = strings.TrimPrefix(path, "/")
		path = strings.TrimPrefix(path, "./") // Prevent path traversal
		// Support both /user/Desktop/test.txt or user:/Desktop/test.txt
		path = strings.Replace(path, ":/", "/", 1)
		fmt.Println(path)
		subpaths := strings.Split(path, "/")
		fsHandlerUUID := subpaths[0]
		remainingPaths := subpaths[1:]
		fsh, err := a.userinfo.GetFileSystemHandlerFromVirtualPath(fsHandlerUUID + ":/")
		if err != nil {
			logger.DebugErr("storage/tftp", err)
			return nil, "", errors.New("File System Abstraction not found")
		}

		rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(fsh.UUID+":/"+strings.Join(remainingPaths, "/"), a.userinfo.Username)
		if err != nil {
			logger.DebugErr("storage/tftp", err)
			return nil, "", errors.New("File System Handler Hierarchy not supported by TFTP driver")
		}
		return fsh, rpath, nil
	} else {
		//fsh not found.
		return nil, "", errors.New("Invalid path")
	}
}

// Check if user has access to the given path, mode can be {read / write}
func (a aofs) checkAllowAccess(fsh *filesystem.FileSystemHandler, path string, mode int) (out0 bool) {
	defer logger.Out1(logger.In4("storage/tftp", "aofs.checkAllowAccess", "&a", &a, "fsh", fsh, "path", path, "mode", mode), &out0)
	vpath, err := fsh.FileSystemAbstraction.RealPathToVirtualPath(path, a.userinfo.Username)
	if err != nil {
		logger.DebugErr("storage/tftp", err)
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
