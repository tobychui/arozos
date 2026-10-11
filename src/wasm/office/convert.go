/*
Office format converters for the WebAssembly bridge
===================================================

The conversion table the browser build exposes. It lives in its own file
with no build constraint and no syscall/js import for two reasons:

  - it is the part with actual behaviour, so it can be table-tested by
    `go test ./...` on any platform (main.go is js/wasm-only glue that
    just walks these maps);
  - it documents, in one place, exactly which of mod/office's converters
    the standalone web edition can run.

Everything here is a pure []byte/string transformation - mod/office does
no file I/O and keeps no globals, which is what makes running it in a
browser possible at all.

The suite's own documents are .docx / .xlsx / .pptx (mod/office native.go),
so the three "<app>File" converters are what every open and save of the
web edition runs: in, a file becomes the editor envelope (the embedded copy
when it is current, an import otherwise); out, the envelope becomes the
file. The per-format body converters beside them serve the other formats
(ODF) and keep the table symmetrical with the office.* AGI library.

The Office 97-2003 formats (.doc / .xls / .ppt) are import only. The three
"<app>File" importers take them as they are - office.ReadNativeFile
converts a legacy file into OOXML first - and docToDocument and friends
give their body JSON directly.

PDF is deliberately absent. The web edition renders PDF in the front end
(see apps/arozos_office/README.md); pulling pdf.BuildDoc and friends
in here would only add fpdf to the module for nothing.
*/
package main

import (
	"errors"

	"imuslab.com/arozos/mod/office"
	"imuslab.com/arozos/mod/office/doc"
	"imuslab.com/arozos/mod/office/docx"
	"imuslab.com/arozos/mod/office/model"
	"imuslab.com/arozos/mod/office/odf"
	"imuslab.com/arozos/mod/office/ppt"
	"imuslab.com/arozos/mod/office/pptx"
	"imuslab.com/arozos/mod/office/xls"
	"imuslab.com/arozos/mod/office/xlsx"
)

// ImportFunc turns a foreign office file into the body JSON of the matching
// app (the schemas in src/web/Office/README.md).
type ImportFunc func(data []byte) (string, error)

// ExportFunc turns an app's body JSON into a foreign office file. The second
// []byte is the .pptx media sidecar zip - nil for every other format, and
// nil for a deck with no video or audio (see pptx.BuildMedia).
type ExportFunc func(jsonStr string) ([]byte, []byte, error)

// nativeImport / nativeExport are the suite's own open and save. Media
// stays inline as data URLs: there is no file system here to link into.
func nativeImport(app string) ImportFunc {
	return func(data []byte) (string, error) {
		return office.ReadNativeFile(app, data, nil)
	}
}

func nativeExport(app string) ExportFunc {
	return func(envelope string) ([]byte, []byte, error) {
		data, err := office.BuildNativeFile(app, envelope, nil)
		return data, nil, err
	}
}

// Importers are named after the office.* AGI functions they mirror, so a
// call site can name one string for both hosts.
var Importers = map[string]ImportFunc{
	"documentFile":     nativeImport(office.AppDocument),
	"spreadsheetFile":  nativeImport(office.AppSpreadsheet),
	"presentationFile": nativeImport(office.AppPresentation),

	"docxToDocument": func(data []byte) (string, error) {
		doc, err := docx.Parse(data)
		if err != nil {
			return "", err
		}
		return model.DocumentToJSON(doc)
	},
	"docToDocument": func(data []byte) (string, error) {
		d, err := doc.Parse(data)
		if err != nil {
			return "", err
		}
		return model.DocumentToJSON(d)
	},
	"xlsToWorkbook": func(data []byte) (string, error) {
		wb, err := xls.Parse(data)
		if err != nil {
			return "", err
		}
		return model.WorkbookToJSON(wb)
	},
	"pptToPresentation": func(data []byte) (string, error) {
		p, err := ppt.Parse(data)
		if err != nil {
			return "", err
		}
		return model.PresentationToJSON(p)
	},
	"odtToDocument": func(data []byte) (string, error) {
		doc, err := odf.ParseOdt(data)
		if err != nil {
			return "", err
		}
		return model.DocumentToJSON(doc)
	},
	"xlsxToWorkbook": func(data []byte) (string, error) {
		wb, err := xlsx.Parse(data)
		if err != nil {
			return "", err
		}
		return model.WorkbookToJSON(wb)
	},
	"odsToWorkbook": func(data []byte) (string, error) {
		wb, err := odf.ParseOds(data)
		if err != nil {
			return "", err
		}
		return model.WorkbookToJSON(wb)
	},
	"pptxToPresentation": func(data []byte) (string, error) {
		pres, err := pptx.Parse(data)
		if err != nil {
			return "", err
		}
		return model.PresentationToJSON(pres)
	},
	"odpToPresentation": func(data []byte) (string, error) {
		pres, err := odf.ParseOdp(data)
		if err != nil {
			return "", err
		}
		return model.PresentationToJSON(pres)
	},
}

var Exporters = map[string]ExportFunc{
	"documentFile":     nativeExport(office.AppDocument),
	"spreadsheetFile":  nativeExport(office.AppSpreadsheet),
	"presentationFile": nativeExport(office.AppPresentation),

	"documentToDocx": func(jsonStr string) ([]byte, []byte, error) {
		doc, err := model.ParseDocumentJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := docx.Build(doc)
		return data, nil, err
	},
	"documentToOdt": func(jsonStr string) ([]byte, []byte, error) {
		doc, err := model.ParseDocumentJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := odf.BuildOdt(doc)
		return data, nil, err
	},
	"workbookToXlsx": func(jsonStr string) ([]byte, []byte, error) {
		wb, err := model.ParseWorkbookJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := xlsx.Build(wb)
		return data, nil, err
	},
	"workbookToOds": func(jsonStr string) ([]byte, []byte, error) {
		wb, err := model.ParseWorkbookJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := odf.BuildOds(wb)
		return data, nil, err
	},
	"presentationToPptx": func(jsonStr string) ([]byte, []byte, error) {
		pres, err := model.ParsePresentationJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		// nil resolver: a deck reaching this build carries its media as data
		// URLs, never as media?file= links into an ArozOS file system that
		// is not there
		return pptx.BuildMedia(pres, nil)
	},
	"presentationToOdp": func(jsonStr string) ([]byte, []byte, error) {
		pres, err := model.ParsePresentationJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := odf.BuildOdp(pres)
		return data, nil, err
	},
}

// RunImport and RunExport are the single entry points main.go bridges, so
// an unknown name fails the same way on both sides of the wire.
func RunImport(name string, data []byte) (string, error) {
	fn, ok := Importers[name]
	if !ok {
		return "", errors.New("unknown import converter: " + name)
	}
	if len(data) == 0 {
		return "", errors.New("no file content to convert")
	}
	return fn(data)
}

func RunExport(name string, jsonStr string) ([]byte, []byte, error) {
	fn, ok := Exporters[name]
	if !ok {
		return nil, nil, errors.New("unknown export converter: " + name)
	}
	if jsonStr == "" {
		return nil, nil, errors.New("no document to convert")
	}
	return fn(jsonStr)
}

// ConverterNames lists what this build can do, for the bridge to publish so
// the front end never has to hardcode the list.
func ConverterNames() ([]string, []string) {
	var in, out []string
	for k := range Importers {
		in = append(in, k)
	}
	for k := range Exporters {
		out = append(out, k)
	}
	return in, out
}
