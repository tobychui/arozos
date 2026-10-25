package pdfrender

import (
	"math"
)

/*
	shading.go

	Shadings and patterns. Function (1), axial (2) and radial (3) shadings
	are evaluated per pixel through a colour lookup table; the mesh types
	(4-7) are drawn as small flat shaded triangles. Tiling patterns render
	one cell into an offscreen canvas and repeat it.
*/

type shading struct {
	typ    int
	cs     colorSpace
	fn     pdfFunction
	coords []float64
	domain []float64
	extend [2]bool
	bg     *solidPaint
	bbox   []float64
	matrix matrix //Type 1 domain to shading space
	lut    []solidPaint
	stream *Stream
	dict   Dict
}

func (d *Document) loadShading(o Object, res Dict) *shading {
	dict := d.dict(o)
	if dict == nil {
		return nil
	}
	sh := &shading{
		typ:    d.integer(dict["ShadingType"], 0),
		cs:     d.loadColorSpace(dict["ColorSpace"], res, 0),
		coords: d.numbers(dict["Coords"]),
		domain: d.numbers(dict["Domain"]),
		bbox:   d.numbers(dict["BBox"]),
		matrix: identity,
		dict:   dict,
		stream: d.stream(o),
	}
	if sh.cs == nil {
		return nil
	}
	if fo := dict["Function"]; fo != nil {
		sh.fn = d.loadFunction(fo, 0)
	}
	if e := d.array(dict["Extend"]); len(e) == 2 {
		b0, _ := d.resolve(e[0]).(bool)
		b1, _ := d.resolve(e[1]).(bool)
		sh.extend = [2]bool{b0, b1}
	}
	if bg := d.numbers(dict["Background"]); len(bg) == sh.cs.nComps() {
		rr, gg, bb := sh.cs.toRGB(bg)
		sh.bg = &solidPaint{float32(rr), float32(gg), float32(bb)}
	}
	if m := d.numbers(dict["Matrix"]); len(m) == 6 {
		sh.matrix = matrix{m[0], m[1], m[2], m[3], m[4], m[5]}
	}
	switch sh.typ {
	case 2, 3:
		if sh.fn == nil || (sh.typ == 2 && len(sh.coords) < 4) || (sh.typ == 3 && len(sh.coords) < 6) {
			return nil
		}
		if len(sh.domain) < 2 {
			sh.domain = []float64{0, 1}
		}
		//Colours along t in [0, 1]
		sh.lut = make([]solidPaint, 256)
		for i := range sh.lut {
			t := sh.domain[0] + float64(i)/255*(sh.domain[1]-sh.domain[0])
			sh.lut[i] = sh.color([]float64{t})
		}
	case 1:
		if sh.fn == nil {
			return nil
		}
		if len(sh.domain) < 4 {
			sh.domain = []float64{0, 1, 0, 1}
		}
	case 4, 5, 6, 7:
		if sh.stream == nil {
			return nil
		}
	default:
		return nil
	}
	return sh
}

func (sh *shading) color(in []float64) solidPaint {
	c := in
	if sh.fn != nil {
		c = sh.fn.eval(in)
	}
	rr, gg, bb := sh.cs.toRGB(c)
	return solidPaint{float32(rr), float32(gg), float32(bb)}
}

// shadingPainter evaluates a shading at device pixels
type shadingPainter struct {
	sh  *shading
	inv matrix //Device to shading space
}

func (p *shadingPainter) at(x, y int) (float32, float32, float32, float32) {
	sx, sy := p.inv.apply(float64(x)+0.5, float64(y)+0.5)
	sh := p.sh
	if len(sh.bbox) == 4 {
		if sx < math.Min(sh.bbox[0], sh.bbox[2]) || sx > math.Max(sh.bbox[0], sh.bbox[2]) ||
			sy < math.Min(sh.bbox[1], sh.bbox[3]) || sy > math.Max(sh.bbox[1], sh.bbox[3]) {
			return 0, 0, 0, 0
		}
	}
	var t float64
	switch sh.typ {
	case 1:
		minv, ok := sh.matrix.invert()
		if !ok {
			return 0, 0, 0, 0
		}
		dx, dy := minv.apply(sx, sy)
		if dx < sh.domain[0] || dx > sh.domain[1] || dy < sh.domain[2] || dy > sh.domain[3] {
			return p.background()
		}
		c := sh.color([]float64{dx, dy})
		return c.r, c.g, c.b, 1
	case 2:
		c := sh.coords
		dx, dy := c[2]-c[0], c[3]-c[1]
		l := dx*dx + dy*dy
		if l == 0 {
			return p.background()
		}
		t = ((sx-c[0])*dx + (sy-c[1])*dy) / l
	case 3:
		c := sh.coords
		x0, y0, r0, x1, y1, r1 := c[0], c[1], c[2], c[3], c[4], c[5]
		cdx, cdy, dr := x1-x0, y1-y0, r1-r0
		px, py := sx-x0, sy-y0
		a := cdx*cdx + cdy*cdy - dr*dr
		b := px*cdx + py*cdy + r0*dr
		cc := px*px + py*py - r0*r0
		var s float64
		found := false
		if math.Abs(a) < 1e-9 {
			if b != 0 {
				s = cc / (2 * b)
				found = r0+s*dr >= 0
			}
		} else {
			disc := b*b - a*cc
			if disc >= 0 {
				sq := math.Sqrt(disc)
				s1 := (b + sq) / a
				s2 := (b - sq) / a
				if s1 < s2 {
					s1, s2 = s2, s1
				}
				//Prefer the larger root whose radius is not negative and in range
				for _, cand := range []float64{s1, s2} {
					if r0+cand*dr < 0 {
						continue
					}
					if (cand < 0 && !sh.extend[0]) || (cand > 1 && !sh.extend[1]) {
						continue
					}
					s = cand
					found = true
					break
				}
			}
		}
		if !found {
			return p.background()
		}
		t = s
	}
	if t < 0 {
		if !sh.extend[0] {
			return p.background()
		}
		t = 0
	}
	if t > 1 {
		if !sh.extend[1] {
			return p.background()
		}
		t = 1
	}
	c := sh.lut[int(t*255+0.5)]
	return c.r, c.g, c.b, 1
}

func (p *shadingPainter) background() (float32, float32, float32, float32) {
	return 0, 0, 0, 0
}

// paintShadingOp is the sh operator: paint the shading over the clip
func (r *renderer) paintShadingOp(o Object) {
	sh := r.d.loadShading(o, r.res)
	if sh == nil {
		return
	}
	gs := r.gs
	b := r.paintBounds()
	if b.Empty() {
		return
	}
	cov := &mask{r: b}
	if len(sh.bbox) == 4 {
		p := path{}
		p.moveTo(sh.bbox[0], sh.bbox[1])
		p.lineTo(sh.bbox[2], sh.bbox[1])
		p.lineTo(sh.bbox[2], sh.bbox[3])
		p.lineTo(sh.bbox[0], sh.bbox[3])
		p.close()
		cov = r.raster(p.flatten(gs.ctm, 0.3), false, b)
		if cov == nil {
			return
		}
	}
	r.drawShading(sh, cov, gs.ctm, gs.fa)
}

// drawShading paints a shading (in the space m maps to the device) through
// a coverage mask
func (r *renderer) drawShading(sh *shading, cov *mask, m matrix, alpha float64) {
	gs := r.gs
	if sh.typ >= 4 {
		r.drawMesh(sh, cov, m, alpha)
		return
	}
	inv, ok := m.invert()
	if !ok {
		return
	}
	r.cv.composite(cov, gs.clip, gs.soft, &shadingPainter{sh: sh, inv: inv}, float32(alpha), gs.blend)
}

/*
	Mesh shadings
*/

type meshVertex struct {
	x, y float64
	c    []float64
}

func (r *renderer) drawMesh(sh *shading, cov *mask, m matrix, alpha float64) {
	d := r.d
	data, err := d.decodeStream(sh.stream, 32<<20)
	if err != nil && len(data) == 0 {
		return
	}
	dict := sh.dict
	bpc := d.integer(dict["BitsPerCoordinate"], 16)
	bpcomp := d.integer(dict["BitsPerComponent"], 16)
	bpf := d.integer(dict["BitsPerFlag"], 8)
	dec := d.numbers(dict["Decode"])
	if bpc < 1 || bpc > 32 || bpcomp < 1 || bpcomp > 16 || len(dec) < 6 {
		return
	}
	ncomp := sh.cs.nComps()
	if sh.fn != nil {
		ncomp = 1
	}
	if len(dec) < 4+2*ncomp {
		return
	}
	br := &bitReader{data: data}
	readCoord := func(lo, hi float64) (float64, bool) {
		v, ok := br.read(bpc)
		maxV := math.Pow(2, float64(bpc)) - 1
		return lo + float64(v)*(hi-lo)/maxV, ok
	}
	readVertex := func() (meshVertex, bool) {
		var v meshVertex
		var ok bool
		if v.x, ok = readCoord(dec[0], dec[1]); !ok {
			return v, false
		}
		if v.y, ok = readCoord(dec[2], dec[3]); !ok {
			return v, false
		}
		maxC := math.Pow(2, float64(bpcomp)) - 1
		for k := 0; k < ncomp; k++ {
			c, ok := br.read(bpcomp)
			if !ok {
				return v, false
			}
			lo, hi := dec[4+2*k], dec[5+2*k]
			v.c = append(v.c, lo+float64(c)*(hi-lo)/maxC)
		}
		return v, true
	}
	clipCov := intersectMasks(r.gs.clip, cov)
	tri := func(a, b, c meshVertex) {
		r.meshTriangle(sh, clipCov, m, alpha, a, b, c)
	}
	count := 0
	switch sh.typ {
	case 4:
		var prev []meshVertex
		for count < 200000 && !r.stopped {
			f, ok := br.read(bpf)
			if !ok {
				break
			}
			v, ok := readVertex()
			if !ok {
				break
			}
			br.alignByte()
			count++
			switch {
			case f == 0 || len(prev) < 2:
				prev = append(prev, v)
				if len(prev) > 3 {
					prev = prev[len(prev)-3:]
				}
				if f == 0 && len(prev) == 3 {
					tri(prev[0], prev[1], prev[2])
					prev = prev[:0]
				}
			case f == 1:
				tri(prev[len(prev)-2], prev[len(prev)-1], v)
				prev = []meshVertex{prev[len(prev)-1], v}
			case f == 2:
				tri(prev[len(prev)-2], prev[len(prev)-1], v)
				prev = []meshVertex{prev[len(prev)-2], v}
			}
		}
	case 5:
		per := d.integer(dict["VerticesPerRow"], 2)
		if per < 2 || per > 4096 {
			return
		}
		var rows [][]meshVertex
		var row []meshVertex
		for count < 200000 {
			v, ok := readVertex()
			if !ok {
				break
			}
			count++
			row = append(row, v)
			if len(row) == per {
				rows = append(rows, row)
				row = nil
			}
		}
		for i := 1; i < len(rows) && !r.stopped; i++ {
			for j := 1; j < per; j++ {
				a, b := rows[i-1][j-1], rows[i-1][j]
				c, e := rows[i][j-1], rows[i][j]
				tri(a, b, c)
				tri(b, e, c)
			}
		}
	case 6, 7:
		nPts := 12
		if sh.typ == 7 {
			nPts = 16
		}
		var prevPts []point
		var prevCols [][]float64
		for count < 50000 && !r.stopped {
			f, ok := br.read(bpf)
			if !ok {
				break
			}
			newPts := nPts
			newCols := 4
			if f != 0 {
				newPts -= 4
				newCols = 2
			}
			pts := make([]point, 0, nPts)
			cols := make([][]float64, 0, 4)
			if f != 0 {
				if len(prevPts) == 0 {
					break
				}
				//Edge shared with the previous patch, per flag
				var edge []point
				var ec [][]float64
				switch f {
				case 1:
					edge = []point{prevPts[3], prevPts[4], prevPts[5], prevPts[6]}
					ec = [][]float64{prevCols[1], prevCols[2]}
				case 2:
					edge = []point{prevPts[6], prevPts[7], prevPts[8], prevPts[9]}
					ec = [][]float64{prevCols[2], prevCols[3]}
				default:
					edge = []point{prevPts[9], prevPts[10], prevPts[11], prevPts[0]}
					ec = [][]float64{prevCols[3], prevCols[0]}
				}
				pts = append(pts, edge...)
				cols = append(cols, ec...)
			}
			bad := false
			for k := 0; k < newPts; k++ {
				x, ok1 := readCoord(dec[0], dec[1])
				y, ok2 := readCoord(dec[2], dec[3])
				if !ok1 || !ok2 {
					bad = true
					break
				}
				pts = append(pts, point{x, y})
			}
			maxC := math.Pow(2, float64(bpcomp)) - 1
			for k := 0; k < newCols && !bad; k++ {
				var c []float64
				for j := 0; j < ncomp; j++ {
					v, ok := br.read(bpcomp)
					if !ok {
						bad = true
						break
					}
					lo, hi := dec[4+2*j], dec[5+2*j]
					c = append(c, lo+float64(v)*(hi-lo)/maxC)
				}
				cols = append(cols, c)
			}
			br.alignByte()
			if bad || len(pts) < 12 || len(cols) < 4 {
				break
			}
			count++
			r.drawPatch(pts, cols, tri)
			prevPts, prevCols = pts, cols
		}
	}
}

// drawPatch splits a Coons patch into a grid of triangles
func (r *renderer) drawPatch(pts []point, cols [][]float64, tri func(a, b, c meshVertex)) {
	bez := func(p0, p1, p2, p3 point, t float64) point {
		mt := 1 - t
		a, b, c, d := mt*mt*mt, 3*mt*mt*t, 3*mt*t*t, t*t*t
		return point{a*p0.x + b*p1.x + c*p2.x + d*p3.x, a*p0.y + b*p1.y + c*p2.y + d*p3.y}
	}
	//Boundary curves: points 0..3 (u=0 edge), 3..6, 6..9, 9..0
	c1 := func(u float64) point { return bez(pts[0], pts[1], pts[2], pts[3], u) }
	c2 := func(v float64) point { return bez(pts[3], pts[4], pts[5], pts[6], v) }
	c3 := func(u float64) point { return bez(pts[9], pts[8], pts[7], pts[6], u) }
	c4 := func(v float64) point { return bez(pts[0], pts[11], pts[10], pts[9], v) }
	p00, p10, p11, p01 := pts[0], pts[3], pts[6], pts[9]
	surf := func(u, v float64) point {
		a := c1(u)
		b := c3(u)
		c := c4(v)
		d := c2(v)
		x := (1-v)*a.x + v*b.x + (1-u)*c.x + u*d.x - ((1-u)*(1-v)*p00.x + u*(1-v)*p10.x + u*v*p11.x + (1-u)*v*p01.x)
		y := (1-v)*a.y + v*b.y + (1-u)*c.y + u*d.y - ((1-u)*(1-v)*p00.y + u*(1-v)*p10.y + u*v*p11.y + (1-u)*v*p01.y)
		return point{x, y}
	}
	col := func(u, v float64) []float64 {
		out := make([]float64, len(cols[0]))
		for k := range out {
			get := func(c []float64) float64 {
				if k < len(c) {
					return c[k]
				}
				return 0
			}
			out[k] = (1-u)*(1-v)*get(cols[0]) + u*(1-v)*get(cols[1]) + u*v*get(cols[2]) + (1-u)*v*get(cols[3])
		}
		return out
	}
	const n = 6
	grid := make([][]meshVertex, n+1)
	for i := 0; i <= n; i++ {
		grid[i] = make([]meshVertex, n+1)
		for j := 0; j <= n; j++ {
			u, v := float64(i)/n, float64(j)/n
			p := surf(u, v)
			grid[i][j] = meshVertex{x: p.x, y: p.y, c: col(u, v)}
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			tri(grid[i][j], grid[i+1][j], grid[i][j+1])
			tri(grid[i+1][j], grid[i+1][j+1], grid[i][j+1])
		}
	}
}

func (r *renderer) meshTriangle(sh *shading, clip *mask, m matrix, alpha float64, a, b, c meshVertex) {
	p := path{}
	ax, ay := m.apply(a.x, a.y)
	bx, by := m.apply(b.x, b.y)
	cx, cy := m.apply(c.x, c.y)
	p.moveTo(ax, ay)
	p.lineTo(bx, by)
	p.lineTo(cx, cy)
	p.close()
	//Grow the triangle a little so neighbours meet without hairline gaps
	ctrX, ctrY := (ax+bx+cx)/3, (ay+by+cy)/3
	grow := func(x, y float64) point {
		dx, dy := x-ctrX, y-ctrY
		l := math.Hypot(dx, dy)
		if l < 1e-9 {
			return point{x, y}
		}
		return point{x + dx/l*0.35, y + dy/l*0.35}
	}
	poly := []polyline{{pts: []point{grow(ax, ay), grow(bx, by), grow(cx, cy)}, closed: true}}
	cov := r.raster(poly, false, r.cv.bounds().Intersect(clip.bounds()))
	if cov == nil {
		return
	}
	avg := make([]float64, len(a.c))
	for k := range avg {
		get := func(v meshVertex) float64 {
			if k < len(v.c) {
				return v.c[k]
			}
			return 0
		}
		avg[k] = (get(a) + get(b) + get(c)) / 3
	}
	col := sh.color(avg)
	r.cv.composite(cov, clip, r.gs.soft, col, float32(alpha), r.gs.blend)
}

/*
	Patterns
*/

type tilePainter struct {
	tile         *canvas
	inv          matrix //Device to pattern space
	x0, y0       float64
	xstep, ystep float64
}

func (p *tilePainter) at(x, y int) (float32, float32, float32, float32) {
	px, py := p.inv.apply(float64(x)+0.5, float64(y)+0.5)
	u := math.Mod(px-p.x0, p.xstep)
	if u < 0 {
		u += p.xstep
	}
	v := math.Mod(py-p.y0, p.ystep)
	if v < 0 {
		v += p.ystep
	}
	tx := int(u / p.xstep * float64(p.tile.w))
	ty := int((1 - v/p.ystep) * float64(p.tile.h))
	if tx >= p.tile.w {
		tx = p.tile.w - 1
	}
	if ty >= p.tile.h {
		ty = p.tile.h - 1
	}
	if tx < 0 {
		tx = 0
	}
	if ty < 0 {
		ty = 0
	}
	i := (ty*p.tile.w + tx) * 4
	a := p.tile.pix[i+3]
	if a <= 0 {
		return 0, 0, 0, 0
	}
	return p.tile.pix[i] / a, p.tile.pix[i+1] / a, p.tile.pix[i+2] / a, a
}

// patternPainter builds the painter of a pattern object
func (r *renderer) patternPainter(pat Object, tint *solidPaint) painter {
	d := r.d
	dict := d.dict(pat)
	if dict == nil {
		return nil
	}
	pm := identity
	if m := d.numbers(dict["Matrix"]); len(m) == 6 {
		pm = matrix{m[0], m[1], m[2], m[3], m[4], m[5]}
	}
	toDev := pm.mul(r.base)
	switch d.integer(dict["PatternType"], 0) {
	case 2:
		sh := d.loadShading(dict["Shading"], r.res)
		if sh == nil || sh.typ >= 4 {
			return nil
		}
		inv, ok := toDev.invert()
		if !ok {
			return nil
		}
		return &shadingPainter{sh: sh, inv: inv}
	case 1:
		s := d.stream(pat)
		if s == nil {
			return nil
		}
		return r.tilingPainter(s, toDev, tint)
	}
	return nil
}

func (r *renderer) paintPattern(cov *mask, pat Object, tint *solidPaint, alpha float64) {
	d := r.d
	dict := d.dict(pat)
	if dict == nil {
		return
	}
	if d.integer(dict["PatternType"], 0) == 2 {
		sh := d.loadShading(dict["Shading"], r.res)
		if sh == nil {
			return
		}
		pm := identity
		if m := d.numbers(dict["Matrix"]); len(m) == 6 {
			pm = matrix{m[0], m[1], m[2], m[3], m[4], m[5]}
		}
		if sh.typ >= 4 {
			r.drawMesh(sh, cov, pm.mul(r.base), alpha)
			return
		}
		//Outside the shading the Background colour fills the shape
		if sh.bg != nil {
			r.cv.composite(cov, r.gs.clip, r.gs.soft, *sh.bg, float32(alpha), r.gs.blend)
		}
		r.drawShading(sh, cov, pm.mul(r.base), alpha)
		return
	}
	p := r.patternPainter(pat, tint)
	if p == nil {
		return
	}
	r.cv.composite(cov, r.gs.clip, r.gs.soft, p, float32(alpha), r.gs.blend)
}

func (r *renderer) tilingPainter(s *Stream, toDev matrix, tint *solidPaint) painter {
	d := r.d
	bb := d.numbers(s.Dict["BBox"])
	if len(bb) != 4 || r.depth >= maxFormDepth || r.formsBusy[s] {
		return nil
	}
	xstep := math.Abs(d.num(s.Dict["XStep"], bb[2]-bb[0]))
	ystep := math.Abs(d.num(s.Dict["YStep"], bb[3]-bb[1]))
	if xstep <= 0 || ystep <= 0 {
		return nil
	}
	x0, y0 := math.Min(bb[0], bb[2]), math.Min(bb[1], bb[3])
	sx := math.Hypot(toDev[0], toDev[1])
	sy := math.Hypot(toDev[2], toDev[3])
	tw := int(math.Ceil(xstep * sx))
	th := int(math.Ceil(ystep * sy))
	if tw < 1 {
		tw = 1
	}
	if th < 1 {
		th = 1
	}
	for tw*th > 512*512 || tw > 2048 || th > 2048 {
		tw = (tw + 1) / 2
		th = (th + 1) / 2
	}
	inv, ok := toDev.invert()
	if !ok {
		return nil
	}
	tile := newCanvas(tw, th, false)
	//Pattern space to tile pixels, y flipped
	tm := matrix{float64(tw) / xstep, 0, 0, -float64(th) / ystep, -x0 * float64(tw) / xstep, (y0 + ystep) * float64(th) / ystep}
	sub := newRenderer(d, tile, tm, r.shared, r.deadline)
	sub.depth = r.depth + 1
	sub.ops = r.ops
	sub.formsBusy = r.formsBusy
	if d.integer(s.Dict["PaintType"], 1) == 2 {
		if tint == nil {
			tint = &r.gs.fillRGB
		}
		sub.forceColor = tint
	}
	sub.gs.clip = &mask{r: tile.bounds()}
	sub.runForm(s, identity, true, false)
	r.ops = sub.ops
	if sub.stopped {
		r.stopped = true
	}
	return &tilePainter{tile: tile, inv: inv, x0: x0, y0: y0, xstep: xstep, ystep: ystep}
}
