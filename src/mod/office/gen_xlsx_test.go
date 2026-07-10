package office

// Temporary interop harness (not committed): writes a generated xlsx to
// OFFICE_XLSX_OUT and parses OFFICE_XLSX_IN when the env vars are set.

import (
	"encoding/json"
	"os"
	"testing"
)

func TestGenXlsxInterop(t *testing.T) {
	out := os.Getenv("OFFICE_XLSX_OUT")
	if out != "" {
		data, err := BuildXlsx(sampleWorkbook())
		if err != nil {
			t.Fatalf("BuildXlsx: %v", err)
		}
		if err := os.WriteFile(out, data, 0644); err != nil {
			t.Fatalf("write: %v", err)
		}
		t.Logf("wrote %d bytes to %s", len(data), out)
	}
	in := os.Getenv("OFFICE_XLSX_IN")
	if in != "" {
		raw, err := os.ReadFile(in)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		wb, err := ParseXlsx(raw)
		if err != nil {
			t.Fatalf("ParseXlsx on external file: %v", err)
		}
		js, _ := json.MarshalIndent(wb, "", " ")
		t.Logf("parsed external xlsx: %d sheets\n%s", len(wb.Sheets), string(js))
	}
}
