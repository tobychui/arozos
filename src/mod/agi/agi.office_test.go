package agi

import (
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	user "imuslab.com/arozos/mod/user"
)

// The Office suite's backends call these by name (common/backend/document.agi
// and the apps' convert.agi); a rename or a dropped registration would only
// show as a broken save in the browser.
func TestInjectOfficeLib_JSObjectExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	g.injectOfficeLibFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "alice"}})

	present := []string{
		"saveDocument", "loadDocument", "readPayload",
		"packToFile", "unpackToWorkdir",
		"docxToDocument", "documentToDocx", "xlsxToWorkbook", "workbookToXlsx",
		"pptxToPresentation", "presentationToPptx",
		"odtToDocument", "documentToOdt", "odsToWorkbook", "workbookToOds",
		"odpToPresentation", "presentationToOdp",
		"documentToPdf", "workbookPrintToPdf", "writeBinaryFile",
		"touchWorkdir", "releaseWorkdir",
	}
	for _, fn := range present {
		val, err := vm.Run(`typeof office.` + fn)
		if err != nil {
			t.Fatalf("evaluating office.%s: %v", fn, err)
		}
		if s, _ := val.ToString(); s != "function" {
			t.Errorf("office.%s should be a function, got %q", fn, s)
		}
	}

	// the .doca-era reader is gone with the format
	val, _ := vm.Run(`typeof office.unpackFromFile`)
	if s, _ := val.ToString(); s != "undefined" {
		t.Errorf("office.unpackFromFile should no longer exist, got %q", s)
	}
}

// The workdir functions delete folders, so they may act only inside the
// suite's own working folders - never on a user's files, never by climbing
// out with "..", never on a working root itself.
func TestIsOfficeWorkdir(t *testing.T) {
	cases := []struct {
		vpath string
		want  bool
	}{
		{"tmp:/.appdata/Office/cache/k3x9a2", true},
		{"tmp:/.appdata/Office/uploads/k3x9a2/pic.png", true},
		{"tmp:/.appdata/Office/tmp/post-1.json.gz", true},
		{"tmp:/.appdata/Office/cache/k3x9a2/", true},
		{"tmp:/.appdata/Office/", false},
		{"tmp:/.appdata/Office", false},
		{"tmp:/.appdata/Other/x", false},
		{"tmp:/.appdata/Office/../../secret", false},
		{"tmp:/.appdata/Office/cache/../../../x", false},
		{"user:/.appdata/Office/cache/ab12", true}, // the old location, swept
		{"user:/.appdata/Office/uploads", false},
		{"user:/.appdata/Office/session/slides.osession", false},
		{"user:/Documents/report.docx", false},
		{`tmp:/.appdata\Office\cache\a`, true},
		{"no-root/.appdata/Office/cache/a", false},
	}
	for _, c := range cases {
		if got := isOfficeWorkdir(c.vpath); got != c.want {
			t.Errorf("isOfficeWorkdir(%q) = %v, want %v", c.vpath, got, c.want)
		}
	}
}

func TestIsOfficeWorkdirRoot(t *testing.T) {
	for vp, want := range map[string]bool{
		"tmp:/.appdata/Office/cache":       true,
		"tmp:/.appdata/Office/uploads/":    true,
		"tmp:/.appdata/Office/tmp":         true,
		"user:/.appdata/Office/cache":      true,
		"user:/.appdata/Office/uploads/":   true,
		"tmp:/.appdata/Office/cache/k3x9":  false,
		"tmp:/.appdata/Office":             false,
		"user:/.appdata/Office/session":    false,
		"user:/.appdata/Office/cache/../x": false,
	} {
		if got := isOfficeWorkdirRoot(vp); got != want {
			t.Errorf("isOfficeWorkdirRoot(%q) = %v, want %v", vp, got, want)
		}
	}
}
