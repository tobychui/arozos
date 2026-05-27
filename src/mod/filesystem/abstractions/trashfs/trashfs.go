package trashfs

/*
	trashfs.go

	This package implements the trash:/ virtual filesystem for ArozOS.

	The trash:/ filesystem uses a dedicated trash directory with user-isolated
	subdirectories. Each trashed file is stored alongside a .trashinfo sidecar
	file that records its original virtual path and deletion timestamp, enabling
	restore operations.

	Behaviour:
	  - Recycling a file moves it to trash:/ and writes a .trashinfo sidecar.
	  - Deleting a file from trash:/ permanently removes both the file and its sidecar.
	  - The trash:/ FSH uses the "user" hierarchy so each user has an isolated
	    subtree at trash:/users/<username>/.

	The TrashFSAbstraction wraps a LocalFileSystemAbstraction and is identified
	by the reserved UUID "trash". file_system.go checks this UUID to decide
	whether a "recycle" operation should do a permanent delete instead of
	moving the file to another .trash directory.
*/

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/utils"
)

const (
	// TrashFSUUID is the reserved virtual-path UUID for the trash filesystem.
	TrashFSUUID = "trash"
	// TrashInfoExt is the suffix appended to every sidecar metadata file.
	TrashInfoExt = ".trashinfo"
)

// TrashInfo holds the metadata stored in a .trashinfo sidecar file.
type TrashInfo struct {
	// OriginalVpath is the full virtual path the file had before it was trashed,
	// e.g. "user:/documents/report.pdf".
	OriginalVpath string `json:"original_vpath"`
	// OriginalFilename is the bare filename (no directory, no timestamp suffix).
	OriginalFilename string `json:"original_filename"`
	// DeletedAt is the Unix timestamp (seconds) when the file was trashed.
	DeletedAt int64 `json:"deleted_at"`
	// IsDir is true when the trashed entry is a directory.
	IsDir bool `json:"is_dir"`
}

// TrashFSAbstraction implements FileSystemAbstraction for the trash:/ filesystem.
// Internally it delegates all actual I/O to a LocalFileSystemAbstraction that
// is rooted at the configured trash directory.
type TrashFSAbstraction struct {
	UUID      string
	Rootpath  string
	Hierarchy string
	ReadOnly  bool

	// inner performs all real file-system operations.
	inner localfs.LocalFileSystemAbstraction
}

// NewTrashFSAbstraction returns a new TrashFSAbstraction backed by rootpath.
// rootpath should be a dedicated directory, e.g. "{storage_root}/trash/".
// hierarchy should normally be "user" so every user gets an isolated subtree.
func NewTrashFSAbstraction(uuid, rootpath, hierarchy string, readonly bool) TrashFSAbstraction {
	return TrashFSAbstraction{
		UUID:      uuid,
		Rootpath:  rootpath,
		Hierarchy: hierarchy,
		ReadOnly:  readonly,
		inner:     localfs.NewLocalFileSystemAbstraction(uuid, rootpath, hierarchy, readonly),
	}
}

// ---- FileSystemAbstraction delegated methods ----

func (t TrashFSAbstraction) Chmod(filename string, mode os.FileMode) error {
	return t.inner.Chmod(filename, mode)
}
func (t TrashFSAbstraction) Chown(filename string, uid int, gid int) error {
	return t.inner.Chown(filename, uid, gid)
}
func (t TrashFSAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	return t.inner.Chtimes(filename, atime, mtime)
}
func (t TrashFSAbstraction) Create(filename string) (arozfs.File, error) {
	return t.inner.Create(filename)
}
func (t TrashFSAbstraction) Mkdir(filename string, mode os.FileMode) error {
	return t.inner.Mkdir(filename, mode)
}
func (t TrashFSAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	return t.inner.MkdirAll(filename, mode)
}
func (t TrashFSAbstraction) Name() string {
	return ""
}
func (t TrashFSAbstraction) Open(filename string) (arozfs.File, error) {
	return t.inner.Open(filename)
}
func (t TrashFSAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	return t.inner.OpenFile(filename, flag, perm)
}

// Remove permanently deletes filename and its .trashinfo sidecar (if present).
func (t TrashFSAbstraction) Remove(filename string) error {
	// Delete the .trashinfo sidecar if it exists.
	sidecar := filename + TrashInfoExt
	if utils.FileExists(sidecar) {
		os.Remove(sidecar)
	}
	return os.Remove(filename)
}

// RemoveAll permanently deletes path (and its .trashinfo sidecar if present).
func (t TrashFSAbstraction) RemoveAll(path string) error {
	sidecar := path + TrashInfoExt
	if utils.FileExists(sidecar) {
		os.Remove(sidecar)
	}
	return os.RemoveAll(path)
}

func (t TrashFSAbstraction) Rename(oldname, newname string) error {
	return t.inner.Rename(oldname, newname)
}
func (t TrashFSAbstraction) Stat(filename string) (os.FileInfo, error) {
	return t.inner.Stat(filename)
}
func (t TrashFSAbstraction) Close() error {
	return nil
}

// ---- Path translation ----

func (t TrashFSAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	return t.inner.VirtualPathToRealPath(subpath, username)
}

func (t TrashFSAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	return t.inner.RealPathToVirtualPath(fullpath, username)
}

// ---- Utility methods ----

func (t TrashFSAbstraction) FileExists(realpath string) bool {
	return utils.FileExists(realpath)
}

func (t TrashFSAbstraction) IsDir(realpath string) bool {
	return t.inner.IsDir(realpath)
}

// Glob returns matching paths, excluding .trashinfo sidecar files from results.
func (t TrashFSAbstraction) Glob(realpathWildcard string) ([]string, error) {
	all, err := t.inner.Glob(realpathWildcard)
	return filterSidecars(all), err
}

func (t TrashFSAbstraction) GetFileSize(realpath string) int64 {
	return t.inner.GetFileSize(realpath)
}
func (t TrashFSAbstraction) GetModTime(realpath string) (int64, error) {
	return t.inner.GetModTime(realpath)
}
func (t TrashFSAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	return t.inner.WriteFile(filename, content, mode)
}
func (t TrashFSAbstraction) ReadFile(filename string) ([]byte, error) {
	return t.inner.ReadFile(filename)
}

// ReadDir returns directory entries, hiding .trashinfo sidecar files.
func (t TrashFSAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	all, err := os.ReadDir(filename)
	if err != nil {
		return nil, err
	}
	filtered := make([]fs.DirEntry, 0, len(all))
	for _, e := range all {
		if !strings.HasSuffix(e.Name(), TrashInfoExt) {
			filtered = append(filtered, e)
		}
	}
	return filtered, nil
}

func (t TrashFSAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	return t.inner.WriteStream(filename, stream, mode)
}
func (t TrashFSAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	return t.inner.ReadStream(filename)
}

// Walk traverses the tree rooted at root, skipping .trashinfo sidecar files.
func (t TrashFSAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if strings.HasSuffix(path, TrashInfoExt) {
			return nil // skip sidecar files
		}
		return walkFn(path, info, err)
	})
}

func (t TrashFSAbstraction) Heartbeat() error {
	return nil
}

// ---- TrashInfo helpers ----

// WriteTrashInfo writes a .trashinfo sidecar alongside trashFilePath.
// trashFilePath is the real (on-disk) path of the already-moved trash file.
func WriteTrashInfo(trashFilePath string, info TrashInfo) error {
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(trashFilePath+TrashInfoExt, data, 0644)
}

// ReadTrashInfo reads the .trashinfo sidecar for trashFilePath.
// Returns an error if the sidecar does not exist or cannot be parsed.
func ReadTrashInfo(trashFilePath string) (TrashInfo, error) {
	sidecar := trashFilePath + TrashInfoExt
	data, err := os.ReadFile(sidecar)
	if err != nil {
		return TrashInfo{}, err
	}
	var info TrashInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return TrashInfo{}, err
	}
	return info, nil
}

// TrashInfoExists reports whether a .trashinfo sidecar exists for trashFilePath.
func TrashInfoExists(trashFilePath string) bool {
	return utils.FileExists(trashFilePath + TrashInfoExt)
}

// BuildTrashFilename returns the on-disk filename for a trashed file:
//
//	{timestamp}_{originalBasename}
//
// Using the timestamp as a prefix keeps the directory ordered by deletion time
// and avoids name collisions when the same file is deleted multiple times.
func BuildTrashFilename(originalBasename string, deletedAt int64) string {
	return strings.Join([]string{
		utils.Int64ToString(deletedAt),
		originalBasename,
	}, "_")
}

// ParseTrashFilename splits a trash filename back into (timestamp, originalBasename).
// Returns an error if the name does not follow the expected format.
func ParseTrashFilename(trashBasename string) (deletedAt int64, originalBasename string, err error) {
	idx := strings.Index(trashBasename, "_")
	if idx <= 0 {
		return 0, "", errors.New("invalid trash filename: missing timestamp prefix")
	}
	ts, convErr := utils.StringToInt64(trashBasename[:idx])
	if convErr != nil {
		return 0, "", errors.New("invalid trash filename: non-numeric timestamp")
	}
	return ts, trashBasename[idx+1:], nil
}

// filterSidecars removes any path that ends with TrashInfoExt from the slice.
func filterSidecars(paths []string) []string {
	out := paths[:0]
	for _, p := range paths {
		if !strings.HasSuffix(p, TrashInfoExt) {
			out = append(out, p)
		}
	}
	return out
}
