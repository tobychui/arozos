package odf

import (
	"strings"
	"testing"
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
