package pdfrender

import (
	"bytes"
	"fmt"
	"math"
)

/*
	xobject.go

	Image and form XObjects, inline images, annotation appearance streams
	and soft masks (luminosity and alpha groups).
*/

func (r *renderer) doXObject(n Name) {
	xobjs := r.d.dict(r.res["XObject"])
	if xobjs == nil {
		return
	}
	s := r.d.stream(xobjs[n])
	if s == nil {
		return
	}
	if oc := s.Dict["OC"]; oc != nil && r.ocHidden(oc) {
		return
	}
	switch r.d.name(s.Dict["Subtype"]) {
	case "Image":
		if !r.isHidden() {
			r.drawImageStream(s)
		}
	case "Form":
		r.runForm(s, identity, true, true)
	}
}

// runForm draws a form XObject. extra is applied after the form's /Matrix
// (when ownMatrix is set; pattern cells have their matrix applied already).
func (r *renderer) runForm(s *Stream, extra matrix, clipBBox bool, ownMatrix bool) {
	if r.depth >= maxFormDepth || r.formsBusy[s] {
		return
	}
	data, err := r.d.decodeStream(s, 128<<20)
	if err != nil && len(data) == 0 {
		return
	}
	res := r.d.dict(s.Dict["Resources"])
	if res == nil {
		res = r.res
	}
	r.formsBusy[s] = true
	defer delete(r.formsBusy, s)

	saved := r.gs
	savedStack := r.stack
	savedPath := r.path
	savedBase := r.base
	savedMC := r.mcHidden
	savedHidden := r.hidden
	r.gs = saved.clone()
	r.stack = nil
	r.path = path{}
	fm := identity
	if m := r.d.numbers(s.Dict["Matrix"]); len(m) == 6 && ownMatrix {
		fm = matrix{m[0], m[1], m[2], m[3], m[4], m[5]}
	}
	r.gs.ctm = fm.mul(extra).mul(saved.ctm)
	r.base = r.gs.ctm
	if clipBBox {
		if bb := r.d.numbers(s.Dict["BBox"]); len(bb) == 4 {
			p := path{}
			p.moveTo(bb[0], bb[1])
			p.lineTo(bb[2], bb[1])
			p.lineTo(bb[2], bb[3])
			p.lineTo(bb[0], bb[3])
			p.close()
			cov := r.raster(p.flatten(r.gs.ctm, 0.3), false, r.cv.bounds())
			if cov == nil {
				cov = &mask{}
			}
			r.gs.clip = intersectMasks(r.gs.clip, cov)
		}
	}
	r.depth++
	r.run(data, res)
	r.depth--
	r.gs = saved
	r.stack = savedStack
	r.path = savedPath
	r.base = savedBase
	r.mcHidden = savedMC
	r.hidden = savedHidden
}

// imageFootprint is the size an image is drawn at, in device pixels
func imageFootprint(m matrix) (int, int) {
	w := math.Hypot(m[0], m[1])
	h := math.Hypot(m[2], m[3])
	clampI := func(v float64) int {
		if v < 1 {
			return 1
		}
		if v > 1<<14 {
			return 1 << 14
		}
		return int(math.Ceil(v))
	}
	return clampI(w), clampI(h)
}

func (r *renderer) drawImageStream(s *Stream) {
	fw, fh := imageFootprint(r.gs.ctm)
	key := fmt.Sprintf("%p/%d/%d", s, fw, fh)
	img, ok := r.shared.images[key]
	if !ok {
		var err error
		img, err = r.d.loadImage(s, r.res, fw, fh)
		if err != nil {
			img = nil
		}
		if len(r.shared.images) < 256 {
			r.shared.images[key] = img
		}
	}
	if img != nil {
		r.drawImage(img)
	}
}

type imagePainter struct {
	img  *pdfImage
	inv  matrix
	tint painter //Colour for stencil masks
}

func (p *imagePainter) sample(x, y int) (float32, float32, float32, float32) {
	ux, uy := p.inv.apply(float64(x)+0.5, float64(y)+0.5)
	img := p.img
	fx := ux*float64(img.w) - 0.5
	fy := (1-uy)*float64(img.h) - 0.5
	x0 := int(math.Floor(fx))
	y0 := int(math.Floor(fy))
	tx := float32(fx - float64(x0))
	ty := float32(fy - float64(y0))
	clampX := func(v int) int {
		if v < 0 {
			return 0
		}
		if v >= img.w {
			return img.w - 1
		}
		return v
	}
	clampY := func(v int) int {
		if v < 0 {
			return 0
		}
		if v >= img.h {
			return img.h - 1
		}
		return v
	}
	xa, xb := clampX(x0), clampX(x0+1)
	ya, yb := clampY(y0), clampY(y0+1)
	var out [4]float32
	pix := img.pix
	i00 := (ya*img.w + xa) * 4
	i01 := (ya*img.w + xb) * 4
	i10 := (yb*img.w + xa) * 4
	i11 := (yb*img.w + xb) * 4
	//Premultiply while interpolating so transparent pixels do not bleed
	for k := 0; k < 4; k++ {
		get := func(i int) float32 {
			v := float32(pix[i+k]) / 255
			if k < 3 {
				v *= float32(pix[i+3]) / 255
			}
			return v
		}
		top := get(i00)*(1-tx) + get(i01)*tx
		bot := get(i10)*(1-tx) + get(i11)*tx
		out[k] = top*(1-ty) + bot*ty
	}
	return out[0], out[1], out[2], out[3]
}

func (p *imagePainter) at(x, y int) (float32, float32, float32, float32) {
	r, g, b, a := p.sample(x, y)
	if p.img.stencil {
		if p.tint == nil {
			return 0, 0, 0, a
		}
		tr, tg, tb, ta := p.tint.at(x, y)
		return tr, tg, tb, ta * a
	}
	if a <= 0 {
		return 0, 0, 0, 0
	}
	return r / a, g / a, b / a, a
}

func (r *renderer) drawImage(img *pdfImage) {
	gs := r.gs
	inv, ok := gs.ctm.invert()
	if !ok {
		return
	}
	p := path{}
	p.moveTo(0, 0)
	p.lineTo(1, 0)
	p.lineTo(1, 1)
	p.lineTo(0, 1)
	p.close()
	cov := r.raster(p.flatten(gs.ctm, 0.3), false, r.paintBounds())
	if cov == nil {
		return
	}
	if img.placeholder {
		r.cv.composite(cov, gs.clip, gs.soft, solidPaint{0.88, 0.88, 0.88}, float32(gs.fa), blendNormal)
		return
	}
	ip := &imagePainter{img: img, inv: inv}
	if img.stencil {
		if gs.fillNone {
			return
		}
		ip.tint = gs.fillRGB
		if r.forceColor != nil {
			ip.tint = *r.forceColor
		} else if pcs, ok := gs.fillCS.(*csPattern); ok && gs.fillPat != nil {
			var tint *solidPaint
			if pcs.base != nil {
				rr, gg, bb := pcs.base.toRGB(gs.fill)
				tint = &solidPaint{float32(rr), float32(gg), float32(bb)}
			}
			if pp := r.patternPainter(gs.fillPat, tint); pp != nil {
				ip.tint = pp
			}
		}
	}
	r.cv.composite(cov, gs.clip, gs.soft, ip, float32(gs.fa), gs.blend)
}

// inlineImage reads BI ... ID <data> EI
func (r *renderer) inlineImage(p *parser) {
	dict := Dict{}
	for {
		t := p.nextToken()
		if t.kind == tokEOF {
			return
		}
		if t.kind == tokKeyword && t.s == "ID" {
			break
		}
		if t.kind != tokName {
			continue
		}
		v, err := p.parseObject(0)
		if err != nil {
			return
		}
		dict[Name(t.s)] = v
	}
	if len(p.peek) > 0 {
		return
	}
	buf := p.lex.buf
	pos := p.lex.pos
	if pos < len(buf) && isWhite(buf[pos]) {
		pos++
	}
	end := -1
	if r.d.filterList(dict) == nil {
		//Unfiltered: the length is known
		ip, err := r.d.imageParams(dict, r.res)
		if err == nil {
			ncomp := 1
			if !ip.mask && ip.cs != nil {
				ncomp = ip.cs.nComps()
			}
			bpc := ip.bpc
			if bpc == 0 {
				bpc = 8
			}
			n := int64((ip.w*ncomp*bpc+7)/8) * int64(ip.h)
			if n >= 0 && n <= int64(len(buf)-pos) {
				end = pos + int(n)
			}
		}
	}
	if end < 0 {
		//Search for EI between white space
		for i := pos; i+1 < len(buf); i++ {
			if buf[i] == 'E' && buf[i+1] == 'I' && (i == 0 || isWhite(buf[i-1])) && (i+2 >= len(buf) || isWhite(buf[i+2]) || isDelim(buf[i+2])) {
				end = i
				if end > pos {
					end--
				}
				break
			}
		}
		if end < 0 {
			end = len(buf)
		}
	}
	data := buf[pos:end]
	//Skip past EI
	k := bytes.Index(buf[end:], []byte("EI"))
	if k >= 0 {
		p.lex.pos = end + k + 2
	} else {
		p.lex.pos = len(buf)
	}
	if r.isHidden() {
		return
	}
	s := &Stream{Dict: dict, offset: -1, data: data}
	fw, fh := imageFootprint(r.gs.ctm)
	img, err := r.d.loadImage(s, r.res, fw, fh)
	if err == nil && img != nil {
		r.drawImage(img)
	}
}

/*
	Annotations
*/

func (r *renderer) drawAnnotations(pg *Page) {
	for _, a := range r.d.array(pg.Dict["Annots"]) {
		if r.stopped {
			return
		}
		ad := r.d.dict(a)
		if ad == nil {
			continue
		}
		flags := r.d.integer(ad["F"], 0)
		if flags&2 != 0 || flags&32 != 0 {
			continue
		}
		if r.d.name(ad["Subtype"]) == "Popup" {
			continue
		}
		if oc := ad["OC"]; oc != nil && r.ocHidden(oc) {
			continue
		}
		ap := r.d.dict(ad["AP"])
		if ap == nil {
			continue
		}
		var s *Stream
		switch n := r.d.resolve(ap["N"]).(type) {
		case *Stream:
			s = n
		case Dict:
			s = r.d.stream(n[r.d.name(ad["AS"])])
		}
		if s == nil {
			continue
		}
		rect := r.d.rect(ad["Rect"], [4]float64{})
		if rect[2]-rect[0] <= 0 || rect[3]-rect[1] <= 0 {
			continue
		}
		bb := r.d.numbers(s.Dict["BBox"])
		if len(bb) != 4 {
			continue
		}
		fm := identity
		if m := r.d.numbers(s.Dict["Matrix"]); len(m) == 6 {
			fm = matrix{m[0], m[1], m[2], m[3], m[4], m[5]}
		}
		//The transformed bounding box is fitted onto the annotation rectangle
		minX, minY := math.Inf(1), math.Inf(1)
		maxX, maxY := math.Inf(-1), math.Inf(-1)
		for _, c := range [][2]float64{{bb[0], bb[1]}, {bb[2], bb[1]}, {bb[2], bb[3]}, {bb[0], bb[3]}} {
			x, y := fm.apply(c[0], c[1])
			minX, maxX = math.Min(minX, x), math.Max(maxX, x)
			minY, maxY = math.Min(minY, y), math.Max(maxY, y)
		}
		if maxX-minX <= 0 || maxY-minY <= 0 {
			continue
		}
		sx := (rect[2] - rect[0]) / (maxX - minX)
		sy := (rect[3] - rect[1]) / (maxY - minY)
		fit := matrix{sx, 0, 0, sy, rect[0] - minX*sx, rect[1] - minY*sy}
		//runForm applies the form matrix itself, so pass the fit after it:
		//final = fm x fit x ctm, and runForm computes fm x extra x ctm
		r.runForm(s, fit, true, true)
	}
}

/*
	Soft masks
*/

func (r *renderer) softMask(sm Dict) *mask {
	d := r.d
	g := d.stream(sm["G"])
	if g == nil || r.depth >= maxFormDepth {
		return nil
	}
	luminosity := d.name(sm["S"]) != "Alpha"
	cv := newCanvas(r.cv.w, r.cv.h, false)
	if luminosity {
		//Backdrop colour, black by default
		bc := d.numbers(sm["BC"])
		var cs colorSpace = csGray{}
		if grp := d.dict(g.Dict["Group"]); grp != nil {
			if c := d.loadColorSpace(grp["CS"], r.res, 0); c != nil {
				cs = c
			}
		}
		br, bg, bb := 0.0, 0.0, 0.0
		if len(bc) > 0 && len(bc) == cs.nComps() {
			br, bg, bb = cs.toRGB(bc)
		}
		for i := 0; i < cv.w*cv.h; i++ {
			cv.pix[i*4], cv.pix[i*4+1], cv.pix[i*4+2], cv.pix[i*4+3] = float32(br), float32(bg), float32(bb), 1
		}
	}
	sub := newRenderer(d, cv, r.gs.ctm, r.shared, r.deadline)
	sub.depth = r.depth + 1
	sub.ops = r.ops
	sub.gs.ctm = r.gs.ctm
	sub.runForm(g, identity, true, true)
	r.ops = sub.ops
	if sub.stopped {
		r.stopped = true
	}
	out := &mask{r: cv.bounds(), a: make([]uint8, cv.w*cv.h)}
	for i := 0; i < cv.w*cv.h; i++ {
		var v float32
		if luminosity {
			v = 0.3*cv.pix[i*4] + 0.59*cv.pix[i*4+1] + 0.11*cv.pix[i*4+2]
		} else {
			v = cv.pix[i*4+3]
		}
		out.a[i] = uint8(clamp(float64(v), 0, 1)*255 + 0.5)
	}
	return out
}
