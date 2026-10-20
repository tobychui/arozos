package fonts

/*
	manage.go

	Installing and removing fonts, and the description of the library the
	System Fonts page shows.
*/

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// FaceView describes one font file for the settings page
type FaceView struct {
	ID         string `json:"id"`
	Family     string `json:"family"`
	File       string `json:"file"`
	Style      string `json:"style"`
	WeightMin  int    `json:"weightMin"`
	WeightMax  int    `json:"weightMax"`
	Italic     bool   `json:"italic"`
	Variable   bool   `json:"variable"`
	Format     string `json:"format"`
	Size       int64  `json:"size"`
	Glyphs     int    `json:"glyphs"`
	Codepoints int    `json:"codepoints"`
	Sliced     bool   `json:"sliced"`
}

// FamilyView describes one family for the settings page
type FamilyView struct {
	Name       string     `json:"name"`
	Preview    string     `json:"preview"`
	Faces      []FaceView `json:"faces"`
	WeightMin  int        `json:"weightMin"`
	WeightMax  int        `json:"weightMax"`
	Italic     bool       `json:"italic"`
	Variable   bool       `json:"variable"`
	Scripts    []string   `json:"scripts"`
	Languages  []string   `json:"languages"`
	Size       int64      `json:"size"`
	Designer   string     `json:"designer"`
	License    string     `json:"license"`
	LicenseURL string     `json:"licenseURL"`
	Version    string     `json:"version"`
}

func faceView(f *Face) FaceView {
	return FaceView{
		ID: f.ID, Family: f.Info.Family, File: path.Base(f.ID), Style: f.Info.Style,
		WeightMin: f.Info.WeightMin, WeightMax: f.Info.WeightMax,
		Italic: f.Info.Italic, Variable: f.Info.Variable, Format: f.Format, Size: f.Size,
		Glyphs: f.Info.Glyphs, Codepoints: f.Info.Codepoints, Sliced: f.sliced,
	}
}

// Families describes every installed family; langs are the languages to
// test support for
func (l *Library) Families(langs []string) []FamilyView {
	l.mu.RLock()
	fams := make([]*Family, 0, len(l.families))
	for _, f := range l.families {
		fams = append(fams, f)
	}
	l.mu.RUnlock()
	sort.Slice(fams, func(i, j int) bool { return strings.ToLower(fams[i].Name) < strings.ToLower(fams[j].Name) })

	out := make([]FamilyView, 0, len(fams))
	for _, fam := range fams {
		v := FamilyView{Name: fam.Name, Preview: PreviewName(fam.Name), WeightMin: 1000, Scripts: []string{}, Languages: []string{}}
		scripts := map[string]bool{}
		for _, f := range fam.Faces {
			v.Faces = append(v.Faces, faceView(f))
			v.Size += f.Size
			v.WeightMin = min(v.WeightMin, f.Info.WeightMin)
			v.WeightMax = max(v.WeightMax, f.Info.WeightMax)
			v.Italic = v.Italic || f.Info.Italic
			v.Variable = v.Variable || f.Info.Variable
			v.Designer = firstOf(v.Designer, f.Info.Designer)
			v.License = firstOf(v.License, f.Info.License)
			v.LicenseURL = firstOf(v.LicenseURL, f.Info.LicenseURL)
			v.Version = firstOf(v.Version, f.Info.Version)
			for _, s := range f.Info.Scripts {
				scripts[s] = true
			}
		}
		for _, s := range scriptRanges {
			if scripts[s.id] {
				v.Scripts = append(v.Scripts, s.id)
			}
		}
		for _, lang := range langs {
			if l.coverage(fam, strings.ToLower(lang)) >= 0.9 {
				v.Languages = append(v.Languages, strings.ToLower(lang))
			}
		}
		out = append(out, v)
	}
	return out
}

// dirName turns a family name into a folder name
func dirName(family string) string {
	name := strings.Trim(unsafeName.ReplaceAllString(strings.ReplaceAll(family, " ", "_"), ""), "._-")
	if name == "" {
		name = fmt.Sprintf("Font_%x", []byte(family))
		if len(name) > 40 {
			name = name[:40]
		}
	}
	return name
}

// Install checks an uploaded font and adds it to the library. WOFF files
// are unpacked to TTF / OTF so they can be sliced.
func (l *Library) Install(filename string, data []byte) (FaceView, error) {
	if len(data) > MaxFontSize {
		return FaceView{}, fmt.Errorf("the font is larger than %d MB", MaxFontSize>>20)
	}
	font, container, err := Decode(data)
	if err != nil {
		return FaceView{}, err
	}
	info, _, err := Inspect(font)
	if err != nil {
		return FaceView{}, err
	}

	ext := ".ttf"
	if font.IsCFF() {
		ext = ".otf"
	}
	switch container {
	case "woff":
		tables := map[string][]byte{}
		for tag, t := range font.Tables {
			tables[tag] = t
		}
		if data, err = AssembleSFNT(font.Flavor, tables); err != nil {
			return FaceView{}, err
		}
	case "woff2":
		ext = ".woff2"
	}

	if fam := l.family(info.Family); fam != nil {
		for _, f := range fam.Faces {
			if f.Info.Italic == info.Italic && f.Info.Variable == info.Variable &&
				f.Info.WeightMin == info.WeightMin && f.Info.WeightMax == info.WeightMax {
				return FaceView{}, fmt.Errorf("%s %s is already installed", fam.Name, f.Info.Style)
			}
		}
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	dir := dirName(info.Family)
	if fam := l.families[strings.ToLower(info.Family)]; fam != nil && fam.Dir != "" {
		dir = fam.Dir
	}
	base := strings.TrimSuffix(filepath.Base(filepath.ToSlash(filename)), filepath.Ext(filename))
	base = strings.Trim(unsafeName.ReplaceAllString(base, "_"), "._-")
	if base == "" {
		base = dirName(info.Family + " " + info.Style)
	}
	if err := os.MkdirAll(filepath.Join(l.opts.Root, dir), 0755); err != nil {
		return FaceView{}, err
	}
	id := path.Join(dir, base+ext)
	for n := 2; ; n++ {
		if _, err := os.Stat(filepath.Join(l.opts.Root, filepath.FromSlash(id))); os.IsNotExist(err) {
			break
		}
		id = path.Join(dir, fmt.Sprintf("%s-%d%s", base, n, ext))
	}

	target := filepath.Join(l.opts.Root, filepath.FromSlash(id))
	if err := os.WriteFile(target+".tmp", data, 0644); err != nil {
		return FaceView{}, err
	}
	if err := os.Rename(target+".tmp", target); err != nil {
		os.Remove(target + ".tmp")
		return FaceView{}, err
	}

	face, err := l.readFace(id)
	if err != nil {
		os.Remove(target)
		return FaceView{}, err
	}
	key := strings.ToLower(face.Info.Family)
	fam := l.families[key]
	if fam == nil {
		fam = &Family{Name: face.Info.Family, Dir: dir}
		l.families[key] = fam
	}
	fam.Faces = append(fam.Faces, face)
	sortFaces(fam.Faces)
	l.faces[face.Key] = face
	return faceView(face), nil
}

// Delete removes a family: its font files, its folder when nothing else
// is left in it, and its generated slices
func (l *Library) Delete(family string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := strings.ToLower(family)
	fam := l.families[key]
	if fam == nil {
		return ErrNotFound
	}
	root, err := filepath.Abs(l.opts.Root)
	if err != nil {
		return err
	}
	for _, face := range fam.Faces {
		full, err := filepath.Abs(face.path)
		if err != nil || !strings.HasPrefix(full, root+string(filepath.Separator)) {
			return errors.New("refusing to delete a file outside the font folder")
		}
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			return err
		}
		os.RemoveAll(filepath.Join(l.opts.CacheDir, face.Key))
		delete(l.faces, face.Key)
	}
	delete(l.families, key)

	if fam.Dir != "" {
		dir := filepath.Join(root, fam.Dir)
		left := false
		if entries, err := os.ReadDir(dir); err == nil {
			for _, e := range entries {
				if fontExts[strings.ToLower(filepath.Ext(e.Name()))] {
					left = true // another family shares the folder
				}
			}
		}
		if !left {
			os.RemoveAll(dir)
		}
	}
	return nil
}
