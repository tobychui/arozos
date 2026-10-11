package codepage

import "testing"

func TestDecode(t *testing.T) {
	tests := []struct {
		cp   int
		in   []byte
		want string
	}{
		{1252, []byte("caf\xe9 \x80"), "café €"},
		{1251, []byte{0xcf, 0xf0, 0xe8}, "При"},
		{950, []byte{0xa4, 0xa4, 0xa4, 0xe5}, "中文"},
		{936, []byte{0xd6, 0xd0, 0xce, 0xc4}, "中文"},
		{932, []byte{0x93, 0xfa, 0x96, 0x7b}, "日本"},
		{9999, []byte("plain"), "plain"},
	}
	for _, tc := range tests {
		if got := For(tc.cp).Decode(tc.in); got != tc.want {
			t.Errorf("For(%d).Decode = %q, want %q", tc.cp, got, tc.want)
		}
	}
	if got := ForCharset(136).Decode([]byte{0xa4, 0xa4}); got != "中" {
		t.Errorf("ForCharset(136) = %q", got)
	}
	if got := (Decoder{}).Decode([]byte("x")); got != "x" {
		t.Errorf("zero Decoder = %q", got)
	}
}

func TestLatin1And1252(t *testing.T) {
	if got := Latin1([]byte{0x41, 0xe9, 0x80}); got != "Aé\u0080" {
		t.Errorf("Latin1 = %q", got)
	}
	for in, want := range map[byte]rune{0x41: 'A', 0x93: '“', 0x80: '€', 0xe9: 'é'} {
		if got := Rune1252(in); got != want {
			t.Errorf("Rune1252(%#x) = %U, want %U", in, got, want)
		}
	}
}
