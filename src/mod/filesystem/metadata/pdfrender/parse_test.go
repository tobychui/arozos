package pdfrender

import (
	"bytes"
	"compress/zlib"
	"crypto/aes"
	"crypto/cipher"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"testing"

	"github.com/go-pdf/fpdf"
	"golang.org/x/image/font/gofont/goregular"
)

func TestParseObjects(t *testing.T) {
	tests := []struct {
		in   string
		want Object
	}{
		{"42", 42},
		{"-3.5", -3.5},
		{".5", 0.5},
		{"--5", -5},
		{"4.-3", 4.0},
		{"/Name#20With#2FEscapes", Name("Name With/Escapes")},
		{"(a\\(b\\)c \\101\\n)", String("a(b)c A\n")},
		{"(nested (parens) ok)", String("nested (parens) ok")},
		{"(line\\\ncontinued)", String("linecontinued")},
		{"<48 65 6C6C 6F>", String("Hello")},
		{"<414>", String("A@")},
		{"12 0 R", Ref{12, 0}},
		{"true", true},
		{"null", nil},
	}
	for _, tc := range tests {
		got, err := newParser([]byte(tc.in)).parseObject(0)
		if err != nil {
			t.Errorf("parse %q: %v", tc.in, err)
			continue
		}
		if fmt.Sprint(got) != fmt.Sprint(tc.want) {
			t.Errorf("parse %q = %#v, want %#v", tc.in, got, tc.want)
		}
	}
	//Composite values
	obj, err := newParser([]byte("<< /A [1 2 3 R /B] /C << /D (x) >> /E 5 0 R >>")).parseObject(0)
	if err != nil {
		t.Fatal(err)
	}
	d := obj.(Dict)
	//"2 3 R" inside the array is a reference
	if arr := d["A"].(Array); len(arr) != 3 || arr[1] != (Ref{2, 3}) {
		t.Errorf("array = %v", arr)
	}
	if d["E"] != (Ref{5, 0}) {
		t.Errorf("ref = %v", d["E"])
	}
	//Deep nesting is refused instead of exhausting the stack
	deep := bytes.Repeat([]byte("["), 100000)
	if _, err := newParser(deep).parseObject(0); err == nil {
		t.Error("expected an error for runaway nesting")
	}
}

func TestFilters(t *testing.T) {
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	//PNG "Up" predictor rows of 3 columns
	zw.Write([]byte{2, 1, 2, 3, 2, 1, 1, 1})
	zw.Close()
	d := &Document{}
	pred, err := applyPredictor(&Document{cache: map[Ref]Object{}, resolving: map[Ref]bool{}}, mustFlate(t, z.Bytes()), Dict{"Predictor": 12, "Columns": 3})
	if err != nil || !bytes.Equal(pred, []byte{1, 2, 3, 2, 3, 4}) {
		t.Errorf("png predictor = %v %v", pred, err)
	}
	_ = d
	tests := []struct {
		name string
		got  []byte
		want []byte
	}{
		{"ascii hex", asciiHexDecode([]byte("48 65\n6c6c6F>junk")), []byte("Hello")},
		{"ascii hex odd", asciiHexDecode([]byte("414>")), []byte("A@")},
		{"ascii85", ascii85Decode([]byte("<~87cURD]i,\"Ebo80~>")), []byte("Hello World!")},
		{"ascii85 z", ascii85Decode([]byte("z~>")), []byte{0, 0, 0, 0}},
		{"run length", mustRL(t, []byte{2, 'a', 'b', 'c', 254, 'x', 128}), []byte("abcxxx")},
		{"lzw", mustLZW(t, []byte{0x80, 0x0B, 0x60, 0x50, 0x22, 0x0C, 0x0C, 0x85, 0x01}), []byte{45, 45, 45, 45, 45, 65, 45, 45, 45, 66}},
	}
	for _, tc := range tests {
		if !bytes.Equal(tc.got, tc.want) {
			t.Errorf("%s = %q, want %q", tc.name, tc.got, tc.want)
		}
	}
	//A flate bomb stops at the limit
	var bomb bytes.Buffer
	bw := zlib.NewWriter(&bomb)
	bw.Write(make([]byte, 4<<20))
	bw.Close()
	if _, err := flateDecode(bomb.Bytes(), 1<<20); err != errTooLarge {
		t.Errorf("flate bomb: err = %v, want errTooLarge", err)
	}
}

func mustFlate(t *testing.T, b []byte) []byte {
	out, err := flateDecode(b, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func mustRL(t *testing.T, b []byte) []byte {
	out, err := runLengthDecode(b, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func mustLZW(t *testing.T, b []byte) []byte {
	out, err := lzwDecode(b, 1, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestFunctions(t *testing.T) {
	doc := &Document{cache: map[Ref]Object{}, resolving: map[Ref]bool{}}
	ps := &Stream{Dict: Dict{"FunctionType": 4, "Domain": Array{0, 1}, "Range": Array{0, 1, 0, 1}}, offset: -1,
		data: []byte("{ dup 0.5 gt { 1 exch sub } { 2 mul } ifelse dup }")}
	tests := []struct {
		name string
		fn   Object
		in   []float64
		want []float64
	}{
		{"exponential", Dict{"FunctionType": 2, "Domain": Array{0, 1}, "C0": Array{0, 0}, "C1": Array{1, 0.5}, "N": 2}, []float64{0.5}, []float64{0.25, 0.125}},
		{"stitching", Dict{"FunctionType": 3, "Domain": Array{0, 1}, "Bounds": Array{0.5}, "Encode": Array{0, 1, 0, 1},
			"Functions": Array{
				Dict{"FunctionType": 2, "Domain": Array{0, 1}, "C0": Array{0}, "C1": Array{1}, "N": 1},
				Dict{"FunctionType": 2, "Domain": Array{0, 1}, "C0": Array{1}, "C1": Array{0}, "N": 1},
			}}, []float64{0.75}, []float64{0.5}},
		{"postscript true branch", ps, []float64{0.75}, []float64{0.25, 0.25}},
		{"postscript false branch", ps, []float64{0.25}, []float64{0.5, 0.5}},
		{"sampled", &Stream{Dict: Dict{"FunctionType": 0, "Domain": Array{0, 1}, "Range": Array{0, 1}, "Size": Array{2}, "BitsPerSample": 8}, offset: -1, data: []byte{0, 255}}, []float64{0.5}, []float64{0.5}},
	}
	for _, tc := range tests {
		fn := doc.loadFunction(tc.fn, 0)
		if fn == nil {
			t.Errorf("%s: not loaded", tc.name)
			continue
		}
		got := fn.eval(tc.in)
		if len(got) != len(tc.want) {
			t.Errorf("%s = %v, want %v", tc.name, got, tc.want)
			continue
		}
		for i := range got {
			if math.Abs(got[i]-tc.want[i]) > 0.01 {
				t.Errorf("%s = %v, want %v", tc.name, got, tc.want)
			}
		}
	}
}

// xrefStreamDoc builds a PDF whose catalog, page tree and page sit in an
// object stream, indexed by a cross reference stream
func xrefStreamDoc(t *testing.T) []byte {
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.5\n")
	content := "0 0 1 rg 0 0 100 100 re f"
	off4 := buf.Len()
	fmt.Fprintf(&buf, "4 0 obj\n<< /Length %d >>\nstream\n%s\nendstream\nendobj\n", len(content), content)
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
	}
	var header, body bytes.Buffer
	for i, o := range objs {
		fmt.Fprintf(&header, "%d %d ", i+1, body.Len())
		body.WriteString(o + "\n")
	}
	stmData := append(header.Bytes(), body.Bytes()...)
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	zw.Write(stmData)
	zw.Close()
	off5 := buf.Len()
	fmt.Fprintf(&buf, "5 0 obj\n<< /Type /ObjStm /N 3 /First %d /Filter /FlateDecode /Length %d >>\nstream\n", header.Len(), z.Len())
	buf.Write(z.Bytes())
	buf.WriteString("\nendstream\nendobj\n")
	//XRef stream: W [1 4 2]
	off6 := buf.Len()
	row := func(typ byte, f2 int, f3 int) []byte {
		return []byte{typ, byte(f2 >> 24), byte(f2 >> 16), byte(f2 >> 8), byte(f2), byte(f3 >> 8), byte(f3)}
	}
	var xr []byte
	xr = append(xr, row(0, 0, 65535)...)
	xr = append(xr, row(2, 5, 0)...)
	xr = append(xr, row(2, 5, 1)...)
	xr = append(xr, row(2, 5, 2)...)
	xr = append(xr, row(1, off4, 0)...)
	xr = append(xr, row(1, off5, 0)...)
	xr = append(xr, row(1, off6, 0)...)
	fmt.Fprintf(&buf, "6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R /Length %d >>\nstream\n", len(xr))
	buf.Write(xr)
	buf.WriteString("\nendstream\nendobj\n")
	fmt.Fprintf(&buf, "startxref\n%d\n%%%%EOF\n", off6)
	return buf.Bytes()
}

func TestDocumentStructure(t *testing.T) {
	t.Run("xref stream and object stream", func(t *testing.T) {
		img := renderBytes(t, xrefStreamDoc(t), 1)
		assertColor(t, img, 50, 50, 100, blue, 6, "page content")
	})
	t.Run("broken xref offsets are rebuilt", func(t *testing.T) {
		data := onePage(100, 100, "", "1 0 0 rg 0 0 100 100 re f", nil)
		//Shift every object by inserting junk after the header
		i := bytes.Index(data, []byte("1 0 obj"))
		broken := append(append(append([]byte{}, data[:i]...), []byte("% junk junk junk junk\n")...), data[i:]...)
		img := renderBytes(t, broken, 1)
		assertColor(t, img, 50, 50, 100, red, 6, "page content")
	})
	t.Run("missing startxref", func(t *testing.T) {
		data := onePage(100, 100, "", "0 1 0 rg 0 0 100 100 re f", nil)
		data = data[:bytes.LastIndex(data, []byte("startxref"))]
		img := renderBytes(t, data, 1)
		assertColor(t, img, 50, 50, 100, green, 6, "page content")
	})
	t.Run("wrong stream length", func(t *testing.T) {
		data := onePage(100, 100, "", "0 0 1 rg 0 0 100 100 re f", nil)
		data = bytes.Replace(data, []byte("/Length 25"), []byte("/Length 9999"), 1)
		img := renderBytes(t, data, 1)
		assertColor(t, img, 50, 50, 100, blue, 6, "page content")
	})
	t.Run("not a pdf", func(t *testing.T) {
		if _, err := Open(bytes.NewReader([]byte("hello")), 5); err != ErrNotPDF {
			t.Errorf("err = %v, want ErrNotPDF", err)
		}
	})
	t.Run("page tree with a cycle", func(t *testing.T) {
		b := &pdfBuilder{}
		pages := b.reserve()
		content := b.addStream("", []byte("0 g 0 0 10 10 re f"))
		page := b.add(fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 100 100] /Contents %d 0 R >>", pages, content))
		b.set(pages, fmt.Sprintf("<< /Type /Pages /Kids [%d 0 R %d 0 R] /Count 2 >>", pages, page))
		root := b.add(fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pages))
		img := renderBytes(t, b.bytes(root), 1)
		assertColor(t, img, 5, 5, 100, black, 6, "page found past the cycle")
	})
	t.Run("multi page lookup", func(t *testing.T) {
		b := &pdfBuilder{}
		pages := b.reserve()
		var kids string
		for i := 0; i < 5; i++ {
			c := b.addStream("", []byte(fmt.Sprintf("0 g 0 0 %d 10 re f", 10*(i+1))))
			p := b.add(fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 100 100] /Contents %d 0 R >>", pages, c))
			kids += fmt.Sprintf("%d 0 R ", p)
		}
		b.set(pages, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count 5 >>", kids))
		data := b.bytes(b.add(fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pages)))
		doc, err := Open(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		if n := doc.NumPages(); n != 5 {
			t.Errorf("NumPages = %d", n)
		}
		img, err := doc.Render(3, Options{Scale: 1})
		if err != nil {
			t.Fatal(err)
		}
		assertColor(t, img, 35, 5, 100, black, 6, "page 4 bar")
		assertColor(t, img, 45, 5, 100, white, 6, "past page 4 bar")
		if _, err := doc.Page(9); err != ErrNoPage {
			t.Errorf("Page(9) err = %v", err)
		}
	})
}

func TestEncryption(t *testing.T) {
	t.Run("rc4 from fpdf", func(t *testing.T) {
		pdf := fpdf.New("P", "pt", "A4", "")
		pdf.SetProtection(fpdf.CnProtectPrint, "", "owner-secret")
		pdf.AddPage()
		pdf.SetFillColor(255, 0, 0)
		pdf.Rect(0, 0, 100, 100, "F")
		var buf bytes.Buffer
		if err := pdf.Output(&buf); err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(buf.Bytes(), []byte("/Encrypt")) {
			t.Fatal("fixture is not encrypted")
		}
		img := renderBytes(t, buf.Bytes(), 1)
		if c := img.RGBAAt(50, 50); !near(c.R, 255, 6) || !near(c.G, 0, 6) {
			t.Errorf("pixel = %v, want red", c)
		}
	})
	t.Run("rc4 with a user password", func(t *testing.T) {
		pdf := fpdf.New("P", "pt", "A4", "")
		pdf.SetProtection(fpdf.CnProtectPrint, "user", "owner")
		pdf.AddPage()
		var buf bytes.Buffer
		pdf.Output(&buf)
		if _, err := Open(bytes.NewReader(buf.Bytes()), int64(buf.Len())); err != ErrEncrypted {
			t.Errorf("err = %v, want ErrEncrypted", err)
		}
	})
	t.Run("aes-256 r6", func(t *testing.T) {
		data := aes256Doc(t, false)
		img := renderBytes(t, data, 1)
		assertColor(t, img, 50, 50, 100, green, 6, "decrypted content")
		if _, err := Open(bytes.NewReader(aes256Doc(t, true)), int64(len(data))); err != ErrEncrypted {
			t.Errorf("wrong password check: err = %v, want ErrEncrypted", err)
		}
	})
}

// aes256Doc builds an AES-256 (R6) document opened by the empty password;
// broken makes the password check fail
func aes256Doc(t *testing.T, broken bool) []byte {
	fileKey := bytes.Repeat([]byte{0x5a}, 32)
	vs := []byte("valsalt1")
	ks := []byte("keysalt1")
	u := append(append(hash2B(nil, vs, nil), vs...), ks...)
	if broken {
		u[0] ^= 1
	}
	block, _ := aes.NewCipher(hash2B(nil, ks, nil))
	ue := make([]byte, 32)
	cipher.NewCBCEncrypter(block, make([]byte, 16)).CryptBlocks(ue, fileKey)

	encrypt := func(plain []byte) []byte {
		pad := 16 - len(plain)%16
		p := append(append([]byte{}, plain...), bytes.Repeat([]byte{byte(pad)}, pad)...)
		iv := bytes.Repeat([]byte{7}, 16)
		blk, _ := aes.NewCipher(fileKey)
		out := make([]byte, len(p))
		cipher.NewCBCEncrypter(blk, iv).CryptBlocks(out, p)
		return append(iv, out...)
	}
	b := &pdfBuilder{}
	pages := b.reserve()
	content := b.addStream("", encrypt([]byte("0 1 0 rg 0 0 100 100 re f")))
	page := b.add(fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 100 100] /Contents %d 0 R >>", pages, content))
	b.set(pages, fmt.Sprintf("<< /Type /Pages /Kids [%d 0 R] /Count 1 >>", page))
	root := b.add(fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pages))
	enc := b.add(fmt.Sprintf("<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /P -4 /O <%x> /U <%x> /OE <%x> /UE <%x> >>",
		bytes.Repeat([]byte{1}, 48), u, bytes.Repeat([]byte{2}, 32), ue))
	b.trailer = fmt.Sprintf("/Encrypt %d 0 R /ID [<0102> <0102>]", enc)
	return b.bytes(root)
}

func TestFpdfDocument(t *testing.T) {
	//A document from an independent writer: core and embedded fonts, a
	//PNG with alpha (soft mask) and vector graphics
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.AddUTF8FontFromBytes("gofont", "", goregular.TTF)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 40)
	pdf.Text(40, 80, "Hello PDF")
	pdf.SetFont("gofont", "", 40)
	pdf.Text(40, 160, "Unicode text")
	src := image.NewNRGBA(image.Rect(0, 0, 20, 20))
	for i := 0; i < len(src.Pix); i += 4 {
		src.Pix[i], src.Pix[i+1], src.Pix[i+2], src.Pix[i+3] = 0, 0, 255, 255
		if (i/4)%20 >= 10 {
			src.Pix[i+3] = 0
		}
	}
	var pb bytes.Buffer
	png.Encode(&pb, src)
	pdf.RegisterImageOptionsReader("half", fpdf.ImageOptions{ImageType: "PNG"}, &pb)
	pdf.ImageOptions("half", 40, 200, 200, 200, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	pdf.SetDrawColor(255, 0, 0)
	pdf.SetLineWidth(6)
	pdf.Line(40, 450, 400, 450)
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		t.Fatal(err)
	}
	img := renderBytes(t, buf.Bytes(), 1)
	if n := darkCount(img, image.Rect(40, 40, 400, 85)); n < 500 {
		t.Errorf("core font text: %d dark pixels", n)
	}
	if n := darkCount(img, image.Rect(40, 120, 400, 165)); n < 500 {
		t.Errorf("embedded font text: %d dark pixels", n)
	}
	if c := img.RGBAAt(80, 300); !near(c.B, 255, 10) || !near(c.R, 0, 10) {
		t.Errorf("opaque half of the image = %v, want blue", c)
	}
	if c := img.RGBAAt(200, 300); c != (color.RGBA{255, 255, 255, 255}) {
		t.Errorf("transparent half of the image = %v, want white", c)
	}
	if c := img.RGBAAt(200, 450); !near(c.R, 255, 10) || !near(c.G, 0, 10) {
		t.Errorf("line = %v, want red", c)
	}
}
