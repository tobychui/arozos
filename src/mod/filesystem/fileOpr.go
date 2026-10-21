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
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/hidden"
	"imuslab.com/arozos/mod/info/logger"

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

	//Keep listening to the user while a large file is being extracted
	reporter := newProgressReporter(func(currentFile string, _ int64, _ int64) int {
		return progressHandler(currentFile, unzippedFileCount, totalFileCounts, float64(unzippedFileCount)/float64(totalFileCounts)*100.0)
	}, 0)

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
			reporter.currentFile = file.Name
			_, err = io.Copy(writer, newProgressReader(reader, reporter, 0))
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
	return ArozZipFileWithProgressAndCompression(targetFshs, filelist, outputFsh, outputfile, includeTopLevelFolder, flate.DefaultCompression, progressHandler)
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
	return ArozZipFileWithProgressAndCompression(sourceFshs, filelist, outputFsh, outputfile, includeTopLevelFolder, compressionLevel, nil)
}

/*
ArozZipFileWithProgressAndCompression combines compression level control with real-time progress updates.
Accepts nil fsh entries for locally-buffered source paths, a nil outputFsh for a
local output file and a nil progressHandler for zipping without progress updates.

The progress handler returns the FsOpr_* control signal of the operation, and it
is asked for it all the way through: while the source folders are scanned,
after every file and while a large file streams into the archive. A pause holds
the zipping where it stands and a cancel stops it within a fraction of a second,
instead of only once the scan or the current file is done. An archive that is
cancelled or fails half way is removed rather than left behind half written.
*/
func ArozZipFileWithProgressAndCompression(sourceFshs []*FileSystemHandler, filelist []string, outputFsh *FileSystemHandler, outputfile string, includeTopLevelFolder bool, compressionLevel int, progressHandler func(string, int, int, float64) int) error {
	//The archive progress is counted in files. It goes through a progressReporter
	//so the handler calls are rate limited and its pause / cancel signal applied
	currentFileCount := 0
	totalFileCount := 0
	var reporter *progressReporter
	if progressHandler != nil {
		reporter = newProgressReporter(func(currentFile string, _ int64, _ int64) int {
			progress := float64(0)
			if totalFileCount > 0 {
				progress = float64(currentFileCount) / float64(totalFileCount) * 100
			}
			return progressHandler(currentFile, currentFileCount, totalFileCount, progress)
		}, 0)

		//Count the files first so the progress has a total to measure against
		for i, srcpath := range filelist {
			fshAbs := zipSourceAbstraction(sourceFshs[i])
			reporter.currentFile = arozfs.Base(srcpath)
			if !fshAbs.IsDir(srcpath) {
				totalFileCount++
				continue
			}

			fshAbs.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
				//Scanning a large folder takes a while, keep listening to the user
				if reportErr := reporter.report(0, false); reportErr != nil {
					return reportErr
				}
				if err != nil || info == nil || info.IsDir() || insideHiddenFolder(path) {
					//Unreadable entries fail the zipping below, not the count
					return nil
				}
				totalFileCount++
				return nil
			})

			//The walk may have ended on a pause or a cancel, see where it stands
			if err := reporter.report(0, true); err != nil {
				return err
			}
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

	writer := zip.NewWriter(file)
	writer.RegisterCompressor(zip.Deflate, func(out io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(out, compressionLevel)
	})

	err = func() error {
		for i, srcpath := range filelist {
			fshAbs := zipSourceAbstraction(sourceFshs[i])
			if !fshAbs.IsDir(srcpath) {
				//This is a file
				relativePath := arozfs.Base(srcpath)
				if includeTopLevelFolder {
					relativePath = arozfs.Base(filepath.Dir(srcpath)) + "/" + relativePath
				}
				if err := addZipEntry(writer, fshAbs, srcpath, relativePath, reporter); err != nil {
					return err
				}
				currentFileCount++
				if err := reporter.report(0, true); err != nil {
					return err
				}
				continue
			}

			//This is a directory
			topLevelFolderName := filepath.ToSlash(arozfs.Base(filepath.Dir(srcpath)) + "/" + arozfs.Base(srcpath))
			err := fshAbs.Walk(srcpath, func(path string, info os.FileInfo, err error) error {
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

				relativePath := strings.ReplaceAll(filepath.ToSlash(path), filepath.ToSlash(filepath.Clean(srcpath))+"/", "")
				if includeTopLevelFolder {
					relativePath = topLevelFolderName + "/" + relativePath
				} else {
					relativePath = arozfs.Base(srcpath) + "/" + relativePath
				}
				if err := addZipEntry(writer, fshAbs, path, relativePath, reporter); err != nil {
					return err
				}
				currentFileCount++
				return reporter.report(0, true)
			})
			if err != nil {
				return err
			}
		}
		return nil
	}()

	//Close the writer before the file, it still has the central directory to write
	if closeErr := writer.Close(); err == nil {
		err = closeErr
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		//Never leave a half written archive behind
		if outputFsh != nil {
			outputFsh.FileSystemAbstraction.Remove(outputfile)
		} else {
			os.Remove(outputfile)
		}
		return err
	}

	return nil
}

// zipSourceAbstraction returns the abstraction a zip source is read through.
// A nil handler stands for a path on the local disk, like a remote file that
// was buffered to local first.
func zipSourceAbstraction(fsh *FileSystemHandler) FileSystemAbstraction {
	if fsh == nil {
		return localfs.NewLocalFileSystemAbstraction("", "", "", true)
	}
	return fsh.FileSystemAbstraction
}

// addZipEntry streams one source file into the archive under relativePath.
// The stream reports to the reporter, so a pause or cancel also reaches a file
// that takes minutes to compress. Pass in a nil reporter to skip the reporting.
func addZipEntry(writer *zip.Writer, fshAbs FileSystemAbstraction, path string, relativePath string, reporter *progressReporter) error {
	if reporter != nil {
		reporter.currentFile = arozfs.Base(path)
	}

	thisFile, err := fshAbs.ReadStream(path)
	if err != nil {
		return err
	}
	defer thisFile.Close()

	f, err := writer.Create(relativePath)
	if err != nil {
		return err
	}

	_, err = io.Copy(f, newProgressReader(thisFile, reporter, 0))
	return err
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

// FileCopy copies a file or folder, reporting its progress as a percentage.
// Prefer FileCopyWithProgress for a progress report counted in bytes.
func FileCopy(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string, mode string, progressUpdate func(int, string) int) error {
	return FileCopyWithProgress(srcFsh, src, destFsh, dest, mode, legacyProgressAdapter(progressUpdate))
}

// FileCopyWithProgress copies a file or folder and reports how many of its bytes
// are already done, see FileOperationProgressHandler.
func FileCopyWithProgress(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string, mode string, progressHandler FileOperationProgressHandler) error {
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
		err := dirCopy(srcFsh, src, destFsh, realDest, progressHandler)
		if err != nil {
			return err
		}

	} else {
		//Source is file only. Copy file.
		realDest := filepath.Join(dest, copiedFilename)
		err := streamFileWithProgress(srcFsh, src, destFsh, realDest, progressHandler)
		if err != nil {
			return err
		}
	}
	return nil
}

/*
streamFileWithProgress copies one file from one file system to another, counting
the bytes as they go past so the caller can follow a large file while it is still
being written. A cancelled transfer takes its half written destination file with
it on the way out.
*/
func streamFileWithProgress(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, realDest string, progressHandler FileOperationProgressHandler) error {
	srcFshAbs := srcFsh.FileSystemAbstraction
	destFshAbs := destFsh.FileSystemAbstraction

	reporter := newProgressReporter(progressHandler, srcFshAbs.GetFileSize(src))
	reporter.currentFile = arozfs.Base(realDest)
	if err := reporter.report(0, true); err != nil {
		return err
	}

	f, err := srcFshAbs.ReadStream(src)
	if err != nil {
		return err
	}
	defer f.Close()

	err = destFshAbs.WriteStream(realDest, newProgressReader(f, reporter, 0), 0775)
	if err != nil {
		if reporter.cancelled {
			//Do not leave a truncated file behind at the destination
			destFshAbs.Remove(realDest)
		}
		return err
	}

	//Report the file as done, the reader stops one report short of the end
	return reporter.report(reporter.totalBytes, true)
}

/*
SameFileSystem reports whether two handlers point at the same storage.

A move between two paths of one storage can be handed to that storage as a
rename, which is instant no matter how large the file is, instead of being
streamed out and back through ArozOS.
*/
func SameFileSystem(srcFsh *FileSystemHandler, destFsh *FileSystemHandler) bool {
	if srcFsh == nil || destFsh == nil {
		return false
	}
	if srcFsh == destFsh {
		return true
	}
	return srcFsh.UUID != "" && srcFsh.UUID == destFsh.UUID
}

// isLocalFileSystem reports whether a handler is backed by a disk of this machine
func isLocalFileSystem(fsh *FileSystemHandler) bool {
	if fsh == nil {
		return false
	}
	_, isLocal := fsh.FileSystemAbstraction.(localfs.LocalFileSystemAbstraction)
	return isLocal
}

// FileMove moves a file or folder, reporting its progress as a percentage.
// Prefer FileMoveWithProgress for a progress report counted in bytes.
func FileMove(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string, mode string, fastMove bool, progressUpdate func(int, string) int) error {
	return FileMoveWithProgress(srcFsh, src, destFsh, dest, mode, fastMove, legacyProgressAdapter(progressUpdate))
}

// FileMoveWithProgress moves a file or folder and reports how many of its bytes
// are already done, see FileOperationProgressHandler.
func FileMoveWithProgress(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string, mode string, fastMove bool, progressHandler FileOperationProgressHandler) error {
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
		//Create it on the destination storage, not on whatever disk ArozOS runs on
		destAbst.MkdirAll(dest, 0775)
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

	/*
		Both ends of this move sit on the same storage, so ask the storage to do
		the move itself instead of streaming every byte out to ArozOS and back
		in again. That is a rename on a local disk, a server side move on SMB and
		WebDAV, and a server side copy on S3.

		Anything the storage cannot do on its own falls through to the copy and
		delete path below, which is also what happens for a move that crosses two
		different storages.
	*/
	if fastMove && !srcFsh.ReadOnly && !destFsh.ReadOnly {
		realDest := filepath.Join(dest, movedFilename)

		if SameFileSystem(srcFsh, destFsh) {
			//One storage, both ends. Let it move the file on its own.
			if err := srcAbst.Rename(src, realDest); err == nil {
				//Moved by the storage itself, nothing was streamed
				return nil
			}
			//The storage could not do it. Back to the copy and delete method.
			logger.PrintAndLog("Filesystem", "Storage side move unavailable for "+src+", falling back to copy and delete", nil)

		} else if isLocalFileSystem(srcFsh) && isLocalFileSystem(destFsh) {
			/*
				Two different storages that both live on disks of this machine.
				A rename still finishes instantly whenever the two happen to sit
				on the same volume, and simply fails when they do not.
			*/
			if err := os.Rename(src, realDest); err == nil {
				return nil
			}
		}
	}

	//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
	if srcAbst.IsDir(src) {
		//Source file is directory. CopyFolder
		realDest := filepath.Join(dest, movedFilename)
		//err := dircpy.Copy(src, realDest)

		err := dirCopy(srcFsh, src, destFsh, realDest, progressHandler)
		if err != nil {
			return err
		} else {
			//Move completed. Remove source file.
			srcAbst.RemoveAll(src)
			return nil
		}

	} else {
		//Source is file only. Copy file, then remove the source.
		realDest := filepath.Join(dest, movedFilename)
		err := streamFileWithProgress(srcFsh, src, destFsh, realDest, progressHandler)
		if err != nil {
			return err
		}

		//Delete the source file after copy
		err = srcAbst.Remove(src)
		counter := 0
		for err != nil {
			//Sometime Windows need this to prevent windows caching bring problems to file remove
			time.Sleep(1 * time.Second)
			counter++
			logger.PrintAndLog("Filesystem", "Retrying to remove file: "+src, nil)
			err = srcAbst.Remove(src)
			if err == nil {
				break
			}
			if counter > 10 {
				return errors.New("Source file remove failed.")
			}
		}

	}

	return nil
}

// Copy a given directory, with no progress udpate
func CopyDir(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, dest string) error {
	return dirCopy(srcFsh, src, destFsh, dest, nil)
}

// Replacment of the legacy dirCopy plugin with filepath.Walk function. Allowing real time progress update to front end
func dirCopy(srcFsh *FileSystemHandler, src string, destFsh *FileSystemHandler, realDest string, progressHandler FileOperationProgressHandler) error {
	srcFshAbs := srcFsh.FileSystemAbstraction
	destFshAbs := destFsh.FileSystemAbstraction
	//Get the total size of this folder. Progress is counted in bytes so a folder
	//holding one large file does not jump straight from nothing to done.
	totalBytes := int64(0)
	srcFshAbs.Walk(src, func(path string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			totalBytes += info.Size()
		}
		return nil
	})

	//Make the destinaton directory
	if !destFshAbs.FileExists(realDest) {
		destFshAbs.Mkdir(realDest, 0755)
	}

	reporter := newProgressReporter(progressHandler, totalBytes)

	//Start moving
	copiedBytes := int64(0)
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
			//Move file base on relative path
			fileSrc := filepath.ToSlash(filepath.Join(filepath.Clean(src), folderRootRelative))
			fileDest := filepath.ToSlash(filepath.Join(filepath.Clean(realDest), folderRootRelative))

			//Report where this folder actually is before starting on this file,
			//the bytes of this one are only counted once they are written
			reporter.currentFile = arozfs.Base(fileSrc)
			if err := reporter.report(copiedBytes, true); err != nil {
				return err
			}

			f, err := srcFshAbs.ReadStream(fileSrc)
			if err != nil {
				logger.PrintAndLog("Filesystem", fmt.Sprint(err), nil)
				return err
			}
			defer f.Close()

			err = destFshAbs.WriteStream(fileDest, newProgressReader(f, reporter, copiedBytes), 0755)
			if err != nil {
				if reporter.cancelled {
					//Do not leave a truncated file behind at the destination
					destFshAbs.Remove(fileDest)
				}
				logger.PrintAndLog("Filesystem", fmt.Sprint(err), err)
				return err
			}

			copiedBytes += info.Size()
			if err := reporter.report(copiedBytes, true); err != nil {
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
		logger.PrintAndLog("Filesystem", fmt.Sprint(err), nil)
		os.Exit(1)
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
