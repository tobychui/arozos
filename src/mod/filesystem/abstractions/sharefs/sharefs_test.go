package sharefs

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// fakeResolver hands out a fixed set of items per user
type fakeResolver struct {
	mu    sync.Mutex
	items map[string][]*Item
}

func (f *fakeResolver) Items(username string) []*Item {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.items[username]
}

func (f *fakeResolver) set(username string, items []*Item) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.items[username] = items
}

/*
newTestDrive builds bob's home drive in a temp folder and shares three things
with alice:

	Photos     a folder she may browse    (bob's user:/Photos)
	Report.pdf a file                     (bob's user:/report.pdf, renamed)
	Secret     a folder she may not list  (bob's user:/Secret)
*/
func newTestDrive(t *testing.T) (*ShareFileSystem, *fakeResolver, *filesystem.FileSystemHandler) {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"users/bob/Photos/a.jpg":       "jpeg bytes",
		"users/bob/Photos/sub/b.txt":   "hello from b",
		"users/bob/Photos/.hidden/c":   "hidden",
		"users/bob/report.pdf":         "%PDF report",
		"users/bob/Secret/plans.txt":   "top secret",
		"users/bob/NotShared/nope.txt": "not for alice",
	}
	for name, content := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(full, []byte(content), 0644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	abs := localfs.NewLocalFileSystemAbstraction("user", root, "user", false)
	fsh := &filesystem.FileSystemHandler{
		Name:                  "User",
		UUID:                  "user",
		Path:                  root,
		Hierarchy:             "user",
		FileSystemAbstraction: abs,
	}
	ownerPath := func(vpath string) string {
		rpath, err := abs.VirtualPathToRealPath(vpath, "bob")
		if err != nil {
			t.Fatalf("resolve %s: %v", vpath, err)
		}
		return rpath
	}

	resolver := &fakeResolver{items: map[string][]*Item{
		"alice": {
			{Name: "Photos", Owner: "bob", ShareIDs: []string{"s1"}, IsDir: true, CanBrowse: true, CanDownload: true, Fsh: fsh, Root: ownerPath("/Photos")},
			{Name: "Report.pdf", Owner: "bob", ShareIDs: []string{"s2"}, Fsh: fsh, Root: ownerPath("/report.pdf")},
			{Name: "Secret", Owner: "bob", ShareIDs: []string{"s3"}, IsDir: true, CanDownload: true, Fsh: fsh, Root: ownerPath("/Secret")},
		},
	}}
	return New("share", resolver, Options{BufferDir: t.TempDir()}), resolver, fsh
}

func mustReal(t *testing.T, s *ShareFileSystem, vpath string, username string) string {
	t.Helper()
	rpath, err := s.VirtualPathToRealPath(vpath, username)
	if err != nil {
		t.Fatalf("VirtualPathToRealPath(%q): %v", vpath, err)
	}
	return rpath
}

func TestVirtualPathToRealPath(t *testing.T) {
	s := New("share", &fakeResolver{items: map[string][]*Item{}}, Options{})
	alice := "sharefs/" + userSegment("alice")
	tests := []struct {
		vpath    string
		username string
		want     string
		wantErr  bool
	}{
		{"share:/", "alice", alice, false},
		{"/", "alice", alice, false},
		{"", "alice", alice, false},
		{"share:/Photos/a.jpg", "alice", alice + "/Photos/a.jpg", false},
		{"/Photos/sub/", "alice", alice + "/Photos/sub", false},
		{"share:\\Photos\\a.jpg", "alice", alice + "/Photos/a.jpg", false},
		//Traversal is clamped to the user's own drive root
		{"share:/../../bob/Photos", "alice", alice + "/bob/Photos", false},
		{"share:/Photos/../../../x", "alice", alice + "/x", false},
		{"share:/", "", "", true},
		{"share:/", "..", "", true},
		{"share:/", "a/b", "", true},
		{"share:/", "a\\b", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.vpath+"|"+tc.username, func(t *testing.T) {
			got, err := s.VirtualPathToRealPath(tc.vpath, tc.username)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestParseRealPath(t *testing.T) {
	alice := "sharefs/" + userSegment("alice")
	//A segment for bob that was not made by userSegment
	forgedBob := strings.Repeat("0", userTagLength) + "-bob"
	tests := []struct {
		rpath   string
		user    string
		name    string
		sub     string
		wantErr bool
	}{
		{alice, "alice", "", "", false},
		{alice + "/", "alice", "", "", false},
		{alice + "/Photos", "alice", "Photos", "", false},
		{alice + "/Photos/sub/b.txt", "alice", "Photos", "/sub/b.txt", false},
		//What filepath.Join makes of one on Windows
		{strings.ReplaceAll(alice, "/", "\\") + "\\Photos\\a.jpg", "alice", "Photos", "/a.jpg", false},
		{alice + "/Photos/../Report.pdf", "alice", "Report.pdf", "", false},
		//Joining "../<someone else>" onto a real path does not switch users
		{alice + "/../" + forgedBob + "/Photos", "", "", "", true},
		{alice + "/../bob/Photos", "", "", "", true},
		{"sharefs/alice/Photos", "", "", "", true},
		{"sharefs/" + forgedBob, "", "", "", true},
		{"sharefs/" + userSegment("alice")[:userTagLength] + "-bob", "", "", "", true},
		{"/" + alice, "", "", "", true},
		{"user:/alice", "", "", "", true},
		{"sharefs", "", "", "", true},
		{"sharefs/", "", "", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.rpath, func(t *testing.T) {
			user, name, sub, err := parseRealPath(tc.rpath)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %q %q %q", user, name, sub)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if user != tc.user || name != tc.name || sub != tc.sub {
				t.Errorf("got (%q, %q, %q), want (%q, %q, %q)", user, name, sub, tc.user, tc.name, tc.sub)
			}
		})
	}
}

func TestRealPathToVirtualPath(t *testing.T) {
	s, _, _ := newTestDrive(t)
	for _, vpath := range []string{"share:/", "share:/Photos", "share:/Photos/sub/b.txt"} {
		rpath := mustReal(t, s, vpath, "alice")
		got, err := s.RealPathToVirtualPath(rpath, "alice")
		if err != nil {
			t.Fatalf("RealPathToVirtualPath(%q): %v", rpath, err)
		}
		if got != vpath {
			t.Errorf("round trip of %q gave %q", vpath, got)
		}
	}

	//A real path of one user never translates for another
	if _, err := s.RealPathToVirtualPath(mustReal(t, s, "share:/Photos", "alice"), "carol"); err == nil {
		t.Errorf("expected alice's path to be refused for carol")
	}
}

func TestRealPathsAreNeverHostPaths(t *testing.T) {
	s, _, _ := newTestDrive(t)
	for _, vpath := range []string{"share:/", "share:/Photos/a.jpg", "share:/Report.pdf"} {
		rpath := mustReal(t, s, vpath, "alice")
		if _, err := os.Stat(rpath); err == nil {
			t.Errorf("real path %q exists on the host", rpath)
		}
		if filesystem.FileExists(rpath) {
			t.Errorf("filesystem.FileExists(%q) = true", rpath)
		}
	}
}

func TestReadRoot(t *testing.T) {
	s, _, _ := newTestDrive(t)
	entries, err := s.ReadDir(mustReal(t, s, "share:/", "alice"))
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	got := map[string]bool{}
	for _, e := range entries {
		got[e.Name()] = e.IsDir()
		info, err := e.Info()
		if err != nil || info.Name() != e.Name() {
			t.Errorf("info of %q: %v name %v", e.Name(), err, info)
		}
	}
	want := map[string]bool{"Photos": true, "Report.pdf": false, "Secret": true}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for name, isDir := range want {
		if d, ok := got[name]; !ok || d != isDir {
			t.Errorf("entry %q: got (present %v, dir %v), want dir %v", name, ok, d, isDir)
		}
	}

	//Nobody shared anything with carol
	entries, err = s.ReadDir(mustReal(t, s, "share:/", "carol"))
	if err != nil || len(entries) != 0 {
		t.Errorf("carol's root: %v %v", entries, err)
	}
}

func TestReadRootSkipsMissingTargets(t *testing.T) {
	s, resolver, fsh := newTestDrive(t)
	items := append([]*Item{}, resolver.Items("alice")...)
	items = append(items, &Item{Name: "Gone", Owner: "bob", Fsh: fsh, Root: filepath.Join(fsh.Path, "users", "bob", "gone.txt")})
	resolver.set("alice", items)

	entries, err := s.ReadDir(mustReal(t, s, "share:/", "alice"))
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if e.Name() == "Gone" {
			t.Errorf("an item whose file is gone was listed")
		}
	}
}

func TestBrowseRules(t *testing.T) {
	s, _, _ := newTestDrive(t)
	tests := []struct {
		vpath  string
		exists bool
		isDir  bool
	}{
		{"share:/", true, true},
		{"share:/Photos", true, true},
		{"share:/Photos/a.jpg", true, false},
		{"share:/Photos/sub/b.txt", true, false},
		{"share:/Photos/missing.txt", false, false},
		{"share:/Report.pdf", true, false},
		//Nothing lives below a shared file
		{"share:/Report.pdf/x", false, false},
		//A folder whose listing is hidden can be seen but not entered
		{"share:/Secret", true, true},
		{"share:/Secret/plans.txt", false, false},
		//Not shared at all, and not reachable by walking up out of a share
		{"share:/NotShared/nope.txt", false, false},
		{"share:/Photos/../NotShared/nope.txt", false, false},
	}
	for _, tc := range tests {
		t.Run(tc.vpath, func(t *testing.T) {
			rpath := mustReal(t, s, tc.vpath, "alice")
			if got := s.FileExists(rpath); got != tc.exists {
				t.Errorf("FileExists = %v, want %v", got, tc.exists)
			}
			if got := s.IsDir(rpath); got != tc.isDir {
				t.Errorf("IsDir = %v, want %v", got, tc.isDir)
			}
		})
	}

	if _, err := s.ReadDir(mustReal(t, s, "share:/Secret", "alice")); err == nil {
		t.Errorf("listing a folder whose owner hid its content should fail")
	}
	if _, err := s.ReadFile(mustReal(t, s, "share:/Secret/plans.txt", "alice")); err == nil {
		t.Errorf("reading inside a folder whose owner hid its content should fail")
	}
	entries, err := s.ReadDir(mustReal(t, s, "share:/Photos", "alice"))
	if err != nil || len(entries) == 0 {
		t.Errorf("listing Photos: %v %v", entries, err)
	}
}

func TestOtherUsersSeeNothing(t *testing.T) {
	s, _, _ := newTestDrive(t)
	rpath := mustReal(t, s, "share:/Photos/a.jpg", "carol")
	if s.FileExists(rpath) {
		t.Errorf("carol can see alice's share")
	}
	if _, err := s.ReadFile(rpath); err == nil {
		t.Errorf("carol can read alice's share")
	}
}

func TestRevokedShareStopsWorking(t *testing.T) {
	s, resolver, _ := newTestDrive(t)
	rpath := mustReal(t, s, "share:/Photos/a.jpg", "alice")
	if !s.FileExists(rpath) {
		t.Fatalf("file should be reachable before the share is revoked")
	}
	resolver.set("alice", nil)
	if s.FileExists(rpath) {
		t.Errorf("file still reachable through a path resolved before the revoke")
	}
	if _, err := s.Open(rpath); err == nil {
		t.Errorf("file still opens after the revoke")
	}
}

func TestReadOnly(t *testing.T) {
	s, _, _ := newTestDrive(t)
	file := mustReal(t, s, "share:/Photos/a.jpg", "alice")
	dir := mustReal(t, s, "share:/Photos", "alice")

	if _, err := s.Create(dir + "/new.txt"); err == nil {
		t.Errorf("Create succeeded")
	}
	if err := s.WriteFile(file, []byte("x"), 0644); err == nil {
		t.Errorf("WriteFile succeeded")
	}
	if err := s.WriteStream(file, strings.NewReader("x"), 0644); err == nil {
		t.Errorf("WriteStream succeeded")
	}
	if err := s.Mkdir(dir+"/d", 0755); err == nil {
		t.Errorf("Mkdir succeeded")
	}
	if err := s.Remove(file); err == nil {
		t.Errorf("Remove succeeded")
	}
	if err := s.RemoveAll(dir); err == nil {
		t.Errorf("RemoveAll succeeded")
	}
	if err := s.Rename(file, dir+"/b.jpg"); err == nil {
		t.Errorf("Rename succeeded")
	}
	for _, flag := range []int{os.O_WRONLY, os.O_RDWR, os.O_CREATE, os.O_APPEND | os.O_WRONLY, os.O_TRUNC} {
		if _, err := s.OpenFile(file, flag, 0644); err == nil {
			t.Errorf("OpenFile with flag %d succeeded", flag)
		}
	}

	//The owner's file is untouched
	content, err := s.ReadFile(file)
	if err != nil || string(content) != "jpeg bytes" {
		t.Errorf("content changed: %q %v", content, err)
	}
}

func TestReading(t *testing.T) {
	s, _, _ := newTestDrive(t)
	rpath := mustReal(t, s, "share:/Photos/sub/b.txt", "alice")

	content, err := s.ReadFile(rpath)
	if err != nil || string(content) != "hello from b" {
		t.Fatalf("ReadFile: %q %v", content, err)
	}

	stream, err := s.ReadStream(rpath)
	if err != nil {
		t.Fatalf("ReadStream: %v", err)
	}
	streamed, _ := io.ReadAll(stream)
	stream.Close()
	if string(streamed) != "hello from b" {
		t.Errorf("ReadStream gave %q", streamed)
	}

	f, err := s.OpenFile(rpath, os.O_RDONLY, 0)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	opened, _ := io.ReadAll(f)
	f.Close()
	if string(opened) != "hello from b" {
		t.Errorf("Open gave %q", opened)
	}

	if size := s.GetFileSize(rpath); size != int64(len("hello from b")) {
		t.Errorf("GetFileSize = %d", size)
	}
	if _, err := s.GetModTime(rpath); err != nil {
		t.Errorf("GetModTime: %v", err)
	}

	//An item is stat'ed under its name on this drive, not the file's own
	info, err := s.Stat(mustReal(t, s, "share:/Report.pdf", "alice"))
	if err != nil || info.Name() != "Report.pdf" {
		t.Errorf("Stat of a renamed item: %v %v", info, err)
	}
	if _, err := s.Open(mustReal(t, s, "share:/", "alice")); err == nil {
		t.Errorf("opening the drive root should fail")
	}
}

func TestBufferedDriveOpen(t *testing.T) {
	s, _, fsh := newTestDrive(t)
	fsh.RequireBuffer = true
	rpath := mustReal(t, s, "share:/Photos/a.jpg", "alice")

	f, err := s.Open(rpath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	staged := f.Name()
	if _, err := os.Stat(staged); err != nil {
		t.Fatalf("staged copy missing: %v", err)
	}
	if _, err := f.Seek(5, io.SeekStart); err != nil {
		t.Fatalf("Seek: %v", err)
	}
	rest, _ := io.ReadAll(f)
	if string(rest) != "bytes" {
		t.Errorf("read %q after seeking", rest)
	}
	f.Close()
	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Errorf("staged copy left behind after Close")
	}
}

func TestWalk(t *testing.T) {
	s, _, _ := newTestDrive(t)
	walked := []string{}
	err := s.Walk(mustReal(t, s, "share:/", "alice"), func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		vpath, verr := s.RealPathToVirtualPath(p, "alice")
		if verr != nil {
			t.Errorf("walked path %q does not translate back: %v", p, verr)
		}
		walked = append(walked, vpath)
		return nil
	})
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	sort.Strings(walked)
	want := []string{
		"share:/",
		"share:/Photos",
		"share:/Photos/.hidden",
		"share:/Photos/.hidden/c",
		"share:/Photos/a.jpg",
		"share:/Photos/sub",
		"share:/Photos/sub/b.txt",
		"share:/Report.pdf",
		"share:/Secret",
	}
	if strings.Join(walked, "\n") != strings.Join(want, "\n") {
		t.Errorf("walked\n%s\nwant\n%s", strings.Join(walked, "\n"), strings.Join(want, "\n"))
	}

	//SkipDir on a folder skips what is inside it
	walked = walked[:0]
	s.Walk(mustReal(t, s, "share:/Photos", "alice"), func(p string, info os.FileInfo, err error) error {
		vpath, _ := s.RealPathToVirtualPath(p, "alice")
		walked = append(walked, vpath)
		if info != nil && info.IsDir() && info.Name() == "sub" {
			return filepath.SkipDir
		}
		return nil
	})
	for _, v := range walked {
		if strings.HasPrefix(v, "share:/Photos/sub/") {
			t.Errorf("walked into a skipped folder: %s", v)
		}
	}

	//Walking a path nobody shared reports the error to walkFn
	var walkErr error
	s.Walk(mustReal(t, s, "share:/Nope", "alice"), func(p string, info os.FileInfo, err error) error {
		walkErr = err
		return err
	})
	if walkErr == nil {
		t.Errorf("walking a missing item reported no error")
	}
}

func TestGlob(t *testing.T) {
	s, _, _ := newTestDrive(t)
	tests := []struct {
		pattern string
		want    []string
	}{
		{"share:/*", []string{"share:/Photos", "share:/Report.pdf", "share:/Secret"}},
		{"share:/P*", []string{"share:/Photos"}},
		{"share:/Photos/*.jpg", []string{"share:/Photos/a.jpg"}},
		{"share:/*/sub/*", []string{"share:/Photos/sub/b.txt"}},
		{"share:/Secret/*", []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.pattern, func(t *testing.T) {
			matches, err := s.Glob(mustReal(t, s, tc.pattern, "alice"))
			if err != nil {
				t.Fatalf("Glob: %v", err)
			}
			got := []string{}
			for _, m := range matches {
				vpath, err := s.RealPathToVirtualPath(m, "alice")
				if err != nil {
					t.Fatalf("match %q does not translate back: %v", m, err)
				}
				got = append(got, vpath)
			}
			sort.Strings(got)
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestThumbnails(t *testing.T) {
	s, _, fsh := newTestDrive(t)
	rpath := mustReal(t, s, "share:/Photos/a.jpg", "alice")

	if _, err := s.RenderThumbnail(rpath); !errors.Is(err, arozfs.ErrNoThumbnail) {
		t.Errorf("without a renderer: %v", err)
	}

	var renderedFrom string
	s.options.Thumbnail = func(owner *filesystem.FileSystemHandler, target string) ([]byte, error) {
		if owner != fsh {
			t.Errorf("rendered on the wrong drive")
		}
		renderedFrom = target
		return []byte("thumb"), nil
	}
	data, err := s.RenderThumbnail(rpath)
	if err != nil || string(data) != "thumb" {
		t.Fatalf("RenderThumbnail: %q %v", data, err)
	}
	if filepath.ToSlash(renderedFrom) != filepath.ToSlash(filepath.Join(fsh.Path, "users", "bob", "Photos", "a.jpg")) {
		t.Errorf("rendered from %q", renderedFrom)
	}

	before, err := s.ThumbnailKey(rpath)
	if err != nil || before == "" {
		t.Fatalf("ThumbnailKey: %q %v", before, err)
	}
	if err := os.WriteFile(filepath.Join(fsh.Path, "users", "bob", "Photos", "a.jpg"), []byte("new and longer jpeg bytes"), 0644); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	after, _ := s.ThumbnailKey(rpath)
	if after == before {
		t.Errorf("thumbnail key did not change with the content")
	}
	if _, err := s.ThumbnailKey(mustReal(t, s, "share:/Photos", "alice")); err == nil {
		t.Errorf("a folder has no thumbnail key")
	}
}

func TestItemOfAndStorageInfo(t *testing.T) {
	s, _, _ := newTestDrive(t)
	item, err := s.ItemOf("share:/Photos/sub/b.txt", "alice")
	if err != nil || item == nil || item.Name != "Photos" {
		t.Fatalf("ItemOf: %v %v", item, err)
	}
	if item, err := s.ItemOf("share:/", "alice"); err != nil || item != nil {
		t.Errorf("ItemOf the root: %v %v", item, err)
	}
	if _, err := s.ItemOf("share:/Nope/x", "alice"); err == nil {
		t.Errorf("ItemOf a missing item should fail")
	}

	info, err := s.StorageInfo(mustReal(t, s, "share:/Photos/a.jpg", "alice"))
	if err != nil {
		t.Fatalf("StorageInfo: %v", err)
	}
	fields := map[string]string{}
	for _, f := range info.Fields {
		fields[f.Key] = f.Value
	}
	if fields["Shared by"] != "bob" || fields["Download allowed"] != "Yes" || fields["Folder listing allowed"] != "Yes" {
		t.Errorf("fields: %v", fields)
	}
	if _, err := s.StorageInfo(mustReal(t, s, "share:/", "alice")); err == nil {
		t.Errorf("the drive root has no storage info")
	}
}
