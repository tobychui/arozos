package office

/*
	pptx_chart.go - read a DrawingML chart part into the Slides editor's
	chart object.

	A chart on a slide is a graphicFrame pointing at a ppt/charts/chartN.xml
	part, which carries both a reference to the spreadsheet the numbers came
	from and a *cache* of the values as they were last drawn. The cache is
	what makes this possible without opening the embedded workbook: it holds
	the category labels and every series' numbers, which is exactly the shape
	OfficeCharts renders from.

	Only the chart kinds the editor can draw are read (bar/column, line,
	area, pie, doughnut); anything else - scatter, radar, surface, stock,
	3-D variants with no flat equivalent - is left alone, and its frame is
	skipped rather than drawn as something it is not.
*/

import (
	"encoding/json"
	"strconv"
	"strings"
)

// chartSpec mirrors the spec OfficeCharts (common/charts.js) renders
type chartSpec struct {
	Type    string           `json:"type"`
	Title   string           `json:"title,omitempty"`
	Labels  []string         `json:"labels"`
	Series  []chartSeries    `json:"series"`
	Options chartSpecOptions `json:"options"`
}

type chartSeries struct {
	Name   string    `json:"name,omitempty"`
	Values []float64 `json:"values"`
	Color  string    `json:"color,omitempty"`
}

type chartSpecOptions struct {
	Legend    bool `json:"legend"`
	Gridlines bool `json:"gridlines"`
	Stacked   bool `json:"stacked,omitempty"`
}

// pptxChartKinds maps the plot element name onto an editor chart type
var pptxChartKinds = []struct{ node, kind string }{
	{"barChart", "bar"}, {"bar3DChart", "bar"},
	{"lineChart", "line"}, {"line3DChart", "line"},
	{"areaChart", "line"}, {"area3DChart", "line"},
	{"pieChart", "pie"}, {"pie3DChart", "pie"},
	{"doughnutChart", "pie"}, {"ofPieChart", "pie"},
}

// parseChartSpec turns a chartSpace tree into the editor's chart spec.
// Returns nil when the chart is of a kind the editor cannot draw or has
// no cached values to draw.
func (sc *slideCtx) parseChartSpec(tree *xnode) *chartSpec {
	chart := tree.first("chart")
	if chart == nil {
		return nil
	}
	plotArea := chart.first("plotArea")
	if plotArea == nil {
		return nil
	}
	var plot *xnode
	kind := ""
	for _, cand := range pptxChartKinds {
		if n := plotArea.first(cand.node); n != nil {
			plot, kind = n, cand.kind
			break
		}
	}
	if plot == nil {
		return nil
	}

	spec := &chartSpec{Type: kind, Labels: []string{}, Series: []chartSeries{}}
	if t := chart.first("title"); t != nil && chart.first("autoTitleDeleted").attr("val") != "1" {
		var texts []string
		collectText(t, &texts)
		spec.Title = strings.TrimSpace(strings.Join(texts, ""))
	}
	if g := plot.first("grouping"); g != nil {
		v := g.attr("val")
		spec.Options.Stacked = v == "stacked" || v == "percentStacked"
	}
	spec.Options.Legend = chart.first("legend") != nil
	for _, ax := range plotArea.all("valAx") {
		if ax.first("majorGridlines") != nil {
			spec.Options.Gridlines = true
		}
	}

	for _, ser := range plot.all("ser") {
		values := cachedNumbers(ser.first("val"))
		if len(values) == 0 {
			continue
		}
		s := chartSeries{Values: values}
		if names := cachedStrings(ser.first("tx")); len(names) > 0 {
			s.Name = names[0]
		}
		if c := sc.cc.solidColorOf(ser.first("spPr")); c != "" {
			s.Color = c
		}
		if len(spec.Labels) == 0 {
			spec.Labels = cachedStrings(ser.first("cat"))
		}
		spec.Series = append(spec.Series, s)
	}
	if len(spec.Series) == 0 {
		return nil
	}
	// a chart with no category cache still needs one label per point
	if len(spec.Labels) == 0 {
		for i := range spec.Series[0].Values {
			spec.Labels = append(spec.Labels, strconv.Itoa(i+1))
		}
	}
	return spec
}

// cachedPoints reads the <c:pt> cache under a chart reference, in index
// order, filling gaps so a sparse cache does not shift the series
func cachedPoints(holder *xnode) []string {
	if holder == nil {
		return nil
	}
	var cache *xnode
	for _, ref := range []string{"strRef", "numRef", "multiLvlStrRef"} {
		if r := holder.first(ref); r != nil {
			for _, cn := range []string{"strCache", "numCache", "lvl"} {
				if c := r.first(cn); c != nil {
					cache = c
					break
				}
			}
		}
		if cache != nil {
			break
		}
	}
	if cache == nil {
		// literal values, written when the chart has no source range
		for _, lit := range []string{"strLit", "numLit"} {
			if c := holder.first(lit); c != nil {
				cache = c
				break
			}
		}
	}
	if cache == nil {
		return nil
	}
	count := int(atofDefault(cache.first("ptCount").attr("val"), 0))
	pts := cache.all("pt")
	if count <= 0 {
		count = len(pts)
	}
	if count <= 0 {
		return nil
	}
	out := make([]string, count)
	for _, pt := range pts {
		idx := int(atofDefault(pt.attr("idx"), -1))
		if idx < 0 || idx >= count {
			continue
		}
		if v := pt.first("v"); v != nil {
			out[idx] = v.Text
		}
	}
	return out
}

func cachedStrings(holder *xnode) []string {
	return cachedPoints(holder)
}

func cachedNumbers(holder *xnode) []float64 {
	raw := cachedPoints(holder)
	if len(raw) == 0 {
		return nil
	}
	out := make([]float64, len(raw))
	for i, s := range raw {
		out[i] = atofDefault(strings.TrimSpace(s), 0)
	}
	return out
}

// chartSpecJSON serializes a spec for Props.Spec
func chartSpecJSON(spec *chartSpec) json.RawMessage {
	if spec == nil {
		return nil
	}
	b, err := json.Marshal(spec)
	if err != nil {
		return nil
	}
	return json.RawMessage(b)
}
