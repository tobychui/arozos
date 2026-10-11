package htmlutil

import (
	"testing"
)

func TestHexColor(t *testing.T) {
	tests := []struct {
		in, fallback, want string
	}{
		{"#aabbcc", "000000", "AABBCC"},
		{"aabbcc", "000000", "AABBCC"},
		{"#abc", "000000", "AABBCC"},
		{"nonsense", "112233", "112233"},
		{"", "112233", "112233"},
		{"#12345", "FFFFFF", "FFFFFF"},
	}
	for _, tc := range tests {
		if got := HexColor(tc.in, tc.fallback); got != tc.want {
			t.Errorf("hexColor(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
