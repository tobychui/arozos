package office

import (
	"strings"
	"testing"
)

// An underline on the paragraph mark is the pilcrow's: on the block it
// would run under every character of the paragraph
func TestDocxMarkUnderlineStaysOffTheText(t *testing.T) {
	doc := parseTestDocx(t, `<w:p><w:pPr><w:rPr><w:u w:val="single"/></w:rPr></w:pPr>`+
		`<w:r><w:t>plain</w:t></w:r></w:p>`, nil)
	if strings.Contains(doc.HTML, "underline") {
		t.Errorf("the mark's underline reached the text: %s", doc.HTML)
	}
}

func TestDocxPageNumberFooter(t *testing.T) {
	body := `<w:p><w:r><w:t>text</w:t></w:r></w:p>`
	document := `<?xml version="1.0" encoding="UTF-8"?><w:document ` + wNS + `><w:body>` + body +
		`<w:sectPr><w:footerReference r:id="rIdF" w:type="default"/><w:pgSz w:w="11906" w:h="16838"/>` +
		`<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`
	// Google Docs writes the whole field in one run, with no stored result
	footer := `<?xml version="1.0" encoding="UTF-8"?><w:ftr ` + wNS + `><w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
		`<w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve">PAGE</w:instrText>` +
		`<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`
	rels := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`
	doc := parseTestDocx(t, body, map[string]string{
		"word/document.xml":            document,
		"word/footer1.xml":             footer,
		"word/_rels/document.xml.rels": rels,
	})
	if !strings.Contains(doc.FooterHTML, `data-field="PAGE"`) || !doc.PageNumbers {
		t.Errorf("footer = %q, pageNumbers = %v - the page number went missing", doc.FooterHTML, doc.PageNumbers)
	}
}

func TestDocxAutoSpacing(t *testing.T) {
	auto := `<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>`
	numbering := `<?xml version="1.0" encoding="UTF-8"?><w:numbering ` + wNS + `>` +
		`<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="` + "" + `"/>` +
		`<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum>` +
		`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
	item := func(text string) string {
		return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` + auto + `</w:pPr><w:r><w:t>` + text + `</w:t></w:r></w:p>`
	}
	plain := func(text string) string {
		return `<w:p><w:pPr>` + auto + `</w:pPr><w:r><w:t>` + text + `</w:t></w:r></w:p>`
	}
	doc := parseTestDocx(t, item("one")+item("two")+plain("after")+plain("again"),
		map[string]string{"word/numbering.xml": numbering})
	html := doc.HTML
	// list items sit close together, as a browser sets <li>s
	li := html[strings.Index(html, "<li"):strings.Index(html, "</ul>")]
	if strings.Contains(li, "14pt") {
		t.Errorf("auto spacing between list items: %s", li)
	}
	// the Symbol bullet comes in as the bullet it draws
	if strings.Contains(html, "") || !strings.Contains(html, `data-lvltext="`+"•"+`"`) {
		t.Errorf("bullet glyph not mapped: %s", html)
	}
	// two auto-spaced paragraphs share one auto space
	again := html[strings.LastIndex(html[:strings.Index(html, "again")], "<p"):]
	if strings.Contains(again[:strings.Index(again, ">")], "padding-top:14pt") {
		t.Errorf("auto spacing was added twice: %s", again)
	}
}

func TestDocxProportionalCJKPunctuation(t *testing.T) {
	tests := []struct {
		name string
		rPr  string
		text string
		want bool
	}{
		{"CJK in a Latin font falls back proportionally", `<w:rFonts w:ascii="Calibri" w:eastAsia="Calibri"/>`, "題目：成效", true},
		{"CJK in a CJK font keeps full-width punctuation", `<w:rFonts w:ascii="Calibri" w:eastAsia="PMingLiU"/>`, "題目：成效", false},
		{"Latin text is left alone", `<w:rFonts w:ascii="Calibri"/>`, "plain", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			doc := parseTestDocx(t, `<w:p><w:pPr><w:rPr>`+tc.rPr+`</w:rPr></w:pPr><w:r><w:rPr>`+tc.rPr+`</w:rPr><w:t>`+tc.text+`</w:t></w:r></w:p>`, nil)
			if got := strings.Contains(doc.HTML, "palt"); got != tc.want {
				t.Errorf("palt = %v, want %v: %s", got, tc.want, doc.HTML)
			}
		})
	}
	if !hasCJK("中文") || hasCJK("Latin") || !isCJKFontName("新細明體") || !isCJKFontName("MS PGothic") || isCJKFontName("Calibri") {
		t.Error("hasCJK / isCJKFontName")
	}
}
