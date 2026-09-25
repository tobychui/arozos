package office

/*
	pptx_lines.go - how a line looks at its ends and along its length.

	The Slides editor offers what Google Slides does: six dash styles and ten
	line ends (none, a line arrow, a filled arrow, circle, square and
	diamond, and open versions of the last four), per end. PresentationML
	has a richer dash vocabulary but fewer ends - no square and nothing
	open - so a square end is written as the diamond it is a turn of, and an
	open end as its filled shape. The editor's own copy of the document
	(embedded in the .pptx) keeps the exact choice.

	A document written before these existed says only dash / arrowEnd /
	arrowStart; those still mean a plain dash and a filled arrow.
*/

// prstDashFor is the <a:prstDash> preset for an object's dash, or "" for a
// solid line
func prstDashFor(p Props) string {
	switch p.DashStyle {
	case "dot":
		return "sysDot"
	case "dash":
		return "dash"
	case "dashDot":
		return "dashDot"
	case "longDash":
		return "lgDash"
	case "longDashDot":
		return "lgDashDot"
	case "solid":
		return ""
	}
	if p.Dash {
		return "dash"
	}
	return ""
}

// dashStyleForPrst reads a <a:prstDash> preset as the editor's dash style
// ("" for solid)
func dashStyleForPrst(v string) string {
	switch v {
	case "sysDot", "dot":
		return "dot"
	case "sysDash", "dash":
		return "dash"
	case "dashDot", "sysDashDot":
		return "dashDot"
	case "lgDash":
		return "longDash"
	case "lgDashDot", "lgDashDotDot", "sysDashDotDot":
		return "longDashDot"
	}
	return ""
}

// lineHeadOf is the end an object has at its start or its end ("" for
// none), falling back to the old arrowStart / arrowEnd flags
func lineHeadOf(p Props, end bool) string {
	head, legacy := p.StartHead, p.ArrowStart
	if end {
		head, legacy = p.EndHead, p.ArrowEnd
	}
	if head == "none" {
		return ""
	}
	if head != "" {
		return head
	}
	if legacy {
		return "triangle"
	}
	return ""
}

// lineEndType is the DrawingML <a:headEnd>/<a:tailEnd> type for an end
func lineEndType(head string) string {
	switch head {
	case "arrow":
		return "arrow"
	case "triangle", "openTriangle":
		return "triangle"
	case "circle", "openCircle":
		return "oval"
	case "square", "openSquare", "diamond", "openDiamond":
		return "diamond"
	}
	return ""
}

// headForLineEnd reads a DrawingML end type as the editor's line end
func headForLineEnd(t string) string {
	switch t {
	case "arrow":
		return "arrow"
	case "triangle", "stealth":
		return "triangle"
	case "oval":
		return "circle"
	case "diamond":
		return "diamond"
	}
	return ""
}

// lnDashAndEnds renders the dash and the two ends inside an <a:ln>, in the
// order the schema wants them
func lnDashAndEnds(p Props, withEnds bool) string {
	out := ""
	if d := prstDashFor(p); d != "" {
		out += `<a:prstDash val="` + d + `"/>`
	}
	if !withEnds {
		return out
	}
	if t := lineEndType(lineHeadOf(p, false)); t != "" {
		out += `<a:headEnd type="` + t + `"/>`
	}
	if t := lineEndType(lineHeadOf(p, true)); t != "" {
		out += `<a:tailEnd type="` + t + `"/>`
	}
	return out
}

// readLineEnds reads the dash and the two ends of an <a:ln> into props
func readLineEnds(ln *xnode, props *Props) {
	if ln == nil {
		return
	}
	if d := ln.first("prstDash"); d != nil {
		props.DashStyle = dashStyleForPrst(d.attr("val"))
		props.Dash = props.DashStyle != ""
	}
	if he := ln.first("headEnd"); he != nil {
		if h := headForLineEnd(he.attr("type")); h != "" {
			props.StartHead, props.ArrowStart = h, true
		}
	}
	if te := ln.first("tailEnd"); te != nil {
		if h := headForLineEnd(te.attr("type")); h != "" {
			props.EndHead, props.ArrowEnd = h, true
		}
	}
}
