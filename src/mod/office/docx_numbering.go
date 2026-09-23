package office

/*
	docx_numbering.go - list numbering definitions (numbering.xml) and the
	counters that turn them into marker text.

	A Word list paragraph only says "numId 6, level 1". What that looks like
	- "b.", "ii)", "1.2.", a bullet glyph - and where the marker and the text
	sit lives in the abstract numbering definition the numId points at,
	possibly overridden per numId. The counters belong to the numId and run
	through the whole document, so a list interrupted by a paragraph carries
	on at the next number.
*/

import (
	"strconv"
	"strings"
)

type docxNumLevel struct {
	fmt      string // decimal, lowerLetter, upperLetter, lowerRoman, upperRoman, bullet, none ...
	text     string // lvlText, e.g. "%1." or a bullet glyph
	start    int
	indL     optNum // twips
	indHang  optNum
	indFirst optNum
	rPr      docxRPr
	restart  optNum // lvlRestart
}

type docxNumDefs struct {
	abstract map[string]map[int]*docxNumLevel // abstractNumId -> levels
	nums     map[string]string                // numId -> abstractNumId
	override map[string]map[int]*docxNumLevel // numId -> overridden levels
	startOvr map[string]map[int]int           // numId -> startOverride
	counters map[string][]int                 // numId -> current value per level
	started  map[string][]bool
}

func parseNumbering(raw []byte) *docxNumDefs {
	nb := &docxNumDefs{
		abstract: map[string]map[int]*docxNumLevel{},
		nums:     map[string]string{},
		override: map[string]map[int]*docxNumLevel{},
		startOvr: map[string]map[int]int{},
		counters: map[string][]int{},
		started:  map[string][]bool{},
	}
	if raw == nil {
		return nb
	}
	tree, err := parseXMLTree(raw)
	if err != nil {
		return nb
	}
	for _, an := range tree.all("abstractNum") {
		levels := map[int]*docxNumLevel{}
		for _, lvl := range an.all("lvl") {
			idx, err := strconv.Atoi(lvl.attr("ilvl"))
			if err != nil {
				continue
			}
			levels[idx] = parseNumLevel(lvl)
		}
		nb.abstract[an.attr("abstractNumId")] = levels
	}
	for _, num := range tree.all("num") {
		id := num.attr("numId")
		if ref := num.first("abstractNumId"); ref != nil {
			nb.nums[id] = ref.attr("val")
		}
		for _, ov := range num.all("lvlOverride") {
			idx, err := strconv.Atoi(ov.attr("ilvl"))
			if err != nil {
				continue
			}
			if so := ov.first("startOverride"); so != nil {
				if v, err := strconv.Atoi(so.attr("val")); err == nil {
					if nb.startOvr[id] == nil {
						nb.startOvr[id] = map[int]int{}
					}
					nb.startOvr[id][idx] = v
				}
			}
			if lvl := ov.first("lvl"); lvl != nil {
				if nb.override[id] == nil {
					nb.override[id] = map[int]*docxNumLevel{}
				}
				nb.override[id][idx] = parseNumLevel(lvl)
			}
		}
	}
	return nb
}

func parseNumLevel(lvl *xnode) *docxNumLevel {
	l := &docxNumLevel{fmt: "decimal", start: 1}
	if f := lvl.first("numFmt"); f != nil {
		l.fmt = f.attr("val")
	}
	if t := lvl.first("lvlText"); t != nil {
		l.text = t.attr("val")
	}
	if s := lvl.first("start"); s != nil {
		if v, err := strconv.Atoi(s.attr("val")); err == nil {
			l.start = v
		}
	}
	l.restart = numAttr(lvl.first("lvlRestart"), "val")
	if ppr := lvl.first("pPr"); ppr != nil {
		p := parsePPr(ppr)
		l.indL, l.indHang, l.indFirst = p.indL, p.indHang, p.indFirst
	}
	l.rPr = parseRPr(lvl.first("rPr"))
	return l
}

// level returns the definition of one level of a list instance
func (nb *docxNumDefs) level(numID string, ilvl int) *docxNumLevel {
	if ov, ok := nb.override[numID]; ok {
		if l, ok := ov[ilvl]; ok {
			return l
		}
	}
	if levels, ok := nb.abstract[nb.nums[numID]]; ok {
		if l, ok := levels[ilvl]; ok {
			return l
		}
	}
	return nil
}

// exists reports whether numID names a real list (numId 0 switches
// numbering off for a paragraph whose style would otherwise number it)
func (nb *docxNumDefs) exists(numID string) bool {
	if numID == "" || numID == "0" {
		return false
	}
	_, ok := nb.nums[numID]
	return ok
}

// next advances the counter for an item at ilvl and returns its value
func (nb *docxNumDefs) next(numID string, ilvl int) int {
	c := nb.counters[numID]
	st := nb.started[numID]
	if c == nil {
		c = make([]int, 9)
		st = make([]bool, 9)
	}
	if ilvl < 0 {
		ilvl = 0
	}
	if ilvl > 8 {
		ilvl = 8
	}
	startOf := func(l int) int {
		if so, ok := nb.startOvr[numID][l]; ok {
			return so
		}
		if def := nb.level(numID, l); def != nil {
			return def.start
		}
		return 1
	}
	if !st[ilvl] {
		c[ilvl] = startOf(ilvl)
		st[ilvl] = true
	} else {
		c[ilvl]++
	}
	// an item restarts every deeper level
	for l := ilvl + 1; l < 9; l++ {
		st[l] = false
	}
	// shallower levels that never had an item count as their start value
	for l := 0; l < ilvl; l++ {
		if !st[l] {
			c[l] = startOf(l)
		}
	}
	nb.counters[numID] = c
	nb.started[numID] = st
	return c[ilvl]
}

// htmlListFormat maps a Word number format onto the editor's list format
// names (the same vocabulary docs_layout.js understands)
func htmlListFormat(f string) string {
	switch f {
	case "bullet", "decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman", "none":
		return f
	case "decimalZero":
		return "decimalZero"
	}
	return "decimal"
}

// formatListNumber renders one counter value in a Word number format
func formatListNumber(v int, f string) string {
	switch f {
	case "lowerLetter", "upperLetter":
		s := alphaNumber(v)
		if f == "upperLetter" {
			return strings.ToUpper(s)
		}
		return s
	case "lowerRoman":
		return strings.ToLower(romanNumber(v))
	case "upperRoman":
		return romanNumber(v)
	case "decimalZero":
		if v < 10 {
			return "0" + strconv.Itoa(v)
		}
	case "none", "bullet":
		return ""
	}
	return strconv.Itoa(v)
}

// alphaNumber: 1 -> a, 26 -> z, 27 -> aa (Word repeats the letter)
func alphaNumber(v int) string {
	if v < 1 {
		return ""
	}
	letter := string(rune('a' + (v-1)%26))
	return strings.Repeat(letter, (v-1)/26+1)
}

func romanNumber(v int) string {
	if v < 1 || v > 3999 {
		return strconv.Itoa(v)
	}
	vals := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	syms := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var sb strings.Builder
	for i, n := range vals {
		for v >= n {
			sb.WriteString(syms[i])
			v -= n
		}
	}
	return sb.String()
}
