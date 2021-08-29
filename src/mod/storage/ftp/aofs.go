package ftp

//arozos virtual path translation handler
//author: tobychui

import (
	"errors"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/afero"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/user"
)

type aofs struct {
	userinfo  *user.User
	tmpFolder string
}

func (a aofs) Create(name string) (afero.File, error) {
	rewritePath, _, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(rewritePath, "write") {
		return nil, errors.New("Permission Denied")
	}
	//log.Println("Create", rewritePath)
	fd, err := os.Create(rewritePath)
	if err != nil {
		return nil, err
	}
	return fd, nil
}

func (a aofs) Mkdir(name string, perm os.FileMode) error {
	rewritePath, _, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(rewritePath, "write") {
		return errors.New("Permission Denied")
	}

	os.Mkdir(rewritePath, perm)
	return nil
}

func (a aofs) MkdirAll(path string, perm os.FileMode) error {
	rewritePath, _, err := a.pathRewrite(path)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(rewritePath, "write") {
		return errors.New("Permission Denied")
	}

	os.MkdirAll(rewritePath, perm)
	return nil
}

func (a aofs) Open(name string) (afero.File, error) {

	rewritePath, _, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(rewritePath, "read") {
		return nil, errors.New("Permission Denied")
	}
	//log.Println("Open", rewritePath)

	fd, err := os.Open(rewritePath)
	if err != nil {
		return nil, err
	}
	return fd, nil

}

func (a aofs) Stat(name string) (os.FileInfo, error) {
	rewritePath, _, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	if !a.checkAllowAccess(rewritePath, "read") {
		return nil, errors.New("Permission Denied")
	}
	//log.Println("Stat", rewritePath)
	fileStat, err := os.Stat(rewritePath)
	return fileStat, err
}

func (a aofs) OpenFile(name string, flag int, perm os.FileMode) (afero.File, error) {
	rewritePath, _, err := a.pathRewrite(name)
	if err != nil {
		return nil, err
	}
	//log.Println("OpenFile", rewritePath)
	if !fileExists(rewritePath) {
		if !a.checkAllowAccess(rewritePath, "write") {
			return nil, errors.New("Directory is Read Only")
		}

		//Set ownership of this file to user.
		//Cannot use SetOwnership due to the filesize of the given file didn't exists yet
		fsh, _ := a.userinfo.GetFileSystemHandlerFromRealPath(rewritePath)
		fsh.CreateFileRecord(rewritePath, a.userinfo.Username)

		//Create the upload pending file
		fd, err := os.Create(rewritePath)
		if err != nil {
			return nil, err
		}
		return fd, nil
	} else {
		if !a.checkAllowAccess(rewritePath, "read") {
			return nil, errors.New("Permission Denied")
		}
		fd, err := os.Open(rewritePath)
		if err != nil {
			return nil, err
		}
		return fd, nil
	}
}

func (a aofs) AllocateSpace(size int) error {
	//log.Println("AllocateSpace", size)
	if a.userinfo.StorageQuota.HaveSpace(int64(size)) {
		return nil
	}
	return errors.New("Storage Quota Fulled")
}

func (a aofs) Remove(name string) error {
	rewritePath, _, err := a.pathRewrite(name)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(rewritePath, "write") {
		return errors.New("Target is Read Only")
	}

	if insideHiddenFolder(rewritePath) {
		//Hidden files, include cache or trash
		return errors.New("Access denied for hidden files")
	}

	log.Println(a.userinfo.Username + " removed " + rewritePath + " via FTP endpoint")
	os.MkdirAll(filepath.Dir(rewritePath)+"/.trash/", 0755)
	os.Rename(rewritePath, filepath.Dir(rewritePath)+"/.trash/"+filepath.Base(rewritePath)+"."+strconv.Itoa(int(time.Now().Unix())))
	return nil
}

func (a aofs) RemoveAll(path string) error {
	rewritePath, _, err := a.pathRewrite(path)
	if err != nil {
		return err
	}
	//log.Println("RemoveAll", rewritePath)
	if insideHiddenFolder(rewritePath) {
		//Hidden files, include cache or trash
		return errors.New("Target is Read Only")
	}
	if !a.checkAllowAccess(rewritePath, "write") {
		return errors.New("Permission Denied")
	}
	os.MkdirAll(filepath.Dir(rewritePath)+"/.trash/", 0755)
	os.Rename(rewritePath, filepath.Dir(rewritePath)+"/.trash/"+filepath.Base(rewritePath)+"."+strconv.Itoa(int(time.Now().Unix())))
	return nil
}

func (a aofs) Rename(oldname, newname string) error {
	oldpath, _, err := a.pathRewrite(oldname)
	if err != nil {
		return err
	}
	newpath, _, err := a.pathRewrite(newname)
	if err != nil {
		return err
	}
	if !a.checkAllowAccess(oldpath, "write") {
		return errors.New("Target is Read Only")
	}
	if !a.checkAllowAccess(newpath, "write") {
		return errors.New("Target is Read Only")
	}
	if fileExists(newpath) {
		return errors.New("File already exists")
	}
	os.Rename(oldpath, newpath)
	//log.Println("Rename", oldpath, newpath)
	return nil

}

func (a aofs) Name() string {
	return "arozos virtualFS"
}

func (a aofs) Chmod(name string, mode os.FileMode) error {
	//log.Println("Chmod", name, mode)
	return nil
}

func (a aofs) Chtimes(name string, atime time.Time, mtime time.Time) error {
	//log.Println("Chtimes", name, atime, mtime)
	return nil
}

//arozos adaptive functions
//This function rewrite the path from ftp representation to real filepath on disk
func (a aofs) pathRewrite(path string) (string, *fs.FileSystemHandler, error) {
	path = filepath.ToSlash(filepath.Clean(path))
	//log.Println("Original path: ", path)
	if path == "/" {
		//Roots. Show ftpbuf root
		fsHandlers := a.userinfo.GetAllFileSystemHandler()
		for _, fsh := range fsHandlers {
			//Create a folder representation for this virtual directory
			if !(fsh.UUID == "tmp" || fsh.Hierarchy == "backup") {
				os.Mkdir(a.tmpFolder+fsh.UUID, 0755)
			}

		}

		readmeContent, err := ioutil.ReadFile("./system/ftp/README.txt")
		if err != nil {
			readmeContent = []byte("DO NOT UPLOAD FILES INTO THE ROOT DIRECTORY")
		}
		ioutil.WriteFile(a.tmpFolder+"README.txt", readmeContent, 0755)

		//Return the tmpFolder root
		tmpfs, _ := a.userinfo.GetFileSystemHandlerFromVirtualPath("tmp:/")
		return a.tmpFolder, tmpfs, nil
	} else if path == "/README.txt" {
		tmpfs, _ := a.userinfo.GetFileSystemHandlerFromVirtualPath("tmp:/")
		return a.tmpFolder + "README.txt", tmpfs, nil
	} else if len(path) > 0 {
		//Rewrite the path for any alternative filepath
		//Get the uuid of the filepath
		path := path[1:]
		subpaths := strings.Split(path, "/")
		fsHandlerUUID := subpaths[0]
		remainingPaths := subpaths[1:]

		//Look for the fsHandler with this UUID
		fsHandlers := a.userinfo.GetAllFileSystemHandler()
		for _, fsh := range fsHandlers {
			//Create a folder representation for this virtual directory
			if fsh.UUID == fsHandlerUUID {
				//This is the correct handler
				if fsh.Hierarchy == "user" {
					return filepath.ToSlash(filepath.Clean(fsh.Path)) + "/users/" + a.userinfo.Username + "/" + strings.Join(remainingPaths, "/"), fsh, nil
				} else if fsh.Hierarchy == "public" {
					return filepath.ToSlash(filepath.Clean(fsh.Path)) + "/" + strings.Join(remainingPaths, "/"), fsh, nil
				}

			}
		}

		//fsh not found.
		return "", nil, errors.New("Path is READ ONLY")
	} else {
		//fsh not found.
		return "", nil, errors.New("Invalid path")
	}
}

//Check if user has access to the given path, mode can be string {read / write}
func (a aofs) checkAllowAccess(path string, mode string) bool {
	//Convert the realpath to virtualpath
	vpath, err := a.userinfo.RealPathToVirtualPath(path)
	if err != nil {
		log.Println("ERROR: " + a.userinfo.Username + " tried to access " + path + " but failed: " + err.Error())
		return false
	}

	if mode == "read" {
		return a.userinfo.CanRead(vpath)
	} else if mode == "write" {
		return a.userinfo.CanWrite(vpath)
	}
	log.Println(path, mode)
	//Unknown path. Return false for security purposes
	return false
}

//Helper functs
func isDir(path string) bool {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return false
	}
	return fileInfo.IsDir()
}

func fileExists(path string) bool {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return false
	}

	return true
}

func insideHiddenFolder(path string) bool {
	thisPathInfo := filepath.ToSlash(filepath.Clean(path))
	pathData := strings.Split(thisPathInfo, "/")
	for _, thispd := range pathData {
		if thispd[:1] == "." {
			//This path contain one of the folder is hidden
			return true
		}
	}
	return false
}
