package trashfs

/*
	trashfs.go

	This package implements the trash:/ virtual filesystem for ArozOS.

	Design philosophy (following Toby's original design):
	  - Files are NOT moved across filesystems. When a file is recycled,
	    it is renamed into a .metadata/.trash/ subdirectory on the SAME
	    filesystem it lives on. This avoids cross-device copies, excessive
	    SSD/SD-card wear, and works for network drives.
	  - The trash:/ FSH is a VIRTUAL aggregating view. It walks all registered
	    FSH roots, finds every .metadata/.trash/ directory, and presents the
	    contents as a unified virtual filesystem.
	  - Virtual paths are of the form trash:/<hex-encoded real path>.
	    Hex encoding is used so the paths are URL-safe and round-trip through
	    filepath.Clean without modification.
	  - Deleting a file from trash:/ permanently removes it from disk.
	  - file_system.go detects srcFsh.UUID == "trash" to trigger a permanent
	    delete instead of a second move-to-trash.
*/

import (
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/utils"
)

const (
	// TrashFSUUID is the reserved virtual-path UUID for the trash filesystem.
	TrashFSUUID = "trash"

	// TrashRootSentinel is returned by VirtualPathToRealPath when the path is
	// the trash root (trash:/ or trash:). Callers that handle trash:/ listing
	// specially will never pass this to the OS.
	TrashRootSentinel = "\x00trash_root\x00"

	// LegacyTrashDir is the directory name used by the legacy trash mechanism.
	// Files are moved here when recycled (adjacent to the file's own directory).
	LegacyTrashDir = ".trash"
)

// TrashFSAbstraction implements FileSystemAbstraction for the trash:/ virtual
// filesystem.  It has no backing storage of its own; instead it resolves paths
// from hex-encoded real paths and delegates I/O directly to the OS.
type TrashFSAbstraction struct {
	UUID      string
	Hierarchy string
	ReadOnly  bool
}

// NewTrashFSAbstraction returns a TrashFSAbstraction ready for use.
func NewTrashFSAbstraction() TrashFSAbstraction {
	return TrashFSAbstraction{
		UUID:      TrashFSUUID,
		Hierarchy: "user",
		ReadOnly:  false,
	}
}

// ---- Path translation ----

// VirtualPathToRealPath decodes a trash:/ virtual path back to the real
// on-disk path.  The subpath from GetIDFromVirtualPath is either "" (root) or
// "/<hex-encoded real path>".
func (t TrashFSAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	// Strip any remaining uuid: prefix that might arrive from callers.
	subpath = strings.TrimPrefix(subpath, TrashFSUUID+":")
	subpath = strings.TrimPrefix(subpath, "/")

	if subpath == "" {
		// Caller asked for the trash root - return sentinel.
		return TrashRootSentinel, nil
	}

	decoded, err := hex.DecodeString(subpath)
	if err != nil {
		return "", errors.New("invalid trash:/ path (hex decode failed): " + err.Error())
	}
	return string(decoded), nil
}

// RealPathToVirtualPath converts an absolute on-disk path (inside a .trash
// directory) to a trash:/ virtual path by hex-encoding the real path.
func (t TrashFSAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	fullpath = filepath.ToSlash(filepath.Clean(fullpath))
	encoded := hex.EncodeToString([]byte(fullpath))
	return TrashFSUUID + ":/" + encoded, nil
}

// ---- Fundamental operations ----

func (t TrashFSAbstraction) Chmod(filename string, mode os.FileMode) error {
	if filename == TrashRootSentinel {
		return arozfs.ErrOperationNotSupported
	}
	return os.Chmod(filename, mode)
}
func (t TrashFSAbstraction) Chown(filename string, uid int, gid int) error {
	if filename == TrashRootSentinel {
		return arozfs.ErrOperationNotSupported
	}
	return os.Chown(filename, uid, gid)
}
func (t TrashFSAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	if filename == TrashRootSentinel {
		return arozfs.ErrOperationNotSupported
	}
	return os.Chtimes(filename, atime, mtime)
}
func (t TrashFSAbstraction) Create(filename string) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}
func (t TrashFSAbstraction) Mkdir(filename string, mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}
func (t TrashFSAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}
func (t TrashFSAbstraction) Name() string {
	return ""
}
func (t TrashFSAbstraction) Open(filename string) (arozfs.File, error) {
	if filename == TrashRootSentinel {
		return nil, arozfs.ErrOperationNotSupported
	}
	return os.Open(filename)
}
func (t TrashFSAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	if filename == TrashRootSentinel {
		return nil, arozfs.ErrOperationNotSupported
	}
	return os.OpenFile(filename, flag, perm)
}

// Remove permanently deletes filename from disk.
func (t TrashFSAbstraction) Remove(filename string) error {
	if filename == TrashRootSentinel {
		return arozfs.ErrOperationNotSupported
	}
	return os.Remove(filename)
}

// RemoveAll permanently deletes path (file or directory tree) from disk.
func (t TrashFSAbstraction) RemoveAll(path string) error {
	if path == TrashRootSentinel {
		return arozfs.ErrOperationNotSupported
	}
	return os.RemoveAll(path)
}

func (t TrashFSAbstraction) Rename(oldname, newname string) error {
	if oldname == TrashRootSentinel || newname == TrashRootSentinel {
		return arozfs.ErrOperationNotSupported
	}
	return os.Rename(oldname, newname)
}

func (t TrashFSAbstraction) Stat(filename string) (os.FileInfo, error) {
	if filename == TrashRootSentinel {
		return &syntheticDirInfo{name: "trash"}, nil
	}
	return os.Stat(filename)
}

func (t TrashFSAbstraction) Close() error {
	return nil
}

// ---- Utility methods ----

func (t TrashFSAbstraction) FileExists(realpath string) bool {
	if realpath == TrashRootSentinel {
		return true
	}
	return utils.FileExists(realpath)
}

func (t TrashFSAbstraction) IsDir(realpath string) bool {
	if realpath == TrashRootSentinel {
		return true
	}
	fi, err := os.Stat(realpath)
	if err != nil {
		return false
	}
	return fi.IsDir()
}

// Glob returns matching paths, excluding .trashinfo sidecar files.
func (t TrashFSAbstraction) Glob(realpathWildcard string) ([]string, error) {
	if realpathWildcard == TrashRootSentinel || strings.HasPrefix(realpathWildcard, TrashRootSentinel) {
		return nil, nil
	}
	return filepath.Glob(realpathWildcard)
}

func (t TrashFSAbstraction) GetFileSize(realpath string) int64 {
	if realpath == TrashRootSentinel {
		return 0
	}
	fi, err := os.Stat(realpath)
	if err != nil {
		return 0
	}
	return fi.Size()
}

func (t TrashFSAbstraction) GetModTime(realpath string) (int64, error) {
	if realpath == TrashRootSentinel {
		return 0, nil
	}
	fi, err := os.Stat(realpath)
	if err != nil {
		return -1, err
	}
	return fi.ModTime().Unix(), nil
}

func (t TrashFSAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}

func (t TrashFSAbstraction) ReadFile(filename string) ([]byte, error) {
	if filename == TrashRootSentinel {
		return nil, arozfs.ErrOperationNotSupported
	}
	return os.ReadFile(filename)
}

// ReadDir returns an empty list for the sentinel root (actual listing is done
// by system_fs_handleTrashListing in file_system.go).
func (t TrashFSAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	if filename == TrashRootSentinel {
		return []fs.DirEntry{}, nil
	}
	return os.ReadDir(filename)
}

func (t TrashFSAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}

func (t TrashFSAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	if filename == TrashRootSentinel {
		return nil, arozfs.ErrOperationNotSupported
	}
	return os.Open(filename)
}

// Walk traverses the tree rooted at root.  For the sentinel root, it is a
// no-op (aggregation is handled by system_fs_listTrash in file_system.go).
func (t TrashFSAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	if root == TrashRootSentinel {
		return nil
	}
	return filepath.Walk(root, walkFn)
}

func (t TrashFSAbstraction) Heartbeat() error {
	return nil
}

// ---- Helpers ----

// RealPathToTrashVPath is a package-level convenience function that converts a
// real .trash file path to its trash:/ virtual path.  It mirrors the
// RealPathToVirtualPath method but can be called without an instance.
func RealPathToTrashVPath(realpath string) string {
	realpath = filepath.ToSlash(filepath.Clean(realpath))
	return TrashFSUUID + ":/" + hex.EncodeToString([]byte(realpath))
}

// TrashVPathToRealPath decodes a full trash:/ virtual path (e.g.
// "trash:/2f66696c65...") back to the real on-disk path.
func TrashVPathToRealPath(trashVpath string) (string, error) {
	encoded := strings.TrimPrefix(trashVpath, TrashFSUUID+":/")
	encoded = strings.TrimPrefix(encoded, TrashFSUUID+":")
	if encoded == "" {
		return "", errors.New("path is trash root, not a specific file")
	}
	decoded, err := hex.DecodeString(encoded)
	if err != nil {
		return "", errors.New("invalid trash:/ path: " + err.Error())
	}
	return string(decoded), nil
}

// IsLegacyTrashFile reports whether realpath is inside a legacy .trash
// directory (i.e. a file recycled before trash:/ was introduced).
// The canonical path is .metadata/.trash/, so both the parent dir and its
// parent must match.
func IsLegacyTrashFile(realpath string) bool {
	dir := filepath.Dir(realpath)
	return filepath.Base(dir) == LegacyTrashDir && filepath.Base(filepath.Dir(dir)) == ".metadata"
}

// syntheticDirInfo is a minimal os.FileInfo that represents the virtual trash
// root directory.
type syntheticDirInfo struct {
	name string
}

func (s *syntheticDirInfo) Name() string      { return s.name }
func (s *syntheticDirInfo) Size() int64       { return 0 }
func (s *syntheticDirInfo) Mode() os.FileMode { return os.ModeDir | 0755 }
func (s *syntheticDirInfo) ModTime() time.Time { return time.Time{} }
func (s *syntheticDirInfo) IsDir() bool       { return true }
func (s *syntheticDirInfo) Sys() interface{}  { return nil }
