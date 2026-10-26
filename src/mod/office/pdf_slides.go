package office

/*
	pdf_slides.go - Build a PDF from a Slides Presentation with REAL text.

	One landscape page per slide, page size matching the deck's pixel
	canvas (960x540 by default). Text boxes, shapes with captions and
	tables are written as selectable text; images and charts are embedded
	from their client-inlined data URLs; video/audio placeholders are
	drawn with the shared poster frame.
*/

import (
	"bytes"
	"sort"
	"strings"

	"github.com/go-pdf/fpdf"
)

// BuildSlidesPdf renders a Presentation into PDF bytes
func BuildSlidesPdf(p *Presentation) ([]byte, error) {
	wPx, hPx := 960.0, 540.0
	if len(p.Size) == 2 && p.Size[0] > 0 && p.Size[1] > 0 {
		wPx, hPx = float64(p.Size[0]), float64(p.Size[1])
	}
	wMM, hMM := wPx*pxToMM, hPx*pxToMM
	// pass "P" with explicit dims: fpdf swaps Wd/Ht itself on "L"
	pdf := fpdf.NewCustom(&fpdf.InitType{
		OrientationStr: "P", UnitStr: "mm",
		Size: fpdf.SizeType{Wd: wMM, Ht: hMM},
	})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	tr := pdfTr(pdf)
	imgSeq := 0
	posterRegistered := false

	for _, slide := range p.Slides {
		pdf.AddPage()
		bg := slide.Bg
		if bg == "" {
			bg = "#" + themeBgColor(p.Theme)
		}
		if pdfSetFillHex(pdf, bg) {
			pdf.Rect(0, 0, wMM, hMM, "F")
		}

		objs := append([]*Object(nil), slide.Objects...)
		sort.SliceStable(objs, func(i, j int) bool { return objs[i].Z < objs[j].Z })
		for _, o := range objs {
			x, y := o.X*pxToMM, o.Y*pxToMM
			w, h := o.W*pxToMM, o.H*pxToMM
			switch o.Type {
			case "text":
				slidePdfText(pdf, tr, o, p.Theme, x, y, w)
			case "image", "chart":
				src := o.Props.Src
				if o.Type == "chart" {
					src = o.Props.Png
				}
				if name, _, ok := pdfImageFromDataURL(pdf, src, &imgSeq); ok {
					pdf.ImageOptions(name, x, y, w, h, false, fpdf.ImageOptions{}, 0, "")
				}
			case "shape":
				slidePdfShape(pdf, tr, o, x, y, w, h)
			case "line":
				slidePdfLine(pdf, o, x, y, w, h)
			case "table":
				slidePdfTable(pdf, tr, o, x, y, w, h)
			case "video", "audio":
				// prefer the client-captured video frame (props.png)
				if name, _, ok := pdfImageFromDataURL(pdf, o.Props.Png, &imgSeq); ok {
					pdf.ImageOptions(name, x, y, w, h, false, fpdf.ImageOptions{}, 0, "")
					continue
				}
				if !posterRegistered {
					pdf.RegisterImageOptionsReader("of-media-poster",
						fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(mediaPosterPNG()))
					posterRegistered = true
				}
				pdf.ImageOptions("of-media-poster", x, y, w, h, false, fpdf.ImageOptions{}, 0, "")
			}
		}
	}
	if pdf.Err() {
		return nil, pdf.Error()
	}
	return pdfOutput(pdf)
}

func slidePdfText(pdf *fpdf.Fpdf, tr func(string) string, o *Object, theme string, x, y, w float64) {
	p := o.Props
	fs := p.FontSize
	if fs <= 0 {
		fs = 18
	}
	sizePt := fs * 0.75 // css px -> pt
	color := p.Color
	if color == "" {
		color = "#" + themeTextColor(theme)
	}
	align := map[string]string{"center": "C", "right": "R"}[p.Align]
	if align == "" {
		align = "L"
	}
	pdf.SetFont("Arial", pdfStyleStr(p.Bold, p.Italic, p.Underline), sizePt)
	pdfSetTextHex(pdf, color, 32, 33, 36)
	lineH := fs * 1.3 * pxToMM
	pdf.SetXY(x, y)
	pdf.MultiCell(w, lineH, tr(strings.Join(htmlToLines(p.HTML), "\n")), "", align, false)
}

func slidePdfShape(pdf *fpdf.Fpdf, tr func(string) string, o *Object, x, y, w, h float64) {
	p := o.Props
	fill := pdfSetFillHex(pdf, p.Fill)
	stroke := p.StrokeW > 0
	if stroke {
		pdfSetDrawHex(pdf, p.Stroke)
		pdf.SetLineWidth(p.StrokeW * pxToMM)
	}
	mode := "F"
	if stroke && fill {
		mode = "FD"
	} else if stroke {
		mode = "D"
	} else if !fill {
		mode = ""
	}
	if mode != "" {
		switch p.Kind {
		case "ellipse", "circle":
			pdf.Ellipse(x+w/2, y+h/2, w/2, h/2, 0, mode)
		case "round", "rounded":
			r := minFloat(w, h) * 0.12
			pdf.RoundedRect(x, y, w, h, r, "1234", mode)
		default:
			pdf.Rect(x, y, w, h, mode)
		}
	}
	if txt := strings.TrimSpace(p.Text); txt != "" {
		fs := p.FontSize
		if fs <= 0 {
			fs = 18
		}
		tc := p.TextColor
		if tc == "" {
			tc = "#FFFFFF"
		}
		pdf.SetFont("Arial", pdfStyleStr(p.Bold, false, false), fs*0.75)
		pdfSetTextHex(pdf, tc, 255, 255, 255)
		lineH := fs * 1.3 * pxToMM
		lines := strings.Split(txt, "\n")
		totalH := float64(len(lines)) * lineH
		pdf.SetXY(x, y+(h-totalH)/2)
		pdf.MultiCell(w, lineH, tr(txt), "", "C", false)
	}
}

func slidePdfLine(pdf *fpdf.Fpdf, o *Object, x, y, w, h float64) {
	p := o.Props
	sw := p.StrokeW
	if sw <= 0 {
		sw = 2
	}
	pdfSetDrawHex(pdf, p.Stroke)
	pdf.SetLineWidth(sw * pxToMM)
	if p.Dash {
		pdf.SetDashPattern([]float64{2, 1.5}, 0)
	}
	pdf.Line(x, y, x+w, y+h)
	if p.Dash {
		pdf.SetDashPattern([]float64{}, 0)
	}
}

func slidePdfTable(pdf *fpdf.Fpdf, tr func(string) string, o *Object, x, y, w, h float64) {
	p := o.Props
	if len(p.Rows) == 0 {
		return
	}
	cols := len(p.Rows[0])
	if cols == 0 {
		return
	}
	colW := make([]float64, cols)
	if len(p.ColW) == cols {
		for i, pct := range p.ColW {
			colW[i] = w * pct / 100
		}
	} else {
		for i := range colW {
			colW[i] = w / float64(cols)
		}
	}
	rowH := make([]float64, len(p.Rows))
	if len(p.RowH) == len(p.Rows) {
		for i, pct := range p.RowH {
			rowH[i] = h * pct / 100
		}
	} else {
		for i := range rowH {
			rowH[i] = h / float64(len(p.Rows))
		}
	}
	pdf.SetDrawColor(160, 160, 160)
	pdf.SetLineWidth(0.25)
	cy := y
	for r, row := range p.Rows {
		cx := x
		head := p.HeaderRow && r == 0
		for c := 0; c < cols && c < len(row); c++ {
			if head {
				pdf.SetFillColor(52, 86, 138)
				pdf.Rect(cx, cy, colW[c], rowH[r], "FD")
				pdf.SetTextColor(255, 255, 255)
				pdf.SetFont("Arial", "B", 10.5)
			} else {
				pdf.SetFillColor(255, 255, 255)
				pdf.Rect(cx, cy, colW[c], rowH[r], "FD")
				pdf.SetTextColor(32, 33, 36)
				pdf.SetFont("Arial", "", 10.5)
			}
			txt := tr(strings.TrimSpace(row[c]))
			if txt != "" {
				pdf.SetXY(cx+1.2, cy+(rowH[r]-4.6)/2)
				pdf.CellFormat(colW[c]-2.4, 4.6, txt, "", 0, "L", false, 0, "")
			}
			cx += colW[c]
		}
		cy += rowH[r]
	}
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
