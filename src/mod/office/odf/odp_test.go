package odf

import (
	"testing"
)

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
