package cfb

import (
	"bytes"
	"encoding/binary"
	"testing"
	"unicode/utf16"
)

// buildCFB writes a version 3 compound file holding the given root-level
// streams, plus one storage "Sub" holding the sub streams. Streams below
// 4096 bytes go into the mini stream, as Office writes them.
func buildCFB(t *testing.T, streams, sub map[string][]byte) []byte {
	t.Helper()
	const ss = 512
	type ent struct {
		name     string
		typ      byte
		data     []byte
		start    uint32
		children []int
	}
	ents := []*ent{{name: "Root Entry", typ: typeRoot}}
	addTo := func(parent int, m map[string][]byte) {
		for _, n := range sortedKeys(m) {
			ents = append(ents, &ent{name: n, typ: typeStream, data: m[n]})
			ents[parent].children = append(ents[parent].children, len(ents)-1)
		}
	}
	addTo(0, streams)
	if sub != nil {
		ents = append(ents, &ent{name: "Sub", typ: typeStorage})
		si := len(ents) - 1
		ents[0].children = append(ents[0].children, si)
		addTo(si, sub)
	}

	// mini stream
	var mini []byte
	var miniFat []uint32
	for _, e := range ents {
		if e.typ != typeStream || len(e.data) >= 4096 || len(e.data) == 0 {
			continue
		}
		e.start = uint32(len(mini) / 64)
		n := (len(e.data) + 63) / 64
		for i := 0; i < n; i++ {
			if i == n-1 {
				miniFat = append(miniFat, endOfChain)
			} else {
				miniFat = append(miniFat, uint32(len(miniFat)+1))
			}
		}
		buf := make([]byte, n*64)
		copy(buf, e.data)
		mini = append(mini, buf...)
	}

	// regular sectors: dir, minifat, ministream, big streams
	var sectors [][]byte
	var fat []uint32
	place := func(data []byte) uint32 {
		if len(data) == 0 {
			return endOfChain
		}
		start := uint32(len(sectors))
		n := (len(data) + ss - 1) / ss
		for i := 0; i < n; i++ {
			sec := make([]byte, ss)
			copy(sec, data[i*ss:])
			sectors = append(sectors, sec)
			if i == n-1 {
				fat = append(fat, endOfChain)
			} else {
				fat = append(fat, uint32(len(sectors)))
			}
		}
		return start
	}
	dirBytes := make([]byte, ((len(ents)+3)/4)*4*128)
	dirStart := place(dirBytes) // filled in below, sectors are slices of it? no: rewrite later
	mfBytes := make([]byte, len(miniFat)*4)
	for i, v := range miniFat {
		binary.LittleEndian.PutUint32(mfBytes[4*i:], v)
	}
	mfStart := place(mfBytes)
	ents[0].start = place(mini)
	ents[0].data = mini
	for _, e := range ents[1:] {
		if e.typ == typeStream && len(e.data) >= 4096 {
			e.start = place(e.data)
		}
	}
	// FAT sectors at the end
	nFat := (len(fat) + 127) / 128
	for (len(fat)+nFat+127)/128 > nFat {
		nFat++
	}
	fatStart := uint32(len(fat))
	for i := 0; i < nFat; i++ {
		fat = append(fat, fatSect)
	}
	for len(fat)%128 != 0 {
		fat = append(fat, freeSect)
	}
	for i := 0; i < nFat; i++ {
		sec := make([]byte, ss)
		for j := 0; j < 128; j++ {
			binary.LittleEndian.PutUint32(sec[4*j:], fat[i*128+j])
		}
		sectors = append(sectors, sec)
	}

	// directory: children of a storage chained through right siblings
	for i, e := range ents {
		d := dirBytes[i*128 : i*128+128]
		u := utf16.Encode([]rune(e.name))
		for j, c := range u {
			binary.LittleEndian.PutUint16(d[2*j:], c)
		}
		binary.LittleEndian.PutUint16(d[64:], uint16(2*len(u)+2))
		d[66] = e.typ
		binary.LittleEndian.PutUint32(d[68:], noStream)
		binary.LittleEndian.PutUint32(d[72:], noStream)
		binary.LittleEndian.PutUint32(d[76:], noStream)
		if len(e.children) > 0 {
			binary.LittleEndian.PutUint32(d[76:], uint32(e.children[0]))
		}
		binary.LittleEndian.PutUint32(d[116:], e.start)
		binary.LittleEndian.PutUint32(d[120:], uint32(len(e.data)))
	}
	for _, e := range ents {
		for k := 0; k+1 < len(e.children); k++ {
			binary.LittleEndian.PutUint32(dirBytes[e.children[k]*128+72:], uint32(e.children[k+1]))
		}
	}
	for i := 0; i < len(dirBytes)/ss+boolInt(len(dirBytes)%ss != 0); i++ {
		copy(sectors[int(dirStart)+i], dirBytes[i*ss:])
	}

	hdr := make([]byte, ss)
	copy(hdr, Signature)
	le := binary.LittleEndian
	le.PutUint16(hdr[24:], 0x3E)
	le.PutUint16(hdr[26:], 3)
	le.PutUint16(hdr[28:], 0xFFFE)
	le.PutUint16(hdr[30:], 9)
	le.PutUint16(hdr[32:], 6)
	le.PutUint32(hdr[44:], uint32(nFat))
	le.PutUint32(hdr[48:], dirStart)
	le.PutUint32(hdr[56:], 4096)
	le.PutUint32(hdr[60:], mfStart)
	le.PutUint32(hdr[64:], uint32((len(mfBytes)+ss-1)/ss))
	le.PutUint32(hdr[68:], endOfChain)
	for i := 0; i < 109; i++ {
		v := uint32(freeSect)
		if i < nFat {
			v = fatStart + uint32(i)
		}
		le.PutUint32(hdr[76+4*i:], v)
	}
	out := bytes.NewBuffer(hdr)
	for _, s := range sectors {
		out.Write(s)
	}
	return out.Bytes()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func sortedKeys(m map[string][]byte) []string {
	var ks []string
	for k := range m {
		ks = append(ks, k)
	}
	for i := 1; i < len(ks); i++ {
		for j := i; j > 0 && ks[j] < ks[j-1]; j-- {
			ks[j], ks[j-1] = ks[j-1], ks[j]
		}
	}
	return ks
}

func pattern(n int, seed byte) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*7) + seed
	}
	return b
}

func TestOpenReadsMiniAndRegularStreams(t *testing.T) {
	streams := map[string][]byte{
		"WordDocument":           pattern(10000, 1), // regular sectors
		"1Table":                 pattern(700, 2),   // mini stream
		"\x05SummaryInformation": pattern(64, 3),
		"Empty":                  {},
	}
	sub := map[string][]byte{"Inner": pattern(5000, 4), "Tiny": []byte("hi")}
	data := buildCFB(t, streams, sub)
	f, err := Open(data)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	tests := []struct {
		path string
		want []byte
	}{
		{"WordDocument", streams["WordDocument"]},
		{"1table", streams["1Table"]}, // case-insensitive
		{"\x05SummaryInformation", streams["\x05SummaryInformation"]},
		{"Empty", []byte{}},
		{"Sub/Inner", sub["Inner"]},
		{"Sub/Tiny", sub["Tiny"]},
	}
	for _, tc := range tests {
		got, err := f.Stream(tc.path)
		if err != nil {
			t.Errorf("Stream(%q): %v", tc.path, err)
			continue
		}
		if !bytes.Equal(got, tc.want) {
			t.Errorf("Stream(%q) returned %d bytes that differ from the %d written", tc.path, len(got), len(tc.want))
		}
	}
	if !f.Has("Sub/Inner") || f.Has("Sub") || f.Has("Nope") {
		t.Error("Has should report streams only")
	}
	if _, err := f.Stream("Sub"); err == nil {
		t.Error("a storage is not a stream")
	}
	if n := len(f.Entries()); n != 7 {
		t.Errorf("Entries() = %d, want 7 (4 root streams, a storage and its 2 streams)", n)
	}
}

func TestOpenRejectsGarbage(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"empty", nil},
		{"zip", append([]byte("PK\x03\x04"), make([]byte, 600)...)},
		{"signature only", append(append([]byte{}, Signature...), make([]byte, 504)...)},
	}
	for _, tc := range tests {
		if _, err := Open(tc.data); err == nil {
			t.Errorf("%s: Open should fail", tc.name)
		}
	}
	if IsCompound([]byte("short")) {
		t.Error("IsCompound on short input")
	}
}

func TestOpenSurvivesCorruption(t *testing.T) {
	data := buildCFB(t, map[string][]byte{"A": pattern(9000, 5), "B": pattern(100, 6)}, nil)
	// flip bytes all over the file: Open / Stream may fail but must not
	// panic or loop
	for off := 0; off < len(data); off += 37 {
		bad := append([]byte(nil), data...)
		bad[off] ^= 0xFF
		if f, err := Open(bad); err == nil {
			f.Stream("A")
			f.Stream("B")
		}
	}
}
