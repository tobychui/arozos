package metadata

import (
	"bytes"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-pdf/fpdf"
)

// writeTestPDF writes a one page A4 PDF with a red band across its top
func writeTestPDF(t *testing.T, path string) {
	t.Helper()
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.AddPage()
	pdf.SetFillColor(255, 0, 0)
	pdf.Rect(0, 0, 595, 60, "F")
	pdf.SetFont("Helvetica", "B", 36)
	pdf.Text(40, 140, "Quarterly report")
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		t.Fatalf("build pdf: %v", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatalf("write pdf: %v", err)
	}
}

func TestGenerateThumbnailForPDF(t *testing.T) {
	tests := []struct {
		name         string
		write        func(t *testing.T, path string)
		generateOnly bool
		wantErr      bool
	}{
		{"renders the first page", writeTestPDF, false, false},
		{"generate only returns nothing", writeTestPDF, true, false},
		{"not a pdf", func(t *testing.T, path string) { os.WriteFile(path, []byte("plain text"), 0644) }, false, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fsh, dir := newTestFSH(t)
			cacheDir := filepath.Join(dir, "cache") + "/"
			if err := os.MkdirAll(cacheDir, 0755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			src := filepath.Join(dir, "report.pdf")
			tc.write(t, src)

			b64, err := generateThumbnailForPDF(fsh, cacheDir, src, tc.generateOnly)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("generateThumbnailForPDF: %v", err)
			}
			if tc.generateOnly != (b64 == "") {
				t.Errorf("generateOnly=%v but returned %d base64 bytes", tc.generateOnly, len(b64))
			}
			f, err := os.Open(filepath.Join(cacheDir, "report.pdf.jpg"))
			if err != nil {
				t.Fatalf("thumbnail cache file missing: %v", err)
			}
			defer f.Close()
			img, err := jpeg.Decode(f)
			if err != nil {
				t.Fatalf("decode thumbnail: %v", err)
			}
			if b := img.Bounds(); b.Dx() != 480 || b.Dy() != 480 {
				t.Errorf("thumbnail size = %v, want 480x480", b)
			}
			//A portrait page is shown from the top: the red band is there
			r, g, _, _ := img.At(240, 10).RGBA()
			if r>>8 < 200 || g>>8 > 60 {
				t.Errorf("top of the thumbnail = %d,%d, want the red band", r>>8, g>>8)
			}
		})
	}
}

func TestGenerateThumbnailForPDF_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	if _, err := generateThumbnailForPDF(fsh, dir+"/", filepath.Join(dir, "missing.pdf"), false); err == nil {
		t.Error("expected an error for a missing file")
	}
}

func TestGenerateThumbnailForPDF_RequireBuffer(t *testing.T) {
	fsh, dir := newTestFSH(t)
	fsh.RequireBuffer = true
	result, err := generateThumbnailForPDF(fsh, dir+"/", filepath.Join(dir, "report.pdf"), false)
	if err != nil || result != "" {
		t.Errorf("RequireBuffer: got %q, %v; want an empty result", result, err)
	}
}

func TestRenderThumbnailDispatchesPDF(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	os.MkdirAll(cacheDir, 0755)
	src := filepath.Join(dir, "Report.PDF")
	writeTestPDF(t, src)
	if _, err := renderThumbnail(fsh, cacheDir, src, true); err != nil {
		t.Fatalf("renderThumbnail: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "Report.PDF.jpg")); err != nil {
		t.Errorf("thumbnail cache file missing: %v", err)
	}
}
