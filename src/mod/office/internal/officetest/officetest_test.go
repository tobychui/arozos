package officetest

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestFixtures(t *testing.T) {
	if b := PngBytes(t); len(b) < 8 || string(b[1:4]) != "PNG" {
		t.Fatalf("PngBytes is not a PNG")
	}
	if u := MakePngDataURL(t, 4, 3); len(u) < 30 || u[:22] != "data:image/png;base64," {
		t.Errorf("MakePngDataURL = %q", u)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("a/b.xml")
	w.Write([]byte("<x/>"))
	zw.Close()
	if got := string(ZipPart(t, buf.Bytes(), "a/b.xml")); got != "<x/>" {
		t.Errorf("ZipPart = %q", got)
	}
	if got := UnzipParts(t, buf.Bytes())["a/b.xml"]; got != "<x/>" {
		t.Errorf("UnzipParts = %q", got)
	}
	wmf := BuildWmf([4]int{0, 0, 100, 100}, 1440)
	if len(wmf) < 22+18 || wmf[0] != 0xD7 || wmf[1] != 0xCD {
		t.Errorf("BuildWmf does not start with the placeable header")
	}
	emf := BuildEmf(10, 10)
	if len(emf) < 88 || emf[0] != 1 {
		t.Errorf("BuildEmf does not start with an EMR_HEADER")
	}
}
