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

PDF is deliberately absent. The web edition renders PDF in the front end
(see apps/ArozOS Office Web/README.md); pulling BuildDocPdf and friends
in here would only add fpdf to the module for nothing.
*/
package main

import (
	"errors"

	"imuslab.com/arozos/mod/office"
)

// ImportFunc turns a foreign office file into the body JSON of the matching
// app (the schemas in src/web/Office/README.md).
type ImportFunc func(data []byte) (string, error)

// ExportFunc turns an app's body JSON into a foreign office file. The second
// []byte is the .pptx media sidecar zip - nil for every other format, and
// nil for a deck with no video or audio (see BuildPptxMedia).
type ExportFunc func(jsonStr string) ([]byte, []byte, error)

// Importers are named after the office.* AGI functions they mirror, so a
// call site can name one string for both hosts.
var Importers = map[string]ImportFunc{
	"docxToDocument": func(data []byte) (string, error) {
		doc, err := office.ParseDocx(data)
		if err != nil {
			return "", err
		}
		return office.DocumentToJSON(doc)
	},
	"odtToDocument": func(data []byte) (string, error) {
		doc, err := office.ParseOdt(data)
		if err != nil {
			return "", err
		}
		return office.DocumentToJSON(doc)
	},
	"xlsxToWorkbook": func(data []byte) (string, error) {
		wb, err := office.ParseXlsx(data)
		if err != nil {
			return "", err
		}
		return office.WorkbookToJSON(wb)
	},
	"odsToWorkbook": func(data []byte) (string, error) {
		wb, err := office.ParseOds(data)
		if err != nil {
			return "", err
		}
		return office.WorkbookToJSON(wb)
	},
	"pptxToPresentation": func(data []byte) (string, error) {
		pres, err := office.ParsePptx(data)
		if err != nil {
			return "", err
		}
		return office.PresentationToJSON(pres)
	},
	"odpToPresentation": func(data []byte) (string, error) {
		pres, err := office.ParseOdp(data)
		if err != nil {
			return "", err
		}
		return office.PresentationToJSON(pres)
	},
}

var Exporters = map[string]ExportFunc{
	"documentToDocx": func(jsonStr string) ([]byte, []byte, error) {
		doc, err := office.ParseDocumentJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := office.BuildDocx(doc)
		return data, nil, err
	},
	"documentToOdt": func(jsonStr string) ([]byte, []byte, error) {
		doc, err := office.ParseDocumentJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := office.BuildOdt(doc)
		return data, nil, err
	},
	"workbookToXlsx": func(jsonStr string) ([]byte, []byte, error) {
		wb, err := office.ParseWorkbookJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := office.BuildXlsx(wb)
		return data, nil, err
	},
	"workbookToOds": func(jsonStr string) ([]byte, []byte, error) {
		wb, err := office.ParseWorkbookJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := office.BuildOds(wb)
		return data, nil, err
	},
	"presentationToPptx": func(jsonStr string) ([]byte, []byte, error) {
		pres, err := office.ParsePresentationJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		// nil resolver: a deck reaching this build carries its media as data
		// URLs (the container unpacker inlines them), never as media?file=
		// links into an ArozOS file system that is not there
		return office.BuildPptxMedia(pres, nil)
	},
	"presentationToOdp": func(jsonStr string) ([]byte, []byte, error) {
		pres, err := office.ParsePresentationJSON(jsonStr)
		if err != nil {
			return nil, nil, err
		}
		data, err := office.BuildOdp(pres)
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
