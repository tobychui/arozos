package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/modules"
	"imuslab.com/arozos/mod/user"
)

// fakeUsers resolves every request to one user, or fails when username is empty
type fakeUsers struct {
	username string
}

func (f fakeUsers) GetUserInfoFromRequest(w http.ResponseWriter, r *http.Request) (*user.User, error) {
	if f.username == "" {
		return nil, errors.New("not logged in")
	}
	return &user.User{Username: f.username}, nil
}

func (f fakeUsers) GetUserInfoFromUsername(username string) (*user.User, error) {
	return nil, errors.New("user not found")
}

// fakeModules is a module lookup backed by a map
type fakeModules map[string]*modules.ModuleInfo

func (f fakeModules) GetModuleInfoByID(moduleid string) *modules.ModuleInfo {
	return f[moduleid]
}

// fakeRouter records the registered endpoints
type fakeRouter struct {
	endpoints []string
}

func (f *fakeRouter) HandleFunc(endpoint string, handler func(http.ResponseWriter, *http.Request)) error {
	f.endpoints = append(f.endpoints, endpoint)
	return nil
}

func noResolver(vpath string) (*filesystem.FileSystemHandler, string, error) {
	return nil, "", errors.New("no file system in tests")
}

func newTestDatabase(t *testing.T) *database.Database {
	t.Helper()
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("unable to create test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// newTestService creates a service logged in as username ("" = anonymous)
func newTestService(t *testing.T, username string, opts Options) *Service {
	t.Helper()
	opts.Database = newTestDatabase(t)
	opts.Users = fakeUsers{username: username}
	opts.ResolveVirtualPath = noResolver
	if opts.WebRoot == "" {
		opts.WebRoot = t.TempDir()
	}
	s, err := New(opts)
	if err != nil {
		t.Fatalf("New returned unexpected error: %v", err)
	}
	return s
}

// post calls a handler with form values and returns the response body
func post(handler http.HandlerFunc, values url.Values) string {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	handler(rec, req)
	return strings.TrimSpace(rec.Body.String())
}

// get calls a handler with query values and returns the response body
func get(handler http.HandlerFunc, values url.Values) string {
	req := httptest.NewRequest(http.MethodGet, "/?"+values.Encode(), nil)
	rec := httptest.NewRecorder()
	handler(rec, req)
	return strings.TrimSpace(rec.Body.String())
}

func TestNewValidatesOptions(t *testing.T) {
	db := newTestDatabase(t)
	tests := []struct {
		name    string
		opts    Options
		wantErr bool
	}{
		{"missing database", Options{Users: fakeUsers{}, ResolveVirtualPath: noResolver}, true},
		{"missing users", Options{Database: db, ResolveVirtualPath: noResolver}, true},
		{"missing resolver", Options{Database: db, Users: fakeUsers{}}, true},
		{"complete", Options{Database: db, Users: fakeUsers{}, ResolveVirtualPath: noResolver}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, err := New(tc.opts)
			if (err != nil) != tc.wantErr {
				t.Fatalf("New() error = %v, wantErr %v", err, tc.wantErr)
			}
			if err == nil && s == nil {
				t.Fatal("New() returned nil service without error")
			}
		})
	}
}

func TestNewAppliesDefaults(t *testing.T) {
	s, err := New(Options{Database: newTestDatabase(t), Users: fakeUsers{}, ResolveVirtualPath: noResolver})
	if err != nil {
		t.Fatalf("New returned unexpected error: %v", err)
	}
	checks := map[string][2]string{
		"TableName":      {s.opts.TableName, DefaultTableName},
		"WebRoot":        {s.opts.WebRoot, DefaultWebRoot},
		"WallpaperRoot":  {s.opts.WallpaperRoot, DefaultWallpaperRoot},
		"TemplateFolder": {s.opts.TemplateFolder, DefaultTemplateFolder},
	}
	for field, got := range checks {
		if got[0] != got[1] {
			t.Errorf("%s = %q, want %q", field, got[0], got[1])
		}
	}
	if !s.opts.Database.TableExists(DefaultTableName) {
		t.Errorf("table %q was not created", DefaultTableName)
	}
}

func TestRegisterRoutes(t *testing.T) {
	s := newTestService(t, "alice", Options{})
	router := &fakeRouter{}
	s.RegisterRoutes(router)

	want := []string{
		"/system/desktop/createShortcut",
		"/system/desktop/files",
		"/system/desktop/host",
		"/system/desktop/listDesktop",
		"/system/desktop/opr/getShortcut",
		"/system/desktop/opr/renameShortcut",
		"/system/desktop/opr/updateShortcut",
		"/system/desktop/preference",
		"/system/desktop/theme",
		"/system/desktop/user",
	}
	got := append([]string{}, router.endpoints...)
	sort.Strings(got)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("registered endpoints =\n%v\nwant\n%v", got, want)
	}
}

func TestUniqueShortcutFilename(t *testing.T) {
	tests := []struct {
		name     string
		existing []string
		want     string
	}{
		{"free", nil, "/d/App.shortcut"},
		{"one taken", []string{"/d/App.shortcut"}, "/d/App(1).shortcut"},
		{"two taken", []string{"/d/App.shortcut", "/d/App(1).shortcut"}, "/d/App(2).shortcut"},
		{"gap is not reused", []string{"/d/App.shortcut", "/d/App(2).shortcut"}, "/d/App(1).shortcut"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			taken := map[string]bool{}
			for _, f := range tc.existing {
				taken[f] = true
			}
			got := uniqueShortcutFilename("/d", "App", func(f string) bool { return taken[f] })
			if got != tc.want {
				t.Errorf("uniqueShortcutFilename = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestIsHiddenFile(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"files/alice/Desktop/.metadata", true},
		{".hidden", true},
		{"files/alice/Desktop/App.shortcut", false},
		{"files/.alice/Desktop/file.txt", false},
	}
	for _, tc := range tests {
		if got := isHiddenFile(tc.name); got != tc.want {
			t.Errorf("isHiddenFile(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestApplyShortcutEdit(t *testing.T) {
	photo := &modules.ModuleInfo{Name: "Photo", IconPath: "Photo/img/module_icon.png"}
	allowAll := func(string) bool { return true }
	denyAll := func(string) bool { return false }

	tests := []struct {
		name      string
		data      arozfs.ShortcutData
		edit      shortcutEdit
		modules   ModuleLookup
		canUse    func(string) bool
		wantErr   string
		wantAfter arozfs.ShortcutData
	}{
		{
			name:      "url with launch options",
			data:      arozfs.ShortcutData{Type: "url"},
			edit:      shortcutEdit{Name: " Site ", Path: "https://example.com", Icon: "i.png", Title: "T", OpenIn: "TAB", Width: "800", Height: "50"},
			wantAfter: arozfs.ShortcutData{Type: "url", Name: "Site", Path: "https://example.com", Icon: "i.png", WindowTitle: "T", OpenIn: "tab", WindowWidth: 800, WindowHeight: 100},
		},
		{
			name:    "url must be http",
			data:    arozfs.ShortcutData{Type: "url"},
			edit:    shortcutEdit{Name: "x", Path: "javascript:alert(1)", Icon: "i.png"},
			wantErr: "http",
		},
		{
			name:    "empty name",
			data:    arozfs.ShortcutData{Type: "url"},
			edit:    shortcutEdit{Name: "  ", Path: "https://a.com", Icon: "i.png"},
			wantErr: "name",
		},
		{
			name:    "empty target",
			data:    arozfs.ShortcutData{Type: "folder"},
			edit:    shortcutEdit{Name: "x", Icon: "i.png"},
			wantErr: "target",
		},
		{
			name:    "icon with markup",
			data:    arozfs.ShortcutData{Type: "folder"},
			edit:    shortcutEdit{Name: "x", Path: "user:/", Icon: `a.png" onerror="x`},
			wantErr: "icon",
		},
		{
			name:    "empty icon",
			data:    arozfs.ShortcutData{Type: "folder"},
			edit:    shortcutEdit{Name: "x", Path: "user:/"},
			wantErr: "icon",
		},
		{
			name:      "folder drops launch options",
			data:      arozfs.ShortcutData{Type: "folder", WindowTitle: "old", OpenIn: "tab", WindowWidth: 500},
			edit:      shortcutEdit{Name: "Docs", Path: "user:/Documents", Icon: "f.png", Title: "ignored", Width: "900"},
			wantAfter: arozfs.ShortcutData{Type: "folder", Name: "Docs", Path: "user:/Documents", Icon: "f.png"},
		},
		{
			name:      "container app keeps its slug and drops launch options",
			data:      arozfs.ShortcutData{Type: "app", Path: "grafana", OpenIn: "tab"},
			edit:      shortcutEdit{Name: "Dashboards", Path: "grafana", Icon: "ContainerApps/img/app.svg", OpenIn: "tab", Width: "900"},
			wantAfter: arozfs.ShortcutData{Type: "app", Name: "Dashboards", Path: "grafana", Icon: "ContainerApps/img/app.svg"},
		},
		{
			name:    "container app with an invalid slug",
			data:    arozfs.ShortcutData{Type: "app"},
			edit:    shortcutEdit{Name: "x", Path: "../../etc", Icon: "i.png"},
			wantErr: "container app",
		},
		{
			name:    "unsupported type",
			data:    arozfs.ShortcutData{Type: "invalid"},
			edit:    shortcutEdit{Name: "x", Path: "y", Icon: "i.png"},
			wantErr: "Unsupported",
		},
		{
			name:    "module without lookup",
			data:    arozfs.ShortcutData{Type: "module"},
			edit:    shortcutEdit{Name: "x", Path: "Photo", Icon: "i.png"},
			canUse:  allowAll,
			wantErr: "not found",
		},
		{
			name:    "module not installed",
			data:    arozfs.ShortcutData{Type: "module"},
			edit:    shortcutEdit{Name: "x", Path: "Nope", Icon: "i.png"},
			modules: fakeModules{"Photo": photo},
			canUse:  allowAll,
			wantErr: "not found",
		},
		{
			name:    "module without permission",
			data:    arozfs.ShortcutData{Type: "module"},
			edit:    shortcutEdit{Name: "x", Path: "Photo", Icon: "i.png"},
			modules: fakeModules{"Photo": photo},
			canUse:  denyAll,
			wantErr: "not found",
		},
		{
			name:      "module keeps its icon and ignores icon and launch options",
			data:      arozfs.ShortcutData{Type: "module", Path: "Photo", Icon: "Photo/img/desktop_icon.png", WindowTitle: "old"},
			edit:      shortcutEdit{Name: "My Photos", Path: "Photo", Icon: "custom.png", Title: "ignored", OpenIn: "tab"},
			modules:   fakeModules{"Photo": photo},
			canUse:    allowAll,
			wantAfter: arozfs.ShortcutData{Type: "module", Name: "My Photos", Path: "Photo", Icon: "Photo/img/desktop_icon.png"},
		},
		{
			name:      "module switched to another app takes that app's icon",
			data:      arozfs.ShortcutData{Type: "module", Path: "Video", Icon: "Video/img/desktop_icon.png"},
			edit:      shortcutEdit{Name: "Photo", Path: "Photo", Icon: "custom.png"},
			modules:   fakeModules{"Photo": photo},
			canUse:    allowAll,
			wantAfter: arozfs.ShortcutData{Type: "module", Name: "Photo", Path: "Photo", Icon: "Photo/img/module_icon.png"},
		},
		{
			name:      "module without an icon gets the app icon when no desktop icon can be made",
			data:      arozfs.ShortcutData{Type: "module", Path: "Photo"},
			edit:      shortcutEdit{Name: "Photo", Path: "Photo"},
			modules:   fakeModules{"Photo": photo},
			canUse:    allowAll,
			wantAfter: arozfs.ShortcutData{Type: "module", Name: "Photo", Path: "Photo", Icon: "Photo/img/module_icon.png"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestService(t, "alice", Options{Modules: tc.modules})
			data := tc.data
			err := s.applyShortcutEdit(&data, tc.edit, tc.canUse)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("applyShortcutEdit error = %v, want one containing %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("applyShortcutEdit returned unexpected error: %v", err)
			}
			if data.Type != tc.wantAfter.Type || data.Name != tc.wantAfter.Name || data.Path != tc.wantAfter.Path ||
				data.Icon != tc.wantAfter.Icon || data.WindowTitle != tc.wantAfter.WindowTitle || data.OpenIn != tc.wantAfter.OpenIn ||
				data.WindowWidth != tc.wantAfter.WindowWidth || data.WindowHeight != tc.wantAfter.WindowHeight {
				t.Errorf("after edit = %+v\nwant %+v", data, tc.wantAfter)
			}
		})
	}
}

func TestHandlePreference(t *testing.T) {
	s := newTestService(t, "alice", Options{})
	steps := []struct {
		name   string
		values url.Values
		want   string
	}{
		{"unset value", url.Values{"preference": {"iconsize"}}, `""`},
		{"set value", url.Values{"preference": {"iconsize"}, "value": {"big"}}, `"OK"`},
		{"read value", url.Values{"preference": {"iconsize"}}, `"big"`},
		{"remove value", url.Values{"preference": {"iconsize"}, "remove": {"true"}}, `"OK"`},
		{"read removed", url.Values{"preference": {"iconsize"}}, `""`},
		{"missing key", url.Values{"value": {"big"}}, `{"error":"Error. Undefined paramter."}`},
	}
	for _, step := range steps {
		if got := post(s.handlePreference, step.values); got != step.want {
			t.Errorf("%s: response = %s, want %s", step.name, got, step.want)
		}
	}
}

func TestHandleTheme(t *testing.T) {
	s := newTestService(t, "alice", Options{WallpaperRoot: t.TempDir()})
	steps := []struct {
		name   string
		values url.Values
		want   string
	}{
		{"list empty theme folder", url.Values{}, `[]`},
		{"set theme", url.Values{"set": {"Autumn"}}, `"OK"`},
		{"get theme", url.Values{"get": {"true"}}, `"Autumn"`},
	}
	for _, step := range steps {
		if got := get(s.handleTheme, step.values); got != step.want {
			t.Errorf("%s: response = %s, want %s", step.name, got, step.want)
		}
	}
}

func TestHandleHostInfo(t *testing.T) {
	tests := []struct {
		name     string
		hostInfo func() HostInfo
		want     string
	}{
		{"no provider", nil, `"Hostname":""`},
		{"provider", func() HostInfo { return HostInfo{Hostname: "NAS", DeviceModel: "AR100"} }, `"Hostname":"NAS"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestService(t, "alice", Options{HostInfo: tc.hostInfo})
			if got := get(s.handleHostInfo, url.Values{}); !strings.Contains(got, tc.want) {
				t.Errorf("response = %s, want it to contain %s", got, tc.want)
			}
		})
	}
}

func TestHandlersRequireLogin(t *testing.T) {
	s := newTestService(t, "", Options{})
	handlers := map[string]http.HandlerFunc{
		"listDesktop":    s.handleListDesktop,
		"theme":          s.handleTheme,
		"files":          s.handleIconLocation,
		"user":           s.handleUserInfo,
		"preference":     s.handlePreference,
		"createShortcut": s.handleShortcutCreate,
		"renameShortcut": s.handleShortcutRename,
		"getShortcut":    s.handleShortcutGet,
		"updateShortcut": s.handleShortcutUpdate,
	}
	for name, handler := range handlers {
		got := post(handler, url.Values{"preference": {"x"}, "src": {"user:/Desktop/a.shortcut"}})
		if !strings.Contains(got, `"error"`) {
			t.Errorf("%s: anonymous response = %s, want an error", name, got)
		}
	}
}

func TestShortcutEndpointsRejectNonShortcutFiles(t *testing.T) {
	s := newTestService(t, "alice", Options{})
	tests := []struct {
		name    string
		handler http.HandlerFunc
		values  url.Values
		want    string
	}{
		{"get", s.handleShortcutGet, url.Values{"src": {"user:/Desktop/notes.txt"}}, "not a shortcut"},
		{"update", s.handleShortcutUpdate, url.Values{"src": {"user:/Desktop/notes.txt"}}, "not a shortcut"},
		{"rename outside desktop", s.handleShortcutRename, url.Values{"src": {"user:/a.shortcut"}, "new": {"x"}}, "not on desktop"},
		{"rename short path", s.handleShortcutRename, url.Values{"src": {"a"}, "new": {"x"}}, "not on desktop"},
		{"rename empty name", s.handleShortcutRename, url.Values{"src": {"user:/Desktop/a.shortcut"}, "new": {" "}}, "Invalid new name"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			if tc.name == "update" {
				got = post(tc.handler, tc.values)
			} else {
				got = get(tc.handler, tc.values)
			}
			if !strings.Contains(got, tc.want) {
				t.Errorf("response = %s, want it to contain %q", got, tc.want)
			}
		})
	}
}
