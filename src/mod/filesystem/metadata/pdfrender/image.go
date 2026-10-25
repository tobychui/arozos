package pdfrender

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"math"
)

/*
	image.go

	Image XObjects and inline images into 8 bit RGBA (straight alpha):
	raw samples at 1-16 bits in any colour space, DCT (JPEG), CCITT, the
	Decode array, colour key and stencil masks and soft masks. Large
	images are box filtered while they are decoded down to about twice the
	size they are drawn at, so a full page scan costs little memory.
	JPEG 2000 and JBIG2 have no decoder here; they are drawn as a light
	grey placeholder so the layout still reads.
*/

const maxImagePixels = 50 << 20

type pdfImage struct {
	w, h        int
	pix         []uint8 //RGBA, straight alpha
	stencil     bool    //Only the alpha channel is meaningful
	placeholder bool
}

var errImage = errors.New("pdfrender: bad image")

type imageParams struct {
	w, h     int
	bpc      int
	mask     bool
	cs       colorSpace
	decode   []float64
	colorKey []int
}

func (d *Document) imageParams(dict Dict, res Dict) (imageParams, error) {
	get := func(long, short Name) Object {
		if v, ok := dict[long]; ok {
			return v
		}
		return dict[short]
	}
	p := imageParams{
		w:   d.integer(get("Width", "W"), 0),
		h:   d.integer(get("Height", "H"), 0),
		bpc: d.integer(get("BitsPerComponent", "BPC"), 0),
	}
	if b, ok := d.resolve(get("ImageMask", "IM")).(bool); ok && b {
		p.mask = true
		p.bpc = 1
	}
	if p.w <= 0 || p.h <= 0 || int64(p.w)*int64(p.h) > maxImagePixels {
		return p, errImage
	}
	if !p.mask {
		p.cs = d.loadColorSpace(get("ColorSpace", "CS"), res, 0)
	}
	p.decode = d.numbers(get("Decode", "D"))
	if m := d.array(dict["Mask"]); len(m) > 0 {
		for _, v := range m {
			p.colorKey = append(p.colorKey, d.integer(v, 0))
		}
	}
	return p, nil
}

// loadImage decodes an image, reduced towards maxW x maxH device pixels
func (d *Document) loadImage(s *Stream, res Dict, maxW, maxH int) (*pdfImage, error) {
	p, err := d.imageParams(s.Dict, res)
	if err != nil {
		return nil, err
	}
	limit := int64(p.w)*int64(p.h)*4*2 + 1<<16
	if limit > 512<<20 {
		limit = 512 << 20
	}
	data, codec, _, err := d.decodeStreamImage(s, int(limit), true)
	if err != nil && len(data) == 0 {
		return nil, err
	}
	fx, fy := reduceFactor(p.w, maxW), reduceFactor(p.h, maxH)
	var img *pdfImage
	switch codec {
	case "DCTDecode":
		img, err = d.decodeJPEG(data, p, fx, fy)
	case "JPXDecode", "JBIG2Decode":
		if p.mask {
			return nil, errImage
		}
		img = &pdfImage{w: 1, h: 1, pix: []uint8{224, 224, 224, 255}, placeholder: true}
	default:
		if !p.mask && p.cs == nil {
			//A missing colour space: guess from the data size
			switch n := int64(len(data)) / (int64(p.w) * int64(p.h)); {
			case n >= 4:
				p.cs = csCMYK{}
			case n >= 3:
				p.cs = csRGB{}
			default:
				p.cs = csGray{}
			}
			if p.bpc == 0 {
				p.bpc = 8
			}
		}
		img, err = decodeSamples(data, p, fx, fy)
	}
	if err != nil {
		return nil, err
	}
	if p.mask {
		img.stencil = true
		return img, nil
	}
	//Soft mask or stencil mask give the alpha channel
	if sm := d.stream(s.Dict["SMask"]); sm != nil {
		d.applyAlphaImage(img, sm, true)
	} else if mk := d.stream(s.Dict["Mask"]); mk != nil {
		d.applyAlphaImage(img, mk, false)
	}
	return img, nil
}

func reduceFactor(size, target int) int {
	if target <= 0 {
		return 1
	}
	f := size / (target * 2)
	if f < 1 {
		return 1
	}
	return f
}

// applyAlphaImage multiplies alpha by a soft mask (grey levels) or a
// stencil mask (1 = masked out)
func (d *Document) applyAlphaImage(img *pdfImage, s *Stream, soft bool) {
	p, err := d.imageParams(s.Dict, nil)
	if err != nil {
		return
	}
	if soft {
		p.cs = csGray{}
		p.mask = false
		if p.bpc == 0 {
			p.bpc = 8
		}
	} else {
		p.mask = true
		p.bpc = 1
	}
	data, codec, _, err := d.decodeStreamImage(s, p.w*p.h*2+1<<16, true)
	if err != nil && len(data) == 0 {
		return
	}
	fx, fy := reduceFactor(p.w, img.w), reduceFactor(p.h, img.h)
	var m *pdfImage
	if codec == "DCTDecode" {
		m, err = d.decodeJPEG(data, p, fx, fy)
	} else if codec == "" {
		m, err = decodeSamples(data, p, fx, fy)
	} else {
		return
	}
	if err != nil || m == nil {
		return
	}
	for y := 0; y < img.h; y++ {
		my := y * m.h / img.h
		for x := 0; x < img.w; x++ {
			mx := x * m.w / img.w
			var a uint8
			if soft {
				a = m.pix[(my*m.w+mx)*4]
			} else {
				a = m.pix[(my*m.w+mx)*4+3]
			}
			i := (y*img.w+x)*4 + 3
			img.pix[i] = uint8(int(img.pix[i]) * int(a) / 255)
		}
	}
}

// reducer box filters rows of RGBA into an image fx x fy times smaller
type reducer struct {
	w, h, fx, fy int
	ow, oh       int
	sum          []uint32
	rows         int
	oy           int
	out          *pdfImage
}

func newReducer(w, h, fx, fy int) *reducer {
	r := &reducer{w: w, h: h, fx: fx, fy: fy}
	r.ow = (w + fx - 1) / fx
	r.oh = (h + fy - 1) / fy
	r.sum = make([]uint32, r.ow*4)
	r.out = &pdfImage{w: r.ow, h: r.oh, pix: make([]uint8, r.ow*r.oh*4)}
	return r
}

func (r *reducer) addRow(row []uint8) {
	if r.fx == 1 && r.fy == 1 {
		copy(r.out.pix[r.oy*r.ow*4:], row)
		r.oy++
		return
	}
	for x := 0; x < r.w; x++ {
		o := (x / r.fx) * 4
		i := x * 4
		r.sum[o] += uint32(row[i])
		r.sum[o+1] += uint32(row[i+1])
		r.sum[o+2] += uint32(row[i+2])
		r.sum[o+3] += uint32(row[i+3])
	}
	r.rows++
	if r.rows == r.fy {
		r.flush()
	}
}

func (r *reducer) flush() {
	if r.rows == 0 || r.oy >= r.oh {
		return
	}
	dst := r.out.pix[r.oy*r.ow*4:]
	for ox := 0; ox < r.ow; ox++ {
		cols := r.fx
		if (ox+1)*r.fx > r.w {
			cols = r.w - ox*r.fx
		}
		n := uint32(cols * r.rows)
		for k := 0; k < 4; k++ {
			dst[ox*4+k] = uint8(r.sum[ox*4+k] / n)
			r.sum[ox*4+k] = 0
		}
	}
	r.rows = 0
	r.oy++
}

func (r *reducer) finish() *pdfImage {
	if r.fx != 1 || r.fy != 1 {
		r.flush()
	}
	return r.out
}

// decodeSamples converts raw image samples
func decodeSamples(data []byte, p imageParams, fx, fy int) (*pdfImage, error) {
	ncomp := 1
	if !p.mask {
		ncomp = p.cs.nComps()
	}
	bpc := p.bpc
	switch bpc {
	case 1, 2, 4, 8, 16:
	default:
		return nil, errImage
	}
	if ncomp < 1 || ncomp > 32 {
		return nil, errImage
	}
	maxV := float64(int(1)<<uint(bpc) - 1)
	//Decode ranges
	dec := make([]float64, 2*ncomp)
	_, indexed := p.cs.(*csIndexed)
	for i := 0; i < ncomp; i++ {
		dec[2*i], dec[2*i+1] = 0, 1
		if indexed {
			dec[2*i+1] = maxV
		}
		if lab, ok := p.cs.(*csLab); ok {
			switch i {
			case 0:
				dec[1] = 100
			case 1:
				dec[2], dec[3] = lab.rng[0], lab.rng[1]
			case 2:
				dec[4], dec[5] = lab.rng[2], lab.rng[3]
			}
		}
		if 2*i+1 < len(p.decode) {
			dec[2*i], dec[2*i+1] = p.decode[2*i], p.decode[2*i+1]
		}
	}
	rowBytes := (p.w*ncomp*bpc + 7) / 8
	r := newReducer(p.w, p.h, fx, fy)
	row := make([]uint8, p.w*4)
	comps := make([]float64, ncomp)
	raw := make([]int, ncomp)

	//Lookup table for single component images
	var lut [][4]uint8
	if ncomp == 1 && bpc <= 8 {
		lut = make([][4]uint8, 1<<uint(bpc))
		for v := range lut {
			c := dec[0] + float64(v)*(dec[1]-dec[0])/maxV
			if p.mask {
				//Sample 0 paints, unless the decode array inverts it
				if c < 0.5 {
					lut[v] = [4]uint8{0, 0, 0, 255}
				} else {
					lut[v] = [4]uint8{0, 0, 0, 0}
				}
				continue
			}
			rr, gg, bb := p.cs.toRGB([]float64{c})
			lut[v] = [4]uint8{to8(rr), to8(gg), to8(bb), 255}
		}
	}
	defaultDecode := true
	for i := 0; i < ncomp; i++ {
		if dec[2*i] != 0 || dec[2*i+1] != 1 {
			defaultDecode = false
		}
	}
	_, isRGB := p.cs.(csRGB)
	_, isGray := p.cs.(csGray)
	_, isCMYK := p.cs.(csCMYK)
	for y := 0; y < p.h; y++ {
		off := y * rowBytes
		var line []byte
		if off < len(data) {
			end := off + rowBytes
			if end > len(data) {
				end = len(data)
			}
			line = data[off:end]
		}
		switch {
		case len(line) < rowBytes:
			//Missing data reads as zero samples
			full := make([]byte, rowBytes)
			copy(full, line)
			line = full
		}
		switch {
		case lut != nil && bpc == 8:
			for x := 0; x < p.w; x++ {
				c := lut[line[x]]
				copy(row[x*4:], c[:])
			}
		case lut != nil:
			br := bitReader{data: line}
			for x := 0; x < p.w; x++ {
				v, _ := br.read(bpc)
				c := lut[v]
				copy(row[x*4:], c[:])
			}
		case bpc == 8 && defaultDecode && isRGB:
			for x := 0; x < p.w; x++ {
				row[x*4], row[x*4+1], row[x*4+2], row[x*4+3] = line[x*3], line[x*3+1], line[x*3+2], 255
			}
		case bpc == 8 && defaultDecode && isCMYK:
			for x := 0; x < p.w; x++ {
				k := 255 - int(line[x*4+3])
				row[x*4] = uint8((255 - int(line[x*4])) * k / 255)
				row[x*4+1] = uint8((255 - int(line[x*4+1])) * k / 255)
				row[x*4+2] = uint8((255 - int(line[x*4+2])) * k / 255)
				row[x*4+3] = 255
			}
		default:
			br := bitReader{data: line}
			for x := 0; x < p.w; x++ {
				for k := 0; k < ncomp; k++ {
					v, _ := br.read(bpc)
					raw[k] = int(v)
					comps[k] = dec[2*k] + float64(v)*(dec[2*k+1]-dec[2*k])/maxV
				}
				var rr, gg, bb float64
				if isGray {
					rr = comp(comps, 0)
					gg, bb = rr, rr
				} else {
					rr, gg, bb = p.cs.toRGB(comps)
				}
				row[x*4], row[x*4+1], row[x*4+2], row[x*4+3] = to8(rr), to8(gg), to8(bb), 255
				if len(p.colorKey) >= 2*ncomp {
					masked := true
					for k := 0; k < ncomp; k++ {
						if raw[k] < p.colorKey[2*k] || raw[k] > p.colorKey[2*k+1] {
							masked = false
							break
						}
					}
					if masked {
						row[x*4+3] = 0
					}
				}
			}
		}
		if len(p.colorKey) >= 2*ncomp && (lut != nil || (bpc == 8 && defaultDecode && (isRGB || isCMYK))) {
			//The fast paths skipped the colour key test
			br := bitReader{data: line}
			for x := 0; x < p.w; x++ {
				masked := true
				for k := 0; k < ncomp; k++ {
					v, _ := br.read(bpc)
					if int(v) < p.colorKey[2*k] || int(v) > p.colorKey[2*k+1] {
						masked = false
					}
				}
				if masked {
					row[x*4+3] = 0
				}
			}
		}
		r.addRow(row)
	}
	return r.finish(), nil
}

func to8(v float64) uint8 {
	if v <= 0 || math.IsNaN(v) {
		return 0
	}
	if v >= 1 {
		return 255
	}
	return uint8(v*255 + 0.5)
}

func (d *Document) decodeJPEG(data []byte, p imageParams, fx, fy int) (*pdfImage, error) {
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return nil, errImage
	}
	src, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w != p.w && p.w > 0 {
		fx = reduceFactor(w, p.w/fx)
	}
	if h != p.h && p.h > 0 {
		fy = reduceFactor(h, p.h/fy)
	}
	invert := len(p.decode) >= 2 && p.decode[0] > p.decode[1]
	/*
		Four channel JPEGs: Go assumes Adobe's inverted storage and inverts
		every channel of plain CMYK (APP14 transform 0), and only K of YCCK.
		A PDF instead takes the raw samples and leaves inversion to its
		Decode array (as pdf.js does), so undo Go's flip and apply Decode.
	*/
	invC, invK := invert, invert
	if adobeTransform(data) == 0 {
		invC, invK = !invC, !invK
	} else {
		invK = !invK
	}
	r := newReducer(w, h, fx, fy)
	row := make([]uint8, w*4)
	_, tint := p.cs.(*csTint)
	_, indexed := p.cs.(*csIndexed)
	for y := 0; y < h; y++ {
		switch img := src.(type) {
		case *image.Gray:
			line := img.Pix[y*img.Stride:]
			for x := 0; x < w; x++ {
				v := line[x]
				if invert {
					v = 255 - v
				}
				if tint || indexed {
					rr, gg, bb := p.cs.toRGB([]float64{float64(v) / 255})
					if indexed {
						rr, gg, bb = p.cs.toRGB([]float64{float64(v)})
					}
					row[x*4], row[x*4+1], row[x*4+2] = to8(rr), to8(gg), to8(bb)
				} else {
					row[x*4], row[x*4+1], row[x*4+2] = v, v, v
				}
				row[x*4+3] = 255
			}
		case *image.CMYK:
			line := img.Pix[y*img.Stride:]
			for x := 0; x < w; x++ {
				c, m, yy, k := line[x*4], line[x*4+1], line[x*4+2], line[x*4+3]
				if invC {
					c, m, yy = 255-c, 255-m, 255-yy
				}
				if invK {
					k = 255 - k
				}
				kk := 255 - int(k)
				row[x*4] = uint8((255 - int(c)) * kk / 255)
				row[x*4+1] = uint8((255 - int(m)) * kk / 255)
				row[x*4+2] = uint8((255 - int(yy)) * kk / 255)
				row[x*4+3] = 255
			}
		default:
			for x := 0; x < w; x++ {
				cr, cg, cb, _ := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
				rr, gg, bb := uint8(cr>>8), uint8(cg>>8), uint8(cb>>8)
				if invert {
					rr, gg, bb = 255-rr, 255-gg, 255-bb
				}
				row[x*4], row[x*4+1], row[x*4+2], row[x*4+3] = rr, gg, bb, 255
			}
		}
		r.addRow(row)
	}
	return r.finish(), nil
}

// adobeTransform reads the colour transform of a JPEG's Adobe APP14
// segment, or -1 when it has none
func adobeTransform(data []byte) int {
	head := data
	if len(head) > 1<<16 {
		head = head[:1<<16]
	}
	i := bytes.Index(head, []byte("\xFF\xEE"))
	for i >= 0 {
		if i+16 <= len(head) && string(head[i+4:i+9]) == "Adobe" {
			return int(head[i+15])
		}
		j := bytes.Index(head[i+2:], []byte("\xFF\xEE"))
		if j < 0 {
			break
		}
		i += 2 + j
	}
	return -1
}
