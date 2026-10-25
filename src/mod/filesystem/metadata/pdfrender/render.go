package pdfrender

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"math"
	"time"
)

/*
	render.go

	The content stream interpreter: graphics state, path construction and
	painting, clipping, text, colour operators, marked / optional content
	and the public Render entry point. Images, forms and annotations are in
	xobject.go, shadings and patterns in shading.go.
*/

// Options control a render
type Options struct {
	//Scale is device pixels per PDF point (1 = 72 dpi)
	Scale float64
	//Region is the part of the scaled page to draw, in device pixels from
	//the top left corner of the page. Empty draws the whole page.
	Region image.Rectangle
	//Timeout stops a slow render early; what was drawn so far is returned.
	//Zero means 20 seconds.
	Timeout time.Duration
	//NoAnnotations skips annotation appearances (form fields, stamps ...)
	NoAnnotations bool
}

// ErrTimeout is returned with a partial image when the render hit its time
// or operation budget
var ErrTimeout = errors.New("pdfrender: render stopped early")

const (
	maxOps        = 4000000
	maxFormDepth  = 16
	minLineDevice = 0.45 //Thinnest stroke drawn, in device pixels
)

type gstate struct {
	ctm   matrix
	clip  *mask
	soft  *mask
	blend int

	fillCS, strokeCS     colorSpace
	fill, stroke         []float64
	fillPat, strokePat   Object
	fillRGB, strokeRGB   solidPaint
	fillNone, strokeNone bool //Separation /None paints nothing

	lw, ml    float64
	lineCap   int
	lineJoin  int
	dash      []float64
	dashPhase float64
	fa, sa    float64

	font   *pdfFont
	fs     float64
	tc, tw float64
	th     float64
	tl     float64
	rise   float64
	tr     int
}

func (g *gstate) clone() *gstate {
	c := *g
	c.fill = append([]float64{}, g.fill...)
	c.stroke = append([]float64{}, g.stroke...)
	return &c
}

type renderer struct {
	d      *Document
	cv     *canvas
	gs     *gstate
	stack  []*gstate
	path   path
	clipOp int //Pending W (1) or W* (2)

	tm, tlm  matrix
	textClip []polyline
	inText   bool

	res      Dict
	base     matrix //Matrix that pattern spaces are relative to
	depth    int
	ops      int
	deadline time.Time
	stopped  bool

	mcHidden []bool
	hidden   int

	forceColor *solidPaint //Uncoloured patterns and d1 glyphs
	formsBusy  map[*Stream]bool

	shared *renderShared
}

// renderShared is what the renderers of one page (patterns, soft masks)
// share
type renderShared struct {
	fonts  map[string]*pdfFont
	images map[string]*pdfImage
	ocOff  map[Ref]bool
}

// Render draws page n (0 based)
func (d *Document) Render(n int, opt Options) (img *image.RGBA, err error) {
	pg, err := d.Page(n)
	if err != nil {
		return nil, err
	}
	scale := opt.Scale
	if scale <= 0 || math.IsNaN(scale) {
		scale = 1
	}
	pw, ph := pg.Size()
	fullW := int(math.Ceil(pw * scale))
	fullH := int(math.Ceil(ph * scale))
	region := opt.Region
	if region.Empty() {
		region = image.Rect(0, 0, fullW, fullH)
	}
	region = region.Intersect(image.Rect(0, 0, fullW, fullH))
	if region.Empty() || int64(region.Dx())*int64(region.Dy()) > 64<<20 {
		return nil, errors.New("pdfrender: bad render size")
	}
	timeout := opt.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}

	//Page space to device space
	x0, y0, x1, y1 := pg.CropBox[0], pg.CropBox[1], pg.CropBox[2], pg.CropBox[3]
	s := scale
	var m matrix
	switch pg.Rotate {
	case 90:
		m = matrix{0, s, s, 0, -y0 * s, -x0 * s}
	case 180:
		m = matrix{-s, 0, 0, s, x1 * s, -y0 * s}
	case 270:
		m = matrix{0, -s, -s, 0, y1 * s, x1 * s}
	default:
		m = matrix{s, 0, 0, -s, -x0 * s, y1 * s}
	}
	m = m.mul(matrix{1, 0, 0, 1, -float64(region.Min.X), -float64(region.Min.Y)})

	cv := newCanvas(region.Dx(), region.Dy(), true)
	shared := &renderShared{fonts: map[string]*pdfFont{}, images: map[string]*pdfImage{}, ocOff: d.optionalContentOff()}
	r := newRenderer(d, cv, m, shared, time.Now().Add(timeout))

	defer func() {
		if p := recover(); p != nil {
			img = cv.toRGBA()
			err = fmt.Errorf("pdfrender: render failed: %v", p)
		}
	}()

	//Clip to the crop box
	r.gs.clip = &mask{r: cv.bounds()}
	content := d.pageContent(pg)
	r.run(content, pg.Resources)
	if !opt.NoAnnotations && !r.stopped {
		//Annotations start from a clean state, whatever the page left
		ops := r.ops
		r = newRenderer(d, cv, m, shared, r.deadline)
		r.ops = ops
		r.gs.clip = &mask{r: cv.bounds()}
		r.drawAnnotations(pg)
	}
	img = cv.toRGBA()
	if r.stopped {
		return img, ErrTimeout
	}
	return img, nil
}

func newRenderer(d *Document, cv *canvas, base matrix, shared *renderShared, deadline time.Time) *renderer {
	r := &renderer{
		d:         d,
		cv:        cv,
		base:      base,
		deadline:  deadline,
		shared:    shared,
		formsBusy: map[*Stream]bool{},
	}
	r.gs = &gstate{
		ctm:      base,
		fillCS:   csGray{},
		strokeCS: csGray{},
		fill:     []float64{0},
		stroke:   []float64{0},
		lw:       1,
		ml:       10,
		fa:       1,
		sa:       1,
		th:       1,
	}
	return r
}

// pageContent concatenates the content streams of a page
func (d *Document) pageContent(pg *Page) []byte {
	var out []byte
	add := func(o Object) {
		if s := d.stream(o); s != nil {
			if data, err := d.decodeStream(s, 256<<20); err == nil || len(data) > 0 {
				out = append(out, data...)
				out = append(out, '\n')
			}
		}
	}
	switch c := d.resolve(pg.Dict["Contents"]).(type) {
	case *Stream:
		add(c)
	case Array:
		for _, e := range c {
			add(e)
		}
	}
	return out
}

/*
	Optional content
*/

func (d *Document) optionalContentOff() map[Ref]bool {
	off := map[Ref]bool{}
	cat := d.catalog()
	ocp := d.dict(cat["OCProperties"])
	if ocp == nil {
		return off
	}
	cfg := d.dict(ocp["D"])
	if cfg == nil {
		return off
	}
	if d.name(cfg["BaseState"]) == "OFF" {
		for _, o := range d.array(ocp["OCGs"]) {
			if ref, ok := o.(Ref); ok {
				off[ref] = true
			}
		}
		for _, o := range d.array(cfg["ON"]) {
			if ref, ok := o.(Ref); ok {
				delete(off, ref)
			}
		}
	}
	for _, o := range d.array(cfg["OFF"]) {
		if ref, ok := o.(Ref); ok {
			off[ref] = true
		}
	}
	return off
}

// ocHidden reports whether an optional content group or membership dict
// is switched off
func (r *renderer) ocHidden(o Object) bool {
	if len(r.shared.ocOff) == 0 {
		return false
	}
	ref, isRef := o.(Ref)
	dict := r.d.dict(o)
	if dict == nil {
		return false
	}
	if r.d.name(dict["Type"]) == "OCMD" {
		var groups []Object
		switch g := r.d.resolve(dict["OCGs"]).(type) {
		case Array:
			groups = g
		case Dict:
			groups = []Object{dict["OCGs"]}
		}
		if len(groups) == 0 {
			return false
		}
		on, offN := 0, 0
		for _, g := range groups {
			if gr, ok := g.(Ref); ok && r.shared.ocOff[gr] {
				offN++
			} else {
				on++
			}
		}
		switch r.d.name(dict["P"]) {
		case "AllOn":
			return offN > 0
		case "AnyOff":
			return offN == 0
		case "AllOff":
			return on > 0
		}
		return on == 0
	}
	return isRef && r.shared.ocOff[ref]
}

/*
	Interpreter
*/

func (r *renderer) checkBudget() bool {
	if r.stopped {
		return false
	}
	r.ops++
	if r.ops > maxOps {
		r.stopped = true
		return false
	}
	if r.ops%2048 == 0 && time.Now().After(r.deadline) {
		r.stopped = true
		return false
	}
	return true
}

// run interprets a content stream with the given resources
func (r *renderer) run(data []byte, res Dict) {
	prevRes := r.res
	r.res = res
	defer func() { r.res = prevRes }()
	p := newParser(data)
	var operands []Object
	for r.checkBudget() {
		obj, err := p.parseObject(0)
		if err != nil {
			if p.lex.pos >= len(p.lex.buf) && len(p.peek) == 0 {
				return
			}
			//Skip the bad token and carry on
			operands = operands[:0]
			continue
		}
		kw, ok := obj.(keyword)
		if !ok {
			if len(operands) < 64 {
				operands = append(operands, obj)
			}
			continue
		}
		if kw == "BI" {
			r.inlineImage(p)
			operands = operands[:0]
			continue
		}
		r.exec(string(kw), operands)
		operands = operands[:0]
	}
}

func numArg(ops []Object, i int) float64 {
	if i < 0 || i >= len(ops) {
		return 0
	}
	v, _ := toFloat(ops[i])
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func (r *renderer) numArgs(ops []Object) []float64 {
	out := make([]float64, 0, len(ops))
	for _, o := range ops {
		if v, ok := toFloat(o); ok {
			out = append(out, v)
		}
	}
	return out
}

func (r *renderer) exec(op string, ops []Object) {
	gs := r.gs
	switch op {
	//Graphics state
	case "q":
		if len(r.stack) < 256 {
			r.stack = append(r.stack, gs.clone())
		}
	case "Q":
		if len(r.stack) > 0 {
			r.gs = r.stack[len(r.stack)-1]
			r.stack = r.stack[:len(r.stack)-1]
		}
	case "cm":
		if len(ops) >= 6 {
			m := matrix{numArg(ops, 0), numArg(ops, 1), numArg(ops, 2), numArg(ops, 3), numArg(ops, 4), numArg(ops, 5)}
			gs.ctm = m.mul(gs.ctm)
		}
	case "w":
		gs.lw = math.Abs(numArg(ops, 0))
	case "J":
		gs.lineCap = int(numArg(ops, 0))
	case "j":
		gs.lineJoin = int(numArg(ops, 0))
	case "M":
		gs.ml = numArg(ops, 0)
	case "d":
		if len(ops) >= 2 {
			if arr, ok := ops[0].(Array); ok {
				gs.dash = gs.dash[:0:0]
				for _, v := range arr {
					if f, ok := toFloat(r.d.resolve(v)); ok {
						gs.dash = append(gs.dash, math.Abs(f))
					}
				}
				gs.dashPhase = numArg(ops, 1)
			}
		}
	case "gs":
		if len(ops) >= 1 {
			if n, ok := ops[0].(Name); ok {
				r.setExtGState(r.d.dict(r.d.dict(r.res["ExtGState"])[n]))
			}
		}
	case "ri", "i":

	//Path construction
	case "m":
		r.path.moveTo(numArg(ops, 0), numArg(ops, 1))
	case "l":
		r.path.lineTo(numArg(ops, 0), numArg(ops, 1))
	case "c":
		r.path.cubicTo(numArg(ops, 0), numArg(ops, 1), numArg(ops, 2), numArg(ops, 3), numArg(ops, 4), numArg(ops, 5))
	case "v":
		if cp, ok := r.path.currentPoint(); ok {
			r.path.cubicTo(cp.x, cp.y, numArg(ops, 0), numArg(ops, 1), numArg(ops, 2), numArg(ops, 3))
		}
	case "y":
		r.path.cubicTo(numArg(ops, 0), numArg(ops, 1), numArg(ops, 2), numArg(ops, 3), numArg(ops, 2), numArg(ops, 3))
	case "h":
		r.path.close()
	case "re":
		x, y, w, h := numArg(ops, 0), numArg(ops, 1), numArg(ops, 2), numArg(ops, 3)
		r.path.moveTo(x, y)
		r.path.lineTo(x+w, y)
		r.path.lineTo(x+w, y+h)
		r.path.lineTo(x, y+h)
		r.path.close()

	//Path painting
	case "S":
		r.strokePath()
		r.endPath()
	case "s":
		r.path.close()
		r.strokePath()
		r.endPath()
	case "f", "F":
		r.fillPath(false)
		r.endPath()
	case "f*":
		r.fillPath(true)
		r.endPath()
	case "B":
		r.fillPath(false)
		r.strokePath()
		r.endPath()
	case "B*":
		r.fillPath(true)
		r.strokePath()
		r.endPath()
	case "b":
		r.path.close()
		r.fillPath(false)
		r.strokePath()
		r.endPath()
	case "b*":
		r.path.close()
		r.fillPath(true)
		r.strokePath()
		r.endPath()
	case "n":
		r.endPath()
	case "W":
		r.clipOp = 1
	case "W*":
		r.clipOp = 2

	//Colour
	case "CS":
		if len(ops) >= 1 {
			cs := r.d.loadColorSpace(ops[0], r.res, 0)
			if cs == nil {
				cs = csGray{}
			}
			gs.strokeCS = cs
			gs.stroke = cs.initial()
			gs.strokePat = nil
			r.updateColor(false)
		}
	case "cs":
		if len(ops) >= 1 {
			cs := r.d.loadColorSpace(ops[0], r.res, 0)
			if cs == nil {
				cs = csGray{}
			}
			gs.fillCS = cs
			gs.fill = cs.initial()
			gs.fillPat = nil
			r.updateColor(true)
		}
	case "SC", "SCN":
		gs.stroke, gs.strokePat = r.colorOperands(ops, gs.strokeCS)
		r.updateColor(false)
	case "sc", "scn":
		gs.fill, gs.fillPat = r.colorOperands(ops, gs.fillCS)
		r.updateColor(true)
	case "G":
		gs.strokeCS, gs.stroke, gs.strokePat = csGray{}, r.numArgs(ops), nil
		r.updateColor(false)
	case "g":
		gs.fillCS, gs.fill, gs.fillPat = csGray{}, r.numArgs(ops), nil
		r.updateColor(true)
	case "RG":
		gs.strokeCS, gs.stroke, gs.strokePat = csRGB{}, r.numArgs(ops), nil
		r.updateColor(false)
	case "rg":
		gs.fillCS, gs.fill, gs.fillPat = csRGB{}, r.numArgs(ops), nil
		r.updateColor(true)
	case "K":
		gs.strokeCS, gs.stroke, gs.strokePat = csCMYK{}, r.numArgs(ops), nil
		r.updateColor(false)
	case "k":
		gs.fillCS, gs.fill, gs.fillPat = csCMYK{}, r.numArgs(ops), nil
		r.updateColor(true)

	//Text
	case "BT":
		r.tm, r.tlm = identity, identity
		r.inText = true
		r.textClip = nil
	case "ET":
		r.inText = false
		if gs.tr >= 4 && !r.isHidden() {
			cov := r.raster(r.textClip, false, r.cv.bounds())
			if cov == nil {
				cov = &mask{}
			}
			gs.clip = intersectMasks(gs.clip, cov)
		}
		r.textClip = nil
	case "Tc":
		gs.tc = numArg(ops, 0)
	case "Tw":
		gs.tw = numArg(ops, 0)
	case "Tz":
		gs.th = numArg(ops, 0) / 100
	case "TL":
		gs.tl = numArg(ops, 0)
	case "Ts":
		gs.rise = numArg(ops, 0)
	case "Tr":
		gs.tr = int(numArg(ops, 0))
	case "Tf":
		if len(ops) >= 2 {
			if n, ok := ops[0].(Name); ok {
				gs.font = r.font(n)
			}
			gs.fs = numArg(ops, 1)
		}
	case "Td":
		r.tlm = matrix{1, 0, 0, 1, numArg(ops, 0), numArg(ops, 1)}.mul(r.tlm)
		r.tm = r.tlm
	case "TD":
		gs.tl = -numArg(ops, 1)
		r.tlm = matrix{1, 0, 0, 1, numArg(ops, 0), numArg(ops, 1)}.mul(r.tlm)
		r.tm = r.tlm
	case "Tm":
		if len(ops) >= 6 {
			r.tlm = matrix{numArg(ops, 0), numArg(ops, 1), numArg(ops, 2), numArg(ops, 3), numArg(ops, 4), numArg(ops, 5)}
			r.tm = r.tlm
		}
	case "T*":
		r.nextLine()
	case "Tj":
		if len(ops) >= 1 {
			if s, ok := ops[len(ops)-1].(String); ok {
				r.showText([]byte(s))
			}
		}
	case "'":
		r.nextLine()
		if len(ops) >= 1 {
			if s, ok := ops[len(ops)-1].(String); ok {
				r.showText([]byte(s))
			}
		}
	case "\"":
		if len(ops) >= 3 {
			gs.tw = numArg(ops, 0)
			gs.tc = numArg(ops, 1)
			r.nextLine()
			if s, ok := ops[2].(String); ok {
				r.showText([]byte(s))
			}
		}
	case "TJ":
		if len(ops) >= 1 {
			if arr, ok := ops[len(ops)-1].(Array); ok {
				for _, e := range arr {
					switch v := e.(type) {
					case String:
						r.showText([]byte(v))
					case int, float64:
						f, _ := toFloat(v)
						r.textAdjust(f)
					}
				}
			}
		}
	case "d0", "d1":

	//XObjects, shadings, marked content
	case "Do":
		if len(ops) >= 1 {
			if n, ok := ops[0].(Name); ok {
				r.doXObject(n)
			}
		}
	case "sh":
		if len(ops) >= 1 {
			if n, ok := ops[0].(Name); ok && !r.isHidden() {
				sh := r.d.resolve(r.d.dict(r.res["Shading"])[n])
				r.paintShadingOp(sh)
			}
		}
	case "BMC":
		r.pushMC(false)
	case "BDC":
		hide := false
		if len(ops) >= 2 {
			if tag, ok := ops[0].(Name); ok && tag == "OC" {
				var prop Object
				switch v := ops[1].(type) {
				case Name:
					prop = r.d.dict(r.res["Properties"])[v]
				default:
					prop = v
				}
				hide = r.ocHidden(prop)
			}
		}
		r.pushMC(hide)
	case "EMC":
		if n := len(r.mcHidden); n > 0 {
			if r.mcHidden[n-1] {
				r.hidden--
			}
			r.mcHidden = r.mcHidden[:n-1]
		}
	}
}

func (r *renderer) pushMC(hide bool) {
	if len(r.mcHidden) > 1024 {
		return
	}
	r.mcHidden = append(r.mcHidden, hide)
	if hide {
		r.hidden++
	}
}

func (r *renderer) isHidden() bool {
	return r.hidden > 0
}

// colorOperands reads sc / scn operands; a trailing name selects a pattern
func (r *renderer) colorOperands(ops []Object, cs colorSpace) ([]float64, Object) {
	var pat Object
	if len(ops) > 0 {
		if n, ok := ops[len(ops)-1].(Name); ok {
			pat = r.d.resolve(r.d.dict(r.res["Pattern"])[n])
			ops = ops[:len(ops)-1]
		}
	}
	return r.numArgs(ops), pat
}

func (r *renderer) updateColor(fill bool) {
	gs := r.gs
	cs, comps := gs.strokeCS, gs.stroke
	if fill {
		cs, comps = gs.fillCS, gs.fill
	}
	none := false
	if t, ok := cs.(*csTint); ok && t.none {
		none = true
	}
	rr, gg, bb := cs.toRGB(comps)
	c := solidPaint{float32(rr), float32(gg), float32(bb)}
	if fill {
		gs.fillRGB, gs.fillNone = c, none
	} else {
		gs.strokeRGB, gs.strokeNone = c, none
	}
}

func (r *renderer) setExtGState(eg Dict) {
	if eg == nil {
		return
	}
	d := r.d
	gs := r.gs
	for k, v := range eg {
		switch k {
		case "LW":
			gs.lw = math.Abs(d.num(v, gs.lw))
		case "LC":
			gs.lineCap = d.integer(v, gs.lineCap)
		case "LJ":
			gs.lineJoin = d.integer(v, gs.lineJoin)
		case "ML":
			gs.ml = d.num(v, gs.ml)
		case "D":
			arr := d.array(v)
			if len(arr) == 2 {
				gs.dash = nil
				for _, e := range d.array(arr[0]) {
					gs.dash = append(gs.dash, math.Abs(d.num(e, 0)))
				}
				gs.dashPhase = d.num(arr[1], 0)
			}
		case "CA":
			gs.sa = clamp(d.num(v, 1), 0, 1)
		case "ca":
			gs.fa = clamp(d.num(v, 1), 0, 1)
		case "Font":
			arr := d.array(v)
			if len(arr) == 2 {
				gs.font = r.fontFromObject(arr[0])
				gs.fs = d.num(arr[1], gs.fs)
			}
		case "BM":
			bm := d.resolve(v)
			if a, ok := bm.(Array); ok && len(a) > 0 {
				bm = d.resolve(a[0])
			}
			switch d.name(bm) {
			case "Multiply":
				gs.blend = blendMultiply
			case "Screen":
				gs.blend = blendScreen
			case "Darken":
				gs.blend = blendDarken
			case "Lighten":
				gs.blend = blendLighten
			case "Overlay", "HardLight":
				gs.blend = blendOverlay
			case "Difference", "Exclusion":
				gs.blend = blendDifference
			default:
				gs.blend = blendNormal
			}
		case "SMask":
			if d.name(v) == "None" {
				gs.soft = nil
			} else if sm := d.dict(v); sm != nil {
				gs.soft = r.softMask(sm)
			}
		}
	}
}

func (r *renderer) font(n Name) *pdfFont {
	fonts := r.d.dict(r.res["Font"])
	if fonts == nil {
		return nil
	}
	return r.fontFromObject(fonts[n])
}

func (r *renderer) fontFromObject(o Object) *pdfFont {
	key := ""
	switch v := o.(type) {
	case Ref:
		key = fmt.Sprintf("r%d.%d", v.Num, v.Gen)
	case Dict:
		key = fmt.Sprintf("d%p", v)
	default:
		return nil
	}
	if f, ok := r.shared.fonts[key]; ok {
		return f
	}
	f := r.d.loadFont(o)
	r.shared.fonts[key] = f
	return f
}

/*
	Painting
*/

// raster rasterizes within the render's time budget; running out stops
// the render
func (r *renderer) raster(polys []polyline, evenOdd bool, bounds image.Rectangle) *mask {
	if r.stopped {
		return nil
	}
	m, aborted := rasterizeUntil(polys, evenOdd, bounds, r.deadline)
	if aborted {
		r.stopped = true
	}
	return m
}

func (r *renderer) endPath() {
	if r.clipOp != 0 {
		polys := r.path.flatten(r.gs.ctm, 0.3)
		cov := r.raster(polys, r.clipOp == 2, r.cv.bounds())
		if cov == nil {
			cov = &mask{}
		}
		r.gs.clip = intersectMasks(r.gs.clip, cov)
		r.clipOp = 0
	}
	r.path = path{}
}

func (r *renderer) paintBounds() image.Rectangle {
	return r.cv.bounds().Intersect(r.gs.clip.bounds())
}

func (r *renderer) fillPath(evenOdd bool) {
	if r.isHidden() || r.path.empty() || r.gs.fillNone {
		return
	}
	polys := r.path.flatten(r.gs.ctm, 0.3)
	cov := r.raster(polys, evenOdd, r.paintBounds())
	r.paintCoverage(cov, true)
}

// strokeWidth returns the stroke width in user space, widened so the line
// is at least minLineDevice wide on the device
func (r *renderer) strokeWidth(m matrix) float64 {
	sc := m.scale()
	if sc <= 0 {
		return 0
	}
	lw := r.gs.lw
	if lw*sc < minLineDevice {
		lw = minLineDevice / sc
	}
	return lw
}

func (r *renderer) strokePath() {
	if r.isHidden() || r.path.empty() || r.gs.strokeNone {
		return
	}
	r.strokeShape(&r.path, identity)
}

// strokeShape strokes a path given in the space pm maps into user space
func (r *renderer) strokeShape(p *path, pm matrix) {
	gs := r.gs
	ctm := gs.ctm
	sc := ctm.scale()
	if sc <= 0 || math.IsNaN(sc) {
		return
	}
	lw := r.strokeWidth(ctm)
	lines := p.flatten(pm, 0.3/sc)
	devRadius := lw * sc / 2
	//Drop subpaths that cannot reach the canvas, stroke width included
	{
		b := r.paintBounds()
		kept := lines[:0]
		for _, pl := range lines {
			lx, ly := math.Inf(1), math.Inf(1)
			hx, hy := math.Inf(-1), math.Inf(-1)
			for _, pt := range pl.pts {
				x, y := ctm.apply(pt.x, pt.y)
				lx, ly, hx, hy = math.Min(lx, x), math.Min(ly, y), math.Max(hx, x), math.Max(hy, y)
			}
			if hx+devRadius >= float64(b.Min.X) && lx-devRadius <= float64(b.Max.X) &&
				hy+devRadius >= float64(b.Min.Y) && ly-devRadius <= float64(b.Max.Y) {
				kept = append(kept, pl)
			}
		}
		lines = kept
	}
	segs := int(math.Ceil(devRadius * 2 * math.Pi / 1.5))
	if segs > 64 {
		segs = 64
	}
	var dash []float64
	if len(gs.dash) > 0 {
		total := 0.0
		for _, v := range gs.dash {
			total += v
		}
		//Dashes far below a pixel read as a lighter solid line
		if total*sc >= 1 {
			dash = gs.dash
		}
	}
	outline := strokePolys(lines, strokeStyle{
		width:      lw,
		cap:        gs.lineCap,
		join:       gs.lineJoin,
		miterLimit: gs.ml,
		dash:       dash,
		dashPhase:  gs.dashPhase,
		circleSegs: segs,
		devScale:   sc,
		maxPolys:   300000,
	})
	if time.Now().After(r.deadline) {
		r.stopped = true
		return
	}
	//To device space, dropping the pieces that lie wholly off the canvas
	b := r.paintBounds()
	minX, minY, maxX, maxY := float64(b.Min.X), float64(b.Min.Y), float64(b.Max.X), float64(b.Max.Y)
	kept := outline[:0]
	for i := range outline {
		lx, ly := math.Inf(1), math.Inf(1)
		hx, hy := math.Inf(-1), math.Inf(-1)
		for k, pt := range outline[i].pts {
			x, y := ctm.apply(pt.x, pt.y)
			outline[i].pts[k] = point{x, y}
			lx, ly, hx, hy = math.Min(lx, x), math.Min(ly, y), math.Max(hx, x), math.Max(hy, y)
		}
		if hx >= minX && lx <= maxX && hy >= minY && ly <= maxY {
			kept = append(kept, outline[i])
		}
	}
	cov := r.raster(kept, false, b)
	r.paintCoverage(cov, false)
}

// paintCoverage composites the current fill or stroke colour (or pattern)
func (r *renderer) paintCoverage(cov *mask, fill bool) {
	if cov == nil {
		return
	}
	gs := r.gs
	alpha := gs.sa
	color := gs.strokeRGB
	pat := gs.strokePat
	cs := gs.strokeCS
	comps := gs.stroke
	if fill {
		alpha, color, pat, cs, comps = gs.fa, gs.fillRGB, gs.fillPat, gs.fillCS, gs.fill
	}
	if r.forceColor != nil {
		r.cv.composite(cov, gs.clip, gs.soft, *r.forceColor, float32(alpha), gs.blend)
		return
	}
	if pcs, ok := cs.(*csPattern); ok {
		if pat == nil {
			return
		}
		var tint *solidPaint
		if pcs.base != nil {
			rr, gg, bb := pcs.base.toRGB(comps)
			tint = &solidPaint{float32(rr), float32(gg), float32(bb)}
		}
		r.paintPattern(cov, pat, tint, alpha)
		return
	}
	r.cv.composite(cov, gs.clip, gs.soft, color, float32(alpha), gs.blend)
}

/*
	Text
*/

func (r *renderer) nextLine() {
	r.tlm = matrix{1, 0, 0, 1, 0, -r.gs.tl}.mul(r.tlm)
	r.tm = r.tlm
}

func (r *renderer) textAdjust(n float64) {
	gs := r.gs
	if gs.font != nil && gs.font.vertical {
		r.tm = matrix{1, 0, 0, 1, 0, -n / 1000 * gs.fs}.mul(r.tm)
		return
	}
	r.tm = matrix{1, 0, 0, 1, -n / 1000 * gs.fs * gs.th, 0}.mul(r.tm)
}

func (r *renderer) showText(s []byte) {
	gs := r.gs
	f := gs.font
	if f == nil {
		return
	}
	visible := gs.tr != 3 && gs.tr != 7 && !r.isHidden()
	for _, c := range f.decode(s) {
		if !r.checkBudget() {
			return
		}
		w0 := f.advance(c)
		space := 0.0
		if c.n == 1 && c.code == 32 {
			space = gs.tw
		}
		trm := matrix{gs.fs * gs.th, 0, 0, gs.fs, 0, gs.rise}.mul(r.tm)
		var vx, vy, w1 float64
		if f.vertical {
			w1, vx, vy = f.verticalMetrics(c)
			trm = matrix{1, 0, 0, 1, -vx * gs.fs * gs.th, -vy * gs.fs}.mul(trm)
		}
		if visible && gs.fs != 0 {
			if f.kind == fontType3 {
				r.drawType3Glyph(f, c, trm)
			} else if g := f.outline(c); g != nil && g.p != nil && !g.p.empty() {
				r.drawGlyph(g, trm)
			}
		}
		if f.vertical {
			ty := w1*gs.fs + gs.tc + space
			r.tm = matrix{1, 0, 0, 1, 0, ty}.mul(r.tm)
		} else {
			tx := (w0*gs.fs + gs.tc + space) * gs.th
			r.tm = matrix{1, 0, 0, 1, tx, 0}.mul(r.tm)
		}
	}
}

func (r *renderer) drawGlyph(g *glyphOutline, trm matrix) {
	gs := r.gs
	userM := g.m.mul(trm)     //Glyph units to user space
	devM := userM.mul(gs.ctm) //Glyph units to device
	//Skip glyphs far outside the canvas
	ox, oy := devM.apply(0, 0)
	size := trm.mul(gs.ctm).scale() * 2
	b := r.paintBounds()
	if ox < float64(b.Min.X)-size || ox > float64(b.Max.X)+size || oy < float64(b.Min.Y)-size || oy > float64(b.Max.Y)+size {
		return
	}
	mode := gs.tr
	fill := mode == 0 || mode == 2 || mode == 4 || mode == 6
	stroke := mode == 1 || mode == 2 || mode == 5 || mode == 6
	if fill && !gs.fillNone {
		polys := g.p.flatten(devM, 0.2)
		cov := r.raster(polys, false, b)
		r.paintCoverage(cov, true)
	}
	if stroke && !gs.strokeNone {
		r.strokeShape(g.p, userM)
	}
	if mode >= 4 {
		r.textClip = append(r.textClip, g.p.flatten(devM, 0.2)...)
	}
}

func (r *renderer) drawType3Glyph(f *pdfFont, c charCode, trm matrix) {
	name := f.names[c.code&0xff]
	if name == "" || f.t3procs == nil || r.depth >= maxFormDepth {
		return
	}
	s := r.d.stream(f.t3procs[Name(name)])
	if s == nil || r.formsBusy[s] {
		return
	}
	data, err := r.d.decodeStream(s, 16<<20)
	if err != nil {
		return
	}
	res := f.t3res
	if res == nil {
		res = r.res
	}
	r.formsBusy[s] = true
	defer delete(r.formsBusy, s)
	saved := r.gs
	savedStack := r.stack
	savedPath := r.path
	savedTm, savedTlm := r.tm, r.tlm
	savedForce := r.forceColor
	//A d1 glyph is a shape only: it is painted in the current fill colour
	head := data
	if len(head) > 256 {
		head = head[:256]
	}
	if bytes.Contains(head, []byte("d1")) && r.forceColor == nil {
		c := saved.fillRGB
		r.forceColor = &c
	}
	defer func() { r.forceColor = savedForce }()
	r.gs = saved.clone()
	r.gs.ctm = f.t3matrix.mul(trm).mul(saved.ctm)
	r.stack = nil
	r.path = path{}
	r.depth++
	r.run(data, res)
	r.depth--
	r.gs = saved
	r.stack = savedStack
	r.path = savedPath
	r.tm, r.tlm = savedTm, savedTlm
}
