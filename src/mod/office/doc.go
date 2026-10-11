/*
Package office converts between the ArozOS Office suite (the Docs, Sheets
and Slides webapps in src/web/Office) and office file formats.

This package is the front door: it opens and saves the suite's own files -
.docx, .xlsx and .pptx with the editor's copy embedded (native.go) - keeps
the snapshot containers the editors use for sessions (packed.go), and maps
every format the suite can open onto the converter that reads it
(formats.go). Each file format lives in a package of its own:

	model     the editor document models: the Docs, Sheets and Slides
	          body JSON and the helpers that belong to them
	docx      Word 2007+ (.docx) import and export
	xlsx      Excel 2007+ (.xlsx) import and export
	pptx      PowerPoint 2007+ (.pptx) import and export
	odf       OpenDocument (.odt / .ods / .odp) import and export
	doc       Word 97-2003 (.doc) import, by conversion to .docx
	xls       Excel 97-2003 (.xls) import, by conversion to .xlsx
	ppt       PowerPoint 97-2003 (.ppt) import, by conversion to .pptx
	pdf       real-text PDF export of documents and sheet print models
	metafile  WMF / EMF pictures rendered into something a browser shows

with the plumbing they share under internal/: the OOXML tree and package
relationships (xmltree), data URLs and media links (media), the editors'
HTML (htmlutil), unit conversions (units), font naming (fonts), the Slides
text model (slidetext), test fixtures (officetest), and for the legacy
binary formats the OLE2 compound file reader (cfb), the Office drawing
records (officeart), Windows code pages (codepage) and the writer of the
OOXML packages they convert into (opc).

Everything is a pure []byte / string transformation with no file I/O and
no globals, which is what lets the same code run behind the "office" AGI
library (src/mod/agi/agi.office.go) and, compiled to WebAssembly, in the
standalone web edition (src/wasm/office).

Author: tobychui
*/
package office
