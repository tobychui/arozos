package odf

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

func TestOdtHeaderFooterModes(t *testing.T) {
	doc := &model.Document{HTML: "<p>x</p>", Header: "Head", Footer: "Foot",
		HFMode: model.HFModeExceptFirst}
	data, err := BuildOdt(doc)
	if err != nil {
		t.Fatalf("BuildOdt: %v", err)
	}
	styles := officetest.UnzipParts(t, data)["styles.xml"]
	for _, want := range []string{"<style:header>", "<style:header-first>",
		"<style:footer-first>"} {
		if !strings.Contains(styles, want) {
			t.Errorf("styles.xml missing %s", want)
		}
	}
	back, err := ParseOdt(data)
	if err != nil {
		t.Fatalf("ParseOdt: %v", err)
	}
	if back.HFMode != model.HFModeExceptFirst {
		t.Errorf("hfMode round trip = %q, want %q", back.HFMode, model.HFModeExceptFirst)
	}

	doc.HFMode = model.HFModeNone
	data, err = BuildOdt(doc)
	if err != nil {
		t.Fatalf("BuildOdt: %v", err)
	}
	if styles := officetest.UnzipParts(t, data)["styles.xml"]; strings.Contains(styles, "Head") {
		t.Error("mode none must not write header text")
	}
}
