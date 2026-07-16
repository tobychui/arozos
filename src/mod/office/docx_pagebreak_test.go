package office

import (
	"strings"
	"testing"
)

func TestDocxPageBreakExport(t *testing.T) {
	doc := &Document{
		HTML: `<p>page one</p><div class="doc-pagebreak" contenteditable="false"></div><p>page two</p>`,
	}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	body := string(zipPart(t, data, "word/document.xml"))
	if !strings.Contains(body, `<w:br w:type="page"/>`) {
		t.Fatalf("document.xml has no page break, got: %s", body)
	}
	// the break must sit between the two paragraphs, not swallow their text
	iOne := strings.Index(body, "page one")
	iBr := strings.Index(body, `<w:br w:type="page"/>`)
	iTwo := strings.Index(body, "page two")
	if iOne < 0 || iTwo < 0 {
		t.Fatalf("paragraph text lost: %s", body)
	}
	if !(iOne < iBr && iBr < iTwo) {
		t.Errorf("page break out of order: one=%d br=%d two=%d", iOne, iBr, iTwo)
	}
	// the marker div must not also leak through as an empty paragraph run
	if strings.Contains(body, "doc-pagebreak") {
		t.Error("the marker class leaked into document.xml")
	}
}

func TestDocxPageBreakRoundTrip(t *testing.T) {
	doc := &Document{
		HTML: `<p>alpha</p><div class="doc-pagebreak" contenteditable="false"></div><p>beta</p>`,
	}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	back, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	if !strings.Contains(back.HTML, "doc-pagebreak") {
		t.Errorf("page break lost on import, got: %s", back.HTML)
	}
	iA := strings.Index(back.HTML, "alpha")
	iP := strings.Index(back.HTML, "doc-pagebreak")
	iB := strings.Index(back.HTML, "beta")
	if !(iA < iP && iP < iB) {
		t.Errorf("imported page break out of order: %s", back.HTML)
	}
}

func TestDocxHeaderFooterNotCentered(t *testing.T) {
	doc := &Document{
		HTML:        "<p>body</p>",
		Header:      "Introduction to Lapwing",
		Footer:      "footer text",
		PageNumbers: true,
	}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	tests := []struct{ part, want string }{
		{"word/header1.xml", "Introduction to Lapwing"},
		{"word/footer1.xml", "footer text"},
	}
	for _, tc := range tests {
		raw := string(zipPart(t, data, tc.part))
		if raw == "" {
			t.Fatalf("%s missing", tc.part)
		}
		if !strings.Contains(raw, tc.want) {
			t.Errorf("%s missing its text: %s", tc.part, raw)
		}
		// the editor renders header/footer left aligned - the export must match
		if strings.Contains(raw, `<w:jc w:val="center"/>`) {
			t.Errorf("%s is centred but the editor left aligns it: %s", tc.part, raw)
		}
	}
	// the PAGE field must survive the alignment fix
	if !strings.Contains(string(zipPart(t, data, "word/footer1.xml")), "PAGE") {
		t.Error("footer lost its page number field")
	}
}
