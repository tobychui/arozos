package office

/*
	pptx_xml.go - the generic XML tree and DrawingML colour resolution
	shared by the pptx reader.

	OOXML is far too large to model with rigid structs for the subset the
	Slides webapp consumes, so every part is parsed into an xnode tree and
	walked by local element name (namespace prefixes are ignored - a:off,
	p:off and dgm:off all read as "off").
*/

import (
	"encoding/xml"
	"math"
	"strconv"
	"strings"
)

// xnode is a generic XML tree node
type xnode struct {
	XMLName xml.Name
	Attrs   []xml.Attr `xml:",any,attr"`
	Nodes   []xnode    `xml:",any"`
	Text    string     `xml:",chardata"`
}

func (n *xnode) attr(local string) string {
	if n == nil {
		return ""
	}
	for _, a := range n.Attrs {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// attrNS returns an attribute matching both a namespace URI suffix and a
// local name - needed for r:id, which collides with the plain "id" attribute
func (n *xnode) attrNS(nsSuffix, local string) string {
	if n == nil {
		return ""
	}
	for _, a := range n.Attrs {
		if a.Name.Local == local && strings.HasSuffix(a.Name.Space, nsSuffix) {
			return a.Value
		}
	}
	return ""
}

// first returns the first direct child with the given local name
func (n *xnode) first(local string) *xnode {
	if n == nil {
		return nil
	}
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			return &n.Nodes[i]
		}
	}
	return nil
}

// path walks nested first() lookups; returns nil when any hop is missing
func (n *xnode) path(locals ...string) *xnode {
	cur := n
	for _, l := range locals {
		cur = cur.first(l)
		if cur == nil {
			return nil
		}
	}
	return cur
}

// all returns every direct child with the given local name
func (n *xnode) all(local string) []*xnode {
	if n == nil {
		return nil
	}
	var out []*xnode
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			out = append(out, &n.Nodes[i])
		}
	}
	return out
}

// findAll walks the whole subtree collecting elements with the given name
func (n *xnode) findAll(local string, out *[]*xnode) {
	if n == nil {
		return
	}
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			*out = append(*out, &n.Nodes[i])
		}
		n.Nodes[i].findAll(local, out)
	}
}

func parseXMLTree(data []byte) (*xnode, error) {
	root := xnode{}
	if err := xml.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	return &root, nil
}

// parseRels maps rId -> target path from a .rels part. Shared with the
// docx and xlsx readers, which use the same relationship plumbing.
func parseRels(data []byte) map[string]string {
	out := map[string]string{}
	if data == nil {
		return out
	}
	tree, err := parseXMLTree(data)
	if err != nil {
		return out
	}
	for _, rel := range tree.all("Relationship") {
		out[rel.attr("Id")] = rel.attr("Target")
	}
	return out
}

// collectText gathers every <a:t> text node under n
func collectText(n *xnode, out *[]string) {
	if n.XMLName.Local == "t" {
		if strings.TrimSpace(n.Text) != "" {
			*out = append(*out, n.Text)
		}
		return
	}
	for i := range n.Nodes {
		collectText(&n.Nodes[i], out)
	}
}

func atofDefault(s string, def float64) float64 {
	if s == "" {
		return def
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return def
	}
	return v
}

/* ---------------- DrawingML colour resolution ---------------- */

// the preset colour names DrawingML allows in prstClr. Only the handful
// office documents actually use are listed; anything else falls back to
// black, which is what PowerPoint does for a name it does not know.
var prstClrTable = map[string]string{
	"black": "000000", "white": "FFFFFF", "red": "FF0000", "green": "008000",
	"blue": "0000FF", "yellow": "FFFF00", "cyan": "00FFFF", "magenta": "FF00FF",
	"gray": "808080", "grey": "808080", "darkGray": "A9A9A9", "lightGray": "D3D3D3",
	"orange": "FFA500", "purple": "800080", "brown": "A52A2A", "pink": "FFC0CB",
	"lime": "00FF00", "navy": "000080", "teal": "008080", "olive": "808000",
	"maroon": "800000", "silver": "C0C0C0", "gold": "FFD700",
}

// colorCtx is everything needed to turn a DrawingML colour element into a
// concrete hex string: the theme's colour scheme plus the master's colour
// map (which is what makes "tx1" mean "dk1" on one deck and "lt1" on another).
type colorCtx struct {
	scheme map[string]string // dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink
	clrMap map[string]string // bg1/tx1/bg2/tx2/accent1.. -> scheme slot
}

// resolveColor turns any of the DrawingML colour elements (srgbClr,
// schemeClr, sysClr, prstClr, scrgbClr) into "#rrggbb", applying the child
// transform elements. Returns "" when n is not a colour element.
func (cc *colorCtx) resolveColor(n *xnode) string {
	if n == nil {
		return ""
	}
	var r, g, b float64
	switch n.XMLName.Local {
	case "srgbClr":
		r, g, b = hexToRGB(n.attr("val"))
	case "schemeClr":
		hex := cc.schemeHex(n.attr("val"))
		if hex == "" {
			return ""
		}
		r, g, b = hexToRGB(hex)
	case "sysClr":
		// lastClr carries the value the producing application resolved
		v := n.attr("lastClr")
		if v == "" {
			if n.attr("val") == "window" {
				v = "FFFFFF"
			} else {
				v = "000000"
			}
		}
		r, g, b = hexToRGB(v)
	case "prstClr":
		v, ok := prstClrTable[n.attr("val")]
		if !ok {
			v = "000000"
		}
		r, g, b = hexToRGB(v)
	case "scrgbClr":
		// percentages in thousandths of a percent
		r = clamp01(atofDefault(n.attr("r"), 0)/100000.0) * 255
		g = clamp01(atofDefault(n.attr("g"), 0)/100000.0) * 255
		b = clamp01(atofDefault(n.attr("b"), 0)/100000.0) * 255
	default:
		return ""
	}
	r, g, b = applyColorMods(r, g, b, n)
	return rgbToHex(r, g, b)
}

// schemeHex maps a schemeClr val through the colour map into the theme
func (cc *colorCtx) schemeHex(val string) string {
	if val == "" {
		return ""
	}
	if val == "phClr" {
		// the placeholder colour of a style matrix - there is no style
		// context at this level, so treat it as the text colour
		val = "tx1"
	}
	slot := val
	if cc.clrMap != nil {
		if mapped, ok := cc.clrMap[val]; ok && mapped != "" {
			slot = mapped
		}
	}
	// bg1/tx1/bg2/tx2 are colour-map names; when the map did not cover
	// them fall back to the conventional pairing
	switch slot {
	case "bg1":
		slot = "lt1"
	case "tx1":
		slot = "dk1"
	case "bg2":
		slot = "lt2"
	case "tx2":
		slot = "dk2"
	}
	if cc.scheme != nil {
		if hex, ok := cc.scheme[slot]; ok {
			return hex
		}
	}
	return ""
}

// solidColorOf resolves the <a:solidFill> child of parent, if any
func (cc *colorCtx) solidColorOf(parent *xnode) string {
	sf := parent.first("solidFill")
	if sf == nil {
		return ""
	}
	for i := range sf.Nodes {
		if c := cc.resolveColor(&sf.Nodes[i]); c != "" {
			return c
		}
	}
	return ""
}

// fillColorOf resolves a fill container into a CSS colour. Gradients are
// approximated by their first stop (the editor has no gradient object),
// pattern fills by their foreground, and <a:noFill/> returns "none".
func (cc *colorCtx) fillColorOf(parent *xnode) string {
	if parent == nil {
		return ""
	}
	if parent.first("noFill") != nil {
		return "none"
	}
	if c := cc.solidColorOf(parent); c != "" {
		return c
	}
	if gs := parent.path("gradFill", "gsLst"); gs != nil {
		for _, stop := range gs.all("gs") {
			for i := range stop.Nodes {
				if c := cc.resolveColor(&stop.Nodes[i]); c != "" {
					return c
				}
			}
		}
	}
	if fg := parent.path("pattFill", "fgClr"); fg != nil {
		for i := range fg.Nodes {
			if c := cc.resolveColor(&fg.Nodes[i]); c != "" {
				return c
			}
		}
	}
	return ""
}

// applyColorMods applies the DrawingML colour transform children. Alpha is
// deliberately not applied here - the caller reads it separately, because
// the editor model carries opacity on the object, not on the colour.
func applyColorMods(r, g, b float64, n *xnode) (float64, float64, float64) {
	for i := range n.Nodes {
		ch := &n.Nodes[i]
		v := atofDefault(ch.attr("val"), 0) / 100000.0
		switch ch.XMLName.Local {
		case "lumMod":
			h, s, l := rgbToHSL(r, g, b)
			r, g, b = hslToRGB(h, s, clamp01(l*v))
		case "lumOff":
			h, s, l := rgbToHSL(r, g, b)
			r, g, b = hslToRGB(h, s, clamp01(l+v))
		case "shade":
			// shade multiplies toward black; the sRGB approximation used
			// here is what LibreOffice does and is visually close enough
			r, g, b = r*v, g*v, b*v
		case "tint":
			r = r*v + 255*(1-v)
			g = g*v + 255*(1-v)
			b = b*v + 255*(1-v)
		case "satMod":
			h, s, l := rgbToHSL(r, g, b)
			r, g, b = hslToRGB(h, clamp01(s*v), l)
		case "hueMod":
			h, s, l := rgbToHSL(r, g, b)
			r, g, b = hslToRGB(math.Mod(h*v, 1), s, l)
		case "gray":
			y := 0.299*r + 0.587*g + 0.114*b
			r, g, b = y, y, y
		case "inv":
			r, g, b = 255-r, 255-g, 255-b
		}
	}
	return r, g, b
}

func hexToRGB(h string) (float64, float64, float64) {
	h = strings.TrimPrefix(strings.TrimSpace(h), "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 {
		return 0, 0, 0
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0, 0, 0
	}
	return float64((v >> 16) & 255), float64((v >> 8) & 255), float64(v & 255)
}

func rgbToHex(r, g, b float64) string {
	cl := func(v float64) int64 {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return int64(v + 0.5)
	}
	const digits = "0123456789abcdef"
	out := []byte{'#', 0, 0, 0, 0, 0, 0}
	for i, v := range []int64{cl(r), cl(g), cl(b)} {
		out[1+i*2] = digits[(v>>4)&15]
		out[2+i*2] = digits[v&15]
	}
	return string(out)
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func rgbToHSL(r, g, b float64) (float64, float64, float64) {
	r, g, b = r/255, g/255, b/255
	mx := math.Max(r, math.Max(g, b))
	mn := math.Min(r, math.Min(g, b))
	l := (mx + mn) / 2
	if mx == mn {
		return 0, 0, l
	}
	d := mx - mn
	var s float64
	if l > 0.5 {
		s = d / (2 - mx - mn)
	} else {
		s = d / (mx + mn)
	}
	var h float64
	switch mx {
	case r:
		h = (g - b) / d
		if g < b {
			h += 6
		}
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	return h / 6, s, l
}

func hslToRGB(h, s, l float64) (float64, float64, float64) {
	if s == 0 {
		return l * 255, l * 255, l * 255
	}
	var q float64
	if l < 0.5 {
		q = l * (1 + s)
	} else {
		q = l + s - l*s
	}
	p := 2*l - q
	hue := func(t float64) float64 {
		if t < 0 {
			t++
		}
		if t > 1 {
			t--
		}
		switch {
		case t < 1.0/6:
			return p + (q-p)*6*t
		case t < 1.0/2:
			return q
		case t < 2.0/3:
			return p + (q-p)*(2.0/3-t)*6
		}
		return p
	}
	return hue(h+1.0/3) * 255, hue(h) * 255, hue(h-1.0/3) * 255
}
