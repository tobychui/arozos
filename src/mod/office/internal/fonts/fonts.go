// Package fonts names typefaces for the browser: CSS font stacks for an
// office font with fallbacks to the fonts the suite ships, the weight a
// font name implies, and the symbol fonts (Wingdings, Symbol, Webdings)
// whose letters stand for pictographs.
package fonts

import (
	"strings"
)

// FirstFamily picks the first concrete family out of a CSS font stack
func FirstFamily(stack string) string {
	for _, part := range strings.Split(stack, ",") {
		name := strings.TrimSpace(part)
		name = strings.Trim(name, "'\"")
		switch strings.ToLower(name) {
		case "", "sans-serif", "serif", "monospace", "cursive", "fantasy",
			"system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
			"inherit", "initial":
			continue
		}
		return name
	}
	return ""
}

/* ---------------- HTML generation ---------------- */

// StackFor turns a pptx typeface pair into a CSS font-family list.
// The east-asian face is kept as a second entry so a browser picks it per
// glyph, exactly the way PowerPoint switches fonts mid-run for CJK text.
func StackFor(latin, ea string) string {
	var parts []string
	seen := map[string]bool{}
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			return
		}
		// "+mj-lt" / "+mn-lt" are theme font references the caller has
		// already resolved; anything still unresolved is not a real font
		if strings.HasPrefix(name, "+") {
			return
		}
		seen[name] = true
		parts = append(parts, QuoteName(name))
	}
	add(latin)
	add(ea)
	// a weighted family name ("Open Sans SemiBold") is not installed on most
	// systems - offer the base family so the browser can synthesize instead
	// of dropping to a completely unrelated default
	if base := BaseName(latin); base != latin {
		add(base)
	}
	if base := BaseName(ea); base != ea {
		add(base)
	}
	// the shipped document fonts (web/Office/common/fonts), offered before
	// the generic. They are the only faces the browser-side PDF exporter can
	// embed - a system font's bytes are not readable from a page - so a run
	// that lands on one exports as real text instead of a picture of itself.
	// Noto Sans leads so Latin keeps a Latin design; the CJK faces behind it
	// cover what it does not, in the order a browser will try them.
	for _, shipped := range shippedFontFallbacks {
		add(shipped)
	}
	generic := "sans-serif"
	l := strings.ToLower(latin)
	switch {
	case strings.Contains(l, "courier"), strings.Contains(l, "mono"),
		strings.Contains(l, "consolas"):
		generic = "monospace"
	case strings.Contains(l, "times"), strings.Contains(l, "georgia"),
		strings.Contains(l, "serif") && !strings.Contains(l, "sans"),
		strings.Contains(l, "garamond"), strings.Contains(l, "book antiqua"):
		generic = "serif"
	}
	parts = append(parts, generic)
	return strings.Join(parts, ",")
}

// BulletFallback is the face a list marker falls back to when its own font
// has no glyph for it: Arimo, the shipped metric twin of Arial, which is
// what PowerPoint and Google Slides draw a missing ● ○ ■ in. The CJK
// fallbacks behind it draw those shapes full-width, twice the size.
const BulletFallback = "Arimo"

// shippedFontFallbacks are the families in web/Office/common/fonts, in the
// order fonts.js offers them to the browser. Keep the two lists in step.
var shippedFontFallbacks = []string{
	"Noto Sans", "Noto Sans TC", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR",
}

func QuoteName(n string) string {
	if strings.ContainsAny(n, " '\"") {
		return "'" + strings.ReplaceAll(n, "'", "") + "'"
	}
	return n
}

var fontWeightSuffixes = []struct {
	suffix string
	weight int
}{
	{" thin", 100}, {" extralight", 200}, {" extra light", 200}, {" ultralight", 200},
	{" light", 300}, {" regular", 400}, {" medium", 500},
	{" semibold", 600}, {" semi bold", 600}, {" demibold", 600},
	{" bold", 700}, {" extrabold", 800}, {" extra bold", 800}, {" black", 900},
}

// BaseName strips a trailing weight word ("Open Sans SemiBold" ->
// "Open Sans"); returns the name unchanged when there is none
func BaseName(n string) string {
	l := strings.ToLower(n)
	for _, w := range fontWeightSuffixes {
		if strings.HasSuffix(l, w.suffix) {
			return strings.TrimSpace(n[:len(n)-len(w.suffix)])
		}
	}
	return n
}

// WeightOf reads the weight a font name implies, 0 when it implies none
func WeightOf(n string) int {
	l := strings.ToLower(n)
	for _, w := range fontWeightSuffixes {
		if strings.HasSuffix(l, w.suffix) {
			return w.weight
		}
	}
	return 0
}
