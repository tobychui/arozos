package docx

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

func TestDocxHeaderFooterModes(t *testing.T) {
	doc := &model.Document{HTML: "<p>x</p>", Header: "Head", Footer: "Foot",
		PageNumbers: true, HFMode: model.HFModeExceptFirst}
	data, err := Build(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	parts := officetest.UnzipParts(t, data)
	if !strings.Contains(parts["word/document.xml"], "<w:titlePg/>") {
		t.Error("except-first must set <w:titlePg/> so Word blanks page 1")
	}
	if !strings.Contains(parts["word/header1.xml"], "Head") {
		t.Error("header part missing")
	}
	// round trip: the reader recognises it again
	back, err := Parse(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	if back.HFMode != model.HFModeExceptFirst {
		t.Errorf("hfMode round trip = %q, want %q", back.HFMode, model.HFModeExceptFirst)
	}

	doc.HFMode = model.HFModeNone
	data, err = Build(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	parts = officetest.UnzipParts(t, data)
	if _, ok := parts["word/header1.xml"]; ok {
		t.Error("mode none must not write a header part")
	}
	// the page counter is its own setting and survives
	if !strings.Contains(parts["word/footer1.xml"], "PAGE") {
		t.Error("page number field lost")
	}
	if strings.Contains(parts["word/footer1.xml"], "Foot") {
		t.Error("mode none must drop the footer text")
	}
}
