package office

/*
	pptx_custgeom.go - custom geometry (<a:custGeom>): freeform shapes.

	An icon drawn in PowerPoint or Google Slides, a traced outline, a shape
	made with Edit Points - all of them are custom geometry: one or more
	paths of moveTo / lnTo / arcTo / quadBezTo / cubicBezTo / close, each in
	a coordinate space of its own (the path's w and h) that is stretched over
	the shape's frame, with points that may name guides computed by the
	DrawingML formula language (<a:gdLst>).

	They come in as a "custom" shape whose Props.Geom holds each path as an
	SVG path of M, L, C and Z only - the same restriction the editor's shape
	catalogue keeps, so the canvas, a shaped clip and the PDF exporter all
	read it with the code they already have. Coordinates stay in the path's
	own space and are scaled to the frame when drawn, so a resized shape
	keeps its outline.
*/

import (
	"math"
	"strconv"
	"strings"
)

// CustomGeom is the outline of a custom shape: its paths, drawn in order
type CustomGeom struct {
	Paths []CustomPath `json:"paths"`
}

// CustomPath is one path of a custom shape in its own W x H space, as an
// SVG path of M, L, C and Z
type CustomPath struct {
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	D        string  `json:"d"`
	NoFill   bool    `json:"noFill,omitempty"`
	NoStroke bool    `json:"noStroke,omitempty"`
}

// geomGuides evaluates the guide formulas of a geometry against the
// shape's size (EMU) - the built-in names first, then <a:avLst> and
// <a:gdLst> in order, each formula seeing the ones before it
func geomGuides(geom *xnode, w, h float64) map[string]float64 {
	g := map[string]float64{
		"l": 0, "t": 0, "r": w, "b": h, "w": w, "h": h,
		"hc": w / 2, "vc": h / 2, "ls": math.Max(w, h), "ss": math.Min(w, h),
		"cd2": 10800000, "cd4": 5400000, "cd8": 2700000, "3cd4": 16200000,
		"3cd8": 8100000, "5cd8": 13500000, "7cd8": 18900000,
	}
	ss := g["ss"]
	for _, n := range []int{2, 3, 4, 5, 6, 8, 10, 12, 16, 32} {
		f := float64(n)
		g["wd"+strconv.Itoa(n)] = w / f
		g["hd"+strconv.Itoa(n)] = h / f
		g["ssd"+strconv.Itoa(n)] = ss / f
	}
	for _, lst := range []string{"avLst", "gdLst"} {
		for _, gd := range geom.path(lst).all("gd") {
			g[gd.attr("name")] = evalGuide(gd.attr("fmla"), g)
		}
	}
	return g
}

// evalGuide computes one DrawingML guide formula ("*/ w adj 100000")
func evalGuide(fmla string, g map[string]float64) float64 {
	f := strings.Fields(fmla)
	if len(f) == 0 {
		return 0
	}
	arg := func(i int) float64 {
		if i >= len(f) {
			return 0
		}
		return geomValue(f[i], g)
	}
	deg := func(v float64) float64 { return v / 60000 * math.Pi / 180 }
	switch f[0] {
	case "val":
		return arg(1)
	case "*/":
		if d := arg(3); d != 0 {
			return arg(1) * arg(2) / d
		}
	case "+-":
		return arg(1) + arg(2) - arg(3)
	case "+/":
		if d := arg(3); d != 0 {
			return (arg(1) + arg(2)) / d
		}
	case "?:":
		if arg(1) > 0 {
			return arg(2)
		}
		return arg(3)
	case "abs":
		return math.Abs(arg(1))
	case "max":
		return math.Max(arg(1), arg(2))
	case "min":
		return math.Min(arg(1), arg(2))
	case "pin":
		return math.Max(arg(1), math.Min(arg(3), arg(2)))
	case "sqrt":
		return math.Sqrt(math.Max(0, arg(1)))
	case "mod":
		return math.Sqrt(arg(1)*arg(1) + arg(2)*arg(2) + arg(3)*arg(3))
	case "sin":
		return arg(1) * math.Sin(deg(arg(2)))
	case "cos":
		return arg(1) * math.Cos(deg(arg(2)))
	case "tan":
		return arg(1) * math.Tan(deg(arg(2)))
	case "at2":
		return math.Atan2(arg(2), arg(1)) * 180 / math.Pi * 60000
	case "cat2":
		return arg(1) * math.Cos(math.Atan2(arg(3), arg(2)))
	case "sat2":
		return arg(1) * math.Sin(math.Atan2(arg(3), arg(2)))
	}
	return 0
}

func geomValue(s string, g map[string]float64) float64 {
	if v, ok := g[s]; ok {
		return v
	}
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// parseCustGeom reads a <a:custGeom> for a shape of the given size (EMU)
func parseCustGeom(cg *xnode, w, h float64) *CustomGeom {
	g := geomGuides(cg, w, h)
	out := &CustomGeom{}
	for _, p := range cg.path("pathLst").all("path") {
		pw := atofDefault(p.attr("w"), 0)
		ph := atofDefault(p.attr("h"), 0)
		if pw <= 0 {
			pw = w
		}
		if ph <= 0 {
			ph = h
		}
		if pw <= 0 || ph <= 0 {
			continue
		}
		d := pathD(p, g)
		if d == "" {
			continue
		}
		out.Paths = append(out.Paths, CustomPath{
			W: round2(pw), H: round2(ph), D: d,
			NoFill:   p.attr("fill") == "none",
			NoStroke: p.attr("stroke") == "0" || p.attr("stroke") == "false",
		})
	}
	if len(out.Paths) == 0 {
		return nil
	}
	return out
}

// pathD turns one geometry path into SVG M / L / C / Z
func pathD(p *xnode, g map[string]float64) string {
	var sb strings.Builder
	num := func(v float64) string { return strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64) }
	pt := func(n *xnode) (float64, float64) {
		return geomValue(n.attr("x"), g), geomValue(n.attr("y"), g)
	}
	cx, cy := 0.0, 0.0 // the current point
	sx, sy := 0.0, 0.0 // where the subpath began
	for i := range p.Nodes {
		c := &p.Nodes[i]
		pts := c.all("pt")
		switch c.XMLName.Local {
		case "moveTo":
			if len(pts) > 0 {
				cx, cy = pt(pts[0])
				sx, sy = cx, cy
				sb.WriteString("M" + num(cx) + " " + num(cy))
			}
		case "lnTo":
			if len(pts) > 0 {
				cx, cy = pt(pts[0])
				sb.WriteString("L" + num(cx) + " " + num(cy))
			}
		case "cubicBezTo":
			if len(pts) == 3 {
				x1, y1 := pt(pts[0])
				x2, y2 := pt(pts[1])
				cx, cy = pt(pts[2])
				sb.WriteString("C" + num(x1) + " " + num(y1) + " " + num(x2) + " " + num(y2) + " " + num(cx) + " " + num(cy))
			}
		case "quadBezTo":
			if len(pts) == 2 {
				qx, qy := pt(pts[0])
				ex, ey := pt(pts[1])
				// a quadratic is the cubic with its control points two
				// thirds of the way to the quadratic's one
				sb.WriteString("C" + num(cx+(qx-cx)*2/3) + " " + num(cy+(qy-cy)*2/3) + " " +
					num(ex+(qx-ex)*2/3) + " " + num(ey+(qy-ey)*2/3) + " " + num(ex) + " " + num(ey))
				cx, cy = ex, ey
			}
		case "arcTo":
			wr := geomValue(c.attr("wR"), g)
			hr := geomValue(c.attr("hR"), g)
			st := geomValue(c.attr("stAng"), g) / 60000 * math.Pi / 180
			sw := geomValue(c.attr("swAng"), g) / 60000 * math.Pi / 180
			if wr <= 0 || hr <= 0 || sw == 0 {
				continue
			}
			// the angles are as seen on the ellipse; the point at one is
			// found through the ellipse's own parameter
			param := func(a float64) float64 { return math.Atan2(wr*math.Sin(a), hr*math.Cos(a)) }
			t0 := param(st)
			t1 := param(st + sw)
			// keep the sweep's direction and size through the conversion
			for sw > 0 && t1 <= t0 {
				t1 += 2 * math.Pi
			}
			for sw < 0 && t1 >= t0 {
				t1 -= 2 * math.Pi
			}
			ox, oy := cx-wr*math.Cos(t0), cy-hr*math.Sin(t0)
			n := int(math.Ceil(math.Abs(t1-t0) / (math.Pi / 2)))
			if n < 1 {
				n = 1
			}
			step := (t1 - t0) / float64(n)
			k := 4.0 / 3 * math.Tan(step/4)
			for j := 0; j < n; j++ {
				a0 := t0 + step*float64(j)
				a1 := a0 + step
				x0, y0 := ox+wr*math.Cos(a0), oy+hr*math.Sin(a0)
				x3, y3 := ox+wr*math.Cos(a1), oy+hr*math.Sin(a1)
				x1, y1 := x0-k*wr*math.Sin(a0), y0+k*hr*math.Cos(a0)
				x2, y2 := x3+k*wr*math.Sin(a1), y3-k*hr*math.Cos(a1)
				sb.WriteString("C" + num(x1) + " " + num(y1) + " " + num(x2) + " " + num(y2) + " " + num(x3) + " " + num(y3))
				cx, cy = x3, y3
			}
		case "close":
			sb.WriteString("Z")
			cx, cy = sx, sy
		}
	}
	return sb.String()
}

// custGeomXML writes a custom outline back as <a:custGeom>
func custGeomXML(geom *CustomGeom) string {
	var sb strings.Builder
	sb.WriteString(`<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>`)
	for _, p := range geom.Paths {
		attrs := ` w="` + strconv.FormatInt(int64(math.Round(p.W)), 10) + `" h="` + strconv.FormatInt(int64(math.Round(p.H)), 10) + `"`
		if p.NoFill {
			attrs += ` fill="none"`
		}
		if p.NoStroke {
			attrs += ` stroke="0"`
		}
		sb.WriteString(`<a:path` + attrs + `>`)
		writeSvgPathAsDrawingML(&sb, p.D)
		sb.WriteString(`</a:path>`)
	}
	sb.WriteString(`</a:pathLst></a:custGeom>`)
	return sb.String()
}

// writeSvgPathAsDrawingML turns an M / L / C / Z path into path commands
func writeSvgPathAsDrawingML(sb *strings.Builder, d string) {
	ptXML := func(x, y float64) string {
		return `<a:pt x="` + strconv.FormatInt(int64(math.Round(x)), 10) + `" y="` + strconv.FormatInt(int64(math.Round(y)), 10) + `"/>`
	}
	i := 0
	for i < len(d) {
		cmd := d[i]
		i++
		j := i
		for j < len(d) && !strings.ContainsRune("MLCZ", rune(d[j])) {
			j++
		}
		var nums []float64
		for _, f := range strings.FieldsFunc(d[i:j], func(r rune) bool { return r == ' ' || r == ',' }) {
			v, err := strconv.ParseFloat(f, 64)
			if err == nil {
				nums = append(nums, v)
			}
		}
		i = j
		switch cmd {
		case 'M':
			if len(nums) >= 2 {
				sb.WriteString(`<a:moveTo>` + ptXML(nums[0], nums[1]) + `</a:moveTo>`)
			}
		case 'L':
			if len(nums) >= 2 {
				sb.WriteString(`<a:lnTo>` + ptXML(nums[0], nums[1]) + `</a:lnTo>`)
			}
		case 'C':
			if len(nums) >= 6 {
				sb.WriteString(`<a:cubicBezTo>` + ptXML(nums[0], nums[1]) + ptXML(nums[2], nums[3]) +
					ptXML(nums[4], nums[5]) + `</a:cubicBezTo>`)
			}
		case 'Z':
			sb.WriteString(`<a:close/>`)
		}
	}
}
