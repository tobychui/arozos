package opc

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestPackageWritesContentTypesAndParts(t *testing.T) {
	p := New()
	var rels Rels
	id1 := rels.Add(RelOfficeDocument, "word/document.xml", false)
	id2 := rels.Add(RelHyperlink, "https://arozos.com/?a=1&b=2", true)
	if id1 != "rId1" || id2 != "rId2" || rels.Len() != 2 {
		t.Fatalf("ids = %s %s", id1, id2)
	}
	p.AddXML("_rels/.rels", "", rels.XML())
	p.AddXML("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", "<w:document/>")
	p.Add("word/media/image1.png", "", []byte("\x89PNG"))
	p.Add("word/media/image2.emf", "", []byte{1, 0, 0, 0})
	data, err := p.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if zr.File[0].Name != "[Content_Types].xml" {
		t.Errorf("first part is %s", zr.File[0].Name)
	}
	parts := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		parts[f.Name] = string(b)
	}
	ct := parts["[Content_Types].xml"]
	for _, want := range []string{
		`<Default Extension="png" ContentType="image/png"/>`,
		`<Default Extension="emf" ContentType="image/x-emf"/>`,
		`<Default Extension="rels"`,
		`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
	} {
		if !strings.Contains(ct, want) {
			t.Errorf("content types miss %s", want)
		}
	}
	r := parts["_rels/.rels"]
	if !strings.Contains(r, `Target="https://arozos.com/?a=1&amp;b=2" TargetMode="External"`) {
		t.Errorf("external relationship not escaped / flagged: %s", r)
	}
	if !strings.HasPrefix(parts["word/document.xml"], "<?xml") {
		t.Error("AddXML should add the declaration")
	}
}

func TestRelsPath(t *testing.T) {
	tests := map[string]string{
		"word/document.xml":        "word/_rels/document.xml.rels",
		"/ppt/slides/slide1.xml":   "ppt/slides/_rels/slide1.xml.rels",
		"xl/worksheets/sheet2.xml": "xl/worksheets/_rels/sheet2.xml.rels",
	}
	for in, want := range tests {
		if got := RelsPath(in); got != want {
			t.Errorf("RelsPath(%q) = %q, want %q", in, got, want)
		}
	}
}
