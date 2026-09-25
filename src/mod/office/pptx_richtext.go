package office

/*
	pptx_richtext.go - turn the Slides editor's storage HTML back into
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
)

// htmlRun is one run of uniformly formatted text, or a line break
type htmlRun struct {
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
}

// htmlPara is one paragraph with its block-level formatting
type htmlPara struct {
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
	End  *htmlRun
	Runs []htmlRun
}

// inlineStyle is the formatting in force at a point in the tree
type inlineStyle struct {
	sizePx     float64
	font       string
	bold       bool
	weight     int // the CSS font-weight in force, 0 when unset
	italic     bool
	underline  bool
	strike     bool
	color      string
	highlight  string
	bulletSpan bool    // this subtree is a bullet marker, not body text
	bulletLeft float64 // the marker's offset from the paragraph box, px
}

// parseStorageHTML turns the editor's stored HTML into paragraphs. A
// document with no block markup at all comes back as a single paragraph.
func parseStorageHTML(html string, base inlineStyle) []htmlPara {
	dec := xml.NewDecoder(strings.NewReader("<root>" + html + "</root>"))
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity

	var paras []htmlPara
	cur := htmlPara{}
	haveBlock := false
	stack := []inlineStyle{base}
	// list nesting, so <ol> numbers and <ul> bullets come out right
	type listCtx struct {
		ordered bool
		n       int
	}
	var lists []listCtx

	top := func() inlineStyle { return stack[len(stack)-1] }
	flush := func() {
		if len(cur.Runs) > 0 || haveBlock {
			paras = append(paras, cur)
		}
		cur = htmlPara{}
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
				cur.Runs = append(cur.Runs, htmlRun{Break: true, SizePx: st.sizePx, Font: st.font})
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
				st.bold = true
				st.weight = 0
			case "i", "em":
				st.italic = true
			case "u":
				st.underline = true
			case "s", "strike", "del":
				st.strike = true
			case "sup", "sub":
				// baseline shifts are not modelled on the run
			}
			applyInlineAttrs(&st, t)
			if st.bulletSpan && cur.Bullet == "" {
				// the reader marks a bullet with an absolutely positioned
				// span; it is a marker, not part of the text, and where it
				// sits relative to the text is the hanging indent
				cur.Bullet = "•"
				cur.Indent = st.bulletLeft - cur.PadLeft
				// PowerPoint colours a marker like the first run unless
				// told otherwise, and the reader's marker states its own
				cur.BulletClr = st.color
				cur.BulletFont = st.font
				cur.BulletSize = st.sizePx
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
		paras = []htmlPara{{}}
	}
	return paras
}

// styledRun is a run of text in the style in force. PowerPoint has only
// bold or not; a weight the font name already carries ('Open Sans
// SemiBold' at 600, which is how the reader writes a SemiBold face) is
// the face itself, and marking it bold as well would draw it heavier.
func styledRun(st inlineStyle, text string) htmlRun {
	bold := st.bold
	if st.weight > 0 {
		bold = st.weight >= 700 || (st.weight >= 600 && fontWeightOf(st.font) < st.weight)
	}
	return htmlRun{
		Text: text, SizePx: st.sizePx, Font: st.font,
		Bold: bold, Italic: st.italic, Underline: st.underline,
		Strike: st.strike, Color: st.color, Highlight: st.highlight,
	}
}

// applyBlockAttrs reads the paragraph-level CSS off a block element
func applyBlockAttrs(p *htmlPara, el xml.StartElement) {
	decls := styleDecls(el)
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
			p.LineHeight = parseNum(val)
		case "margin-top":
			p.MarginTop = parseNum(val)
		case "margin-bottom":
			p.MarginBot = parseNum(val)
		case "padding-left":
			p.PadLeft = parseNum(val)
		case "text-indent":
			p.Indent = parseNum(val)
		}
	}
}

// applyInlineAttrs reads run-level CSS and the legacy <font> attributes
func applyInlineAttrs(st *inlineStyle, el xml.StartElement) {
	if strings.EqualFold(el.Name.Local, "font") {
		for _, a := range el.Attr {
			switch strings.ToLower(a.Name.Local) {
			case "color":
				st.color = a.Value
			case "face":
				st.font = firstFontFamily(a.Value)
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
			if v := parseNum(val); v > 0 {
				st.sizePx = v
			}
		case "font-family":
			st.font = firstFontFamily(val)
		case "font-weight":
			switch val {
			case "bold", "bolder":
				st.bold, st.weight = true, 700
			case "normal", "lighter":
				st.bold, st.weight = false, 400
			default:
				st.weight = int(parseNum(val))
				st.bold = st.weight >= 600
			}
		case "font-style":
			st.italic = val == "italic" || val == "oblique"
		case "text-decoration", "text-decoration-line":
			st.underline = strings.Contains(val, "underline")
			st.strike = strings.Contains(val, "line-through")
		case "color":
			st.color = val
		case "background-color", "background":
			st.highlight = val
		case "position":
			if val == "absolute" {
				st.bulletSpan = true
			}
		case "left":
			st.bulletLeft = parseNum(val)
		}
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

// firstFontFamily picks the first concrete family out of a CSS font stack
func firstFontFamily(stack string) string {
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

// parseNum reads the leading number out of a CSS value ("18.5px" -> 18.5)
func parseNum(v string) float64 {
	v = strings.TrimSpace(v)
	end := 0
	for end < len(v) {
		c := v[end]
		if (c >= '0' && c <= '9') || c == '.' || (end == 0 && (c == '-' || c == '+')) {
			end++
			continue
		}
		break
	}
	if end == 0 {
		return 0
	}
	f, err := strconv.ParseFloat(v[:end], 64)
	if err != nil {
		return 0
	}
	return f
}
