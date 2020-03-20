package main

import (
	"fmt"
	"github.com/FossoresLP/go-uuid-v4"
	"io"
	"io/ioutil"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var storeDirGlob = ""
var systemDivider = "/"

const (
	// tmpPermissionForDirectory makes the destination directory writable,
	// so that stuff can be copied recursively even if any original directory is NOT writable.
	// See https://github.com/otiai10/copy/pull/9 for more information.
	tmpPermissionForDirectory = os.FileMode(0755)
)

// Copy copies src to dest, doesn't matter if src is a directory or a file
func Copy(src, dest string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	return copy(src, dest, info)
}

// copy dispatches copy-funcs according to the mode.
// Because this "copy" could be called recursively,
// "info" MUST be given here, NOT nil.
func copy(src, dest string, info os.FileInfo) error {
	if info.Mode()&os.ModeSymlink != 0 {
		return lcopy(src, dest, info)
	}
	if info.IsDir() {
		return dcopy(src, dest, info)
	}
	return fcopy(src, dest, info)
}

// fcopy is for just a file,
// with considering existence of parent directory
// and file permission.
func fcopy(src, dest string, info os.FileInfo) error {
	if strings.Contains(src, storeDirGlob) {
		//Ignore the recursive copy of backup file if it is inside the AOR
		return nil
	} else {
		fmt.Println("[info] Copying file: " + dest + " from source " + src)
	}
	if err := os.MkdirAll(filepath.Dir(dest), os.ModePerm); err != nil {
		return err
	}

	f, err := os.Create(dest)
	if err != nil {
		fmt.Println("[warning] Filename too long or unable to create dest file copy. This file is skipped. Filepath: " + dest)
		return nil
	}
	defer f.Close()

	if err = os.Chmod(f.Name(), info.Mode()); err != nil {
		return err
	}

	s, err := os.Open(src)
	if err != nil {
		return err
	}
	defer s.Close()

	_, err = io.Copy(f, s)
	return err
}

// dcopy is for a directory,
// with scanning contents inside the directory
// and pass everything to "copy" recursively.
func dcopy(srcdir, destdir string, info os.FileInfo) error {
	if strings.Contains(srcdir, storeDirGlob) {
		//Ignore the recursive copy of backup directory if it is inside the AOR
		return nil
	}

	originalMode := info.Mode()

	// Make dest dir with 0755 so that everything writable.
	if err := os.MkdirAll(destdir, tmpPermissionForDirectory); err != nil {
		return err
	}
	// Recover dir mode with original one.
	defer os.Chmod(destdir, originalMode)

	contents, err := ioutil.ReadDir(srcdir)
	if err != nil {
		return err
	}

	for _, content := range contents {
		cs, cd := filepath.Join(srcdir, content.Name()), filepath.Join(destdir, content.Name())
		if err := copy(cs, cd, content); err != nil {
			// If any error, exit immediately
			return err
		}
	}

	return nil
}

// lcopy is for a symlink,
// with just creating a new symlink by replicating src symlink.
func lcopy(src, dest string, info os.FileInfo) error {
	src, err := os.Readlink(src)
	if err != nil {
		return err
	}
	return os.Symlink(src, dest)
}

func main() {
	//Define backup permeters. If it is not defined in the config, use default instead.
	root := "../../../"
	useExt := false
	useUUID := false
	storeDir := "backups/"
	mode := "full" //or snap if this is currently backup in snapshot mode
	if len(os.Args) != 7 {
		//There is no parmter. Display usage and exit
		fmt.Println("Undefined paramters. Usage: ./aos-backupman <root (Realpath)> <useExt (true / false)> <useUUID (true / false)> <backupName (use 'default' for auto generated)> <storeDir (use 'default' for default storage path)> <mode (full / snap)>")
		os.Exit(0)
	}
	//Generate backup package information
	t := time.Now()
	backupName := t.Format("20060102150405")
	//No problem. Go ahead to get the parameter from STDIN
	if os.Args[1] != "default" {
		root = os.Args[1]
	}
	useExt = (os.Args[2] == "true")
	useUUID = (os.Args[3] == "true")
	if useUUID {
		backupName, _ = uuid.NewString()
	}
	if os.Args[4] != "default" {
		backupName = os.Args[4]
	}
	if os.Args[5] != "default" {
		storeDir = os.Args[5]
	}
	if os.Args[6] == "snap" {
		//Anything not snap will be full just to be safe
		mode = "snap"
	}

	if useExt && storeDir == "backups/" {
		//switch to external storage directory if exists
		if _, err := os.Stat("/media/storage1"); os.IsNotExist(err) {
			//External storage not exists.
		} else {
			//External storage exists. Change backup directory to ext storage
			storeDir = "/media/storage1/system/backups/"
		}
	}

	storeDirGlob = storeDir
	if runtime.GOOS == "windows" {
		storeDirGlob = strings.ReplaceAll(storeDirGlob, "/", "\\")
		systemDivider = "\\"
	}

	outDirectory := storeDir + backupName + "/"
	//fmt.Println(outDirectory)
	//Start the backup process
	if mode == "full" {
		//Define the default backup directory. Make directory if not exists
		if _, err := os.Stat(outDirectory); os.IsNotExist(err) {
			os.MkdirAll(outDirectory, 0777)
		}
		//Full copy mode
		err := Copy(root, outDirectory)
		if err != nil {
			//panic(err)
		}
		//Create packinfo inside backup directory for restore reference
		CreateAndWriteFile(outDirectory+"packinfo.inf", "full,"+strconv.FormatInt(time.Now().UTC().Unix(), 10))
		fmt.Println("DONE")
	} else {
		//Snapshot Mode
		//Define the default backup directory. Make directory if not exists
		dirs, _ := filepath.Glob(storeDirGlob + "*")
		if _, err := os.Stat(outDirectory); os.IsNotExist(err) {
			os.MkdirAll(outDirectory, 0777)
		}
		//For each backups in the current backup directory, find the one that is closest to the current timestamp and use it as snapshot base
		currentTimestamp := int(time.Now().UTC().Unix())
		difference := currentTimestamp
		closestImage := "null"
		for i := 0; i < len(dirs); i++ {
			_, err := os.Stat(dirs[i] + systemDivider + "packinfo.inf")
			if err == nil {
				//File exists.
				b, err := ioutil.ReadFile(dirs[i] + systemDivider + "packinfo.inf")
				if err != nil {
					panic(err)
				}
				content := string(b)
				items := strings.Split(content, ",")
				packTime, _ := strconv.Atoi(items[1])
				if currentTimestamp-packTime < difference && items[0] == "full" {
					closestImage = dirs[i] + systemDivider
					difference = currentTimestamp - packTime
				}
			}
		}
		//Start building a snapshot from the closest image (full backup) that had been built before
		fmt.Println(closestImage)
		if closestImage == "null" {
			fmt.Println("ERROR. Base image not found. Have you ever performed a full backup?")
			os.Exit(0)
		}
		err := filepath.Walk(root,
			func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return nil
				}
				if strings.Contains(path, storeDirGlob) {
					//This file / folder is inside the backup directory. Ignore its content
					return nil
				}

				fi, _ := os.Stat(path)
				switch mode := fi.Mode(); {
				case mode.IsDir():
					// Make directory
					os.MkdirAll(outDirectory+strings.ReplaceAll(path, fixOSSeperator(root), ""), 0777)
				case mode.IsRegular():
					//Compare this file with the one in the last full backup. If nothing changed, do not copy/
					compareTarget := closestImage + strings.ReplaceAll(path, fixOSSeperator(root), "")
					if getFileSize(path) != getFileSize(compareTarget) {
						fmt.Println("[info] Difference found on file: " + path)
						Copy(path, outDirectory+strings.ReplaceAll(path, fixOSSeperator(root), ""))
					}
				}
				//fmt.Println(path, info.Size())
				return nil
			})
		if err != nil {
			fmt.Println(err)
		}
		CreateAndWriteFile(outDirectory+"packinfo.inf", "snap,"+strconv.FormatInt(time.Now().UTC().Unix(), 10)+","+closestImage)
		fmt.Println("DONE")
	}
}

func fixOSSeperator(path string) string {
	return strings.ReplaceAll(path, "/", systemDivider)
}

func getFileSize(path string) int {
	file, err := os.Open(path)
	if err != nil {
		///File not exists
		return -1
	}
	stat, err := file.Stat()
	if err != nil {
		return -1
	}

	return int(stat.Size())
}

func CreateAndWriteFile(filename string, content string) {
	f, err := os.Create(filename)
	if err != nil {
		fmt.Println(err)
		return
	}
	f.WriteString(content)
	return
}
