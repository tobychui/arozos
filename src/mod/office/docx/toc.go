package docx

/*
	A table of contents

	The editor keeps a table of contents as ordinary paragraphs: a title
	(p.doc-toc.doc-toc-title) and one line per heading (p.doc-toc with
	data-toc-level, the heading's text, a right tab with a dot leader and
	the page number). That is what Word holds once its TOC field has been
	updated, so the writer wraps a run of those lines in the same frame
	Word does - a Table of Contents building-block control with a TOC
	field around the entries - and Word offers its own Update Table on
	it. The lines use Word's style names (TOC Heading, toc 1..9), which
	is how the reader recognises a table of contents Word wrote.
*/

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"

	"imuslab.com/arozos/mod/office/internal/htmlutil"
)

// tocHeadingStyle is Word's style id of a table of contents' title
const tocHeadingStyle = "TOCHeading"

const (
	tocSdtOpen  = `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>`
	tocSdtEnd   = `</w:sdtContent></w:sdt>`
	tocFieldEnd = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
)

// tocField is what a table's TOC field says: the heading levels it lists
// and whether its entries carry page numbers
type tocField struct {
	from, to int
	noPages  bool
}

// tocFieldBegin opens the field: the headings the table lists, as
// hyperlinks, without tab leaders or page numbers in Web view, keeping
// outline levels (and no page numbers at all when the table shows none)
func tocFieldBegin(f tocField) string {
	instr := ` TOC \o "` + strconv.Itoa(f.from) + `-` + strconv.Itoa(f.to) + `" \h \z \u `
	if f.noPages {
		instr += `\n `
	}
	return `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
		`<w:r><w:instrText xml:space="preserve">` + instr + `</w:instrText></w:r>` +
		`<w:r><w:fldChar w:fldCharType="separate"/></w:r>`
}

// tocCfg is the look the editor stores on every entry (data-toc-cfg)
type tocCfg struct {
	PageNumbers *bool `json:"pn"`
	Levels      []int `json:"lv"`
}

// tocFieldOf reads the field of the table whose entries start at c: the
// editor's data-toc-cfg, else data-toc-max (an imported field's range),
// else Heading 1-3
func tocFieldOf(c *html.Node) tocField {
	f := tocField{from: 1, to: 3}
	max := 0
	for n := c; isTocEntry(n); n = nextBlockSibling(n) {
		var cfg tocCfg
		if raw := htmlutil.Attr(n, "data-toc-cfg"); raw != "" && json.Unmarshal([]byte(raw), &cfg) == nil {
			lo, hi := 0, 0
			for _, l := range cfg.Levels {
				if l < 1 || l > 9 {
					continue
				}
				if lo == 0 || l < lo {
					lo = l
				}
				if l > hi {
					hi = l
				}
			}
			if lo > 0 {
				f.from, f.to = lo, hi
			}
			f.noPages = cfg.PageNumbers != nil && !*cfg.PageNumbers
			return f
		}
		if v, err := strconv.Atoi(htmlutil.Attr(n, "data-toc-max")); err == nil && v > max {
			max = v
		}
	}
	if max >= 1 {
		f.to = max
		if f.to > 9 {
			f.to = 9
		}
	}
	return f
}

// isTocPara reports a line of a table of contents (title or entry)
func isTocPara(n *html.Node) bool {
	return n != nil && n.Type == html.ElementNode && n.Data == "p" && hasClass(n, "doc-toc")
}

// isTocEntry reports a line that lists a heading (not the title)
func isTocEntry(n *html.Node) bool {
	return isTocPara(n) && !hasClass(n, "doc-toc-title")
}

// tocStyleOf names the Word paragraph style of a table of contents line
func tocStyleOf(n *html.Node) string {
	if hasClass(n, "doc-toc-title") {
		return tocHeadingStyle
	}
	lvl, err := strconv.Atoi(htmlutil.Attr(n, "data-toc-level"))
	if err != nil || lvl < 1 {
		lvl = 1
	} else if lvl > 9 {
		lvl = 9
	}
	return fmt.Sprintf("TOC%d", lvl)
}

// nextBlockSibling is the element after n, past whitespace and comments
func nextBlockSibling(n *html.Node) *html.Node {
	for c := n.NextSibling; c != nil; c = c.NextSibling {
		switch c.Type {
		case html.TextNode:
			if strings.TrimSpace(c.Data) != "" {
				return c
			}
		case html.ElementNode:
			return c
		}
	}
	return nil
}

// tocRun tracks one table of contents while blocks writes its lines
type tocRun struct {
	open  bool // inside the building-block control
	field bool // inside the TOC field
}

// before is called ahead of every block: it opens the control at a
// table's first line and hands the paragraph writer the field's begin
// (first entry) and end (last entry)
func (t *tocRun) before(c *html.Node, sb *strings.Builder, b *docxBuilder) {
	if !isTocPara(c) {
		return
	}
	if !t.open {
		sb.WriteString(tocSdtOpen)
		t.open = true
	}
	if !isTocEntry(c) {
		return
	}
	if !t.field {
		b.paraPre = tocFieldBegin(tocFieldOf(c))
		t.field = true
	}
	if !isTocEntry(nextBlockSibling(c)) {
		b.paraPost = tocFieldEnd
		t.field = false
	}
}

// close ends the control after a table's last line
func (t *tocRun) close(sb *strings.Builder) {
	if !t.open {
		return
	}
	if t.field {
		// never left open: Word refuses a field that does not end
		sb.WriteString(`<w:p>` + tocFieldEnd + `</w:p>`)
		t.field = false
	}
	sb.WriteString(tocSdtEnd)
	t.open = false
}

/* ---------------- reading ----------------

   Word styles its entries "toc 1".."toc 9" (tocLevel). Google Docs uses
   no style at all: its entries are known only by sitting in the result of
   a TOC field, each a link to the heading it lists. Such an entry gets its
   level from that heading once the whole body is read (resolveTocLevels). */

// tocLevelUnknown marks an entry whose level is not known yet
const tocLevelUnknown = 99

// tocFieldOpen reports a TOC field whose result is being read
func (cv *docxConv) tocFieldOpen() bool {
	for _, f := range cv.fields {
		if f.inResult && isTocInstr(f.instr) {
			return true
		}
	}
	return false
}

// isTocInstr reports a TOC field instruction (upper-cased by the reader)
func isTocInstr(instr string) bool {
	w := strings.Fields(instr)
	return len(w) > 0 && strings.EqualFold(w[0], "TOC")
}

var (
	tocOutlineSwitch = regexp.MustCompile(`(?i)\\o\s*"\s*(\d+)\s*-\s*(\d+)\s*"`)
	tocStylesSwitch  = regexp.MustCompile(`(?i)\\t\s*"([^"]*)"`)
	tocHeadingName   = regexp.MustCompile(`(?i)^\s*heading\s*(\d)\s*$`)
)

// tocInstrMaxLevel reads the deepest heading a TOC field lists: the end of
// its outline range (\o "1-3") or the deepest "Heading N" its style list
// names (\t "Heading 1,1,Heading 2,2,"); 3 when it says neither, as the
// editor's own table does
func tocInstrMaxLevel(instr string) int {
	max := 0
	if m := tocOutlineSwitch.FindStringSubmatch(instr); m != nil {
		if n, err := strconv.Atoi(m[2]); err == nil {
			max = n
		}
	}
	if m := tocStylesSwitch.FindStringSubmatch(instr); m != nil {
		parts := strings.Split(m[1], ",")
		for i := 0; i < len(parts); i += 2 {
			if h := tocHeadingName.FindStringSubmatch(parts[i]); h != nil {
				if n, _ := strconv.Atoi(h[1]); n > max {
					max = n
				}
			}
		}
	}
	if max < 1 {
		return 3
	}
	if max > 6 {
		return 6
	}
	return max
}

// looksLikeTocEntry tells an entry of a TOC field's result from the empty
// paragraph Word ends the field in: it has text, and a page number after
// a tab or a link to its heading
func looksLikeTocEntry(inner string) bool {
	if strings.TrimSpace(stripTags(inner)) == "" {
		return false
	}
	return strings.Contains(inner, "doc-tab") || strings.Contains(inner, `href="#`)
}

var (
	tocUnresolvedEntry = regexp.MustCompile(`<p\s[^>]*\bclass="doc-toc"[^>]*>`)
	tocEntryLink       = regexp.MustCompile(`href="#([^"]+)"`)
	headingWithID      = regexp.MustCompile(`<h([1-6])\b[^>]*\bid="([^"]+)"`)
)

// resolveTocLevels gives each table of contents entry that has no level
// the level of the heading its link points at
func resolveTocLevels(body string) string {
	if !strings.Contains(body, `class="doc-toc"`) {
		return body
	}
	levels := map[string]string{}
	for _, m := range headingWithID.FindAllStringSubmatch(body, -1) {
		levels[m[2]] = m[1]
	}
	var sb strings.Builder
	last := 0
	for _, loc := range tocUnresolvedEntry.FindAllStringIndex(body, -1) {
		tag := body[loc[0]:loc[1]]
		if strings.Contains(tag, "data-toc-level=") {
			continue
		}
		end := strings.Index(body[loc[1]:], "</p>")
		if end < 0 {
			continue
		}
		link := tocEntryLink.FindStringSubmatch(body[loc[1] : loc[1]+end])
		if link == nil {
			continue
		}
		lvl, ok := levels[link[1]]
		if !ok {
			continue
		}
		sb.WriteString(body[last : loc[1]-1])
		sb.WriteString(` data-toc-level="` + lvl + `">`)
		last = loc[1]
	}
	if last == 0 {
		return body
	}
	sb.WriteString(body[last:])
	return sb.String()
}

// tocStyleLevel reports which table of contents line a paragraph style
// is: 1-9 for "toc 1".."toc 9", -1 for "TOC Heading", 0 for none
func tocStyleLevel(id, name string) int {
	n := strings.ToLower(id)
	if name != "" {
		n = strings.ToLower(name)
	}
	compact := strings.ReplaceAll(n, " ", "")
	switch {
	case compact == "tocheading":
		return -1
	case len(compact) == 4 && strings.HasPrefix(compact, "toc") && compact[3] >= '1' && compact[3] <= '9':
		return int(compact[3] - '0')
	}
	return 0
}

// tocLevel reports the table of contents line a paragraph style is,
// nearest style first: "TOC Heading" is based on Heading 1 in Word, and
// is a title, not a heading
func (ss *docxStyleSheet) tocLevel(id string) int {
	if id == "" {
		return 0
	}
	chain := ss.chain(id)
	for i := len(chain) - 1; i >= 0; i-- {
		if lvl := tocStyleLevel(chain[i].id, chain[i].name); lvl != 0 {
			return lvl
		}
	}
	if len(chain) == 0 {
		return tocStyleLevel(id, "")
	}
	return 0
}
