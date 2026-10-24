package fonts

/*
	sources.go

	The library as documents use it. The Office apps set text in an
	installed family by its own name, the way they use the faces they ship:
	a page declares every face itself from Sources (the slice files
	fonts.css names, each with its unicode-range), and the Office PDF export
	embeds the whole font from FileData, the way it embeds a shipped face.

	Both only need a login - any user may set text in the system fonts. Only
	an administrator installs or removes them (manage.go).

	A face is handed over whole only when a document may embed it: its
	licence allows that (OS/2 fsType, Info.NoEmbed), and its tables are all
	here (a WOFF2 upload with transformed glyph tables is served to the
	browser as it is, but cannot be rebuilt into a font file here).

	The file handed over is the installed one when it can be, else a copy
	made once and kept in the cache folder: a WOFF / WOFF2 upload unpacked,
	and a TrueType font whose glyphs are not padded to an even length padded
	(padGlyphs). The font is the same; the padding is for fontkit, which the
	PDF export subsets with: it pads each glyph it copies in loca but not in
	glyf, so after the first odd-length glyph every glyph of the subset was
	read a byte off and drew garbage, or nothing.
*/

import (
	"encoding/binary"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// SliceView is one file a face is loaded from and the characters it holds
type SliceView struct {
	Name  string `json:"name"`  // slice/<key>/<name>.woff2 below the fonts folder
	Range string `json:"range"` // CSS unicode-range, "" for the whole font
}

// SourceFace is one face of a family as a page declares it
type SourceFace struct {
	Key       string      `json:"key"`
	Style     string      `json:"style"`
	WeightMin int         `json:"weightMin"`
	WeightMax int         `json:"weightMax"`
	Italic    bool        `json:"italic"`
	Variable  bool        `json:"variable"`
	Embed     bool        `json:"embed"` // a document may embed it (FileData)
	File      string      `json:"file"`  // the whole font below the fonts folder, "" without Embed
	Slices    []SliceView `json:"slices"`
}

// SourceFamily is one installed family and its faces
type SourceFamily struct {
	Name  string       `json:"name"`
	Faces []SourceFace `json:"faces"`
}

// embeddable reports whether a document may carry the face
func embeddable(f *Face) bool {
	return f.plain && !f.Info.NoEmbed
}

// fileExt is the extension FileData's font goes by
func fileExt(f *Face) string {
	if f.Info.Outline == "cff" {
		return ".otf"
	}
	return ".ttf"
}

// Sources lists every installed family with the files of its faces
func (l *Library) Sources() []SourceFamily {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]SourceFamily, 0, len(l.families))
	for _, fam := range l.families {
		sf := SourceFamily{Name: fam.Name, Faces: []SourceFace{}}
		for _, f := range fam.Faces {
			v := SourceFace{
				Key: f.Key, Style: f.Info.Style,
				WeightMin: f.Info.WeightMin, WeightMax: f.Info.WeightMax,
				Italic: f.Info.Italic, Variable: f.Info.Variable,
				Embed: embeddable(f), Slices: []SliceView{},
			}
			if v.Embed {
				v.File = "file/" + f.Key + fileExt(f)
			}
			if f.sliced {
				for _, c := range f.cold {
					v.Slices = append(v.Slices, SliceView{Name: c.name, Range: c.ranges})
				}
			} else {
				v.Slices = append(v.Slices, SliceView{Name: "all"})
			}
			sf.Faces = append(sf.Faces, v)
		}
		out = append(out, sf)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

// embeddedFace returns the face a key names when a document may embed it
func (l *Library) embeddedFace(key string) *Face {
	l.mu.RLock()
	face := l.faces[key]
	l.mu.RUnlock()
	if face == nil || !embeddable(face) {
		return nil
	}
	return face
}

// glyphsAligned reports whether every glyph of a TrueType font starts on an
// even offset; a font without glyf / loca has nothing to align
func glyphsAligned(font *Font, numGlyphs int) bool {
	if font.Table("glyf") == nil || font.Table("loca") == nil {
		return true
	}
	offsets, err := glyphOffsets(font, numGlyphs)
	if err != nil {
		return true // a damaged loca is not ours to rewrite
	}
	for _, o := range offsets {
		if o%2 != 0 {
			return false
		}
	}
	return true
}

// padGlyphs rewrites glyf so every glyph starts on a 4-byte boundary, with
// a long loca to match. Only the padding between glyphs changes.
func padGlyphs(tables map[string][]byte) error {
	maxp := tables["maxp"]
	if len(maxp) < 6 || len(tables["head"]) < 54 {
		return errors.New("the maxp or head table is damaged")
	}
	n := int(binary.BigEndian.Uint16(maxp[4:]))
	font := &Font{Tables: tables}
	offsets, err := glyphOffsets(font, n)
	if err != nil {
		return err
	}
	glyf := tables["glyf"]
	out := make([]byte, 0, len(glyf)+3*n)
	loca := make([]byte, 4*(n+1))
	for i := 0; i < n; i++ {
		binary.BigEndian.PutUint32(loca[4*i:], uint32(len(out)))
		out = append(out, glyf[offsets[i]:offsets[i+1]]...)
		for len(out)%4 != 0 {
			out = append(out, 0)
		}
	}
	binary.BigEndian.PutUint32(loca[4*n:], uint32(len(out)))
	head := append([]byte(nil), tables["head"]...)
	binary.BigEndian.PutUint16(head[50:], 1) // indexToLocFormat: long
	tables["glyf"], tables["loca"], tables["head"] = out, loca, head
	return nil
}

// FilePath returns the font file a face is handed over as - the installed
// file, or a copy made on first use (see above) - and its extension
func (l *Library) FilePath(key string) (string, string, error) {
	face := l.embeddedFace(key)
	if face == nil {
		return "", "", ErrNotFound
	}
	ext := fileExt(face)
	if (face.Format == "ttf" || face.Format == "otf") && face.aligned {
		return face.path, ext, nil
	}
	target := filepath.Join(l.opts.CacheDir, face.Key, "whole"+ext)
	if _, err := os.Stat(target); err == nil {
		return target, ext, nil
	}

	l.genMu.Lock()
	lock := l.inflight[target]
	if lock == nil {
		lock = &sync.Mutex{}
		l.inflight[target] = lock
	}
	l.genMu.Unlock()
	lock.Lock()
	defer func() {
		lock.Unlock()
		l.genMu.Lock()
		delete(l.inflight, target)
		l.genMu.Unlock()
	}()
	if _, err := os.Stat(target); err == nil {
		return target, ext, nil // made while we waited
	}

	data, err := os.ReadFile(face.path)
	if err != nil {
		return "", "", err
	}
	font, _, err := Decode(data)
	if err != nil {
		return "", "", err
	}
	tables := make(map[string][]byte, len(font.Tables))
	for tag, t := range font.Tables {
		tables[tag] = t
	}
	if !face.aligned {
		if err := padGlyphs(tables); err != nil {
			return "", "", err
		}
	}
	sfnt, err := AssembleSFNT(font.Flavor, tables)
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return "", "", err
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, sfnt, 0644); err != nil {
		return "", "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		os.Remove(tmp)
		return "", "", err
	}
	return target, ext, nil
}

// FileData returns a face as an OpenType font file (FilePath) and its
// extension
func (l *Library) FileData(key string) ([]byte, string, error) {
	file, ext, err := l.FilePath(key)
	if err != nil {
		return nil, "", err
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, "", err
	}
	return data, ext, nil
}

// ServeFile answers a request for a whole font, named "<key>.ttf" or
// "<key>.otf" as Sources lists it
func (l *Library) ServeFile(w http.ResponseWriter, r *http.Request, name string) {
	key, ext, ok := strings.Cut(name, ".")
	face := l.embeddedFace(key)
	if !ok || face == nil || "."+ext != fileExt(face) {
		http.NotFound(w, r)
		return
	}
	file, _, err := l.FilePath(key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// the key changes with the font
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "font/"+ext)
	http.ServeContent(w, r, name, st.ModTime(), f)
}
