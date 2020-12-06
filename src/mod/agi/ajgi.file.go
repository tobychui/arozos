package agi

import (
	"errors"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
	fs "imuslab.com/arozos/mod/filesystem"
	user "imuslab.com/arozos/mod/user"
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

func (g *Gateway) injectFileLibFunctions(vm *otto.Otto, u *user.User) {

	//Legacy File system API
	//writeFile(virtualFilepath, content) => return true/false when succeed / failed
	vm.Set("_filelib_writeFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanWrite(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		content, err := call.Argument(1).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check if there is quota for the given length
		if !u.StorageQuota.HaveSpace(int64(len(content))) {
			//User have no remaining storage quota
			g.raiseError(errors.New("Storage Quota Fulled"))
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check if file already exists.
		if fileExists(rpath) {
			//Check if this user own this file
			isOwner := u.IsOwnerOfFile(rpath)
			if isOwner {
				//This user own this system. Remove this file from his quota
				u.RemoveOwnershipFromFile(rpath)
			}
		}

		//Create and write to file using ioutil
		err = ioutil.WriteFile(rpath, []byte(content), 0755)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Add the filesize to user quota
		u.SetOwnerOfFile(rpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	vm.Set("_filelib_deleteFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanWrite(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check if file already exists.
		if fileExists(rpath) {
			//Check if this user own this file
			isOwner := u.IsOwnerOfFile(rpath)
			if isOwner {
				//This user own this system. Remove this file from his quota
				u.RemoveOwnershipFromFile(rpath)
			}
		} else {
			g.raiseError(errors.New("File not exists"))
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Remove the file
		os.Remove(rpath)

		reply, _ := vm.ToValue(true)
		return reply
	})

	//readFile(virtualFilepath) => return content in string
	vm.Set("_filelib_readFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Create and write to file using ioUtil
		content, err := ioutil.ReadFile(rpath)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		reply, _ := vm.ToValue(string(content))
		return reply
	})

	//Listdir
	//readdir("user:/Desktop") => return filelist in array
	vm.Set("_filelib_readdir", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		fileList, err := specialGlob(rpath)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate all paths to virtual paths
		results := []string{}
		for _, file := range fileList {
			if IsDir(file) {
				thisRpath, _ := realpathToVirtualpath(file, u)
				results = append(results, thisRpath)
			}
		}

		reply, _ := vm.ToValue(results)
		return reply
	})

	//Usage
	//filelib.walk("user:/") => list everything recursively
	//filelib.walk("user:/", "folder") => list all folder recursively
	//filelib.walk("user:/", "file") => list all files recursively
	vm.Set("_filelib_walk", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		mode, err := call.Argument(1).ToString()
		if err != nil {
			mode = "all"
		}

		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		results := []string{}
		err = filepath.Walk(rpath, func(path string, info os.FileInfo, err error) error {
			thisVpath, err := realpathToVirtualpath(path, u)
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
	vm.Set("_filelib_glob", func(call otto.FunctionCall) otto.Value {
		regex, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Handle when regex = "." or "./" (listroot)
		if filepath.ToSlash(filepath.Clean(regex)) == "/" || filepath.Clean(regex) == "." {
			//List Root
			rootDirs := []string{}
			fileHandlers := u.GetAllFileSystemHandler()
			for _, fsh := range fileHandlers {
				rootDirs = append(rootDirs, fsh.UUID+":/")
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
			//Translate the virtual path to realpath
			rrootPath, err := virtualPathToRealPath(vrootPath, u)
			if err != nil {
				g.raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}

			suitableFiles, err := filepath.Glob(rrootPath + "/" + regexFilename)
			if err != nil {
				g.raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}

			results := []string{}
			for _, file := range suitableFiles {
				thisRpath, _ := realpathToVirtualpath(filepath.ToSlash(file), u)
				results = append(results, thisRpath)
			}
			reply, _ := vm.ToValue(results)
			return reply
		}
	})

	//Advance Glob using file system special Glob, cannot use to scan root dirs
	vm.Set("_filelib_aglob", func(call otto.FunctionCall) otto.Value {
		regex, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		if regex != "/" && !u.CanRead(regex) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		//This function can only handle wildcard in filename but not in dir name
		vrootPath := filepath.Dir(regex)
		regexFilename := filepath.Base(regex)
		//Translate the virtual path to realpath
		rrootPath, err := virtualPathToRealPath(vrootPath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		suitableFiles, err := specialGlob(rrootPath + "/" + regexFilename)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		results := []string{}
		for _, file := range suitableFiles {
			thisRpath, _ := realpathToVirtualpath(filepath.ToSlash(file), u)
			results = append(results, thisRpath)
		}
		reply, _ := vm.ToValue(results)
		return reply
	})

	//filesize("user:/Desktop/test.txt")
	vm.Set("_filelib_filesize", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Get filesize of file
		rawsize := fs.GetFileSize(rpath)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		reply, _ := vm.ToValue(rawsize)
		return reply
	})

	//fileExists("user:/Desktop/test.txt") => return true / false
	vm.Set("_filelib_fileExists", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		if fileExists(rpath) {
			reply, _ := vm.ToValue(true)
			return reply
		} else {
			reply, _ := vm.ToValue(false)
			return reply
		}
	})

	//fileExists("user:/Desktop/test.txt") => return true / false
	vm.Set("_filelib_isDir", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		if _, err := os.Stat(rpath); os.IsNotExist(err) {
			//File not exists
			panic(vm.MakeCustomError("File Not Exists", "Required path not exists"))
		}

		if IsDir(rpath) {
			reply, _ := vm.ToValue(true)
			return reply
		} else {
			reply, _ := vm.ToValue(false)
			return reply
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
		rdir, err := virtualPathToRealPath(vdir, u)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		//Create the directory at rdir location
		err = os.MkdirAll(rdir, 0755)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		return otto.TrueValue()
	})

	//Get MD5 of the given filepath
	vm.Set("_filelib_md5", func(call otto.FunctionCall) otto.Value {
		log.Println("Call to MD5 Functions!")
		return otto.FalseValue()
	})

	//Get the root name of the given virtual path root
	vm.Set("_filelib_rname", func(call otto.FunctionCall) otto.Value {
		//Get virtual path from the function input
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Get fs handler from the vpath
		fsHandler, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Return the name of the fsHandler
		name, _ := vm.ToValue(fsHandler.Name)
		return name

	})

	vm.Set("_filelib_mtime", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check for permission
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied"))
		}

		parseToUnix, err := call.Argument(1).ToBoolean()
		if err != nil {
			parseToUnix = false
		}

		rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			log.Println(err.Error())
			return otto.FalseValue()
		}

		info, err := os.Stat(rpath)
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

		return otto.TrueValue()
	})

	/*
		vm.Set("_filelib_decodeURI", func(call otto.FunctionCall) otto.Value {
			originalURI, err := call.Argument(0).ToString()
			if err != nil {
				g.raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			decodedURI := specialURIDecode(originalURI)
			result, err := otto.ToValue(decodedURI)
			if err != nil {
				g.raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			return result
		})
	*/

	//Other file operations, wip

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var filelib = {};
		filelib.writeFile = _filelib_writeFile;
		filelib.readFile = _filelib_readFile;
		filelib.deleteFile = _filelib_deleteFile;
		filelib.readdir = _filelib_readdir;
		filelib.walk = _filelib_walk;
		filelib.glob = _filelib_glob;
		filelib.aglob = _filelib_aglob;
		filelib.filesize = _filelib_filesize;
		filelib.fileExists = _filelib_fileExists;
		filelib.isDir = _filelib_isDir;
		filelib.md5 = _filelib_md5;
		filelib.mkdir = _filelib_mkdir;
		filelib.mtime = _filelib_mtime;
		filelib.rname = _filelib_rname;
	`)
}
