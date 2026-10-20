package locale

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/image/font/gofont/goregular"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/locale/fonts"
)

const settingsJSON = `{
    "author": "test",
    "keys": {
        "zh-hk": {
            "name": "繁體中文（香港）",
            "fontFamily": "\"Microsoft JhengHei\"",
            "strings": {"a": "系統設定"}
        },
        "en-us": {
            "name": "English (US)",
            "strings": {"a": "Settings <b>now</b>"}
        }
    }
}`

// newTestServer builds a locale folder with the Go font defaulting for en-us
func newTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "locale")
	write := func(rel, content string) {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("system_settings.json", settingsJSON)
	write("sub/page.json", "\xef\xbb\xbf"+`{"keys": {"en-us": {"name": "English", "fontFamily": "Arial", "strings": {}}, "zh-hk": {"strings": {}}}}`)
	write("broken.json", `{"keys": {,}`)
	write("notes.txt", "hello")
	write("secret.db", "nope")
	write(".hidden/x.json", "{}")
	write("fonts/defaults.json", `{"defaults": {"en-us": "Go"}, "fallback": {"en-us": "Arial, sans-serif"}}`)
	write("fonts/Go/Go-Regular.ttf", string(goregular.TTF))

	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	lib, err := fonts.NewLibrary(fonts.Options{Root: filepath.Join(root, "fonts"), CacheDir: filepath.Join(t.TempDir(), "cache"), DB: db})
	if err != nil {
		t.Fatalf("NewLibrary: %v", err)
	}
	srv, err := NewServer(Options{Root: root, Fonts: lib})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	return srv, root
}

func get(srv *Server, path, user string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	srv.Serve(w, r, user)
	return w
}

func TestLanguagesComeFromSystemSettings(t *testing.T) {
	srv, _ := newTestServer(t)
	langs := srv.Languages()
	if len(langs) != 2 || langs[0].Code != "en-us" || langs[1].Code != "zh-hk" || langs[1].Name != "繁體中文（香港）" {
		t.Errorf("languages = %+v", langs)
	}
}

func TestRenderAddsTheLibraryFont(t *testing.T) {
	srv, _ := newTestServer(t)
	w := get(srv, URLPrefix+"system_settings.json", "alice", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	body := w.Body.String()
	if strings.Index(body, `"zh-hk"`) > strings.Index(body, `"en-us"`) {
		t.Error("language order changed")
	}
	if !strings.Contains(body, "Settings <b>now</b>") {
		t.Error("HTML in strings was escaped")
	}
	var doc struct {
		Keys map[string]map[string]interface{} `json:"keys"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	en := doc.Keys["en-us"]
	if en["fontFamily"] != `"Go", Arial, sans-serif` || en["systemFont"] != "Go" || en["fontCSS"] != "fonts/fonts.css" {
		t.Errorf("en-us block = %v", en)
	}
	if _, ok := doc.Keys["zh-hk"]["systemFont"]; ok || doc.Keys["zh-hk"]["fontFamily"] != `"Microsoft JhengHei"` {
		t.Errorf("zh-hk block changed: %v", doc.Keys["zh-hk"])
	}

	// a file in a sub folder keeps its own fonts after the library one
	w = get(srv, URLPrefix+"sub/page.json", "alice", nil)
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("sub/page.json is not JSON: %v", err)
	}
	if doc.Keys["en-us"]["fontFamily"] != `"Go", Arial` || doc.Keys["en-us"]["fontCSS"] != "../fonts/fonts.css" {
		t.Errorf("sub/page.json en-us = %v", doc.Keys["en-us"])
	}
}

func TestFilesWithoutLibraryFontsAreSentAsTheyAre(t *testing.T) {
	srv, root := newTestServer(t)
	srv.opts.Fonts.SetChoice("bob", "en-us", fonts.SystemFont)
	raw, _ := os.ReadFile(filepath.Join(root, "system_settings.json"))
	if w := get(srv, URLPrefix+"system_settings.json", "bob", nil); w.Body.String() != string(raw) {
		t.Errorf("file changed for a user without library fonts:\n%s", w.Body.String())
	}
	if w := get(srv, URLPrefix+"broken.json", "alice", nil); w.Code != http.StatusOK || w.Body.String() != `{"keys": {,}` {
		t.Errorf("invalid JSON not sent as is: %d %q", w.Code, w.Body.String())
	}
}

func TestOnlyLocaleFilesAreServed(t *testing.T) {
	srv, _ := newTestServer(t)
	tests := []struct {
		path string
		code int
	}{
		{"notes.txt", http.StatusOK},
		{"secret.db", http.StatusNotFound},
		{"../locale/system_settings.json", http.StatusNotFound},
		{"sub/../system_settings.json", http.StatusNotFound},
		{"sub/..\\..\\x.json", http.StatusNotFound},
		{".hidden/x.json", http.StatusNotFound},
		{"fonts/Go/Go-Regular.ttf", http.StatusNotFound},
		{"fonts/defaults.json", http.StatusOK},
		{"missing.json", http.StatusNotFound},
		{"", http.StatusNotFound},
		{"sub/", http.StatusNotFound},
	}
	for _, tt := range tests {
		if w := get(srv, URLPrefix+tt.path, "alice", nil); w.Code != tt.code {
			t.Errorf("GET %q = %d, want %d", tt.path, w.Code, tt.code)
		}
	}
	r := httptest.NewRequest(http.MethodPost, URLPrefix+"notes.txt", nil)
	w := httptest.NewRecorder()
	srv.Serve(w, r, "alice")
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d", w.Code)
	}
}

func TestStyleSheetRevalidates(t *testing.T) {
	srv, _ := newTestServer(t)
	w := get(srv, URLPrefix+"fonts/fonts.css", "alice", nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `font-family: "Go";`) {
		t.Fatalf("fonts.css: %d\n%s", w.Code, w.Body.String())
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag")
	}
	if w := get(srv, URLPrefix+"fonts/fonts.css", "alice", map[string]string{"If-None-Match": etag}); w.Code != http.StatusNotModified {
		t.Errorf("revalidation = %d, want 304", w.Code)
	}
	if w := get(srv, URLPrefix+"fonts/fonts.css?preview=1&lang=en-us", "alice", nil); !strings.Contains(w.Body.String(), "AO Preview Go") {
		t.Errorf("preview style sheet:\n%s", w.Body.String())
	}
	if w := get(srv, URLPrefix+"fonts/slice/nope/c00.woff2", "alice", nil); w.Code != http.StatusNotFound {
		t.Errorf("unknown slice = %d", w.Code)
	}
}

func TestLegacyRootFallback(t *testing.T) {
	srv, _ := newTestServer(t)
	legacy := t.TempDir()
	os.WriteFile(filepath.Join(legacy, "old.json"), []byte(`{"keys": {}}`), 0644)
	srv.opts.LegacyRoot = legacy
	if w := get(srv, URLPrefix+"old.json", "alice", nil); w.Code != http.StatusOK {
		t.Errorf("legacy file = %d", w.Code)
	}
}
