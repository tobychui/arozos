package fonts

import (
	"strings"
	"testing"
)

/* ---------------- font stacks ---------------- */

func TestFontStackFor(t *testing.T) {
	tests := []struct {
		name        string
		latin, ea   string
		wantParts   []string
		wantGeneric string
	}{
		{"plain family", "Arial", "Arial", []string{"Arial"}, "sans-serif"},
		{"weighted name offers its base", "Open Sans SemiBold", "Open Sans SemiBold",
			[]string{"'Open Sans SemiBold'", "'Open Sans'"}, "sans-serif"},
		{"east asian face is kept", "Arial", "Noto Sans TC",
			[]string{"Arial", "'Noto Sans TC'"}, "sans-serif"},
		{"monospace generic", "Courier New", "", []string{"'Courier New'"}, "monospace"},
		{"serif generic", "Times New Roman", "", []string{"'Times New Roman'"}, "serif"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := StackFor(tc.latin, tc.ea)
			for _, part := range tc.wantParts {
				if !strings.Contains(got, part) {
					t.Errorf("stack %q is missing %q", got, part)
				}
			}
			if !strings.HasSuffix(got, tc.wantGeneric) {
				t.Errorf("stack %q does not end in %q", got, tc.wantGeneric)
			}
		})
	}
}

// Every stack ends with the shipped document fonts: they are the only faces
// the browser-side PDF exporter can embed, so a run that falls through to one
// exports as real text. The document's own face must still come first, and
// the shipped names must not be repeated when the document already asked for
// one of them.
func TestFontStackOffersShippedFonts(t *testing.T) {
	tests := []struct {
		name      string
		latin, ea string
		wantFirst string
	}{
		{"latin document", "Arial", "", "Arial"},
		{"document already names a shipped face", "Noto Sans TC", "", "'Noto Sans TC'"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := StackFor(tc.latin, tc.ea)
			parts := strings.Split(got, ",")
			if parts[0] != tc.wantFirst {
				t.Errorf("stack %q starts with %q, want %q", got, parts[0], tc.wantFirst)
			}
			for _, shipped := range shippedFontFallbacks {
				if !strings.Contains(got, QuoteName(shipped)) {
					t.Errorf("stack %q is missing the shipped face %q", got, shipped)
				}
				if n := strings.Count(got, QuoteName(shipped)); n != 1 {
					t.Errorf("stack %q names %q %d times, want once", got, shipped, n)
				}
			}
		})
	}
}

func TestFontWeightOf(t *testing.T) {
	tests := []struct {
		name string
		want int
	}{
		{"Open Sans", 0},
		{"Open Sans SemiBold", 600},
		{"Open Sans Medium", 500},
		{"Roboto Light", 300},
		{"Arial Black", 900},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := WeightOf(tc.name); got != tc.want {
				t.Errorf("fontWeightOf(%q) = %d, want %d", tc.name, got, tc.want)
			}
		})
	}
}
