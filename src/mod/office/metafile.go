package office

/*
	metafile.go - Windows metafiles (WMF / EMF) as pictures a browser can show

	Decks and documents made with older Office versions often carry their
	pictures as Windows metafiles: a scanned figure pasted into PowerPoint
	2003 is stored as a .wmf whose only drawing record stretches one DIB
	over the frame, and diagrams are .emf drawings. No browser decodes
	either format, so the editor showed an empty frame. The import plays
	the metafile into a raster image instead (metafile_wmf.go and
	metafile_emf.go read the records; this file holds the canvas they draw
	on and the DIB decoder both formats share).

	Supported: bitmap records (stretched, mirrored, the common raster ops),
	pens and brushes, lines, polylines, polygons, rectangles, rounded
	rectangles, ellipses, arcs / pies / chords, Bezier curves, EMF paths,
	world transforms and text. Clipping regions and EMF+ records (the dual
	EMF+ files carry a plain EMF fallback that is played instead) are not.

	A picture that is only bitmaps is rendered at the bitmap's own
	resolution so no detail is lost or invented; a drawing is rendered at
	twice its 96 DPI size so it stays sharp on a high density screen.
*/

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"strings"
	"sync"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gobolditalic"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/gomono"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/f64"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

const (
	// the largest picture a metafile is rendered to
	mfMaxSide   = 4096
	mfMaxPixels = 16 << 20
	// the largest DIB decoded out of a metafile
	mfMaxDIBPixels = 64 << 20
)

var errNotMetafile = errors.New("not a WMF or EMF metafile")

// metafileKind reports "wmf", "emf" or "" from the leading bytes
func metafileKind(data []byte) string {
	if len(data) >= 44 && binary.LittleEndian.Uint32(data) == 1 && string(data[40:44]) == " EMF" {
		return "emf"
	}
	if len(data) >= 4 && binary.LittleEndian.Uint32(data) == 0x9AC6CDD7 {
		return "wmf"
	}
	if len(data) >= 18 {
		typ := binary.LittleEndian.Uint16(data)
		hs := binary.LittleEndian.Uint16(data[2:])
		ver := binary.LittleEndian.Uint16(data[4:])
		if (typ == 1 || typ == 2) && hs == 9 && (ver == 0x100 || ver == 0x300) {
			return "wmf"
		}
	}
	return ""
}

// browserPicture returns a picture in a format the browser can draw. A
// Windows metafile is rendered to PNG (or JPEG for a photo); any other
// picture comes back unchanged. ok is false only for a metafile that
// could not be rendered.
func browserPicture(data []byte, ext string) ([]byte, string, bool) {
	ext = strings.ToLower(ext)
	kind := metafileKind(data)
	if kind == "" && ext != "wmf" && ext != "emf" {
		return data, ext, true
	}
	out, outExt, err := metafileToImage(data)
	if err != nil {
		return data, ext, false
	}
	return out, outExt, true
}

// metafileToImage renders a WMF or EMF and encodes the result
func metafileToImage(data []byte) ([]byte, string, error) {
	img, photo, err := renderMetafile(data)
	if err != nil {
		return nil, "", err
	}
	var buf bytes.Buffer
	if photo {
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "jpeg", nil
	}
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "png", nil
}

// mfPlayer is one metafile format's record reader
type mfPlayer interface {
	// baseSize is the picture's size in CSS pixels (96 DPI)
	baseSize() (float64, float64)
	// play draws every record onto the canvas
	play(c *mfCanvas) error
}

// renderMetafile plays a metafile twice: once to measure the bitmaps it
// holds (which decides the output resolution) and once to draw. photo
// reports a picture that is only photographic bitmaps, best kept as JPEG.
func renderMetafile(data []byte) (image.Image, bool, error) {
	var p mfPlayer
	var err error
	switch metafileKind(data) {
	case "wmf":
		p, err = newWmfPlayer(data)
	case "emf":
		p, err = newEmfPlayer(data)
	default:
		return nil, false, errNotMetafile
	}
	if err != nil {
		return nil, false, err
	}
	bw, bh := p.baseSize()
	if !(bw >= 1 && bh >= 1) || math.IsInf(bw, 0) || math.IsInf(bh, 0) {
		return nil, false, errors.New("metafile has no usable picture frame")
	}

	measure := newMfCanvas(bw, bh, 1, true)
	if err := p.play(measure); err != nil {
		return nil, false, err
	}
	if !measure.drewBitmap && !measure.drewVector {
		return nil, false, errors.New("metafile holds nothing that can be drawn")
	}
	scale := 2.0
	if !measure.drewVector && measure.maxRatio > 0 {
		scale = measure.maxRatio
	} else if measure.maxRatio > scale {
		scale = measure.maxRatio
	}
	scale = math.Min(scale, mfMaxSide/math.Max(bw, bh))
	scale = math.Min(scale, math.Sqrt(mfMaxPixels/(bw*bh)))
	if bw*scale < 1 || bh*scale < 1 {
		scale = math.Max(1/bw, 1/bh)
	}

	c := newMfCanvas(bw, bh, scale, false)
	if err := p.play(c); err != nil {
		return nil, false, err
	}
	photo := measure.photo && !measure.drewVector
	if photo {
		// a scan stretched over (nearly) the whole frame: GDI shows the
		// uncovered sliver as the white page, so flatten it for JPEG
		if transparentShare(c.img) > 0.02 {
			photo = false
		} else {
			flattenOnWhite(c.img)
		}
	}
	return c.img, photo, nil
}

// transparentShare is the fraction of pixels that are not fully opaque
func transparentShare(img *image.RGBA) float64 {
	n, total := 0, 0
	for i := 3; i < len(img.Pix); i += 4 {
		total++
		if img.Pix[i] != 0xFF {
			n++
		}
	}
	if total == 0 {
		return 1
	}
	return float64(n) / float64(total)
}

// flattenOnWhite composites a premultiplied image over white in place
func flattenOnWhite(img *image.RGBA) {
	p := img.Pix
	for i := 0; i+3 < len(p); i += 4 {
		inv := 255 - uint32(p[i+3])
		p[i] = uint8(uint32(p[i]) + inv)
		p[i+1] = uint8(uint32(p[i+1]) + inv)
		p[i+2] = uint8(uint32(p[i+2]) + inv)
		p[i+3] = 255
	}
}

/* ---------------- device context ---------------- */

type mfPt struct{ X, Y float64 }

type mfPen struct {
	col   color.NRGBA
	width float64 // logical units; 0 is a one pixel cosmetic pen
	null  bool
}

type mfBrush struct {
	col  color.NRGBA
	null bool
}

type mfFont struct {
	height     float64 // logical units; < 0 is the em height, > 0 the cell height
	weight     int
	italic     bool
	underline  bool
	strike     bool
	escapement float64 // tenths of a degree, counterclockwise
	face       string
}

// mfObject is one slot of the metafile's object table; an object the
// canvas cannot use (palette, region) is a slot with nothing set
type mfObject struct {
	pen   *mfPen
	brush *mfBrush
	font  *mfFont
}

const (
	mmText        = 1
	mmLoMetric    = 2
	mmHiMetric    = 3
	mmLoEnglish   = 4
	mmHiEnglish   = 5
	mmTwips       = 6
	mmIsotropic   = 7
	mmAnisotropic = 8
)

type mfDC struct {
	pen       mfPen
	brush     mfBrush
	font      mfFont
	textColor color.NRGBA
	bkColor   color.NRGBA
	bkOpaque  bool
	textAlign uint32
	winding   bool // polygon fill mode WINDING (else ALTERNATE)

	mapMode        int
	winOrg, winExt mfPt
	vpOrg, vpExt   mfPt
	winExtSet      bool
	vpExtSet       bool
	// EMF world transform: x' = a*x + c*y + e, y' = b*x + d*y + f
	xf [6]float64

	cur mfPt
}

func defaultMfDC() mfDC {
	black := color.NRGBA{A: 255}
	white := color.NRGBA{255, 255, 255, 255}
	return mfDC{
		pen:       mfPen{col: black},
		brush:     mfBrush{col: white},
		font:      mfFont{height: -12, weight: 400},
		textColor: black,
		bkColor:   white,
		bkOpaque:  true,
		mapMode:   mmText,
		winExt:    mfPt{1, 1},
		vpExt:     mfPt{1, 1},
		xf:        [6]float64{1, 0, 0, 1, 0, 0},
	}
}

func colorRef(v uint32) color.NRGBA {
	return color.NRGBA{uint8(v), uint8(v >> 8), uint8(v >> 16), 255}
}

/* ---------------- canvas ---------------- */

type mfCanvas struct {
	img     *image.RGBA
	w, h    int
	scale   float64 // output pixels per CSS pixel
	measure bool

	// measure pass results
	maxRatio   float64 // bitmap source pixels per CSS pixel, the largest seen
	drewBitmap bool
	drewVector bool
	photo      bool // a bitmap of 16+ bits per pixel or a JPEG was drawn

	dc    mfDC
	saved []mfDC
	objs  map[uint32]*mfObject

	// toCSS maps a logical point to CSS pixels of the picture; set by the
	// player, it reads the current device context
	toCSS func(p mfPt) mfPt

	ras *vector.Rasterizer

	// EMF path bracket: subpaths in output pixels
	inPath   bool
	path     [][]mfPt
	pathOpen []bool
}

func newMfCanvas(bw, bh, scale float64, measure bool) *mfCanvas {
	c := &mfCanvas{
		scale:   scale,
		measure: measure,
		dc:      defaultMfDC(),
		objs:    map[uint32]*mfObject{},
	}
	c.w = int(math.Round(bw * scale))
	c.h = int(math.Round(bh * scale))
	if c.w < 1 {
		c.w = 1
	}
	if c.h < 1 {
		c.h = 1
	}
	if !measure {
		c.img = image.NewRGBA(image.Rect(0, 0, c.w, c.h))
		c.ras = vector.NewRasterizer(c.w, c.h)
	}
	return c
}

// px maps a logical point to output pixels
func (c *mfCanvas) px(p mfPt) mfPt {
	q := c.toCSS(p)
	return mfPt{q.X * c.scale, q.Y * c.scale}
}

// pxLen is the output length of a logical length along x and along y
func (c *mfCanvas) pxLen(v float64) (float64, float64) {
	o := c.px(mfPt{0, 0})
	x := c.px(mfPt{v, 0})
	y := c.px(mfPt{0, v})
	return math.Hypot(x.X-o.X, x.Y-o.Y), math.Hypot(y.X-o.X, y.Y-o.Y)
}

func (c *mfCanvas) save() {
	c.saved = append(c.saved, c.dc)
}

// restore pops to a saved state; rel < 0 counts back from the newest
func (c *mfCanvas) restore(rel int) {
	if rel >= 0 || len(c.saved) == 0 {
		rel = -1
	}
	i := len(c.saved) + rel
	if i < 0 {
		i = 0
	}
	c.dc = c.saved[i]
	c.saved = c.saved[:i]
}

func (c *mfCanvas) selectObject(o *mfObject) {
	if o == nil {
		return
	}
	switch {
	case o.pen != nil:
		c.dc.pen = *o.pen
	case o.brush != nil:
		c.dc.brush = *o.brush
	case o.font != nil:
		c.dc.font = *o.font
	}
}

// stockObject resolves GetStockObject handles (high bit set)
func stockObject(h uint32) *mfObject {
	white := color.NRGBA{255, 255, 255, 255}
	gray := func(v uint8) color.NRGBA { return color.NRGBA{v, v, v, 255} }
	switch h & 0x7FFFFFFF {
	case 0:
		return &mfObject{brush: &mfBrush{col: white}}
	case 1:
		return &mfObject{brush: &mfBrush{col: gray(0xC0)}}
	case 2:
		return &mfObject{brush: &mfBrush{col: gray(0x80)}}
	case 3:
		return &mfObject{brush: &mfBrush{col: gray(0x40)}}
	case 4:
		return &mfObject{brush: &mfBrush{col: gray(0)}}
	case 5:
		return &mfObject{brush: &mfBrush{null: true}}
	case 6:
		return &mfObject{pen: &mfPen{col: white}}
	case 7:
		return &mfObject{pen: &mfPen{col: gray(0)}}
	case 8:
		return &mfObject{pen: &mfPen{null: true}}
	case 10, 11, 12, 13, 14, 16, 17:
		return &mfObject{font: &mfFont{height: -12, weight: 400}}
	}
	return nil
}

// penFromStyle builds a pen from a GDI pen style, width and colour
func penFromStyle(style uint32, width float64, col uint32) *mfPen {
	if style&0x0F == 5 { // PS_NULL
		return &mfPen{null: true}
	}
	return &mfPen{col: colorRef(col), width: math.Abs(width)}
}

// brushFromStyle builds a brush from a GDI brush style and colour
func brushFromStyle(style uint32, col uint32) *mfBrush {
	switch style {
	case 1: // BS_NULL
		return &mfBrush{null: true}
	case 2: // BS_HATCHED: the hatch lines cover about a third of the area
		cl := colorRef(col)
		cl.A = 90
		return &mfBrush{col: cl}
	case 0:
		return &mfBrush{col: colorRef(col)}
	}
	// pattern brushes: a neutral fill keeps the shape visible
	return &mfBrush{col: color.NRGBA{0xC0, 0xC0, 0xC0, 255}}
}

/* ---------------- drawing ---------------- */

// shape fills (when closed) and outlines a set of logical polygons
func (c *mfCanvas) shape(polys [][]mfPt, closed bool) {
	px := make([][]mfPt, 0, len(polys))
	for _, poly := range polys {
		if len(poly) < 2 {
			continue
		}
		q := make([]mfPt, len(poly))
		for i, p := range poly {
			q[i] = c.px(p)
		}
		px = append(px, q)
	}
	if len(px) == 0 {
		return
	}
	if c.inPath {
		for _, q := range px {
			c.path = append(c.path, q)
			c.pathOpen = append(c.pathOpen, !closed)
		}
		return
	}
	c.drawPx(px, closed, closed, true)
}

// drawPx fills and / or strokes polygons already in output pixels
func (c *mfCanvas) drawPx(px [][]mfPt, fill, closed, stroke bool) {
	if fill && !c.dc.brush.null && c.dc.brush.col.A > 0 {
		c.drewVector = true
		if !c.measure {
			c.fillPolys(px, c.dc.brush.col)
		}
	}
	if stroke && !c.dc.pen.null {
		c.drewVector = true
		if !c.measure {
			wx, wy := c.pxLen(c.dc.pen.width)
			w := (wx + wy) / 2
			if c.dc.pen.width == 0 || w < 1 {
				w = 1
			}
			c.strokePolys(px, closed, w, c.dc.pen.col)
		}
	}
}

func (c *mfCanvas) fillPolys(px [][]mfPt, col color.NRGBA) {
	c.ras.Reset(c.w, c.h)
	for _, poly := range px {
		if len(poly) < 3 {
			continue
		}
		c.ras.MoveTo(float32(poly[0].X), float32(poly[0].Y))
		for _, p := range poly[1:] {
			c.ras.LineTo(float32(p.X), float32(p.Y))
		}
		c.ras.ClosePath()
	}
	c.ras.Draw(c.img, c.img.Bounds(), image.NewUniform(col), image.Point{})
}

// strokePolys outlines polylines as one coverage pass: a quad per segment
// and a round-ish cap at every vertex, all wound the same way so the
// overlaps do not cancel out
func (c *mfCanvas) strokePolys(px [][]mfPt, closed bool, width float64, col color.NRGBA) {
	hw := width / 2
	c.ras.Reset(c.w, c.h)
	quad := func(a, b mfPt) {
		dx, dy := b.X-a.X, b.Y-a.Y
		l := math.Hypot(dx, dy)
		if l < 1e-9 {
			return
		}
		nx, ny := -dy/l*hw, dx/l*hw
		c.ras.MoveTo(float32(a.X+nx), float32(a.Y+ny))
		c.ras.LineTo(float32(b.X+nx), float32(b.Y+ny))
		c.ras.LineTo(float32(b.X-nx), float32(b.Y-ny))
		c.ras.LineTo(float32(a.X-nx), float32(a.Y-ny))
		c.ras.ClosePath()
	}
	join := func(p mfPt) {
		if hw <= 0.75 {
			return
		}
		const n = 10
		for i := 0; i <= n; i++ {
			t := -2 * math.Pi * float64(i) / n
			x, y := float32(p.X+hw*math.Cos(t)), float32(p.Y+hw*math.Sin(t))
			if i == 0 {
				c.ras.MoveTo(x, y)
			} else {
				c.ras.LineTo(x, y)
			}
		}
		c.ras.ClosePath()
	}
	for _, poly := range px {
		for i := 0; i+1 < len(poly); i++ {
			quad(poly[i], poly[i+1])
			join(poly[i])
		}
		if len(poly) > 0 {
			join(poly[len(poly)-1])
		}
		if closed && len(poly) > 2 {
			quad(poly[len(poly)-1], poly[0])
		}
	}
	c.ras.Draw(c.img, c.img.Bounds(), image.NewUniform(col), image.Point{})
}

/* ---------------- geometry helpers (logical space) ---------------- */

func rectPoly(l, t, r, b float64) []mfPt {
	return []mfPt{{l, t}, {r, t}, {r, b}, {l, b}}
}

func ellipsePoly(l, t, r, b float64) []mfPt {
	cx, cy := (l+r)/2, (t+b)/2
	rx, ry := math.Abs(r-l)/2, math.Abs(b-t)/2
	n := 64
	pts := make([]mfPt, n)
	for i := range pts {
		a := 2 * math.Pi * float64(i) / float64(n)
		pts[i] = mfPt{cx + rx*math.Cos(a), cy + ry*math.Sin(a)}
	}
	return pts
}

func roundRectPoly(l, t, r, b, cw, ch float64) []mfPt {
	if r < l {
		l, r = r, l
	}
	if b < t {
		t, b = b, t
	}
	rx := math.Min(math.Abs(cw)/2, (r-l)/2)
	ry := math.Min(math.Abs(ch)/2, (b-t)/2)
	if rx <= 0 || ry <= 0 {
		return rectPoly(l, t, r, b)
	}
	var pts []mfPt
	corner := func(cx, cy, a0 float64) {
		for i := 0; i <= 8; i++ {
			a := a0 + math.Pi/2*float64(i)/8
			pts = append(pts, mfPt{cx + rx*math.Cos(a), cy + ry*math.Sin(a)})
		}
	}
	corner(r-rx, t+ry, -math.Pi/2)
	corner(r-rx, b-ry, 0)
	corner(l+rx, b-ry, math.Pi/2)
	corner(l+rx, t+ry, math.Pi)
	return pts
}

// arcPoly walks an ellipse counterclockwise (as seen on screen) from the
// ray through start to the ray through end, as GDI's Arc / Pie / Chord do
func arcPoly(l, t, r, b float64, start, end mfPt) []mfPt {
	cx, cy := (l+r)/2, (t+b)/2
	rx, ry := math.Abs(r-l)/2, math.Abs(b-t)/2
	if rx == 0 || ry == 0 {
		return nil
	}
	a0 := math.Atan2(-(start.Y-cy)/ry, (start.X-cx)/rx)
	a1 := math.Atan2(-(end.Y-cy)/ry, (end.X-cx)/rx)
	for a1 <= a0 {
		a1 += 2 * math.Pi
	}
	n := int(math.Ceil((a1-a0)/(2*math.Pi)*64)) + 1
	pts := make([]mfPt, 0, n+1)
	for i := 0; i <= n; i++ {
		a := a0 + (a1-a0)*float64(i)/float64(n)
		pts = append(pts, mfPt{cx + rx*math.Cos(a), cy - ry*math.Sin(a)})
	}
	return pts
}

// bezierPoly flattens cubic segments: pts is a start point followed by
// (control, control, end) triples
func bezierPoly(pts []mfPt) []mfPt {
	if len(pts) == 0 {
		return nil
	}
	out := []mfPt{pts[0]}
	for i := 1; i+2 < len(pts); i += 3 {
		p0, p1, p2, p3 := out[len(out)-1], pts[i], pts[i+1], pts[i+2]
		const n = 16
		for k := 1; k <= n; k++ {
			t := float64(k) / n
			u := 1 - t
			out = append(out, mfPt{
				u*u*u*p0.X + 3*u*u*t*p1.X + 3*u*t*t*p2.X + t*t*t*p3.X,
				u*u*u*p0.Y + 3*u*u*t*p1.Y + 3*u*t*t*p2.Y + t*t*t*p3.Y,
			})
		}
	}
	return out
}

/* ---------------- path bracket (EMF) ---------------- */

func (c *mfCanvas) beginPath() {
	c.inPath = true
	c.path, c.pathOpen = nil, nil
}

// pathMoveTo starts a new subpath at a logical point
func (c *mfCanvas) pathMoveTo(p mfPt) {
	c.path = append(c.path, []mfPt{c.px(p)})
	c.pathOpen = append(c.pathOpen, true)
}

// pathLineTo appends logical points to the open subpath
func (c *mfCanvas) pathLineTo(pts ...mfPt) {
	if len(c.path) == 0 || !c.pathOpen[len(c.path)-1] {
		c.pathMoveTo(c.dc.cur)
	}
	i := len(c.path) - 1
	for _, p := range pts {
		c.path[i] = append(c.path[i], c.px(p))
	}
}

func (c *mfCanvas) closeFigure() {
	if n := len(c.path); n > 0 {
		c.pathOpen[n-1] = false
	}
}

func (c *mfCanvas) drawPath(fill, stroke bool) {
	if len(c.path) == 0 {
		return
	}
	var closed, open [][]mfPt
	for i, sp := range c.path {
		if fill || !c.pathOpen[i] {
			closed = append(closed, sp)
		} else {
			open = append(open, sp)
		}
	}
	if len(closed) > 0 {
		c.drawPx(closed, fill, true, stroke)
	}
	if len(open) > 0 {
		c.drawPx(open, false, false, stroke)
	}
	c.path, c.pathOpen = nil, nil
}

/* ---------------- bitmaps ---------------- */

const (
	ropSrcCopy    = 0x00CC0020
	ropSrcPaint   = 0x00EE0086
	ropSrcAnd     = 0x008800C6
	ropSrcInvert  = 0x00660046
	ropSrcErase   = 0x00440328
	ropNotSrcCopy = 0x00330008
	ropMergePaint = 0x00BB0226
	ropPatCopy    = 0x00F00021
	ropBlackness  = 0x00000042
	ropWhiteness  = 0x00FF0062
)

// blit draws src (only srcRect of it) into the logical destination
// rectangle at (x, y) with size (w, h); a negative size mirrors
func (c *mfCanvas) blit(src image.Image, srcRect image.Rectangle, x, y, w, h float64, rop uint32, photo bool) {
	srcRect = srcRect.Canon()
	b := src.Bounds()
	if !srcRect.Overlaps(b) {
		return
	}
	// a source rectangle past the bitmap edge: keep the part that exists
	// and shrink the destination with it
	clip := srcRect.Intersect(b)
	if clip != srcRect {
		fx := w / float64(srcRect.Dx())
		fy := h / float64(srcRect.Dy())
		x += float64(clip.Min.X-srcRect.Min.X) * fx
		y += float64(clip.Min.Y-srcRect.Min.Y) * fy
		w = float64(clip.Dx()) * fx
		h = float64(clip.Dy()) * fy
		srcRect = clip
	}
	tl := c.px(mfPt{x, y})
	tr := c.px(mfPt{x + w, y})
	bl := c.px(mfPt{x, y + h})
	dw := math.Hypot(tr.X-tl.X, tr.Y-tl.Y)
	dh := math.Hypot(bl.X-tl.X, bl.Y-tl.Y)
	if dw < 0.5 || dh < 0.5 {
		return
	}
	c.drewBitmap = true
	if c.measure {
		// the CSS size the bitmap covers decides the output resolution
		r := math.Max(float64(srcRect.Dx())/dw, float64(srcRect.Dy())/dh)
		if r > c.maxRatio {
			c.maxRatio = r
		}
		if photo {
			c.photo = true
		}
		return
	}
	sw, sh := float64(srcRect.Dx()), float64(srcRect.Dy())
	s2d := f64.Aff3{
		(tr.X - tl.X) / sw, (bl.X - tl.X) / sh, 0,
		(tr.Y - tl.Y) / sw, (bl.Y - tl.Y) / sh, 0,
	}
	s2d[2] = tl.X - s2d[0]*float64(srcRect.Min.X) - s2d[1]*float64(srcRect.Min.Y)
	s2d[5] = tl.Y - s2d[3]*float64(srcRect.Min.X) - s2d[4]*float64(srcRect.Min.Y)

	var interp xdraw.Transformer = xdraw.BiLinear
	if sw/dw > 1.5 || sh/dh > 1.5 {
		interp = xdraw.CatmullRom
	}
	switch rop {
	case ropSrcCopy, 0:
		c.transform(interp, s2d, src, srcRect, c.img)
		return
	}
	// a bitwise raster op: render the source alone, then combine
	box := image.Rect(
		int(math.Floor(math.Min(math.Min(tl.X, tr.X), math.Min(bl.X, tr.X+bl.X-tl.X)))),
		int(math.Floor(math.Min(math.Min(tl.Y, tr.Y), math.Min(bl.Y, tr.Y+bl.Y-tl.Y)))),
		int(math.Ceil(math.Max(math.Max(tl.X, tr.X), math.Max(bl.X, tr.X+bl.X-tl.X)))),
		int(math.Ceil(math.Max(math.Max(tl.Y, tr.Y), math.Max(bl.Y, tr.Y+bl.Y-tl.Y)))),
	).Intersect(c.img.Bounds())
	if box.Empty() {
		return
	}
	tmp := image.NewRGBA(box)
	c.transform(interp, s2d, src, srcRect, tmp)
	for yy := box.Min.Y; yy < box.Max.Y; yy++ {
		for xx := box.Min.X; xx < box.Max.X; xx++ {
			si := tmp.PixOffset(xx, yy)
			if tmp.Pix[si+3] == 0 {
				continue
			}
			di := c.img.PixOffset(xx, yy)
			c.ropPixel(c.img.Pix[di:di+4], tmp.Pix[si:si+4], rop)
		}
	}
}

func (c *mfCanvas) transform(interp xdraw.Transformer, s2d f64.Aff3, src image.Image, sr image.Rectangle, dst *image.RGBA) {
	// a 1:1 copy at whole pixel offsets needs no resampling
	if s2d[0] == 1 && s2d[4] == 1 && s2d[1] == 0 && s2d[3] == 0 &&
		s2d[2] == math.Trunc(s2d[2]) && s2d[5] == math.Trunc(s2d[5]) {
		off := image.Pt(int(s2d[2]), int(s2d[5]))
		xdraw.Draw(dst, sr.Add(off), src, sr.Min, xdraw.Over)
		return
	}
	interp.Transform(dst, s2d, src, sr, xdraw.Over, nil)
}

// ropPixel combines a source pixel into a destination pixel with a GDI
// raster op. The empty (transparent) canvas counts as the white page, and
// a result that is still white there stays transparent, so the classic
// mask (AND) + image (OR) pair keeps its transparent background.
func (c *mfCanvas) ropPixel(d, s []uint8, rop uint32) {
	empty := d[3] == 0
	var dc [3]uint32
	for i := 0; i < 3; i++ {
		// premultiplied over white
		dc[i] = uint32(d[i]) + 255 - uint32(d[3])
	}
	var out [3]uint32
	for i := 0; i < 3; i++ {
		sv := uint32(s[i]) + 255 - uint32(s[3])
		dv := dc[i]
		switch rop {
		case ropSrcAnd:
			out[i] = sv & dv
		case ropSrcPaint:
			out[i] = sv | dv
		case ropSrcInvert:
			out[i] = (sv ^ dv) & 0xFF
		case ropSrcErase:
			out[i] = sv & (^dv & 0xFF)
		case ropNotSrcCopy:
			out[i] = ^sv & 0xFF
		case ropMergePaint:
			out[i] = (^sv & 0xFF) | dv
		default:
			out[i] = sv
		}
	}
	if empty && out[0] == 255 && out[1] == 255 && out[2] == 255 {
		return
	}
	d[0], d[1], d[2], d[3] = uint8(out[0]), uint8(out[1]), uint8(out[2]), 255
}

// patBlt fills a logical rectangle for the source-less raster ops
func (c *mfCanvas) patBlt(x, y, w, h float64, rop uint32) {
	var col color.NRGBA
	switch rop {
	case ropPatCopy:
		if c.dc.brush.null {
			return
		}
		col = c.dc.brush.col
	case ropBlackness:
		col = color.NRGBA{A: 255}
	case ropWhiteness:
		col = color.NRGBA{255, 255, 255, 255}
	default:
		return
	}
	poly := rectPoly(x, y, x+w, y+h)
	px := make([]mfPt, len(poly))
	for i, p := range poly {
		px[i] = c.px(p)
	}
	c.drewVector = true
	if !c.measure {
		c.fillPolys([][]mfPt{px}, col)
	}
}

/* ---------------- DIB decoding ---------------- */

// dibInfo is the parsed part of a BITMAPINFO header
type dibInfo struct {
	w, h      int
	topDown   bool
	bpp       int
	comp      uint32
	masks     [4]uint32 // r g b a (bit fields)
	palette   []color.NRGBA
	headerLen int // header + masks + colour table
}

func parseDIBHeader(b []byte, usage uint32) (*dibInfo, error) {
	if len(b) < 12 {
		return nil, errors.New("DIB header truncated")
	}
	hs := int(binary.LittleEndian.Uint32(b))
	d := &dibInfo{}
	entry := 4
	nColors := 0
	if hs == 12 {
		d.w = int(binary.LittleEndian.Uint16(b[4:]))
		d.h = int(int16(binary.LittleEndian.Uint16(b[6:])))
		d.bpp = int(binary.LittleEndian.Uint16(b[10:]))
		entry = 3
	} else {
		if hs < 40 || len(b) < 40 {
			return nil, errors.New("unsupported DIB header")
		}
		d.w = int(int32(binary.LittleEndian.Uint32(b[4:])))
		d.h = int(int32(binary.LittleEndian.Uint32(b[8:])))
		d.bpp = int(binary.LittleEndian.Uint16(b[14:]))
		d.comp = binary.LittleEndian.Uint32(b[16:])
		nColors = int(binary.LittleEndian.Uint32(b[32:]))
	}
	if d.h < 0 {
		d.h = -d.h
		d.topDown = true
	}
	if d.w <= 0 || d.h <= 0 || d.w*d.h > mfMaxDIBPixels || d.w > 1<<16 || d.h > 1<<16 {
		return nil, errors.New("DIB has an unusable size")
	}
	off := hs
	if d.comp == 3 || d.comp == 6 { // BI_BITFIELDS / BI_ALPHABITFIELDS
		n := 3
		if d.comp == 6 {
			n = 4
		}
		if hs >= 52 {
			// V2+ headers hold the masks themselves
			for i := 0; i < 4 && 40+4*i+4 <= hs && 40+4*i+4 <= len(b); i++ {
				d.masks[i] = binary.LittleEndian.Uint32(b[40+4*i:])
			}
		} else {
			if len(b) < hs+4*n {
				return nil, errors.New("DIB masks truncated")
			}
			for i := 0; i < n; i++ {
				d.masks[i] = binary.LittleEndian.Uint32(b[hs+4*i:])
			}
			off += 4 * n
		}
	} else if hs >= 56 && len(b) >= 56 {
		d.masks[3] = binary.LittleEndian.Uint32(b[52:])
	}
	if d.bpp <= 8 {
		if nColors == 0 || nColors > 1<<d.bpp {
			nColors = 1 << d.bpp
		}
	}
	if usage == 1 { // DIB_PAL_COLORS: 16-bit indices into a palette we do not have
		entry = 2
	}
	if nColors > 0 {
		if len(b) < off+nColors*entry {
			return nil, errors.New("DIB colour table truncated")
		}
		d.palette = make([]color.NRGBA, nColors)
		for i := range d.palette {
			e := b[off+i*entry:]
			if entry == 2 {
				v := uint8(255 * i / maxInt(nColors-1, 1))
				d.palette[i] = color.NRGBA{v, v, v, 255}
			} else {
				d.palette[i] = color.NRGBA{e[2], e[1], e[0], 255}
			}
		}
		off += nColors * entry
	}
	d.headerLen = off
	return d, nil
}

// decodePackedDIB decodes a DIB whose pixels follow the header and
// colour table directly (the WMF layout)
func decodePackedDIB(b []byte, usage uint32) (image.Image, *dibInfo, error) {
	d, err := parseDIBHeader(b, usage)
	if err != nil {
		return nil, nil, err
	}
	if d.headerLen > len(b) {
		return nil, nil, errors.New("DIB truncated")
	}
	img, err := d.decode(b[d.headerLen:])
	return img, d, err
}

// decodeDIB decodes a DIB with its header and pixels apart (the EMF layout)
func decodeDIB(bmi, bits []byte, usage uint32) (image.Image, *dibInfo, error) {
	d, err := parseDIBHeader(bmi, usage)
	if err != nil {
		return nil, nil, err
	}
	img, err := d.decode(bits)
	return img, d, err
}

// isPhoto reports a bitmap that compresses better as JPEG than PNG
func (d *dibInfo) isPhoto() bool {
	return d.bpp >= 16 || d.comp == 4
}

func (d *dibInfo) decode(bits []byte) (image.Image, error) {
	switch d.comp {
	case 4, 5: // BI_JPEG / BI_PNG
		img, _, err := image.Decode(bytes.NewReader(bits))
		return img, err
	case 1:
		if d.bpp != 8 {
			return nil, errors.New("RLE8 DIB with wrong depth")
		}
		return d.fromIndices(decodeRLE(bits, d.w, d.h, false), d.w)
	case 2:
		if d.bpp != 4 {
			return nil, errors.New("RLE4 DIB with wrong depth")
		}
		return d.fromIndices(decodeRLE(bits, d.w, d.h, true), d.w)
	case 0, 3, 6:
	default:
		return nil, errors.New("unsupported DIB compression")
	}
	img := image.NewNRGBA(image.Rect(0, 0, d.w, d.h))
	stride := ((d.w*d.bpp + 31) / 32) * 4
	masks := d.masks
	if d.comp == 0 {
		switch d.bpp {
		case 16:
			masks = [4]uint32{0x7C00, 0x03E0, 0x001F, 0}
		case 32:
			masks = [4]uint32{0xFF0000, 0x00FF00, 0x0000FF, d.masks[3]}
		}
	}
	type field struct {
		shift uint
		max   uint32
	}
	var fields [4]field
	for i, m := range masks {
		if m == 0 {
			continue
		}
		s := uint(0)
		for m&1 == 0 {
			m >>= 1
			s++
		}
		fields[i] = field{s, m}
	}
	hasAlpha := masks[3] != 0
	anyAlpha := false
	for y := 0; y < d.h; y++ {
		sy := d.h - 1 - y
		if d.topDown {
			sy = y
		}
		row := sy * stride
		if row+stride > len(bits) {
			if row >= len(bits) {
				continue
			}
		}
		line := bits[row:min(row+stride, len(bits))]
		o := img.PixOffset(0, y)
		for x := 0; x < d.w; x++ {
			var c color.NRGBA
			switch d.bpp {
			case 1, 2, 4, 8:
				bit := x * d.bpp
				if bit/8 >= len(line) {
					continue
				}
				idx := int(line[bit/8]>>(8-uint(d.bpp)-uint(bit%8))) & (1<<d.bpp - 1)
				if idx < len(d.palette) {
					c = d.palette[idx]
				} else {
					c = color.NRGBA{A: 255}
				}
			case 24:
				i := x * 3
				if i+2 >= len(line) {
					continue
				}
				c = color.NRGBA{line[i+2], line[i+1], line[i], 255}
			case 16, 32:
				n := d.bpp / 8
				i := x * n
				if i+n > len(line) {
					continue
				}
				var v uint32
				if n == 2 {
					v = uint32(binary.LittleEndian.Uint16(line[i:]))
				} else {
					v = binary.LittleEndian.Uint32(line[i:])
				}
				ch := func(f field) uint8 {
					if f.max == 0 {
						return 0
					}
					return uint8(((v >> f.shift) & f.max) * 255 / f.max)
				}
				c = color.NRGBA{ch(fields[0]), ch(fields[1]), ch(fields[2]), 255}
				if hasAlpha {
					c.A = ch(fields[3])
					if c.A != 0 {
						anyAlpha = true
					}
				}
			default:
				return nil, errors.New("unsupported DIB depth")
			}
			copy(img.Pix[o+4*x:], []uint8{c.R, c.G, c.B, c.A})
		}
	}
	if hasAlpha && !anyAlpha {
		// an alpha channel that is all zero is unused, not invisible
		for i := 3; i < len(img.Pix); i += 4 {
			img.Pix[i] = 255
		}
	}
	return img, nil
}

// fromIndices builds an image from palette indices laid out bottom-up
func (d *dibInfo) fromIndices(idx []uint8, w int) (image.Image, error) {
	img := image.NewNRGBA(image.Rect(0, 0, d.w, d.h))
	for y := 0; y < d.h; y++ {
		sy := d.h - 1 - y
		if d.topDown {
			sy = y
		}
		for x := 0; x < d.w; x++ {
			v := int(idx[sy*w+x])
			c := color.NRGBA{A: 255}
			if v < len(d.palette) {
				c = d.palette[v]
			}
			o := img.PixOffset(x, y)
			img.Pix[o], img.Pix[o+1], img.Pix[o+2], img.Pix[o+3] = c.R, c.G, c.B, c.A
		}
	}
	return img, nil
}

// decodeRLE expands BI_RLE8 / BI_RLE4 data into one index per pixel, rows
// in file order (bottom-up)
func decodeRLE(b []byte, w, h int, four bool) []uint8 {
	out := make([]uint8, w*h)
	x, y := 0, 0
	put := func(v uint8) {
		if x < w && y < h {
			out[y*w+x] = v
		}
		x++
	}
	for i := 0; i+1 < len(b); {
		n, v := int(b[i]), b[i+1]
		i += 2
		if n > 0 {
			for k := 0; k < n; k++ {
				if four {
					if k%2 == 0 {
						put(v >> 4)
					} else {
						put(v & 0x0F)
					}
				} else {
					put(v)
				}
			}
			continue
		}
		switch v {
		case 0: // end of line
			x, y = 0, y+1
		case 1: // end of bitmap
			return out
		case 2: // delta
			if i+1 >= len(b) {
				return out
			}
			x += int(b[i])
			y += int(b[i+1])
			i += 2
		default: // absolute run of v pixels
			cnt := int(v)
			if four {
				nb := (cnt + 1) / 2
				for k := 0; k < cnt && i+k/2 < len(b); k++ {
					p := b[i+k/2]
					if k%2 == 0 {
						put(p >> 4)
					} else {
						put(p & 0x0F)
					}
				}
				i += nb
				if nb%2 == 1 {
					i++
				}
			} else {
				for k := 0; k < cnt && i+k < len(b); k++ {
					put(b[i+k])
				}
				i += cnt
				if cnt%2 == 1 {
					i++
				}
			}
		}
		if y >= h {
			return out
		}
	}
	return out
}

/* ---------------- text ---------------- */

var (
	mfFontsOnce sync.Once
	mfFonts     map[string]*opentype.Font
)

// mfFontFor picks the bundled Go font closest to a metafile font
func mfFontFor(f mfFont) *opentype.Font {
	mfFontsOnce.Do(func() {
		mfFonts = map[string]*opentype.Font{}
		for name, ttf := range map[string][]byte{
			"regular": goregular.TTF, "bold": gobold.TTF, "italic": goitalic.TTF,
			"bolditalic": gobolditalic.TTF, "mono": gomono.TTF,
		} {
			if fnt, err := opentype.Parse(ttf); err == nil {
				mfFonts[name] = fnt
			}
		}
	})
	face := strings.ToLower(f.face)
	if strings.Contains(face, "courier") || strings.Contains(face, "mono") || strings.Contains(face, "consolas") {
		return mfFonts["mono"]
	}
	bold := f.weight >= 600
	switch {
	case bold && f.italic:
		return mfFonts["bolditalic"]
	case bold:
		return mfFonts["bold"]
	case f.italic:
		return mfFonts["italic"]
	}
	return mfFonts["regular"]
}

// text draws a run of text at a logical reference point; dx, when given,
// is the logical advance of each character
func (c *mfCanvas) text(ref mfPt, s []rune, dx []float64) {
	if len(s) == 0 {
		return
	}
	c.drewVector = true
	f := c.dc.font
	update := c.dc.textAlign&1 != 0 // TA_UPDATECP
	if update {
		ref = c.dc.cur
	}
	_, sy := c.pxLen(f.height)
	size := sy
	if f.height > 0 {
		// a positive height is the cell height, internal leading included
		size *= 0.82
	}
	if f.height == 0 {
		_, size = c.pxLen(12)
	}
	if size < 1 || size > 2000 {
		return
	}
	fnt := mfFontFor(f)
	if fnt == nil {
		return
	}
	face, err := opentype.NewFace(fnt, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
	if err != nil {
		return
	}
	defer face.Close()

	// glyph positions along the baseline, in output pixels from the start
	pos := make([]float64, len(s)+1)
	if len(dx) >= len(s) {
		for i := range s {
			w, _ := c.pxLen(dx[i])
			pos[i+1] = pos[i] + w
		}
	} else {
		for i, r := range s {
			adv, _ := face.GlyphAdvance(r)
			pos[i+1] = pos[i] + float64(adv)/64
		}
	}
	width := pos[len(s)]
	m := face.Metrics()
	ascent, descent := float64(m.Ascent)/64, float64(m.Descent)/64

	// alignment, measured along the text direction
	ox := 0.0
	switch c.dc.textAlign & 6 {
	case 2: // TA_RIGHT
		ox = -width
	case 6: // TA_CENTER
		ox = -width / 2
	}
	oy := ascent // TA_TOP
	switch c.dc.textAlign & 24 {
	case 8: // TA_BOTTOM
		oy = -descent
	case 24: // TA_BASELINE
		oy = 0
	}
	if update {
		// the current position moves to the end of the text
		w, _ := c.pxLen(1)
		if w > 0 {
			c.dc.cur.X += width / w
		}
	}
	if c.measure {
		return
	}

	// render horizontally into a scratch image, then place it (rotated
	// when the font has an escapement)
	pad := 2
	tw := int(math.Ceil(width)) + 2*pad
	th := int(math.Ceil(ascent+descent)) + 2*pad
	if tw <= 0 || th <= 0 || tw*th > mfMaxPixels {
		return
	}
	tmp := image.NewRGBA(image.Rect(0, 0, tw, th))
	src := image.NewUniform(c.dc.textColor)
	base := float64(pad) + ascent
	for i, r := range s {
		d := font.Drawer{Dst: tmp, Src: src, Face: face,
			Dot: fixed.Point26_6{X: fixed.Int26_6((float64(pad) + pos[i]) * 64), Y: fixed.Int26_6(base * 64)}}
		d.DrawString(string(r))
	}
	if f.underline || f.strike {
		lw := math.Max(1, size/16)
		yy := base + size*0.12
		if f.strike {
			yy = base - ascent*0.3
		}
		for y := int(yy); y < int(yy+lw) && y < th; y++ {
			for x := pad; x < pad+int(width) && x < tw; x++ {
				o := tmp.PixOffset(x, y)
				cc := c.dc.textColor
				tmp.Pix[o], tmp.Pix[o+1], tmp.Pix[o+2], tmp.Pix[o+3] = cc.R, cc.G, cc.B, 255
			}
		}
	}

	p := c.px(ref)
	ang := -f.escapement / 10 * math.Pi / 180 // screen y grows downward
	if c.toCSSFlipsY() {
		ang = -ang
	}
	cos, sin := math.Cos(ang), math.Sin(ang)
	// scratch (u, v) -> canvas: rotate the offset from the reference point
	u0 := float64(pad) - ox
	v0 := base - oy
	aff := f64.Aff3{cos, -sin, 0, sin, cos, 0}
	aff[2] = p.X - (cos*u0 - sin*v0)
	aff[5] = p.Y - (sin*u0 + cos*v0)
	if ang == 0 && aff[2] == math.Trunc(aff[2]) && aff[5] == math.Trunc(aff[5]) {
		xdraw.Draw(c.img, tmp.Bounds().Add(image.Pt(int(aff[2]), int(aff[5]))), tmp, image.Point{}, xdraw.Over)
		return
	}
	xdraw.BiLinear.Transform(c.img, aff, tmp, tmp.Bounds(), xdraw.Over, nil)
}

// toCSSFlipsY reports a mapping whose y axis points up (the metric and
// English map modes), which mirrors the sense of an escapement angle
func (c *mfCanvas) toCSSFlipsY() bool {
	a := c.px(mfPt{0, 0})
	b := c.px(mfPt{0, 1})
	return b.Y < a.Y
}

// opaqueBox fills a logical rectangle with the background colour (the
// ETO_OPAQUE box behind a text run)
func (c *mfCanvas) opaqueBox(l, t, r, b float64) {
	if r == l || b == t {
		return
	}
	poly := rectPoly(l, t, r, b)
	px := make([]mfPt, len(poly))
	for i, p := range poly {
		px[i] = c.px(p)
	}
	c.drewVector = true
	if !c.measure {
		c.fillPolys([][]mfPt{px}, c.dc.bkColor)
	}
}
