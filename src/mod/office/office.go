/*
Package office implements converters between the ArozOS Office suite
document models and common office file formats.

Currently implemented: PowerPoint (.pptx) import/export for the Slides
webapp (src/web/Office/slides). The JSON model mirrors the "body" schema
documented in src/web/Office/common/CONTRACT.md and slides.js:

	{ "size": [960, 540], "theme": "clean",
	  "slides": [ { "id", "bg", "notes", "objects": [
	      { "id", "type": "text|image|shape|line|table|chart",
	        "x","y","w","h","rot","z", "props": {...} } ] } ] }

This package is dependency-free (Go standard library only) and shared by
the "office" AGI library (src/mod/agi/agi.office.go). Word (.docx) and
Excel (.xlsx) converters for the Docs and Sheets webapps will live here
too, reusing the same OOXML plumbing.

Author: tobychui
*/
package office

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// EMU (English Metric Units) per pixel at 96 DPI
const emuPerPx = 9525

// Slide coordinate space used by the Slides webapp
const (
	slidePxW = 960
	slidePxH = 540
)

// Presentation is the Slides document body
type Presentation struct {
	Size   []int    `json:"size,omitempty"`
	Theme  string   `json:"theme,omitempty"`
	Slides []*Slide `json:"slides"`
}

// Slide is a single slide
type Slide struct {
	ID      string    `json:"id,omitempty"`
	Bg      string    `json:"bg,omitempty"` // "" = theme default background
	Notes   string    `json:"notes,omitempty"`
	Objects []*Object `json:"objects"`
}

// Object is one visual element on a slide
type Object struct {
	ID    string  `json:"id,omitempty"`
	Type  string  `json:"type"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Rot   float64 `json:"rot,omitempty"`
	Z     int     `json:"z,omitempty"`
	Props Props   `json:"props"`
}

// Props carries the per-type properties. Fields for every object type are
// merged into one struct so the JSON stays schema-compatible with slides.js.
type Props struct {
	// text
	HTML      string  `json:"html,omitempty"`
	FontSize  float64 `json:"fontSize,omitempty"`
	Color     string  `json:"color,omitempty"`
	Align     string  `json:"align,omitempty"`
	Bold      bool    `json:"bold,omitempty"`
	Italic    bool    `json:"italic,omitempty"`
	Underline bool    `json:"underline,omitempty"`
	// image
	Src string `json:"src,omitempty"`
	Fit string `json:"fit,omitempty"`
	// shape
	Kind      string  `json:"kind,omitempty"`
	Fill      string  `json:"fill,omitempty"`
	Stroke    string  `json:"stroke,omitempty"`
	StrokeW   float64 `json:"strokeW,omitempty"`
	Text      string  `json:"text,omitempty"`
	TextColor string  `json:"textColor,omitempty"`
	// line
	Dash     bool `json:"dash,omitempty"`
	ArrowEnd bool `json:"arrowEnd,omitempty"`
	// table
	Rows      [][]string `json:"rows,omitempty"`
	HeaderRow bool       `json:"headerRow,omitempty"`
	ColW      []float64  `json:"colW,omitempty"` // column widths, percent
	RowH      []float64  `json:"rowH,omitempty"` // row heights, percent
	// chart (spec kept opaque; Png is a client-side raster for export)
	Spec json.RawMessage `json:"spec,omitempty"`
	Png  string          `json:"png,omitempty"`
}

// theme background approximations, mirroring THEMES in slides.js
// (gradients are approximated by their first color stop for pptx export)
var themeBg = map[string]string{
	"clean":    "FFFFFF",
	"midnight": "232A36",
	"ocean":    "0F4C75",
	"sunset":   "C0392B",
	"forest":   "0F3D33",
	"paper":    "F6F1E5",
}

var themeText = map[string]string{
	"clean":    "202124",
	"midnight": "E8EAED",
	"ocean":    "F4FAFF",
	"sunset":   "FDF2EC",
	"forest":   "EAFAF1",
	"paper":    "3D3A33",
}

// PresentationToJSON serializes a Presentation back to the Slides body JSON
func PresentationToJSON(p *Presentation) (string, error) {
	if p == nil {
		return "", errors.New("nil presentation")
	}
	out, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ParsePresentationJSON decodes the Slides body JSON into a Presentation
func ParsePresentationJSON(jsonStr string) (*Presentation, error) {
	p := Presentation{}
	if err := json.Unmarshal([]byte(jsonStr), &p); err != nil {
		return nil, errors.New("invalid presentation JSON: " + err.Error())
	}
	if len(p.Slides) == 0 {
		return nil, errors.New("presentation contains no slides")
	}
	return &p, nil
}

/* ---------- shared small helpers ---------- */

func pxToEmu(px float64) int64 {
	return int64(px * emuPerPx)
}

func emuToPx(emu int64, scale float64) float64 {
	return float64(emu) / emuPerPx * scale
}

// hexColor normalizes "#rrggbb" to uppercase "RRGGBB"; returns fallback when invalid
func hexColor(c string, fallback string) string {
	c = strings.TrimPrefix(strings.TrimSpace(c), "#")
	if len(c) == 3 {
		c = string([]byte{c[0], c[0], c[1], c[1], c[2], c[2]})
	}
	ok, _ := regexp.MatchString("^[0-9a-fA-F]{6}$", c)
	if !ok {
		return fallback
	}
	return strings.ToUpper(c)
}

// xmlEscape escapes a string for use inside XML text nodes and attributes
func xmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}

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
func htmlToLines(h string) []string {
	if h == "" {
		return []string{""}
	}
	s := flattenListMarkers(h)
	s = brRe.ReplaceAllString(s, "\n")
	s = blockCloseRe.ReplaceAllString(s, "\n")
	s = blockOpenRe.ReplaceAllString(s, "")
	s = tagRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
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
		esc[i] = xmlEscape(l)
	}
	return strings.Join(esc, "<br>")
}

// dataURL decodes a data:image/...;base64,... URL. Returns bytes, file
// extension (png/jpeg/gif) and ok.
func decodeDataURL(durl string) ([]byte, string, bool) {
	if !strings.HasPrefix(durl, "data:image/") {
		return nil, "", false
	}
	comma := strings.Index(durl, ",")
	if comma < 0 {
		return nil, "", false
	}
	header := durl[:comma]
	if !strings.Contains(header, ";base64") {
		return nil, "", false
	}
	ext := "png"
	if strings.HasPrefix(header, "data:image/jpeg") || strings.HasPrefix(header, "data:image/jpg") {
		ext = "jpeg"
	} else if strings.HasPrefix(header, "data:image/gif") {
		ext = "gif"
	} else if !strings.HasPrefix(header, "data:image/png") {
		return nil, "", false
	}
	raw, err := base64.StdEncoding.DecodeString(durl[comma+1:])
	if err != nil {
		return nil, "", false
	}
	return raw, ext, true
}

// encodeDataURL builds a data URL from raw image bytes
func encodeDataURL(data []byte, ext string) string {
	mime := "image/png"
	switch strings.ToLower(ext) {
	case "jpg", "jpeg":
		mime = "image/jpeg"
	case "gif":
		mime = "image/gif"
	case "bmp":
		mime = "image/bmp"
	case "svg":
		mime = "image/svg+xml"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}
