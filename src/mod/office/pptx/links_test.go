package pptx

import (
	"errors"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

func TestPptxTransitionsAndLinks(t *testing.T) {
	p := &model.Presentation{Slides: []*model.Slide{
		{ID: "a", Transition: "fade", Objects: []*model.Object{
			{Type: "text", W: 100, H: 50, Props: model.Props{HTML: "<div>next</div>", Link: "#2"}},
			{Type: "shape", W: 100, H: 50, Props: model.Props{Kind: "rect", Link: "https://example.test/x?a=1&b=2"}},
			{Type: "shape", W: 100, H: 50, Props: model.Props{Kind: "rect", Link: "javascript:alert(1)"}},
		}},
		{ID: "b", Transition: "slide", Objects: []*model.Object{}},
		{ID: "c", Transition: "zoom", Objects: []*model.Object{}},
	}}
	data, err := Build(p)
	if err != nil {
		t.Fatal(err)
	}
	parts := officetest.UnzipParts(t, data)
	s1 := parts["ppt/slides/slide1.xml"]
	if !strings.Contains(s1, `<p:transition spd="med"><p:fade/></p:transition>`) {
		t.Errorf("fade transition missing")
	}
	if strings.Count(s1, "<a:hlinkClick") != 2 || !strings.Contains(s1, `action="ppaction://hlinksldjump"`) {
		t.Errorf("click links wrong:\n%s", s1)
	}
	rels := parts["ppt/slides/_rels/slide1.xml.rels"]
	if !strings.Contains(rels, `Target="slide2.xml"`) || !strings.Contains(rels, `Target="https://example.test/x?a=1&amp;b=2" TargetMode="External"`) {
		t.Errorf("link relationships wrong:\n%s", rels)
	}
	if strings.Contains(rels, "javascript") {
		t.Errorf("a script link was written")
	}

	back, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"fade", "slide", "zoom"} {
		if back.Slides[i].Transition != want {
			t.Errorf("slide %d transition = %q, want %q", i+1, back.Slides[i].Transition, want)
		}
	}
	links := map[string]bool{}
	for _, o := range back.Slides[0].Objects {
		if o.Props.Link != "" {
			links[o.Props.Link] = true
		}
	}
	if !links["#2"] || !links["https://example.test/x?a=1&b=2"] || len(links) != 2 {
		t.Errorf("links read back = %v", links)
	}
}

func TestPptxReadsLinkedPictures(t *testing.T) {
	png := officetest.PngBytes(t)
	read := func(vp string) ([]byte, error) {
		if vp == "user:/p.png" {
			return png, nil
		}
		return nil, errors.New("missing")
	}
	p := &model.Presentation{Slides: []*model.Slide{{Objects: []*model.Object{
		{Type: "image", W: 10, H: 10, Props: model.Props{Src: "../../media?file=user%3A%2Fp.png"}},
		{Type: "image", W: 10, H: 10, Props: model.Props{Src: "../../media?file=user%3A%2Fgone.png"}},
	}}}}
	data, _, err := BuildMedia(p, read)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for name := range officetest.UnzipParts(t, data) {
		if strings.HasPrefix(name, "ppt/media/") {
			n++
		}
	}
	if n != 1 {
		t.Errorf("media parts = %d, want 1 (the readable picture)", n)
	}
}
