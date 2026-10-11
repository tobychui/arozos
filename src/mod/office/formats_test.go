package office

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func readFixture(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAppForFile(t *testing.T) {
	tests := []struct {
		ext, app string
		legacy   bool
	}{
		{".docx", AppDocument, false},
		{".DOC", AppDocument, true},
		{".dot", AppDocument, true},
		{".xls", AppSpreadsheet, true},
		{".xlt", AppSpreadsheet, true},
		{".xlsx", AppSpreadsheet, false},
		{".ppt", AppPresentation, true},
		{".pps", AppPresentation, true},
		{".odt", "", false},
		{".txt", "", false},
	}
	for _, tc := range tests {
		if got := AppForFile(tc.ext); got != tc.app {
			t.Errorf("AppForFile(%q) = %q, want %q", tc.ext, got, tc.app)
		}
		if got := IsLegacyExt(tc.ext); got != tc.legacy {
			t.Errorf("IsLegacyExt(%q) = %v", tc.ext, got)
		}
	}
	// the legacy formats are never a save target
	for _, ext := range []string{".doc", ".xls", ".ppt"} {
		if AppForExt(ext) != "" {
			t.Errorf("AppForExt(%q) should not name an app", ext)
		}
	}
}

var legacyFixtures = []struct {
	path, app, text string
}{
	{"doc/testdata/features.doc", AppDocument, "ArozOS Legacy Import Test"},
	{"xls/testdata/workbook.xls", AppSpreadsheet, "Merged across three columns"},
	{"ppt/testdata/deck.ppt", AppPresentation, "Speaker notes for slide two"},
}

func TestLegacyFilesOpenAsNative(t *testing.T) {
	for _, fx := range legacyFixtures {
		data := readFixture(t, fx.path)
		if got := LegacyApp(data); got != fx.app {
			t.Fatalf("%s: LegacyApp = %q, want %q", fx.path, got, fx.app)
		}
		app, ooxml, err := ConvertLegacy(data)
		if err != nil || app != fx.app || len(ooxml) < 4 || string(ooxml[:2]) != "PK" {
			t.Fatalf("%s: ConvertLegacy = %q, %d bytes, %v", fx.path, app, len(ooxml), err)
		}
		env, err := ReadNativeFile(fx.app, data, nil)
		if err != nil {
			t.Fatalf("%s: ReadNativeFile: %v", fx.path, err)
		}
		var e struct {
			Type string          `json:"type"`
			App  string          `json:"app"`
			Body json.RawMessage `json:"body"`
		}
		if err := json.Unmarshal([]byte(env), &e); err != nil {
			t.Fatalf("%s: envelope is not JSON: %v", fx.path, err)
		}
		if e.Type != envelopeType || e.App != fx.app || !strings.Contains(string(e.Body), fx.text) {
			t.Errorf("%s: envelope %s/%s lacks %q", fx.path, e.Type, e.App, fx.text)
		}
		gotApp, body, err := ImportLegacy(data)
		if err != nil || gotApp != fx.app || !strings.Contains(body, fx.text) {
			t.Errorf("%s: ImportLegacy = %q, %v", fx.path, gotApp, err)
		}
		// pictures go through the sink like any import's
		if fx.app == AppDocument {
			n := 0
			env, err := ReadNativeFile(fx.app, data, func(name string, content []byte) (string, error) {
				n++
				return "media?file=" + name, nil
			})
			if err != nil || n == 0 || strings.Contains(env, "data:image/png") {
				t.Errorf("legacy pictures should be externalized (%d, %v)", n, err)
			}
		}
	}
}

func TestLegacyFileInTheWrongApp(t *testing.T) {
	data := readFixture(t, "xls/testdata/workbook.xls")
	if _, err := ReadNativeFile(AppDocument, data, nil); err == nil || !strings.Contains(err.Error(), "Excel 97-2003") {
		t.Errorf("a workbook opened as a document: err = %v", err)
	}
	if LegacyApp([]byte("PK\x03\x04")) != "" {
		t.Error("a zip is not a legacy file")
	}
	if _, _, err := ConvertLegacy([]byte("plain text")); err == nil {
		t.Error("ConvertLegacy should refuse other files")
	}
}
