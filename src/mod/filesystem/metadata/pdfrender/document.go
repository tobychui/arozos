package pdfrender

import (
	"bytes"
	"errors"
	"io"
	"math"
)

/*
	document.go

	Opens a PDF over an io.ReaderAt: the cross reference table (classic,
	stream or hybrid, following /Prev), object streams, lazy object loading
	and a whole file scan that rebuilds the table when it is broken. Only
	the objects a render touches are ever read, so a large file costs little
	more than a small one.
*/

var (
	// ErrNotPDF is returned when the data has no recognisable PDF structure
	ErrNotPDF = errors.New("pdfrender: not a pdf file")
	// ErrEncrypted is returned for files that need a password to open
	ErrEncrypted = errors.New("pdfrender: pdf is password protected")
	// ErrNoPage is returned when the requested page does not exist
	ErrNoPage = errors.New("pdfrender: page not found")
)

const (
	//Largest object (dictionary, not stream data) read in one go
	maxObjectWindow = 32 << 20
	//Largest file the reconstruction scan reads through
	maxReconstructScan = 2 << 30
)

type xrefEntry struct {
	compressed bool
	offset     int64 //File offset, or the object stream number when compressed
	index      int   //Index inside the object stream
}

type objStm struct {
	data    []byte
	first   int
	offsets map[int]int
}

// Document is an opened PDF file
type Document struct {
	r       io.ReaderAt
	size    int64
	xref    map[int]xrefEntry
	trailer Dict

	cache     map[Ref]Object
	objStms   map[int]*objStm
	resolving map[Ref]bool

	crypt      *cryptHandler
	encryptRef Ref

	headerOffset  int64
	reconstructed bool
}

// Open reads the structure of a PDF. The reader must stay usable for as
// long as the Document is.
func Open(r io.ReaderAt, size int64) (*Document, error) {
	d := &Document{
		r:         r,
		size:      size,
		xref:      map[int]xrefEntry{},
		cache:     map[Ref]Object{},
		objStms:   map[int]*objStm{},
		resolving: map[Ref]bool{},
	}
	head := d.readAt(0, 1024)
	idx := bytes.Index(head, []byte("%PDF-"))
	if idx < 0 {
		return nil, ErrNotPDF
	}
	d.headerOffset = int64(idx)

	if err := d.loadXref(); err != nil || d.catalog() == nil {
		if err := d.reconstruct(); err != nil {
			return nil, err
		}
	}
	if d.catalog() == nil {
		return nil, ErrNotPDF
	}
	if enc, ok := d.trailer["Encrypt"]; ok && enc != nil {
		if ref, ok := enc.(Ref); ok {
			d.encryptRef = ref
		}
		ch, err := newCryptHandler(d, d.dict(enc))
		if err != nil {
			return nil, err
		}
		d.crypt = ch
		//Objects read so far were read without decryption
		d.cache = map[Ref]Object{}
		d.objStms = map[int]*objStm{}
	}
	return d, nil
}

// readAt reads up to n bytes at off, clamped to the file
func (d *Document) readAt(off int64, n int64) []byte {
	if off < 0 || off >= d.size || n <= 0 {
		return nil
	}
	if n > d.size-off {
		n = d.size - off
	}
	buf := make([]byte, n)
	got, _ := d.r.ReadAt(buf, off)
	return buf[:got]
}

func (d *Document) catalog() Dict {
	if d.trailer == nil {
		return nil
	}
	root := d.dict(d.trailer["Root"])
	if root == nil {
		return nil
	}
	return root
}

/*
	Cross reference table
*/

func (d *Document) loadXref() error {
	tail := d.size - 2048
	if tail < 0 {
		tail = 0
	}
	buf := d.readAt(tail, d.size-tail)
	idx := bytes.LastIndex(buf, []byte("startxref"))
	if idx < 0 {
		return ErrNotPDF
	}
	p := newParser(buf[idx+9:])
	t := p.nextToken()
	if t.kind != tokInt {
		return ErrNotPDF
	}
	off := int64(t.i)
	visited := map[int64]bool{}
	for off > 0 && !visited[off] && len(visited) < 512 {
		visited[off] = true
		trailer, err := d.readXrefSection(off)
		if err != nil && d.headerOffset > 0 {
			trailer, err = d.readXrefSection(off + d.headerOffset)
		}
		if err != nil {
			if d.trailer == nil {
				return err
			}
			break
		}
		if d.trailer == nil {
			d.trailer = trailer
		}
		if xs, ok := toInt(trailer["XRefStm"]); ok && !visited[int64(xs)] {
			visited[int64(xs)] = true
			d.readXrefSection(int64(xs))
		}
		prev, ok := toFloat(trailer["Prev"])
		if !ok {
			break
		}
		off = int64(prev)
	}
	if d.trailer == nil {
		return ErrNotPDF
	}
	return nil
}

func (d *Document) setXref(num int, e xrefEntry) {
	if num <= 0 {
		return
	}
	if _, exists := d.xref[num]; !exists {
		d.xref[num] = e
	}
}

// readXrefSection reads a classic table + trailer, or an xref stream, at
// off and returns its trailer dictionary
func (d *Document) readXrefSection(off int64) (Dict, error) {
	window := int64(64 << 10)
	for {
		buf := d.readAt(off, window)
		if len(buf) == 0 {
			return nil, ErrNotPDF
		}
		p := newParser(buf)
		t := p.peekToken(0)
		if t.kind == tokKeyword && t.s == "xref" {
			p.nextToken()
			trailer, err := d.parseXrefTable(p)
			if err != nil && p.lex.truncated && window < d.size-off && window < maxObjectWindow {
				window *= 4
				continue
			}
			return trailer, err
		}
		break
	}
	//An xref stream
	obj, err := d.parseIndirectAt(off, Ref{})
	if err != nil {
		return nil, err
	}
	s, ok := obj.(*Stream)
	if !ok {
		return nil, ErrNotPDF
	}
	if err := d.parseXrefStream(s); err != nil {
		return nil, err
	}
	return s.Dict, nil
}

func (d *Document) parseXrefTable(p *parser) (Dict, error) {
	entries := map[int]xrefEntry{}
	for {
		t := p.nextToken()
		if t.kind == tokKeyword && t.s == "trailer" {
			break
		}
		if t.kind != tokInt {
			return nil, errSyntax
		}
		ct := p.nextToken()
		if ct.kind != tokInt || ct.i < 0 {
			return nil, errSyntax
		}
		start, count := t.i, ct.i
		for i := 0; i < count; i++ {
			ot := p.nextToken()
			gt := p.nextToken()
			kt := p.nextToken()
			if ot.kind != tokInt || gt.kind != tokInt || kt.kind != tokKeyword {
				return nil, errSyntax
			}
			if kt.s == "n" && ot.i > 0 {
				if _, ok := entries[start+i]; !ok {
					entries[start+i] = xrefEntry{offset: int64(ot.i)}
				}
			}
		}
	}
	obj, err := p.parseObject(0)
	if err != nil {
		return nil, err
	}
	trailer, ok := obj.(Dict)
	if !ok {
		return nil, errSyntax
	}
	for num, e := range entries {
		d.setXref(num, e)
	}
	return trailer, nil
}

func (d *Document) parseXrefStream(s *Stream) error {
	data, err := d.decodeStream(s, 64<<20)
	if err != nil {
		return err
	}
	w := d.array(s.Dict["W"])
	if len(w) < 3 {
		return errSyntax
	}
	var ws [3]int
	total := 0
	for i := 0; i < 3; i++ {
		ws[i], _ = toInt(d.resolve(w[i]))
		if ws[i] < 0 || ws[i] > 8 {
			return errSyntax
		}
		total += ws[i]
	}
	if total == 0 {
		return errSyntax
	}
	index := d.array(s.Dict["Index"])
	if len(index) == 0 {
		size, _ := toInt(d.resolve(s.Dict["Size"]))
		index = Array{0, size}
	}
	readField := func(b []byte) int64 {
		var v int64
		for _, c := range b {
			v = v<<8 | int64(c)
		}
		return v
	}
	pos := 0
	for i := 0; i+1 < len(index); i += 2 {
		start, _ := toInt(d.resolve(index[i]))
		count, _ := toInt(d.resolve(index[i+1]))
		for j := 0; j < count; j++ {
			if total > len(data)-pos {
				return nil
			}
			row := data[pos : pos+total]
			pos += total
			typ := int64(1)
			if ws[0] > 0 {
				typ = readField(row[:ws[0]])
			}
			f2 := readField(row[ws[0] : ws[0]+ws[1]])
			f3 := readField(row[ws[0]+ws[1]:])
			switch typ {
			case 1:
				d.setXref(start+j, xrefEntry{offset: f2})
			case 2:
				if f3 >= 0 && f3 < math.MaxInt32 {
					d.setXref(start+j, xrefEntry{compressed: true, offset: f2, index: int(f3)})
				}
			}
		}
	}
	return nil
}

/*
	Object loading
*/

// parseIndirectAt parses "n g obj ... endobj" at a file offset
func (d *Document) parseIndirectAt(off int64, want Ref) (Object, error) {
	window := int64(16 << 10)
	for {
		buf := d.readAt(off, window)
		if len(buf) == 0 {
			return nil, errSyntax
		}
		p := newParser(buf)
		t1, t2, t3 := p.nextToken(), p.nextToken(), p.nextToken()
		if t1.kind != tokInt || t2.kind != tokInt || t3.kind != tokKeyword || t3.s != "obj" {
			return nil, errSyntax
		}
		ref := Ref{Num: t1.i, Gen: t2.i}
		if want.Num != 0 && ref.Num != want.Num {
			return nil, errSyntax
		}
		obj, err := p.parseObject(0)
		if err != nil {
			if p.lex.truncated && window < d.size-off && window < maxObjectWindow {
				window *= 4
				continue
			}
			return nil, err
		}
		if dict, ok := obj.(Dict); ok {
			nt := p.peekToken(0)
			if nt.kind == tokKeyword && nt.s == "stream" {
				//The stream keyword is followed by CRLF or LF (sometimes a bare CR)
				p.nextToken()
				pos := p.lex.pos
				if len(p.peek) > 0 {
					return nil, errSyntax
				}
				if pos < len(buf) && buf[pos] == '\r' {
					pos++
				}
				if pos < len(buf) && buf[pos] == '\n' {
					pos++
				}
				s := &Stream{Dict: dict, ref: ref, offset: off + int64(pos)}
				s.length = d.streamLength(s)
				if d.crypt != nil && ref != d.encryptRef {
					s.Dict = d.crypt.decryptObject(dict, ref).(Dict)
				}
				return s, nil
			}
		}
		if d.crypt != nil && ref != d.encryptRef {
			obj = d.crypt.decryptObject(obj, ref)
		}
		return obj, nil
	}
}

// streamLength checks /Length against the "endstream" keyword and searches
// for the keyword when the length is wrong
func (d *Document) streamLength(s *Stream) int64 {
	length := int64(-1)
	if l, ok := toFloat(d.resolve(s.Dict["Length"])); ok && l >= 0 && l <= float64(d.size) {
		length = int64(l)
	}
	if length >= 0 && s.offset+length <= d.size {
		tail := d.readAt(s.offset+length, 32)
		tail = bytes.TrimLeft(tail, " \r\n\t\f\x00")
		if bytes.HasPrefix(tail, []byte("endstream")) || bytes.HasPrefix(tail, []byte("endobj")) {
			return length
		}
	}
	//Search for the end marker
	const chunk = 1 << 20
	marker := []byte("endstream")
	for pos := s.offset; pos < d.size; pos += chunk - int64(len(marker)) {
		buf := d.readAt(pos, chunk)
		if i := bytes.Index(buf, marker); i >= 0 {
			end := pos + int64(i)
			//Drop the EOL before the keyword
			b := d.readAt(end-2, 2)
			if len(b) == 2 && b[0] == '\r' && b[1] == '\n' {
				end -= 2
			} else if len(b) == 2 && (b[1] == '\n' || b[1] == '\r') {
				end--
			}
			if end < s.offset {
				end = s.offset
			}
			return end - s.offset
		}
		if len(buf) < chunk {
			break
		}
	}
	if length >= 0 && s.offset+length <= d.size {
		return length
	}
	return d.size - s.offset
}

// get loads an indirect object
func (d *Document) get(ref Ref) Object {
	if obj, ok := d.cache[ref]; ok {
		return obj
	}
	if d.resolving[ref] {
		return nil
	}
	d.resolving[ref] = true
	defer delete(d.resolving, ref)

	e, ok := d.xref[ref.Num]
	if !ok {
		return nil
	}
	var obj Object
	if e.compressed {
		obj = d.getCompressed(int(e.offset), e.index, ref.Num)
	} else {
		o, err := d.parseIndirectAt(e.offset, ref)
		if err != nil && d.headerOffset > 0 {
			o, err = d.parseIndirectAt(e.offset+d.headerOffset, ref)
		}
		if err != nil && !d.reconstructed {
			//The table is wrong; rebuild it once and retry
			if d.reconstruct() == nil {
				if e2, ok := d.xref[ref.Num]; ok && !e2.compressed {
					o, err = d.parseIndirectAt(e2.offset, ref)
				} else if ok {
					o = d.getCompressed(int(e2.offset), e2.index, ref.Num)
					err = nil
				}
			}
		}
		if err == nil {
			obj = o
		}
	}
	if kw, ok := obj.(keyword); ok && kw == "endobj" {
		obj = nil
	}
	d.cache[ref] = obj
	return obj
}

func (d *Document) getCompressed(stmNum int, index int, num int) Object {
	os, ok := d.objStms[stmNum]
	if !ok {
		os = d.loadObjStm(stmNum)
		d.objStms[stmNum] = os
	}
	if os == nil {
		return nil
	}
	off, ok := os.offsets[num]
	if !ok {
		return nil
	}
	start := os.first + off
	if start < 0 || start >= len(os.data) {
		return nil
	}
	p := newParser(os.data[start:])
	obj, err := p.parseObject(0)
	if err != nil {
		return nil
	}
	return obj
}

func (d *Document) loadObjStm(num int) *objStm {
	s, ok := d.get(Ref{Num: num}).(*Stream)
	if !ok {
		//Object streams always have generation 0, but look up by xref too
		if e, ok2 := d.xref[num]; ok2 && !e.compressed {
			obj, err := d.parseIndirectAt(e.offset, Ref{Num: num})
			if err != nil {
				return nil
			}
			s, ok = obj.(*Stream)
		}
		if !ok {
			return nil
		}
	}
	data, err := d.decodeStream(s, 256<<20)
	if err != nil && len(data) == 0 {
		return nil
	}
	n, _ := toInt(d.resolve(s.Dict["N"]))
	first, _ := toInt(d.resolve(s.Dict["First"]))
	if n < 0 || first < 0 || first > len(data) {
		return nil
	}
	os := &objStm{data: data, first: first, offsets: map[int]int{}}
	p := newParser(data[:first])
	for i := 0; i < n; i++ {
		t1, t2 := p.nextToken(), p.nextToken()
		if t1.kind != tokInt || t2.kind != tokInt {
			break
		}
		if _, exists := os.offsets[t1.i]; !exists {
			os.offsets[t1.i] = t2.i
		}
	}
	return os
}

/*
	Reconstruction: scan the file for "n g obj" and trailers
*/

func (d *Document) reconstruct() error {
	if d.reconstructed {
		return ErrNotPDF
	}
	d.reconstructed = true
	found := map[int]int64{}
	var trailers []Dict
	const chunk = 4 << 20
	const overlap = 64
	limit := d.size
	if limit > maxReconstructScan {
		limit = maxReconstructScan
	}
	objMarker := []byte("obj")
	trailerMarker := []byte("trailer")
	for base := int64(0); base < limit; base += chunk - overlap {
		buf := d.readAt(base, chunk)
		if len(buf) == 0 {
			break
		}
		for i := 0; i < len(buf); {
			j := bytes.Index(buf[i:], objMarker)
			if j < 0 {
				break
			}
			at := i + j
			i = at + 3
			if at+3 < len(buf) {
				c := buf[at+3]
				if !isWhite(c) && !isDelim(c) {
					continue
				}
			}
			//Look back for "num gen "
			k := at - 1
			if k < 0 || !isWhite(buf[k]) {
				continue
			}
			for k >= 0 && isWhite(buf[k]) {
				k--
			}
			genEnd := k + 1
			for k >= 0 && buf[k] >= '0' && buf[k] <= '9' {
				k--
			}
			if k+1 == genEnd {
				continue
			}
			if k < 0 || !isWhite(buf[k]) {
				continue
			}
			for k >= 0 && isWhite(buf[k]) {
				k--
			}
			numEnd := k + 1
			for k >= 0 && buf[k] >= '0' && buf[k] <= '9' {
				k--
			}
			if k+1 == numEnd || numEnd-(k+1) > 10 {
				continue
			}
			num := 0
			for _, c := range buf[k+1 : numEnd] {
				num = num*10 + int(c-'0')
			}
			if num > 0 && num < 1<<28 {
				found[num] = base + int64(k+1)
			}
		}
		for i := 0; i < len(buf); {
			j := bytes.Index(buf[i:], trailerMarker)
			if j < 0 {
				break
			}
			at := i + j
			i = at + 7
			p := newParser(d.readAt(base+int64(at+7), 64<<10))
			if obj, err := p.parseObject(0); err == nil {
				if t, ok := obj.(Dict); ok {
					trailers = append(trailers, t)
				}
			}
		}
		if len(buf) < chunk {
			break
		}
	}
	if len(found) == 0 {
		return ErrNotPDF
	}
	d.xref = map[int]xrefEntry{}
	for num, off := range found {
		d.xref[num] = xrefEntry{offset: off}
	}
	d.cache = map[Ref]Object{}
	d.objStms = map[int]*objStm{}

	//Register the objects of object streams, and find xref streams with a root
	for num := range found {
		s, ok := d.get(Ref{Num: num}).(*Stream)
		if !ok {
			continue
		}
		switch d.name(s.Dict["Type"]) {
		case "ObjStm":
			os := d.loadObjStm(num)
			if os == nil {
				continue
			}
			d.objStms[num] = os
			for inner := range os.offsets {
				if _, exists := d.xref[inner]; !exists {
					d.xref[inner] = xrefEntry{compressed: true, offset: int64(num)}
				}
			}
		case "XRef":
			if s.Dict["Root"] != nil {
				trailers = append(trailers, s.Dict)
			}
		}
	}

	//Prefer the last trailer whose root resolves to a catalog
	d.trailer = nil
	for i := len(trailers) - 1; i >= 0; i-- {
		root := d.dict(trailers[i]["Root"])
		if root != nil && root["Pages"] != nil {
			d.trailer = trailers[i]
			break
		}
	}
	if d.trailer == nil {
		for num := range d.xref {
			obj := d.dict(Ref{Num: num})
			if obj != nil && d.name(obj["Type"]) == "Catalog" && obj["Pages"] != nil {
				d.trailer = Dict{"Root": Ref{Num: num}}
				for _, t := range trailers {
					if t["Encrypt"] != nil {
						d.trailer["Encrypt"] = t["Encrypt"]
						d.trailer["ID"] = t["ID"]
					}
				}
				break
			}
		}
	}
	if d.trailer == nil {
		return ErrNotPDF
	}
	return nil
}

/*
	Resolution helpers
*/

func (d *Document) resolve(o Object) Object {
	for i := 0; i < 32; i++ {
		ref, ok := o.(Ref)
		if !ok {
			return o
		}
		o = d.get(ref)
	}
	return nil
}

func (d *Document) dict(o Object) Dict {
	switch v := d.resolve(o).(type) {
	case Dict:
		return v
	case *Stream:
		return v.Dict
	}
	return nil
}

func (d *Document) array(o Object) Array {
	a, _ := d.resolve(o).(Array)
	return a
}

func (d *Document) name(o Object) Name {
	n, _ := d.resolve(o).(Name)
	return n
}

func (d *Document) num(o Object, def float64) float64 {
	if v, ok := toFloat(d.resolve(o)); ok && !math.IsNaN(v) && !math.IsInf(v, 0) {
		return v
	}
	return def
}

func (d *Document) integer(o Object, def int) int {
	if v, ok := toInt(d.resolve(o)); ok {
		return v
	}
	return def
}

func (d *Document) stream(o Object) *Stream {
	s, _ := d.resolve(o).(*Stream)
	return s
}

// numbers reads an array of numbers
func (d *Document) numbers(o Object) []float64 {
	arr := d.array(o)
	out := make([]float64, 0, len(arr))
	for _, v := range arr {
		out = append(out, d.num(v, 0))
	}
	return out
}

/*
	Page tree
*/

// Page is a page with its inherited attributes resolved
type Page struct {
	Dict      Dict
	Resources Dict
	MediaBox  [4]float64
	CropBox   [4]float64
	Rotate    int
}

// NumPages returns the page count from the page tree
func (d *Document) NumPages() int {
	cat := d.catalog()
	if cat == nil {
		return 0
	}
	pages := d.dict(cat["Pages"])
	if pages == nil {
		return 0
	}
	n := d.integer(pages["Count"], 0)
	if n <= 0 {
		//A broken count; count the leaves instead
		n = 0
		d.walkPages(cat["Pages"], func(Dict) bool { n++; return true })
	}
	return n
}

// walkPages visits the leaves of the page tree in order until fn returns false
func (d *Document) walkPages(root Object, fn func(Dict) bool) {
	visited := map[Ref]bool{}
	var walk func(o Object, depth int) bool
	walk = func(o Object, depth int) bool {
		if depth > 64 {
			return true
		}
		if ref, ok := o.(Ref); ok {
			if visited[ref] {
				return true
			}
			visited[ref] = true
		}
		node := d.dict(o)
		if node == nil {
			return true
		}
		kids, hasKids := d.resolve(node["Kids"]).(Array)
		if d.name(node["Type"]) == "Page" || (!hasKids && d.name(node["Type"]) != "Pages") {
			return fn(node)
		}
		for _, k := range kids {
			if !walk(k, depth+1) {
				return false
			}
		}
		return true
	}
	walk(root, 0)
}

// Page returns page n (0 based)
func (d *Document) Page(n int) (*Page, error) {
	cat := d.catalog()
	if cat == nil || n < 0 {
		return nil, ErrNoPage
	}
	var found Dict
	var chain []Dict
	i := 0
	visited := map[Ref]bool{}
	//Descend using /Count where it can, so huge documents stay cheap
	var walk func(o Object, depth int, parents []Dict) bool
	walk = func(o Object, depth int, parents []Dict) bool {
		if depth > 64 {
			return true
		}
		if ref, ok := o.(Ref); ok {
			if visited[ref] {
				return true
			}
			visited[ref] = true
		}
		node := d.dict(o)
		if node == nil {
			return true
		}
		kids, hasKids := d.resolve(node["Kids"]).(Array)
		if d.name(node["Type"]) == "Page" || (!hasKids && d.name(node["Type"]) != "Pages") {
			if i == n {
				found = node
				chain = parents
				return false
			}
			i++
			return true
		}
		if c := d.integer(node["Count"], -1); c >= 0 && i+c <= n && depth > 0 {
			i += c
			return true
		}
		next := append(append([]Dict{}, parents...), node)
		for _, k := range kids {
			if !walk(k, depth+1, next) {
				return false
			}
		}
		return true
	}
	walk(cat["Pages"], 0, nil)
	if found == nil {
		return nil, ErrNoPage
	}
	inherit := func(key Name) Object {
		if v, ok := found[key]; ok && v != nil {
			return v
		}
		for j := len(chain) - 1; j >= 0; j-- {
			if v, ok := chain[j][key]; ok && v != nil {
				return v
			}
		}
		return nil
	}
	pg := &Page{Dict: found, Resources: d.dict(inherit("Resources"))}
	pg.MediaBox = d.rect(inherit("MediaBox"), [4]float64{0, 0, 612, 792})
	pg.CropBox = d.rect(inherit("CropBox"), pg.MediaBox)
	//The crop box is clipped to the media box
	pg.CropBox[0] = math.Max(pg.CropBox[0], pg.MediaBox[0])
	pg.CropBox[1] = math.Max(pg.CropBox[1], pg.MediaBox[1])
	pg.CropBox[2] = math.Min(pg.CropBox[2], pg.MediaBox[2])
	pg.CropBox[3] = math.Min(pg.CropBox[3], pg.MediaBox[3])
	if pg.CropBox[2]-pg.CropBox[0] < 1 || pg.CropBox[3]-pg.CropBox[1] < 1 {
		pg.CropBox = pg.MediaBox
	}
	rot := d.integer(inherit("Rotate"), 0) % 360
	if rot < 0 {
		rot += 360
	}
	pg.Rotate = (rot / 90) * 90
	return pg, nil
}

// rect reads a normalised rectangle, or def when it is missing or degenerate
func (d *Document) rect(o Object, def [4]float64) [4]float64 {
	v := d.numbers(o)
	if len(v) < 4 {
		return def
	}
	r := [4]float64{math.Min(v[0], v[2]), math.Min(v[1], v[3]), math.Max(v[0], v[2]), math.Max(v[1], v[3])}
	if r[2]-r[0] < 1 || r[3]-r[1] < 1 || r[2]-r[0] > 1e6 || r[3]-r[1] > 1e6 {
		return def
	}
	return r
}

// Size returns the displayed page size in points, rotation applied
func (p *Page) Size() (float64, float64) {
	w := p.CropBox[2] - p.CropBox[0]
	h := p.CropBox[3] - p.CropBox[1]
	if p.Rotate == 90 || p.Rotate == 270 {
		return h, w
	}
	return w, h
}
