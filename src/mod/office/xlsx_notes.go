package office

/*
	xlsx_notes.go - Cell note (comment) support for the Sheets webapp.

	Webapp cells carry an optional "n" note string. On export every noted
	cell becomes a classic xlsx comment: xl/commentsN.xml holds the text
	and a companion VML part (xl/drawings/vmlDrawingN.vml, referenced as
	the sheet's legacyDrawing) gives Excel the hidden note box to show on
	hover. On import, commentsN.xml maps back to the "n" field.
*/

import (
	"fmt"
	"sort"
	"strings"
)

type xlsxNote struct {
	ref      string
	col, row int
	text     string
}

// sheetNotes collects the sheet's notes in a deterministic order
func sheetNotes(ws *WorkSheet) []xlsxNote {
	var out []xlsxNote
	for k, cell := range ws.Cells {
		if cell == nil || strings.TrimSpace(cell.N) == "" {
			continue
		}
		col, row, ok := parseCellRef(k)
		if !ok {
			continue
		}
		out = append(out, xlsxNote{ref: cellRef(col, row), col: col, row: row, text: cell.N})
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].row != out[b].row {
			return out[a].row < out[b].row
		}
		return out[a].col < out[b].col
	})
	return out
}

func buildCommentsXML(notes []xlsxNote) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	sb.WriteString(`<authors><author>ArozOS Sheets</author></authors><commentList>`)
	for _, n := range notes {
		sb.WriteString(`<comment ref="` + n.ref + `" authorId="0"><text><r>` +
			`<rPr><sz val="9"/><rFont val="Tahoma"/></rPr>` +
			`<t xml:space="preserve">` + xmlEscape(n.text) + `</t></r></text></comment>`)
	}
	sb.WriteString(`</commentList></comments>`)
	return sb.String()
}

// buildVmlXML renders the legacy drawing part Excel needs to display the
// note boxes (hidden, shown on hover, anchored next to their cell)
func buildVmlXML(notes []xlsxNote) string {
	var sb strings.Builder
	sb.WriteString(`<xml xmlns:v="urn:schemas-microsoft-com:vml"` +
		` xmlns:o="urn:schemas-microsoft-com:office:office"` +
		` xmlns:x="urn:schemas-microsoft-com:office:excel">` +
		`<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>` +
		`<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">` +
		`<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>`)
	for i, n := range notes {
		// anchor the note box one column right / same row, sized 3x3 cells
		anchor := fmt.Sprintf("%d, 15, %d, 2, %d, 15, %d, 16",
			n.col+1, maxInt(0, n.row), n.col+3, n.row+3)
		sb.WriteString(fmt.Sprintf(`<v:shape id="_x0000_s%d" type="#_x0000_t202"`+
			` style="position:absolute;margin-left:80pt;margin-top:2pt;width:104pt;height:52pt;`+
			`z-index:%d;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">`,
			1025+i, i+1))
		sb.WriteString(`<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/>` +
			`<v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"/>` +
			`<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/>` +
			`<x:Anchor>` + anchor + `</x:Anchor><x:AutoFill>False</x:AutoFill>` +
			fmt.Sprintf(`<x:Row>%d</x:Row><x:Column>%d</x:Column>`, n.row, n.col) +
			`</x:ClientData></v:shape>`)
	}
	sb.WriteString(`</xml>`)
	return sb.String()
}

// parseSheetComments reads a worksheet's comments part (if any) back into
// the cells' "n" note field
func parseSheetComments(files map[string][]byte, sheetPart string, ws *WorkSheet) {
	sheetDir := pathDir(sheetPart)
	relsRaw, ok := files[sheetDir+"/_rels/"+pathBase(sheetPart)+".rels"]
	if !ok {
		return
	}
	relsTree, err := parseXMLTree(relsRaw)
	if err != nil {
		return
	}
	commentsPart := ""
	for _, rel := range relsTree.all("Relationship") {
		if strings.HasSuffix(rel.attr("Type"), "/comments") {
			commentsPart = resolvePartPath(sheetDir, rel.attr("Target"))
		}
	}
	if commentsPart == "" {
		return
	}
	tree, err := parseXMLTree(files[commentsPart])
	if err != nil {
		return
	}
	cl := tree.first("commentList")
	if cl == nil {
		return
	}
	for _, cm := range cl.all("comment") {
		col, row, ok := parseCellRef(cm.attr("ref"))
		if !ok {
			continue
		}
		var texts []string
		if t := cm.first("text"); t != nil {
			collectText(t, &texts)
		}
		note := strings.TrimSpace(strings.Join(texts, ""))
		if note == "" {
			continue
		}
		k := cellRef(col, row)
		if ws.Cells[k] == nil {
			ws.Cells[k] = &WorkCell{}
		}
		ws.Cells[k].N = note
	}
}
