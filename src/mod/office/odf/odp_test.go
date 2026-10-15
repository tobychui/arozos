package odf

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/model"
)

// Only fo:font-weight makes a run heavy; a weight word in the family name
// belongs to that face, not to the CJK text the run falls back for
func TestOdpRunCSSWeight(t *testing.T) {
	cases := []struct {
		name       string
		st         odpStyle
		wantWeight string // "" when the run must carry no font-weight
	}{
		{"semibold face", odpStyle{SizePt: 24, Font: "Open Sans SemiBold"}, ""},
		{"extrabold face", odpStyle{SizePt: 24, Font: "Noto Sans ExtraBold"}, ""},
		{"plain face", odpStyle{SizePt: 24, Font: "Arial"}, ""},
		{"bold on a plain face", odpStyle{SizePt: 24, Font: "Arial", Bold: true}, "font-weight:700;"},
		{"bold on a semibold face", odpStyle{SizePt: 24, Font: "Open Sans SemiBold", Bold: true}, "font-weight:700;"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			css := odpRunCSS(c.st)
			if c.wantWeight == "" {
				if strings.Contains(css, "font-weight") {
					t.Errorf("odpRunCSS = %q, want no font-weight", css)
				}
			} else if !strings.Contains(css, c.wantWeight) {
				t.Errorf("odpRunCSS = %q, want %s", css, c.wantWeight)
			}
		})
	}
}

// Every kind the ODF writer knows has to read back as the same kind, or a
// deck loses its shapes on a .odp round trip.
func TestOdpShapeTypesRoundTrip(t *testing.T) {
	seen := map[string]string{}
	for kind, typ := range odpShapeTypes {
		if other, dup := seen[typ]; dup {
			// two kinds may share an ODF type (chevron and homePlate do);
			// the reader can only pick one, and that is fine
			t.Logf("ODF type %q is shared by %q and %q", typ, other, kind)
			continue
		}
		seen[typ] = kind
	}
	for typ, kind := range seen {
		eg := &onode{name: "enhanced-geometry", attrs: map[string]string{"type": typ}}
		n := &onode{name: "custom-shape", children: []onodeChild{{el: eg}}}
		got := odpCustomShapeKind(n)
		if got != kind && odpShapeTypes[got] != typ {
			t.Errorf("ODF type %q read back as %q, want %q", typ, got, kind)
		}
	}
}

// A skipped slide is LibreOffice's hidden slide: presentation:visibility
// "hidden" on its drawing-page style, which keeps the slide's colour too.
func TestOdpSkippedSlides(t *testing.T) {
	p := &model.Presentation{Slides: []*model.Slide{
		{ID: "a", Bg: "#112233", Objects: []*model.Object{}},
		{ID: "b", Bg: "#445566", Hidden: true, Objects: []*model.Object{}},
		{ID: "c", Hidden: true, Objects: []*model.Object{}},
	}}
	data, err := BuildOdp(p)
	if err != nil {
		t.Fatal(err)
	}
	back, err := ParseOdp(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Slides) != 3 {
		t.Fatalf("read back %d slides, want 3", len(back.Slides))
	}
	for i, want := range []bool{false, true, true} {
		if back.Slides[i].Hidden != want {
			t.Errorf("slide %d hidden = %v, want %v", i+1, back.Slides[i].Hidden, want)
		}
	}
	if back.Slides[1].Bg != "#445566" {
		t.Errorf("hidden slide background = %q, want #445566", back.Slides[1].Bg)
	}
}
