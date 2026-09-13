package office

/*
	html_helpers.go - small helpers for reading the editors' HTML, shared
	by the docx, odt and pdf writers.
*/

import (
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

var blockTags = map[string]bool{
	"p": true, "div": true, "h1": true, "h2": true, "h3": true, "h4": true,
	"h5": true, "h6": true, "ul": true, "ol": true, "table": true,
	"blockquote": true, "pre": true, "hr": true, "li": true,
}

func hasBlockChild(n *html.Node) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && blockTags[c.Data] {
			return true
		}
	}
	return false
}

func findHTMLNode(n *html.Node, tag string) *html.Node {
	if n.Type == html.ElementNode && n.Data == tag {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if f := findHTMLNode(c, tag); f != nil {
			return f
		}
	}
	return nil
}

func htmlAttr(n *html.Node, name string) string {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val
		}
	}
	return ""
}

// styleProp extracts one property from an inline style attribute
func styleProp(style, prop string) string {
	for _, decl := range strings.Split(style, ";") {
		kv := strings.SplitN(decl, ":", 2)
		if len(kv) == 2 && strings.TrimSpace(strings.ToLower(kv[0])) == prop {
			return strings.TrimSpace(kv[1])
		}
	}
	return ""
}

// tableColPercents reads the editor's <colgroup><col> widths (percent OR
// pixel/point units - the column resizer writes px), normalized to 100;
// equal split when absent or malformed
func tableColPercents(tbl *html.Node, cols int) []float64 {
	out := make([]float64, cols)
	got := 0
	for cg := tbl.FirstChild; cg != nil; cg = cg.NextSibling {
		if cg.Type != html.ElementNode || cg.Data != "colgroup" {
			continue
		}
		for col := cg.FirstChild; col != nil && got < cols; col = col.NextSibling {
			if col.Type != html.ElementNode || col.Data != "col" {
				continue
			}
			ws := strings.TrimSpace(styleProp(htmlAttr(col, "style"), "width"))
			num := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(ws, "%"), "px"), "pt")
			if (strings.HasSuffix(ws, "%") || strings.HasSuffix(ws, "px") || strings.HasSuffix(ws, "pt")) && num != ws {
				if v, err := strconv.ParseFloat(num, 64); err == nil && v > 0 {
					out[got] = v // any unit: normalized by the sum below
					got++
					continue
				}
			}
			got = 0 // one bad entry: fall back to the equal split
			break
		}
		break
	}
	if got != cols {
		for i := range out {
			out[i] = 100.0 / float64(cols)
		}
		return out
	}
	sum := 0.0
	for _, v := range out {
		sum += v
	}
	if sum > 0 {
		for i := range out {
			out[i] = out[i] * 100 / sum
		}
	}
	return out
}

// tableWidthPct reads the table's own inline width (px, pt or percent) as
// a percentage of the text width; 100 when absent
func tableWidthPct(tbl *html.Node) float64 {
	const textWpx = 620.0
	ws := strings.TrimSpace(styleProp(htmlAttr(tbl, "style"), "width"))
	if strings.HasSuffix(ws, "%") {
		if v, err := strconv.ParseFloat(strings.TrimSuffix(ws, "%"), 64); err == nil && v > 1 {
			if v > 100 {
				v = 100
			}
			return v
		}
	}
	px := 0.0
	if strings.HasSuffix(ws, "px") {
		px, _ = strconv.ParseFloat(strings.TrimSuffix(ws, "px"), 64)
	} else if strings.HasSuffix(ws, "pt") {
		pt, _ := strconv.ParseFloat(strings.TrimSuffix(ws, "pt"), 64)
		px = pt / 0.75
	}
	if px > 10 {
		pct := px * 100 / textWpx
		if pct > 100 {
			pct = 100
		}
		return pct
	}
	return 100
}

// cssColorHex normalizes "#rgb", "#rrggbb" or "rgb(r, g, b)" to "RRGGBB"
// ("" when unparseable or transparent)
func cssColorHex(c string) string {
	c = strings.TrimSpace(c)
	if c == "" || c == "transparent" {
		return ""
	}
	if strings.HasPrefix(c, "#") {
		return hexColor(c, "")
	}
	if strings.HasPrefix(c, "rgb") {
		open := strings.Index(c, "(")
		close := strings.Index(c, ")")
		if open < 0 || close <= open {
			return ""
		}
		parts := strings.Split(c[open+1:close], ",")
		if len(parts) < 3 {
			return ""
		}
		if len(parts) >= 4 {
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64); err == nil && a == 0 {
				return ""
			}
		}
		out := ""
		for i := 0; i < 3; i++ {
			v, err := strconv.Atoi(strings.TrimSpace(parts[i]))
			if err != nil || v < 0 || v > 255 {
				return ""
			}
			out += fmt.Sprintf("%02X", v)
		}
		return out
	}
	switch strings.ToLower(c) {
	case "black":
		return "000000"
	case "white":
		return "FFFFFF"
	case "red":
		return "FF0000"
	case "blue":
		return "0000FF"
	case "green":
		return "008000"
	case "gray", "grey":
		return "808080"
	}
	return ""
}

func textContent(n *html.Node) string {
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		if x.Type == html.TextNode {
			sb.WriteString(x.Data)
			return
		}
		if x.Type == html.ElementNode && x.Data == "br" {
			sb.WriteString("\n")
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return sb.String()
}
