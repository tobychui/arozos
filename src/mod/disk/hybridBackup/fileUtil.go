package hybridBackup

import (
	"errors"
	"io"
	"os"
)

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

//Get the last modification tiem of a given file
func lastModTime(filename string) int64 {
	file, err := os.Stat(filename)

	if err != nil {
		return 0
	}

	modifiedtime := file.ModTime()
	return modifiedtime.Unix()
}

func isDir(filename string) bool {
	file, err := os.Open(filename)
	if err != nil {
		return false
	}
	fileInfo, err := file.Stat()
	if err != nil {
		return false
	}

	return fileInfo.IsDir()
}

func fileSize(filename string) int64 {
	fi, err := os.Stat("/path/to/file")
	if err != nil {
		return -1
	}
	// get the size
	size := fi.Size()
	return size
}
