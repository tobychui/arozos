package officeart

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"testing"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/internal/officetest"
)

// rec builds a record: ver 0xF payloads are the concatenated children
func rec(ver uint8, inst uint16, typ uint16, payload ...[]byte) []byte {
	body := bytes.Join(payload, nil)
	h := make([]byte, 8)
	binary.LittleEndian.PutUint16(h, uint16(ver)|inst<<4)
	binary.LittleEndian.PutUint16(h[2:], typ)
	binary.LittleEndian.PutUint32(h[4:], uint32(len(body)))
	return append(h, body...)
}

func u32(vs ...uint32) []byte {
	b := make([]byte, 4*len(vs))
	for i, v := range vs {
		binary.LittleEndian.PutUint32(b[4*i:], v)
	}
	return b
}

// fopt builds a property table; complex values are appended in order
func fopt(props [][2]uint32, complex ...[]byte) []byte {
	var b []byte
	for _, p := range props {
		e := make([]byte, 6)
		binary.LittleEndian.PutUint16(e, uint16(p[0]))
		binary.LittleEndian.PutUint32(e[2:], p[1])
		b = append(b, e...)
	}
	for _, c := range complex {
		b = append(b, c...)
	}
	return rec(3, uint16(len(props)), FOPT, b)
}

func utf16z(s string) []byte {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 2*len(u)+2)
	for i, c := range u {
		binary.LittleEndian.PutUint16(b[2*i:], c)
	}
	return b
}

func TestParseTree(t *testing.T) {
	data := append(rec(0xF, 0, DgContainer,
		rec(0, 1, FDG, u32(3, 1025)),
		rec(0xF, 0, SpgrContainer,
			rec(0xF, 0, SpContainer, rec(1, 0, FSPGR, u32(0, 0, 100, 100)), rec(2, 0, FSP, u32(1024, SpGroup|SpPatriarch))),
			rec(0xF, 0, SpContainer, rec(2, 1, FSP, u32(1025, SpHaveAnchor)), rec(0, 0, ChildAnchor, u32(10, 20, 30, 40))),
		)), rec(0, 0, 0xF011, nil)...)
	recs := Parse(data)
	if len(recs) != 2 {
		t.Fatalf("Parse gave %d top records, want 2", len(recs))
	}
	dg := recs[0]
	if !dg.IsContainer() || dg.Child(FDG) == nil || dg.Child(FDG).Instance != 1 {
		t.Fatal("container children not parsed")
	}
	if n := len(dg.Find(FSP)); n != 2 {
		t.Errorf("Find(FSP) = %d, want 2", n)
	}
	g := ReadGroup(dg.Child(SpgrContainer))
	if g == nil || !g.IsGroup() || len(g.Children) != 1 {
		t.Fatalf("ReadGroup = %+v", g)
	}
	sh := g.Children[0]
	if sh.Type != 1 || sh.ID != 1025 || sh.Child == nil || sh.Child[3] != 40 {
		t.Errorf("child shape = %+v", sh)
	}
	count := 0
	Walk(g, func(*Shape, []*Shape) { count++ })
	if count != 2 {
		t.Errorf("Walk visited %d shapes, want 2", count)
	}
}

func TestParseToleratesBadLengths(t *testing.T) {
	r := rec(0xF, 0, SpContainer, rec(2, 1, FSP, u32(1, 0)))
	binary.LittleEndian.PutUint32(r[4:], 9999) // container claims too much
	if recs := Parse(r); len(recs) != 1 || recs[0].Child(FSP) == nil {
		t.Fatal("an overlong container should still yield its children")
	}
	for i := 0; i < len(r); i++ {
		Parse(r[:i]) // must not panic
	}
}

func TestProps(t *testing.T) {
	name := utf16z("Picture 1")
	r := Parse(fopt([][2]uint32{
		{PropRotation, 45 << 16},
		{PropFillColor, 0x000000FF},
		{PropLineColor, 0x08000002}, // scheme colour 2
		{PropWzName | 0x8000, uint32(len(name))},
		{PropPib | 0x4000, 3},
		{PropFillBooleans, 0x00100010}, // fFilled set and true
		{PropLineBooleans, 0x00080000}, // fLine set and false
	}, name))[0]
	p := ParseProps(r)
	if p.Fixed(PropRotation, 0) != 45 {
		t.Errorf("rotation = %v", p.Fixed(PropRotation, 0))
	}
	if v, _ := p.Get(PropFillColor); DecodeColor(v).Hex() != "#ff0000" || DecodeColor(v).IsScheme() {
		t.Errorf("fill colour = %+v", DecodeColor(v))
	}
	if v, _ := p.Get(PropLineColor); !DecodeColor(v).IsScheme() || DecodeColor(v).R != 2 {
		t.Errorf("line colour should be scheme index 2")
	}
	if p.String(PropWzName) != "Picture 1" {
		t.Errorf("name = %q", p.String(PropWzName))
	}
	if v, _ := p.Get(PropPib); v != 3 {
		t.Errorf("pib = %d", v)
	}
	if !p.BoolDefault(PropFillBooleans, FillFilled, false) {
		t.Error("fFilled should be true")
	}
	if p.BoolDefault(PropLineBooleans, LineLine, true) {
		t.Error("fLine should be false")
	}
	if _, set := p.Bool(PropShadowBooleans, ShadowShadow); set {
		t.Error("absent boolean set should not be set")
	}
	// overriding one flag keeps the others
	over := ParseProps(Parse(fopt([][2]uint32{{PropFillBooleans, 0x00010000}}))[0])
	m := p.Merge(over)
	if !m.BoolDefault(PropFillBooleans, FillFilled, false) {
		t.Error("merge lost fFilled")
	}
	if _, set := m.Bool(PropFillBooleans, 0); !set {
		t.Error("merge lost the overriding flag")
	}
}

func TestArrayProperty(t *testing.T) {
	arr := []byte{3, 0, 3, 0, 0xF0, 0xFF, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0}
	p := ParseProps(Parse(fopt([][2]uint32{{PropVertices | 0x8000, uint32(len(arr))}}, arr))[0])
	el := p.Array(PropVertices)
	if len(el) != 3 || len(el[0]) != 4 || el[2][0] != 5 {
		t.Errorf("Array = %v", el)
	}
}

func TestDecodeBlips(t *testing.T) {
	pngData := officetest.PngBytes(t)
	uid := make([]byte, 16)
	pngRec := Parse(rec(0, 0x6E0, BlipPNG, uid, []byte{0xFF}, pngData))[0]
	b, err := DecodeBlip(pngRec)
	if err != nil || b.Ext != "png" || !bytes.Equal(b.Data, pngData) {
		t.Fatalf("PNG blip: %v %+v", err, b)
	}
	// a JPEG stored with two UIDs
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3}
	b, err = DecodeBlip(Parse(rec(0, 0x46B, BlipJPEG, uid, uid, []byte{0xFF}, jpeg))[0])
	if err != nil || b.Ext != "jpeg" || !bytes.Equal(b.Data, jpeg) {
		t.Fatalf("JPEG blip: %v %+v", err, b)
	}
	// a compressed WMF
	wmf := officetest.BuildWmf([4]int{0, 0, 10, 10}, 1440)
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	zw.Write(wmf)
	zw.Close()
	hdr := append(u32(uint32(len(wmf)), 0, 0, 10, 10, 9525*10, 9525*10, uint32(z.Len())), 0, 0xFE)
	b, err = DecodeBlip(Parse(rec(0, 0x216, BlipWMF, uid, hdr, z.Bytes()))[0])
	if err != nil || b.Ext != "wmf" || !bytes.Equal(b.Data, wmf) {
		t.Fatalf("WMF blip: %v", err)
	}
	// a DIB becomes PNG
	dib := officetest.Dib24(2, 2, officetest.Quadrants(2, 2))
	b, err = DecodeBlip(Parse(rec(0, 0x7A8, BlipDIB, uid, []byte{0xFF}, dib))[0])
	if err != nil || b.Ext != "png" || !bytes.HasPrefix(b.Data, []byte("\x89PNG")) {
		t.Fatalf("DIB blip: %v", err)
	}
}

func TestBStore(t *testing.T) {
	pngData := officetest.PngBytes(t)
	uid := make([]byte, 16)
	blip := rec(0, 0x6E0, BlipPNG, uid, []byte{0xFF}, pngData)
	name := utf16z("logo")
	bseHead := func(size, delay uint32, cbName int) []byte {
		h := make([]byte, 36)
		h[0], h[1] = 6, 6
		binary.LittleEndian.PutUint32(h[20:], size)
		binary.LittleEndian.PutUint32(h[24:], 1)
		binary.LittleEndian.PutUint32(h[28:], delay)
		h[33] = byte(cbName)
		return h
	}
	// entry 1 inline, entry 2 in the delay stream at offset 5, entry 3 empty
	delay := append([]byte{9, 9, 9, 9, 9}, blip...)
	dgg := Parse(rec(0xF, 0, DggContainer,
		rec(0xF, 3, BStoreContainer,
			rec(2, 6, FBSE, bseHead(uint32(len(blip)), 0, len(name)), name, blip),
			rec(2, 6, FBSE, bseHead(uint32(len(blip)), 5, 0)),
			rec(2, 0, FBSE, bseHead(0, 0xFFFFFFFF, 0)),
		)))[0]
	store := BStore(dgg, delay)
	if len(store) != 3 {
		t.Fatalf("BStore = %d entries, want 3", len(store))
	}
	if store[0] == nil || store[0].Name != "logo" || !bytes.Equal(store[0].Data, pngData) {
		t.Errorf("inline entry = %+v", store[0])
	}
	if store[1] == nil || !bytes.Equal(store[1].Data, pngData) {
		t.Errorf("delayed entry not read")
	}
	if store[2] != nil {
		t.Errorf("empty entry should be nil")
	}
}
