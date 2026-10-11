package office

/*
	formats.go - which file formats open in which app.

	Each app saves in its own OOXML format and opens that plus the legacy
	binary format of the same kind: Word 97-2003 (.doc / .dot), Excel
	97-2003 (.xls / .xlt) and PowerPoint 97-2003 (.ppt / .pot). A legacy
	file is converted into the app's own format by package doc, xls or ppt
	and then opened like any file another program wrote; the suite never
	writes the legacy formats back.

	A legacy file is recognised by its content, not its name - an OLE2
	compound file holding a "WordDocument", "Workbook" / "Book" or
	"PowerPoint Document" stream - so a misnamed file still opens in the
	right app, and ReadNativeFile accepts one wherever it accepts the
	app's own format.
*/

import (
	"errors"
	"strings"

	"imuslab.com/arozos/mod/office/doc"
	"imuslab.com/arozos/mod/office/internal/cfb"
	"imuslab.com/arozos/mod/office/model"
	"imuslab.com/arozos/mod/office/ppt"
	"imuslab.com/arozos/mod/office/xls"
)

// legacyExts are the Office 97-2003 extensions, by app
var legacyExts = map[string]string{
	".doc": AppDocument, ".dot": AppDocument,
	".xls": AppSpreadsheet, ".xlt": AppSpreadsheet,
	".ppt": AppPresentation, ".pot": AppPresentation, ".pps": AppPresentation,
}

// AppForFile maps an extension the suite can open - its own formats and
// the legacy binary ones it imports - to the app that opens it, or "".
// Use AppForExt for where a document can be saved.
func AppForFile(ext string) string {
	ext = strings.ToLower(ext)
	if app := AppForExt(ext); app != "" {
		return app
	}
	return legacyExts[ext]
}

// IsLegacyExt reports an Office 97-2003 extension (opened by conversion,
// never written)
func IsLegacyExt(ext string) bool {
	_, ok := legacyExts[strings.ToLower(ext)]
	return ok
}

// LegacyApp names the app a legacy binary file belongs to by its content
// ("" when data is not one of the three Office 97-2003 formats)
func LegacyApp(data []byte) string {
	if !cfb.IsCompound(data) {
		return ""
	}
	f, err := cfb.Open(data)
	if err != nil {
		return ""
	}
	switch {
	case f.Has("WordDocument"):
		return AppDocument
	case f.Has("Workbook") || f.Has("Book"):
		return AppSpreadsheet
	case f.Has("PowerPoint Document"):
		return AppPresentation
	}
	return ""
}

// ConvertLegacy converts a Word, Excel or PowerPoint 97-2003 file into the
// app's own format (.docx, .xlsx or .pptx); it returns the app as well
func ConvertLegacy(data []byte) (string, []byte, error) {
	app := LegacyApp(data)
	var out []byte
	var err error
	switch app {
	case AppDocument:
		out, err = doc.ToDocx(data)
	case AppSpreadsheet:
		out, err = xls.ToXlsx(data)
	case AppPresentation:
		out, err = ppt.ToPptx(data)
	default:
		return "", nil, errors.New("not a Word, Excel or PowerPoint 97-2003 file")
	}
	if err != nil {
		return "", nil, err
	}
	return app, out, nil
}

// ImportLegacy converts a legacy binary file straight into the editor body
// JSON of its app
func ImportLegacy(data []byte) (string, string, error) {
	switch LegacyApp(data) {
	case AppDocument:
		d, err := doc.Parse(data)
		if err != nil {
			return "", "", err
		}
		body, err := model.DocumentToJSON(d)
		return AppDocument, body, err
	case AppSpreadsheet:
		wb, err := xls.Parse(data)
		if err != nil {
			return "", "", err
		}
		body, err := model.WorkbookToJSON(wb)
		return AppSpreadsheet, body, err
	case AppPresentation:
		p, err := ppt.Parse(data)
		if err != nil {
			return "", "", err
		}
		body, err := model.PresentationToJSON(p)
		return AppPresentation, body, err
	}
	return "", "", errors.New("not a Word, Excel or PowerPoint 97-2003 file")
}

// legacyKind names a legacy format for messages
func legacyKind(app string) string {
	switch app {
	case AppDocument:
		return "Word 97-2003 document"
	case AppSpreadsheet:
		return "Excel 97-2003 workbook"
	case AppPresentation:
		return "PowerPoint 97-2003 presentation"
	}
	return "file"
}
