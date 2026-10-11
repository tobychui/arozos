package xmltree

import "testing"

func TestParseAndWalk(t *testing.T) {
	root, err := Parse([]byte(`<p:sld xmlns:p="urn:p" xmlns:a="urn:a" xmlns:r="urn:officeDocument/2006/relationships">` +
		`<p:cSld><p:spTree><p:sp id="1"><a:t>Hello</a:t><a:t> </a:t></p:sp>` +
		`<p:sp id="2" r:id="rId7"><a:p><a:t>World</a:t></a:p></p:sp></p:spTree></p:cSld></p:sld>`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	tree := root.Path("cSld", "spTree")
	if tree == nil {
		t.Fatal("Path did not reach spTree")
	}
	sps := tree.All("sp")
	if len(sps) != 2 {
		t.Fatalf("All(sp) = %d nodes, want 2", len(sps))
	}
	tests := []struct {
		name, got, want string
	}{
		{"Attr", sps[0].Attr("id"), "1"},
		{"AttrNS", sps[1].AttrNS("relationships", "id"), "rId7"},
		{"missing Attr", sps[0].Attr("nope"), ""},
		{"nil node Attr", (*Node)(nil).Attr("id"), ""},
	}
	for _, tc := range tests {
		if tc.got != tc.want {
			t.Errorf("%s = %q, want %q", tc.name, tc.got, tc.want)
		}
	}
	if root.Path("cSld", "nope", "spTree") != nil {
		t.Error("Path through a missing element should be nil")
	}
	var ts []*Node
	root.FindAll("t", &ts)
	if len(ts) != 3 {
		t.Errorf("FindAll(t) = %d, want 3", len(ts))
	}
	var text []string
	CollectText(root, &text)
	if len(text) != 2 || text[0] != "Hello" || text[1] != "World" {
		t.Errorf("CollectText = %q, want [Hello World] (blank runs skipped)", text)
	}
}

func TestParseRelsAndResolvePart(t *testing.T) {
	rels := ParseRels([]byte(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="t" Target="../media/image1.png"/>` +
		`<Relationship Id="rId2" Type="t" Target="/ppt/slides/slide2.xml"/></Relationships>`))
	if rels["rId1"] != "../media/image1.png" || rels["rId2"] != "/ppt/slides/slide2.xml" {
		t.Fatalf("ParseRels = %v", rels)
	}
	if len(ParseRels(nil)) != 0 || len(ParseRels([]byte("<broken"))) != 0 {
		t.Error("ParseRels of nothing or junk should be empty")
	}
	tests := []struct{ base, target, want string }{
		{"ppt/slides", "../media/image1.png", "ppt/media/image1.png"},
		{"ppt/slides", "/ppt/slides/slide2.xml", "ppt/slides/slide2.xml"},
		{"word", "media/a.png", "word/media/a.png"},
	}
	for _, tc := range tests {
		if got := ResolvePart(tc.base, tc.target); got != tc.want {
			t.Errorf("ResolvePart(%q, %q) = %q, want %q", tc.base, tc.target, got, tc.want)
		}
	}
}

func TestEscape(t *testing.T) {
	if got := Escape(`a<b>&"c"'d'`); got != "a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;" {
		t.Errorf("Escape = %q", got)
	}
}
