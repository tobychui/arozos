package agi

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem/fssort"
	"imuslab.com/arozos/mod/filesystem/hidden"
)

/*
	AJGI File Processing Library

	This is a library for handling image related functionalities in agi scripts.

	By Alanyueng 2020 <- This person write shitty code that need me to tidy up (by tobychui)
	Complete rewrite by tobychui in Sept 2020
*/

func (g *Gateway) FileLibRegister() {
	err := g.RegisterLib("filelib", g.injectFileLibFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectFileLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	//w := payload.Writer
	//r := payload.Request

	//writeFile(virtualFilepath, content) => return true/false when succeed / failed
	vm.Set("_filelib_writeFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanWrite(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		content, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Check if there is quota for the given length
		if !u.StorageQuota.HaveSpace(int64(len(content))) {
			//User have no remaining storage quota
			g.RaiseError(errors.New("Storage Quota Fulled"))
			return otto.FalseValue()
		}

		//Translate the virtual path to realpath
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Check if file already exists.
		if fsh.FileSystemAbstraction.FileExists(rpath) {
			//Check if this user own this file
			isOwner := u.IsOwnerOfFile(fsh, vpath)
			if isOwner {
				//This user own this system. Remove this file from his quota
				u.RemoveOwnershipFromFile(fsh, vpath)
			}
		}

		//Create and write to file using ioutil
		err = fsh.FileSystemAbstraction.WriteFile(rpath, []byte(content), 0755)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Add the filesize to user quota
		u.SetOwnerOfFile(fsh, vpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	vm.Set("_filelib_deleteFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanWrite(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		//Translate the virtual path to realpath
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Check if file already exists.
		if fsh.FileSystemAbstraction.FileExists(rpath) {
			//Check if this user own this file
			isOwner := u.IsOwnerOfFile(fsh, vpath)
			if isOwner {
				//This user own this system. Remove this file from his quota
				u.RemoveOwnershipFromFile(fsh, vpath)
			}
		} else {
			g.RaiseError(errors.New("File not exists"))
			return otto.FalseValue()
		}

		//Remove the file
		fsh.FileSystemAbstraction.Remove(rpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	//readFile(virtualFilepath) => return content in string
	vm.Set("_filelib_readFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		//Translate the virtual path to realpath
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Create and write to file using ioUtil
		content, err := fsh.FileSystemAbstraction.ReadFile(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		reply, _ := vm.ToValue(string(content))
		return reply
	})

	//Usage
	//filelib.walk("user:/") => list everything recursively
	//filelib.walk("user:/", "folder") => list all folder recursively
	//filelib.walk("user:/", "file") => list all files recursively
	vm.Set("_filelib_walk", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		mode, err := call.Argument(1).ToString()
		if err != nil {
			mode = "all"
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		results := []string{}
		fsh.FileSystemAbstraction.Walk(rpath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				//Ignore this error file and continue
				return nil
			}
			thisVpath, err := static.RealpathToVirtualpath(fsh, path, u)
			if err != nil {
				return nil
			}
			if mode == "file" {
				if !info.IsDir() {
					results = append(results, thisVpath)
				}
			} else if mode == "folder" {
				if info.IsDir() {
					results = append(results, thisVpath)
				}
			} else {
				results = append(results, thisVpath)
			}

			return nil
		})

		reply, _ := vm.ToValue(results)
		return reply
	})

	//Glob
	//glob("user:/Desktop/*.mp3") => return fileList in array
	//glob("/") => return a list of root directories
	//glob("user:/Desktop/*", "mostRecent") => return fileList in mostRecent sorting mode
	//glob("user:/Desktop/*", "user") => return fileList in array in user prefered sorting method
	vm.Set("_filelib_glob", func(call otto.FunctionCall) otto.Value {
		regex, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		userSortMode, err := call.Argument(1).ToString()
		if err != nil || userSortMode == "" || userSortMode == "undefined" {
			userSortMode = "default"
		}

		//Handle when regex = "." or "./" (listroot)
		if filepath.ToSlash(filepath.Clean(regex)) == "/" || filepath.Clean(regex) == "." {
			//List Root
			rootDirs := []string{}
			fileHandlers := u.GetAllFileSystemHandler()
			for _, fsh := range fileHandlers {
				if fsh.Hierarchy == "backup" {

				} else {
					rootDirs = append(rootDirs, fsh.UUID+":/")
				}
			}

			reply, _ := vm.ToValue(rootDirs)
			return reply
		} else {
			//Check for permission
			if !u.CanRead(regex) {
				panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
			}
			//This function can only handle wildcard in filename but not in dir name
			vrootPath := filepath.Dir(regex)
			regexFilename := filepath.Base(regex)

			//Rewrite and validate the sort mode
			if userSortMode == "user" {
				//Use user sorting mode.
				if g.Option.UserHandler.GetDatabase().KeyExists("fs-sortpref", u.Username+"/"+filepath.ToSlash(filepath.Clean(vrootPath))) {
					g.Option.UserHandler.GetDatabase().Read("fs-sortpref", u.Username+"/"+filepath.ToSlash(filepath.Clean(vrootPath)), &userSortMode)
				} else {
					userSortMode = "default"
				}
			}

			if !fssort.SortModeIsSupported(userSortMode) {
				log.Println("[AGI] Sort mode: " + userSortMode + " not supported. Using default")
				userSortMode = "default"
			}

			//Translate the virtual path to realpath
			fsh, rrootPath, err := static.VirtualPathToRealPath(vrootPath, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}

			suitableFiles, err := fsh.FileSystemAbstraction.Glob(filepath.Join(rrootPath, regexFilename))
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}

			fileList := []string{}
			fis := []fs.FileInfo{}
			for _, thisFile := range suitableFiles {
				fi, err := fsh.FileSystemAbstraction.Stat(thisFile)
				if err == nil {
					fileList = append(fileList, thisFile)
					fis = append(fis, fi)
				}
			}

			//Sort the files
			newFilelist := fssort.SortFileList(fileList, fis, userSortMode)

			//Return the results in virtual paths
			results := []string{}
			for _, file := range newFilelist {
				isHidden, _ := hidden.IsHidden(file, true)
				if isHidden {
					//Hidden file. Skip this
					continue
				}
				thisVpath, _ := static.RealpathToVirtualpath(fsh, file, u)
				results = append(results, thisVpath)
			}
			reply, _ := vm.ToValue(results)
			return reply
		}
	})

	//Advance Glob using file system special Glob, cannot use to scan root dirs
	vm.Set("_filelib_aglob", func(call otto.FunctionCall) otto.Value {
		regex, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		userSortMode, err := call.Argument(1).ToString()
		if err != nil || userSortMode == "" || userSortMode == "undefined" {
			userSortMode = "default"
		}

		if regex != "/" && !u.CanRead(regex) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		//This function can only handle wildcard in filename but not in dir name
		vrootPath := filepath.Dir(regex)
		regexFilename := filepath.Base(regex)

		//Rewrite and validate the sort mode
		if userSortMode == "user" {
			//Use user sorting mode.
			if g.Option.UserHandler.GetDatabase().KeyExists("fs-sortpref", u.Username+"/"+filepath.ToSlash(filepath.Clean(vrootPath))) {
				g.Option.UserHandler.GetDatabase().Read("fs-sortpref", u.Username+"/"+filepath.ToSlash(filepath.Clean(vrootPath)), &userSortMode)
			} else {
				userSortMode = "default"
			}
		}

		if !fssort.SortModeIsSupported(userSortMode) {
			log.Println("[AGI] Sort mode: " + userSortMode + " not supported. Using default")
			userSortMode = "default"
		}

		//Translate the virtual path to realpath
		fsh, err := u.GetFileSystemHandlerFromVirtualPath(vrootPath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fshAbs := fsh.FileSystemAbstraction
		rrootPath, _ := fshAbs.VirtualPathToRealPath(vrootPath, u.Username)
		suitableFiles, err := fshAbs.Glob(filepath.Join(rrootPath, regexFilename))
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		fileList := []string{}
		fis := []fs.FileInfo{}
		for _, thisFile := range suitableFiles {
			fi, err := fsh.FileSystemAbstraction.Stat(thisFile)
			if err == nil {
				fileList = append(fileList, thisFile)
				fis = append(fis, fi)
			}
		}

		//Sort the files
		newFilelist := fssort.SortFileList(fileList, fis, userSortMode)

		//Parse the results (Only extract the filepath)
		results := []string{}
		for _, filename := range newFilelist {
			isHidden, _ := hidden.IsHidden(filename, true)
			if isHidden {
				//Hidden file. Skip this
				continue
			}
			thisVpath, _ := static.RealpathToVirtualpath(fsh, filename, u)
			results = append(results, thisVpath)
		}
		reply, _ := vm.ToValue(results)
		return reply
	})

	vm.Set("_filelib_readdir", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		userSortMode, err := call.Argument(1).ToString()
		if err != nil || userSortMode == "" || userSortMode == "undefined" {
			userSortMode = "default"
		}

		//Rewrite and validate the sort mode
		if userSortMode == "user" {
			//Use user sorting mode.
			if g.Option.UserHandler.GetDatabase().KeyExists("fs-sortpref", u.Username+"/"+filepath.ToSlash(filepath.Clean(vpath))) {
				g.Option.UserHandler.GetDatabase().Read("fs-sortpref", u.Username+"/"+filepath.ToSlash(filepath.Clean(vpath)), &userSortMode)
			} else {
				userSortMode = "default"
			}
		}

		if !fssort.SortModeIsSupported(userSortMode) {
			log.Println("[AGI] Sort mode: " + userSortMode + " not supported. Using default")
			userSortMode = "default"
		}

		fsh, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fshAbs := fsh.FileSystemAbstraction
		rpath, err := fshAbs.VirtualPathToRealPath(vpath, u.Username)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		dirEntry, err := fshAbs.ReadDir(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		type fileInfo struct {
			Filename string
			Filepath string
			Ext      string
			Filesize int64
			Modtime  int64
			IsDir    bool
		}

		//Sort the dirEntry by file info, a bit slow :(
		if userSortMode != "default" {
			//Prepare the data structure for sorting
			newDirEntry := fssort.SortDirEntryList(dirEntry, userSortMode)
			dirEntry = newDirEntry
		}

		results := []fileInfo{}
		for _, de := range dirEntry {
			isHidden, _ := hidden.IsHidden(de.Name(), false)
			if isHidden {
				continue
			}
			fstat, _ := de.Info()
			vpath, _ := static.RealpathToVirtualpath(fsh, filepath.ToSlash(filepath.Join(rpath, de.Name())), u)

			thisInfo := fileInfo{
				Filename: de.Name(),
				Filepath: vpath,
				Ext:      filepath.Ext(de.Name()),
				Filesize: fstat.Size(),
				Modtime:  fstat.ModTime().Unix(),
				IsDir:    de.IsDir(),
			}

			results = append(results, thisInfo)
		}

		js, _ := json.Marshal(results)
		r, _ := vm.ToValue(string(js))
		return r
	})

	//filesize("user:/Desktop/test.txt")
	vm.Set("_filelib_filesize", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		fsh, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fshAbs := fsh.FileSystemAbstraction
		rpath, err := fshAbs.VirtualPathToRealPath(vpath, u.Username)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Get filesize of file
		rawsize := fshAbs.GetFileSize(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		reply, _ := vm.ToValue(rawsize)
		return reply
	})

	//fileExists("user:/Desktop/test.txt") => return true / false
	vm.Set("_filelib_fileExists", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		fsh, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fshAbs := fsh.FileSystemAbstraction
		rpath, err := fshAbs.VirtualPathToRealPath(vpath, u.Username)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		if fshAbs.FileExists(rpath) {
			return otto.TrueValue()
		} else {
			return otto.FalseValue()
		}
	})

	//fileExists("user:/Desktop/test.txt") => return true / false
	vm.Set("_filelib_isDir", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		//Translate the virtual path to realpath
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		if _, err := fsh.FileSystemAbstraction.Stat(rpath); os.IsNotExist(err) {
			//File not exists
			panic(vm.MakeCustomError("File Not Exists", "Required path not exists"))
		}

		if fsh.FileSystemAbstraction.IsDir(rpath) {
			return otto.TrueValue()
		} else {
			return otto.FalseValue()
		}
	})

	//Make directory command
	vm.Set("_filelib_mkdir", func(call otto.FunctionCall) otto.Value {
		vdir, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		//Check for permission
		if !u.CanWrite(vdir) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		//Translate the path to realpath
		fsh, rdir, err := static.VirtualPathToRealPath(vdir, u)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		//Create the directory at rdir location
		err = fsh.FileSystemAbstraction.MkdirAll(rdir, 0755)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		return otto.TrueValue()
	})

	//Get MD5 of the given filepath, not implemented
	vm.Set("_filelib_md5", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		fsh, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fshAbs := fsh.FileSystemAbstraction
		rpath, err := fshAbs.VirtualPathToRealPath(vpath, u.Username)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		f, err := fshAbs.ReadStream(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		defer f.Close()
		h := md5.New()
		if _, err := io.Copy(h, f); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		md5Sum := hex.EncodeToString(h.Sum(nil))
		result, _ := vm.ToValue(md5Sum)
		return result
	})

	//Get the root name of the given virtual path root
	vm.Set("_filelib_rname", func(call otto.FunctionCall) otto.Value {
		//Get virtual path from the function input
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Get fs handler from the vpath
		fsHandler, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Return the name of the fsHandler
		name, _ := vm.ToValue(fsHandler.Name)
		return name

	})

	vm.Set("_filelib_mtime", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		parseToUnix, err := call.Argument(1).ToBoolean()
		if err != nil {
			parseToUnix = false
		}

		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		info, err := fsh.FileSystemAbstraction.Stat(rpath)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		modTime := info.ModTime()
		if parseToUnix {
			result, _ := otto.ToValue(modTime.Unix())
			return result
		} else {
			result, _ := otto.ToValue(modTime.Format("2006-01-02 15:04:05"))
			return result
		}
	})

	//ArozOS v2.0 New features
	//Reading or writing from hex to target virtual filepath

	//Write binary from hex string
	vm.Set("_filelib_writeBinaryFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanWrite(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		hexContent, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Get the target vpath
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		//Decode the hex content to bytes
		hexContentInByte, err := hex.DecodeString(hexContent)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Write the file to target file
		err = fsh.FileSystemAbstraction.WriteFile(rpath, hexContentInByte, 0775)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		return otto.TrueValue()

	})

	//Read file from external fsh. Small file only
	vm.Set("_filelib_readBinaryFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		//Rewrite the vpath if it is relative
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		//Get the target vpath
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		if !fsh.FileSystemAbstraction.FileExists(rpath) {
			//Check if the target file exists
			g.RaiseError(err)
			return otto.NullValue()
		}

		content, err := fsh.FileSystemAbstraction.ReadFile(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		hexifiedContent := hex.EncodeToString(content)
		val, _ := vm.ToValue(hexifiedContent)
		return val

	})

	//Other file operations, wip

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var filelib = {};
		filelib.writeFile = _filelib_writeFile;
		filelib.readFile = _filelib_readFile;
		filelib.deleteFile = _filelib_deleteFile;
		filelib.walk = _filelib_walk;
		filelib.glob = _filelib_glob;
		filelib.aglob = _filelib_aglob;
		filelib.filesize = _filelib_filesize;
		filelib.fileExists = _filelib_fileExists;
		filelib.isDir = _filelib_isDir;
		filelib.md5 = _filelib_md5;
		filelib.mkdir = _filelib_mkdir;
		filelib.mtime = _filelib_mtime;
		filelib.rootName = _filelib_rname;

		filelib.readdir = function(path, sortmode){
			var s = _filelib_readdir(path, sortmode);
			return JSON.parse(s);
		};
	`)
}
