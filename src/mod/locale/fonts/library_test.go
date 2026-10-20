package fonts

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/database"
)

// newTestLibrary returns a library holding the Go font in Go/Go-Regular.ttf,
// with "en-us" defaulting to it
func newTestLibrary(t *testing.T) (*Library, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "fonts")
	if err := os.MkdirAll(filepath.Join(root, "Go"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Go", "Go-Regular.ttf"), goFont(t), 0644); err != nil {
		t.Fatal(err)
	}
	defaults := `{"defaults": {"en-us": "Go"}, "fallback": {"en-us": "Arial, sans-serif"}}`
	if err := os.WriteFile(filepath.Join(root, defaultsFile), []byte(defaults), 0644); err != nil {
		t.Fatal(err)
	}
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	lib, err := NewLibrary(Options{Root: root, CacheDir: filepath.Join(t.TempDir(), "cache"), DB: db})
	if err != nil {
		t.Fatalf("NewLibrary: %v", err)
	}
	lib.SetLanguageText(map[string]string{"en-US": "Settings and files", "zh-hk": "系統設定"}, "English 繁體中文")
	return lib, root
}

func TestLibraryIndexesFamilies(t *testing.T) {
	lib, _ := newTestLibrary(t)
	fams := lib.Families([]string{"en-us", "zh-hk"})
	if len(fams) != 1 || fams[0].Name != "Go" {
		t.Fatalf("families = %+v, want only Go", fams)
	}
	f := fams[0]
	if len(f.Faces) != 1 || f.Faces[0].File != "Go-Regular.ttf" || f.Faces[0].Family != "Go" {
		t.Errorf("faces = %+v", f.Faces)
	}
	if strings.Join(f.Languages, ",") != "en-us" {
		t.Errorf("supported languages = %v, want [en-us] (no CJK in the Go font)", f.Languages)
	}
	if f.Preview != PreviewName("Go") {
		t.Errorf("preview name = %q", f.Preview)
	}
}

func TestLibraryChoices(t *testing.T) {
	lib, _ := newTestLibrary(t)
	steps := []struct {
		name      string
		apply     func() error
		wantErr   bool
		user      string
		lang      string
		effective string
	}{
		{"factory default", nil, false, "alice", "en-us", "Go"},
		{"no default for a language", nil, false, "alice", "zh-hk", ""},
		{"user picks device fonts", func() error { return lib.SetChoice("alice", "en-us", SystemFont) }, false, "alice", "en-us", ""},
		{"other users keep the default", nil, false, "bob", "en-us", "Go"},
		{"admin default to device fonts", func() error { return lib.SetDefault("en-us", SystemFont) }, false, "bob", "en-us", ""},
		{"user follows the default again", func() error { return lib.SetChoice("alice", "en-us", "") }, false, "alice", "en-us", ""},
		{"admin back to factory", func() error { return lib.SetDefault("en-us", "") }, false, "bob", "en-us", "Go"},
		{"family names are case insensitive", func() error { return lib.SetChoice("bob", "zh-hk", "go") }, false, "bob", "zh-hk", "Go"},
		{"unknown family refused", func() error { return lib.SetChoice("bob", "en-us", "Nope Sans") }, true, "bob", "en-us", "Go"},
		{"invalid language refused", func() error { return lib.SetDefault("../x", "Go") }, true, "bob", "en-us", "Go"},
	}
	for _, s := range steps {
		if s.apply != nil {
			if err := s.apply(); (err != nil) != s.wantErr {
				t.Fatalf("%s: error = %v, wantErr %v", s.name, err, s.wantErr)
			}
		}
		if got := lib.Effective(s.user, s.lang); got != s.effective {
			t.Errorf("%s: Effective(%s, %s) = %q, want %q", s.name, s.user, s.lang, got, s.effective)
		}
	}
	if got := lib.Choice("bob", "zh-hk"); got != "Go" {
		t.Errorf("stored choice = %q, want the canonical name Go", got)
	}
}

func TestStyleSheets(t *testing.T) {
	lib, _ := newTestLibrary(t)
	css := lib.StyleSheet("alice", []string{"en-us", "zh-hk"})
	if !strings.Contains(css, `font-family: "Go";`) || !strings.Contains(css, `/all.woff2`) {
		t.Errorf("user style sheet lacks the Go face:\n%s", css)
	}
	if strings.Contains(css, "unicode-range") {
		t.Error("a whole font has a unicode-range")
	}
	lib.SetChoice("alice", "en-us", SystemFont)
	if css := lib.StyleSheet("alice", []string{"en-us", "zh-hk"}); strings.Contains(css, "@font-face") {
		t.Errorf("no font in use, style sheet still declares faces:\n%s", css)
	}
	if css := lib.PreviewStyleSheet("en-us"); !strings.Contains(css, `font-family: "AO Preview Go";`) {
		t.Errorf("preview style sheet lacks the preview name:\n%s", css)
	}
}

func TestSlicedStyleSheetAndSlices(t *testing.T) {
	saved, savedSize := sliceMinBytes, sliceSize
	sliceMinBytes, sliceSize = 1, 300 // slice even the small Go font
	t.Cleanup(func() { sliceMinBytes, sliceSize = saved, savedSize })

	lib, _ := newTestLibrary(t)
	css := lib.StyleSheet("alice", []string{"en-us"})
	re := regexp.MustCompile(`slice/([0-9a-f]+)/([a-z0-9_-]+)\.woff2`)
	found := re.FindAllStringSubmatch(css, -1)
	var cold, ui int
	for _, m := range found {
		if strings.HasPrefix(m[2], "ui-en-us-") {
			ui++
		} else if strings.HasPrefix(m[2], "c") {
			cold++
		}
	}
	if cold < 2 || ui != 1 {
		t.Fatalf("got %d cold and %d ui faces:\n%s", cold, ui, css)
	}
	if strings.LastIndex(css, "ui-en-us-") < strings.LastIndex(css, "/c0") {
		t.Error("the ui face must be declared after the cold ones")
	}

	// no codepoint may belong to two faces of the family
	seen := map[int64]string{}
	for _, face := range strings.Split(css, "@font-face")[1:] {
		m := regexp.MustCompile(`/([a-z0-9_-]+)\.woff2.*unicode-range: ([^;]+);`).FindStringSubmatch(strings.ReplaceAll(face, "\n", " "))
		if m == nil {
			t.Fatalf("face without a unicode-range:\n%s", face)
		}
		for _, part := range strings.Split(m[2], ", ") {
			bounds := strings.Split(strings.TrimPrefix(part, "U+"), "-")
			lo, _ := strconv.ParseInt(bounds[0], 16, 64)
			hi := lo
			if len(bounds) == 2 {
				hi, _ = strconv.ParseInt(bounds[1], 16, 64)
			}
			for cp := lo; cp <= hi; cp++ {
				if other, dup := seen[cp]; dup {
					t.Fatalf("U+%X is in both %s and %s", cp, other, m[1])
				}
				seen[cp] = m[1]
			}
		}
	}
	if seen['S'] == "" || !strings.HasPrefix(seen['S'], "ui-") {
		t.Errorf("'S' of the interface text belongs to %q, want the ui slice", seen['S'])
	}

	for _, m := range found {
		path, err := lib.SlicePath(m[1], m[2])
		if err != nil {
			t.Fatalf("SlicePath(%s): %v", m[2], err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		font, container, err := Decode(data)
		if err != nil || container != "woff2" {
			t.Fatalf("slice %s: %v %q", m[2], err, container)
		}
		if _, _, err := Inspect(font); err != nil {
			t.Errorf("slice %s does not inspect: %v", m[2], err)
		}
	}

	for _, name := range []string{"all", "c99", "ui-en-us-00000000", "ui-../x-12345678", "../../etc"} {
		if _, err := lib.SlicePath(found[0][1], name); err == nil {
			t.Errorf("SlicePath(%q) succeeded", name)
		}
	}
	if _, err := lib.SlicePath("0000000000000000", "c00"); err == nil {
		t.Error("unknown face key accepted")
	}
}

func TestServeSlice(t *testing.T) {
	lib, _ := newTestLibrary(t)
	key := lib.Families(nil)[0].Faces[0]
	var faceKey string
	for k, f := range lib.faces {
		if f.ID == key.ID {
			faceKey = k
		}
	}
	rec := httptest.NewRecorder()
	lib.ServeSlice(rec, httptest.NewRequest(http.MethodGet, "/x", nil), faceKey, "all")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "font/woff2" {
		t.Fatalf("status %d, type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Error("slices should be cached for good")
	}
	rec = httptest.NewRecorder()
	lib.ServeSlice(rec, httptest.NewRequest(http.MethodGet, "/x", nil), faceKey, "nope")
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown slice: status %d", rec.Code)
	}
}

func TestInstallAndDelete(t *testing.T) {
	lib, root := newTestLibrary(t)

	if _, err := lib.Install("Go-Regular.ttf", goFont(t)); err == nil || !strings.Contains(err.Error(), "already installed") {
		t.Errorf("duplicate install: %v", err)
	}
	if _, err := lib.Install("notes.ttf", []byte("not a font at all, honestly")); err == nil {
		t.Error("garbage installed")
	}
	if _, err := lib.Install("huge.ttf", make([]byte, MaxFontSize+1)); err == nil {
		t.Error("oversized file installed")
	}

	// a WOFF of the bold Go font, uploaded with a hostile name
	if err := lib.Delete("Go"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "Go")); !os.IsNotExist(err) {
		t.Error("the family folder is still there")
	}
	face, err := lib.Install(`..\..\evil/../Go Font.woff`, makeWOFF(t, goFont(t)))
	if err != nil {
		t.Fatalf("Install(woff): %v", err)
	}
	if face.Format != "ttf" || !strings.HasPrefix(face.ID, "Go/") || strings.Contains(face.ID, "..") {
		t.Errorf("installed as %+v", face)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(face.ID))); err != nil {
		t.Errorf("installed file missing: %v", err)
	}
	if lib.Effective("alice", "en-us") != "Go" {
		t.Error("the reinstalled family is not in use again")
	}

	// a fresh scan finds the same, and drops slices of fonts that are gone
	stale := filepath.Join(lib.opts.CacheDir, "0123456789abcdef")
	os.MkdirAll(stale, 0755)
	if err := lib.Rescan(); err != nil {
		t.Fatal(err)
	}
	if fams := lib.Families(nil); len(fams) != 1 || fams[0].Faces[0].ID != face.ID {
		t.Errorf("after rescan: %+v", fams)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("slices of a removed font survived the rescan")
	}
	if err := lib.Delete("No Such Family"); err != ErrNotFound {
		t.Errorf("Delete(unknown) = %v", err)
	}
}

func TestDirName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"Chiron Hei HK", "Chiron_Hei_HK"},
		{"../../etc", "etc"},
		{"思源黑體", "Font_e6809de6ba90e9bb91e9ab94"},
	}
	for _, tt := range tests {
		if got := dirName(tt.in); got != tt.want {
			t.Errorf("dirName(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
