package ppt

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officeart"
)

func u32le(vs ...uint32) []byte {
	var b []byte
	for _, v := range vs {
		b = binary.LittleEndian.AppendUint32(b, v)
	}
	return b
}

func u16le(vs ...int) []byte {
	var b []byte
	for _, v := range vs {
		b = binary.LittleEndian.AppendUint16(b, uint16(v))
	}
	return b
}

func TestExceptionsFollowTheirMasks(t *testing.T) {
	// a paragraph exception with bullet flags, character, alignment and
	// spacing, but no bullet font / size / colour
	var b []byte
	b = append(b, u32le(pfHasBullet|pfBulletChar|pfAlign|pfSpaceBefore|pfIndent)...)
	b = append(b, u16le(1, 0x25CF, 2, 20, 144)...) // flags, char, align centre... (see below)
	r := &rd{b: b}
	f := r.readPF()
	if r.bad || f.bulletFlags != 1 || f.bulletChar != 0x25CF || f.align != 2 || f.spaceBefore != 20 || f.indent != 144 {
		t.Fatalf("readPF = %+v (bad %v)", f, r.bad)
	}
	// a character exception: bold + italic, font 3, 28pt, RGB colour,
	// superscript
	b = u32le(cfBold | cfItalic | cfTypeface | cfSize | cfColor | cfPosition)
	b = append(b, u16le(3, 3, 28)...)
	b = append(b, 0x11, 0x22, 0x33, 0xFE)
	b = append(b, u16le(30)...)
	r = &rd{b: b}
	c := r.readCF()
	if r.bad || c.style != 3 || c.font != 3 || c.size != 28 || c.color != (colorIdx{0x11, 0x22, 0x33, 0xFE}) || c.position != 30 {
		t.Fatalf("readCF = %+v (bad %v)", c, r.bad)
	}
	// truncated input is flagged, not read past
	r = &rd{b: u32le(cfSize | cfColor)}
	r.readCF()
	if !r.bad {
		t.Error("a truncated exception should be flagged")
	}
}

func TestOverlayAndMasterStyles(t *testing.T) {
	base := pf{align: 0, lineSpacing: 100, leftMargin: 0}
	over := pf{mask: pfAlign | pfLeftMargin, align: 1, leftMargin: 288}
	got := base.over(over)
	if got.align != 1 || got.leftMargin != 288 || got.lineSpacing != 100 {
		t.Errorf("pf.over = %+v", got)
	}
	cb := cf{size: 18, style: cfBold}
	co := cf{mask: cfItalic | cfSize, style: cfItalic, size: 32}
	if r := cb.over(co); r.size != 32 || r.style != cfBold|cfItalic {
		t.Errorf("cf.over = %+v", r)
	}
	// a TxMasterStyleAtom of a derived type names its levels
	var data []byte
	data = append(data, u16le(1)...)       // one level
	data = append(data, u16le(2)...)       // ... which is level 3
	data = append(data, u32le(pfAlign)...) // pf: alignment
	data = append(data, u16le(2)...)       // right
	data = append(data, u32le(cfSize)...)  // cf: size
	data = append(data, u16le(14)...)
	ms := parseMasterStyle(&officeart.Record{Instance: 5, Data: data})
	if ms.levels[2] == nil || ms.levels[2].pf.align != 2 || ms.levels[2].cf.size != 14 {
		t.Fatalf("parseMasterStyle = %+v", ms.levels)
	}
	p, c := resolve([]*masterStyle{ms}, 2)
	if p.align != 2 || c.size != 14 || c.color.index != 1 {
		t.Errorf("resolve = %+v %+v", p, c)
	}
}

func TestMasterLevelsInheritTheLevelAbove(t *testing.T) {
	// a body style: level 1 states a bullet, spacing and size, level 2
	// only its own bullet character and size
	var data []byte
	data = append(data, u16le(2)...)
	data = append(data, u32le(pfHasBullet|pfBulletChar|pfSpaceBefore)...)
	data = append(data, u16le(1, 0x2022, 20)...)
	data = append(data, u32le(cfSize|cfBold)...)
	data = append(data, u16le(cfBold, 32)...)
	data = append(data, u32le(pfBulletChar)...)
	data = append(data, u16le(0x2013)...)
	data = append(data, u32le(cfSize)...)
	data = append(data, u16le(28)...)
	tests := []struct {
		instance  uint16
		inherited bool
	}{
		{1, true},  // body: level 2 starts from level 1
		{4, true},  // text in shapes
		{7, false}, // half body names its levels and derives from body instead
	}
	for _, tc := range tests {
		d := data
		if tc.instance >= 5 {
			// derived types prefix each level with its index
			d = append(u16le(2, 0), data[2:20]...)
			d = append(d, u16le(1)...)
			d = append(d, data[20:]...)
		}
		ms := parseMasterStyle(&officeart.Record{Instance: tc.instance, Data: d})
		l := ms.levels[1]
		if l == nil || l.pf.bulletChar != 0x2013 || l.cf.size != 28 {
			t.Fatalf("instance %d: level 2 = %+v", tc.instance, l)
		}
		got := l.pf.bulletFlags&1 != 0 && l.pf.spaceBefore == 20 && l.cf.style&cfBold != 0
		if got != tc.inherited {
			t.Errorf("instance %d: level 2 inherits level 1 = %v, want %v (%+v)", tc.instance, got, tc.inherited, l)
		}
	}
}

func TestStyleTextPropRuns(t *testing.T) {
	tb := &textBlock{text: []uint16{'H', 'i', 0x0D, 'o', 'k'}}
	var b []byte
	// paragraph runs: "Hi\r" level 0, "ok" + 1 level 1
	b = append(b, u32le(3)...)
	b = append(b, u16le(0)...)
	b = append(b, u32le(0)...)
	b = append(b, u32le(3)...)
	b = append(b, u16le(1)...)
	b = append(b, u32le(pfAlign)...)
	b = append(b, u16le(1)...)
	// character runs: "H" bold, rest plain
	b = append(b, u32le(1)...)
	b = append(b, u32le(cfBold)...)
	b = append(b, u16le(1)...)
	b = append(b, u32le(5)...)
	b = append(b, u32le(0)...)
	tb.readStyleProps(b)
	if len(tb.pfRuns) != 2 || tb.pfRuns[1].level != 1 || tb.pfRuns[1].pf.align != 1 {
		t.Errorf("pf runs = %+v", tb.pfRuns)
	}
	if len(tb.cfRuns) != 2 || tb.cfRuns[0].cf.style != cfBold || tb.cfRuns[1].count != 5 {
		t.Errorf("cf runs = %+v", tb.cfRuns)
	}
}

func TestTransitionsAndFreeforms(t *testing.T) {
	for effect, want := range map[int]string{0: "", 6: "fade", 20: "push", 11: "zoom", 10: "wipe", 99: "fade"} {
		if got := transitionName(effect, 0); got != want {
			t.Errorf("transitionName(%d) = %q, want %q", effect, got, want)
		}
	}
	// a triangle: move, two lines, close, end
	verts := []byte{3, 0, 3, 0, 0xF0, 0xFF}
	verts = append(verts, u16le(0, 100, 50, 0, 100, 100)...)
	segs := []byte{4, 0, 4, 0, 2, 0}
	segs = append(segs, u16le(0x4000, 0x0002, 0x6001, 0x8000)...)
	fopt := func(props [][2]uint32, cx ...[]byte) *officeart.Record {
		var d []byte
		for _, p := range props {
			d = append(d, u16le(int(p[0]))...)
			d = append(d, u32le(p[1])...)
		}
		for _, c := range cx {
			d = append(d, c...)
		}
		return &officeart.Record{Type: officeart.FOPT, Instance: uint16(len(props)), Data: d}
	}
	pr := officeart.ParseProps(fopt([][2]uint32{
		{officeart.PropGeoRight, 100}, {officeart.PropGeoBottom, 100},
		{officeart.PropVertices | 0x8000, uint32(len(verts))}, {officeart.PropSegmentInfo | 0x8000, uint32(len(segs))},
	}, verts, segs))
	g := freeformXML(pr)
	for _, want := range []string{`<a:path w="100" h="100">`, `<a:moveTo><a:pt x="0" y="100"/></a:moveTo>`,
		`<a:lnTo><a:pt x="50" y="0"/></a:lnTo>`, `<a:lnTo><a:pt x="100" y="100"/></a:lnTo>`, `<a:close/>`} {
		if !strings.Contains(g, want) {
			t.Errorf("freeform lacks %s in %s", want, g)
		}
	}
}

func TestColorResolution(t *testing.T) {
	c := &slideCtx{scheme: [8]uint32{0xFFFFFF, 0x111111, 0x222222, 0x333333, 0x444444, 0x555555, 0x666666, 0x777777}}
	empty := officeart.ParseProps(nil)
	if got := c.colorOf(0x08000004, empty); got != 0x444444 {
		t.Errorf("scheme colour = %06x", got)
	}
	if got := c.colorOf(0x00563412, empty); got != 0x123456 {
		t.Errorf("rgb colour = %06x", got)
	}
	if got := c.textColor(colorIdx{index: 3}); got != 0x333333 {
		t.Errorf("text scheme colour = %06x", got)
	}
	if got := c.textColor(colorIdx{0xAA, 0xBB, 0xCC, 0xFE}); got != 0xAABBCC {
		t.Errorf("text rgb colour = %06x", got)
	}
}

func TestRejectsOtherFiles(t *testing.T) {
	for _, data := range [][]byte{nil, []byte("PK\x03\x04 a zip"), make([]byte, 2048)} {
		if _, err := ToPptx(data); err == nil {
			t.Error("ToPptx should fail on a file that is not a .ppt")
		}
	}
}

/* ---------------- a deck saved by PowerPoint ---------------- */

func TestDeck(t *testing.T) {
	data, err := os.ReadFile("testdata/deck.ppt")
	if err != nil {
		t.Fatal(err)
	}
	x, err := ToPptx(data)
	if err != nil {
		t.Fatalf("ToPptx: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(x), int64(len(x)))
	if err != nil {
		t.Fatal(err)
	}
	parts := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		parts[f.Name] = string(b)
	}
	for _, p := range []string{"ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/slides/slide5.xml",
		"ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml",
		"ppt/notesSlides/notesSlide2.xml"} {
		if parts[p] == "" {
			t.Errorf("part %s missing", p)
		}
	}
	if !strings.Contains(parts["ppt/slides/_rels/slide5.xml.rels"], `Target="https://arozos.com/" TargetMode="External"`) {
		t.Error("the text hyperlink is lost")
	}

	deck, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(deck.Slides) != 5 || deck.Size[0] != 960 || deck.Size[1] != 720 {
		t.Fatalf("slides %d size %v", len(deck.Slides), deck.Size)
	}
	html := func(i int) string {
		var sb strings.Builder
		for _, o := range deck.Slides[i].Objects {
			sb.WriteString(o.Props.HTML)
		}
		return sb.String()
	}
	if h := html(0); !strings.Contains(h, "ArozOS Legacy Import") || !strings.Contains(h, "PowerPoint 97-2003 test deck") {
		t.Errorf("title slide text lost: %s", h)
	}
	s2 := html(1)
	for _, want := range []string{"First point", "Nested detail", "font-weight:700", "color:#ff0000"} {
		if !strings.Contains(s2, want) {
			t.Errorf("slide 2 lacks %q", want)
		}
	}
	if deck.Slides[1].Notes != "Speaker notes for slide two" {
		t.Errorf("notes = %q", deck.Slides[1].Notes)
	}
	kinds := map[string]int{}
	lines := 0
	for _, o := range deck.Slides[2].Objects {
		if o.Type == "shape" {
			kinds[o.Props.Kind]++
		}
		if o.Type == "line" {
			lines++
			if o.Props.EndHead != "triangle" || o.Props.Stroke != "#800000" {
				t.Errorf("arrow line = %+v", o.Props)
			}
		}
		if o.Props.Kind == "triangle" && o.Rot != 30 {
			t.Errorf("triangle rotation = %v", o.Rot)
		}
	}
	for _, k := range []string{"rect", "ellipse", "roundRect", "triangle", "rightArrow"} {
		if kinds[k] == 0 {
			t.Errorf("slide 3 lacks a %s (have %v)", k, kinds)
		}
	}
	if lines != 1 {
		t.Errorf("slide 3 lines = %d", lines)
	}
	pics := 0
	for _, o := range deck.Slides[3].Objects {
		if o.Type == "image" && strings.HasPrefix(o.Props.Src, "data:image/jpeg") {
			pics++
		}
	}
	if pics != 1 {
		t.Errorf("slide 4 pictures = %d", pics)
	}
	if !strings.Contains(html(3), ">z<") {
		t.Error("table cell text lost")
	}
	if deck.Slides[4].Bg != "#102030" {
		t.Errorf("slide 5 background = %q", deck.Slides[4].Bg)
	}
	if h := html(4); !strings.Contains(h, "Georgia") || !strings.Contains(h, "color:#ffffff") {
		t.Errorf("slide 5 text formatting lost: %s", h)
	}
}

// a damaged file must fail or degrade, never panic
func TestCorruptDeckDoesNotPanic(t *testing.T) {
	data, err := os.ReadFile("testdata/deck.ppt")
	if err != nil {
		t.Fatal(err)
	}
	for off := 512; off < len(data); off += 211 {
		bad := append([]byte(nil), data...)
		for k := 0; k < 4 && off+k < len(bad); k++ {
			bad[off+k] ^= 0x3C
		}
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic with bytes flipped at %d: %v", off, r)
				}
			}()
			ToPptx(bad)
		}()
	}
}

func TestBoundaryValuesDoNotPanic(t *testing.T) {
	if testing.Short() {
		t.Skip("converts the deck a few hundred times")
	}
	data, err := os.ReadFile("testdata/deck.ppt")
	if err != nil {
		t.Fatal(err)
	}
	// the int limits of a 32-bit target and the largest 32-bit values
	for off := 512; off+4 <= len(data); off += 1999 {
		for _, v := range []uint32{0x7FFFFFFF, 0x80000000, 0xFFFFFFFF} {
			bad := append([]byte(nil), data...)
			binary.LittleEndian.PutUint32(bad[off:], v)
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("panic with %#x at %d: %v", v, off, r)
					}
				}()
				ToPptx(bad)
			}()
		}
	}
}

// fHidden is bit 2 of the flag byte after a SlideShowSlideInfoAtom's
// effect type; the neighbouring flags must not read as hidden
func TestHiddenSlideFlag(t *testing.T) {
	info := func(flags byte) []byte {
		d := make([]byte, 16)
		d[9] = 6 // a fade, so the transition bytes are not all zero
		d[10] = flags
		return d
	}
	cases := []struct {
		name string
		data []byte
		want bool
	}{
		{"no flags", info(0), false},
		{"hidden", info(0x04), true},
		{"hidden and manual advance", info(0x05), true},
		{"manual advance only", info(0x01), false},
		{"sound only", info(0x10), false},
		{"truncated atom", info(0x04)[:10], false},
	}
	for _, c := range cases {
		if got := slideHidden(c.data); got != c.want {
			t.Errorf("%s: slideHidden = %v, want %v", c.name, got, c.want)
		}
	}
}
