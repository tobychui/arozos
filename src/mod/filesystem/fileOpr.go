package filesystem

/*
	File Operation Wrapper
	author: tobychui

	This is a module seperated from the aroz online file system script
	that allows cleaner code in the main logic handler of the aroz online system.

	WARNING! ALL FILE OPERATION USING THIS WRAPPER SHOULD PASS IN REALPATH
	DO NOT USE VIRTUAL PATH FOR ANY OPERATIONS WITH THIS WRAPPER
*/

import (
	"compress/flate"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	archiver "github.com/mholt/archiver/v3"
	dircpy "github.com/otiai10/copy"
)

func ZipFile(filelist []string, outputfile string, includeTopLevelFolder bool) error {
	z := archiver.Zip{
		CompressionLevel:       flate.DefaultCompression,
		MkdirAll:               true,
		SelectiveCompression:   true,
		OverwriteExisting:      false,
		ImplicitTopLevelFolder: includeTopLevelFolder,
	}

	err := z.Archive(filelist, outputfile)
	return err
}

func ViewZipFile(filepath string) ([]string, error) {
	z := archiver.Zip{}
	filelist := []string{}
	err := z.Walk(filepath, func(f archiver.File) error {
		filelist = append(filelist, f.Name())
		return nil
	})

	return filelist, err
}

func FileCopy(src string, dest string, mode string) error {
	srcRealpath, _ := filepath.Abs(src)
	destRealpath, _ := filepath.Abs(dest)
	if IsDir(src) && strings.Contains(destRealpath, srcRealpath) {
		//Recursive operation. Reject
		return errors.New("Recursive copy operation.")

	}

	//Check if the copy destination file already have an identical file
	copiedFilename := filepath.Base(src)

	if fileExists(dest + filepath.Base(src)) {
		if mode == "" {
			//Do not specific file exists principle
			return errors.New("Destination file already exists.")

		} else if mode == "skip" {
			//Skip this file
			return nil
		} else if mode == "overwrite" {
			//Continue with the following code
			//Check if the copy and paste dest are identical
			if src == (dest + filepath.Base(src)) {
				//Source and target identical. Cannot overwrite.
				return errors.New("Source and destination paths are identical.")

			}

		} else if mode == "keep" {
			//Keep the file but saved with 'Copy' suffix
			newFilename := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)) + " - Copy" + filepath.Ext(src)
			//Check if the newFilename already exists. If yes, continue adding suffix
			duplicateCounter := 0
			for fileExists(dest + newFilename) {
				duplicateCounter++
				newFilename = strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)) + " - Copy(" + strconv.Itoa(duplicateCounter) + ")" + filepath.Ext(src)
				if duplicateCounter > 1024 {
					//Maxmium loop encountered. For thread safty, terminate here
					return errors.New("Too many copies of identical files.")

				}
			}
			copiedFilename = newFilename
		} else {
			//This exists opr not supported.
			return errors.New("Unknown file exists rules given.")

		}

	}

	//Fix the lacking / at the end if true
	if dest[len(dest)-1:] != "/" {
		dest = dest + "/"
	}

	//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
	if IsDir(src) {
		//Source file is directory. CopyFolder
		realDest := dest + copiedFilename
		err := dircpy.Copy(src, realDest)
		if err != nil {
			return err

		}

	} else {
		//Source is file only. Copy file.
		realDest := dest + copiedFilename
		source, err := os.Open(src)
		if err != nil {
			return err

		}

		destination, err := os.Create(realDest)
		if err != nil {
			return err
		}

		_, err = io.Copy(destination, source)
		if err != nil {
			return err
		}
		source.Close()
		destination.Close()
	}
	return nil
}

func FileMove(src string, dest string, mode string, fastMove bool) error {
	srcRealpath, _ := filepath.Abs(src)
	destRealpath, _ := filepath.Abs(dest)
	if IsDir(src) && strings.Contains(destRealpath, srcRealpath) {
		//Recursive operation. Reject
		return errors.New("Recursive move operation.")
	}

	if !fileExists(dest) {
		if fileExists(filepath.Dir(dest)) {
			//User pass in the whole path for the folder. Report error usecase.
			return errors.New("Dest location should be an existing folder instead of the full path of the moved file.")
		}
		return errors.New("Dest folder not found")
	}
	//Fix the lacking / at the end if true
	if dest[len(dest)-1:] != "/" {
		dest = dest + "/"
	}

	//Check if the target file already exists.
	movedFilename := filepath.Base(src)

	if fileExists(dest + filepath.Base(src)) {
		//Handle cases where file already exists
		if mode == "" {
			//Do not specific file exists principle
			return errors.New("Destination file already exists.")
		} else if mode == "skip" {
			//Skip this file
			return nil
		} else if mode == "overwrite" {
			//Continue with the following code
			//Check if the copy and paste dest are identical
			if src == (dest + filepath.Base(src)) {
				//Source and target identical. Cannot overwrite.
				return errors.New("Source and destination paths are identical.")
			}

		} else if mode == "keep" {
			//Keep the file but saved with 'Copy' suffix
			newFilename := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)) + " - Copy" + filepath.Ext(src)
			//Check if the newFilename already exists. If yes, continue adding suffix
			duplicateCounter := 0
			for fileExists(dest + newFilename) {
				duplicateCounter++
				newFilename = strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)) + " - Copy(" + strconv.Itoa(duplicateCounter) + ")" + filepath.Ext(src)
				if duplicateCounter > 1024 {
					//Maxmium loop encountered. For thread safty, terminate here
					return errors.New("Too many copies of identical files.")
				}
			}
			movedFilename = newFilename
		} else {
			//This exists opr not supported.
			return errors.New("Unknown file exists rules given.")
		}
	}

	if fastMove {
		//Ready to move with the quick rename method
		realDest := dest + movedFilename
		err := os.Rename(src, realDest)
		if err != nil {
			log.Println(err)
			return errors.New("File Move Failed")
		}

	} else {
		//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
		if IsDir(src) {
			//Source file is directory. CopyFolder
			realDest := dest + movedFilename
			err := dircpy.Copy(src, realDest)
			if err != nil {
				return err
			}
			//Move completed. Remove source file.
			os.RemoveAll(src)

		} else {
			//Source is file only. Copy file.
			realDest := dest + movedFilename
			/*
				//Updates 20-10-2020, replaced io.Copy to BufferedLargeFileCopy
				source, err := os.Open(src)
				if err != nil {
					return err
				}

				destination, err := os.Create(realDest)
				if err != nil {
					return err
				}

				io.Copy(destination, source)
				source.Close()
				destination.Close()
			*/
			err := BufferedLargeFileCopy(src, realDest, 8192)
			if err != nil {
				return err
			}

			//Delete the source file after copy
			err = os.Remove(src)
			counter := 0
			for err != nil {
				//Sometime Windows need this to prevent windows caching bring problems to file remove
				time.Sleep(1 * time.Second)
				os.Remove(src)
				counter++
				log.Println("Retrying to remove file: " + src)
				if counter > 10 {
					return errors.New("Source file remove failed.")
				}
			}
		}
	}
	return nil
}

//Use for copying large file using buffering method. Allowing copying large file with little RAM
func BufferedLargeFileCopy(src string, dst string, BUFFERSIZE int64) error {
	sourceFileStat, err := os.Stat(src)
	if err != nil {
		return err
	}

	if !sourceFileStat.Mode().IsRegular() {
		return errors.New("Invalid file source")
	}

	source, err := os.Open(src)
	if err != nil {
		return err
	}

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}

	buf := make([]byte, BUFFERSIZE)
	for {
		n, err := source.Read(buf)
		if err != nil && err != io.EOF {
			source.Close()
			destination.Close()
			return err
		}
		if n == 0 {
			source.Close()
			destination.Close()
			break
		}

		if _, err := destination.Write(buf[:n]); err != nil {
			source.Close()
			destination.Close()
			return err
		}
	}
	return nil
}

func IsDir(path string) bool {
	if fileExists(path) == false {
		return false
	}
	fi, err := os.Stat(path)
	if err != nil {
		log.Fatal(err)
		return false
	}
	switch mode := fi.Mode(); {
	case mode.IsDir():
		return true
	case mode.IsRegular():
		return false
	}
	return false
}
