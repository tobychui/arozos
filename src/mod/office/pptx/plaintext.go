package pptx

import (
	"regexp"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/xmltree"
)

var brRe = regexp.MustCompile(`(?i)<br\s*/?>`)

var blockCloseRe = regexp.MustCompile(`(?i)</(div|p|li|h[1-6])>`)

var blockOpenRe = regexp.MustCompile(`(?i)<(div|p|li|h[1-6])(\s[^>]*)?>`)

var tagRe = regexp.MustCompile(`<[^>]*>`)

var listTagRe = regexp.MustCompile(`(?i)<(/?)(ul|ol|li)(\s[^>]*)?>`)

// flattenListMarkers rewrites <ul>/<ol>/<li> into text lines with visible
// bullet / number prefixes so lists survive flattening (e.g. pptx export)
func flattenListMarkers(s string) string {
	type listCtx struct {
		ordered bool
		counter int
	}
	var stack []listCtx
	var out strings.Builder
	last := 0
	for _, m := range listTagRe.FindAllStringSubmatchIndex(s, -1) {
		out.WriteString(s[last:m[0]])
		last = m[1]
		closing := m[2] != m[3] // group 1 non-empty = "/"
		tag := strings.ToLower(s[m[4]:m[5]])
		switch tag {
		case "ul", "ol":
			if closing {
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
			} else {
				stack = append(stack, listCtx{ordered: tag == "ol"})
				out.WriteString("\n")
			}
		case "li":
			if closing {
				out.WriteString("\n")
			} else {
				indent := strings.Repeat("  ", maxInt(0, len(stack)-1))
				if len(stack) > 0 && stack[len(stack)-1].ordered {
					stack[len(stack)-1].counter++
					out.WriteString(indent + strconv.Itoa(stack[len(stack)-1].counter) + ". ")
				} else {
					out.WriteString(indent + "• ")
				}
			}
		}
	}
	out.WriteString(s[last:])
	// collapse the double newlines produced by adjacent list boundaries
	return strings.TrimPrefix(multiNlRe.ReplaceAllString(out.String(), "\n"), "\n")
}

var multiNlRe = regexp.MustCompile(`\n{2,}`)

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// htmlToLines flattens the limited contenteditable HTML stored in text
// objects into plain-text lines (one per paragraph)
func HtmlToLines(h string) []string {
	if h == "" {
		return []string{""}
	}
	s := flattenListMarkers(h)
	s = brRe.ReplaceAllString(s, "\n")
	s = blockCloseRe.ReplaceAllString(s, "\n")
	s = blockOpenRe.ReplaceAllString(s, "")
	s = tagRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	// zero-width spaces are line-height padding the readers insert, not text
	s = strings.ReplaceAll(s, "&#8203;", "")
	s = strings.ReplaceAll(s, "&#x200b;", "")
	s = strings.ReplaceAll(s, "​", "")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&apos;", "'")
	s = strings.ReplaceAll(s, "&amp;", "&")
	lines := strings.Split(s, "\n")
	// drop a single trailing empty line produced by a closing block tag
	if len(lines) > 1 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// linesToHTML converts plain-text lines back to the storage HTML format
func linesToHTML(lines []string) string {
	esc := make([]string, len(lines))
	for i, l := range lines {
		esc[i] = xmltree.Escape(l)
	}
	return strings.Join(esc, "<br>")
}
