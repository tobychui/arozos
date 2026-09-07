/*
Tests for the WebAssembly bridge's conversion table (convert.go).

main.go is js/wasm-only glue, so this is where the bridge's behaviour is
pinned. Each case builds a document, exports it through RunExport and
reads it straight back through the matching RunImport, which checks the
pairing the front end depends on: whatever the web edition writes, the web
edition (and ArozOS, which runs the same mod/office code) can reopen.

The converters themselves are covered in depth by mod/office's own tests;
what is tested here is that the bridge names them correctly, pairs them
correctly, and fails cleanly rather than panicking.
*/
package main

import (
	"encoding/json"
	"strings"
	"testing"
)

const (
	docJSON = `{"html":"<h1>Title</h1><p>Hello <b>world</b> - café 中文</p>",` +
		`"page":{"size":"A4","orientation":"portrait","margins":{"top":20,"right":20,"bottom":20,"left":20}},` +
		`"header":"Head","footer":"Foot","pageNumbers":true,"hfMode":"all"}`

	bookJSON = `{"active":0,"sheets":[{"name":"Data","cells":{` +
		`"A1":{"v":"Item"},"B1":{"v":"Qty"},` +
		`"A2":{"v":"Widget"},"B2":{"v":"3"},` +
		`"A3":{"v":"Total"},"B3":{"v":"=SUM(B2:B2)"}},` +
		`"freeze":{"r":1,"c":0}}]}`

	deckJSON = `{"size":[960,540],"theme":"light","slides":[` +
		`{"id":"s1","bg":"#ffffff","notes":"speaker note","objects":[` +
		`{"type":"text","x":80,"y":100,"w":800,"h":120,"z":1,` +
		`"props":{"html":"<div>Slide one</div>"}}]},` +
		`{"id":"s2","bg":"#ffffff","notes":"","objects":[]}]}`
)

// exportImportPairs is the whole point of the bridge: every writer has a
// reader, under the names the front end asks for.
func TestExportImportRoundTrip(t *testing.T) {
	cases := []struct {
		name     string
		export   string
		imprt    string
		body     string
		verify   func(t *testing.T, gotJSON string)
		wantZip  bool
		skipNote string
	}{
		{
			name: "docx", export: "documentToDocx", imprt: "docxToDocument", body: docJSON,
			verify: func(t *testing.T, got string) {
				var d struct {
					HTML string `json:"html"`
				}
				if err := json.Unmarshal([]byte(got), &d); err != nil {
					t.Fatalf("reimported docx is not document JSON: %v", err)
				}
				if !strings.Contains(d.HTML, "Title") {
					t.Errorf("heading text lost in the docx round trip: %q", d.HTML)
				}
				if !strings.Contains(d.HTML, "café") || !strings.Contains(d.HTML, "中文") {
					t.Errorf("non-ASCII text lost in the docx round trip: %q", d.HTML)
				}
			},
		},
		{
			name: "odt", export: "documentToOdt", imprt: "odtToDocument", body: docJSON,
			verify: func(t *testing.T, got string) {
				if !strings.Contains(got, "Title") {
					t.Errorf("heading text lost in the odt round trip: %s", got)
				}
			},
		},
		{
			name: "xlsx", export: "workbookToXlsx", imprt: "xlsxToWorkbook", body: bookJSON,
			verify: func(t *testing.T, got string) {
				verifyWorkbook(t, "xlsx", got)
			},
		},
		{
			name: "ods", export: "workbookToOds", imprt: "odsToWorkbook", body: bookJSON,
			verify: func(t *testing.T, got string) {
				verifyWorkbook(t, "ods", got)
			},
		},
		{
			name: "pptx", export: "presentationToPptx", imprt: "pptxToPresentation", body: deckJSON,
			verify: func(t *testing.T, got string) {
				verifyDeck(t, "pptx", got)
			},
		},
		{
			name: "odp", export: "presentationToOdp", imprt: "odpToPresentation", body: deckJSON,
			verify: func(t *testing.T, got string) {
				verifyDeck(t, "odp", got)
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, mediaZip, err := RunExport(tc.export, tc.body)
			if err != nil {
				t.Fatalf("RunExport(%s) failed: %v", tc.export, err)
			}
			if len(data) == 0 {
				t.Fatalf("RunExport(%s) produced no bytes", tc.export)
			}
			// every one of these formats is a zip container
			if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
				t.Errorf("RunExport(%s) did not produce a zip: % x", tc.export, data[:4])
			}
			if !tc.wantZip && mediaZip != nil {
				t.Errorf("RunExport(%s) returned an unexpected media sidecar", tc.export)
			}

			got, err := RunImport(tc.imprt, data)
			if err != nil {
				t.Fatalf("RunImport(%s) failed on our own output: %v", tc.imprt, err)
			}
			if !json.Valid([]byte(got)) {
				t.Fatalf("RunImport(%s) did not return valid JSON", tc.imprt)
			}
			tc.verify(t, got)
		})
	}
}

func verifyWorkbook(t *testing.T, format, got string) {
	t.Helper()
	var wb struct {
		Sheets []struct {
			Name  string `json:"name"`
			Cells map[string]struct {
				V string `json:"v"`
			} `json:"cells"`
		} `json:"sheets"`
	}
	if err := json.Unmarshal([]byte(got), &wb); err != nil {
		t.Fatalf("reimported %s is not workbook JSON: %v", format, err)
	}
	if len(wb.Sheets) != 1 {
		t.Fatalf("%s round trip: got %d sheets, want 1", format, len(wb.Sheets))
	}
	if wb.Sheets[0].Name != "Data" {
		t.Errorf("%s round trip: sheet name %q, want \"Data\"", format, wb.Sheets[0].Name)
	}
	if wb.Sheets[0].Cells["A1"].V != "Item" {
		t.Errorf("%s round trip: A1 = %q, want \"Item\"", format, wb.Sheets[0].Cells["A1"].V)
	}
	// the formula must survive as a formula, not as its cached value
	if f := wb.Sheets[0].Cells["B3"].V; !strings.HasPrefix(f, "=") {
		t.Errorf("%s round trip: B3 = %q, want a formula", format, f)
	}
}

func verifyDeck(t *testing.T, format, got string) {
	t.Helper()
	var p struct {
		Slides []struct {
			Objects []struct {
				Type string `json:"type"`
			} `json:"objects"`
		} `json:"slides"`
	}
	if err := json.Unmarshal([]byte(got), &p); err != nil {
		t.Fatalf("reimported %s is not presentation JSON: %v", format, err)
	}
	if len(p.Slides) != 2 {
		t.Fatalf("%s round trip: got %d slides, want 2", format, len(p.Slides))
	}
	if len(p.Slides[0].Objects) == 0 {
		t.Errorf("%s round trip: slide 1 lost its objects", format)
	}
}

// The front end names a converter as a string, so an unknown one must be a
// clean error rather than a nil map lookup.
func TestUnknownConverterNames(t *testing.T) {
	if _, err := RunImport("nopeToDocument", []byte("PK")); err == nil {
		t.Error("RunImport accepted an unknown converter name")
	} else if !strings.Contains(err.Error(), "unknown import converter") {
		t.Errorf("unhelpful error for an unknown importer: %v", err)
	}
	if _, _, err := RunExport("documentToNope", docJSON); err == nil {
		t.Error("RunExport accepted an unknown converter name")
	} else if !strings.Contains(err.Error(), "unknown export converter") {
		t.Errorf("unhelpful error for an unknown exporter: %v", err)
	}
}

func TestEmptyInputIsRejected(t *testing.T) {
	if _, err := RunImport("docxToDocument", nil); err == nil {
		t.Error("RunImport accepted an empty file")
	}
	if _, _, err := RunExport("documentToDocx", ""); err == nil {
		t.Error("RunExport accepted an empty document")
	}
}

// A file that is not what it claims to be is the common case out there (a
// renamed .doc, a truncated download): it must come back as an error.
func TestGarbageInputIsAnError(t *testing.T) {
	garbage := []byte("this is definitely not an office document")
	for name := range Importers {
		if _, err := RunImport(name, garbage); err == nil {
			t.Errorf("RunImport(%s) accepted garbage input", name)
		}
	}
	for name := range Exporters {
		if _, _, err := RunExport(name, "{not json"); err == nil {
			t.Errorf("RunExport(%s) accepted invalid JSON", name)
		}
	}
}

// ConverterNames is what the bridge publishes to the front end; it must
// cover both tables exactly.
func TestConverterNamesCoverBothTables(t *testing.T) {
	in, out := ConverterNames()
	if len(in) != len(Importers) {
		t.Errorf("ConverterNames listed %d importers, table has %d", len(in), len(Importers))
	}
	if len(out) != len(Exporters) {
		t.Errorf("ConverterNames listed %d exporters, table has %d", len(out), len(Exporters))
	}
	for _, n := range in {
		if _, ok := Importers[n]; !ok {
			t.Errorf("ConverterNames listed unknown importer %q", n)
		}
	}
	for _, n := range out {
		if _, ok := Exporters[n]; !ok {
			t.Errorf("ConverterNames listed unknown exporter %q", n)
		}
	}
}

// PDF stays out of this module on purpose - the web edition renders it in
// the front end. This pins the decision so it is a deliberate change if the
// converters are ever added here.
func TestNoPdfConverters(t *testing.T) {
	in, out := ConverterNames()
	for _, n := range append(in, out...) {
		if strings.Contains(strings.ToLower(n), "pdf") {
			t.Errorf("PDF converter %q is in the wasm bridge; PDF is a front-end concern here", n)
		}
	}
}
