/*
Package model holds the document models of the ArozOS Office editors - the
"body" of the {type, app, version, meta, body} envelope each webapp saves -
and the small rules that belong to them. Every format converter reads into
and writes out of these types, so this package depends on nothing else in
mod/office.

	Document      Docs (src/web/Office/docs): rich HTML plus page setup,
	              headers, footers, footnotes and review comments
	Workbook      Sheets (src/web/Office/sheets): sheets of raw cell input
	              ("=" marks a formula), styles, merges, notes and the
	              conditional formats
	Presentation  Slides (src/web/Office/slides): slides of positioned
	              objects in a 960 px wide coordinate space

	    { "size": [960, 540], "theme": "clean",
	      "slides": [ { "id", "bg", "notes", "objects": [
	          { "id", "type": "text|image|shape|line|table|chart",
	            "x","y","w","h","rot","z", "props": {...} } ] } ] }

The JSON tags are the schema: they must stay compatible with what the
editors read and write (src/web/Office/common/CONTRACT.md).
*/
package model
