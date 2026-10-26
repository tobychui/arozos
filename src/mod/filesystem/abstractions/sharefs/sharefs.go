package sharefs

/*
	share:/ file system abstraction

	Presents the files and folders other users shared with someone as one read
	only drive, so the File Manager can browse and search them, and every web
	app can open them by path like any other file ("share:/Photos/beach.jpg").

	The drive stores nothing itself. Its root lists the items shared with the
	user asking, as reported by a Resolver (normally the share manager), and
	everything below an item is read from the drive the shared file or folder
	actually lives on.

	Real paths

	The rest of the core keeps the real path a virtual path translates to and
	hands it back later without the username, so the real path carries it:

		share:/Photos/2024/a.jpg  (as alice)
		  ->  sharefs/<tag>-alice/Photos/2024/a.jpg

	Every call resolves the path again against what is shared with that user
	right now, so a revoked share stops working on the next call rather than
	whenever something holding on to the path lets go of it.

	<tag> is an HMAC of the username under a key made at startup. Handlers
	sometimes join request input onto a real path, and "../bob/..." would
	otherwise turn alice's path into one that reads what was shared with bob;
	a user segment that was not made here fails the check instead. Real paths
	are therefore only valid until the next restart, which is fine: nothing
	persists them (the drive cannot be written to, and cannot be shared).

	The paths are relative on purpose. Several handlers fall back to os.Stat
	and http.ServeFile when a real path happens to exist on disk, so these
	must reliably not exist: an absolute "/<user>/<item>" could name a system
	file, and anything Windows finds syntactically invalid (a colon in the
	first segment, say) makes os.Stat fail with an error that is not "does
	not exist", which filesystem.FileExists reports as found.
*/

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// First segment of every real path on this drive, see above
const realPrefix = "sharefs"

// Length of the hex tag in front of the username in a real path
const userTagLength = 24

// pathKey signs the user segment of real paths, see above
var pathKey = newPathKey()

func newPathKey() []byte {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		//No randomness at all: fall back to a key that at least differs per run
		key = []byte(fmt.Sprintf("sharefs-%d", time.Now().UnixNano()))
	}
	return key
}

var (
	errReadOnly  = errors.New("shared files are read only")
	errNoBrowse  = errors.New("the owner does not allow listing this folder")
	errUserMatch = errors.New("path belongs to another user")
)

// Item is one file or folder at the root of a user's share:/ drive.
type Item struct {
	Name     string   //Name at the drive root, unique within it
	Owner    string   //Username of the owner
	ShareIDs []string //UUIDs of the shares granting access, oldest first
	IsDir    bool

	CanBrowse   bool //A shared folder whose content may be listed and opened
	CanDownload bool //Copies may be taken (download, copy to another drive)
	CanUpload   bool //Recipients may add files through the share link page

	//Where the shared file or folder lives
	Fsh  *filesystem.FileSystemHandler
	Root string //Its real path on Fsh
}

// Resolver supplies the root of each user's drive.
type Resolver interface {
	//Items lists what is currently shared with the user
	Items(username string) []*Item
}

// Options are the optional parts of the drive.
type Options struct {
	//Renders the thumbnail of a file on the drive it lives on, for drives
	//that are not thumbnail renderers themselves. Without it shared files
	//have no thumbnails.
	Thumbnail func(fsh *filesystem.FileSystemHandler, rpath string) ([]byte, error)

	//Folder that files on buffered (network) drives are staged in when
	//something needs them opened rather than streamed. Defaults to the
	//system temp folder.
	BufferDir string
}

// ShareFileSystem is the abstraction.
type ShareFileSystem struct {
	UUID     string
	resolver Resolver
	options  Options
}

// New creates the drive.
func New(uuid string, resolver Resolver, options Options) *ShareFileSystem {
	return &ShareFileSystem{UUID: uuid, resolver: resolver, options: options}
}

/*
	Path resolution
*/

// location is a real path resolved against what is shared right now
type location struct {
	username string
	item     *Item  //nil at the drive root
	sub      string //"" for the item itself, otherwise "/a/b" below it
}

func (l *location) isRoot() bool {
	return l.item == nil
}

// target is the real path of the location on the drive the item lives on
func (l *location) target() string {
	if l.sub == "" {
		return l.item.Root
	}
	return joinReal(l.item.Root, l.sub)
}

// joinReal appends a cleaned, slash separated sub path to a real path
func joinReal(root string, sub string) string {
	root = strings.TrimRight(arozfs.ToSlash(root), "/")
	return root + path.Clean("/"+sub)
}

// validUsername rejects anything that could not be a single path segment
func validUsername(username string) bool {
	return username != "" && username != "." && username != ".." &&
		!strings.ContainsAny(username, "/\\")
}

// userSegment is the signed form of a username used in real paths
func userSegment(username string) string {
	mac := hmac.New(sha256.New, pathKey)
	mac.Write([]byte(username))
	return hex.EncodeToString(mac.Sum(nil))[:userTagLength] + "-" + username
}

// parseUserSegment returns the username of a user segment made by userSegment
func parseUserSegment(segment string) (string, bool) {
	if len(segment) <= userTagLength+1 || segment[userTagLength] != '-' {
		return "", false
	}
	username := segment[userTagLength+1:]
	if !validUsername(username) || !hmac.Equal([]byte(userSegment(username)), []byte(segment)) {
		return "", false
	}
	return username, true
}

// realPath builds the real path of a virtual sub path ("/Photos/a.jpg")
func realPath(username string, sub string) string {
	clean := path.Clean("/" + sub)
	if clean == "/" {
		return realPrefix + "/" + userSegment(username)
	}
	return realPrefix + "/" + userSegment(username) + clean
}

// parseRealPath splits a real path into its user, item name and the path
// below the item.
func parseRealPath(rpath string) (username string, name string, sub string, err error) {
	p := path.Clean(arozfs.ToSlash(strings.TrimSpace(rpath)))
	if !strings.HasPrefix(p, realPrefix+"/") {
		return "", "", "", arozfs.ErrRpathResolveFailed
	}
	segments := strings.SplitN(strings.TrimPrefix(p, realPrefix+"/"), "/", 3)
	username, ok := parseUserSegment(segments[0])
	if !ok {
		return "", "", "", arozfs.ErrRpathResolveFailed
	}
	if len(segments) > 1 {
		name = segments[1]
	}
	if len(segments) > 2 {
		sub = "/" + segments[2]
	}
	return username, name, sub, nil
}

// findItem looks an item up by name among what is shared with the user
func (s *ShareFileSystem) findItem(username string, name string) *Item {
	if s.resolver == nil {
		return nil
	}
	for _, item := range s.resolver.Items(username) {
		if item.Name == name {
			return item
		}
	}
	return nil
}

// resolve checks a real path against what is shared with its user. Below an
// item only a folder whose owner allows listing it can be reached; anything
// else does not exist, the same as on the share link page.
func (s *ShareFileSystem) resolve(rpath string) (*location, error) {
	username, name, sub, err := parseRealPath(rpath)
	if err != nil {
		return nil, err
	}
	loc := &location{username: username, sub: sub}
	if name == "" {
		return loc, nil
	}
	loc.item = s.findItem(username, name)
	if loc.item == nil || loc.item.Fsh == nil || loc.item.Fsh.FileSystemAbstraction == nil {
		return nil, os.ErrNotExist
	}
	if sub != "" && !(loc.item.IsDir && loc.item.CanBrowse) {
		return nil, os.ErrNotExist
	}
	return loc, nil
}

// resolveItem is resolve for calls that have no meaning at the drive root
func (s *ShareFileSystem) resolveItem(rpath string) (*location, filesystem.FileSystemAbstraction, error) {
	loc, err := s.resolve(rpath)
	if err != nil {
		return nil, nil, err
	}
	if loc.isRoot() {
		return nil, nil, arozfs.ErrOperationNotSupported
	}
	return loc, loc.item.Fsh.FileSystemAbstraction, nil
}

// ItemOf returns the shared item a virtual path is inside of, or nil at the
// drive root. It is what callers check an item's permissions with.
func (s *ShareFileSystem) ItemOf(vpath string, username string) (*Item, error) {
	rpath, err := s.VirtualPathToRealPath(vpath, username)
	if err != nil {
		return nil, err
	}
	loc, err := s.resolve(rpath)
	if err != nil {
		return nil, err
	}
	return loc.item, nil
}

/*
	os.FileInfo / fs.DirEntry adapters
*/

// rootInfo describes the drive root
type rootInfo struct{}

func (rootInfo) Name() string       { return "share" }
func (rootInfo) Size() int64        { return 0 }
func (rootInfo) Mode() os.FileMode  { return os.ModeDir | 0555 }
func (rootInfo) ModTime() time.Time { return time.Now() }
func (rootInfo) IsDir() bool        { return true }
func (rootInfo) Sys() interface{}   { return nil }

// renamedInfo is the info of a shared item under its name on this drive,
// which is not the file's own name when two items would have collided
type renamedInfo struct {
	os.FileInfo
	name string
}

func (r renamedInfo) Name() string { return r.name }

type dirEntry struct{ info os.FileInfo }

func (d dirEntry) Name() string               { return d.info.Name() }
func (d dirEntry) IsDir() bool                { return d.info.IsDir() }
func (d dirEntry) Type() fs.FileMode          { return d.info.Mode().Type() }
func (d dirEntry) Info() (fs.FileInfo, error) { return d.info, nil }

// itemInfo stats a shared item and gives it its name on this drive
func itemInfo(item *Item) (os.FileInfo, error) {
	info, err := item.Fsh.FileSystemAbstraction.Stat(item.Root)
	if err != nil {
		return nil, err
	}
	return renamedInfo{FileInfo: info, name: item.Name}, nil
}

/*
	FileSystemAbstraction: writes

	Nothing can be written through this drive. The handler is mounted read
	only as well, which is what the File Manager and the AGI check first.
*/

func (s *ShareFileSystem) Chmod(string, os.FileMode) error            { return errReadOnly }
func (s *ShareFileSystem) Chown(string, int, int) error               { return errReadOnly }
func (s *ShareFileSystem) Chtimes(string, time.Time, time.Time) error { return errReadOnly }
func (s *ShareFileSystem) Create(string) (arozfs.File, error)         { return nil, errReadOnly }
func (s *ShareFileSystem) Mkdir(string, os.FileMode) error            { return errReadOnly }
func (s *ShareFileSystem) MkdirAll(string, os.FileMode) error         { return errReadOnly }
func (s *ShareFileSystem) Remove(string) error                        { return errReadOnly }
func (s *ShareFileSystem) RemoveAll(string) error                     { return errReadOnly }
func (s *ShareFileSystem) Rename(string, string) error                { return errReadOnly }
func (s *ShareFileSystem) WriteFile(string, []byte, os.FileMode) error {
	return errReadOnly
}
func (s *ShareFileSystem) WriteStream(string, io.Reader, os.FileMode) error {
	return errReadOnly
}

func (s *ShareFileSystem) Name() string { return "share" }
func (s *ShareFileSystem) Close() error { return nil }
func (s *ShareFileSystem) Heartbeat() error {
	return nil
}

/*
	FileSystemAbstraction: reads
*/

func (s *ShareFileSystem) Open(rpath string) (arozfs.File, error) {
	loc, abs, err := s.resolveItem(rpath)
	if err != nil {
		return nil, err
	}
	if loc.item.Fsh.RequireBuffer {
		return s.openBuffered(abs, loc.target())
	}
	return abs.Open(loc.target())
}

func (s *ShareFileSystem) OpenFile(rpath string, flag int, perm os.FileMode) (arozfs.File, error) {
	if flag&(os.O_WRONLY|os.O_RDWR|os.O_CREATE|os.O_APPEND|os.O_TRUNC) != 0 {
		return nil, errReadOnly
	}
	return s.Open(rpath)
}

func (s *ShareFileSystem) Stat(rpath string) (os.FileInfo, error) {
	loc, err := s.resolve(rpath)
	if err != nil {
		return nil, err
	}
	if loc.isRoot() {
		return rootInfo{}, nil
	}
	if loc.sub == "" {
		return itemInfo(loc.item)
	}
	return loc.item.Fsh.FileSystemAbstraction.Stat(loc.target())
}

func (s *ShareFileSystem) VirtualPathToRealPath(subpath string, username string) (string, error) {
	if !validUsername(username) {
		return "", arozfs.ErrVpathResolveFailed
	}
	subpath = arozfs.ToSlash(strings.TrimSpace(subpath))
	subpath = strings.TrimPrefix(subpath, s.UUID+":")
	return realPath(username, subpath), nil
}

func (s *ShareFileSystem) RealPathToVirtualPath(rpath string, username string) (string, error) {
	owner, name, sub, err := parseRealPath(rpath)
	if err != nil {
		return "", err
	}
	if owner != username {
		return "", errUserMatch
	}
	if name == "" {
		return s.UUID + ":/", nil
	}
	return s.UUID + ":/" + name + sub, nil
}

func (s *ShareFileSystem) FileExists(rpath string) bool {
	loc, err := s.resolve(rpath)
	if err != nil {
		return false
	}
	if loc.isRoot() {
		return true
	}
	return loc.item.Fsh.FileSystemAbstraction.FileExists(loc.target())
}

func (s *ShareFileSystem) IsDir(rpath string) bool {
	loc, err := s.resolve(rpath)
	if err != nil {
		return false
	}
	if loc.isRoot() {
		return true
	}
	return loc.item.Fsh.FileSystemAbstraction.IsDir(loc.target())
}

func (s *ShareFileSystem) GetFileSize(rpath string) int64 {
	loc, abs, err := s.resolveItem(rpath)
	if err != nil {
		return 0
	}
	return abs.GetFileSize(loc.target())
}

func (s *ShareFileSystem) GetModTime(rpath string) (int64, error) {
	loc, err := s.resolve(rpath)
	if err != nil {
		return 0, err
	}
	if loc.isRoot() {
		return time.Now().Unix(), nil
	}
	return loc.item.Fsh.FileSystemAbstraction.GetModTime(loc.target())
}

func (s *ShareFileSystem) ReadFile(rpath string) ([]byte, error) {
	loc, abs, err := s.resolveItem(rpath)
	if err != nil {
		return nil, err
	}
	return abs.ReadFile(loc.target())
}

func (s *ShareFileSystem) ReadStream(rpath string) (io.ReadCloser, error) {
	loc, abs, err := s.resolveItem(rpath)
	if err != nil {
		return nil, err
	}
	return abs.ReadStream(loc.target())
}

func (s *ShareFileSystem) ReadDir(rpath string) ([]fs.DirEntry, error) {
	loc, err := s.resolve(rpath)
	if err != nil {
		return nil, err
	}
	if loc.isRoot() {
		return s.readRoot(loc.username), nil
	}
	if loc.sub == "" && !(loc.item.IsDir && loc.item.CanBrowse) {
		if loc.item.IsDir {
			return nil, errNoBrowse
		}
		return nil, arozfs.ErrOperationNotSupported
	}
	return loc.item.Fsh.FileSystemAbstraction.ReadDir(loc.target())
}

// readRoot lists the items shared with a user. An item whose file is gone
// (or whose drive is offline) is left out rather than failing the listing.
func (s *ShareFileSystem) readRoot(username string) []fs.DirEntry {
	entries := []fs.DirEntry{}
	if s.resolver == nil {
		return entries
	}
	for _, item := range s.resolver.Items(username) {
		if item.Fsh == nil || item.Fsh.FileSystemAbstraction == nil {
			continue
		}
		info, err := itemInfo(item)
		if err != nil {
			continue
		}
		entries = append(entries, dirEntry{info})
	}
	return entries
}

// Glob matches like filepath.Glob: the item segment against the names on the
// drive root, everything below it on the drive the item lives on.
func (s *ShareFileSystem) Glob(wildcard string) ([]string, error) {
	username, namePattern, subPattern, err := parseRealPath(wildcard)
	if err != nil {
		return nil, err
	}
	if namePattern == "" {
		return []string{realPath(username, "/")}, nil
	}
	results := []string{}
	for _, item := range s.resolver.Items(username) {
		matched, err := path.Match(namePattern, item.Name)
		if err != nil {
			return nil, err
		}
		if !matched || item.Fsh == nil || item.Fsh.FileSystemAbstraction == nil {
			continue
		}
		itemPath := realPath(username, "/"+item.Name)
		if subPattern == "" {
			if item.Fsh.FileSystemAbstraction.FileExists(item.Root) {
				results = append(results, itemPath)
			}
			continue
		}
		if !(item.IsDir && item.CanBrowse) {
			continue
		}
		matches, err := item.Fsh.FileSystemAbstraction.Glob(joinReal(item.Root, subPattern))
		if err != nil {
			continue
		}
		for _, match := range matches {
			if rel, ok := relativeTo(item.Root, match); ok && rel != "" {
				results = append(results, itemPath+rel)
			}
		}
	}
	return results, nil
}

// relativeTo returns p below root as "/a/b" ("" for root itself). Both are
// cleaned first: a drive may hand back "files/x" for a root of "./files".
func relativeTo(root string, p string) (string, bool) {
	root = path.Clean(arozfs.ToSlash(root))
	p = path.Clean(arozfs.ToSlash(p))
	if p == root {
		return "", true
	}
	prefix := strings.TrimRight(root, "/") + "/"
	if !strings.HasPrefix(p, prefix) {
		return "", false
	}
	return "/" + strings.TrimPrefix(p, prefix), true
}

// Walk walks the drive like filepath.Walk, handing walkFn real paths of this
// drive. Folders whose owner does not allow listing them are not entered.
func (s *ShareFileSystem) Walk(root string, walkFn filepath.WalkFunc) error {
	loc, err := s.resolve(root)
	if err != nil {
		return walkFn(root, nil, err)
	}
	if loc.isRoot() {
		base := realPath(loc.username, "/")
		if err := walkFn(base, rootInfo{}, nil); err != nil {
			if err == filepath.SkipDir {
				return nil
			}
			return err
		}
		for _, item := range s.resolver.Items(loc.username) {
			if item.Fsh == nil || item.Fsh.FileSystemAbstraction == nil {
				continue
			}
			itemLoc := &location{username: loc.username, item: item}
			if err := s.walkItem(itemLoc, walkFn); err != nil {
				if err == filepath.SkipDir {
					//Returned for a file: skip the rest of the root
					return nil
				}
				return err
			}
		}
		return nil
	}
	return s.walkItem(loc, walkFn)
}

// walkItem walks one item, or a folder below one
func (s *ShareFileSystem) walkItem(loc *location, walkFn filepath.WalkFunc) error {
	base := realPath(loc.username, "/"+loc.item.Name+loc.sub)
	if !(loc.item.IsDir && loc.item.CanBrowse) {
		//A file, or a folder that may not be listed: only the item itself
		info, err := itemInfo(loc.item)
		if err != nil {
			return walkFn(base, nil, err)
		}
		err = walkFn(base, info, nil)
		if err == filepath.SkipDir && info.IsDir() {
			return nil
		}
		return err
	}

	targetRoot := loc.target()
	return loc.item.Fsh.FileSystemAbstraction.Walk(targetRoot, func(p string, info os.FileInfo, err error) error {
		rel, ok := relativeTo(targetRoot, p)
		if !ok {
			return nil
		}
		if rel == "" && loc.sub == "" && info != nil {
			info = renamedInfo{FileInfo: info, name: loc.item.Name}
		}
		return walkFn(base+rel, info, err)
	})
}

/*
	Buffered drives

	A shared file on a network drive cannot be opened, only streamed. Things
	that need a seekable file (range requests for video, for one) get a copy
	staged in the buffer folder, removed again when it is closed.
*/

type stagedFile struct {
	*os.File
}

func (f *stagedFile) Close() error {
	name := f.File.Name()
	err := f.File.Close()
	os.Remove(name)
	return err
}

func (s *ShareFileSystem) openBuffered(abs filesystem.FileSystemAbstraction, rpath string) (arozfs.File, error) {
	src, err := abs.ReadStream(rpath)
	if err != nil {
		return nil, err
	}
	defer src.Close()

	dir := s.options.BufferDir
	if dir == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(dir, "sharefs-*"+path.Ext(arozfs.ToSlash(rpath)))
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, err
	}
	return &stagedFile{File: tmp}, nil
}

/*
	Thumbnails

	Rendered by the drive a shared file lives on and cached on this host
	(see arozfs.ThumbnailRenderer), so browsing a share never writes a
	thumbnail cache through this drive.
*/

// ThumbnailKey identifies the content of a shared file.
func (s *ShareFileSystem) ThumbnailKey(rpath string) (string, error) {
	loc, abs, err := s.resolveItem(rpath)
	if err != nil {
		return "", err
	}
	if r, ok := abs.(arozfs.ThumbnailRenderer); ok {
		return r.ThumbnailKey(loc.target())
	}
	info, err := abs.Stat(loc.target())
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", arozfs.ErrNoThumbnail
	}
	return fmt.Sprintf("share|%s|%s|%d|%d", loc.item.Fsh.UUID, loc.target(),
		info.ModTime().UnixNano(), info.Size()), nil
}

// RenderThumbnail renders the thumbnail of a shared file where it lives.
func (s *ShareFileSystem) RenderThumbnail(rpath string) ([]byte, error) {
	loc, abs, err := s.resolveItem(rpath)
	if err != nil {
		return nil, err
	}
	if r, ok := abs.(arozfs.ThumbnailRenderer); ok {
		return r.RenderThumbnail(loc.target())
	}
	if s.options.Thumbnail == nil {
		return nil, arozfs.ErrNoThumbnail
	}
	return s.options.Thumbnail(loc.item.Fsh, loc.target())
}

/*
	Properties

	The File Manager properties dialog shows who shared a file and what the
	share allows (see arozfs.StorageInfoProvider).
*/

// StorageInfo describes the share a file was received through.
func (s *ShareFileSystem) StorageInfo(rpath string) (arozfs.StorageInfo, error) {
	loc, err := s.resolve(rpath)
	if err != nil {
		return arozfs.StorageInfo{}, err
	}
	if loc.isRoot() {
		return arozfs.StorageInfo{}, arozfs.ErrOperationNotSupported
	}
	yesNo := func(v bool) string {
		if v {
			return "Yes"
		}
		return "No"
	}
	fields := []arozfs.StorageInfoField{
		{Key: "Shared by", Value: loc.item.Owner},
		{Key: "Shared item", Value: loc.item.Name},
		{Key: "Download allowed", Value: yesNo(loc.item.CanDownload)},
	}
	if loc.item.IsDir {
		fields = append(fields,
			arozfs.StorageInfoField{Key: "Folder listing allowed", Value: yesNo(loc.item.CanBrowse)},
			arozfs.StorageInfoField{Key: "Upload allowed", Value: yesNo(loc.item.CanUpload)})
	}
	return arozfs.StorageInfo{
		Type:   "share",
		Title:  "Shared with me",
		Fields: fields,
		Items:  []arozfs.StorageInfoItem{},
	}, nil
}
