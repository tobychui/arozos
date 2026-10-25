package pdfrender

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"testing"
)

/*
	Test helpers: a tiny PDF writer for hand made fixtures, and pixel checks.
*/

type pdfBuilder struct {
	objs [][]byte
	//Extra trailer entries
	trailer string
}

// add stores an object body and returns its number
func (b *pdfBuilder) add(body string) int {
	b.objs = append(b.objs, []byte(body))
	return len(b.objs)
}

// reserve allocates an object number filled in later with set
func (b *pdfBuilder) reserve() int {
	b.objs = append(b.objs, nil)
	return len(b.objs)
}

func (b *pdfBuilder) set(num int, body string) {
	b.objs[num-1] = []byte(body)
}

// stream builds a stream object body
func streamBody(dict string, data []byte) string {
	return fmt.Sprintf("<< %s /Length %d >>\nstream\n%s\nendstream", dict, len(data), data)
}

func (b *pdfBuilder) addStream(dict string, data []byte) int {
	return b.add(streamBody(dict, data))
}

// bytes writes the file with a classic xref table
func (b *pdfBuilder) bytes(root int) []byte {
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
	offsets := make([]int, len(b.objs))
	for i, o := range b.objs {
		offsets[i] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", len(b.objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root %d 0 R %s >>\nstartxref\n%d\n%%%%EOF\n", len(b.objs)+1, root, b.trailer, xref)
	return buf.Bytes()
}

// onePage builds a single page document of w x h points
func onePage(w, h int, resources string, content string, extra func(b *pdfBuilder) string) []byte {
	b := &pdfBuilder{}
	pagesNum := b.reserve()
	contentNum := b.addStream("", []byte(content))
	//Objects 1-3 are fixed, so fixtures can refer to their own from 4 on
	pageNum := b.reserve()
	pageExtra := ""
	if extra != nil {
		pageExtra = extra(b)
	}
	b.set(pageNum, fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Resources << %s >> /Contents %d 0 R %s >>", pagesNum, w, h, resources, contentNum, pageExtra))
	b.set(pagesNum, fmt.Sprintf("<< /Type /Pages /Kids [%d 0 R] /Count 1 >>", pageNum))
	root := b.add(fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pagesNum))
	return b.bytes(root)
}

// renderBytes renders page 0 at the given scale
func renderBytes(t *testing.T, data []byte, scale float64) *image.RGBA {
	t.Helper()
	doc, err := Open(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	img, err := doc.Render(0, Options{Scale: scale})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	return img
}

// at reads a pixel in PDF coordinates (origin bottom left) of a page of
// height h rendered at scale 1
func pixelAt(img *image.RGBA, x, y, h int) color.RGBA {
	return img.RGBAAt(x, h-1-y)
}

func near(a, b uint8, tol int) bool {
	d := int(a) - int(b)
	return d >= -tol && d <= tol
}

func assertColor(t *testing.T, img *image.RGBA, x, y, h int, want color.RGBA, tol int, what string) {
	t.Helper()
	got := pixelAt(img, x, y, h)
	if !near(got.R, want.R, tol) || !near(got.G, want.G, tol) || !near(got.B, want.B, tol) {
		t.Errorf("%s: pixel (%d,%d) = %v, want %v", what, x, y, got, want)
	}
}

// darkCount counts pixels darker than mid grey in a device rectangle
func darkCount(img *image.RGBA, r image.Rectangle) int {
	n := 0
	r = r.Intersect(img.Bounds())
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			c := img.RGBAAt(x, y)
			if int(c.R)+int(c.G)+int(c.B) < 3*128 {
				n++
			}
		}
	}
	return n
}

var (
	white = color.RGBA{255, 255, 255, 255}
	black = color.RGBA{0, 0, 0, 255}
	red   = color.RGBA{255, 0, 0, 255}
	green = color.RGBA{0, 255, 0, 255}
	blue  = color.RGBA{0, 0, 255, 255}
)
