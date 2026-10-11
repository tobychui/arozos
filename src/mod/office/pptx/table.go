package pptx

/*
	table.go - table styles.

	A PowerPoint table rarely states its own look cell by cell. It names a
	table style (<a:tableStyleId>, defined in ppt/tableStyles.xml) and says
	which of the style's parts apply (<a:tblPr firstRow bandRow ...>): the
	whole table, banded rows and columns, the first / last row and column,
	the corner cells. Each part may set the cell fill, the cell borders and
	the text's weight, slant and colour, and a later part overrides an
	earlier one in a fixed order. A cell's own <a:tcPr> fill still wins.

	Without this a styled table comes in as black text on nothing - a
	heading row that was white on orange loses both.
*/

import (
	"encoding/xml"
	"strings"

	"imuslab.com/arozos/mod/office/internal/units"
	"imuslab.com/arozos/mod/office/internal/xmltree"
)

func xmlAttr(name, val string) xml.Attr {
	return xml.Attr{Name: xml.Name{Local: name}, Value: val}
}

// tblFlags are the <a:tblPr> switches that choose a style's parts
type tblFlags struct {
	firstRow, lastRow, firstCol, lastCol, bandRow, bandCol bool
}

func readTblFlags(tblPr *xmltree.Node) tblFlags {
	on := func(a string) bool { v := tblPr.Attr(a); return v == "1" || v == "true" }
	return tblFlags{
		firstRow: on("firstRow"), lastRow: on("lastRow"),
		firstCol: on("firstCol"), lastCol: on("lastCol"),
		bandRow: on("bandRow"), bandCol: on("bandCol"),
	}
}

// cellLook is what a table style gives one cell
type cellLook struct {
	fill   string // CSS colour, "" = none
	color  string // text colour, "" = unchanged
	bold   string // "on" / "off" / "" (unchanged)
	italic string
}

// noTableStyleID is PowerPoint's built-in "No Style, No Grid": a style with
// no look of its own, which needs no definition in ppt/tableStyles.xml. The
// writer names it on a table whose cells state their whole look.
const noTableStyleID = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"

// tableStyleFor finds the style a table names, in ppt/tableStyles.xml. A
// table that names none uses the list's default, as PowerPoint does.
func (sc *slideCtx) tableStyleFor(tbl *xmltree.Node) *xmltree.Node {
	lst := sc.doc.tree("ppt/tableStyles.xml")
	id := ""
	if tp := tbl.First("tblPr"); tp != nil {
		if t := tp.First("tableStyleId"); t != nil {
			id = strings.TrimSpace(t.Text)
		}
	}
	if id == "" && lst != nil {
		id = lst.Attr("def")
	}
	for _, st := range lst.All("tblStyle") {
		if st.Attr("styleId") == id {
			return st
		}
	}
	if id == noTableStyleID {
		empty := &xmltree.Node{}
		empty.XMLName.Local = "tblStyle"
		return empty
	}
	return nil
}

// cellBorder is the rule the cells state themselves, on their own tcPr, for
// a table whose style draws none: the first edge line found in reading order
func (sc *slideCtx) cellBorder(tbl *xmltree.Node, cm coordMap) (string, float64) {
	for _, tr := range tbl.All("tr") {
		for _, tc := range tr.All("tc") {
			pr := tc.First("tcPr")
			for _, side := range []string{"lnT", "lnL", "lnB", "lnR"} {
				ln := pr.First(side)
				if ln == nil {
					continue
				}
				if ln.First("noFill") != nil {
					return "none", 0
				}
				if c := sc.cc.solidColorOf(ln); c != "" {
					return c, units.Round2(units.AtofDefault(ln.Attr("w"), 12700) * cm.kx)
				}
			}
		}
	}
	return "", 0
}

// styleParts lists the parts of a style that reach cell (r, c), lowest
// priority first - the order PowerPoint applies them in
func styleParts(style *xmltree.Node, f tblFlags, r, c, rows, cols int) []*xmltree.Node {
	var out []*xmltree.Node
	add := func(name string) {
		if p := style.First(name); p != nil {
			out = append(out, p)
		}
	}
	add("wholeTbl")
	if f.bandCol {
		k := c
		if f.firstCol {
			k--
		}
		if k >= 0 && !(f.lastCol && c == cols-1) {
			if k%2 == 0 {
				add("band1V")
			} else {
				add("band2V")
			}
		}
	}
	if f.bandRow {
		k := r
		if f.firstRow {
			k--
		}
		if k >= 0 && !(f.lastRow && r == rows-1) {
			if k%2 == 0 {
				add("band1H")
			} else {
				add("band2H")
			}
		}
	}
	if f.lastCol && c == cols-1 {
		add("lastCol")
	}
	if f.firstCol && c == 0 {
		add("firstCol")
	}
	if f.lastRow && r == rows-1 {
		add("lastRow")
	}
	if f.firstRow && r == 0 {
		add("firstRow")
	}
	switch {
	case f.firstRow && f.firstCol && r == 0 && c == 0:
		add("nwCell")
	case f.firstRow && f.lastCol && r == 0 && c == cols-1:
		add("neCell")
	case f.lastRow && f.firstCol && r == rows-1 && c == 0:
		add("swCell")
	case f.lastRow && f.lastCol && r == rows-1 && c == cols-1:
		add("seCell")
	}
	return out
}

// lookOf folds the parts reaching a cell into what it looks like
func (sc *slideCtx) lookOf(parts []*xmltree.Node) cellLook {
	var lk cellLook
	for _, p := range parts {
		if ts := p.First("tcTxStyle"); ts != nil {
			if v := ts.Attr("b"); v != "" {
				lk.bold = v
			}
			if v := ts.Attr("i"); v != "" {
				lk.italic = v
			}
			for i := range ts.Nodes {
				if c := sc.cc.resolveColor(&ts.Nodes[i]); c != "" {
					lk.color = c
				}
			}
		}
		if cs := p.First("tcStyle"); cs != nil {
			if f := cs.First("fill"); f != nil {
				if c := sc.cc.fillColorOf(f); c != "" {
					lk.fill = c
					if c == "none" {
						lk.fill = ""
					}
				}
			} else if fr := cs.First("fillRef"); fr != nil {
				if c, _ := sc.fillRefFill(fr); c != "" && c != "none" {
					lk.fill = c
				}
			}
		}
	}
	return lk
}

// tableBorder reads the style's whole-table rule between cells (insideH,
// falling back to the outer top edge): its colour and width in px, or ""
// when the style draws none
func (sc *slideCtx) tableBorder(style *xmltree.Node, cm coordMap) (string, float64) {
	bdr := style.Path("wholeTbl", "tcStyle", "tcBdr")
	if bdr == nil {
		return "", 0
	}
	for _, side := range []string{"insideH", "insideV", "top", "left"} {
		ln := bdr.Path(side, "ln")
		if ln == nil {
			continue
		}
		if ln.First("noFill") != nil {
			return "none", 0
		}
		c := sc.cc.solidColorOf(ln)
		if c == "" {
			continue
		}
		w := units.AtofDefault(ln.Attr("w"), 12700) * cm.kx
		return c, units.Round2(w)
	}
	return "", 0
}

// lookTextStyle turns a cell's look into a list style the cell text can
// inherit from: its weight, slant and colour as the default run
func lookTextStyle(lk cellLook) *xmltree.Node {
	if lk.color == "" && lk.bold == "" && lk.italic == "" {
		return nil
	}
	rpr := xmltree.Node{}
	rpr.XMLName.Local = "defRPr"
	if lk.bold != "" {
		rpr.Attrs = append(rpr.Attrs, xmlAttr("b", map[bool]string{true: "1", false: "0"}[lk.bold == "on"]))
	}
	if lk.italic != "" {
		rpr.Attrs = append(rpr.Attrs, xmlAttr("i", map[bool]string{true: "1", false: "0"}[lk.italic == "on"]))
	}
	if lk.color != "" {
		clr := xmltree.Node{}
		clr.XMLName.Local = "srgbClr"
		clr.Attrs = append(clr.Attrs, xmlAttr("val", strings.TrimPrefix(opaqueHex(lk.color), "#")))
		sf := xmltree.Node{Nodes: []xmltree.Node{clr}}
		sf.XMLName.Local = "solidFill"
		rpr.Nodes = append(rpr.Nodes, sf)
	}
	ppr := xmltree.Node{Nodes: []xmltree.Node{rpr}}
	ppr.XMLName.Local = "defPPr"
	return &xmltree.Node{Nodes: []xmltree.Node{ppr}}
}
