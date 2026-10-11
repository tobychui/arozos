package xlsx

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/xmltree"
	"imuslab.com/arozos/mod/office/model"
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
	Workbook *model.Workbook                 `json:"workbook"`
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
		wb, err := Parse(data)
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
	wbTree, err := xmltree.Parse(files["xl/workbook.xml"])
	if err != nil {
		return nil, err
	}
	rels := xmltree.ParseRels(files["xl/_rels/workbook.xml.rels"])
	shared := parseSharedStrings(files["xl/sharedStrings.xml"])
	out := map[string]map[string][2]string{}
	sheets := wbTree.First("sheets")
	if sheets == nil {
		return out, nil
	}
	for _, sn := range sheets.All("sheet") {
		rid := ""
		for _, a := range sn.Attrs {
			if a.Name.Local == "id" {
				rid = a.Value
			}
		}
		tree, err := xmltree.Parse(files[xmltree.ResolvePart("xl", rels[rid])])
		if err != nil {
			continue
		}
		vals := map[string][2]string{}
		if sd := tree.First("sheetData"); sd != nil {
			for _, row := range sd.All("row") {
				for _, c := range row.All("c") {
					if c.First("f") == nil {
						continue
					}
					typ, v := c.Attr("t"), ""
					if vn := c.First("v"); vn != nil {
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
					vals[c.Attr("r")] = [2]string{typ, v}
				}
			}
		}
		out[sn.Attr("name")] = vals
	}
	return out, nil
}

func jsonIndex(s string) (int, error) {
	var i int
	err := json.Unmarshal([]byte(strings.TrimSpace(s)), &i)
	return i, err
}
