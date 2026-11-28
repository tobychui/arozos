package dngrender

import "math"

/*
	Colour and tone

	The camera colour matrix (XYZ to camera) is turned into a camera to linear
	sRGB matrix whose rows sum to one, so a white balanced grey stays grey (the
	method of dcraw). Brightness is then raised until the brightest 1% of the
	picture reaches white, and a gentle contrast curve is applied: a straight
	linear to sRGB conversion of raw data looks flat and dark.
*/

// matrix is a 3x3 matrix
type matrix [3][3]float64

// colourSettings is what turns camera values into sRGB
type colourSettings struct {
	multipliers [3]float64 // white balance gain of each camera colour
	toSRGB      matrix     // white balanced camera values to linear sRGB
	exposure    float64    // BaselineExposure as a gain
}

// Linear sRGB to XYZ (D65)
var sRGBToXYZ = matrix{
	{0.4124564, 0.3575761, 0.1804375},
	{0.2126729, 0.7151522, 0.0721750},
	{0.0193339, 0.1191920, 0.9503041},
}

var identity = matrix{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}

const illuminantD65 = 21

func (a matrix) multiply(b matrix) matrix {
	var out matrix
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			out[i][j] = a[i][0]*b[0][j] + a[i][1]*b[1][j] + a[i][2]*b[2][j]
		}
	}
	return out
}

func (a matrix) inverse() (matrix, bool) {
	var out matrix
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			r1, r2 := (j+1)%3, (j+2)%3
			c1, c2 := (i+1)%3, (i+2)%3
			out[i][j] = a[r1][c1]*a[r2][c2] - a[r1][c2]*a[r2][c1]
		}
	}
	det := a[0][0]*out[0][0] + a[0][1]*out[1][0] + a[0][2]*out[2][0]
	if math.Abs(det) < 1e-9 {
		return identity, false
	}
	for i := range out {
		for j := range out[i] {
			out[i][j] /= det
		}
	}
	return out, true
}

// boundedValues reports whether every value is within -limit..limit
func boundedValues(values []float64, limit float64) bool {
	for _, v := range values {
		if !(math.Abs(v) <= limit) {
			return false
		}
	}
	return true
}

func (a matrix) bounded(limit float64) bool {
	return boundedValues(a[0][:], limit) && boundedValues(a[1][:], limit) && boundedValues(a[2][:], limit)
}

// tableIndex clamps a value to 0..last, taking anything not positive (also
// NaN) as 0
func tableIndex(v float32, last int) int {
	if !(v > 0) {
		return 0
	}
	if v >= float32(last) {
		return last
	}
	return int(v)
}

// readColourSettings reads the white balance and colour matrix of IFD0
func readColourSettings(t *tiffFile, dir directory) colourSettings {
	settings := colourSettings{multipliers: [3]float64{1, 1, 1}, toSRGB: identity, exposure: 1}

	//The daylight calibration is the one closest to most photos
	tag := uint16(tagColorMatrix1)
	if _, ok := dir[tagColorMatrix2]; ok && t.uintValue(dir, tagCalibrationIllum1, 0) != illuminantD65 &&
		t.uintValue(dir, tagCalibrationIllum2, 0) == illuminantD65 {
		tag = tagColorMatrix2
	}

	var neutral []float64
	if n := t.numbers(dir[tagAsShotNeutral], 3); len(n) == 3 && n[0] > 0 && n[1] > 0 && n[2] > 0 {
		neutral = n
	}

	if values := t.numbers(dir[tag], 9); len(values) == 9 && boundedValues(values, 100) {
		var xyzToCamera matrix
		for i, v := range values {
			xyzToCamera[i/3][i%3] = v
		}
		if xy := t.numbers(dir[tagAsShotWhiteXY], 2); neutral == nil && len(xy) == 2 && xy[1] > 0 {
			white := [3]float64{xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]}
			n := make([]float64, 3)
			for i := range n {
				n[i] = xyzToCamera[i][0]*white[0] + xyzToCamera[i][1]*white[1] + xyzToCamera[i][2]*white[2]
			}
			if n[0] > 0 && n[1] > 0 && n[2] > 0 {
				neutral = n
			}
		}

		sRGBToCamera := xyzToCamera.multiply(sRGBToXYZ)
		var daylight [3]float64
		usable := true
		for i := range sRGBToCamera {
			sum := sRGBToCamera[i][0] + sRGBToCamera[i][1] + sRGBToCamera[i][2]
			if sum < 1e-6 {
				usable = false
				break
			}
			daylight[i] = sum
			for j := range sRGBToCamera[i] {
				sRGBToCamera[i][j] /= sum
			}
		}
		if usable {
			//A nearly singular matrix inverts into nonsense, keep identity
			if inverse, ok := sRGBToCamera.inverse(); ok && inverse.bounded(100) {
				settings.toSRGB = inverse
				if neutral == nil {
					//No white balance recorded: assume daylight
					neutral = daylight[:]
				}
			}
		}
	}

	if neutral != nil {
		//The smallest gain is 1 so that a clipped sensor stays white
		largest := math.Max(neutral[0], math.Max(neutral[1], neutral[2]))
		for i := range settings.multipliers {
			settings.multipliers[i] = math.Min(largest/neutral[i], 16)
		}
	}

	if ev := t.numbers(dir[tagBaselineExposure], 1); len(ev) == 1 {
		settings.exposure = math.Pow(2, math.Max(-4, math.Min(4, ev[0])))
	}
	return settings
}

// toneSteps is the resolution of the linear to sRGB lookup table
const toneSteps = 1 << 14

// toneCurve maps linear values (0 to toneSteps) to 8 bit sRGB
func toneCurve() *[toneSteps + 1]uint8 {
	const contrast = 0.35
	var table [toneSteps + 1]uint8
	for i := range table {
		v := float64(i) / toneSteps
		if v <= 0.0031308 {
			v *= 12.92
		} else {
			v = 1.055*math.Pow(v, 1/2.4) - 0.055
		}
		//Blend towards an S curve
		v += contrast * (v*v*(3-2*v) - v)
		table[i] = uint8(math.Max(0, math.Min(255, v*255+0.5)))
	}
	return &table
}

// autoExposure returns the gain that brings the brightest 1% of the picture to
// white, between 1 and 4. histogram counts the brightest channel of sampled
// pixels, its last bin being white.
func autoExposure(histogram []int) float32 {
	total := 0
	for _, n := range histogram {
		total += n
	}
	if total == 0 {
		return 1
	}
	above := 0
	for i := len(histogram) - 1; i > 0; i-- {
		above += histogram[i]
		if above > total/100 {
			white := float32(i+1) / float32(len(histogram))
			return max(1, min(4, 1/white))
		}
	}
	return 4
}
