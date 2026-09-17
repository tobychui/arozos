package office

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
	Golden-file dump for the Sheets formula engine.

	Formulas saved by Excel or Google Sheets carry the value the app
	calculated (<v>). This test turns every .xlsx in $OFFICE_GOLDEN_DIR into
	<name>.golden.json holding the parsed workbook plus those cached values;
	web/Office/sheets/test_golden.js then recalculates every formula with the
	JavaScript engine and reports where it disagrees:

		OFFICE_GOLDEN_DIR=/path/to/xlsx go test ./mod/office/ -run TestGoldenDump
		node web/Office/sheets/test_golden.js /path/to/xlsx

	Skipped when the variable is unset.
*/

type goldenFile struct {
	Workbook *Workbook                       `json:"workbook"`
	Cached   map[string]map[string][2]string `json:"cached"` // sheet -> ref -> [type, value]
}

func TestGoldenDump(t *testing.T) {
	dir := os.Getenv("OFFICE_GOLDEN_DIR")
	if dir == "" {
		t.Skip("OFFICE_GOLDEN_DIR not set")
	}
	paths, _ := filepath.Glob(filepath.Join(dir, "*.xlsx"))
	if len(paths) == 0 {
		t.Fatalf("no .xlsx files in %s", dir)
	}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("read %s: %v", p, err)
		}
		wb, err := ParseXlsx(data)
		if err != nil {
			t.Fatalf("parse %s: %v", p, err)
		}
		cached, err := xlsxCachedFormulaValues(data)
		if err != nil {
			t.Fatalf("cached values of %s: %v", p, err)
		}
		out, _ := json.Marshal(goldenFile{Workbook: wb, Cached: cached})
		dest := strings.TrimSuffix(p, filepath.Ext(p)) + ".golden.json"
		if err := os.WriteFile(dest, out, 0644); err != nil {
			t.Fatalf("write %s: %v", dest, err)
		}
		t.Logf("%s: %d sheets", dest, len(wb.Sheets))
	}
}

// xlsxCachedFormulaValues reads the stored result of every formula cell
func xlsxCachedFormulaValues(data []byte) (map[string]map[string][2]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		buf := new(bytes.Buffer)
		buf.ReadFrom(rc)
		rc.Close()
		files[f.Name] = buf.Bytes()
	}
	wbTree, err := parseXMLTree(files["xl/workbook.xml"])
	if err != nil {
		return nil, err
	}
	rels := parseRels(files["xl/_rels/workbook.xml.rels"])
	shared := parseSharedStrings(files["xl/sharedStrings.xml"])
	out := map[string]map[string][2]string{}
	sheets := wbTree.first("sheets")
	if sheets == nil {
		return out, nil
	}
	for _, sn := range sheets.all("sheet") {
		rid := ""
		for _, a := range sn.Attrs {
			if a.Name.Local == "id" {
				rid = a.Value
			}
		}
		tree, err := parseXMLTree(files[resolvePartPath("xl", rels[rid])])
		if err != nil {
			continue
		}
		vals := map[string][2]string{}
		if sd := tree.first("sheetData"); sd != nil {
			for _, row := range sd.all("row") {
				for _, c := range row.all("c") {
					if c.first("f") == nil {
						continue
					}
					typ, v := c.attr("t"), ""
					if vn := c.first("v"); vn != nil {
						v = vn.Text
					}
					if typ == "" {
						typ = "n"
					}
					if typ == "s" {
						if i, err := jsonIndex(v); err == nil && i < len(shared) {
							v = shared[i]
						}
						typ = "str"
					}
					vals[c.attr("r")] = [2]string{typ, v}
				}
			}
		}
		out[sn.attr("name")] = vals
	}
	return out, nil
}

func jsonIndex(s string) (int, error) {
	var i int
	err := json.Unmarshal([]byte(strings.TrimSpace(s)), &i)
	return i, err
}
