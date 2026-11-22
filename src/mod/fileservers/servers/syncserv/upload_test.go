package syncserv

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/database"
)

const (
	testSyncPassword  = "phone-sync-pass"
	testLoginPassword = "login-pass"
)

// dirFolder is a sync folder in a temporary folder, with an optional quota.
type dirFolder struct {
	root  string
	base  string
	quota int64 //-1 for none
	used  int64
}

func (f *dirFolder) host(rel string) string { return filepath.Join(f.root, filepath.FromSlash(rel)) }

func (f *dirFolder) Stat(rel string) (bool, bool, int64) {
	info, err := os.Stat(f.host(rel))
	if err != nil {
		return false, false, 0
	}
	return true, info.IsDir(), info.Size()
}

func (f *dirFolder) Open(rel string) (io.ReadCloser, error) { return os.Open(f.host(rel)) }

func (f *dirFolder) HaveSpace(size int64) bool { return f.quota < 0 || size < f.quota-f.used }

func (f *dirFolder) Place(spool, rel string) error {
	if err := os.MkdirAll(filepath.Dir(f.host(rel)), 0755); err != nil {
		return err
	}
	info, err := os.Stat(spool)
	if err != nil {
		return err
	}
	f.used += info.Size()
	return os.Rename(spool, f.host(rel))
}

func (f *dirFolder) VirtualPath(rel string) string {
	return strings.TrimSuffix(f.base, "/") + "/" + rel
}

type testEnv struct {
	m       *Manager
	folders map[string]*dirFolder
	logins  []bool
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	t.Cleanup(db.Close)
	root := t.TempDir()
	env := &testEnv{folders: map[string]*dirFolder{}}
	opt := &ManagerOption{
		Sysdb:    db,
		SpoolDir: filepath.Join(t.TempDir(), "spool"),
		CurrentUser: func(w http.ResponseWriter, r *http.Request) (string, error) {
			if name := r.Header.Get("Test-User"); name != "" {
				return name, nil
			}
			return "", errors.New("not signed in")
		},
		ConfirmPassword: func(w http.ResponseWriter, r *http.Request) bool {
			if postValue(r, "password") == testLoginPassword {
				return true
			}
			w.WriteHeader(http.StatusForbidden)
			return false
		},
		CheckLoginPassword: func(username, password string) bool { return password == testLoginPassword },
		AllowIP: func(ip string) error {
			if ip == "203.0.113.66" {
				return errors.New("Your IP is banned by this host")
			}
			return nil
		},
		ClientIP: func(r *http.Request) string {
			if ip := r.Header.Get("Test-IP"); ip != "" {
				return ip
			}
			return "192.0.2.1"
		},
		LogAuth:    func(username, remote string, ok bool) { env.logins = append(env.logins, ok) },
		UserExists: func(username string) bool { return username == "alice" || username == "bob" || username == "carol" },
		IsAdmin:    func(username string) bool { return username == "alice" },
		InGroups: func(username string, groups []string) bool {
			for _, g := range groups {
				if g == "family" && (username == "bob" || username == "carol") {
					return true
				}
			}
			return false
		},
		ListGroups: func() []string { return []string{"administrator", "family"} },
		OpenFolder: func(username, vpath string) (Folder, error) {
			if strings.HasPrefix(vpath, "readonly:/") {
				return nil, errors.New("You cannot write to this folder")
			}
			key := username + "|" + vpath
			if f, ok := env.folders[key]; ok {
				return f, nil
			}
			f := &dirFolder{root: filepath.Join(root, username, filepath.FromSlash(strings.ReplaceAll(vpath, ":", ""))), base: vpath, quota: -1}
			env.folders[key] = f
			return f, nil
		},
	}
	m, err := NewManager(opt)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	env.m = m
	if err := m.ServerToggle(true); err != nil {
		t.Fatalf("toggle: %v", err)
	}
	return env
}

// activate turns the server on for a user with a sync password.
func (env *testEnv) activate(t *testing.T, username string, settings UserSettings) {
	t.Helper()
	if err := env.m.setSyncPassword(username, testSyncPassword); err != nil {
		t.Fatalf("setSyncPassword: %v", err)
	}
	settings.Activated = time.Now().Unix()
	if err := env.m.setSettings(username, settings); err != nil {
		t.Fatalf("setSettings: %v", err)
	}
}

func (env *testEnv) folder(username string) *dirFolder {
	settings, _ := env.m.Settings(username)
	f, _ := env.m.opt.OpenFolder(username, settings.Folder)
	return f.(*dirFolder)
}

type upFile struct {
	name string
	data []byte
}

func formRequest(t *testing.T, files []upFile, fields map[string]string) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	for key, value := range fields {
		w.WriteField(key, value)
	}
	for _, f := range files {
		part, err := w.CreateFormFile("file", f.name)
		if err != nil {
			t.Fatalf("form: %v", err)
		}
		part.Write(f.data)
	}
	w.Close()
	r := httptest.NewRequest(http.MethodPost, UploadPath, body)
	r.Header.Set("Content-Type", w.FormDataContentType())
	return r
}

func signed(r *http.Request, username, password string) *http.Request {
	r.Header.Set("Username", username)
	r.Header.Set("Authorization", "Bearer "+password)
	return r
}

func (env *testEnv) do(r *http.Request) (*httptest.ResponseRecorder, UploadResult) {
	w := httptest.NewRecorder()
	env.m.HandleUpload(w, r)
	result := UploadResult{}
	json.Unmarshal(w.Body.Bytes(), &result)
	return w, result
}

func (env *testEnv) upload(t *testing.T, username string, files []upFile, fields map[string]string) UploadResult {
	t.Helper()
	w, result := env.do(signed(formRequest(t, files, fields), username, testSyncPassword))
	if w.Code != http.StatusOK {
		t.Fatalf("upload answered %d: %s", w.Code, w.Body.String())
	}
	return result
}

func fileResult(t *testing.T, result UploadResult, i int) FileResult {
	t.Helper()
	if len(result.Files) <= i {
		t.Fatalf("no result %d in %+v", i, result)
	}
	return result.Files[i]
}

func TestUploadSignIn(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "bob", DefaultSettings())
	env.m.setConfig(Config{Groups: []string{"family"}, MaxFileMB: 10})
	photo := []upFile{{"IMG_0001.JPG", []byte("jpeg")}}

	cases := []struct {
		name   string
		sign   func(r *http.Request)
		status int
	}{
		{"no user name", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+testSyncPassword) }, http.StatusUnauthorized},
		{"no password", func(r *http.Request) { r.Header.Set("Username", "bob") }, http.StatusUnauthorized},
		{"wrong password", func(r *http.Request) { signed(r, "bob", "wrong password") }, http.StatusUnauthorized},
		{"login password not chosen", func(r *http.Request) { signed(r, "bob", testLoginPassword) }, http.StatusUnauthorized},
		{"not turned on", func(r *http.Request) { signed(r, "carol", testSyncPassword) }, http.StatusUnauthorized},
		{"unknown user", func(r *http.Request) { signed(r, "mallory", testSyncPassword) }, http.StatusUnauthorized},
		{"banned address", func(r *http.Request) { signed(r, "bob", testSyncPassword); r.Header.Set("Test-IP", "203.0.113.66") }, http.StatusForbidden},
		{"password in the user field", func(r *http.Request) { r.Header.Set("Authorization", "bob"); r.Header.Set("Berer", testSyncPassword) }, http.StatusUnauthorized},
		{"right", func(r *http.Request) { signed(r, "bob", testSyncPassword) }, http.StatusOK},
		{"basic auth", func(r *http.Request) { r.SetBasicAuth("bob", testSyncPassword) }, http.StatusOK},
		{"x-username and lower case bearer", func(r *http.Request) {
			r.Header.Set("X-Username", "bob")
			r.Header.Set("Authorization", "bearer "+testSyncPassword)
		}, http.StatusOK},
	}
	for _, c := range cases {
		r := formRequest(t, photo, nil)
		c.sign(r)
		w, _ := env.do(r)
		if w.Code != c.status {
			t.Errorf("%s: status %d, want %d (%s)", c.name, w.Code, c.status, w.Body.String())
		}
		if w.Code == http.StatusUnauthorized && w.Header().Get("WWW-Authenticate") == "" {
			t.Errorf("%s: 401 without WWW-Authenticate", c.name)
		}
	}
}

func TestUploadAccessRules(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "bob", DefaultSettings())
	env.activate(t, "alice", DefaultSettings())
	photo := []upFile{{"IMG_0001.JPG", []byte("jpeg")}}

	//bob's group is not picked: signed in, but not allowed
	w, _ := env.do(signed(formRequest(t, photo, nil), "bob", testSyncPassword))
	if w.Code != http.StatusForbidden {
		t.Errorf("user outside the groups: status %d, want 403", w.Code)
	}
	//Admins always can
	w, _ = env.do(signed(formRequest(t, photo, nil), "alice", testSyncPassword))
	if w.Code != http.StatusOK {
		t.Errorf("admin: status %d, want 200 (%s)", w.Code, w.Body.String())
	}
	//The server switched off
	env.m.ServerToggle(false)
	w, _ = env.do(signed(formRequest(t, photo, nil), "alice", testSyncPassword))
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("server off: status %d, want 503", w.Code)
	}
}

func TestUploadTestRequest(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())
	r := signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", testSyncPassword)
	w, _ := env.do(r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"ok":true`) {
		t.Errorf("GET: %d %s", w.Code, w.Body.String())
	}
	r = signed(httptest.NewRequest(http.MethodDelete, UploadPath, nil), "alice", testSyncPassword)
	if w, _ := env.do(r); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE: %d, want 405", w.Code)
	}
}

func TestUploadWrongPasswordDelay(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())
	for i := 0; i < freeMissesPerAddress; i++ {
		w, _ := env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", "guess"))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("miss %d: status %d", i, w.Code)
		}
	}
	//One more miss starts the wait, which holds even the right password
	env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", "guess"))
	w, _ := env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", testSyncPassword))
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Errorf("after the misses: status %d, want 429 with Retry-After", w.Code)
	}
	//Another address is not held back by this one
	r := signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", testSyncPassword)
	r.Header.Set("Test-IP", "198.51.100.7")
	if w, _ := env.do(r); w.Code != http.StatusOK {
		t.Errorf("another address: status %d, want 200", w.Code)
	}
	for _, ok := range env.logins {
		if ok {
			return
		}
	}
	t.Errorf("the login history got no successful sign in")
}

func TestLimiterGrowsAndCaps(t *testing.T) {
	l := newLimiter()
	now := time.Now()
	for i := 0; i < freeMissesPerAddress; i++ {
		l.miss("u", "a", now)
	}
	if wait := l.wait("u", "a", now); wait != 0 {
		t.Fatalf("waiting after the free misses: %v", wait)
	}
	l.miss("u", "a", now)
	if wait := l.wait("u", "a", now); wait != 2*time.Second {
		t.Errorf("first wait %v, want 2s", wait)
	}
	for i := 0; i < 40; i++ {
		l.miss("u", "a", now)
	}
	if wait := l.wait("u", "a", now); wait != maxWait {
		t.Errorf("wait after many misses %v, want %v", wait, maxWait)
	}
	l.clear("u", "a")
	if wait := l.wait("u", "a", now); wait != 0 {
		t.Errorf("wait after a right password %v", wait)
	}
}

func TestUploadSortsIntoFolders(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings()) //Type and year_month by date taken
	photo := buildJPEG(buildTIFF(binary.LittleEndian, "2025:12:24 20:00:00", ""))

	//The date taken from the file itself
	result := env.upload(t, "alice", []upFile{{"IMG_0001.JPG", photo}}, nil)
	if got := fileResult(t, result, 0); got.Result != ResultSaved || got.Path != "user:/Phone Uploads/Photo/2025_12/IMG_0001.JPG" {
		t.Errorf("photo with EXIF: %+v", got)
	}
	//The date field wins over the file
	result = env.upload(t, "alice", []upFile{{"IMG_0002.MOV", []byte("movie")}}, map[string]string{"date": "2026-08-14T10:22:01+08:00"})
	if got := fileResult(t, result, 0); got.Path != "user:/Phone Uploads/Video/2026_08/IMG_0002.MOV" {
		t.Errorf("video with a date field: %+v", got)
	}
	//No date anywhere: the upload date
	result = env.upload(t, "alice", []upFile{{"notes.pdf", []byte("%PDF")}}, nil)
	wantDir := "user:/Phone Uploads/Document/" + time.Now().Format("2006_01") + "/notes.pdf"
	if got := fileResult(t, result, 0); got.Path != wantDir {
		t.Errorf("document without a date: %+v, want %s", got, wantDir)
	}

	//Other layouts
	env.activate(t, "alice", UserSettings{Folder: "user:/Camera", DateFolders: DateNested, DateSource: SourceUpload, Duplicates: DuplicateSkip})
	result = env.upload(t, "alice", []upFile{{"IMG_0003.HEIC", photo}}, nil)
	want := "user:/Camera/" + time.Now().Format("2006/01") + "/IMG_0003.HEIC"
	if got := fileResult(t, result, 0); got.Path != want {
		t.Errorf("nested by upload date: %+v, want %s", got, want)
	}
	env.activate(t, "alice", UserSettings{Folder: "user:/Flat", DateFolders: DateNone, DateSource: SourceCreated, Duplicates: DuplicateSkip})
	result = env.upload(t, "alice", []upFile{{"../../IMG_0004.JPG", photo}}, nil)
	if got := fileResult(t, result, 0); got.Path != "user:/Flat/IMG_0004.JPG" {
		t.Errorf("flat folder with a path in the name: %+v", got)
	}
	f := env.folder("alice")
	if exists, _, _ := f.Stat("IMG_0004.JPG"); !exists {
		t.Errorf("the file is not in the folder")
	}
}

func TestUploadSkipsDuplicates(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())
	photo := []upFile{{"IMG_0001.HEIC", []byte("heic photo")}}
	date := map[string]string{"date": "2026-08-14"}

	first := env.upload(t, "alice", photo, date)
	if got := fileResult(t, first, 0); got.Result != ResultSaved {
		t.Fatalf("first upload: %+v", got)
	}
	//The next run sends it again
	again := env.upload(t, "alice", photo, date)
	if got := fileResult(t, again, 0); got.Result != ResultSkipped || got.Reason != ReasonReceived {
		t.Errorf("second upload: %+v", got)
	}
	//Moved away on the server: still not received again
	f := env.folder("alice")
	os.Rename(f.host("Photo/2026_08/IMG_0001.HEIC"), filepath.Join(t.TempDir(), "moved.heic"))
	moved := env.upload(t, "alice", photo, date)
	if got := fileResult(t, moved, 0); got.Result != ResultSkipped {
		t.Errorf("after moving it away: %+v", got)
	}
	//Forgetting the names brings it back
	if n := env.m.forgetSeen("alice"); n != 1 {
		t.Errorf("forgot %d names, want 1", n)
	}
	back := env.upload(t, "alice", photo, date)
	if got := fileResult(t, back, 0); got.Result != ResultSaved {
		t.Errorf("after forgetting: %+v", got)
	}

	//A file put there by hand, never received: same name and size is the same file
	env.m.forgetSeen("alice")
	again = env.upload(t, "alice", photo, date)
	if got := fileResult(t, again, 0); got.Result != ResultSkipped || got.Reason != ReasonExists {
		t.Errorf("file already in the folder: %+v", got)
	}
	//A different file with that name is kept next to it
	env.m.forgetSeen("alice")
	other := env.upload(t, "alice", []upFile{{"IMG_0001.HEIC", []byte("another phone's photo")}}, date)
	if got := fileResult(t, other, 0); got.Result != ResultSaved || !strings.HasSuffix(got.Path, "/IMG_0001 (1).HEIC") {
		t.Errorf("different file of the same name: %+v", got)
	}
}

func TestUploadUploadDateAcrossMonths(t *testing.T) {
	//By upload date, a photo sent on 31 July and again on 1 August must not
	//end up in both month folders
	env := newTestEnv(t)
	settings := DefaultSettings()
	settings.DateSource = SourceUpload
	env.activate(t, "alice", settings)
	f, _ := env.m.opt.OpenFolder("alice", settings.Folder)
	july := time.Date(2026, 7, 31, 23, 0, 0, 0, time.Local)
	august := time.Date(2026, 8, 1, 2, 0, 0, 0, time.Local)

	for _, mode := range []string{DuplicateSkip, DuplicateOverwrite} {
		settings.Duplicates = mode
		env.m.forgetSeen("alice")
		name := "IMG_" + mode + ".JPG"
		spool := func(data string) incoming {
			p := filepath.Join(t.TempDir(), "spool")
			os.WriteFile(p, []byte(data), 0644)
			return incoming{name: name, spool: p, size: int64(len(data))}
		}
		first := env.m.store("alice", settings, f, spool("same photo"), "", july)
		second := env.m.store("alice", settings, f, spool("same photo"), "", august)
		if first.Result != ResultSaved || second.Result != ResultSkipped || second.Path != first.Path {
			t.Errorf("%s: first %+v, second %+v", mode, first, second)
		}
	}
}

func TestUploadOverwrites(t *testing.T) {
	env := newTestEnv(t)
	settings := DefaultSettings()
	settings.Duplicates = DuplicateOverwrite
	env.activate(t, "alice", settings)
	date := map[string]string{"date": "2026-08-14"}

	first := env.upload(t, "alice", []upFile{{"IMG_0001.JPG", []byte("original")}}, date)
	if got := fileResult(t, first, 0); got.Result != ResultSaved {
		t.Fatalf("first: %+v", got)
	}
	same := env.upload(t, "alice", []upFile{{"IMG_0001.JPG", []byte("original")}}, date)
	if got := fileResult(t, same, 0); got.Result != ResultSkipped || got.Reason != ReasonUnchanged {
		t.Errorf("same content: %+v", got)
	}
	sameSize := env.upload(t, "alice", []upFile{{"IMG_0001.JPG", []byte("ORIGINAL")}}, date)
	if got := fileResult(t, sameSize, 0); got.Result != ResultReplaced {
		t.Errorf("same size, other content: %+v", got)
	}
	edited := env.upload(t, "alice", []upFile{{"IMG_0001.JPG", []byte("edited and longer")}}, date)
	if got := fileResult(t, edited, 0); got.Result != ResultReplaced {
		t.Errorf("edited: %+v", got)
	}
	data, _ := os.ReadFile(env.folder("alice").host("Photo/2026_08/IMG_0001.JPG"))
	if string(data) != "edited and longer" {
		t.Errorf("file holds %q", data)
	}
}

func TestUploadLimits(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())
	env.m.setConfig(Config{MaxFileMB: 1})

	big := bytes.Repeat([]byte("x"), 1<<20+1)
	w, _ := env.do(signed(formRequest(t, []upFile{{"big.mov", big}}, nil), "alice", testSyncPassword))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("file over the limit: status %d, want 413", w.Code)
	}
	entries, _ := os.ReadDir(env.m.opt.SpoolDir)
	if len(entries) != 0 {
		t.Errorf("%d files left in the spool folder", len(entries))
	}
	exact := bytes.Repeat([]byte("x"), 1<<20)
	if w, _ := env.do(signed(formRequest(t, []upFile{{"exact.mov", exact}}, nil), "alice", testSyncPassword)); w.Code != http.StatusOK {
		t.Errorf("file at the limit: status %d", w.Code)
	}

	//Quota
	f := env.folder("alice")
	f.quota = f.used + 10
	w, result := env.do(signed(formRequest(t, []upFile{{"IMG_9.JPG", []byte("more than ten bytes")}}, nil), "alice", testSyncPassword))
	if w.Code != http.StatusInsufficientStorage || fileResult(t, result, 0).Reason != ReasonQuota {
		t.Errorf("quota full: %d %+v", w.Code, result)
	}

	//No file
	w, _ = env.do(signed(formRequest(t, nil, map[string]string{"date": "2026-08-14"}), "alice", testSyncPassword))
	if w.Code != http.StatusBadRequest {
		t.Errorf("no file: status %d, want 400", w.Code)
	}

	//A folder that cannot be written
	env.activate(t, "alice", UserSettings{Folder: "readonly:/x", DateSource: SourceCreated, Duplicates: DuplicateSkip})
	w, _ = env.do(signed(formRequest(t, []upFile{{"a.jpg", []byte("a")}}, nil), "alice", testSyncPassword))
	if w.Code != http.StatusConflict {
		t.Errorf("read only folder: status %d, want 409", w.Code)
	}
	if activity := env.m.activity("alice"); activity.LastError == "" || activity.Failed == 0 {
		t.Errorf("the failure is not in the activity: %+v", activity)
	}
}

func TestUploadRawBodyAndManyFiles(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", UserSettings{Folder: "user:/In", DateSource: SourceCreated, Duplicates: DuplicateSkip})

	r := httptest.NewRequest(http.MethodPost, UploadPath+"?date=2026-08-14", strings.NewReader("raw body photo"))
	r.Header.Set("Content-Type", "image/jpeg")
	r.Header.Set("Filename", "IMG_7.JPG")
	w, result := env.do(signed(r, "alice", testSyncPassword))
	if w.Code != http.StatusOK || fileResult(t, result, 0).Path != "user:/In/IMG_7.JPG" {
		t.Errorf("raw body: %d %s", w.Code, w.Body.String())
	}
	//No name at all: named from the content
	r = httptest.NewRequest(http.MethodPost, UploadPath, strings.NewReader("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"))
	w, result = env.do(signed(r, "alice", testSyncPassword))
	if got := fileResult(t, result, 0); w.Code != http.StatusOK || !strings.HasSuffix(got.Name, ".heic") || !strings.HasPrefix(got.Name, "Upload_") {
		t.Errorf("nameless upload: %d %+v", w.Code, got)
	}

	files := []upFile{{"a.jpg", []byte("a")}, {"b.jpg", []byte("b")}, {"c.mov", []byte("c")}}
	result = env.upload(t, "alice", files, nil)
	if result.Saved != 3 || len(result.Files) != 3 {
		t.Errorf("three files: %+v", result)
	}
	if activity := env.m.activity("alice"); activity.Saved != 5 || activity.LastFile == "" {
		t.Errorf("activity: %+v", activity)
	}
}

func TestUploadLoginPasswordMode(t *testing.T) {
	env := newTestEnv(t)
	settings := DefaultSettings()
	settings.LoginPassword = true
	settings.Activated = time.Now().Unix()
	env.m.setSettings("alice", settings)
	w, _ := env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", testLoginPassword))
	if w.Code != http.StatusOK {
		t.Errorf("login password: status %d", w.Code)
	}
	w, _ = env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "alice", testSyncPassword))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("other password: status %d", w.Code)
	}
}

func TestPasswordCache(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())
	settings, _ := env.m.Settings("alice")
	if err := env.m.checkPassword("alice", testSyncPassword, settings); err != nil {
		t.Fatalf("right password refused: %v", err)
	}
	if !env.m.cache.match("alice", testSyncPassword) {
		t.Errorf("a right password is not remembered")
	}
	if env.m.cache.match("alice", "something else") {
		t.Errorf("the cache matched another password")
	}
	//A new password forgets the old one at once
	env.m.setSyncPassword("alice", "a brand new password")
	if err := env.m.checkPassword("alice", testSyncPassword, settings); err == nil {
		t.Errorf("the old password still works")
	}
}

/*
	Settings endpoints
*/

func postForm(handler http.HandlerFunc, username string, values url.Values) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(values.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Test-User", username)
	w := httptest.NewRecorder()
	handler(w, r)
	return w
}

func TestActivateAndSettings(t *testing.T) {
	env := newTestEnv(t)
	env.m.setConfig(Config{Groups: []string{"family"}})
	form := url.Values{
		"folder":       {"user:/Phone"},
		"bytype":       {"true"},
		"datefolders":  {DateYear},
		"datesource":   {SourceCreated},
		"duplicates":   {DuplicateSkip},
		"syncpassword": {testSyncPassword},
		"password":     {testLoginPassword},
	}

	//Wrong login password
	bad := url.Values{}
	for k, v := range form {
		bad[k] = v
	}
	bad.Set("password", "nope")
	if w := postForm(env.m.HandleActivate, "bob", bad); w.Code != http.StatusForbidden {
		t.Errorf("wrong login password: %d %s", w.Code, w.Body.String())
	}
	//A short sync password
	short := url.Values{}
	for k, v := range form {
		short[k] = v
	}
	short.Set("syncpassword", "short")
	if w := postForm(env.m.HandleActivate, "bob", short); !strings.Contains(w.Body.String(), "error") {
		t.Errorf("short sync password accepted: %s", w.Body.String())
	}
	if _, active := env.m.Settings("bob"); active {
		t.Fatalf("turned on by a refused request")
	}

	if w := postForm(env.m.HandleActivate, "bob", form); strings.Contains(w.Body.String(), "error") {
		t.Fatalf("activate: %s", w.Body.String())
	}
	settings, active := env.m.Settings("bob")
	if !active || settings.Folder != "user:/Phone" || settings.DateFolders != DateYear || !settings.ByType {
		t.Fatalf("settings after activate: %+v", settings)
	}
	w, _ := env.do(signed(formRequest(t, []upFile{{"a.jpg", []byte("a")}}, nil), "bob", testSyncPassword))
	if w.Code != http.StatusOK {
		t.Errorf("upload after activate: %d %s", w.Code, w.Body.String())
	}

	//Settings change without a password, keeping the password choice
	change := url.Values{"folder": {"user:/Other"}, "bytype": {"false"}, "datefolders": {DateMonth}, "datesource": {SourceUpload}, "duplicates": {DuplicateOverwrite}}
	if w := postForm(env.m.HandleSettings, "bob", change); strings.Contains(w.Body.String(), "error") {
		t.Fatalf("settings: %s", w.Body.String())
	}
	settings, _ = env.m.Settings("bob")
	if settings.Folder != "user:/Other" || settings.Duplicates != DuplicateOverwrite || settings.Activated == 0 {
		t.Errorf("settings after change: %+v", settings)
	}
	bad = url.Values{"folder": {"readonly:/x"}, "datefolders": {DateMonth}}
	if w := postForm(env.m.HandleSettings, "bob", bad); !strings.Contains(w.Body.String(), "error") {
		t.Errorf("read only folder accepted")
	}

	//Switch to the login password
	switchForm := url.Values{"loginpassword": {"true"}, "password": {testLoginPassword}}
	if w := postForm(env.m.HandlePassword, "bob", switchForm); strings.Contains(w.Body.String(), "error") {
		t.Fatalf("password: %s", w.Body.String())
	}
	if env.m.hasSyncPassword("bob") {
		t.Errorf("the sync password is kept after switching to the login password")
	}
	w, _ = env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "bob", testLoginPassword))
	if w.Code != http.StatusOK {
		t.Errorf("login password after switching: %d", w.Code)
	}

	//Status
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Test-User", "bob")
	sw := httptest.NewRecorder()
	env.m.HandleStatus(sw, r)
	status := UserStatus{}
	json.Unmarshal(sw.Body.Bytes(), &status)
	if !status.Activated || !status.Allowed || !status.Running || status.Path != UploadPath || status.Activity.Saved != 1 {
		t.Errorf("status: %+v", status)
	}

	//Turning it off forgets everything
	postForm(env.m.HandleDeactivate, "bob", url.Values{})
	if _, active := env.m.Settings("bob"); active {
		t.Errorf("still on after deactivate")
	}
	w, _ = env.do(signed(httptest.NewRequest(http.MethodGet, UploadPath, nil), "bob", testLoginPassword))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("upload after deactivate: %d", w.Code)
	}
}

func TestActivateNotAllowed(t *testing.T) {
	env := newTestEnv(t)
	form := url.Values{"folder": {"user:/Phone"}, "loginpassword": {"true"}, "password": {testLoginPassword}}
	if w := postForm(env.m.HandleActivate, "carol", form); !strings.Contains(w.Body.String(), "may not") {
		t.Errorf("user outside the groups turned it on: %s", w.Body.String())
	}
}

func TestAdminConfigAndUsers(t *testing.T) {
	env := newTestEnv(t)
	form := url.Values{"maxsize": {"250"}, "groups": {`["family","no such group"]`}}
	if w := postForm(env.m.HandleConfig, "alice", form); strings.Contains(w.Body.String(), "error") {
		t.Fatalf("config: %s", w.Body.String())
	}
	config := env.m.Config()
	if config.MaxFileMB != 250 || len(config.Groups) != 1 || config.Groups[0] != "family" {
		t.Errorf("config: %+v", config)
	}
	if w := postForm(env.m.HandleConfig, "alice", url.Values{"maxsize": {"-1"}, "groups": {"[]"}}); !strings.Contains(w.Body.String(), "error") {
		t.Errorf("negative size accepted")
	}

	env.activate(t, "bob", DefaultSettings())
	env.activate(t, "ghost", DefaultSettings()) //An account deleted since
	users := env.m.Users()
	if len(users) != 1 || users[0].Username != "bob" || !users[0].Allowed {
		t.Errorf("users: %+v", users)
	}
	if env.m.hasSyncPassword("ghost") {
		t.Errorf("the deleted account is not forgotten")
	}
	postForm(env.m.HandleRevoke, "alice", url.Values{"username": {"bob"}})
	if len(env.m.Users()) != 0 {
		t.Errorf("revoke left the user")
	}
}

func TestPruneSeen(t *testing.T) {
	env := newTestEnv(t)
	now := time.Now()
	env.m.remember("alice", "old.jpg", "old.jpg", now.Add(-rememberFor-time.Hour))
	env.m.remember("alice", "new.jpg", "new.jpg", now)
	if _, ok := env.m.seen("alice", "OLD.JPG", now); ok {
		t.Errorf("a name older than 30 days still counts")
	}
	if _, ok := env.m.seen("alice", "NEW.jpg", now); !ok {
		t.Errorf("names are not matched without case")
	}
	env.m.pruneSeen("alice", now)
	if env.m.opt.Sysdb.KeyExists(settingsTable, seenKey("alice", "old.jpg")) {
		t.Errorf("the old name was not pruned")
	}
	if n := env.m.countSeen("alice", now); n != 1 {
		t.Errorf("count %d, want 1", n)
	}
}

func TestCredentialsHeaders(t *testing.T) {
	cases := []struct {
		name               string
		headers            map[string]string
		wantUser, wantPass string
	}{
		{"username and bearer", map[string]string{"Username": "bob", "Authorization": "Bearer pw 1"}, "bob", "pw 1"},
		{"x-username", map[string]string{"X-Username": "bob", "Authorization": "bearer pw"}, "bob", "pw"},
		{"x-user-name and x-user-cred", map[string]string{"X-User-Name": "bob", "X-User-Cred": "pass word"}, "bob", "pass word"},
		{"x-user-cred with bearer in front", map[string]string{"X-User-Name": "bob", "X-User-Cred": "Bearer pass"}, "bob", "pass"},
		//A proxy put its own credential in Authorization: ours still wins
		{"x-user-cred over a proxy's authorization", map[string]string{"X-User-Name": "bob", "X-User-Cred": "mine", "Authorization": "Bearer proxy-token"}, "bob", "mine"},
		{"x-user-name wins over username", map[string]string{"X-User-Name": "bob", "Username": "other", "X-User-Cred": "pw"}, "bob", "pw"},
		{"authorization without bearer", map[string]string{"Username": "bob", "Authorization": "pw"}, "bob", ""},
		{"nothing", map[string]string{}, "", ""},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		for k, v := range c.headers {
			r.Header.Set(k, v)
		}
		user, pass := credentials(r)
		if user != c.wantUser || pass != c.wantPass {
			t.Errorf("%s: got %q %q, want %q %q", c.name, user, pass, c.wantUser, c.wantPass)
		}
	}
}

func TestUploadWithProxyHeaders(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())
	r := formRequest(t, []upFile{{"IMG_5.JPG", []byte("jpeg")}}, nil)
	r.Header.Set("X-User-Name", "alice")
	r.Header.Set("X-User-Cred", testSyncPassword)
	r.Header.Set("Authorization", "Bearer some-proxy-token")
	if w, _ := env.do(r); w.Code != http.StatusOK {
		t.Errorf("X-User-Name and X-User-Cred: %d %s", w.Code, w.Body.String())
	}
	r = httptest.NewRequest(http.MethodGet, UploadPath, nil)
	r.Header.Set("X-User-Name", "alice")
	if w, _ := env.do(r); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "X-User-Cred") {
		t.Errorf("no password: %d %s", w.Code, w.Body.String())
	}
}

func TestCredentialsBasicHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("bob:pass word:with colon")))
	username, password := credentials(r)
	if username != "bob" || password != "pass word:with colon" {
		t.Errorf("basic: %q %q", username, password)
	}
}

func TestUploadGenericNames(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", UserSettings{Folder: "user:/In", DateSource: SourceCreated, Duplicates: DuplicateSkip})
	christmas := buildJPEG(buildTIFF(binary.LittleEndian, "2025:12:24 20:00:00", ""))
	newYear := buildJPEG(buildTIFF(binary.LittleEndian, "2026:01:01 00:00:05", ""))

	//Every edited photo comes as FullSizeRender: the date taken tells them apart
	first := env.upload(t, "alice", []upFile{{"FullSizeRender.jpg", christmas}}, nil)
	second := env.upload(t, "alice", []upFile{{"FullSizeRender.jpg", newYear}}, nil)
	if got := fileResult(t, first, 0); got.Result != ResultSaved || got.Name != "FullSizeRender_20251224_200000.jpg" {
		t.Errorf("first edited photo: %+v", got)
	}
	if got := fileResult(t, second, 0); got.Result != ResultSaved || got.Name != "FullSizeRender_20260101_000005.jpg" {
		t.Errorf("second edited photo: %+v", got)
	}
	//Sent again on the next run: the same name, so skipped
	again := env.upload(t, "alice", []upFile{{"FullSizeRender.jpg", christmas}}, nil)
	if got := fileResult(t, again, 0); got.Result != ResultSkipped {
		t.Errorf("edited photo sent again: %+v", got)
	}

	//Without a date, the content
	a := env.upload(t, "alice", []upFile{{"image.png", []byte("first picture")}}, nil)
	b := env.upload(t, "alice", []upFile{{"image.png", []byte("second picture")}}, nil)
	nameA, nameB := fileResult(t, a, 0).Name, fileResult(t, b, 0).Name
	if nameA == nameB || !strings.HasPrefix(nameA, "image_") || !strings.HasSuffix(nameA, ".png") {
		t.Errorf("dateless generic names: %q %q", nameA, nameB)
	}
	if got := fileResult(t, env.upload(t, "alice", []upFile{{"image.png", []byte("first picture")}}, nil), 0); got.Result != ResultSkipped {
		t.Errorf("dateless picture sent again: %+v", got)
	}

	//Real names stay as they are
	if got := fileResult(t, env.upload(t, "alice", []upFile{{"IMG_0042.JPG", christmas}}, nil), 0); got.Name != "IMG_0042.JPG" {
		t.Errorf("ordinary name changed: %+v", got)
	}
}

func TestGenericName(t *testing.T) {
	cases := map[string]bool{
		"FullSizeRender.jpg":   true,
		"FullSizeRender.HEIC":  true,
		"fullsizerender 2.jpg": true,
		"image.jpeg":           true,
		"Upload.heic":          true,
		"IMG_0001.HEIC":        false,
		"imagery.png":          false,
		"my photo.jpg":         false,
	}
	for name, want := range cases {
		if got := GenericName(name); got != want {
			t.Errorf("GenericName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestOtherPaths(t *testing.T) {
	env := newTestEnv(t)
	env.activate(t, "alice", DefaultSettings())

	//A trailing slash still uploads
	r := formRequest(t, []upFile{{"IMG_1.JPG", []byte("jpeg")}}, nil)
	r.URL.Path = UploadPath + "/"
	w := httptest.NewRecorder()
	env.m.HandleOtherPath(w, signed(r, "alice", testSyncPassword))
	if w.Code != http.StatusOK {
		t.Errorf("trailing slash: %d %s", w.Code, w.Body.String())
	}
	//Another address says where uploads go
	w = httptest.NewRecorder()
	env.m.HandleOtherPath(w, httptest.NewRequest(http.MethodPost, "/api/syncserver/uplaod", nil))
	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), UploadPath) {
		t.Errorf("typo: %d %s", w.Code, w.Body.String())
	}
}
