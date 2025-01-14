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
	"archive/tar"
	"archive/zip"
	"compress/flate"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/hidden"

	archiver "github.com/mholt/archiver/v3"
)

// A basic file zipping function
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

// A basic file unzip function
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

// Aroz Unzip File with progress update function  (current filename / current file count / total file count / progress in percentage)
func ArozUnzipFileWithProgress(filelist []string, outputfile string, progressHandler func(string, int, int, float64) int) error {
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

			parentFolder := path
			if !file.FileInfo().IsDir() {
				//Is file. Change target to its parent dir
				parentFolder = filepath.Dir(path)
			}

			err = os.MkdirAll(parentFolder, 0775)
			if err != nil {
				return err
			}

			if file.FileInfo().IsDir() {
				//Folder is created already be the steps above.
				//Update the progress
				unzippedFileCount++
				statusCode := progressHandler(file.Name, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
				for statusCode == 1 {
					//Wait for the task to be resumed
					time.Sleep(1 * time.Second)
					statusCode = progressHandler(file.Name, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
				}
				if statusCode == 2 {
					//Cancel
					return errors.New("Operation cancelled by user")
				}
				continue
			}

			//Extrat and write to the target file
			writer, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
			if err != nil {
				return err
			}
			_, err = io.Copy(writer, reader)
			if err != nil {
				//Extraction failed. Remove this file if exists
				writer.Close()
				if FileExists(path) {
					os.Remove(path)
				}
				return err
			}
			writer.Close()

			//Update the progress
			unzippedFileCount++
			statusCode := progressHandler(file.Name, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
			for statusCode == 1 {
				//Wait for the task to be resumed
				time.Sleep(1 * time.Second)
				statusCode = progressHandler(file.Name, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
			}
			if statusCode == 2 {
				//Cancel
				return errors.New("Operation cancelled by user")
			}
		}
	}

	return nil
}

/*
Aroz Zip File with progress update function
Returns the following progress: (current filename / current file count / total file count / progress in percentage)
if output is local path that is out of the scope of any fsh, leave outputFsh as nil
*/
func ArozZipFileWithProgress(targetFshs []*FileSystemHandler, filelist []string, outputFsh *FileSystemHandler, outputfile string, includeTopLevelFolder bool, progressHandler func(string, int, int, float64) int) error {
	//fmt.Println("WEBSOCKET ZIPPING", targetFshs, filelist)
	//Get the file count from the filelist
	totalFileCount := 0
	for i, srcpath := range filelist {
		thisFsh := targetFshs[i]
		fshAbs := thisFsh.FileSystemAbstraction
		if thisFsh.FileSystemAbstraction.IsDir(srcpath) {
			fshAbs.Walk(srcpath, func(_ string, info os.FileInfo, _ error) error {
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
	var file arozfs.File
	var err error
	if outputFsh != nil {
		file, err = outputFsh.FileSystemAbstraction.Create(outputfile)
	} else {
		//Force local fs
		file, err = os.Create(outputfile)
	}
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	defer writer.Close()

	currentFileCount := 0
	for i, srcpath := range filelist {
		thisFsh := targetFshs[i]
		fshAbs := thisFsh.FileSystemAbstraction
		//Local File System
		if fshAbs.IsDir(srcpath) {
			//This is a directory
			topLevelFolderName := filepath.ToSlash(arozfs.Base(filepath.Dir(srcpath)) + "/" + arozfs.Base(srcpath))
			err = fshAbs.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if info.IsDir() {
					return nil
				}

				if insideHiddenFolder(path) {
					//This is hidden file / folder. Skip this
					return nil
				}

				thisFile, err := fshAbs.ReadStream(path)
				if err != nil {
					return err
				}
				defer thisFile.Close()

				relativePath := strings.ReplaceAll(filepath.ToSlash(path), filepath.ToSlash(filepath.Clean(srcpath))+"/", "")
				if includeTopLevelFolder {
					relativePath = topLevelFolderName + "/" + relativePath
				} else {
					relativePath = arozfs.Base(srcpath) + "/" + relativePath
				}

				f, err := writer.Create(relativePath)
				if err != nil {
					return err
				}

				_, err = io.Copy(f, thisFile)
				if err != nil {
					return err
				}

				//Update the zip progress
				currentFileCount++
				statusCode := progressHandler(arozfs.Base(srcpath), currentFileCount, totalFileCount, (float64(currentFileCount)/float64(totalFileCount))*float64(100))
				for statusCode == 1 {
					//Wait for the task to be resumed
					time.Sleep(1 * time.Second)
					statusCode = progressHandler(arozfs.Base(srcpath), currentFileCount, totalFileCount, (float64(currentFileCount)/float64(totalFileCount))*float64(100))
				}
				if statusCode == 2 {
					//Cancel
					return errors.New("Operation cancelled by user")
				}
				return nil
			})

			if err != nil {
				return err
			}
		} else {
			//This is a file
			topLevelFolderName := arozfs.Base(filepath.Dir(srcpath))
			thisFile, err := fshAbs.ReadStream(srcpath)
			if err != nil {
				return err
			}
			defer thisFile.Close()
			relativePath := arozfs.Base(srcpath)
			if includeTopLevelFolder {
				relativePath = topLevelFolderName + "/" + relativePath
			}

			f, err := writer.Create(relativePath)
			if err != nil {
				return err
			}

			_, err = io.Copy(f, thisFile)
			if err != nil {
				return err
			}

			//Update the zip progress
			currentFileCount++
			statusCode := progressHandler(arozfs.Base(srcpath), currentFileCount, totalFileCount, (float64(currentFileCount)/float64(totalFileCount))*float64(100))
			for statusCode == 1 {
				//Wait for the task to be resumed
				time.Sleep(1 * time.Second)
				statusCode = progressHandler(arozfs.Base(srcpath), currentFileCount, totalFileCount, (float64(currentFileCount)/float64(totalFileCount))*float64(100))
			}
			if statusCode == 2 {
				//Cancel
				return errors.New("Operation cancelled by user")
			}
		}
	}

	return nil
}

/*
ArozZipFile
Zip file without progress update, support local file system or buffer space
To use it with local file system, pass in nil in fsh for each item in filelist, e.g.
filesystem.ArozZipFile([]*filesystem.FileSystemHandler{nil}, []string{zippingSource}, nil, targetZipFilename, false)
*/
func ArozZipFile(sourceFshs []*FileSystemHandler, filelist []string, outputFsh *FileSystemHandler, outputfile string, includeTopLevelFolder bool) error {
	// Call the new function with default compression level (e.g., 6)
	return ArozZipFileWithCompressionLevel(sourceFshs, filelist, outputFsh, outputfile, includeTopLevelFolder, flate.DefaultCompression)
}

func ArozZipFileWithCompressionLevel(sourceFshs []*FileSystemHandler, filelist []string, outputFsh *FileSystemHandler, outputfile string, includeTopLevelFolder bool, compressionLevel int) error {
	//Create the target zip file
	var file arozfs.File
	var err error
	if outputFsh != nil {
		file, err = outputFsh.FileSystemAbstraction.Create(outputfile)
	} else {
		//Force local fs
		file, err = os.Create(outputfile)
	}
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	writer.RegisterCompressor(zip.Deflate, func(out io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(out, compressionLevel)
	})
	defer writer.Close()

	for i, srcpath := range filelist {
		thisFsh := sourceFshs[i]
		var fshAbs FileSystemAbstraction
		if thisFsh == nil {
			//Use local fs functions
			if IsDir(srcpath) {
				//This is a directory
				topLevelFolderName := filepath.ToSlash(arozfs.Base(filepath.Dir(srcpath)) + "/" + arozfs.Base(srcpath))
				err = filepath.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
					if err != nil {
						return err
					}
					if info.IsDir() {
						return nil
					}

					if insideHiddenFolder(path) {
						//This is hidden file / folder. Skip this
						return nil
					}
					thisFile, err := os.Open(path)
					if err != nil {
						return err
					}
					defer thisFile.Close()

					relativePath := strings.ReplaceAll(filepath.ToSlash(path), filepath.ToSlash(filepath.Clean(srcpath))+"/", "")
					if includeTopLevelFolder {
						relativePath = topLevelFolderName + "/" + relativePath
					} else {
						relativePath = arozfs.Base(srcpath) + "/" + relativePath
					}

					f, err := writer.Create(relativePath)
					if err != nil {
						return err
					}

					_, err = io.Copy(f, thisFile)
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
				topLevelFolderName := arozfs.Base(filepath.Dir(srcpath))
				thisFile, err := os.Open(srcpath)
				if err != nil {
					return err
				}
				defer thisFile.Close()
				relativePath := arozfs.Base(srcpath)
				if includeTopLevelFolder {
					relativePath = topLevelFolderName + "/" + relativePath
				}
				f, err := writer.Create(relativePath)
				if err != nil {
					return err
				}

				_, err = io.Copy(f, thisFile)
				if err != nil {
					return err
				}

			}
		} else {
			//Use file system abstraction
			fshAbs = thisFsh.FileSystemAbstraction
			if fshAbs.IsDir(srcpath) {
				//This is a directory
				topLevelFolderName := filepath.ToSlash(arozfs.Base(filepath.Dir(srcpath)) + "/" + arozfs.Base(srcpath))
				err = fshAbs.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
					if err != nil {
						return err
					}

					if info.IsDir() {
						return nil
					}

					if insideHiddenFolder(path) {
						//This is hidden file / folder. Skip this
						return nil
					}

					thisFile, err := fshAbs.ReadStream(path)
					if err != nil {
						fmt.Println(err)
						return err
					}
					defer thisFile.Close()

					relativePath := strings.ReplaceAll(filepath.ToSlash(path), filepath.ToSlash(filepath.Clean(srcpath))+"/", "")
					if includeTopLevelFolder {
						relativePath = topLevelFolderName + "/" + relativePath
					} else {
						relativePath = arozfs.Base(srcpath) + "/" + relativePath
					}

					f, err := writer.Create(relativePath)
					if err != nil {
						return err
					}

					_, err = io.Copy(f, thisFile)
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
				topLevelFolderName := arozfs.Base(filepath.Dir(srcpath))
				thisFile, err := fshAbs.ReadStream(srcpath)
				if err != nil {
					return err
				}
				defer thisFile.Close()
				relativePath := arozfs.Base(srcpath)
				if includeTopLevelFolder {
					relativePath = topLevelFolderName + "/" + relativePath
				}
				f, err := writer.Create(relativePath)
				if err != nil {
					return err
				}

				_, err = io.Copy(f, thisFile)
				if err != nil {
					return err
				}

			}
		}
	}

	return nil
}

func insideHiddenFolder(path string) bool {
	FileIsHidden, err := hidden.IsHidden(path, true)
	if err != nil {
		//Read error. Maybe permission issue, assuem is hidden
		return true
	}
	return FileIsHidden
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

func FileCopy(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string, mode string, progressUpdate func(int, string) int) error {
	srcFshAbs := srcFsh.FileSystemAbstraction
	destFshAbs := destFsh.FileSystemAbstraction
	if srcFshAbs.IsDir(src) && strings.HasPrefix(dest, src) {
		//Recursive operation. Reject
		return errors.New("Recursive copy operation.")
	}

	//Check if the copy destination file already have an identical file
	copiedFilename := arozfs.Base(src)

	if destFshAbs.FileExists(filepath.Join(dest, arozfs.Base(src))) {
		if mode == "" {
			//Do not specific file exists principle
			return errors.New("Destination file already exists.")

		} else if mode == "skip" {
			//Skip this file
			return nil
		} else if mode == "overwrite" {
			//Continue with the following code
			//Check if the copy and paste dest are identical
			if filepath.ToSlash(filepath.Clean(src)) == filepath.ToSlash(filepath.Clean(filepath.Join(dest, arozfs.Base(src)))) {
				//Source and target identical. Cannot overwrite.
				return errors.New("Source and destination paths are identical.")

			}

		} else if mode == "keep" {
			//Keep the file but saved with 'Copy' suffix
			newFilename := strings.TrimSuffix(arozfs.Base(src), filepath.Ext(src)) + " - Copy" + filepath.Ext(src)
			//Check if the newFilename already exists. If yes, continue adding suffix
			duplicateCounter := 0
			for destFshAbs.FileExists(filepath.Join(dest, newFilename)) {
				duplicateCounter++
				newFilename = strings.TrimSuffix(arozfs.Base(src), filepath.Ext(src)) + " - Copy(" + strconv.Itoa(duplicateCounter) + ")" + filepath.Ext(src)
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

	//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
	if srcFshAbs.IsDir(src) {
		//Source file is directory. CopyFolder
		realDest := filepath.Join(dest, copiedFilename)
		err := dirCopy(srcFsh, src, destFsh, realDest, progressUpdate)
		if err != nil {
			return err
		}

	} else {
		//Source is file only. Copy file.
		realDest := filepath.Join(dest, copiedFilename)
		f, err := srcFshAbs.ReadStream(src)
		if err != nil {
			return err
		}
		defer f.Close()
		err = destFshAbs.WriteStream(realDest, f, 0775)
		if err != nil {
			return err
		}

		if progressUpdate != nil {
			//Set progress to 100, leave it to upper level abstraction to handle
			statusCode := progressUpdate(100, arozfs.Base(realDest))
			for statusCode == 1 {
				//Wait for the task to be resumed
				time.Sleep(1 * time.Second)
				statusCode = progressUpdate(100, arozfs.Base(realDest))
			}
			if statusCode == 2 {
				//Cancel
				return errors.New("Operation cancelled by user")
			}
		}
	}
	return nil
}

func FileMove(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string, mode string, fastMove bool, progressUpdate func(int, string) int) error {
	srcAbst := srcFsh.FileSystemAbstraction
	destAbst := destFsh.FileSystemAbstraction

	src = filepath.ToSlash(src)
	dest = filepath.ToSlash(dest)
	if srcAbst.IsDir(src) && strings.HasPrefix(dest, src) {
		//Recursive operation. Reject
		return errors.New("Recursive move operation.")
	}

	if !destAbst.FileExists(dest) {
		if destAbst.FileExists(filepath.Dir(dest)) {
			//User pass in the whole path for the folder. Report error usecase.
			return errors.New("Dest location should be an existing folder instead of the full path of the moved file.")
		}
		os.MkdirAll(dest, 0775)
	}

	//Check if the target file already exists.
	movedFilename := arozfs.Base(src)
	if destAbst.FileExists(filepath.Join(dest, arozfs.Base(src))) {
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
			if filepath.ToSlash(filepath.Clean(src)) == filepath.ToSlash(filepath.Clean(filepath.Join(dest, arozfs.Base(src)))) {
				//Source and target identical. Cannot overwrite.
				return errors.New("Source and destination paths are identical.")
			}

		} else if mode == "keep" {
			//Keep the file but saved with 'Copy' suffix
			newFilename := strings.TrimSuffix(arozfs.Base(src), filepath.Ext(src)) + " - Copy" + filepath.Ext(src)
			//Check if the newFilename already exists. If yes, continue adding suffix
			duplicateCounter := 0
			for destAbst.FileExists(filepath.Join(dest, newFilename)) {
				duplicateCounter++
				newFilename = strings.TrimSuffix(arozfs.Base(src), filepath.Ext(src)) + " - Copy(" + strconv.Itoa(duplicateCounter) + ")" + filepath.Ext(src)
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
		realDest := filepath.Join(dest, movedFilename)
		err := os.Rename(src, realDest)
		if err == nil {
			//Fast move success
			return nil
		}

		//Fast move failed. Back to the original copy and move method
	}

	//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
	if srcAbst.IsDir(src) {
		//Source file is directory. CopyFolder
		realDest := filepath.Join(dest, movedFilename)
		//err := dircpy.Copy(src, realDest)

		err := dirCopy(srcFsh, src, destFsh, realDest, progressUpdate)
		if err != nil {
			return err
		} else {
			//Move completed. Remove source file.
			srcAbst.RemoveAll(src)
			return nil
		}

	} else {
		//Source is file only. Copy file.
		realDest := filepath.Join(dest, movedFilename)
		/*
			Updates 20-10-2020, replaced io.Copy to BufferedLargeFileCopy
			Legacy code removed.
		*/

		//Update the progress
		if progressUpdate != nil {
			statusCode := progressUpdate(100, arozfs.Base(src))
			for statusCode == 1 {
				//Wait for the task to be resumed
				time.Sleep(1 * time.Second)
				statusCode = progressUpdate(100, arozfs.Base(realDest))
			}
			if statusCode == 2 {
				//Cancel
				return errors.New("Operation cancelled by user")
			}
		}

		f, err := srcAbst.ReadStream(src)
		if err != nil {
			fmt.Println(err)
			return err
		}
		defer f.Close()

		err = destAbst.WriteStream(realDest, f, 0755)
		if err != nil {
			fmt.Println(err)
			return err
		}

		//Delete the source file after copy
		err = srcAbst.Remove(src)
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

	return nil
}

// Copy a given directory, with no progress udpate
func CopyDir(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string) error {
	return dirCopy(srcFsh, src, destFsh, dest, func(progress int, name string) int { return 0 })
}

// Replacment of the legacy dirCopy plugin with filepath.Walk function. Allowing real time progress update to front end
func dirCopy(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, realDest string, progressUpdate func(int, string) int) error {
	srcFshAbs := srcFsh.FileSystemAbstraction
	destFshAbs := destFsh.FileSystemAbstraction
	//Get the total file counts
	totalFileCounts := int64(0)
	srcFshAbs.Walk(src, func(path string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			//Updates 22 April 2021, chnaged from file count to file size for progress update
			//totalFileCounts++
			totalFileCounts += info.Size()
		}
		return nil
	})

	//Make the destinaton directory
	if !destFshAbs.FileExists(realDest) {
		destFshAbs.Mkdir(realDest, 0755)
	}

	//Start moving
	fileCounter := int64(0)
	src = filepath.ToSlash(src)
	err := srcFshAbs.Walk(src, func(path string, info os.FileInfo, err error) error {
		path = filepath.ToSlash(path)
		var folderRootRelative string = strings.TrimPrefix(path, src)
		if folderRootRelative == "" {
			return nil
		}

		if info.IsDir() {
			//Mkdir base on relative path
			return destFshAbs.MkdirAll(filepath.Join(realDest, folderRootRelative), 0755)
		} else {
			//fileCounter++
			fileCounter += info.Size()
			//Move file base on relative path
			fileSrc := filepath.ToSlash(filepath.Join(filepath.Clean(src), folderRootRelative))
			fileDest := filepath.ToSlash(filepath.Join(filepath.Clean(realDest), folderRootRelative))

			//Update move progress
			if progressUpdate != nil {
				statusCode := progressUpdate(int(float64(fileCounter)/float64(totalFileCounts)*100), arozfs.Base(fileSrc))
				for statusCode == 1 {
					//Wait for the task to be resumed
					time.Sleep(1 * time.Second)
					statusCode = progressUpdate(int(float64(fileCounter)/float64(totalFileCounts)*100), arozfs.Base(fileSrc))
				}
				if statusCode == 2 {
					//Cancel
					return errors.New("Operation cancelled by user")
				}
			}

			//Move the file using BLFC
			f, err := srcFshAbs.ReadStream(fileSrc)
			if err != nil {
				log.Println(err)
				return err
			}
			defer f.Close()

			err = destFshAbs.WriteStream(fileDest, f, 0755)
			if err != nil {
				fmt.Println(err)
				return err
			}

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
//Deprecated Since ArozOS v2.000
/*
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
*/

// Check if a local path is dir, do not use with file system abstraction realpath
func IsDir(path string) bool {
	if !FileExists(path) {
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

// Unzip tar.gz file, use for unpacking web.tar.gz for lazy people
func ExtractTarGzipFile(filename string, outfile string) error {
	f, err := os.Open(filename)
	if err != nil {
		return err
	}

	err = ExtractTarGzipByStream(filepath.Clean(outfile), f, true)
	if err != nil {
		return err
	}

	return f.Close()
}
func ExtractTarGzipByStream(basedir string, gzipStream io.Reader, onErrorResumeNext bool) error {
	uncompressedStream, err := gzip.NewReader(gzipStream)
	if err != nil {
		return err
	}

	tarReader := tar.NewReader(uncompressedStream)

	for {
		header, err := tarReader.Next()

		if err == io.EOF {
			break
		}

		if err != nil {
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			err := os.Mkdir(header.Name, 0755)
			if err != nil {
				if !onErrorResumeNext {
					return err
				}

			}
		case tar.TypeReg:
			outFile, err := os.Create(filepath.Join(basedir, header.Name))
			if err != nil {
				if !onErrorResumeNext {
					return err
				}
			}
			_, err = io.Copy(outFile, tarReader)
			if err != nil {
				if !onErrorResumeNext {
					return err
				}
			}
			outFile.Close()

		default:
			//Unknown filetype, continue

		}

	}
	return nil
}
