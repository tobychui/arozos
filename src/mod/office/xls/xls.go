/*
Package xls imports Excel 97-2003 workbooks (.xls, BIFF8 - and BIFF5, the
Excel 5/95 format) by converting them into Excel 2007+ workbooks (.xlsx),
which package xlsx then reads into the Sheets model.

A .xls file is an OLE2 compound file (internal/cfb) holding a "Workbook"
stream (BIFF8; "Book" for BIFF5) of records: the workbook globals, then
one substream per sheet. The conversion follows the layout of
LibreOffice's Excel import (sc/source/filter/excel): globals first
(workbook.go), each sheet's cells and properties (sheet.go), formulas
decompiled from their token form (formula.go), and the result written as
SpreadsheetML (xlsx.go).

Imported: values, shared strings, formulas (shared and array formulas,
3D references, defined names, add-in and newer functions), cached
formula results, number formats, fonts, fills, borders, alignment,
column widths, row heights, hidden rows and columns, merged cells,
frozen panes, comments, hyperlinks (as HYPERLINK formulas) and sheet tab
colours. Not imported: charts, pictures and other drawing objects,
conditional formats, data validation and VBA. Password-protected
workbooks are refused with an explanation.
*/
package xls

import (
	"errors"

	"imuslab.com/arozos/mod/office/internal/cfb"
	"imuslab.com/arozos/mod/office/model"
	"imuslab.com/arozos/mod/office/xlsx"
)

// ToXlsx converts an Excel 97-2003 workbook into an .xlsx file
func ToXlsx(data []byte) ([]byte, error) {
	b, sheets, index, err := read(data)
	if err != nil {
		return nil, err
	}
	return b.writeXlsx(sheets, index)
}

// Parse converts an Excel 97-2003 workbook into the Sheets model
func Parse(data []byte) (*model.Workbook, error) {
	x, err := ToXlsx(data)
	if err != nil {
		return nil, err
	}
	return xlsx.Parse(x)
}

// read decodes the workbook: the globals, then each worksheet in tab
// order; index holds each sheet's BOUNDSHEET position
func read(data []byte) (*book, []*sheet, []int, error) {
	if !cfb.IsCompound(data) {
		if len(data) >= 4 && data[0] == 0x09 && (data[1] == 0x00 || data[1] == 0x02 || data[1] == 0x04) {
			return nil, nil, nil, errors.New("Excel 2.x - 4.x worksheets are not supported")
		}
		return nil, nil, nil, errors.New("not an Excel 97-2003 workbook")
	}
	cf, err := cfb.Open(data)
	if err != nil {
		return nil, nil, nil, err
	}
	var stream []byte
	switch {
	case cf.Has("Workbook"):
		stream, err = cf.Stream("Workbook")
	case cf.Has("Book"):
		stream, err = cf.Stream("Book")
	default:
		return nil, nil, nil, errors.New("not an Excel workbook (no Workbook stream)")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	recs, err := readRecords(stream)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(recs) == 0 || recs[0].typ != rtBOF || len(recs[0].data) < 4 {
		return nil, nil, nil, errors.New("the workbook stream does not start with a BOF record")
	}
	vers := uint16(recs[0].data[0]) | uint16(recs[0].data[1])<<8
	b := newBook(vers >= 0x0600)
	b.records = recs
	if err := b.parseGlobals(); err != nil {
		return nil, nil, nil, err
	}
	byPos := make(map[int]int, len(recs))
	for i, r := range recs {
		if r.typ == rtBOF {
			byPos[r.pos] = i
		}
	}
	var sheets []*sheet
	var index []int
	for i, bs := range b.sheets {
		if bs.kind != 0 && bs.kind != 1 {
			continue // chart sheets and VBA modules
		}
		start, ok := byPos[bs.pos]
		if !ok {
			continue
		}
		sheets = append(sheets, b.parseSheet(start, bs.name))
		index = append(index, i)
	}
	if len(sheets) == 0 {
		return nil, nil, nil, errors.New("the workbook has no worksheets")
	}
	return b, sheets, index, nil
}
