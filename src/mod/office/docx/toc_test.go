package docx

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

const tocTestHTML = `<p class="doc-toc doc-toc-title" style="font-size:16pt;margin-bottom:6pt;">Contents</p>` +
	`<p class="doc-toc" data-toc-level="1" data-tabs="right:451.3:dot" style="margin-left:0pt;margin-bottom:3pt;">Intro<span class="doc-tab"></span>2</p>` +
	`<p class="doc-toc" data-toc-level="2" data-tabs="right:451.3:dot" style="margin-left:14pt;margin-bottom:3pt;">Scope<span class="doc-tab"></span>3</p>` +
	`<p>After the table</p><h1>Intro</h1><p>text</p><h2>Scope</h2>`

func buildTocDocx(t *testing.T, html string) (body, styles string) {
	t.Helper()
	data, err := Build(&model.Document{HTML: html})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	return string(officetest.ZipPart(t, data, "word/document.xml")), string(officetest.ZipPart(t, data, "word/styles.xml"))
}

func TestDocxTocExport(t *testing.T) {
	body, styles := buildTocDocx(t, tocTestHTML)
	order := []string{
		`<w:docPartGallery w:val="Table of Contents"/>`,
		`<w:pStyle w:val="TOCHeading"/>`, "Contents",
		`<w:pStyle w:val="TOC1"/>`, `w:fldCharType="begin"`, `TOC \o "1-3" \h \z \u`, `w:fldCharType="separate"`, "Intro",
		`<w:pStyle w:val="TOC2"/>`, "Scope", `w:fldCharType="end"`,
		`</w:sdtContent></w:sdt>`, "After the table",
	}
	at := 0
	for _, want := range order {
		i := strings.Index(body[at:], want)
		if i < 0 {
			t.Fatalf("missing or out of order: %q after offset %d in %s", want, at, body)
		}
		at += i + len(want)
	}
	for _, want := range []string{"<w:sdt>", `w:fldCharType="begin"`, `w:fldCharType="end"`} {
		if n := strings.Count(body, want); n != 1 {
			t.Errorf("%q written %d times, want once", want, n)
		}
	}
	for _, want := range []string{`w:styleId="TOCHeading"`, `<w:name w:val="TOC Heading"/>`, `w:styleId="TOC1"`, `<w:name w:val="toc 2"/>`} {
		if !strings.Contains(styles, want) {
			t.Errorf("styles.xml lacks %s", want)
		}
	}
	if strings.Contains(body, "doc-toc") {
		t.Error("the editor class leaked into document.xml")
	}
}

func TestDocxTocFieldEdges(t *testing.T) {
	tests := []struct {
		name               string
		html               string
		sdts, begins, ends int
	}{
		{"one entry opens and closes the field", `<p class="doc-toc" data-toc-level="1">Only<span class="doc-tab"></span>1</p>`, 1, 1, 1},
		{"title alone has no field", `<p class="doc-toc doc-toc-title">Contents</p><p>x</p>`, 1, 0, 0},
		{"two tables are two controls", `<p class="doc-toc" data-toc-level="1">A</p><p>gap</p><p class="doc-toc" data-toc-level="1">B</p>`, 2, 2, 2},
		{"no table, no control", `<p>plain</p><h1>Head</h1>`, 0, 0, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, _ := buildTocDocx(t, tc.html)
			if n := strings.Count(body, "<w:sdt>"); n != tc.sdts {
				t.Errorf("sdt count = %d, want %d", n, tc.sdts)
			}
			if n := strings.Count(body, "</w:sdt>"); n != tc.sdts {
				t.Errorf("sdt end count = %d, want %d", n, tc.sdts)
			}
			if n := strings.Count(body, `w:fldCharType="begin"`); n != tc.begins {
				t.Errorf("field begins = %d, want %d", n, tc.begins)
			}
			if n := strings.Count(body, `w:fldCharType="end"`); n != tc.ends {
				t.Errorf("field ends = %d, want %d", n, tc.ends)
			}
		})
	}
}

func TestDocxTocRoundTrip(t *testing.T) {
	data, err := Build(&model.Document{HTML: tocTestHTML})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	back, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	h := back.HTML
	for _, want := range []string{`class="doc-toc doc-toc-title"`, `data-toc-level="1"`, `data-toc-level="2"`, "Scope"} {
		if !strings.Contains(h, want) {
			t.Errorf("round trip lost %s: %s", want, h)
		}
	}
	if strings.Contains(h, `TOC \o`) || strings.Contains(h, "TOC \\O") {
		t.Errorf("field instruction leaked into the text: %s", h)
	}
	// the title is a line of the table, not a heading it would list
	if strings.Count(h, "<h1") != 1 {
		t.Errorf("want only the document's own Heading 1, got: %s", h)
	}
}

// a table of contents as Word writes it: TOC Heading based on Heading 1,
// hyperlinked entries with PAGEREF page numbers
func TestDocxReadsWordToc(t *testing.T) {
	styles := `<?xml version="1.0" encoding="UTF-8"?><w:styles ` + wNS + `>` +
		`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
		`<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>` +
		`<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>` +
		`<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style>` +
		`<w:style w:type="paragraph" w:styleId="MyToc2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/></w:style>` +
		`</w:styles>`
	body := `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>` +
		`<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Table of Contents</w:t></w:r></w:p>` +
		`<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs></w:pPr>` +
		`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
		`<w:hyperlink w:anchor="_Toc1"><w:r><w:t>Chapter One</w:t></w:r><w:r><w:tab/></w:r>` +
		`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>4</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>` +
		`<w:p><w:pPr><w:pStyle w:val="MyToc2"/></w:pPr><w:r><w:t>Part A</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>5</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
		`</w:sdtContent></w:sdt>` +
		`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>`
	doc := parseTestDocx(t, body, map[string]string{"word/styles.xml": styles})
	h := doc.HTML
	for _, want := range []string{`class="doc-toc doc-toc-title"`, `data-toc-level="1"`, `data-toc-level="2"`, "Chapter One", ">4<", "Part A"} {
		if !strings.Contains(h, want) {
			t.Errorf("Word table of contents lost %s: %s", want, h)
		}
	}
	if strings.Count(h, "<h1") != 1 {
		t.Errorf("TOC Heading must not read as a heading: %s", h)
	}
	if strings.Contains(h, "PAGEREF") {
		t.Errorf("field instruction leaked into the text: %s", h)
	}
}

func TestTocStyleLevel(t *testing.T) {
	tests := []struct {
		id, name string
		want     int
	}{
		{"TOC1", "toc 1", 1},
		{"TOC3", "", 3},
		{"Custom", "toc 9", 9},
		{"TOCHeading", "TOC Heading", -1},
		{"TOCHeading", "", -1},
		{"Heading1", "heading 1", 0},
		{"TOC10", "", 0},
		{"Normal", "Normal", 0},
		{"TOC", "", 0},
	}
	for _, tc := range tests {
		if got := tocStyleLevel(tc.id, tc.name); got != tc.want {
			t.Errorf("tocStyleLevel(%q, %q) = %d, want %d", tc.id, tc.name, got, tc.want)
		}
	}
}

// a table of contents as Google Docs exports it: no TOC styles, only a TOC
// field listing Heading 1-6 whose entries link to the headings' bookmarks,
// and a "Table of Contents" Heading 3 above the control
func TestDocxReadsGoogleDocsToc(t *testing.T) {
	entry := func(anchor, text, page string, first, last bool) string {
		s := `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="none" w:pos="9025"/></w:tabs></w:pPr>`
		if first {
			s += `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC \h \u \z \t &quot;Heading 1,1,Heading 2,2,Heading 3,3,Heading 4,4,Heading 5,5,Heading 6,6,&quot;</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>`
		}
		s += `<w:hyperlink w:anchor="` + anchor + `"><w:r><w:t>` + text + `</w:t></w:r></w:hyperlink><w:r><w:tab/></w:r>` +
			`<w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGEREF ` + anchor + ` \h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>` + page + `</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
		if last {
			s += `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
		}
		return s + `</w:p>`
	}
	heading := func(style, anchor, text string) string {
		return `<w:p><w:pPr><w:pStyle w:val="` + style + `"/></w:pPr><w:bookmarkStart w:id="1" w:name="` + anchor + `"/><w:bookmarkEnd w:id="1"/><w:r><w:t>` + text + `</w:t></w:r></w:p>`
	}
	styles := `<?xml version="1.0" encoding="UTF-8"?><w:styles ` + wNS + `>` +
		`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
		`<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>` +
		`<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/></w:style>` +
		`<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/></w:style>` +
		`</w:styles>`
	body := heading("Heading3", "_toc", "Table of Contents") +
		`<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique w:val="1"/></w:docPartObj></w:sdtPr><w:sdtContent>` +
		entry("_a", "Overview", "1", true, false) +
		entry("_b", "Goals", "2", false, false) +
		entry("_c", "Minimal", "3", false, true) +
		`</w:sdtContent></w:sdt>` +
		`<w:p><w:r><w:t>Body text</w:t></w:r></w:p>` +
		heading("Heading2", "_a", "Overview") + heading("Heading3", "_b", "Goals") + heading("Heading4", "_c", "Minimal")
	h := parseTestDocx(t, body, map[string]string{"word/styles.xml": styles}).HTML
	if n := strings.Count(h, `class="doc-toc"`); n != 3 {
		t.Fatalf("want 3 entries, got %d: %s", n, h)
	}
	for _, want := range []string{`data-toc-level="2"`, `data-toc-level="3"`, `data-toc-level="4"`, `data-toc-max="6"`} {
		if !strings.Contains(h, want) {
			t.Errorf("entry attributes lack %s: %s", want, h)
		}
	}
	// the heading above the control is a heading of the document, and the
	// paragraphs after the field are no entries
	if !strings.Contains(h, ">Table of Contents</h3>") {
		t.Errorf("the Heading 3 title must stay a heading: %s", h)
	}
	if i := strings.Index(h, "Body text"); i < 0 || strings.Contains(h[i-80:i], "doc-toc") {
		t.Errorf("text after the field read as an entry: %s", h)
	}
}

func TestDocxTocFieldLevelRange(t *testing.T) {
	tests := []struct {
		html, want string
	}{
		{`<p class="doc-toc" data-toc-level="2">A</p>`, `TOC \o "1-3"`},
		{`<p class="doc-toc" data-toc-level="2" data-toc-max="6">A</p><p class="doc-toc" data-toc-level="5" data-toc-max="6">B</p>`, `TOC \o "1-6"`},
	}
	for _, tc := range tests {
		body, _ := buildTocDocx(t, tc.html)
		if !strings.Contains(body, tc.want) {
			t.Errorf("%s: want %s in %s", tc.html, tc.want, body)
		}
	}
}

func TestTocInstrMaxLevel(t *testing.T) {
	tests := []struct {
		instr string
		want  int
	}{
		{`TOC \O "1-3" \H \Z \U`, 3},
		{`TOC \o "1-4"`, 4},
		{`TOC \H \U \Z \T "HEADING 1,1,HEADING 2,2,HEADING 3,3,HEADING 4,4,HEADING 5,5,HEADING 6,6,"`, 6},
		{`TOC \T "MY STYLE,1,HEADING 2,2"`, 2},
		{`TOC \H \Z`, 3},
		{`TOC \O "1-9"`, 6},
	}
	for _, tc := range tests {
		if got := tocInstrMaxLevel(tc.instr); got != tc.want {
			t.Errorf("tocInstrMaxLevel(%q) = %d, want %d", tc.instr, got, tc.want)
		}
	}
}

func TestResolveTocLevels(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"by link", `<p class="doc-toc" style="x"><a href="#_a">A</a></p><h2 id="_a">A</h2>`, `<p class="doc-toc" style="x" data-toc-level="2">`},
		{"level kept", `<p class="doc-toc" data-toc-level="1"><a href="#_a">A</a></p><h4 id="_a">A</h4>`, `data-toc-level="1">`},
		{"no target", `<p class="doc-toc"><a href="#_zz">A</a></p><h2 id="_a">A</h2>`, `<p class="doc-toc"><a`},
		{"no toc", `<p>x</p>`, `<p>x</p>`},
	}
	for _, tc := range tests {
		if got := resolveTocLevels(tc.in); !strings.Contains(got, tc.want) {
			t.Errorf("%s: got %s, want it to contain %s", tc.name, got, tc.want)
		}
	}
}
