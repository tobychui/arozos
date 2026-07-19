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

// pdfSplitTr wraps text that has already been passed through the cp1252
// translator. fpdf.SplitText indexes a 256-glyph width table by rune and
// panics on runes outside it, so the translated bytes are promoted to
// runes for splitting and demoted back to bytes afterwards.
func pdfSplitTr(pdf *fpdf.Fpdf, trText string, w float64) []string {
	rs := make([]rune, len(trText))
	for i := 0; i < len(trText); i++ {
		rs[i] = rune(trText[i])
	}
	var out []string
	for _, ln := range pdf.SplitText(string(rs), w) {
		b := make([]byte, 0, len(ln))
		for _, r := range ln {
			b = append(b, byte(r))
		}
		out = append(out, string(b))
	}
	return out
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

// htmlPlainText flattens an HTML fragment into plain text lines (used for
// table cells and similar single-block content)
func htmlPlainText(h string) string {
	return strings.Join(htmlToLines(h), "\n")
}
