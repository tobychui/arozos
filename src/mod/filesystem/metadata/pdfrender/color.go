package pdfrender

import (
	"math"
)

/*
	color.go

	Colour spaces, reduced to "n components in, sRGB out". ICC profiles are
	not applied: an ICCBased space is read as the device space with the same
	number of components, which is what a thumbnail needs.
*/

type colorSpace interface {
	nComps() int
	toRGB(c []float64) (r, g, b float64)
	initial() []float64
}

type csGray struct{}
type csRGB struct{}
type csCMYK struct{}

func (csGray) nComps() int        { return 1 }
func (csGray) initial() []float64 { return []float64{0} }
func (csGray) toRGB(c []float64) (float64, float64, float64) {
	v := comp(c, 0)
	return v, v, v
}

func (csRGB) nComps() int        { return 3 }
func (csRGB) initial() []float64 { return []float64{0, 0, 0} }
func (csRGB) toRGB(c []float64) (float64, float64, float64) {
	return comp(c, 0), comp(c, 1), comp(c, 2)
}

func (csCMYK) nComps() int        { return 4 }
func (csCMYK) initial() []float64 { return []float64{0, 0, 0, 1} }
func (csCMYK) toRGB(c []float64) (float64, float64, float64) {
	return cmykToRGB(comp(c, 0), comp(c, 1), comp(c, 2), comp(c, 3))
}

// cmykToRGB is the naive conversion; without the output profile anything
// better is a guess
func cmykToRGB(c, m, y, k float64) (float64, float64, float64) {
	return (1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)
}

func comp(c []float64, i int) float64 {
	if i < len(c) {
		return clamp(c[i], 0, 1)
	}
	return 0
}

type csLab struct {
	wp    [3]float64
	rng   [4]float64
	scale bool
}

func (cs *csLab) nComps() int        { return 3 }
func (cs *csLab) initial() []float64 { return []float64{0, 0, 0} }
func (cs *csLab) toRGB(c []float64) (float64, float64, float64) {
	L := 0.0
	a, b := 0.0, 0.0
	if len(c) > 2 {
		L = clamp(c[0], 0, 100)
		a = clamp(c[1], cs.rng[0], cs.rng[1])
		b = clamp(c[2], cs.rng[2], cs.rng[3])
	}
	fy := (L + 16) / 116
	fx := fy + a/500
	fz := fy - b/200
	g := func(t float64) float64 {
		if t >= 6.0/29 {
			return t * t * t
		}
		return 3 * (6.0 / 29) * (6.0 / 29) * (t - 4.0/29)
	}
	X := cs.wp[0] * g(fx)
	Y := cs.wp[1] * g(fy)
	Z := cs.wp[2] * g(fz)
	//Bradford-free D50 -> sRGB approximation
	r := 3.1338561*X - 1.6168667*Y - 0.4906146*Z
	gg := -0.9787684*X + 1.9161415*Y + 0.0334540*Z
	bb := 0.0719453*X - 0.2289914*Y + 1.4052427*Z
	return gammaSRGB(r), gammaSRGB(gg), gammaSRGB(bb)
}

func gammaSRGB(v float64) float64 {
	v = clamp(v, 0, 1)
	if v <= 0.0031308 {
		return 12.92 * v
	}
	return 1.055*math.Pow(v, 1/2.4) - 0.055
}

type csIndexed struct {
	base    colorSpace
	hival   int
	palette [][3]float64
}

func (cs *csIndexed) nComps() int        { return 1 }
func (cs *csIndexed) initial() []float64 { return []float64{0} }
func (cs *csIndexed) toRGB(c []float64) (float64, float64, float64) {
	i := 0
	if len(c) > 0 {
		i = int(c[0] + 0.5)
	}
	if i < 0 {
		i = 0
	}
	if i >= len(cs.palette) {
		i = len(cs.palette) - 1
	}
	if i < 0 {
		return 0, 0, 0
	}
	p := cs.palette[i]
	return p[0], p[1], p[2]
}

// csTint is Separation and DeviceN: a tint transform into an alternate space
type csTint struct {
	n     int
	alt   colorSpace
	fn    pdfFunction
	none  bool //The /None colorant paints nothing
	all   bool //The /All colorant, drawn as grey
	cache map[float64][3]float64
}

func (cs *csTint) nComps() int { return cs.n }
func (cs *csTint) initial() []float64 {
	out := make([]float64, cs.n)
	for i := range out {
		out[i] = 1
	}
	return out
}
func (cs *csTint) toRGB(c []float64) (float64, float64, float64) {
	if cs.all {
		v := 1 - comp(c, 0)
		return v, v, v
	}
	if cs.fn == nil || cs.alt == nil {
		v := 1 - comp(c, 0)
		return v, v, v
	}
	if cs.n == 1 && len(c) > 0 {
		if v, ok := cs.cache[c[0]]; ok {
			return v[0], v[1], v[2]
		}
	}
	out := cs.fn.eval(c)
	r, g, b := cs.alt.toRGB(out)
	if cs.n == 1 && len(c) > 0 && len(cs.cache) < 4096 {
		cs.cache[c[0]] = [3]float64{r, g, b}
	}
	return r, g, b
}

// csPattern is the Pattern colour space; base is set for uncoloured patterns
type csPattern struct {
	base colorSpace
}

func (cs *csPattern) nComps() int {
	if cs.base != nil {
		return cs.base.nComps()
	}
	return 0
}
func (cs *csPattern) initial() []float64 { return nil }
func (cs *csPattern) toRGB(c []float64) (float64, float64, float64) {
	if cs.base != nil {
		return cs.base.toRGB(c)
	}
	return 0, 0, 0
}

// loadColorSpace resolves a colour space by value. Names are looked up in
// the resources' /ColorSpace dictionary first.
func (d *Document) loadColorSpace(o Object, res Dict, depth int) colorSpace {
	if depth > 8 {
		return nil
	}
	o = d.resolve(o)
	switch v := o.(type) {
	case Name:
		switch v {
		case "DeviceGray", "G", "CalGray":
			return csGray{}
		case "DeviceRGB", "RGB", "CalRGB":
			return csRGB{}
		case "DeviceCMYK", "CMYK":
			return csCMYK{}
		case "Pattern":
			return &csPattern{}
		}
		if res != nil {
			if csDict := d.dict(res["ColorSpace"]); csDict != nil {
				if def, ok := csDict[v]; ok {
					return d.loadColorSpace(def, nil, depth+1)
				}
			}
		}
		return nil
	case Array:
		if len(v) == 0 {
			return nil
		}
		family := d.name(v[0])
		switch family {
		case "DeviceGray", "CalGray", "G":
			return csGray{}
		case "DeviceRGB", "CalRGB", "RGB":
			return csRGB{}
		case "DeviceCMYK", "CMYK":
			return csCMYK{}
		case "Lab":
			cs := &csLab{wp: [3]float64{0.9642, 1, 0.8249}, rng: [4]float64{-100, 100, -100, 100}}
			if len(v) > 1 {
				p := d.dict(v[1])
				if wp := d.numbers(p["WhitePoint"]); len(wp) == 3 {
					cs.wp = [3]float64{wp[0], wp[1], wp[2]}
				}
				if r := d.numbers(p["Range"]); len(r) == 4 {
					cs.rng = [4]float64{r[0], r[1], r[2], r[3]}
				}
			}
			return cs
		case "ICCBased":
			if len(v) < 2 {
				return nil
			}
			p := d.dict(v[1])
			n := d.integer(p["N"], 0)
			switch n {
			case 1:
				return csGray{}
			case 3:
				return csRGB{}
			case 4:
				return csCMYK{}
			}
			if alt := p["Alternate"]; alt != nil {
				return d.loadColorSpace(alt, res, depth+1)
			}
			return nil
		case "Indexed", "I":
			if len(v) < 4 {
				return nil
			}
			base := d.loadColorSpace(v[1], res, depth+1)
			if base == nil {
				return nil
			}
			hival := d.integer(v[2], 0)
			if hival < 0 {
				hival = 0
			}
			if hival > 255 {
				hival = 255
			}
			var lookup []byte
			switch l := d.resolve(v[3]).(type) {
			case String:
				lookup = []byte(l)
			case *Stream:
				lookup, _ = d.decodeStream(l, 1<<20)
			}
			n := base.nComps()
			cs := &csIndexed{base: base, hival: hival}
			comps := make([]float64, n)
			for i := 0; i <= hival; i++ {
				for k := 0; k < n; k++ {
					idx := i*n + k
					if idx < len(lookup) {
						comps[k] = float64(lookup[idx]) / 255
					} else {
						comps[k] = 0
					}
				}
				//Lab bases take their ranges, not 0..1
				if lab, ok := base.(*csLab); ok && n == 3 {
					comps[0] *= 100
					comps[1] = lab.rng[0] + comps[1]*(lab.rng[1]-lab.rng[0])
					comps[2] = lab.rng[2] + comps[2]*(lab.rng[3]-lab.rng[2])
				}
				r, g, b := base.toRGB(comps)
				cs.palette = append(cs.palette, [3]float64{r, g, b})
			}
			return cs
		case "Separation":
			if len(v) < 4 {
				return nil
			}
			cs := &csTint{n: 1, cache: map[float64][3]float64{}}
			switch d.name(v[1]) {
			case "None":
				cs.none = true
			case "All":
				cs.all = true
			}
			cs.alt = d.loadColorSpace(v[2], res, depth+1)
			cs.fn = d.loadFunction(v[3], 0)
			return cs
		case "DeviceN":
			if len(v) < 4 {
				return nil
			}
			names := d.array(v[1])
			if len(names) == 0 || len(names) > 32 {
				return nil
			}
			cs := &csTint{n: len(names), cache: map[float64][3]float64{}}
			allNone := true
			for _, nm := range names {
				if d.name(nm) != "None" {
					allNone = false
				}
			}
			cs.none = allNone
			cs.alt = d.loadColorSpace(v[2], res, depth+1)
			cs.fn = d.loadFunction(v[3], 0)
			return cs
		case "Pattern":
			cs := &csPattern{}
			if len(v) > 1 {
				cs.base = d.loadColorSpace(v[1], res, depth+1)
			}
			return cs
		}
	}
	return nil
}
