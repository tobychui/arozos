//go:build windows

package smbserver

import (
	"errors"
	"syscall"
)

const (
	errorDiskFull      = syscall.Errno(112)
	errorDirNotEmpty   = syscall.Errno(145)
	errorDirectory     = syscall.Errno(267)
	errorHandleDiskFul = syscall.Errno(39)
)

func isNotDirectory(err error) bool { return errors.Is(err, errorDirectory) }
func isDiskFull(err error) bool {
	return errors.Is(err, errorDiskFull) || errors.Is(err, errorHandleDiskFul)
}
func isNotEmpty(err error) bool { return errors.Is(err, errorDirNotEmpty) }
