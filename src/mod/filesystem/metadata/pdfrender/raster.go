package pdfrender

import (
	"image"
	"math"
	"sort"
	"time"
)

/*
	raster.go

	A small anti-aliased vector rasteriser: paths are flattened into
	polygons, polygons become coverage masks (non-zero or even-odd, exact
	horizontal coverage and a few sub-scanlines per pixel), and masks are
	composited onto a premultiplied float canvas. Strokes are built as a
	union of per-segment quads, joins and caps, all wound the same way, so
	one non-zero fill draws them without seams.
*/

type matrix [6]float64

var identity = matrix{1, 0, 0, 1, 0, 0}

// mul returns m followed by n
func (m matrix) mul(n matrix) matrix {
	return matrix{
		m[0]*n[0] + m[1]*n[2],
		m[0]*n[1] + m[1]*n[3],
		m[2]*n[0] + m[3]*n[2],
		m[2]*n[1] + m[3]*n[3],
		m[4]*n[0] + m[5]*n[2] + n[4],
		m[4]*n[1] + m[5]*n[3] + n[5],
	}
}

func (m matrix) apply(x, y float64) (float64, float64) {
	return m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]
}

func (m matrix) applyVec(x, y float64) (float64, float64) {
	return m[0]*x + m[2]*y, m[1]*x + m[3]*y
}

func (m matrix) invert() (matrix, bool) {
	det := m[0]*m[3] - m[1]*m[2]
	if math.Abs(det) < 1e-12 || math.IsNaN(det) {
		return identity, false
	}
	return matrix{
		m[3] / det, -m[1] / det,
		-m[2] / det, m[0] / det,
		(m[2]*m[5] - m[3]*m[4]) / det,
		(m[1]*m[4] - m[0]*m[5]) / det,
	}, true
}

// scale is the average length a unit vector gets under m
func (m matrix) scale() float64 {
	return math.Sqrt(math.Abs(m[0]*m[3] - m[1]*m[2]))
}

type point struct{ x, y float64 }

type pathOp uint8

const (
	opMove pathOp = iota
	opLine
	opQuad
	opCubic
	opClose
)

type path struct {
	ops []pathOp
	pts []point
}

func (p *path) moveTo(x, y float64) {
	p.ops = append(p.ops, opMove)
	p.pts = append(p.pts, point{x, y})
}

func (p *path) lineTo(x, y float64) {
	if len(p.ops) == 0 {
		p.moveTo(x, y)
		return
	}
	p.ops = append(p.ops, opLine)
	p.pts = append(p.pts, point{x, y})
}

func (p *path) quadTo(x1, y1, x, y float64) {
	if len(p.ops) == 0 {
		p.moveTo(x1, y1)
	}
	p.ops = append(p.ops, opQuad)
	p.pts = append(p.pts, point{x1, y1}, point{x, y})
}

func (p *path) cubicTo(x1, y1, x2, y2, x, y float64) {
	if len(p.ops) == 0 {
		p.moveTo(x1, y1)
	}
	p.ops = append(p.ops, opCubic)
	p.pts = append(p.pts, point{x1, y1}, point{x2, y2}, point{x, y})
}

func (p *path) close() {
	if len(p.ops) > 0 && p.ops[len(p.ops)-1] != opClose {
		p.ops = append(p.ops, opClose)
	}
}

func (p *path) empty() bool {
	return len(p.ops) == 0
}

func (p *path) currentPoint() (point, bool) {
	if len(p.pts) == 0 {
		return point{}, false
	}
	//After a close the current point is the start of that subpath
	if p.ops[len(p.ops)-1] == opClose {
		pi := 0
		start := point{}
		for _, op := range p.ops {
			switch op {
			case opMove:
				start = p.pts[pi]
				pi++
			case opLine:
				pi++
			case opQuad:
				pi += 2
			case opCubic:
				pi += 3
			}
		}
		return start, true
	}
	return p.pts[len(p.pts)-1], true
}

type polyline struct {
	pts    []point
	closed bool
}

// flatten turns the path into polylines in the space of m, with curves
// split until they are within tol of the polyline
func (p *path) flatten(m matrix, tol float64) []polyline {
	var out []polyline
	var cur *polyline
	pi := 0
	var last point
	tp := func(q point) point {
		x, y := m.apply(q.x, q.y)
		return point{x, y}
	}
	for _, op := range p.ops {
		switch op {
		case opMove:
			out = append(out, polyline{})
			cur = &out[len(out)-1]
			last = tp(p.pts[pi])
			cur.pts = append(cur.pts, last)
			pi++
		case opLine:
			if cur == nil {
				pi++
				continue
			}
			last = tp(p.pts[pi])
			cur.pts = append(cur.pts, last)
			pi++
		case opQuad:
			if cur == nil {
				pi += 2
				continue
			}
			c := tp(p.pts[pi])
			e := tp(p.pts[pi+1])
			//Elevate to a cubic
			c1 := point{last.x + 2.0/3*(c.x-last.x), last.y + 2.0/3*(c.y-last.y)}
			c2 := point{e.x + 2.0/3*(c.x-e.x), e.y + 2.0/3*(c.y-e.y)}
			cur.pts = flattenCubic(cur.pts, last, c1, c2, e, tol)
			last = e
			pi += 2
		case opCubic:
			if cur == nil {
				pi += 3
				continue
			}
			c1 := tp(p.pts[pi])
			c2 := tp(p.pts[pi+1])
			e := tp(p.pts[pi+2])
			cur.pts = flattenCubic(cur.pts, last, c1, c2, e, tol)
			last = e
			pi += 3
		case opClose:
			if cur != nil {
				cur.closed = true
				if len(cur.pts) > 0 {
					last = cur.pts[0]
				}
				//Drawing after a close starts a new subpath at the same point
				out = append(out, polyline{pts: []point{last}})
				cur = &out[len(out)-1]
			}
		}
	}
	//Drop the empty subpaths created after close
	clean := out[:0]
	for _, pl := range out {
		if len(pl.pts) > 1 || (len(pl.pts) == 1 && !pl.closed) {
			clean = append(clean, pl)
		}
	}
	return clean
}

func flattenCubic(dst []point, p0, p1, p2, p3 point, tol float64) []point {
	//Number of segments from the control polygon's deviation
	dd := math.Max(
		math.Hypot(p0.x-2*p1.x+p2.x, p0.y-2*p1.y+p2.y),
		math.Hypot(p1.x-2*p2.x+p3.x, p1.y-2*p2.y+p3.y))
	n := int(math.Ceil(math.Sqrt(dd * 0.75 / tol)))
	if n < 1 {
		n = 1
	}
	if n > 100 || math.IsNaN(dd) {
		n = 100
	}
	for i := 1; i <= n; i++ {
		t := float64(i) / float64(n)
		mt := 1 - t
		a := mt * mt * mt
		b := 3 * mt * mt * t
		c := 3 * mt * t * t
		e := t * t * t
		dst = append(dst, point{a*p0.x + b*p1.x + c*p2.x + e*p3.x, a*p0.y + b*p1.y + c*p2.y + e*p3.y})
	}
	return dst
}

/*
	Coverage masks
*/

// mask holds coverage 0..255 over a rectangle; outside it the coverage is
// zero. A nil a means full coverage everywhere inside r.
type mask struct {
	r image.Rectangle
	a []uint8
}

func (m *mask) at(x, y int) uint8 {
	if m == nil {
		return 255
	}
	if !(image.Point{x, y}).In(m.r) {
		return 0
	}
	if m.a == nil {
		return 255
	}
	return m.a[(y-m.r.Min.Y)*m.r.Dx()+(x-m.r.Min.X)]
}

// intersectMasks multiplies two masks; nil stands for "no mask"
func intersectMasks(a, b *mask) *mask {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	r := a.r.Intersect(b.r)
	if r.Empty() {
		return &mask{r: image.Rectangle{}}
	}
	if a.a == nil && b.a == nil {
		return &mask{r: r}
	}
	out := &mask{r: r, a: make([]uint8, r.Dx()*r.Dy())}
	i := 0
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			out.a[i] = uint8((int(a.at(x, y))*int(b.at(x, y)) + 127) / 255)
			i++
		}
	}
	return out
}

func (m *mask) bounds() image.Rectangle {
	if m == nil {
		return image.Rect(-1<<20, -1<<20, 1<<20, 1<<20)
	}
	return m.r
}

type edge struct {
	x0, y0, x1, y1 float64
	dir            int
}

const subSamples = 5

// rasterize builds the coverage of closed polygons within bounds
func rasterize(polys []polyline, evenOdd bool, bounds image.Rectangle) *mask {
	m, _ := rasterizeUntil(polys, evenOdd, bounds, time.Time{})
	return m
}

// rasterizeUntil is rasterize with a deadline (zero for none). A shape with
// a huge number of edges across the whole canvas can take far longer than
// the render budget, so the deadline is checked as the work goes; aborted
// reports that it ran out and the coverage is unusable.
func rasterizeUntil(polys []polyline, evenOdd bool, bounds image.Rectangle, deadline time.Time) (m *mask, aborted bool) {
	var edges []edge
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, pl := range polys {
		n := len(pl.pts)
		if n < 2 {
			continue
		}
		for i := 0; i < n; i++ {
			a := pl.pts[i]
			b := pl.pts[(i+1)%n]
			if math.IsNaN(a.x) || math.IsNaN(a.y) || math.IsNaN(b.x) || math.IsNaN(b.y) {
				continue
			}
			minX = math.Min(minX, a.x)
			maxX = math.Max(maxX, a.x)
			minY = math.Min(minY, a.y)
			maxY = math.Max(maxY, a.y)
			if a.y == b.y {
				continue
			}
			if a.y < b.y {
				edges = append(edges, edge{a.x, a.y, b.x, b.y, 1})
			} else {
				edges = append(edges, edge{b.x, b.y, a.x, a.y, -1})
			}
		}
	}
	if len(edges) == 0 {
		return nil, false
	}
	clampF := func(v float64) int {
		if v < -1<<24 {
			return -1 << 24
		}
		if v > 1<<24 {
			return 1 << 24
		}
		return int(v)
	}
	r := image.Rect(clampF(math.Floor(minX)), clampF(math.Floor(minY)), clampF(math.Ceil(maxX))+1, clampF(math.Ceil(maxY))+1).Intersect(bounds)
	if r.Empty() {
		return nil, false
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].y0 < edges[j].y0 })

	w := r.Dx()
	out := &mask{r: r, a: make([]uint8, w*r.Dy())}
	cov := make([]float32, w+1)
	diff := make([]float32, w+2)
	type crossing struct {
		x   float64
		dir int
	}
	var active []int
	var xs []crossing
	nextEdge := 0
	ox := float64(r.Min.X)
	full := true
	work := 0
	for y := r.Min.Y; y < r.Max.Y; y++ {
		if work > 1<<18 && !deadline.IsZero() {
			work = 0
			if time.Now().After(deadline) {
				return nil, true
			}
		}
		work += len(active)
		rowHit := false
		for s := 0; s < subSamples; s++ {
			sy := float64(y) + (float64(s)+0.5)/subSamples
			for nextEdge < len(edges) && edges[nextEdge].y0 <= sy {
				active = append(active, nextEdge)
				nextEdge++
			}
			xs = xs[:0]
			keep := active[:0]
			for _, ei := range active {
				e := &edges[ei]
				if e.y1 <= sy {
					continue
				}
				keep = append(keep, ei)
				if e.y0 > sy {
					continue
				}
				x := e.x0 + (sy-e.y0)*(e.x1-e.x0)/(e.y1-e.y0)
				xs = append(xs, crossing{x - ox, e.dir})
			}
			active = keep
			if len(xs) < 2 {
				continue
			}
			sort.Slice(xs, func(i, j int) bool { return xs[i].x < xs[j].x })
			wind := 0
			for i := 0; i < len(xs)-1; i++ {
				wind += xs[i].dir
				inside := wind != 0
				if evenOdd {
					inside = wind&1 != 0
				}
				if !inside {
					continue
				}
				xa := math.Max(xs[i].x, 0)
				xb := math.Min(xs[i+1].x, float64(w))
				if xb <= xa {
					continue
				}
				rowHit = true
				ia := int(xa)
				ib := int(xb)
				if ia == ib {
					cov[ia] += float32(xb - xa)
					continue
				}
				cov[ia] += float32(float64(ia+1) - xa)
				diff[ia+1]++
				diff[ib]--
				if ib < w {
					cov[ib] += float32(xb - float64(ib))
				}
			}
		}
		row := out.a[(y-r.Min.Y)*w : (y-r.Min.Y+1)*w]
		if !rowHit {
			full = false
			continue
		}
		var run float32
		for x := 0; x < w; x++ {
			run += diff[x]
			v := (run + cov[x]) / subSamples
			if v >= 0.999 {
				row[x] = 255
			} else if v > 0 {
				row[x] = uint8(v*255 + 0.5)
				full = false
			} else {
				full = false
			}
			cov[x] = 0
			diff[x] = 0
		}
		diff[w] = 0
		diff[w+1] = 0
		cov[w] = 0
	}
	if full {
		out.a = nil
	}
	return out, false
}

/*
	Stroking
*/

const (
	capButt = iota
	capRound
	capSquare
)

const (
	joinMiter = iota
	joinRound
	joinBevel
)

type strokeStyle struct {
	width      float64
	cap        int
	join       int
	miterLimit float64
	dash       []float64
	dashPhase  float64
	//Segments per full circle for round joins and caps
	circleSegs int
	//Device pixels per unit, to skip joins too small to see
	devScale float64
	//Upper bound on the polygons built (0 for no limit)
	maxPolys int
}

func polyArea(pts []point) float64 {
	a := 0.0
	n := len(pts)
	for i := 0; i < n; i++ {
		j := (i + 1) % n
		a += pts[i].x*pts[j].y - pts[j].x*pts[i].y
	}
	return a / 2
}

func addPoly(dst []polyline, pts []point) []polyline {
	if polyArea(pts) < 0 {
		for i, j := 0, len(pts)-1; i < j; i, j = i+1, j-1 {
			pts[i], pts[j] = pts[j], pts[i]
		}
	}
	return append(dst, polyline{pts: pts, closed: true})
}

func circlePoly(c point, r float64, segs int) []point {
	pts := make([]point, segs)
	for i := 0; i < segs; i++ {
		a := 2 * math.Pi * float64(i) / float64(segs)
		pts[i] = point{c.x + r*math.Cos(a), c.y + r*math.Sin(a)}
	}
	return pts
}

// dashLines splits polylines by a dash pattern
func dashLines(lines []polyline, dash []float64, phase float64) []polyline {
	total := 0.0
	for _, v := range dash {
		if v < 0 {
			return lines
		}
		total += v
	}
	if total <= 0 {
		return lines
	}
	var out []polyline
	for _, pl := range lines {
		pts := pl.pts
		if pl.closed && len(pts) > 1 {
			pts = append(append([]point{}, pts...), pts[0])
		}
		//Find the starting dash from the phase
		idx := 0
		left := dash[0]
		ph := math.Mod(phase, total)
		if ph < 0 {
			ph += total
		}
		for ph > 0 {
			if ph >= left {
				ph -= left
				idx = (idx + 1) % len(dash)
				left = dash[idx]
			} else {
				left -= ph
				ph = 0
			}
		}
		on := idx%2 == 0
		var cur []point
		if on && len(pts) > 0 {
			cur = []point{pts[0]}
		}
		pieces := 0
		for i := 0; i+1 < len(pts); i++ {
			a, b := pts[i], pts[i+1]
			segLen := math.Hypot(b.x-a.x, b.y-a.y)
			pos := 0.0
			for segLen-pos > left {
				pos += left
				t := pos / segLen
				p := point{a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t}
				if on {
					cur = append(cur, p)
					out = append(out, polyline{pts: cur})
					cur = nil
				} else {
					cur = []point{p}
				}
				on = !on
				idx = (idx + 1) % len(dash)
				left = dash[idx]
				pieces++
				if pieces > 100000 {
					return out
				}
			}
			left -= segLen - pos
			if on {
				cur = append(cur, b)
			}
		}
		if on && len(cur) > 1 {
			out = append(out, polyline{pts: cur})
		}
	}
	return out
}

// strokePolys builds the outline polygons of stroked polylines
func strokePolys(lines []polyline, st strokeStyle) []polyline {
	hw := st.width / 2
	if hw <= 0 {
		return nil
	}
	if len(st.dash) > 0 {
		lines = dashLines(lines, st.dash, st.dashPhase)
	}
	segs := st.circleSegs
	if segs < 8 {
		segs = 8
	}
	var out []polyline
	full := func() bool { return st.maxPolys > 0 && len(out) >= st.maxPolys }
	for _, pl := range lines {
		if full() {
			break
		}
		//Drop repeated points
		pts := make([]point, 0, len(pl.pts))
		for _, p := range pl.pts {
			if len(pts) == 0 || math.Hypot(p.x-pts[len(pts)-1].x, p.y-pts[len(pts)-1].y) > hw*1e-3 {
				pts = append(pts, p)
			}
		}
		closed := pl.closed
		if closed && len(pts) > 2 && math.Hypot(pts[0].x-pts[len(pts)-1].x, pts[0].y-pts[len(pts)-1].y) <= hw*1e-3 {
			pts = pts[:len(pts)-1]
		}
		if len(pts) == 1 {
			//A zero length subpath draws only its caps
			p := pts[0]
			switch st.cap {
			case capRound:
				out = addPoly(out, circlePoly(p, hw, segs))
			case capSquare:
				out = addPoly(out, []point{{p.x - hw, p.y - hw}, {p.x + hw, p.y - hw}, {p.x + hw, p.y + hw}, {p.x - hw, p.y + hw}})
			}
			continue
		}
		if len(pts) < 2 {
			continue
		}
		if closed && len(pts) < 3 {
			closed = false
		}
		n := len(pts)
		nseg := n - 1
		if closed {
			nseg = n
		}
		dirs := make([]point, nseg)
		for i := 0; i < nseg; i++ {
			a, b := pts[i], pts[(i+1)%n]
			l := math.Hypot(b.x-a.x, b.y-a.y)
			dirs[i] = point{(b.x - a.x) / l, (b.y - a.y) / l}
		}
		for i := 0; i < nseg; i++ {
			a, b := pts[i], pts[(i+1)%n]
			nx, ny := -dirs[i].y*hw, dirs[i].x*hw
			out = addPoly(out, []point{{a.x + nx, a.y + ny}, {b.x + nx, b.y + ny}, {b.x - nx, b.y - ny}, {a.x - nx, a.y - ny}})
		}
		//Joins
		for i := 0; i < n; i++ {
			var d0, d1 point
			if closed {
				d0 = dirs[(i-1+nseg)%nseg]
				d1 = dirs[i%nseg]
			} else {
				if i == 0 || i == n-1 {
					continue
				}
				d0, d1 = dirs[i-1], dirs[i]
			}
			v := pts[i]
			cross := d0.x*d1.y - d0.y*d1.x
			dot := d0.x*d1.x + d0.y*d1.y
			if math.Abs(cross) < 1e-9 && dot > 0 {
				continue
			}
			//A shallow bend (a flattened curve) leaves a gap well under a
			//pixel; drawing a join there only costs time
			if dot > 0 && st.devScale > 0 && math.Abs(cross)*hw*st.devScale < 0.2 {
				continue
			}
			if full() {
				break
			}
			switch st.join {
			case joinRound:
				out = addPoly(out, circlePoly(v, hw, segs))
			default:
				//Outer side normals
				side := 1.0
				if cross > 0 {
					side = -1
				}
				n0 := point{-d0.y * hw * side, d0.x * hw * side}
				n1 := point{-d1.y * hw * side, d1.x * hw * side}
				p0 := point{v.x + n0.x, v.y + n0.y}
				p1 := point{v.x + n1.x, v.y + n1.y}
				if st.join == joinMiter {
					//Miter length ratio is 1 / sin(theta / 2)
					//The miter length ratio is 1 / sin(phi / 2), phi being
					//the angle between the segments
					cosT := clamp(dot, -1, 1)
					//The miter tip lies on the bisector of the outer normals
					bx, by := n0.x+n1.x, n0.y+n1.y
					bl := math.Hypot(bx, by)
					cosHalf := math.Sqrt((1 + cosT) / 2)
					if bl > 1e-9 && cosHalf > 1e-6 && 1/cosHalf <= st.miterLimit {
						ml := hw / cosHalf
						tip := point{v.x + bx/bl*ml, v.y + by/bl*ml}
						out = addPoly(out, []point{v, p0, tip, p1})
						continue
					}
				}
				out = addPoly(out, []point{v, p0, p1})
			}
		}
		//Caps
		if !closed {
			ends := []struct {
				p point
				d point
			}{
				{pts[0], point{-dirs[0].x, -dirs[0].y}},
				{pts[n-1], dirs[nseg-1]},
			}
			for _, e := range ends {
				switch st.cap {
				case capRound:
					out = addPoly(out, circlePoly(e.p, hw, segs))
				case capSquare:
					nx, ny := -e.d.y*hw, e.d.x*hw
					ex, ey := e.d.x*hw, e.d.y*hw
					out = addPoly(out, []point{
						{e.p.x + nx, e.p.y + ny},
						{e.p.x + nx + ex, e.p.y + ny + ey},
						{e.p.x - nx + ex, e.p.y - ny + ey},
						{e.p.x - nx, e.p.y - ny},
					})
				}
			}
		}
	}
	return out
}

/*
	Canvas
*/

// canvas is premultiplied RGBA in float32
type canvas struct {
	w, h int
	pix  []float32
}

func newCanvas(w, h int, opaqueWhite bool) *canvas {
	c := &canvas{w: w, h: h, pix: make([]float32, w*h*4)}
	if opaqueWhite {
		for i := range c.pix {
			c.pix[i] = 1
		}
	}
	return c
}

func (c *canvas) bounds() image.Rectangle {
	return image.Rect(0, 0, c.w, c.h)
}

// painter returns the colour (not premultiplied) and alpha at a pixel
type painter interface {
	at(x, y int) (r, g, b, a float32)
}

type solidPaint struct {
	r, g, b float32
}

func (s solidPaint) at(int, int) (float32, float32, float32, float32) {
	return s.r, s.g, s.b, 1
}

const (
	blendNormal = iota
	blendMultiply
	blendScreen
	blendDarken
	blendLighten
	blendOverlay
	blendDifference
)

func blendChannel(mode int, cb, cs float32) float32 {
	switch mode {
	case blendMultiply:
		return cb * cs
	case blendScreen:
		return cb + cs - cb*cs
	case blendDarken:
		if cb < cs {
			return cb
		}
		return cs
	case blendLighten:
		if cb > cs {
			return cb
		}
		return cs
	case blendOverlay:
		if cb <= 0.5 {
			return 2 * cb * cs
		}
		return 1 - 2*(1-cb)*(1-cs)
	case blendDifference:
		if cb > cs {
			return cb - cs
		}
		return cs - cb
	}
	return cs
}

// composite paints src through the coverage, clip and soft mask
func (c *canvas) composite(cov *mask, clip *mask, soft *mask, src painter, alpha float32, blend int) {
	if cov == nil || alpha <= 0 {
		return
	}
	r := cov.r.Intersect(c.bounds()).Intersect(clip.bounds()).Intersect(soft.bounds())
	if r.Empty() {
		return
	}
	solid, isSolid := src.(solidPaint)
	cw := cov.r.Dx()
	for y := r.Min.Y; y < r.Max.Y; y++ {
		rowOff := (y - cov.r.Min.Y) * cw
		for x := r.Min.X; x < r.Max.X; x++ {
			a := alpha
			if cov.a != nil {
				cv := cov.a[rowOff+x-cov.r.Min.X]
				if cv == 0 {
					continue
				}
				a *= float32(cv) / 255
			}
			if clip != nil && clip.a != nil {
				a *= float32(clip.a[(y-clip.r.Min.Y)*clip.r.Dx()+x-clip.r.Min.X]) / 255
			}
			if soft != nil && soft.a != nil {
				a *= float32(soft.a[(y-soft.r.Min.Y)*soft.r.Dx()+x-soft.r.Min.X]) / 255
			}
			if a <= 0 {
				continue
			}
			var sr, sg, sb float32
			if isSolid {
				sr, sg, sb = solid.r, solid.g, solid.b
			} else {
				var sa float32
				sr, sg, sb, sa = src.at(x, y)
				a *= sa
				if a <= 0 {
					continue
				}
			}
			i := (y*c.w + x) * 4
			if blend != blendNormal {
				da := c.pix[i+3]
				if da > 0 {
					br, bg, bb := c.pix[i]/da, c.pix[i+1]/da, c.pix[i+2]/da
					sr = (1-da)*sr + da*blendChannel(blend, br, sr)
					sg = (1-da)*sg + da*blendChannel(blend, bg, sg)
					sb = (1-da)*sb + da*blendChannel(blend, bb, sb)
				}
			}
			ia := 1 - a
			c.pix[i] = sr*a + c.pix[i]*ia
			c.pix[i+1] = sg*a + c.pix[i+1]*ia
			c.pix[i+2] = sb*a + c.pix[i+2]*ia
			c.pix[i+3] = a + c.pix[i+3]*ia
		}
	}
}

// toRGBA flattens the canvas onto white into an 8 bit image
func (c *canvas) toRGBA() *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, c.w, c.h))
	for i := 0; i < c.w*c.h; i++ {
		a := c.pix[i*4+3]
		for k := 0; k < 3; k++ {
			v := c.pix[i*4+k] + (1 - a)
			img.Pix[i*4+k] = uint8(clamp(float64(v), 0, 1)*255 + 0.5)
		}
		img.Pix[i*4+3] = 255
	}
	return img
}
