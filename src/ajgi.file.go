package main

import (
	"errors"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
)

/*
	AJGI File Processing Library

	This is a library for handling image related functionalities in agi scripts.

	By Alanyueng 2020 <- This person write shitty code that need me to tidy up (by Toby)
*/

func ajgi_fileLib_init() {
	err := system_ajgi_registerLib("filelib", ajgi_filelib_initFileLibFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func ajgi_filelib_initFileLibFunctions(vm *otto.Otto, username string) {
	//Legacy File system API
	//writeFile(virtualFilepath, content) => return true/false when succeed / failed
	vm.Set("_filelib_writeFile", func(call otto.FunctionCall) otto.Value {
		//If system running in demo mode, reject file writing
		if *demo_mode {
			system_ajgi_raiseError(errors.New("Write request rejected in demo mode"))
			reply, _ := vm.ToValue(false)
			return reply
		}
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		content, err := call.Argument(1).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Create and write to file using ioUtil
		err = ioutil.WriteFile(rpath, []byte(content), 0755)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		reply, _ := vm.ToValue(true)
		return reply
	})

	//readFile(virtualFilepath) => return content in string
	vm.Set("_filelib_readFile", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Create and write to file using ioUtil
		content, err := ioutil.ReadFile(rpath)
		if err != nil {
			system_ajgi_raiseError(err)
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
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		fileList, err := system_fs_specialGlob(rpath)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate all paths to virtual paths
		results := []string{}
		for _, file := range fileList {
			if IsDir(file) {
				thisRpath, _ := realpathToVirtualpath(file, username)
				results = append(results, thisRpath)
			}
		}

		reply, _ := vm.ToValue(results)
		return reply
	})

	//Glob
	//glob("user:/Desktop/*.mp3") => return fileList in array
	vm.Set("_filelib_glob", func(call otto.FunctionCall) otto.Value {
		regex, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//This function can only handle wildcard in filename but not in dir name
		vrootPath := filepath.Dir(regex)
		regexFilename := filepath.Base(regex)
		//Translate the virtual path to realpath
		rrootPath, err := virtualPathToRealPath(vrootPath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		suitableFiles, err := filepath.Glob(rrootPath + "/" + regexFilename)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		results := []string{}
		for _, file := range suitableFiles {
			thisRpath, _ := realpathToVirtualpath(filepath.ToSlash(file), username)
			results = append(results, thisRpath)
		}
		reply, _ := vm.ToValue(results)
		return reply
	})

	vm.Set("_filelib_aglob", func(call otto.FunctionCall) otto.Value {
		regex, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//This function can only handle wildcard in filename but not in dir name
		vrootPath := filepath.Dir(regex)
		regexFilename := filepath.Base(regex)
		//Translate the virtual path to realpath
		rrootPath, err := virtualPathToRealPath(vrootPath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		suitableFiles, err := system_fs_specialGlob(rrootPath + "/" + regexFilename)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		results := []string{}
		for _, file := range suitableFiles {
			thisRpath, _ := realpathToVirtualpath(filepath.ToSlash(file), username)
			results = append(results, thisRpath)
		}
		reply, _ := vm.ToValue(results)
		return reply
	})

	//filesize("user:/Desktop/test.txt")
	vm.Set("_filelib_filesize", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Get filesize of file
		rawsize, _, _, err := system_fs_getFileSize(rpath)
		if err != nil {
			system_ajgi_raiseError(err)
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
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, username)
		if err != nil {
			system_ajgi_raiseError(err)
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
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Translate the virtual path to realpath
		rpath, err := virtualPathToRealPath(vpath, username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
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

		//Translate the path to realpath
		rdir, err := virtualPathToRealPath(vdir, username)
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

	//Other file operations, wip

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var filelib = {};
		filelib.writeFile = _filelib_writeFile;
		filelib.readFile = _filelib_readFile;
		filelib.readdir = _filelib_readdir;
		filelib.glob = _filelib_glob;
		filelib.aglob = _filelib_aglob;
		filelib.filesize = _filelib_filesize;
		filelib.fileExists = _filelib_fileExists;
		filelib.isDir = _filelib_isDir;
		filelib.md5 = _filelib_md5;
		filelib.mkdir = _filelib_mkdir;
	`)
}
