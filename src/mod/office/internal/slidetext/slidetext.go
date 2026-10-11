// Package slidetext reads the Slides editor's text model - the HTML a text
// object stores - back into paragraphs and runs, for the pptx and odp
// writers.
package slidetext

/*
	slidetext.go - turn the Slides editor's storage HTML back into
	PresentationML paragraphs and runs.

	The reader writes one <div> per paragraph and one <span> per run, and
	the editor's own contenteditable produces the same shapes plus the
	tags execCommand emits (<b>, <i>, <u>, <font>, <ul>/<ol>/<li>). Both
	have to survive a save into .pptx, or every deck opened from a
	PowerPoint file would lose its formatting the moment it was saved -
	which is exactly what the first version of the writer did, flattening
	the whole box to one font, size and colour.

	Parsing goes through encoding/xml in non-strict mode with HTML entities
	and auto-closing turned on, so an unclosed <br> and a bare &nbsp; are
	both handled without pulling in an HTML parser.
*/

import (
	"encoding/xml"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/fonts"
	"imuslab.com/arozos/mod/office/internal/units"
)

// Run is one run of uniformly formatted text, or a line break
type Run struct {
	Text      string
	Break     bool
	SizePx    float64
	Font      string // the first real family in the CSS stack
	Bold      bool   // b="1": a weight the font name does not already carry
	Italic    bool
	Underline bool
	Strike    bool
	Color     string // "#rrggbb"
	Highlight string
	Baseline  int // a:rPr baseline, 1/1000 %: 30000 superscript, -25000 subscript
}

// Para is one paragraph with its block-level formatting
type Para struct {
	Align      string  // left | center | right | justify
	LineHeight float64 // unitless, 0 when unset
	MarginTop  float64 // px
	MarginBot  float64 // px
	PadLeft    float64 // px
	Indent     float64 // px, negative for a hanging bullet
	Bullet     string  // the marker glyph, "" when the paragraph has none
	BulletClr  string  // the marker's own colour, "" when it follows the text
	BulletFont string  // the marker's own typeface, "" when it follows the text
	BulletSize float64 // the marker's own size in px, 0 when it follows the text
	// the style of a paragraph with no text (only the zero-width space the
	// reader pads an empty line with), written as endParaRPr so the line
	// keeps its size and font in PowerPoint
	End  *Run
	Runs []Run
}

// Style is the formatting in force at a point in the tree
type Style struct {
	SizePx     float64
	Font       string
	Bold       bool
	weight     int // the CSS font-weight in force, 0 when unset
	Italic     bool
	Underline  bool
	strike     bool
	Color      string
	highlight  string
	baseline   int     // 30000 = superscript, -25000 = subscript (a:rPr)
	bulletSpan bool    // this subtree is a bullet marker, not body text
	bulletLeft float64 // the marker's offset from the paragraph box, px
}

// Parse turns the editor's stored HTML into paragraphs. A
// document with no block markup at all comes back as a single paragraph.
func Parse(html string, base Style) []Para {
	dec := xml.NewDecoder(strings.NewReader("<root>" + html + "</root>"))
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity

	var paras []Para
	cur := Para{}
	haveBlock := false
	stack := []Style{base}
	// list nesting, so <ol> numbers and <ul> bullets come out right
	type listCtx struct {
		ordered bool
		n       int
	}
	var lists []listCtx

	top := func() Style { return stack[len(stack)-1] }
	flush := func() {
		if len(cur.Runs) > 0 || haveBlock {
			paras = append(paras, cur)
		}
		cur = Para{}
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			name := strings.ToLower(t.Name.Local)
			st := top()
			switch name {
			case "root":
				continue
			case "br":
				cur.Runs = append(cur.Runs, Run{Break: true, SizePx: st.SizePx, Font: st.Font})
				stack = append(stack, st)
				continue
			case "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li":
				flush()
				haveBlock = true
				applyBlockAttrs(&cur, t)
				if name == "li" && len(lists) > 0 {
					l := &lists[len(lists)-1]
					if l.ordered {
						l.n++
						cur.Bullet = strconv.Itoa(l.n) + "."
					} else {
						cur.Bullet = "•"
					}
					if cur.PadLeft == 0 {
						cur.PadLeft = 36 * float64(len(lists))
					}
					if cur.Indent == 0 {
						cur.Indent = -18
					}
				}
			case "ul", "ol":
				lists = append(lists, listCtx{ordered: name == "ol"})
			case "b", "strong":
				st.Bold = true
				st.weight = 0
			case "i", "em":
				st.Italic = true
			case "u":
				st.Underline = true
			case "s", "strike", "del":
				st.strike = true
			case "sup":
				st.baseline = pptxSuperBaseline
			case "sub":
				st.baseline = pptxSubBaseline
			}
			applyInlineAttrs(&st, t)
			if st.bulletSpan && cur.Bullet == "" {
				// the reader marks a bullet with an absolutely positioned
				// span; it is a marker, not part of the text, and where it
				// sits relative to the text is the hanging indent
				cur.Bullet = "•"
				cur.Indent = st.bulletLeft - cur.PadLeft
			}
			if st.bulletSpan {
				// PowerPoint colours a marker like the first run unless
				// told otherwise, and the reader's marker states its own -
				// on the span inside the positioned one (which only carries
				// the line the marker sits on), or on that span itself in a
				// document written before the two were split
				cur.BulletClr = st.Color
				cur.BulletFont = st.Font
				cur.BulletSize = st.SizePx
			}
			stack = append(stack, st)
		case xml.EndElement:
			name := strings.ToLower(t.Name.Local)
			if name == "root" {
				continue
			}
			if name == "ul" || name == "ol" {
				if len(lists) > 0 {
					lists = lists[:len(lists)-1]
				}
			}
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			st := top()
			text := strings.ReplaceAll(string(t), " ", " ")
			// the reader pads an otherwise empty line with a zero-width
			// space so it keeps its height; that is layout, not content
			text = strings.ReplaceAll(text, "​", "")
			if text == "" {
				if string(t) != "" && !st.bulletSpan {
					if n := len(cur.Runs); n == 0 {
						end := styledRun(st, "")
						cur.End = &end
					} else if cur.Runs[n-1].Break {
						// the sized spacer after a <br> is what gives the line
						// it opens its height; the break carries that size
						br := styledRun(st, "")
						br.Break = true
						cur.Runs[n-1] = br
					}
				}
				continue
			}
			if st.bulletSpan {
				cur.Bullet = strings.TrimSpace(text)
				continue
			}
			cur.Runs = append(cur.Runs, styledRun(st, text))
		}
	}
	flush()
	if len(paras) == 0 {
		paras = []Para{{}}
	}
	return paras
}

// styledRun is a run of text in the style in force. PowerPoint has only
// bold or not; a weight the font name already carries ('Open Sans
// SemiBold' at 600, which is how the reader writes a SemiBold face) is
// the face itself, and marking it bold as well would draw it heavier.
func styledRun(st Style, text string) Run {
	bold := st.Bold
	if st.weight > 0 {
		bold = st.weight >= 700 || (st.weight >= 600 && fonts.WeightOf(st.Font) < st.weight)
	}
	return Run{
		Text: text, SizePx: st.SizePx, Font: st.Font,
		Bold: bold, Italic: st.Italic, Underline: st.Underline,
		Strike: st.strike, Color: st.Color, Highlight: st.highlight,
		Baseline: st.baseline,
	}
}

// applyBlockAttrs reads the paragraph-level CSS off a block element
func applyBlockAttrs(p *Para, el xml.StartElement) {
	decls := styleDecls(el)
	hanging := false
	for prop, val := range decls {
		switch prop {
		case "text-align":
			p.Align = val
		case "line-height":
			if strings.HasSuffix(val, "px") {
				// an absolute line height cannot be expressed without the
				// font size; leave it to the run sizes
				continue
			}
			p.LineHeight = units.ParseNum(val)
		case "margin-top":
			p.MarginTop = units.ParseNum(val)
		case "margin-bottom":
			p.MarginBot = units.ParseNum(val)
		case "padding-left":
			p.PadLeft = units.ParseNum(val)
		case "text-indent":
			p.Indent = units.ParseNum(val)
			hanging = strings.Contains(val, "hanging")
		}
	}
	// "Xpx hanging" (a paragraph with tabs, see the reader): every line
	// but the first starts X further in, which is a hanging indent of X
	if hanging && p.Indent > 0 {
		p.PadLeft += p.Indent
		p.Indent = -p.Indent
	}
}

// the a:rPr baselines PowerPoint gives superscript and subscript
const (
	pptxSuperBaseline = 30000
	pptxSubBaseline   = -25000
	// the reader draws a raised or lowered run at this share of its size
	// (pptx/text.go); a run that states both is read back at full size
	pptxBaselineScale = 0.65
)

// applyInlineAttrs reads run-level CSS and the legacy <font> attributes
func applyInlineAttrs(st *Style, el xml.StartElement) {
	if strings.EqualFold(el.Name.Local, "font") {
		for _, a := range el.Attr {
			switch strings.ToLower(a.Name.Local) {
			case "color":
				st.Color = a.Value
			case "face":
				st.Font = fonts.FirstFamily(a.Value)
			}
		}
	}
	decls := styleDecls(el)
	if decls == nil {
		return
	}
	for prop, val := range decls {
		switch prop {
		case "font-size":
			if v := units.ParseNum(val); v > 0 {
				st.SizePx = v
			}
		case "font-family":
			st.Font = fonts.FirstFamily(val)
		case "font-weight":
			switch val {
			case "bold", "bolder":
				st.Bold, st.weight = true, 700
			case "normal", "lighter":
				st.Bold, st.weight = false, 400
			default:
				st.weight = int(units.ParseNum(val))
				st.Bold = st.weight >= 600
			}
		case "font-style":
			st.Italic = val == "italic" || val == "oblique"
		case "text-decoration", "text-decoration-line":
			st.Underline = strings.Contains(val, "underline")
			st.strike = strings.Contains(val, "line-through")
		case "color":
			st.Color = val
		case "vertical-align":
			switch val {
			case "super":
				st.baseline = pptxSuperBaseline
			case "sub":
				st.baseline = pptxSubBaseline
			case "baseline":
				st.baseline = 0
			}
		case "background-color", "background":
			st.highlight = val
		case "position":
			if val == "absolute" {
				st.bulletSpan = true
			}
		case "left":
			st.bulletLeft = units.ParseNum(val)
		}
	}
	// the reader writes a raised run as vertical-align plus a smaller
	// size; PowerPoint shrinks a raised run itself, so the run goes back
	// at the size it had
	if st.baseline != 0 && decls["vertical-align"] != "" && decls["font-size"] != "" && st.SizePx > 0 {
		st.SizePx = st.SizePx / pptxBaselineScale
	}
}

// styleDecls splits a style attribute into lower-cased property/value
// pairs. A font-family keeps its case: it goes back out as a typeface
// name, which PowerPoint shows as it is spelled.
func styleDecls(el xml.StartElement) map[string]string {
	raw := ""
	for _, a := range el.Attr {
		if strings.EqualFold(a.Name.Local, "style") {
			raw = a.Value
		}
	}
	if raw == "" {
		return nil
	}
	out := map[string]string{}
	for _, decl := range strings.Split(raw, ";") {
		i := strings.Index(decl, ":")
		if i < 0 {
			continue
		}
		prop := strings.ToLower(strings.TrimSpace(decl[:i]))
		val := strings.TrimSpace(decl[i+1:])
		if prop != "font-family" {
			val = strings.ToLower(val)
		}
		out[prop] = val
	}
	return out
}
