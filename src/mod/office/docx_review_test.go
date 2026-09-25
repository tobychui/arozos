package office

import (
	"strings"
	"testing"
)

func TestDocxReviewWritesWordMarkup(t *testing.T) {
	doc := &Document{
		HTML: `<p>Keep <ins class="doc-ins">added</ins> and <del class="doc-del">removed</del> ` +
			`<span class="doc-cmt" data-cid="c1">noted</span> text.</p>`,
		Comments: []*DocComment{
			{ID: "c1", Text: "First line\nsecond line", At: 1700000000000, Resolved: true},
			{ID: "orphan", Text: "not anchored anywhere"},
		},
		TrackChanges: true,
	}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	parts := unzipParts(t, data)
	body := parts["word/document.xml"]
	cases := []struct{ what, want string }{
		{"insertion", `<w:ins w:id=`},
		{"deletion", `<w:del w:id=`},
		{"deleted text", `<w:delText xml:space="preserve">removed</w:delText>`},
		{"comment start", `<w:commentRangeStart w:id="50000"/>`},
		{"comment end", `<w:commentRangeEnd w:id="50000"/>`},
		{"comment reference", `<w:commentReference w:id="50000"/>`},
	}
	for _, c := range cases {
		if !strings.Contains(body, c.want) {
			t.Errorf("%s: %s not in document.xml", c.what, c.want)
		}
	}
	if strings.Contains(body, "<w:strike/>") || strings.Contains(body, `<w:u w:val="single"`) {
		t.Errorf("revisions must not also be drawn as strike/underline")
	}
	cm := parts["word/comments.xml"]
	if !strings.Contains(cm, "First line") || !strings.Contains(cm, "second line") || !strings.Contains(cm, `w:date="2023-11-14T22:13:20Z"`) {
		t.Errorf("comment body wrong:\n%s", cm)
	}
	if strings.Contains(cm, "not anchored") {
		t.Errorf("an unanchored comment was written")
	}
	if !strings.Contains(parts["word/commentsExtended.xml"], `w15:done="1"`) {
		t.Errorf("resolved flag missing")
	}
	if !strings.Contains(parts["word/settings.xml"], "<w:trackRevisions/>") {
		t.Errorf("Suggest edits did not switch on Word's tracking")
	}
	if !strings.Contains(parts["[Content_Types].xml"], "comments+xml") {
		t.Errorf("comments part has no content type")
	}
}

func TestDocxReviewRoundTrip(t *testing.T) {
	doc := &Document{
		HTML: `<p>Keep <ins class="doc-ins">added</ins> and <del class="doc-del">removed</del> ` +
			`<span class="doc-cmt" data-cid="c1">noted</span>.</p>`,
		Comments:     []*DocComment{{ID: "c1", Text: "Check this", At: 1700000000000, Resolved: true}},
		TrackChanges: true,
	}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatal(err)
	}
	back, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	for _, want := range []string{`<ins class="doc-ins">`, `added`, `<del class="doc-del">`, `removed`, `class="doc-cmt" data-cid="w50000"`, `noted`} {
		if !strings.Contains(back.HTML, want) {
			t.Errorf("%q lost in the round trip: %s", want, back.HTML)
		}
	}
	if len(back.Comments) != 1 {
		t.Fatalf("comments = %d, want 1", len(back.Comments))
	}
	c := back.Comments[0]
	if c.ID != "w50000" || c.Text != "Check this" || !c.Resolved || c.At != 1700000000000 {
		t.Errorf("comment = %+v", c)
	}
	if !back.TrackChanges {
		t.Errorf("tracking state lost")
	}
}

func TestDocxReviewAcrossParagraphs(t *testing.T) {
	doc := &Document{
		HTML: `<ins class="doc-ins"><p>one</p><p>two</p></ins>` +
			`<span class="doc-cmt" data-cid="k"><p>first</p><p>second</p></span>`,
		Comments: []*DocComment{{ID: "k", Text: "spans two"}},
	}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatal(err)
	}
	body := unzipParts(t, data)["word/document.xml"]
	if strings.Count(body, "<w:ins ") != 2 {
		t.Errorf("a suggestion over two paragraphs should mark both:\n%s", body)
	}
	if strings.Count(body, "commentRangeStart") != 1 || strings.Count(body, "commentRangeEnd") != 1 {
		t.Errorf("one comment over two paragraphs must be one range")
	}
	if strings.Index(body, "commentRangeStart") > strings.Index(body, "first") ||
		strings.Index(body, "commentRangeEnd") < strings.Index(body, "second") {
		t.Errorf("comment range does not cover both paragraphs")
	}
}

func TestDocxReviewEdges(t *testing.T) {
	cases := []struct {
		name, html string
		want, not  []string
	}{
		{"deletion inside insertion is gone", `<p><ins class="doc-ins">a<del class="doc-del">b</del>c</ins></p>`,
			[]string{">a</w:t>", ">c</w:t>", "<w:ins "}, []string{"delText", ">b</w:t>"}},
		{"link inside a suggestion stays plain", `<p><ins class="doc-ins"><a href="https://x.test">site</a></ins></p>`,
			[]string{"w:hyperlink", ">site</w:t>"}, []string{"<w:ins "}},
		{"plain del keeps strike", `<p><del>old</del></p>`, []string{"<w:strike/>"}, []string{"<w:del "}},
		{"anchor without comment is a span", `<p><span class="doc-cmt" data-cid="zz">t</span></p>`,
			[]string{">t</w:t>"}, []string{"commentRange"}},
	}
	for _, c := range cases {
		data, err := BuildDocx(&Document{HTML: c.html})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		body := unzipParts(t, data)["word/document.xml"]
		for _, w := range c.want {
			if !strings.Contains(body, w) {
				t.Errorf("%s: %q missing", c.name, w)
			}
		}
		for _, n := range c.not {
			if strings.Contains(body, n) {
				t.Errorf("%s: %q should not be there", c.name, n)
			}
		}
	}
}
