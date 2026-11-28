package dngrender

import (
	"encoding/binary"
	"math"
)

/*
	GainMap opcodes

	Phone cameras record the shading of their lens (darker, tinted corners)
	as one gain map for each colour of the mosaic, stored in OpcodeList2. The
	other opcodes (bad pixel and lens distortion fixes) are not needed to view
	a photo and are skipped. Opcode lists are always big endian.
*/

const (
	opcodeGainMap = 9
	maxGainMaps   = 8
)

// gainMap multiplies the pixels of its area by a coarse grid of gains,
// interpolated between the grid points
type gainMap struct {
	top, left, bottom, right int
	rowPitch, colPitch       int
	pointsV, pointsH         int
	spacingV, spacingH       float64
	originV, originH         float64
	mapPlanes                int
	gains                    []float32
}

// parseGainMaps returns the GainMap opcodes of an opcode list
func parseGainMaps(list []byte) []gainMap {
	if len(list) < 4 {
		return nil
	}
	be := binary.BigEndian
	count := be.Uint32(list)
	list = list[4:]

	var maps []gainMap
	for i := uint32(0); i < count && len(list) >= 16 && len(maps) < maxGainMaps; i++ {
		id := be.Uint32(list)
		size := int64(be.Uint32(list[12:]))
		list = list[16:]
		if size > int64(len(list)) {
			break
		}
		body := list[:size]
		list = list[size:]
		if id != opcodeGainMap {
			continue
		}
		if m, ok := parseGainMap(body); ok {
			maps = append(maps, m)
		}
	}
	return maps
}

// parseGainMap reads the parameters of one GainMap opcode
func parseGainMap(body []byte) (gainMap, bool) {
	const header = 76
	var m gainMap
	if len(body) < header {
		return m, false
	}
	be := binary.BigEndian
	field := func(i int) int { return int(min(be.Uint32(body[i*4:]), maxDimension)) }
	double := func(offset int) float64 { return math.Float64frombits(be.Uint64(body[offset:])) }

	m.top, m.left, m.bottom, m.right = field(0), field(1), field(2), field(3)
	//field 4 and 5 are the first plane and plane count, a mosaic has one
	if field(4) != 0 {
		return m, false
	}
	m.rowPitch, m.colPitch = field(6), field(7)
	m.pointsV, m.pointsH = field(8), field(9)
	m.spacingV, m.spacingH = double(40), double(48)
	m.originV, m.originH = double(56), double(64)
	m.mapPlanes = field(72 / 4)
	if m.rowPitch < 1 || m.colPitch < 1 || m.pointsV < 1 || m.pointsH < 1 || m.mapPlanes < 1 || m.mapPlanes > 4 {
		return m, false
	}
	for _, v := range []float64{m.spacingV, m.spacingH, m.originV, m.originH} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return m, false
		}
	}

	total := int64(m.pointsV) * int64(m.pointsH) * int64(m.mapPlanes)
	if total > int64(len(body)-header)/4 {
		return m, false
	}
	m.gains = make([]float32, total)
	for i := range m.gains {
		g := math.Float32frombits(be.Uint32(body[header+i*4:]))
		if !(g > 0 && g < 64) {
			g = 1
		}
		m.gains[i] = g
	}
	return m, true
}

// gridPosition turns a position in the image (0 to 1) into the two grid points
// around it and how far it is from the first
func gridPosition(position, origin, spacing float64, points int) (int, int, float32) {
	index := 0.0
	if spacing > 0 {
		index = (position - origin) / spacing
	}
	if !(index > 0) {
		return 0, 0, 0
	}
	if index >= float64(points-1) {
		return points - 1, points - 1, 0
	}
	low := int(index)
	return low, low + 1, float32(index - float64(low))
}

// applyRow multiplies one row of the active area by the gains of this map.
// width and height are the size of the active area.
func (m *gainMap) applyRow(row []float32, y, width, height int) {
	if y < m.top || y >= m.bottom || (y-m.top)%m.rowPitch != 0 {
		return
	}
	v0, v1, fv := gridPosition((float64(y)+0.5)/float64(height), m.originV, m.spacingV, m.pointsV)
	stride := m.pointsH * m.mapPlanes
	for x := m.left; x < min(m.right, width); x += m.colPitch {
		h0, h1, fh := gridPosition((float64(x)+0.5)/float64(width), m.originH, m.spacingH, m.pointsH)
		top := m.gains[v0*stride+h0*m.mapPlanes]*(1-fh) + m.gains[v0*stride+h1*m.mapPlanes]*fh
		bottom := m.gains[v1*stride+h0*m.mapPlanes]*(1-fh) + m.gains[v1*stride+h1*m.mapPlanes]*fh
		row[x] *= top*(1-fv) + bottom*fv
	}
}
