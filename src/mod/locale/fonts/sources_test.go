package fonts

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// withFsType returns the Go font with its OS/2 embedding permissions set
func withFsType(t *testing.T, fsType uint16) []byte {
	t.Helper()
	font, err := ParseSFNT(goFont(t))
	if err != nil {
		t.Fatalf("ParseSFNT: %v", err)
	}
	os2 := append([]byte(nil), font.Tables["OS/2"]...)
	binary.BigEndian.PutUint16(os2[8:], fsType)
	font.Tables["OS/2"] = os2
	out, err := AssembleSFNT(font.Flavor, font.Tables)
	if err != nil {
		t.Fatalf("AssembleSFNT: %v", err)
	}
	return out
}

func TestNoEmbed(t *testing.T) {
	cases := []struct {
		name   string
		fsType uint16
		want   bool
	}{
		{"installable", 0x0000, false},
		{"restricted", 0x0002, true},
		{"preview and print", 0x0004, false},
		{"editable", 0x0008, false},
		{"restricted with a looser bit (old fonts)", 0x0006, false},
		{"no subsetting", 0x0100, false},
		{"bitmaps only", 0x0208, true},
	}
	for _, c := range cases {
		if got := noEmbed(c.fsType); got != c.want {
			t.Errorf("%s: noEmbed(%#04x) = %v, want %v", c.name, c.fsType, got, c.want)
		}
	}
}

func TestSourcesListsFaces(t *testing.T) {
	lib, _ := newTestLibrary(t)
	src := lib.Sources()
	if len(src) != 1 || src[0].Name != "Go" || len(src[0].Faces) != 1 {
		t.Fatalf("sources = %+v, want the one Go face", src)
	}
	f := src[0].Faces[0]
	if !f.Embed || f.File != "file/"+f.Key+".ttf" {
		t.Errorf("face = %+v, want an embeddable .ttf", f)
	}
	if len(f.Slices) != 1 || f.Slices[0].Name != "all" || f.Slices[0].Range != "" {
		t.Errorf("slices = %+v, want the whole font", f.Slices)
	}
	if f.WeightMin != 400 || f.Italic {
		t.Errorf("weight %d italic %v", f.WeightMin, f.Italic)
	}
}

func TestSourcesListsSlices(t *testing.T) {
	saved, savedSize := sliceMinBytes, sliceSize
	sliceMinBytes, sliceSize = 1, 300 // slice even the small Go font
	t.Cleanup(func() { sliceMinBytes, sliceSize = saved, savedSize })

	lib, _ := newTestLibrary(t)
	f := lib.Sources()[0].Faces[0]
	if len(f.Slices) < 2 {
		t.Fatalf("slices = %+v, want the cold slices", f.Slices)
	}
	for _, s := range f.Slices {
		if !slicePattern.MatchString(s.Name) || s.Range == "" {
			t.Errorf("slice %+v: want a cNN name and a unicode-range", s)
		}
		if _, err := lib.SlicePath(f.Key, s.Name); err != nil {
			t.Errorf("slice %s cannot be served: %v", s.Name, err)
		}
	}
}

func TestRestrictedFontIsNotHandedOver(t *testing.T) {
	lib, root := newTestLibrary(t)
	if err := os.WriteFile(filepath.Join(root, "Go", "Go-Regular.ttf"), withFsType(t, 0x0002), 0644); err != nil {
		t.Fatal(err)
	}
	if err := lib.Rescan(); err != nil {
		t.Fatal(err)
	}
	f := lib.Sources()[0].Faces[0]
	if f.Embed || f.File != "" {
		t.Errorf("a restricted font is offered for embedding: %+v", f)
	}
	if len(f.Slices) == 0 {
		t.Error("a restricted font must still be usable on screen")
	}
	if _, _, err := lib.FileData(f.Key); err != ErrNotFound {
		t.Errorf("FileData(restricted) = %v, want ErrNotFound", err)
	}
	rec := httptest.NewRecorder()
	lib.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/x", nil), f.Key+".ttf")
	if rec.Code != http.StatusNotFound {
		t.Errorf("ServeFile(restricted): status %d", rec.Code)
	}
}

func TestServeFile(t *testing.T) {
	lib, _ := newTestLibrary(t)
	key := lib.Sources()[0].Faces[0].Key
	cases := []struct {
		name string
		want int
	}{
		{key + ".ttf", http.StatusOK},
		{key + ".otf", http.StatusNotFound}, // a TrueType font is not served as CFF
		{key, http.StatusNotFound},          // no extension
		{"0123456789abcdef.ttf", http.StatusNotFound},
		{"../../Go/Go-Regular.ttf", http.StatusNotFound},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		lib.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/x", nil), c.name)
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", c.name, rec.Code, c.want)
			continue
		}
		if c.want != http.StatusOK {
			continue
		}
		if rec.Header().Get("Content-Type") != "font/ttf" {
			t.Errorf("%s: type %q", c.name, rec.Header().Get("Content-Type"))
		}
		if !bytes.Equal(rec.Body.Bytes(), goFont(t)) {
			t.Errorf("%s: the served font is not the installed file", c.name)
		}
	}
}

// oddGlyphs returns the Go font with every glyph one byte longer and no
// padding between them, as some large fonts are stored
func oddGlyphs(t *testing.T) ([]byte, int) {
	t.Helper()
	font, err := ParseSFNT(goFont(t))
	if err != nil {
		t.Fatal(err)
	}
	n := int(binary.BigEndian.Uint16(font.Tables["maxp"][4:]))
	offsets, err := glyphOffsets(font, n)
	if err != nil {
		t.Fatal(err)
	}
	var glyf []byte
	loca := make([]byte, 4*(n+1))
	for i := 0; i < n; i++ {
		binary.BigEndian.PutUint32(loca[4*i:], uint32(len(glyf)))
		glyf = append(glyf, font.Tables["glyf"][offsets[i]:offsets[i+1]]...)
		glyf = append(glyf, 0x5A) // trailing data a parser never reads
	}
	binary.BigEndian.PutUint32(loca[4*n:], uint32(len(glyf)))
	head := append([]byte(nil), font.Tables["head"]...)
	binary.BigEndian.PutUint16(head[50:], 1)
	font.Tables["glyf"], font.Tables["loca"], font.Tables["head"] = glyf, loca, head
	out, err := AssembleSFNT(font.Flavor, font.Tables)
	if err != nil {
		t.Fatal(err)
	}
	return out, n
}

func TestFileDataPadsOddGlyphs(t *testing.T) {
	lib, root := newTestLibrary(t)
	odd, n := oddGlyphs(t)
	if err := os.WriteFile(filepath.Join(root, "Go", "Go-Regular.ttf"), odd, 0644); err != nil {
		t.Fatal(err)
	}
	if err := lib.Rescan(); err != nil {
		t.Fatal(err)
	}
	key := lib.Sources()[0].Faces[0].Key
	file, _, err := lib.FilePath(key)
	if err != nil {
		t.Fatalf("FilePath: %v", err)
	}
	if file == filepath.Join(root, "Go", "Go-Regular.ttf") {
		t.Fatal("an unpadded font was handed over as it is")
	}
	data, _, err := lib.FileData(key)
	if err != nil {
		t.Fatalf("FileData: %v", err)
	}
	got, err := ParseSFNT(data)
	if err != nil {
		t.Fatalf("the padded font does not parse: %v", err)
	}
	if !glyphsAligned(got, n) {
		t.Fatal("the handed over font still has unaligned glyphs")
	}
	src, _ := ParseSFNT(odd)
	srcOff, _ := glyphOffsets(src, n)
	gotOff, err := glyphOffsets(got, n)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		was := src.Tables["glyf"][srcOff[i]:srcOff[i+1]]
		now := got.Tables["glyf"][gotOff[i]:gotOff[i+1]]
		if gotOff[i]%4 != 0 || !bytes.HasPrefix(now, was) || len(now)-len(was) > 3 {
			t.Fatalf("glyph %d: %d bytes at %d, was %d bytes", i, len(now), gotOff[i], len(was))
		}
	}
	if _, _, err := Inspect(got); err != nil {
		t.Errorf("the padded font fails inspection: %v", err)
	}
	// made once, then served from the cache
	again, _, _ := lib.FilePath(key)
	if again != file {
		t.Errorf("second FilePath = %q, want the cached %q", again, file)
	}
}

func TestGlyphsAligned(t *testing.T) {
	plain, err := ParseSFNT(goFont(t))
	if err != nil {
		t.Fatal(err)
	}
	n := int(binary.BigEndian.Uint16(plain.Tables["maxp"][4:]))
	odd, _ := oddGlyphs(t)
	oddFont, _ := ParseSFNT(odd)
	cases := []struct {
		name string
		font *Font
		want bool
	}{
		{"padded TrueType", plain, true},
		{"odd glyph lengths", oddFont, false},
		{"no glyf (CFF)", &Font{Tables: map[string][]byte{"head": plain.Tables["head"]}}, true},
	}
	for _, c := range cases {
		if got := glyphsAligned(c.font, n); got != c.want {
			t.Errorf("%s: glyphsAligned = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestFileDataUnpacksWOFF2(t *testing.T) {
	lib, root := newTestLibrary(t)
	font, err := ParseSFNT(goFont(t))
	if err != nil {
		t.Fatal(err)
	}
	woff2, err := EncodeWOFF2(font.Flavor, font.Tables, 5)
	if err != nil {
		t.Fatalf("EncodeWOFF2: %v", err)
	}
	// a WOFF2 upload is kept as it is
	os.Remove(filepath.Join(root, "Go", "Go-Regular.ttf"))
	if err := os.WriteFile(filepath.Join(root, "Go", "Go-Regular.woff2"), woff2, 0644); err != nil {
		t.Fatal(err)
	}
	if err := lib.Rescan(); err != nil {
		t.Fatal(err)
	}
	f := lib.Sources()[0].Faces[0]
	if !f.Embed {
		t.Fatalf("an untransformed WOFF2 should be embeddable: %+v", f)
	}
	data, ext, err := lib.FileData(f.Key)
	if err != nil || ext != ".ttf" {
		t.Fatalf("FileData = %v, %q", err, ext)
	}
	got, err := ParseSFNT(data)
	if err != nil {
		t.Fatalf("the unpacked font does not parse: %v", err)
	}
	for tag, want := range font.Tables {
		if tag == "head" || tag == "DSIG" {
			continue // checkSumAdjustment is rewritten; EncodeWOFF2 may drop a signature
		}
		if !bytes.Equal(got.Tables[tag], want) {
			t.Errorf("table %q differs after unpacking", tag)
		}
	}
}
