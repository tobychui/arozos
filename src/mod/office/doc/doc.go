/*
Package doc imports Word 97-2003 documents (.doc) by converting them into
Word 2007+ documents (.docx), which package docx then reads into the Docs
model.

The design follows LibreOffice's Word import (sw/source/filter/ww8): the
File Information Block (fib.go, WW8Fib), the piece table and formatted
disk pages (text.go, WW8PLCFx_*), property modifiers (sprm.go,
wwSprmParser and the ww8par6 attribute handlers), styles and fonts
(styles.go, WW8RStyle / WW8Fonts), lists (lists.go, WW8ListManager),
paragraphs and runs (story.go), tables (tables.go, WW8TabDesc), fields
(emit.go, ww8par5), pictures and drawings (drawing.go, ww8graf) and the
sub-documents - footnotes, endnotes, comments, headers, text boxes. Where
LibreOffice builds its own document model, this package writes the
equivalent WordprocessingML: Word 2007 defined .docx as the XML form of
the same model, so sprms map onto w:rPr / w:pPr / w:tblPr elements almost
one to one, and a style's or run's own modifiers stay exactly that.

Imported: text and character formatting, paragraph formatting, styles,
bullets and numbering, tables (merged cells, borders, shading, nested
tables), sections (page size, margins, orientation, columns), headers and
footers, footnotes and endnotes, comments, hyperlinks and other fields,
tracked changes, inline and floating pictures (WMF / EMF / PNG / JPEG /
DIB / TIFF), symbols, and the text of text boxes. Not imported: drawn
shapes without a picture, OLE objects beyond their preview picture,
macros, and Word 6.0/95 and older files. Encrypted documents are refused
with an explanation.
*/
package doc

import (
	"errors"
	"sort"

	"imuslab.com/arozos/mod/office/docx"
	"imuslab.com/arozos/mod/office/internal/cfb"
	"imuslab.com/arozos/mod/office/model"
)

// docFile is an opened document with everything the writer needs
type docFile struct {
	wd, tbl, data []byte
	fib           *fib
	pieces        []piece
	prc           [][]byte
	text          []uint16
	chpx, papx    []fkpRun
	styles        *styleSheet
	fonts         []font
	lists         *lists
	draw          *drawings
	revAuthors    []string
}

var errCorruptFIB = errors.New("the document is damaged: its text counts do not fit the file")

var errEncrypted = errors.New("this document is password protected; remove the password in Word and save it again to open it here")

// ToDocx converts a Word 97-2003 document into a .docx file
func ToDocx(data []byte) ([]byte, error) {
	d, err := open(data)
	if err != nil {
		return nil, err
	}
	return newWriter(d).write()
}

// Parse converts a Word 97-2003 document into the Docs model
func Parse(data []byte) (*model.Document, error) {
	x, err := ToDocx(data)
	if err != nil {
		return nil, err
	}
	return docx.Parse(x)
}

func open(data []byte) (*docFile, error) {
	if !cfb.IsCompound(data) {
		return nil, errors.New("not a Word 97-2003 document")
	}
	cf, err := cfb.Open(data)
	if err != nil {
		return nil, err
	}
	if !cf.Has("WordDocument") {
		return nil, errors.New("not a Word document (no WordDocument stream)")
	}
	d := &docFile{}
	if d.wd, err = cf.Stream("WordDocument"); err != nil {
		return nil, err
	}
	if d.fib, err = parseFib(d.wd); err != nil {
		return nil, err
	}
	if d.fib.encrypted {
		return nil, errEncrypted
	}
	tblName := "0Table"
	if d.fib.table1 {
		tblName = "1Table"
	}
	if !cf.Has(tblName) {
		return nil, errors.New("the document's table stream is missing")
	}
	if d.tbl, err = cf.Stream(tblName); err != nil {
		return nil, err
	}
	if cf.Has("Data") {
		d.data, _ = cf.Stream("Data")
	}

	total := d.fib.totalCP()
	// a document with sub-documents has one more paragraph mark after them
	if total > d.fib.ccpText {
		total++
	}
	// every character takes at least a byte of the WordDocument stream: a
	// FIB claiming more is damaged, and would size the text buffer past
	// anything the file holds
	if total > len(d.wd) {
		return nil, errCorruptFIB
	}
	clx := d.fib.span(d.tbl, lcbClx)
	d.pieces, d.prc = pieceTable(clx, total)
	if len(d.pieces) == 0 {
		// no piece table: one 8-bit piece from fcMin (very old writers)
		d.pieces = []piece{{cpStart: 0, cpEnd: total, fc: 0x400, compressed: true}}
	}
	sort.Slice(d.pieces, func(i, j int) bool { return d.pieces[i].cpStart < d.pieces[j].cpStart })
	if last := d.pieces[len(d.pieces)-1].cpEnd; last < total {
		total = last
	}
	d.text = textUnits(d.wd, d.pieces, total)
	d.chpx = readFKPs(d.wd, d.fib.span(d.tbl, lcbPlcfBteChpx), false)
	d.papx = readFKPs(d.wd, d.fib.span(d.tbl, lcbPlcfBtePapx), true)
	d.styles = parseStyles(d.fib.span(d.tbl, lcbStshf))
	d.fonts = parseFonts(d.fib.span(d.tbl, lcbSttbfFfn))
	d.lists = parseLists(d.fib.spanTail(d.tbl, lcbPlfLst), d.fib.spanTail(d.tbl, lcbPlfLfo))
	d.revAuthors = sttb(d.fib.span(d.tbl, lcbSttbfRMark))
	d.readDrawings()
	return d, nil
}

// clampCP keeps a CP range inside the text
func (d *docFile) clamp(cp1, cp2 int) (int, int) {
	n := len(d.text)
	if cp1 < 0 {
		cp1 = 0
	}
	if cp2 > n {
		cp2 = n
	}
	if cp1 > cp2 {
		cp1 = cp2
	}
	return cp1, cp2
}
