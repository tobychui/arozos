package fonts

import (
	"strings"
)

// symbolBullets are the bullet characters of the symbol fonts, as Unicode
// characters that look the same. A deck states a marker as a code in the
// font (Wingdings "l" is a black circle); a machine without that font
// would show the letter instead. The replacements are all characters the
// shipped Noto Sans CJK faces carry (and Arial mostly does too), so the PDF
// exporter can always set the marker as text; k scales the marker to the
// size the symbol font draws it at.
type symbolGlyph struct {
	s string
	k float64
}

var symbolBullets = map[string]map[rune]symbolGlyph{
	"wingdings": {
		'l': {"\u25CF", 1.3}, 'm': {"\u25CB", 1.2}, 'n': {"\u25A0", 1.1}, 'o': {"\u25A1", 1.1},
		'p': {"\u25A1", 1.1}, 'q': {"\u25A1", 1.1}, 'r': {"\u25A1", 1.1}, 's': {"\u25C6", 0.9},
		't': {"\u25C6", 0.9}, 'u': {"\u25C6", 1}, 'v': {"\u2756", 1}, 'w': {"\u25C6", 0.7},
		'x': {"\u25A1", 1}, 0x9F: {"\u2022", 1}, 0xA7: {"\u25AA", 1}, 0xA8: {"\u25A1", 0.8},
		0xD8: {"\u25B6", 0.85}, 0xE0: {"\u2192", 1}, 0xE8: {"\u2192", 1}, 0xF0: {"\u21E8", 1},
		0xFB: {"\u00D7", 1}, 0xFC: {"\u2713", 1}, 0xFD: {"\u25A1", 1}, 0xFE: {"\u2713", 1},
	},
	"symbol": {
		0xB7: {"\u2022", 1}, 0xA8: {"\u2666", 1}, 0xA7: {"\u2663", 1}, 0xA9: {"\u2665", 1},
		0xAA: {"\u2660", 1}, 0xAE: {"\u2192", 1}, 0xDE: {"\u21D2", 1}, 0x2D: {"\u2212", 1},
		0xBE: {"\u2014", 1}, 0xE0: {"\u25CA", 1},
	},
	"webdings": {
		'=': {"\u25A0", 1}, 'n': {"\u25CF", 1}, 'a': {"\u2713", 1}, 'r': {"\u00D7", 1},
	},
}

// SymbolBullet maps a marker set in a symbol font to the character it
// draws and the scale it is drawn at. Such fonts are often addressed
// through the private use area (U+F06C for Wingdings "l"), which is folded
// back first.
func SymbolBullet(font, marker string) (string, float64, bool) {
	f := strings.ToLower(strings.TrimSpace(font))
	var table map[rune]symbolGlyph
	switch {
	case strings.HasPrefix(f, "wingdings"):
		table = symbolBullets["wingdings"]
	case f == "symbol":
		table = symbolBullets["symbol"]
	case strings.HasPrefix(f, "webdings"):
		table = symbolBullets["webdings"]
	default:
		return "", 1, false
	}
	r := []rune(marker)
	if len(r) != 1 {
		return "", 1, false
	}
	c := r[0]
	if c >= 0xF020 && c <= 0xF0FF {
		c -= 0xF000
	}
	if g, ok := table[c]; ok {
		return g.s, g.k, true
	}
	return "", 1, false
}

// IsSymbolFont reports whether a typeface maps letters onto pictographs
func IsSymbolFont(font string) bool {
	f := strings.ToLower(strings.TrimSpace(font))
	return strings.HasPrefix(f, "wingdings") || strings.HasPrefix(f, "webdings") ||
		f == "symbol" || strings.Contains(f, "dingbat")
}

// symbolEncoding is the Symbol font's character set (Adobe's Symbol
// encoding) for the codes that differ from what they show: the Greek
// alphabet on the Latin letters, and the mathematical signs
var symbolEncoding = func() map[rune]rune {
	m := map[rune]rune{}
	upper := "\u0391\u0392\u03A7\u0394\u0395\u03A6\u0393\u0397\u0399\u03D1\u039A\u039B\u039C\u039D\u039F\u03A0\u0398\u03A1\u03A3\u03A4\u03A5\u03C2\u03A9\u039E\u03A8\u0396"
	lower := "\u03B1\u03B2\u03C7\u03B4\u03B5\u03C6\u03B3\u03B7\u03B9\u03D5\u03BA\u03BB\u03BC\u03BD\u03BF\u03C0\u03B8\u03C1\u03C3\u03C4\u03C5\u03D6\u03C9\u03BE\u03C8\u03B6"
	for i, r := range []rune(upper) {
		m['A'+rune(i)] = r
	}
	for i, r := range []rune(lower) {
		m['a'+rune(i)] = r
	}
	for k, v := range map[rune]rune{
		0x22: 0x2200, 0x24: 0x2203, 0x27: 0x220B, 0x2A: 0x2217, 0x2D: 0x2212, 0x40: 0x2245,
		0x5C: 0x2234, 0x5E: 0x22A5, 0x60: 0x203E, 0x7E: 0x223C, 0xA1: 0x03D2, 0xA2: 0x2032,
		0xA3: 0x2264, 0xA4: 0x2044, 0xA5: 0x221E, 0xA6: 0x0192, 0xA7: 0x2663, 0xA8: 0x2666,
		0xA9: 0x2665, 0xAA: 0x2660, 0xAB: 0x2194, 0xAC: 0x2190, 0xAD: 0x2191, 0xAE: 0x2192,
		0xAF: 0x2193, 0xB0: 0x00B0, 0xB1: 0x00B1, 0xB2: 0x2033, 0xB3: 0x2265, 0xB4: 0x00D7,
		0xB5: 0x221D, 0xB6: 0x2202, 0xB7: 0x2022, 0xB8: 0x00F7, 0xB9: 0x2260, 0xBA: 0x2261,
		0xBB: 0x2248, 0xBC: 0x2026, 0xC0: 0x2135, 0xC1: 0x2111, 0xC2: 0x211C, 0xC3: 0x2118,
		0xC4: 0x2297, 0xC5: 0x2295, 0xC6: 0x2205, 0xC7: 0x2229, 0xC8: 0x222A, 0xC9: 0x2283,
		0xCA: 0x2287, 0xCB: 0x2284, 0xCC: 0x2282, 0xCD: 0x2286, 0xCE: 0x2208, 0xCF: 0x2209,
		0xD0: 0x2220, 0xD1: 0x2207, 0xD5: 0x220F, 0xD6: 0x221A, 0xD7: 0x22C5, 0xD8: 0x00AC,
		0xD9: 0x2227, 0xDA: 0x2228, 0xDB: 0x21D4, 0xDC: 0x21D0, 0xDD: 0x21D1, 0xDE: 0x21D2,
		0xDF: 0x21D3, 0xE0: 0x25CA, 0xE1: 0x2329, 0xE5: 0x2211, 0xF1: 0x232A, 0xF2: 0x222B,
	} {
		m[k] = v
	}
	return m
}()

// SymbolText maps text set in the Symbol font to the characters it shows.
// Codes may come through the private use area (U+F061 for "a"), which is
// folded back first; anything else is kept as it is.
func SymbolText(s string) string {
	var b strings.Builder
	for _, r := range s {
		c := r
		if c >= 0xF020 && c <= 0xF0FF {
			c -= 0xF000
		}
		if u, ok := symbolEncoding[c]; ok {
			b.WriteRune(u)
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}
