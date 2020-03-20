package main

/*
ArOZ Online Update Package Building Script

This is a simple Golang written script for creating an update package automatically.
The file will be exported in zip format with directory starting from ArOZ Online Base (AOB/*)
*/

import (
	"archive/zip"
	"fmt"
	"github.com/mholt/archiver"
	"io"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func check(e error) {
	if e != nil {
		panic(e)
	}
}

func isDir(path string) bool {
	fi, err := os.Stat(path)
	if err != nil {
		fmt.Println(err)
		return false
	}
	switch mode := fi.Mode(); {
	case mode.IsDir():
		// do directory stuff
		return true
	case mode.IsRegular():
		// do file stuff
		return false
	}
	return false
}

func exists(path string) bool {
	_, err := os.Stat(path)
	if err == nil {
		return true
	}
	if os.IsNotExist(err) {
		return false
	}
	return true
}

func copyFile(from string, to string) {
	if isDir(from) {
		os.MkdirAll(to, 0777)
		return
	}
	source, err := os.Open(from)
	if err != nil {
		fmt.Println("[error] Failed to oepn file: " + from)
		return
	}
	defer source.Close()
	destination, err := os.Create(to)
	if err != nil {
		fmt.Println("[error] Failed to copy file: " + from)
		return
	}
	defer destination.Close()
	io.Copy(destination, source)
	fmt.Println("[info] " + from + " copied.")
}

func appendFiles(filename string, zipw *zip.Writer) error {
	file, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("[error] Failed to open %s: %s", filename, err)
	}
	defer file.Close()

	wr, err := zipw.Create(filename)
	if err != nil {
		msg := "[error] Failed to create entry for %s in zip file: %s"
		return fmt.Errorf(msg, filename, err)
	}

	if _, err := io.Copy(wr, file); err != nil {
		return fmt.Errorf("[error] Failed to write %s to zip: %s", filename, err)
	}
	return nil
}

func recursiveListDir(root string, includePath []string, ignorePath []string, ignoreExt []string) {
	results := []string{}
	err := filepath.Walk(root,
		func(path string, info os.FileInfo, err error) error {
			//For each file path in the target root directory
			path = strings.Replace(path, "\\", "/", -1)
			fileValid := true
			if includePath[0] != "*" {
				//Check if the file is lying inside one of its included path
				thisValid := false
				for i := 0; i < len(includePath); i++ {
					if strings.Contains(path, includePath[i]) {
						thisValid = true
					}
				}
				fileValid = thisValid
			}
			if fileValid == false {
				return nil
			}
			//Check if it is inside one of the ignore path
			if ignorePath[0] != "*" {
				thisValid := true
				for i := 0; i < len(ignorePath); i++ {
					if strings.Contains(path, ignorePath[i]) {
						thisValid = false
					}
				}
				fileValid = thisValid
			}
			if !fileValid {
				return nil
			}
			if isDir(path) == false {
				//This path is a file. Check if this contain the extension to ignore
				ext := filepath.Ext(path)
				thisValid := true
				for i := 0; i < len(ignoreExt); i++ {
					if strings.Contains(ignoreExt[i], ext) {
						thisValid = false
					}
				}
				fileValid = thisValid
			}
			if fileValid {
				fmt.Println("[info] Processing: " + path)
				results = append(results, path)
			}
			return nil
		})
	if err != nil {
		fmt.Println(err)
	}
	//The results is ready. Move all the files into the build folder
	if !exists("build/AOB/") {
		os.MkdirAll("build/AOB/", 0777)
	}

	for _, filename := range results {
		copyFile(filename, "build/AOB/"+strings.Replace(filename, root, "", 1))
	}
	//Start the compression process
	dt := time.Now()
	filename := "AOB " + string(dt.Format("02-01-2006")) + ".zip"
	_, err = os.Stat("filename.config")
	if err == nil {
		//This file exists. Read from it
		file, _ := os.Open("filename.config")
		b, _ := ioutil.ReadAll(file)
		filename = string(b)
	}
	fmt.Println("[info] Building package...")
	err = archiver.Archive([]string{"build/AOB"}, filename)
	if err != nil {
		panic(err)
	}
	fmt.Println("[info] Cleaning up build cache...")
	os.RemoveAll("build/")
	fmt.Println("[DONE] Build succeed. Package UUID: " + filename)
}

func main() {
	buildConfig := "../build.config"
	if _, err := os.Stat(buildConfig); os.IsNotExist(err) {
		//File not exists. Create the file
		f, err := os.Create(buildConfig)
		check(err)
		f.WriteString("ROOT:\n")
		f.WriteString("../../../../\n")
		f.WriteString("INCLUDE:\n")
		f.WriteString("IGNORE:\n")
		f.WriteString("IGNORE_EXT:\n")
		f.Close()
	}
	if !exists("build/") {
		os.MkdirAll("build/", 0777)
	}
	dat, err := ioutil.ReadFile(buildConfig)
	check(err)
	fmt.Println("[info] Loading configs from ")
	root := "../../../../"
	includePath := []string{"*"}
	ignorePath := []string{"tmp/"}
	ignoreExt := []string{".inf"}
	//Start building the variables
	content := string(dat)
	lines := strings.Split(strings.Replace(content, "\r\n", "\n", -1), "\n")
	mode := ""
	for i := 0; i < len(lines); i++ {
		thisline := strings.TrimRight(lines[i], " ")
		fmt.Println("[info] Overwriting Setting: " + mode + ": " + thisline)
		if strings.Contains(thisline, ":") {
			//Labeling line
			if thisline == "INCLUDE:" {
				includePath = []string{}
				mode = thisline
			} else if thisline == "IGNORE:" {
				ignorePath = []string{}
				mode = thisline
			} else if thisline == "IGNORE_EXT:" {
				ignoreExt = []string{}
				mode = thisline
			} else if thisline == "ROOT:" {
				ignoreExt = []string{}
				mode = thisline
			}
		} else {
			//Setting line
			if mode == "ROOT:" {
				//This line indicate the root path of the scandir
				root = thisline
			} else if mode == "INCLUDE:" {
				//This line is part of the include path
				includePath = append(includePath, thisline)
			} else if mode == "IGNORE:" {
				ignorePath = append(ignorePath, thisline)
			} else if mode == "IGNORE_EXT:" {
				ignoreExt = append(ignoreExt, thisline)
			}
		}

	}

	//Start listing all directories for build
	recursiveListDir(root, includePath, ignorePath, ignoreExt)
}
