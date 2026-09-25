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
