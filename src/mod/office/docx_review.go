package office

/*
	docx_review.go - comments and suggested edits, in Word's own terms.

	The Docs editor keeps review state inline in its HTML:

	    <span class="doc-cmt" data-cid="ID">anchored text</span>
	    <ins class="doc-ins">suggested insertion</ins>
	    <del class="doc-del">suggested deletion</del>

	with the comment bodies in body.comments ([{id, text, at, resolved}]) and
	"Suggest edits" in body.trackChanges. Word has the same three things:
	comment ranges pointing into word/comments.xml (resolved state in
	commentsExtended.xml), and <w:ins> / <w:del> revision marks. This file
	maps one onto the other in both directions, so a document reviewed in
	either program arrives with its review intact in the other.

	Edges that Word cannot express are resolved the way the editor's own
	"accept" would: a deletion of text that is itself a suggested insertion
	simply disappears, and a revision around a hyperlink or a field (which
	WordprocessingML does not allow) is written as plain accepted text.
*/

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// reviewAuthor is the name comments and revisions are written under: the
// editor does not record who made them
const reviewAuthor = "ArozOS Office"

// annotation id ranges, apart from each other and from bookmarks (1..n)
const (
	commentIDBase  = 50000
	revisionIDBase = 100000
)

// DocComment is one review comment (body.comments in the Docs schema)
type DocComment struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	At       int64  `json:"at,omitempty"` // ms since the epoch
	Resolved bool   `json:"resolved,omitempty"`
}

/* ---------------- writing ---------------- */

func isReviewWrapper(n *html.Node) bool {
	if n.Type != html.ElementNode {
		return false
	}
	switch n.Data {
	case "ins":
		return hasClass(n, "doc-ins")
	case "del":
		return hasClass(n, "doc-del")
	case "span":
		return hasClass(n, "doc-cmt")
	}
	return false
}

// a block a review wrapper can be pushed down into
func reviewPushable(n *html.Node) bool {
	switch n.Data {
	case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "ul", "ol":
		return true
	}
	return false
}

// holdsBlock: the writer's own notion of a block (isBlockElement)
func holdsBlock(n *html.Node) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if isBlockElement(c) {
			return true
		}
	}
	return false
}

func cloneShallow(n *html.Node) *html.Node {
	attrs := make([]html.Attribute, len(n.Attr))
	copy(attrs, n.Attr)
	return &html.Node{Type: n.Type, Data: n.Data, DataAtom: n.DataAtom, Attr: attrs}
}

/*
liftReviewWrappers pushes a review wrapper that holds whole paragraphs
(a suggestion pasted as several blocks, a comment across two paragraphs)
down into each of them, so every piece ends up inline where a run can
carry it: <ins><p>a</p><p>b</p></ins> becomes <p><ins>a</ins></p><p><ins>b</ins></p>.
A comment split this way keeps one id, which is what makes its range run
from the first piece to the last.
*/
func liftReviewWrappers(n *html.Node) {
	for c := n.FirstChild; c != nil; {
		next := c.NextSibling
		if isReviewWrapper(c) && holdsBlock(c) {
			liftOne(c)
		}
		c = next
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		liftReviewWrappers(c)
	}
}

func liftOne(w *html.Node) {
	parent := w.Parent
	var run *html.Node // the clone collecting consecutive inline children
	for c := w.FirstChild; c != nil; {
		next := c.NextSibling
		w.RemoveChild(c)
		if isBlockElement(c) {
			run = nil
			if reviewPushable(c) {
				inner := cloneShallow(w)
				for g := c.FirstChild; g != nil; {
					gn := g.NextSibling
					c.RemoveChild(g)
					inner.AppendChild(g)
					g = gn
				}
				c.AppendChild(inner)
			}
			parent.InsertBefore(c, w)
		} else {
			if run == nil {
				run = cloneShallow(w)
				parent.InsertBefore(run, w)
			}
			run.AppendChild(c)
		}
		c = next
	}
	parent.RemoveChild(w)
}

// countComments records how many pieces each comment anchor has
func (b *docxBuilder) countComments(n *html.Node) {
	if n.Type == html.ElementNode && n.Data == "span" && hasClass(n, "doc-cmt") {
		if cid := htmlAttr(n, "data-cid"); cid != "" {
			b.cmtTotal[cid]++
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		b.countComments(c)
	}
}

// numberComments gives every anchored comment its Word id
func (b *docxBuilder) numberComments() {
	for _, c := range b.doc.Comments {
		if c == nil || b.cmtTotal[c.ID] == 0 {
			continue
		}
		if _, dup := b.cmtWordID[c.ID]; dup {
			continue
		}
		b.cmtWordID[c.ID] = commentIDBase + len(b.cmtOrder)
		b.cmtOrder = append(b.cmtOrder, c)
	}
}

func (b *docxBuilder) inlineChildren(n *html.Node, rs wRunStyle, part *docxPart, rb *runBuf) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if isBlockElement(c) {
			continue
		}
		b.inline(c, rs, part, rb)
	}
}

var wTextOpenRe = regexp.MustCompile(`<w:t(\s[^>]*)?>`)

// asDeleted turns runs into deleted runs (w:t -> w:delText)
func asDeleted(runs string) string {
	runs = wTextOpenRe.ReplaceAllString(runs, `<w:delText$1>`)
	return strings.ReplaceAll(runs, "</w:t>", "</w:delText>")
}

// reviewInline writes an inline review wrapper; false = not one of ours
func (b *docxBuilder) reviewInline(n *html.Node, rs wRunStyle, part *docxPart, rb *runBuf) bool {
	if !isReviewWrapper(n) {
		return false
	}
	crs := rs.applyCSS(cssDecls(htmlAttr(n, "style")))
	if n.Data == "span" {
		cid := htmlAttr(n, "data-cid")
		id, ok := b.cmtWordID[cid]
		if !ok {
			return false // an anchor without a comment: an ordinary span
		}
		b.cmtSeen[cid]++
		if b.cmtSeen[cid] == 1 {
			rb.sb.WriteString(fmt.Sprintf(`<w:commentRangeStart w:id="%d"/>`, id))
		}
		b.inlineChildren(n, crs, part, rb)
		if b.cmtSeen[cid] == b.cmtTotal[cid] {
			rb.sb.WriteString(fmt.Sprintf(`<w:commentRangeEnd w:id="%d"/><w:r><w:commentReference w:id="%d"/></w:r>`, id, id))
			rb.any = true
		}
		return true
	}

	del := n.Data == "del"
	if b.inRev {
		// nested: a deletion of suggested text is simply gone, an insertion
		// inside a revision is part of it already
		if !del {
			b.inlineChildren(n, crs, part, rb)
		}
		return true
	}
	inner := &runBuf{}
	b.inRev = true
	b.inlineChildren(n, crs, part, inner)
	b.inRev = false
	if !inner.any {
		return true
	}
	x := inner.sb.String()
	if strings.Contains(x, "<w:hyperlink") || strings.Contains(x, "<w:fldSimple") {
		// WordprocessingML allows neither inside a revision mark
		if !del {
			rb.sb.WriteString(x)
			rb.any = true
		}
		return true
	}
	tag := "w:ins"
	if del {
		tag = "w:del"
		x = asDeleted(x)
	}
	b.revID++
	rb.sb.WriteString(fmt.Sprintf(`<%s w:id="%d" w:author="%s">`, tag, revisionIDBase+b.revID, reviewAuthor))
	rb.sb.WriteString(x)
	rb.sb.WriteString(`</` + tag + `>`)
	rb.any = true
	return true
}

// commentDate formats an editor timestamp the way w:date wants it
func commentDate(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05Z")
}

// commentParaID is the w14:paraId of a comment's last paragraph, which is
// how commentsExtended.xml says the comment is resolved
func commentParaID(i int) string {
	return fmt.Sprintf("%08X", 0x10000000+i)
}

// commentsXML renders word/comments.xml and, when any comment is resolved,
// word/commentsExtended.xml ("" when not needed)
func (b *docxBuilder) commentsXML() (string, string) {
	if len(b.cmtOrder) == 0 {
		return "", ""
	}
	var sb, ext strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
		`xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">`)
	anyResolved := false
	for i, c := range b.cmtOrder {
		date := ""
		if d := commentDate(c.At); d != "" {
			date = ` w:date="` + d + `"`
		}
		sb.WriteString(fmt.Sprintf(`<w:comment w:id="%d" w:author="%s"%s w:initials="AO">`,
			b.cmtWordID[c.ID], reviewAuthor, date))
		lines := strings.Split(strings.ReplaceAll(c.Text, "\r\n", "\n"), "\n")
		for j, line := range lines {
			pid := ""
			if j == len(lines)-1 {
				pid = ` w14:paraId="` + commentParaID(i) + `"`
			}
			sb.WriteString(`<w:p` + pid + `>`)
			if j == 0 {
				sb.WriteString(`<w:r><w:annotationRef/></w:r>`)
			}
			if line != "" {
				sb.WriteString(`<w:r><w:t xml:space="preserve">` + xmlEscape(line) + `</w:t></w:r>`)
			}
			sb.WriteString(`</w:p>`)
		}
		sb.WriteString(`</w:comment>`)
		if c.Resolved {
			anyResolved = true
		}
	}
	sb.WriteString(`</w:comments>`)
	if !anyResolved {
		return sb.String(), ""
	}
	ext.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">`)
	for i, c := range b.cmtOrder {
		done := "0"
		if c.Resolved {
			done = "1"
		}
		ext.WriteString(`<w15:commentEx w15:paraId="` + commentParaID(i) + `" w15:done="` + done + `"/>`)
	}
	ext.WriteString(`</w15:commentsEx>`)
	return sb.String(), ext.String()
}

/* ---------------- reading ---------------- */

// docxReview is the review state the reader gathers while it walks
type docxReview struct {
	active []string // open comment ranges, innermost last (editor ids)
	used   map[string]bool
}

// editorCommentID is the data-cid an imported Word comment gets
func editorCommentID(wordID string) string {
	return "w" + wordID
}

func (r *docxReview) current() string {
	if len(r.active) == 0 {
		return ""
	}
	return r.active[len(r.active)-1]
}

func (r *docxReview) start(wordID string) {
	id := editorCommentID(wordID)
	for _, a := range r.active {
		if a == id {
			return
		}
	}
	r.active = append(r.active, id)
}

func (r *docxReview) end(wordID string) {
	id := editorCommentID(wordID)
	for i, a := range r.active {
		if a == id {
			r.active = append(r.active[:i], r.active[i+1:]...)
			return
		}
	}
}

// parseDocxComments reads word/comments.xml (+ commentsExtended.xml for
// the resolved flag) for the comments the text actually anchors
func parseDocxComments(files map[string][]byte, used map[string]bool) []*DocComment {
	raw, ok := files["word/comments.xml"]
	if !ok || len(used) == 0 {
		return nil
	}
	tree, err := parseXMLTree(raw)
	if err != nil {
		return nil
	}
	done := map[string]bool{}
	if ex, ok := files["word/commentsExtended.xml"]; ok {
		if et, err := parseXMLTree(ex); err == nil {
			for _, c := range et.all("commentEx") {
				if onOff2(c.attr("done")) {
					done[c.attr("paraId")] = true
				}
			}
		}
	}
	var out []*DocComment
	for _, c := range tree.all("comment") {
		id := editorCommentID(c.attr("id"))
		if !used[id] {
			continue
		}
		var lines []string
		lastPara := ""
		for _, p := range c.all("p") {
			var texts []string
			collectText(p, &texts)
			lines = append(lines, strings.Join(texts, ""))
			lastPara = p.attr("paraId")
		}
		dc := &DocComment{ID: id, Text: strings.TrimSpace(strings.Join(lines, "\n")), Resolved: done[lastPara]}
		if t, err := time.Parse(time.RFC3339, c.attr("date")); err == nil {
			dc.At = t.UnixMilli()
		} else if n, err := strconv.ParseInt(c.attr("date"), 10, 64); err == nil {
			dc.At = n
		}
		out = append(out, dc)
	}
	return out
}
