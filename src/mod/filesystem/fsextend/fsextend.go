package fsextend

/*
	fsextend.go

	This module extend the file system handler function to virtualized / emulated
	interfaces
*/

type VirtualizedFileSystemPathResolver interface {
	VirtualPathToRealPath(string) (string, error)
	RealPathToVirtualPath(string) (string, error)
}
