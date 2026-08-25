package office

/*
	pdf.go - shared plumbing for the server-side PDF exporters
	(pdf_doc.go / pdf_sheet.go / pdf_slides.go).

	Built on github.com/go-pdf/fpdf (MIT). Text is written as REAL text
	objects (selectable / editable in PDF editors), not page screenshots.
	The core PDF fonts are Latin-1 (cp1252): characters outside that set
	are transliterated by fpdf's unicode translator and may degrade -
	embedding a full Unicode font is a deliberate non-goal for now (it
	would grow the binary by megabytes).
*/

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/go-pdf/fpdf"
)

const pxToMM = 25.4 / 96.0

// pdfSetFillHex / pdfSetTextHex apply "#rrggbb" (or rgb()) colors
func pdfColor(c string) (int, int, int, bool) {
	hexv := cssColorHex(c)
	if len(hexv) != 6 {
		return 0, 0, 0, false
	}
	var r, g, b int
	if _, err := fmt.Sscanf(hexv, "%02X%02X%02X", &r, &g, &b); err != nil {
		return 0, 0, 0, false
	}
	return r, g, b, true
}

func pdfSetTextHex(pdf *fpdf.Fpdf, c string, defR, defG, defB int) {
	if r, g, b, ok := pdfColor(c); ok {
		pdf.SetTextColor(r, g, b)
	} else {
		pdf.SetTextColor(defR, defG, defB)
	}
}

func pdfSetFillHex(pdf *fpdf.Fpdf, c string) bool {
	if r, g, b, ok := pdfColor(c); ok {
		pdf.SetFillColor(r, g, b)
		return true
	}
	return false
}

func pdfSetDrawHex(pdf *fpdf.Fpdf, c string) {
	if r, g, b, ok := pdfColor(c); ok {
		pdf.SetDrawColor(r, g, b)
	} else {
		pdf.SetDrawColor(102, 102, 102)
	}
}

// pdfStyleStr builds fpdf's font style string
func pdfStyleStr(b, i, u bool) string {
	s := ""
	if b {
		s += "B"
	}
	if i {
		s += "I"
	}
	if u {
		s += "U"
	}
	return s
}

// pdfImageFromDataURL registers a data-URL image under a unique name and
// returns (name, imageType, ok)
func pdfImageFromDataURL(pdf *fpdf.Fpdf, src string, seq *int) (string, string, bool) {
	data, ext, ok := decodeDataURL(src)
	if !ok {
		return "", "", false
	}
	imgType := map[string]string{"png": "PNG", "jpeg": "JPG", "gif": "GIF"}[ext]
	if imgType == "" {
		return "", "", false
	}
	*seq++
	name := fmt.Sprintf("img%d", *seq)
	pdf.RegisterImageOptionsReader(name,
		fpdf.ImageOptions{ImageType: imgType}, bytes.NewReader(data))
	if pdf.Err() {
		return "", "", false
	}
	return name, imgType, true
}

// pdfOutput finalizes the document into bytes
func pdfOutput(pdf *fpdf.Fpdf) ([]byte, error) {
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// pdfNbsp normalizes non-breaking / typographic spaces to plain spaces:
// contenteditable HTML is full of &nbsp;, and fpdf only wraps lines at
// real spaces, so leaving them in causes early / mid-word line breaks
var pdfNbsp = strings.NewReplacer(
	" ", " ", // no-break space (&nbsp;)
	" ", " ", // figure space
	" ", " ", // thin space
	" ", " ") // narrow no-break space

// pdfTr returns fpdf's UTF-8 -> cp1252 translator for core fonts
func pdfTr(pdf *fpdf.Fpdf) func(string) string {
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	return func(s string) string {
		return tr(pdfNbsp.Replace(s))
	}
}

// pdfFitText trims s to what fits in maxW at the CURRENT font, ending it with
// an ellipsis when anything was cut, and returns it translated ready to draw.
//
// fpdf's CellFormat does not clip: a string wider than its cell is drawn
// straight across the neighbouring ones. A spreadsheet column is exactly as
// wide as the sheet says it is, so overlong cells have to be shortened here
// the way the on-screen grid hides them with overflow:hidden.
//
// Widths are measured on the translated text (that is what actually gets
// drawn) while the cut is made on runes of the original, so a multi-byte
// character is never split in half.
func pdfFitText(pdf *fpdf.Fpdf, tr func(string) string, s string, maxW float64) string {
	if s == "" || maxW <= 0 {
		return ""
	}
	full := tr(s)
	if pdf.GetStringWidth(full) <= maxW {
		return full
	}
	ell := tr("…")
	if pdf.GetStringWidth(ell) <= 0 {
		ell = tr("...") // cp1252 has an ellipsis, but never depend on it
	}
	ellW := pdf.GetStringWidth(ell)
	if ellW > maxW {
		return "" // column too narrow even for the marker: draw nothing
	}
	// longest prefix that still leaves room for the ellipsis; prefix width
	// grows with length, so a binary search finds it directly
	runes := []rune(s)
	lo, hi := 0, len(runes)
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if pdf.GetStringWidth(tr(string(runes[:mid])))+ellW <= maxW {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	if lo == 0 {
		return ell // not even one character fits alongside it
	}
	return tr(string(runes[:lo])) + ell
}
