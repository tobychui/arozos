package fonts

/*
	gsub.go

	A slice keeps only some glyphs, so it must also keep every glyph the
	browser can substitute for them: ligatures, contextual alternates, local
	forms, jamo for Korean and so on. This reads the GSUB lookups behind the
	features a browser applies without being asked and turns them into plain
	"glyph A can become glyph B" rules, which closure() follows until nothing
	new is reached.

	The rules are a superset: a contextual lookup's nested lookups are applied
	without checking the context. Keeping a few glyphs too many is harmless;
	missing one draws a blank.
*/

import (
	"encoding/binary"
	"errors"
)

// defaultFeatures are the GSUB features browsers apply on their own
var defaultFeatures = map[string]bool{
	"ccmp": true, "locl": true, "rlig": true, "liga": true, "clig": true, "calt": true, "rclt": true,
	"rvrn": true, "ljmo": true, "vjmo": true, "tjmo": true,
	"isol": true, "init": true, "medi": true, "med2": true, "fina": true, "fin2": true, "fin3": true,
	"nukt": true, "akhn": true, "rphf": true, "rkrf": true, "pref": true, "blwf": true, "abvf": true,
	"half": true, "pstf": true, "vatu": true, "cjct": true, "pres": true, "abvs": true, "blws": true,
	"psts": true, "haln": true,
}

// maxRules bounds the rules a GSUB table may produce
const maxRules = 4 << 20

type glyphPair struct{ in, out uint16 }

type ligature struct {
	components []uint16
	out        uint16
}

type substRules struct {
	pairs     []glyphPair
	ligatures []ligature
}

// parseGSUB collects the substitutions of the default features. A font with
// no GSUB, or one this cannot read, yields no rules.
func parseGSUB(table []byte, numGlyphs int) (*substRules, error) {
	rules := &substRules{}
	if table == nil {
		return rules, nil
	}
	minor, err1 := u16(table, 2)
	featureList, err2 := u16(table, 6)
	lookupList, err3 := u16(table, 8)
	if err1 != nil || err2 != nil || err3 != nil {
		return nil, errTruncated
	}
	if featureList == 0 || lookupList == 0 {
		return rules, nil
	}

	p := &gsubParser{table: table, numGlyphs: numGlyphs, rules: rules, visited: map[int]bool{}}
	lookupCount, err := u16(table, int(lookupList))
	if err != nil {
		return nil, err
	}
	p.lookupList, p.lookupCount = int(lookupList), int(lookupCount)

	// lookups of the default features
	featureCount, err := u16(table, int(featureList))
	if err != nil {
		return nil, err
	}
	tags := make([]string, featureCount)
	for i := 0; i < int(featureCount); i++ {
		rec, err := sub(table, int64(featureList)+2+6*int64(i), 6)
		if err != nil {
			return nil, err
		}
		tags[i] = string(rec[:4])
		if defaultFeatures[tags[i]] {
			p.queueFeature(int(featureList) + int(binary.BigEndian.Uint16(rec[4:])))
		}
	}

	// and their replacements under variation conditions (GSUB 1.1)
	if minor >= 1 {
		if fv, err := u32(table, 10); err == nil && fv != 0 {
			p.queueFeatureVariations(int64(fv), tags)
		}
	}

	for len(p.queue) > 0 {
		index := p.queue[0]
		p.queue = p.queue[1:]
		if err := p.lookup(index); err != nil {
			return nil, err
		}
	}
	return rules, nil
}

type gsubParser struct {
	table       []byte
	numGlyphs   int
	rules       *substRules
	lookupList  int
	lookupCount int
	queue       []int
	visited     map[int]bool
	ruleCount   int
}

func (p *gsubParser) enqueue(index int) {
	if index < p.lookupCount && !p.visited[index] {
		p.visited[index] = true
		p.queue = append(p.queue, index)
	}
}

func (p *gsubParser) queueFeature(off int) {
	count, err := u16(p.table, off+2)
	if err != nil {
		return
	}
	for i := 0; i < int(count); i++ {
		if index, err := u16(p.table, off+4+2*i); err == nil {
			p.enqueue(int(index))
		}
	}
}

func (p *gsubParser) queueFeatureVariations(off int64, tags []string) {
	if off > int64(len(p.table)) {
		return
	}
	count, err := u32(p.table, int(off)+4)
	if err != nil {
		return
	}
	for i := int64(0); i < int64(count) && i < 4096; i++ {
		fts, err := u32(p.table, int(off+8+8*i+4))
		if err != nil || fts == 0 {
			return
		}
		ftsOff := off + int64(fts)
		if ftsOff > int64(len(p.table)) {
			continue
		}
		n, err := u16(p.table, int(ftsOff)+4)
		if err != nil {
			continue
		}
		for k := int64(0); k < int64(n); k++ {
			featureIndex, err1 := u16(p.table, int(ftsOff+6+6*k))
			alt, err2 := u32(p.table, int(ftsOff+8+6*k))
			if err1 != nil || err2 != nil {
				break
			}
			if int(featureIndex) < len(tags) && defaultFeatures[tags[featureIndex]] && ftsOff+int64(alt) < int64(len(p.table)) {
				p.queueFeature(int(ftsOff + int64(alt)))
			}
		}
	}
}

func (p *gsubParser) addPair(in, out uint16) error {
	if int(in) >= p.numGlyphs || int(out) >= p.numGlyphs {
		return nil
	}
	p.ruleCount++
	if p.ruleCount > maxRules {
		return errors.New("the GSUB table is too large")
	}
	p.rules.pairs = append(p.rules.pairs, glyphPair{in, out})
	return nil
}

func (p *gsubParser) lookup(index int) error {
	rel, err := u16(p.table, p.lookupList+2+2*index)
	if err != nil {
		return nil
	}
	off := p.lookupList + int(rel)
	kind, err1 := u16(p.table, off)
	count, err2 := u16(p.table, off+4)
	if err1 != nil || err2 != nil {
		return nil
	}
	for i := 0; i < int(count); i++ {
		subRel, err := u16(p.table, off+6+2*i)
		if err != nil {
			return nil
		}
		subOff := off + int(subRel)
		subKind := kind
		if kind == 7 {
			extKind, err1 := u16(p.table, subOff+2)
			extOff, err2 := u32(p.table, subOff+4)
			if err1 != nil || err2 != nil || extKind == 7 || int64(subOff)+int64(extOff) > int64(len(p.table)) {
				continue
			}
			subKind, subOff = extKind, subOff+int(extOff)
		}
		if err := p.subtable(subKind, subOff); err != nil {
			return err
		}
	}
	return nil
}

// coverage returns the glyphs of a coverage table in coverage index order
func (p *gsubParser) coverage(off int) []uint16 {
	format, err := u16(p.table, off)
	if err != nil {
		return nil
	}
	count, err := u16(p.table, off+2)
	if err != nil {
		return nil
	}
	switch format {
	case 1:
		glyphs := make([]uint16, 0, count)
		for i := 0; i < int(count); i++ {
			g, err := u16(p.table, off+4+2*i)
			if err != nil {
				break
			}
			glyphs = append(glyphs, g)
		}
		return glyphs
	case 2:
		var glyphs []uint16
		for i := 0; i < int(count); i++ {
			start, err1 := u16(p.table, off+4+6*i)
			end, err2 := u16(p.table, off+6+6*i)
			index, err3 := u16(p.table, off+8+6*i)
			if err1 != nil || err2 != nil || err3 != nil || start > end {
				break
			}
			need := int(index) + int(end-start) + 1
			if need > 0x10000 {
				break
			}
			for len(glyphs) < need {
				glyphs = append(glyphs, 0xFFFF) // index without a glyph
			}
			for g := int(start); g <= int(end); g++ {
				glyphs[int(index)+g-int(start)] = uint16(g)
			}
		}
		return glyphs
	}
	return nil
}

func (p *gsubParser) subtable(kind uint16, off int) error {
	format, err := u16(p.table, off)
	if err != nil {
		return nil
	}
	switch kind {
	case 1: // single
		covOff, err := u16(p.table, off+2)
		if err != nil {
			return nil
		}
		cov := p.coverage(off + int(covOff))
		if format == 1 {
			delta, err := u16(p.table, off+4)
			if err != nil {
				return nil
			}
			for _, g := range cov {
				if err := p.addPair(g, g+delta); err != nil {
					return err
				}
			}
		} else if format == 2 {
			for i, g := range cov {
				out, err := u16(p.table, off+6+2*i)
				if err != nil {
					break
				}
				if err := p.addPair(g, out); err != nil {
					return err
				}
			}
		}

	case 2, 3: // multiple, alternate: every glyph of the sequence / set
		covOff, err := u16(p.table, off+2)
		if err != nil {
			return nil
		}
		cov := p.coverage(off + int(covOff))
		for i, g := range cov {
			seqRel, err := u16(p.table, off+6+2*i)
			if err != nil {
				break
			}
			seq := off + int(seqRel)
			n, err := u16(p.table, seq)
			if err != nil {
				continue
			}
			for k := 0; k < int(n); k++ {
				out, err := u16(p.table, seq+2+2*k)
				if err != nil {
					break
				}
				if err := p.addPair(g, out); err != nil {
					return err
				}
			}
		}

	case 4: // ligature
		covOff, err := u16(p.table, off+2)
		if err != nil {
			return nil
		}
		cov := p.coverage(off + int(covOff))
		for i, first := range cov {
			setRel, err := u16(p.table, off+6+2*i)
			if err != nil {
				break
			}
			set := off + int(setRel)
			n, err := u16(p.table, set)
			if err != nil {
				continue
			}
			for k := 0; k < int(n); k++ {
				ligRel, err := u16(p.table, set+2+2*k)
				if err != nil {
					break
				}
				lig := set + int(ligRel)
				out, err1 := u16(p.table, lig)
				comps, err2 := u16(p.table, lig+2)
				if err1 != nil || err2 != nil || comps == 0 || int(out) >= p.numGlyphs {
					continue
				}
				l := ligature{components: []uint16{first}, out: out}
				for c := 1; c < int(comps); c++ {
					g, err := u16(p.table, lig+2+2*c)
					if err != nil {
						break
					}
					l.components = append(l.components, g)
				}
				p.ruleCount++
				if p.ruleCount > maxRules {
					return errors.New("the GSUB table is too large")
				}
				p.rules.ligatures = append(p.rules.ligatures, l)
			}
		}

	case 5, 6: // contextual: queue the nested lookups
		p.nestedLookups(kind, format, off)

	case 8: // reverse chaining single
		covOff, err := u16(p.table, off+2)
		if err != nil {
			return nil
		}
		cov := p.coverage(off + int(covOff))
		pos := off + 4
		for i := 0; i < 2; i++ { // skip the backtrack and lookahead coverages
			n, err := u16(p.table, pos)
			if err != nil {
				return nil
			}
			pos += 2 + 2*int(n)
		}
		n, err := u16(p.table, pos)
		if err != nil {
			return nil
		}
		for i := 0; i < int(n) && i < len(cov); i++ {
			out, err := u16(p.table, pos+2+2*i)
			if err != nil {
				break
			}
			if err := p.addPair(cov[i], out); err != nil {
				return err
			}
		}
	}
	return nil
}

// nestedLookups reads the SubstLookupRecords of a (chained) context subtable
func (p *gsubParser) nestedLookups(kind, format uint16, off int) {
	records := func(pos, count int) {
		for i := 0; i < count; i++ {
			if index, err := u16(p.table, pos+4*i+2); err == nil {
				p.enqueue(int(index))
			}
		}
	}
	// rule reads one rule (formats 1 and 2) starting at pos
	rule := func(pos int) {
		if kind == 5 {
			glyphs, err1 := u16(p.table, pos)
			substs, err2 := u16(p.table, pos+2)
			if err1 != nil || err2 != nil || glyphs == 0 {
				return
			}
			records(pos+4+2*(int(glyphs)-1), int(substs))
			return
		}
		backtrack, err := u16(p.table, pos)
		if err != nil {
			return
		}
		pos += 2 + 2*int(backtrack)
		input, err := u16(p.table, pos)
		if err != nil || input == 0 {
			return
		}
		pos += 2 + 2*(int(input)-1)
		lookahead, err := u16(p.table, pos)
		if err != nil {
			return
		}
		pos += 2 + 2*int(lookahead)
		substs, err := u16(p.table, pos)
		if err != nil {
			return
		}
		records(pos+2, int(substs))
	}
	// ruleSets walks an array of rule set offsets
	ruleSets := func(countPos, firstPos int) {
		count, err := u16(p.table, countPos)
		if err != nil {
			return
		}
		for i := 0; i < int(count); i++ {
			setRel, err := u16(p.table, firstPos+2*i)
			if err != nil || setRel == 0 {
				continue
			}
			set := off + int(setRel)
			n, err := u16(p.table, set)
			if err != nil {
				continue
			}
			for k := 0; k < int(n); k++ {
				if ruleRel, err := u16(p.table, set+2+2*k); err == nil {
					rule(set + int(ruleRel))
				}
			}
		}
	}

	switch {
	case format == 1:
		ruleSets(off+4, off+6)
	case format == 2 && kind == 5:
		ruleSets(off+6, off+8)
	case format == 2 && kind == 6:
		ruleSets(off+10, off+12)
	case format == 3 && kind == 5:
		glyphs, err1 := u16(p.table, off+2)
		substs, err2 := u16(p.table, off+4)
		if err1 == nil && err2 == nil {
			records(off+6+2*int(glyphs), int(substs))
		}
	case format == 3 && kind == 6:
		pos := off + 2
		for i := 0; i < 3; i++ {
			n, err := u16(p.table, pos)
			if err != nil {
				return
			}
			pos += 2 + 2*int(n)
		}
		if substs, err := u16(p.table, pos); err == nil {
			records(pos+2, int(substs))
		}
	}
}

// closure marks every glyph the rules can reach from the kept ones. It
// reports whether it added anything.
func (r *substRules) closure(keep []bool) bool {
	grew := false
	for pass := 0; pass < 64; pass++ {
		changed := false
		for _, p := range r.pairs {
			if keep[p.in] && !keep[p.out] {
				keep[p.out] = true
				changed = true
			}
		}
	next:
		for _, l := range r.ligatures {
			if keep[l.out] {
				continue
			}
			for _, c := range l.components {
				if int(c) >= len(keep) || !keep[c] {
					continue next
				}
			}
			keep[l.out] = true
			changed = true
		}
		if !changed {
			break
		}
		grew = true
	}
	return grew
}
