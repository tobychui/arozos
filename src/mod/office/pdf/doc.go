/*
Package pdf renders the editors' documents into PDF with real, selectable
text (github.com/go-pdf/fpdf, MIT):

	BuildDoc    a Docs model.Document, paginated the way the editor lays
	            out its pages (document.go)
	BuildSheet  the print model the Sheets client computes - formatted
	            display strings and styles, since formulas are evaluated
	            in the browser (sheet.go)

Slides renders its PDF in the browser, where the text layout is known.
*/
package pdf
