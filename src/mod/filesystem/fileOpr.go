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
	"archive/zip"
	"compress/flate"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	archiver "github.com/mholt/archiver/v3"
)

//A basic file zipping function
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

//A basic file unzip function
func Unzip(source, destination string) error {
	archive, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, file := range archive.Reader.File {
		reader, err := file.Open()
		if err != nil {
			return err
		}
		defer reader.Close()
		path := filepath.Join(destination, file.Name)

		err = os.MkdirAll(path, os.ModePerm)
		if err != nil {
			return err
		}

		if file.FileInfo().IsDir() {
			continue
		}

		err = os.Remove(path)
		if err != nil {
			return err
		}

		writer, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
		if err != nil {
			return err
		}
		defer writer.Close()
		_, err = io.Copy(writer, reader)
		if err != nil {
			return err
		}
	}
	return nil
}

//Aroz Unzip File with progress update function  (current filename / current file count / total file count / progress in percentage)
func ArozUnzipFileWithProgress(filelist []string, outputfile string, progressHandler func(string, int, int, float64)) error {
	//Gether the total number of files in all zip files
	totalFileCounts := 0
	unzippedFileCount := 0
	for _, srcFile := range filelist {
		archive, err := zip.OpenReader(srcFile)
		if err != nil {
			return err
		}

		totalFileCounts += len(archive.Reader.File)
		archive.Close()
	}

	//Start extracting
	for _, srcFile := range filelist {
		archive, err := zip.OpenReader(srcFile)
		if err != nil {
			return err
		}
		defer archive.Close()
		for _, file := range archive.Reader.File {
			reader, err := file.Open()
			if err != nil {
				return err
			}
			defer reader.Close()
			path := filepath.Join(outputfile, file.Name)

			err = os.MkdirAll(path, os.ModePerm)
			if err != nil {
				return err
			}

			if file.FileInfo().IsDir() {
				//Folder extracted

				//Update the progress
				unzippedFileCount++
				progressHandler(file.Name, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
				continue
			}

			err = os.Remove(path)
			if err != nil {
				return err
			}

			writer, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
			if err != nil {
				return err
			}
			defer writer.Close()
			_, err = io.Copy(writer, reader)
			if err != nil {
				return err
			}

			//Update the progress
			unzippedFileCount++
			progressHandler(file.Name, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
		}
	}

	return nil
}

//Aroz Zip File with progress update function (current filename / current file count / total file count / progress in percentage)
func ArozZipFileWithProgress(filelist []string, outputfile string, includeTopLevelFolder bool, progressHandler func(string, int, int, float64)) error {
	//Get the file count from the filelist
	totalFileCount := 0
	for _, srcpath := range filelist {
		if IsDir(srcpath) {
			filepath.Walk(srcpath, func(_ string, info os.FileInfo, _ error) error {
				if !info.IsDir() {
					totalFileCount++
				}
				return nil
			})
		} else {
			totalFileCount++
		}

	}

	//Create the target zip file
	file, err := os.Create(outputfile)
	if err != nil {
		panic(err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	defer writer.Close()

	currentFileCount := 0
	for _, srcpath := range filelist {
		if IsDir(srcpath) {
			//This is a directory
			topLevelFolderName := filepath.ToSlash(filepath.Base(filepath.Dir(srcpath)) + "/" + filepath.Base(srcpath))
			err = filepath.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if info.IsDir() {
					return nil
				}

				if insideHiddenFolder(path) == true {
					//This is hidden file / folder. Skip this
					return nil
				}
				file, err := os.Open(path)
				if err != nil {
					return err
				}
				defer file.Close()

				relativePath := strings.ReplaceAll(filepath.ToSlash(path), filepath.ToSlash(filepath.Clean(srcpath))+"/", "")
				if includeTopLevelFolder {
					relativePath = topLevelFolderName + "/" + relativePath
				} else {
					relativePath = filepath.Base(srcpath) + "/" + relativePath
				}

				f, err := writer.Create(relativePath)
				if err != nil {
					return err
				}

				_, err = io.Copy(f, file)
				if err != nil {
					return err
				}

				//Update the zip progress
				currentFileCount++
				progressHandler(filepath.Base(srcpath), currentFileCount, totalFileCount, (float64(currentFileCount)/float64(totalFileCount))*float64(100))
				return nil
			})

			if err != nil {
				return err
			}
		} else {
			//This is a file
			topLevelFolderName := filepath.Base(filepath.Dir(srcpath))
			file, err := os.Open(srcpath)
			if err != nil {
				return err
			}
			defer file.Close()
			relativePath := filepath.Base(srcpath)
			if includeTopLevelFolder {
				relativePath = topLevelFolderName + "/" + relativePath
			}
			f, err := writer.Create(relativePath)
			if err != nil {
				return err
			}

			_, err = io.Copy(f, file)
			if err != nil {
				return err
			}

			//Update the zip progress
			currentFileCount++
			progressHandler(filepath.Base(srcpath), currentFileCount, totalFileCount, (float64(currentFileCount)/float64(totalFileCount))*float64(100))

		}
	}

	return nil
}

//ArOZ Zip FIle, but with no progress display
func ArozZipFile(filelist []string, outputfile string, includeTopLevelFolder bool) error {
	//Create the target zip file
	file, err := os.Create(outputfile)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	defer writer.Close()

	for _, srcpath := range filelist {
		if IsDir(srcpath) {
			//This is a directory
			topLevelFolderName := filepath.ToSlash(filepath.Base(filepath.Dir(srcpath)) + "/" + filepath.Base(srcpath))
			err = filepath.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if info.IsDir() {
					return nil
				}

				if insideHiddenFolder(path) == true {
					//This is hidden file / folder. Skip this
					return nil
				}
				file, err := os.Open(path)
				if err != nil {
					return err
				}
				defer file.Close()

				relativePath := strings.ReplaceAll(filepath.ToSlash(path), filepath.ToSlash(filepath.Clean(srcpath))+"/", "")
				if includeTopLevelFolder {
					relativePath = topLevelFolderName + "/" + relativePath
				} else {
					relativePath = filepath.Base(srcpath) + "/" + relativePath
				}

				f, err := writer.Create(relativePath)
				if err != nil {
					return err
				}

				_, err = io.Copy(f, file)
				if err != nil {
					return err
				}

				return nil
			})

			if err != nil {
				return err
			}
		} else {
			//This is a file
			topLevelFolderName := filepath.Base(filepath.Dir(srcpath))
			file, err := os.Open(srcpath)
			if err != nil {
				return err
			}
			defer file.Close()
			relativePath := filepath.Base(srcpath)
			if includeTopLevelFolder {
				relativePath = topLevelFolderName + "/" + relativePath
			}
			f, err := writer.Create(relativePath)
			if err != nil {
				return err
			}

			_, err = io.Copy(f, file)
			if err != nil {
				return err
			}

		}
	}

	return nil
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

func ViewZipFile(filepath string) ([]string, error) {
	z := archiver.Zip{}
	filelist := []string{}
	err := z.Walk(filepath, func(f archiver.File) error {
		filelist = append(filelist, f.Name())
		return nil
	})

	return filelist, err
}

func FileCopy(src string, dest string, mode string, progressUpdate func(int, string)) error {
	srcRealpath, _ := filepath.Abs(src)
	destRealpath, _ := filepath.Abs(dest)
	if IsDir(src) && strings.Contains(filepath.ToSlash(destRealpath)+"/", filepath.ToSlash(srcRealpath)+"/") {
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

		//err := dircpy.Copy(src, realDest)

		err := dirCopy(src, realDest, progressUpdate)
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

		if progressUpdate != nil {
			//Set progress to 100, leave it to upper level abstraction to handle
			progressUpdate(100, filepath.Base(realDest))
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

func FileMove(src string, dest string, mode string, fastMove bool, progressUpdate func(int, string)) error {
	srcRealpath, _ := filepath.Abs(src)
	destRealpath, _ := filepath.Abs(dest)
	if IsDir(src) && strings.Contains(filepath.ToSlash(destRealpath)+"/", filepath.ToSlash(srcRealpath)+"/") {
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
			//err := dircpy.Copy(src, realDest)

			err := dirCopy(src, realDest, progressUpdate)
			if err != nil {
				return err
			} else {
				//Move completed. Remove source file.
				os.RemoveAll(src)
				return nil
			}

		} else {
			//Source is file only. Copy file.
			realDest := dest + movedFilename
			/*
				Updates 20-10-2020, replaced io.Copy to BufferedLargeFileCopy
				Legacy code removed.
			*/

			//Update the progress
			if progressUpdate != nil {
				progressUpdate(100, filepath.Base(src))
			}

			err := BufferedLargeFileCopy(src, realDest, 8192)
			if err != nil {
				log.Println("BLFC error: ", err.Error())
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

//Copy a given directory, with no progress udpate
func CopyDir(src string, dest string) error {
	return dirCopy(src, dest, func(progress int, name string) {})
}

//Replacment of the legacy dirCopy plugin with filepath.Walk function. Allowing real time progress update to front end
func dirCopy(src string, realDest string, progressUpdate func(int, string)) error {

	//Get the total file counts
	totalFileCounts := int64(0)
	filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			//Updates 22 April 2021, chnaged from file count to file size for progress update
			//totalFileCounts++
			totalFileCounts += info.Size()
		}
		return nil
	})

	//Make the destinaton directory
	if !fileExists(realDest) {
		os.Mkdir(realDest, 0755)
	}

	//Start moving
	fileCounter := int64(0)

	err := filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		srcAbs, _ := filepath.Abs(src)
		pathAbs, _ := filepath.Abs(path)

		var folderRootRelative string = strings.Replace(pathAbs, srcAbs, "", 1)
		if folderRootRelative == "" {
			return nil
		}

		if info.IsDir() {
			//Mkdir base on relative path
			return os.MkdirAll(filepath.Join(realDest, folderRootRelative), 0755)
		} else {
			//fileCounter++
			fileCounter += info.Size()
			//Move file base on relative path
			fileSrc := filepath.ToSlash(filepath.Join(filepath.Clean(src), folderRootRelative))
			fileDest := filepath.ToSlash(filepath.Join(filepath.Clean(realDest), folderRootRelative))

			//Update move progress
			if progressUpdate != nil {
				progressUpdate(int(float64(fileCounter)/float64(totalFileCounts)*100), filepath.Base(fileSrc))
			}

			//Move the file using BLFC
			err := BufferedLargeFileCopy(fileSrc, fileDest, 8192)
			if err != nil {
				//Ignore and continue
				log.Println("BLFC Error:", err.Error())
				return nil
			}
			/*
				//Move fiel using IO Copy
				err := BasicFileCopy(fileSrc, fileDest)
				if err != nil {
					log.Println("Basic Copy Error: ", err.Error())
					return nil
				}

			*/
		}
		return nil
	})

	return err
}

func BasicFileCopy(src string, dst string) error {
	sourceFileStat, err := os.Stat(src)
	if err != nil {
		return err
	}

	if !sourceFileStat.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", src)
	}

	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destination.Close()
	_, err = io.Copy(destination, source)
	return err
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
