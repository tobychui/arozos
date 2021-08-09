// +build windows

package hidden

import (
	"path/filepath"
	"strings"
	"syscall"
)

func hide(filename string) error {
	filenameW, err := syscall.UTF16PtrFromString(filename)
	if err != nil {
		return err
	}
	err = syscall.SetFileAttributes(filenameW, syscall.FILE_ATTRIBUTE_HIDDEN)
	if err != nil {
		return err
	}
	return nil
}

func isHidden(filename string) (bool, error) {
	filename = filepath.ToSlash(filename)
	if strings.Contains(filename, "/") {
		filename = filepath.Base(filename)
	}

	if len(filename) > 0 && filename[0:1] == "." {
		return true, nil
	}

	pointer, err := syscall.UTF16PtrFromString(filename)
	if err != nil {
		return false, err
	}

	attributes, err := syscall.GetFileAttributes(pointer)
	if err != nil {
		return false, err
	}

	return attributes&syscall.FILE_ATTRIBUTE_HIDDEN != 0, nil
}
