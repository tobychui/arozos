package model

/*
	presentation.go - the Slides document body (src/web/Office/slides): the
	deck, its slides and the objects on them, in the editor's 960 px wide
	coordinate space.

	PowerPoint (.pptx, .ppt) and OpenDocument presentations (.odp) both
	read into it.
*/

import (
	"encoding/json"
	"errors"
	"math"
)

// Slide coordinate space used by the Slides webapp: always 960 px wide,
// and 540 tall for the default 16:9 deck. A deck of another shape keeps
// its shape (SlideSizeFor) - a 4:3 PowerPoint deck is 960x720 - so nothing
// on it is stretched to fit.
const (
	SlidePxW = 960
	SlidePxH = 540
)

// SlideSizeFor is the editor size of a slide whose source page is w x h
// (in any one unit): 960 wide and as tall as the page's shape.
func SlideSizeFor(w, h float64) (int, int) {
	if !(w > 0) || !(h > 0) {
		return SlidePxW, SlidePxH
	}
	ph := int(math.Round(float64(SlidePxW) * h / w))
	if ph < 100 || ph > 4000 {
		return SlidePxW, SlidePxH
	}
	return SlidePxW, ph
}

// dims is the deck's slide size, the 16:9 default when it states none
func (p *Presentation) Dims() (int, int) {
	if p != nil && len(p.Size) == 2 && p.Size[0] >= 100 && p.Size[1] >= 100 &&
		p.Size[0] <= 4000 && p.Size[1] <= 4000 {
		return p.Size[0], p.Size[1]
	}
	return SlidePxW, SlidePxH
}

// Presentation is the Slides document body
type Presentation struct {
	Size   []int    `json:"size,omitempty"`
	Theme  string   `json:"theme,omitempty"`
	Slides []*Slide `json:"slides"`
	// font faces the source file carried with it, so the deck renders in
	// the typeface it was designed in even where that font is not
	// installed. Empty for documents authored in the editor.
	Fonts []*EmbeddedFont `json:"fonts,omitempty"`
}

// EmbeddedFont is one @font-face the Slides editor installs for a document
type EmbeddedFont struct {
	Family string `json:"family"`
	Weight int    `json:"weight,omitempty"` // 400 or 700
	Style  string `json:"style,omitempty"`  // "" or "italic"
	Src    string `json:"src"`              // data URL
}

// Rect is a plain rectangle in slide units
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Slide is a single slide
type Slide struct {
	ID string `json:"id,omitempty"`
	Bg string `json:"bg,omitempty"` // "" = theme default background
	// a picture or gradient background, drawn over Bg (pptx p:bg with a
	// blipFill / gradFill, directly or through the theme's bgRef). The
	// editor keeps them until a colour is chosen for the slide.
	BgImage *BgImage  `json:"bgImage,omitempty"`
	BgGrad  *Gradient `json:"bgGrad,omitempty"`
	Notes   string    `json:"notes,omitempty"`
	// entry transition: "" / "none" | "fade" | "slide" | "zoom"
	Transition string    `json:"transition,omitempty"`
	Objects    []*Object `json:"objects"`
}

// BgImage is a picture that fills the slide background. X/Y/W/H place the
// whole picture in slide px - it may reach past the slide's edges, which
// clip it - or, when Tile is set, give the first tile of a repeating
// pattern.
type BgImage struct {
	Src     string  `json:"src"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	W       float64 `json:"w"`
	H       float64 `json:"h"`
	Tile    bool    `json:"tile,omitempty"`
	Opacity float64 `json:"opacity,omitempty"` // 0..1, 0 = fully opaque
}

// Gradient is a gradient fill: linear along an angle, or radial about a
// centre. Angle follows CSS (0 = towards the top, 90 = towards the right).
type Gradient struct {
	Kind  string         `json:"kind"` // "linear" | "radial"
	Angle float64        `json:"angle,omitempty"`
	CX    float64        `json:"cx,omitempty"` // radial centre, fraction of the box
	CY    float64        `json:"cy,omitempty"`
	Stops []GradientStop `json:"stops"`
}

// GradientStop is one colour of a gradient at a position from 0 to 1
type GradientStop struct {
	Pos   float64 `json:"pos"`
	Color string  `json:"color"` // #rrggbb or #rrggbbaa
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
	// text layout - set by the pptx/odp readers so an imported deck keeps
	// the typography of the file it came from. All are optional: a text
	// object without them renders on the editor's own defaults.
	FontFamily string    `json:"fontFamily,omitempty"` // CSS font stack
	VAlign     string    `json:"valign,omitempty"`     // top | middle | bottom
	Pad        []float64 `json:"pad,omitempty"`        // insets [t,r,b,l] px
	LineHeight float64   `json:"lineHeight,omitempty"` // unitless multiplier
	// image
	Src     string    `json:"src,omitempty"`
	Fit     string    `json:"fit,omitempty"`
	Crop    []float64 `json:"crop,omitempty"`    // [left,top,right,bottom] fractions
	Radius  float64   `json:"radius,omitempty"`  // corner radius, px
	Opacity float64   `json:"opacity,omitempty"` // 0..1, 0 = fully opaque
	// a shaped crop: the picture is clipped to one of the shape kinds
	// below ("" or "rect" = a plain rectangle)
	Mask  string `json:"mask,omitempty"`
	FlipH bool   `json:"flipH,omitempty"`
	FlipV bool   `json:"flipV,omitempty"`
	// picture colour: a re-colour preset key (see RECOLORS in
	// slides/slides_image.js) and the brightness / contrast offsets, where
	// 0 is "leave alone" and the range is roughly -0.9 .. 1
	Recolor  string  `json:"recolor,omitempty"`
	Bright   float64 `json:"bright,omitempty"`
	Contrast float64 `json:"contrast,omitempty"`
	// editor-only: the crop panel's aspect-ratio latch
	LockAspect bool `json:"lockAspect,omitempty"`
	// the frame the whole picture filled before it was first cropped, so
	// Reset image can put it back. Editor state - no format stores it.
	Orig *Rect `json:"orig,omitempty"`
	// shape
	Kind string `json:"kind,omitempty"`
	// the outline of a "custom" shape (pptx custGeom, pptx/custgeom.go)
	Geom *CustomGeom `json:"geom,omitempty"`
	Fill string      `json:"fill,omitempty"`
	// a gradient fill; Fill then holds its first colour for anything that
	// draws flat. On a picture, a fill (either) is painted behind it, where
	// a transparent picture lets it through.
	FillGrad  *Gradient `json:"fillGrad,omitempty"`
	Stroke    string    `json:"stroke,omitempty"`
	StrokeW   float64   `json:"strokeW,omitempty"`
	Text      string    `json:"text,omitempty"`
	TextColor string    `json:"textColor,omitempty"`
	// line
	Dash       bool `json:"dash,omitempty"`
	ArrowEnd   bool `json:"arrowEnd,omitempty"`
	ArrowStart bool `json:"arrowStart,omitempty"`
	// the line's look, as the editor's line menus set it (pptx/lines.go):
	// the dash ("" / solid, dot, dash, dashDot, longDash, longDashDot) and
	// each end (none, arrow, triangle, circle, square, diamond and their
	// open* versions). Absent, Dash / ArrowEnd / ArrowStart decide.
	DashStyle string `json:"dashStyle,omitempty"`
	StartHead string `json:"startHead,omitempty"`
	EndHead   string `json:"endHead,omitempty"`
	// a preset shape's adjustments, named and scaled as PresentationML's
	// (adj1, adj2 ... in 1/100000 of the frame): where a callout's tip
	// points, how round a corner is
	Adj map[string]float64 `json:"adj,omitempty"`
	// a text object that is a placeholder: "title", "subtitle" or "body".
	// Empty, the editor shows its prompt ("Click to add title"); the
	// .pptx writer makes it a <p:ph> again, so PowerPoint does too.
	Ph string `json:"ph,omitempty"`
	// elbow / rotated connectors imported from pptx: the polyline the
	// connector actually follows, relative to the object's x/y. Absent on
	// a plain two-point line, which is the only kind the editor draws.
	Points [][]float64 `json:"points,omitempty"`
	// table
	Rows      [][]string `json:"rows,omitempty"`
	HeaderRow bool       `json:"headerRow,omitempty"`
	ColW      []float64  `json:"colW,omitempty"` // column widths, percent
	RowH      []float64  `json:"rowH,omitempty"` // row heights, percent
	// per-cell background colours ("" = none) and the cell insets, both
	// set by the pptx reader so an imported table keeps its shading
	CellFill [][]string `json:"cellFill,omitempty"`
	CellPad  []float64  `json:"cellPad,omitempty"` // [t,r,b,l] px
	// an imported table that came with a table style: the cell fills, text
	// and rules are the style's (Stroke / StrokeW give the rule colour and
	// width, "none" for no rules), so the editor adds no look of its own
	Styled bool `json:"styled,omitempty"`
	// merged cells: [row, col, rowSpan, colSpan] for each cell that covers
	// more than itself; the cells it covers stay in Rows, empty
	Merges [][]int `json:"merges,omitempty"`
	// per-cell vertical alignment ("" = top, "middle", "bottom")
	CellAnchor [][]string `json:"cellAnchor,omitempty"`
	// chart (spec kept opaque; Png is a client-side raster for export)
	Spec json.RawMessage `json:"spec,omitempty"`
	Png  string          `json:"png,omitempty"`
	// any type: followed when clicked while presenting - "#N" (slide N)
	// or an http(s) address
	Link string `json:"link,omitempty"`
}

// theme background approximations, mirroring THEMES in slides.js
// (gradients are approximated by their first color stop for pptx export)
var ThemeBg = map[string]string{
	"clean":    "FFFFFF",
	"midnight": "232A36",
	"ocean":    "0F4C75",
	"sunset":   "C0392B",
	"forest":   "0F3D33",
	"paper":    "F6F1E5",
}

var ThemeText = map[string]string{
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

// PowerPoint's "single" line spacing is the font's line height, which is
// about 1.2 em for the fonts office documents use. A <a:lnSpc> percentage
// multiplies that, so 100% renders as CSS line-height 1.2 - checked
// against Google Slides' own PDF export of the reference decks.
const LineHeightFactor = 1.2
