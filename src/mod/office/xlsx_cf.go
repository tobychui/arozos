package office

/*
	xlsx_cf.go - conditional formatting, tab colours and the filter range in
	.xlsx.

	Sheets keeps conditional rules per cell (see sheets/sheets_cf.js):

	    cell.cf              = ["cf-a1b2", ...]   rules this cell carries, in order
	    sheet.cfDefs[id]     = {anchor, type, v1, v2, style:{bg, fc, b, i, u}}

	Excel keeps them per range: <conditionalFormatting sqref="B2:B9"> holding
	<cfRule>s whose look is a differential format (<dxf>) in styles.xml and
	whose relative references are read from the top-left cell of the range.
	The writer gathers every cell carrying a rule into rectangles, moves the
	rule's formulas from its anchor to that corner and ranks the rules the
	way the cells list them; the reader stamps each rule back onto the cells
	of its ranges.

	The editor's conditions map onto Excel's own rule types where Excel has
	one (cellIs, containsText, beginsWith, containsBlanks, ...) and onto an
	expression rule otherwise (the date tests, "text is exactly"). Excel's
	visual rules - colour scales, data bars, icon sets, top-N - have no
	counterpart in the editor and are not read.
*/

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// CfRule is one conditional format rule body (sheet.cfDefs[id])
type CfRule struct {
	Anchor string    `json:"anchor,omitempty"`
	Type   string    `json:"type"`
	V1     cfOperand `json:"v1,omitempty"`
	V2     cfOperand `json:"v2,omitempty"`
	Style  *CfStyle  `json:"style,omitempty"`
}

// CfStyle is what a matching cell gets
type CfStyle struct {
	Bg string `json:"bg,omitempty"`
	Fc string `json:"fc,omitempty"`
	B  bool   `json:"b,omitempty"`
	I  bool   `json:"i,omitempty"`
	U  bool   `json:"u,omitempty"`
}

// cfOperand is an operand "as typed": the editor stores strings, but a
// number in the JSON is accepted as well
type cfOperand string

func (o *cfOperand) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*o = cfOperand(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err == nil {
		*o = cfOperand(n.String())
		return nil
	}
	*o = ""
	return nil
}

// which operand kind each editor condition takes (sheets_cf.js CONDS)
var cfKinds = map[string]string{
	"contains": "text", "notcontains": "text", "startswith": "text", "endswith": "text", "exact": "text",
	"eq": "num", "ne": "num", "gt": "num", "gte": "num", "lt": "num", "lte": "num",
	"between": "num", "notbetween": "num",
	"dbefore": "date", "dafter": "date", "don": "date",
	"formula": "formula", "empty": "", "notempty": "",
}

var cellIsOps = map[string]string{
	"eq": "equal", "ne": "notEqual", "gt": "greaterThan", "gte": "greaterThanOrEqual",
	"lt": "lessThan", "lte": "lessThanOrEqual", "between": "between", "notbetween": "notBetween",
}

var bareRefRe = regexp.MustCompile(`^\$?[A-Za-z]{1,3}\$?[0-9]+$`)

/* ---------------- writing ---------------- */

type cfRect struct{ c1, r1, c2, r2 int }

func (r cfRect) ref() string {
	if r.c1 == r.c2 && r.r1 == r.r2 {
		return cellRef(r.c1, r.r1)
	}
	return cellRef(r.c1, r.r1) + ":" + cellRef(r.c2, r.r2)
}

// cellsToRects covers a set of cells with rectangles: runs along each row,
// then equal runs on consecutive rows merged downwards
func cellsToRects(cells [][2]int) []cfRect {
	byRow := map[int][]int{}
	for _, c := range cells {
		byRow[c[1]] = append(byRow[c[1]], c[0])
	}
	type run struct{ c1, c2 int }
	runsAt := map[run][]int{}
	for r, cols := range byRow {
		sort.Ints(cols)
		start := cols[0]
		prev := cols[0]
		for _, c := range cols[1:] {
			if c == prev {
				continue
			}
			if c != prev+1 {
				runsAt[run{start, prev}] = append(runsAt[run{start, prev}], r)
				start = c
			}
			prev = c
		}
		runsAt[run{start, prev}] = append(runsAt[run{start, prev}], r)
	}
	var out []cfRect
	for rn, rows := range runsAt {
		sort.Ints(rows)
		top := rows[0]
		prev := rows[0]
		for _, r := range rows[1:] {
			if r != prev+1 {
				out = append(out, cfRect{rn.c1, top, rn.c2, prev})
				top = r
			}
			prev = r
		}
		out = append(out, cfRect{rn.c1, top, rn.c2, prev})
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].r1 != out[b].r1 {
			return out[a].r1 < out[b].r1
		}
		return out[a].c1 < out[b].c1
	})
	return out
}

func xlQuote(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// cfOperandFormula turns an editor operand into an Excel formula term,
// moved by (dC, dR) from the rule's anchor to the range's corner
func cfOperandFormula(v cfOperand, kind string, dC, dR int) string {
	s := strings.TrimSpace(string(v))
	if s == "" {
		return `""`
	}
	if strings.HasPrefix(s, "=") {
		return addXlPrefixes(shiftFormulaRefs(s[1:], dC, dR))
	}
	if kind != "text" && bareRefRe.MatchString(s) {
		return shiftFormulaRefs(s, dC, dR)
	}
	if kind == "date" {
		if serial, ok := dateSerial(s); ok {
			return strconv.Itoa(serial)
		}
	}
	if kind != "text" && looksNumeric(s) {
		return s
	}
	return xlQuote(s)
}

// dateSerial reads the date forms the editor accepts into an Excel serial
func dateSerial(s string) (int, bool) {
	for _, layout := range []string{"2006-01-02", "2006/01/02", "2006-1-2", "2006/1/2", "01/02/2006", "1/2/2006"} {
		if t, err := time.Parse(layout, s); err == nil {
			base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
			return int(t.Sub(base).Hours() / 24), true
		}
	}
	return 0, false
}

// cfRuleXML renders one editor rule as a <cfRule> for a range whose
// top-left cell is ref, dC / dR away from the rule's anchor
func cfRuleXML(rule *CfRule, dxf, priority int, ref string, dC, dR int) string {
	kind := cfKinds[rule.Type]
	op := func(v cfOperand) string { return cfOperandFormula(v, kind, dC, dR) }
	head := func(typ, extra string) string {
		return fmt.Sprintf(`<cfRule type="%s" dxfId="%d" priority="%d"%s>`, typ, dxf, priority, extra)
	}
	formula := func(f string) string { return `<formula>` + xmlEscape(f) + `</formula>` }
	textAttr := func() string {
		s := strings.TrimSpace(string(rule.V1))
		if s == "" || strings.HasPrefix(s, "=") {
			return ""
		}
		return ` text="` + xmlEscape(s) + `"`
	}
	switch rule.Type {
	case "notempty":
		return head("notContainsBlanks", "") + formula("LEN(TRIM("+ref+"))>0") + `</cfRule>`
	case "empty":
		return head("containsBlanks", "") + formula("LEN(TRIM("+ref+"))=0") + `</cfRule>`
	case "contains":
		return head("containsText", ` operator="containsText"`+textAttr()) +
			formula("NOT(ISERROR(SEARCH("+op(rule.V1)+","+ref+")))") + `</cfRule>`
	case "notcontains":
		return head("notContainsText", ` operator="notContains"`+textAttr()) +
			formula("ISERROR(SEARCH("+op(rule.V1)+","+ref+"))") + `</cfRule>`
	case "startswith":
		o := op(rule.V1)
		return head("beginsWith", ` operator="beginsWith"`+textAttr()) +
			formula("LEFT("+ref+",LEN("+o+"))="+o) + `</cfRule>`
	case "endswith":
		o := op(rule.V1)
		return head("endsWith", ` operator="endsWith"`+textAttr()) +
			formula("RIGHT("+ref+",LEN("+o+"))="+o) + `</cfRule>`
	case "exact":
		return head("expression", "") + formula("LOWER("+ref+")=LOWER("+op(rule.V1)+")") + `</cfRule>`
	case "eq", "ne", "gt", "gte", "lt", "lte":
		return head("cellIs", ` operator="`+cellIsOps[rule.Type]+`"`) + formula(op(rule.V1)) + `</cfRule>`
	case "between", "notbetween":
		return head("cellIs", ` operator="`+cellIsOps[rule.Type]+`"`) +
			formula(op(rule.V1)) + formula(op(rule.V2)) + `</cfRule>`
	case "dbefore", "dafter", "don":
		cmp := map[string]string{"dbefore": "<", "dafter": ">", "don": "="}[rule.Type]
		return head("expression", "") +
			formula("AND(ISNUMBER("+ref+"),INT("+ref+")"+cmp+"INT("+op(rule.V1)+"))") + `</cfRule>`
	case "formula":
		f := strings.TrimSpace(string(rule.V1))
		if f == "" {
			return ""
		}
		return head("expression", "") + formula(addXlPrefixes(shiftFormulaRefs(strings.TrimPrefix(f, "="), dC, dR))) + `</cfRule>`
	}
	return ""
}

// dxf renders a rule's style as a differential format and returns its index
func (t *xlsxStyleTable) dxf(st *CfStyle) int {
	var sb strings.Builder
	sb.WriteString("<dxf>")
	if st != nil && (st.B || st.I || st.U || st.Fc != "") {
		sb.WriteString("<font>")
		if st.B {
			sb.WriteString("<b/>")
		}
		if st.I {
			sb.WriteString("<i/>")
		}
		if st.U {
			sb.WriteString(`<u/>`)
		}
		if st.Fc != "" {
			sb.WriteString(`<color rgb="FF` + hexColor(st.Fc, "000000") + `"/>`)
		}
		sb.WriteString("</font>")
	}
	if st != nil && st.Bg != "" {
		sb.WriteString(`<fill><patternFill patternType="solid"><bgColor rgb="FF` + hexColor(st.Bg, "FFFFFF") + `"/></patternFill></fill>`)
	}
	sb.WriteString("</dxf>")
	x := sb.String()
	if i, ok := t.dxfIdx[x]; ok {
		return i
	}
	t.dxfs = append(t.dxfs, x)
	t.dxfIdx[x] = len(t.dxfs) - 1
	return len(t.dxfs) - 1
}

// conditionalFormattingXML renders a sheet's rules; priority numbers run
// on across the sheet
func conditionalFormattingXML(ws *WorkSheet, styles *xlsxStyleTable) string {
	if len(ws.CfDefs) == 0 {
		return ""
	}
	cells := map[string][][2]int{}
	rank := map[string]int{} // the earliest place a cell lists the rule
	for key, cell := range ws.Cells {
		if cell == nil || len(cell.Cf) == 0 {
			continue
		}
		col, row, ok := parseCellRef(key)
		if !ok {
			continue
		}
		for i, id := range cell.Cf {
			if _, ok := ws.CfDefs[id]; !ok {
				continue
			}
			cells[id] = append(cells[id], [2]int{col, row})
			if r, ok := rank[id]; !ok || i < r {
				rank[id] = i
			}
		}
	}
	ids := make([]string, 0, len(cells))
	for id := range cells {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(a, b int) bool {
		if rank[ids[a]] != rank[ids[b]] {
			return rank[ids[a]] < rank[ids[b]]
		}
		return ids[a] < ids[b]
	})

	var sb strings.Builder
	priority := 0
	for _, id := range ids {
		rule := ws.CfDefs[id]
		rects := cellsToRects(cells[id])
		if rule == nil || len(rects) == 0 {
			continue
		}
		top := rects[0]
		dC, dR := 0, 0
		if ac, ar, ok := parseCellRef(rule.Anchor); ok {
			dC, dR = top.c1-ac, top.r1-ar
		}
		priority++
		x := cfRuleXML(rule, styles.dxf(rule.Style), priority, cellRef(top.c1, top.r1), dC, dR)
		if x == "" {
			priority--
			continue
		}
		refs := make([]string, len(rects))
		for i, r := range rects {
			refs[i] = r.ref()
		}
		sb.WriteString(`<conditionalFormatting sqref="` + strings.Join(refs, " ") + `">` + x + `</conditionalFormatting>`)
	}
	return sb.String()
}

// filterRange is the range of a sheet's filter blob ({range: "A1:D20", ...})
func filterRange(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var f struct {
		Range string `json:"range"`
	}
	if json.Unmarshal(raw, &f) != nil {
		return ""
	}
	parts := strings.Split(strings.TrimSpace(f.Range), ":")
	if len(parts) != 2 {
		return ""
	}
	if _, _, ok := parseCellRef(parts[0]); !ok {
		return ""
	}
	if _, _, ok := parseCellRef(parts[1]); !ok {
		return ""
	}
	return strings.ToUpper(parts[0]) + ":" + strings.ToUpper(parts[1])
}

// absRange turns "A1:D20" into "$A$1:$D$20" for a defined name
func absRange(r string) string {
	parts := strings.Split(r, ":")
	for i, p := range parts {
		if c, row, ok := parseCellRef(p); ok {
			parts[i] = "$" + colName(c) + "$" + strconv.Itoa(row+1)
		}
	}
	return strings.Join(parts, ":")
}

/* ---------------- reading ---------------- */

// maxCfCells bounds how many cells one sheet's rules are stamped onto: a
// rule over whole columns would otherwise create a million cells
const maxCfCells = 50000

// parseDxfs reads styles.xml's differential formats
func parseDxfs(data []byte) []*CfStyle {
	if len(data) == 0 {
		return nil
	}
	tree, err := parseXMLTree(data)
	if err != nil {
		return nil
	}
	node := tree.first("dxfs")
	if node == nil {
		return nil
	}
	var out []*CfStyle
	for _, d := range node.all("dxf") {
		st := &CfStyle{}
		if f := d.first("font"); f != nil {
			st.B = f.first("b") != nil && f.first("b").attr("val") != "0"
			st.I = f.first("i") != nil && f.first("i").attr("val") != "0"
			st.U = f.first("u") != nil && f.first("u").attr("val") != "none"
			st.Fc = argbToHex(f.first("color").attr("rgb"))
		}
		if pf := d.path("fill", "patternFill"); pf != nil {
			if bg := argbToHex(pf.first("bgColor").attr("rgb")); bg != "" {
				st.Bg = bg
			} else {
				st.Bg = argbToHex(pf.first("fgColor").attr("rgb"))
			}
		}
		out = append(out, st)
	}
	return out
}

func argbToHex(v string) string {
	v = strings.TrimSpace(v)
	if len(v) == 8 {
		v = v[2:]
	}
	if len(v) != 6 {
		return ""
	}
	if _, err := strconv.ParseUint(v, 16, 32); err != nil {
		return ""
	}
	return "#" + strings.ToLower(v)
}

// cfOperandFromXl turns an Excel formula term back into what the editor
// shows in an operand box
func cfOperandFromXl(f string) cfOperand {
	f = strings.TrimSpace(f)
	if looksNumeric(f) {
		return cfOperand(f)
	}
	if len(f) >= 2 && strings.HasPrefix(f, `"`) && strings.HasSuffix(f, `"`) {
		return cfOperand(strings.ReplaceAll(f[1:len(f)-1], `""`, `"`))
	}
	return cfOperand("=" + stripXlPrefixes(f))
}

// parseSheetExtras reads the tab colour, the filter range and the
// conditional formats of one worksheet
func parseSheetExtras(tree *xnode, ws *WorkSheet, dxfs []*CfStyle) {
	if tc := tree.path("sheetPr", "tabColor"); tc != nil {
		ws.Color = argbToHex(tc.attr("rgb"))
	}
	if af := tree.first("autoFilter"); af != nil {
		if r := strings.ReplaceAll(af.attr("ref"), "$", ""); r != "" {
			if b, err := json.Marshal(map[string]interface{}{"range": r}); err == nil {
				ws.Filter = b
			}
		}
	}

	type found struct {
		rule     *CfRule
		priority int
		rects    []cfRect
	}
	var rules []found
	for _, cf := range tree.all("conditionalFormatting") {
		var rects []cfRect
		for _, r := range strings.Fields(cf.attr("sqref")) {
			if c1, r1, c2, r2, ok := parseRangeRef(r); ok {
				rects = append(rects, cfRect{c1, r1, c2, r2})
			}
		}
		if len(rects) == 0 {
			continue
		}
		for _, cr := range cf.all("cfRule") {
			rule := cfRuleFromXl(cr)
			if rule == nil {
				continue
			}
			rule.Anchor = cellRef(rects[0].c1, rects[0].r1)
			if id, err := strconv.Atoi(cr.attr("dxfId")); err == nil && id >= 0 && id < len(dxfs) {
				st := *dxfs[id]
				rule.Style = &st
			} else {
				rule.Style = &CfStyle{}
			}
			pr, _ := strconv.Atoi(cr.attr("priority"))
			rules = append(rules, found{rule, pr, rects})
		}
	}
	if len(rules) == 0 {
		return
	}
	sort.SliceStable(rules, func(a, b int) bool { return rules[a].priority < rules[b].priority })
	ws.CfDefs = map[string]*CfRule{}
	stamped := 0
	for i, f := range rules {
		id := fmt.Sprintf("cf-x%d", i+1)
		n := 0
		for _, rc := range f.rects {
			n += (rc.c2 - rc.c1 + 1) * (rc.r2 - rc.r1 + 1)
		}
		if stamped+n > maxCfCells {
			continue // a whole-column rule: more cells than the editor models
		}
		stamped += n
		ws.CfDefs[id] = f.rule
		for _, rc := range f.rects {
			for r := rc.r1; r <= rc.r2; r++ {
				for c := rc.c1; c <= rc.c2; c++ {
					k := cellRef(c, r)
					cell := ws.Cells[k]
					if cell == nil {
						cell = &WorkCell{}
						ws.Cells[k] = cell
					}
					cell.Cf = append(cell.Cf, id)
				}
			}
		}
	}
	if len(ws.CfDefs) == 0 {
		ws.CfDefs = nil
	}
}

var xlOpToCond = map[string]string{
	"equal": "eq", "notEqual": "ne", "greaterThan": "gt", "greaterThanOrEqual": "gte",
	"lessThan": "lt", "lessThanOrEqual": "lte", "between": "between", "notBetween": "notbetween",
}

// cfRuleFromXl maps an Excel rule onto an editor condition (nil when the
// editor has none)
func cfRuleFromXl(cr *xnode) *CfRule {
	formulas := cr.all("formula")
	fText := func(i int) string {
		if i < len(formulas) {
			return formulas[i].Text
		}
		return ""
	}
	text := cr.attr("text")
	switch cr.attr("type") {
	case "cellIs":
		cond, ok := xlOpToCond[cr.attr("operator")]
		if !ok || len(formulas) == 0 {
			return nil
		}
		r := &CfRule{Type: cond, V1: cfOperandFromXl(fText(0))}
		if cond == "between" || cond == "notbetween" {
			r.V2 = cfOperandFromXl(fText(1))
		}
		return r
	case "containsText":
		return textRule("contains", text)
	case "notContainsText":
		return textRule("notcontains", text)
	case "beginsWith":
		return textRule("startswith", text)
	case "endsWith":
		return textRule("endswith", text)
	case "containsBlanks":
		return &CfRule{Type: "empty"}
	case "notContainsBlanks":
		return &CfRule{Type: "notempty"}
	case "expression":
		if f := strings.TrimSpace(fText(0)); f != "" {
			return &CfRule{Type: "formula", V1: cfOperand("=" + stripXlPrefixes(f))}
		}
	}
	return nil
}

func textRule(cond, text string) *CfRule {
	if text == "" {
		return nil
	}
	return &CfRule{Type: cond, V1: cfOperand(text)}
}
