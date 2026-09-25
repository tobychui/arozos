package office

/*
	docx_marks_test.go - two rules found by round-tripping real documents:
	a paragraph mark's own formatting is not the formatting of its text, and
	a border the browser writes back as longhands is still the same border.
*/

import (
	"strconv"
	"strings"
	"testing"
)

// <w:pPr><w:rPr> formats the paragraph mark only. Google Docs writes the
// colour of the last run there, and reading it as the paragraph's colour
// painted a plain first run blue.
func TestDocxParagraphMarkDoesNotColourTheText(t *testing.T) {
	doc := parseTestDocx(t, `<w:p><w:pPr><w:rPr><w:color w:val="1155CC"/></w:rPr></w:pPr>`+
		`<w:r><w:t xml:space="preserve">plain </w:t></w:r>`+
		`<w:r><w:rPr><w:color w:val="1155CC"/></w:rPr><w:t>blue</w:t></w:r></w:p>`, nil)
	html := doc.HTML
	plain := strings.Index(html, "plain")
	blue := strings.Index(html, "blue")
	if plain < 0 || blue < 0 {
		t.Fatalf("text missing: %s", html)
	}
	// the plain run is either in a block that is not blue, or in a span
	// that sets its own colour back
	pre := html[:plain]
	if strings.Contains(pre, "1155cc") {
		span := pre[strings.LastIndex(pre, "<"):]
		if !strings.HasPrefix(span, "<span") || !strings.Contains(span, "color:") ||
			strings.Contains(span, "1155cc") {
			t.Errorf("the plain run inherits the mark's colour: %s", html)
		}
	}
	// the blue run is blue by its own span or by the block it sits in
	before := html[:blue]
	if tag := before[strings.LastIndex(before, "<"):]; strings.HasPrefix(tag, "<span") {
		if !strings.Contains(tag, "1155cc") {
			t.Errorf("the blue run lost its colour: %s", html)
		}
	} else if !strings.Contains(html[:strings.Index(html, ">")], "1155cc") {
		t.Errorf("the blue run lost its colour: %s", html)
	}
}

// An empty paragraph is as tall as its mark: that part of the mark still
// counts.
func TestDocxEmptyParagraphKeepsMarkSize(t *testing.T) {
	doc := parseTestDocx(t, `<w:p><w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:pPr></w:p>`, nil)
	if !strings.Contains(doc.HTML, "font-size:24pt") {
		t.Errorf("empty paragraph lost its mark size: %s", doc.HTML)
	}
}

func TestCssBorderSides(t *testing.T) {
	cases := []struct {
		name  string
		style string
		want  map[string]string // side -> "val sz color"
	}{
		{"shorthand", "border:1pt solid #000000", map[string]string{
			"top": "single 8 000000", "right": "single 8 000000", "bottom": "single 8 000000", "left": "single 8 000000"}},
		// what Chrome writes back for four equal side shorthands
		{"browser longhands", "border-width: 1pt; border-style: solid; border-color: rgb(0, 0, 0)", map[string]string{
			"top": "single 8 000000", "right": "single 8 000000", "bottom": "single 8 000000", "left": "single 8 000000"}},
		{"two values", "border-style: solid none; border-width: 2pt; border-color: #ff0000", map[string]string{
			"top": "single 16 FF0000", "right": "nil 16 FF0000", "bottom": "single 16 FF0000", "left": "nil 16 FF0000"}},
		{"side after shorthand", "border:1pt solid #000; border-left:3pt double #00ff00", map[string]string{
			"top": "single 8 000000", "right": "single 8 000000", "bottom": "single 8 000000", "left": "double 24 00FF00"}},
		{"per-side longhand", "border:1pt solid #000; border-bottom-color: rgb(255, 0, 0)", map[string]string{
			"top": "single 8 000000", "right": "single 8 000000", "bottom": "single 8 FF0000", "left": "single 8 000000"}},
		// a width or colour with no style is no border, as in CSS
		{"no style", "border-width: 1pt; border-color: #000", map[string]string{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := cssBorderSides(cssDecls(c.style))
			if len(got) != len(c.want) {
				t.Fatalf("sides = %v, want %v", got, c.want)
			}
			for side, want := range c.want {
				bd := got[side]
				s := bd.val + " " + strconv.Itoa(bd.sz) + " " + strings.ToUpper(bd.color)
				if s != want {
					t.Errorf("%s = %q, want %q", side, s, want)
				}
			}
		})
	}
}
