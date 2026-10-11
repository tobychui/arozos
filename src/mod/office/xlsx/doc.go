/*
Package xlsx converts between the Sheets workbook model and Excel 2007+
(.xlsx, SpreadsheetML) files.

	Parse  .xlsx bytes -> *model.Workbook: values, formulas (shared and
	       array formulas expanded, _xlfn. prefixes stripped), styles,
	       merges, sizes, frozen panes, notes, defined names, charts and
	       conditional formats (reader.go, formula.go, notes.go,
	       charts.go, cf.go)
	Build  *model.Workbook -> .xlsx (writer.go)

The legacy binary .xls format is read by package xls, which converts it
into an .xlsx for Parse.
*/
package xlsx
