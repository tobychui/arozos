package office

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

/*
	pptx_adjust.go - preset shape adjustments.

	A preset shape's adjustments are its <a:avLst> guides: named values in
	1/100000 of the frame (adj1, adj2 ...). The editor honours them for the
	speech-bubble callouts, whose tip they place (SlidesShapes in
	slides_shapes.js draws the same geometry PowerPoint does), and keeps
	them in props.adj under the same names.

	A callout the editor made before adjustments existed has none: it drew
	its body in the top part of the frame and the tip at the bottom. Written
	as it is, PowerPoint would stretch the body over the whole frame, so it
	is written the way the editor converts it when its tip is first dragged:
	the frame shrunk to the body, the tip stated where it was.
*/

// calloutDefaults are PresentationML's defaults for the callouts the
// editor adjusts
var calloutDefaults = map[string]map[string]float64{
	"wedgeRectCallout":      {"adj1": -20833, "adj2": 62500},
	"wedgeRoundRectCallout": {"adj1": -20833, "adj2": 62500, "adj3": 16667},
	"wedgeEllipseCallout":   {"adj1": -20833, "adj2": 62500},
	"cloudCallout":          {"adj1": -20833, "adj2": 62500},
}

// calloutLegacy is how the unadjusted drawings looked: where the tip was
// (fractions of the frame) and how much of the frame the body took
var calloutLegacy = map[string]struct{ tipX, tipY, body, round float64 }{
	"wedgeRectCallout":      {0.2, 1, 0.72, 0},
	"wedgeRoundRectCallout": {0.2, 1, 0.72, 0.18},
	"wedgeEllipseCallout":   {0.16, 1, 0.72, 0},
	"cloudCallout":          {0.13, 0.96, 0.74, 0},
}

// readShapeAdj reads the adjustments of a callout the editor draws with
// them, filled in with PresentationML's defaults; nil for any other shape
func readShapeAdj(prst string, spPr *xnode) map[string]float64 {
	def, ok := calloutDefaults[prst]
	if !ok {
		return nil
	}
	out := map[string]float64{}
	for k, v := range def {
		out[k] = v
	}
	if g := spPr.first("prstGeom"); g != nil {
		if av := g.first("avLst"); av != nil {
			for _, gd := range av.all("gd") {
				name := gd.attr("name")
				if _, known := def[name]; !known {
					continue
				}
				if v := strings.TrimPrefix(gd.attr("fmla"), "val "); v != gd.attr("fmla") {
					out[name] = atofDefault(v, out[name])
				}
			}
		}
	}
	return out
}

// calloutFrame is the frame height and the adjustments a callout is
// written with: its own, or those of the conversion of an old one
func calloutFrame(kind string, w, h float64, adj map[string]float64) (float64, map[string]float64) {
	def, ok := calloutDefaults[kind]
	if !ok {
		return h, nil
	}
	out := map[string]float64{}
	for k, v := range def {
		out[k] = v
	}
	if len(adj) > 0 {
		for k, v := range adj {
			out[k] = v
		}
		return h, out
	}
	lg := calloutLegacy[kind]
	bodyH := math.Max(8, h*lg.body)
	if w > 0 {
		out["adj1"] = math.Round((lg.tipX*w - w/2) / w * 100000)
	}
	out["adj2"] = math.Round((lg.tipY*h - bodyH/2) / bodyH * 100000)
	if lg.round > 0 {
		out["adj3"] = math.Round(lg.round * 100000)
	}
	return bodyH, out
}

// avLstXML renders adjustments as the guides of an <a:avLst>, in name order
func avLstXML(adj map[string]float64) string {
	if len(adj) == 0 {
		return `<a:avLst/>`
	}
	names := make([]string, 0, len(adj))
	for k := range adj {
		names = append(names, k)
	}
	sort.Strings(names)
	var sb strings.Builder
	sb.WriteString(`<a:avLst>`)
	for _, k := range names {
		sb.WriteString(fmt.Sprintf(`<a:gd name="%s" fmla="val %d"/>`, xmlEscape(k), int64(math.Round(adj[k]))))
	}
	sb.WriteString(`</a:avLst>`)
	return sb.String()
}
