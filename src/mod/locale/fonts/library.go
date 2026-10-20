package fonts

/*
	library.go

	The system font library: the fonts installed under system/locale/fonts
	(one folder per family), which family each language uses, and the style
	sheet and font slices the browser loads.

	Which font a language uses is decided per user, falling back to a system
	default an administrator picks, falling back to the factory default in
	defaults.json. Any of them may be SystemFont: the device's own fonts.

	Big TrueType fonts (CJK fonts are tens of megabytes) are served in WOFF2
	slices with a unicode-range each, so the browser only downloads the ones
	holding characters on screen:
	  - "ui-<languages>-<hash>" holds Latin, common punctuation and every
	    character of those languages' interface strings. It is declared last,
	    so it wins for those characters: an ordinary page loads only it.
	  - "c00".."cNN" cover all the font's codepoints, 2000 at a time.
	Smaller fonts, CFF fonts and WOFF2 uploads are served whole ("all").
	Slices are generated on first request and kept in the cache folder.
*/

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/database"
)

const (
	// SystemFont is the choice meaning "the device's own fonts"
	SystemFont = "@system"

	// MaxFontSize is the largest font file the library accepts
	MaxFontSize = 100 << 20

	dbTable       = "fontlib"
	defaultsFile  = "defaults.json"
	brotliQuality = 9
	previewPrefix = "AO Preview "
)

// Slicing thresholds (variables so tests can slice small fonts)
var (
	sliceSize     = 2000       // codepoints per "cNN" slice
	sliceMinBytes = 1536 << 10 // smaller fonts are served whole
)

var (
	fontExts     = map[string]bool{".ttf": true, ".otf": true, ".woff": true, ".woff2": true}
	langPattern  = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]{2,8})?$`)
	slicePattern = regexp.MustCompile(`^(all|c[0-9]{2,3}|ui-[a-z0-9_-]{2,120}-[0-9a-f]{8})$`)

	// ErrNotFound is returned for an unknown family, face or slice
	ErrNotFound = errors.New("not found")
)

// uiBase is always part of a "ui" slice: Latin, punctuation and symbols
var uiBase = [][2]uint32{
	{0x20, 0x7E}, {0xA0, 0xFF}, {0x2000, 0x206F}, {0x20AC, 0x20AC}, {0x2122, 0x2122},
	{0x2190, 0x2193}, {0x2212, 0x2212}, {0x3000, 0x303F}, {0xFF00, 0xFFEF}, {0xFFFD, 0xFFFD},
}

// Options configures a Library
type Options struct {
	Root     string             // installed fonts, one sub folder per family
	CacheDir string             // generated slices
	DB       *database.Database // language choices
}

// Face is one installed font file
type Face struct {
	ID     string // path below Root, slash separated
	Key    string // changes with the file; names its slices
	Size   int64
	Format string // "ttf", "otf" or "woff2"
	Info   Info

	path       string
	codepoints []uint32
	sliced     bool
	cold       []coldSlice
}

type coldSlice struct {
	name   string
	lo, hi int // codepoints[lo:hi]
	ranges string
}

// Family groups the faces sharing a family name
type Family struct {
	Name  string
	Dir   string // folder below Root, empty for loose files
	Faces []*Face
}

// Library is the set of installed fonts and the language choices
type Library struct {
	opts Options

	mu          sync.RWMutex
	families    map[string]*Family // by lower case name
	faces       map[string]*Face   // by Key
	factory     map[string]string
	fallback    map[string]string
	langChars   map[string][]uint32
	sharedChars []uint32

	uiMu       sync.Mutex
	uiCache    map[string][]uint32
	rangeCache map[string]string

	genMu    sync.Mutex
	inflight map[string]*sync.Mutex

	srcMu   sync.Mutex
	sources []*cachedSource
}

type cachedSource struct {
	key  string
	src  *source
	used time.Time
}

// NewLibrary opens the font library and indexes the installed fonts
func NewLibrary(opts Options) (*Library, error) {
	if opts.Root == "" || opts.CacheDir == "" {
		return nil, errors.New("the font library needs a root and a cache folder")
	}
	if err := os.MkdirAll(opts.Root, 0755); err != nil {
		return nil, err
	}
	if opts.DB != nil {
		if err := opts.DB.NewTable(dbTable); err != nil {
			return nil, err
		}
	}
	l := &Library{
		opts:       opts,
		factory:    map[string]string{},
		fallback:   map[string]string{},
		langChars:  map[string][]uint32{},
		uiCache:    map[string][]uint32{},
		rangeCache: map[string]string{},
		inflight:   map[string]*sync.Mutex{},
	}
	l.loadDefaults()
	return l, l.Rescan()
}

// loadDefaults reads the factory language defaults shipped with the fonts
func (l *Library) loadDefaults() {
	raw, err := os.ReadFile(filepath.Join(l.opts.Root, defaultsFile))
	if err != nil {
		return
	}
	var d struct {
		Defaults map[string]string `json:"defaults"`
		Fallback map[string]string `json:"fallback"`
	}
	if json.Unmarshal(raw, &d) != nil {
		return
	}
	for lang, family := range d.Defaults {
		l.factory[strings.ToLower(lang)] = family
	}
	for lang, stack := range d.Fallback {
		l.fallback[strings.ToLower(lang)] = stack
	}
}

/* ── Index ── */

// Rescan rebuilds the index from the font folder
func (l *Library) Rescan() error {
	families := map[string]*Family{}
	faces := map[string]*Face{}

	add := func(dir, file string) {
		face, err := l.readFace(path.Join(dir, file))
		if err != nil {
			return // not a usable font; the folder may hold anything
		}
		key := strings.ToLower(face.Info.Family)
		fam := families[key]
		if fam == nil {
			fam = &Family{Name: face.Info.Family, Dir: dir}
			families[key] = fam
		}
		fam.Faces = append(fam.Faces, face)
		faces[face.Key] = face
	}

	entries, err := os.ReadDir(l.opts.Root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if !e.IsDir() {
			if fontExts[strings.ToLower(filepath.Ext(e.Name()))] {
				add("", e.Name())
			}
			continue
		}
		files, err := os.ReadDir(filepath.Join(l.opts.Root, e.Name()))
		if err != nil {
			continue
		}
		for _, f := range files {
			if !f.IsDir() && fontExts[strings.ToLower(filepath.Ext(f.Name()))] {
				add(e.Name(), f.Name())
			}
		}
	}
	for _, fam := range families {
		sortFaces(fam.Faces)
	}

	l.mu.Lock()
	l.families, l.faces = families, faces
	l.mu.Unlock()

	// slices of fonts that were removed or changed since
	if cached, err := os.ReadDir(l.opts.CacheDir); err == nil {
		for _, e := range cached {
			if _, ok := faces[e.Name()]; e.IsDir() && !ok {
				os.RemoveAll(filepath.Join(l.opts.CacheDir, e.Name()))
			}
		}
	}
	return nil
}

func sortFaces(faces []*Face) {
	sort.Slice(faces, func(i, j int) bool {
		a, b := faces[i].Info, faces[j].Info
		if a.Italic != b.Italic {
			return !a.Italic
		}
		if a.WeightMin != b.WeightMin {
			return a.WeightMin < b.WeightMin
		}
		return faces[i].ID < faces[j].ID
	})
}

// readFace reads and describes one font file below Root
func (l *Library) readFace(id string) (*Face, error) {
	full := filepath.Join(l.opts.Root, filepath.FromSlash(id))
	st, err := os.Stat(full)
	if err != nil || st.Size() > MaxFontSize {
		return nil, ErrNotFound
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	font, container, err := Decode(data)
	if err != nil {
		return nil, err
	}
	info, cmap, err := Inspect(font)
	if err != nil {
		return nil, err
	}

	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%d|%d", id, st.Size(), st.ModTime().UnixNano())))
	face := &Face{
		ID:         id,
		Key:        hex.EncodeToString(sum[:8]),
		Size:       st.Size(),
		Info:       info,
		path:       full,
		codepoints: sortedCodepoints(cmap),
	}
	switch {
	case container == "woff2":
		face.Format = "woff2"
	case font.IsCFF():
		face.Format = "otf"
	default:
		face.Format = "ttf"
	}
	if container == "woff" {
		face.Format = "woff"
	}
	face.sliced = container == "sfnt" && sliceable(font) && st.Size() > int64(sliceMinBytes)
	if face.sliced {
		for lo, n := 0, 0; lo < len(face.codepoints); lo, n = lo+sliceSize, n+1 {
			hi := min(lo+sliceSize, len(face.codepoints))
			face.cold = append(face.cold, coldSlice{
				name:   fmt.Sprintf("c%02d", n),
				lo:     lo,
				hi:     hi,
				ranges: unicodeRange(face.codepoints[lo:hi], 256),
			})
		}
	}
	return face, nil
}

// unicodeRange formats sorted codepoints as a CSS unicode-range, joining
// runs separated by fewer than maxGap codepoints the font does not have
func unicodeRange(cps []uint32, maxGap uint32) string {
	if len(cps) == 0 {
		return ""
	}
	var parts []string
	start, prev := cps[0], cps[0]
	flush := func() {
		if start == prev {
			parts = append(parts, fmt.Sprintf("U+%X", start))
		} else {
			parts = append(parts, fmt.Sprintf("U+%X-%X", start, prev))
		}
	}
	for _, cp := range cps[1:] {
		if cp-prev-1 <= maxGap { // codepoints in between that the run would take in
			prev = cp
			continue
		}
		flush()
		start, prev = cp, cp
	}
	flush()
	return strings.Join(parts, ", ")
}

func (l *Library) family(name string) *Family {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.families[strings.ToLower(name)]
}

/* ── Languages ── */

// SetLanguageText tells the library which characters each language's
// interface strings use. They decide which fonts can be offered for a
// language and, with shared (text every language shows, such as the names
// of the languages), what the "ui" slices hold.
func (l *Library) SetLanguageText(texts map[string]string, shared string) {
	chars := map[string][]uint32{}
	for lang, text := range texts {
		chars[strings.ToLower(lang)] = textCodepoints(text)
	}
	l.mu.Lock()
	l.langChars = chars
	l.sharedChars = textCodepoints(shared)
	l.mu.Unlock()
	l.uiMu.Lock()
	l.uiCache = map[string][]uint32{}
	l.rangeCache = map[string]string{}
	l.uiMu.Unlock()
}

// textCodepoints returns the distinct printable codepoints of a text, sorted
func textCodepoints(text string) []uint32 {
	seen := map[uint32]bool{}
	for _, r := range text {
		if r > 0x20 && r <= maxCodepoint {
			seen[uint32(r)] = true
		}
	}
	cps := make([]uint32, 0, len(seen))
	for cp := range seen {
		cps = append(cps, cp)
	}
	sort.Slice(cps, func(i, j int) bool { return cps[i] < cps[j] })
	return cps
}

// Fallback returns the device fonts a language falls back to after a
// library font, for locale files that name none of their own
func (l *Library) Fallback(lang string) string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if stack := l.fallback[strings.ToLower(lang)]; stack != "" {
		return stack
	}
	return "sans-serif"
}

func hasCodepoint(sorted []uint32, cp uint32) bool {
	i := sort.Search(len(sorted), func(i int) bool { return sorted[i] >= cp })
	return i < len(sorted) && sorted[i] == cp
}

// coverage is the share of a language's characters a family can draw
func (l *Library) coverage(fam *Family, lang string) float64 {
	l.mu.RLock()
	chars := l.langChars[lang]
	l.mu.RUnlock()
	if len(chars) == 0 {
		return 0
	}
	covered := 0
	for _, cp := range chars {
		for _, f := range fam.Faces {
			if hasCodepoint(f.codepoints, cp) {
				covered++
				break
			}
		}
	}
	return float64(covered) / float64(len(chars))
}

// Supports reports whether a family draws (nearly) every character of a
// language's interface strings
func (l *Library) Supports(family, lang string) bool {
	fam := l.family(family)
	return fam != nil && l.coverage(fam, strings.ToLower(lang)) >= 0.9
}

/* ── Choices ── */

func validLang(lang string) bool {
	return langPattern.MatchString(lang)
}

func (l *Library) dbRead(key string) (string, bool) {
	if l.opts.DB == nil || !l.opts.DB.KeyExists(dbTable, key) {
		return "", false
	}
	value := ""
	if l.opts.DB.Read(dbTable, key, &value) != nil {
		return "", false
	}
	return value, true
}

func (l *Library) dbWrite(key, value string) error {
	if l.opts.DB == nil {
		return errors.New("no database")
	}
	if value == "" {
		return l.opts.DB.Delete(dbTable, key)
	}
	return l.opts.DB.Write(dbTable, key, value)
}

// normaliseChoice checks a stored choice: "", SystemFont or an installed family
func (l *Library) normaliseChoice(value string) (string, error) {
	if value == "" || value == SystemFont {
		return value, nil
	}
	fam := l.family(value)
	if fam == nil {
		return "", fmt.Errorf("no font family named %q is installed", value)
	}
	return fam.Name, nil
}

// Factory returns the family defaults.json picks for a language, if any
func (l *Library) Factory(lang string) string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.factory[strings.ToLower(lang)]
}

// AdminDefault returns what an administrator stored for a language: a
// family, SystemFont, or "" when the factory default applies
func (l *Library) AdminDefault(lang string) string {
	v, _ := l.dbRead("default/" + strings.ToLower(lang))
	return v
}

// Default returns the system wide choice for a language: what an
// administrator set, else the factory default. "" means device fonts.
func (l *Library) Default(lang string) string {
	lang = strings.ToLower(lang)
	if v, ok := l.dbRead("default/" + lang); ok {
		return v
	}
	return l.Factory(lang)
}

// SetDefault stores the system wide choice for a language. "" returns the
// language to its factory default.
func (l *Library) SetDefault(lang, value string) error {
	lang = strings.ToLower(lang)
	if !validLang(lang) {
		return errors.New("invalid language code")
	}
	value, err := l.normaliseChoice(value)
	if err != nil {
		return err
	}
	return l.dbWrite("default/"+lang, value)
}

// Choice returns a user's own choice for a language, "" when they follow
// the default
func (l *Library) Choice(username, lang string) string {
	v, _ := l.dbRead("user/" + username + "/" + strings.ToLower(lang))
	return v
}

// SetChoice stores a user's own choice for a language ("" follows the default)
func (l *Library) SetChoice(username, lang, value string) error {
	lang = strings.ToLower(lang)
	if username == "" || !validLang(lang) {
		return errors.New("invalid user or language code")
	}
	value, err := l.normaliseChoice(value)
	if err != nil {
		return err
	}
	return l.dbWrite("user/"+username+"/"+lang, value)
}

// Effective returns the installed family a user's pages use for a
// language, "" for the device's own fonts
func (l *Library) Effective(username, lang string) string {
	v := ""
	if username != "" {
		v = l.Choice(username, lang)
	}
	if v == "" {
		v = l.Default(lang)
	}
	if v == "" || v == SystemFont {
		return ""
	}
	if fam := l.family(v); fam != nil {
		return fam.Name
	}
	return ""
}

/* ── Style sheets ── */

// PreviewName is the family name a font gets in the preview style sheet,
// so previews never mix with the fonts the page itself uses
func PreviewName(family string) string {
	return previewPrefix + family
}

// StyleSheet returns the @font-face rules for the families a user's pages
// use in any of the given languages
func (l *Library) StyleSheet(username string, langs []string) string {
	assigned := map[string][]string{}
	for _, lang := range langs {
		lang = strings.ToLower(lang)
		if fam := l.Effective(username, lang); fam != "" {
			assigned[fam] = append(assigned[fam], lang)
		}
	}
	return l.styleSheet(assigned, func(name string) string { return name })
}

// PreviewStyleSheet returns @font-face rules for every installed family
// under its PreviewName, with "ui" slices for the viewer's language
func (l *Library) PreviewStyleSheet(lang string) string {
	assigned := map[string][]string{}
	lang = strings.ToLower(lang)
	l.mu.RLock()
	for _, fam := range l.families {
		assigned[fam.Name] = nil
		if validLang(lang) {
			assigned[fam.Name] = []string{lang}
		}
	}
	l.mu.RUnlock()
	return l.styleSheet(assigned, PreviewName)
}

func (l *Library) styleSheet(assigned map[string][]string, alias func(string) string) string {
	names := make([]string, 0, len(assigned))
	for name := range assigned {
		names = append(names, name)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteString("/* Generated by ArozOS from the system font library (System Settings > System Fonts) */\n")
	for _, name := range names {
		fam := l.family(name)
		if fam == nil {
			continue
		}
		langs := assigned[name]
		sort.Strings(langs)
		for _, face := range fam.Faces {
			if !face.sliced {
				writeFace(&b, alias(fam.Name), face, "all", "")
				continue
			}
			var ui []uint32
			if len(langs) > 0 {
				ui = l.uiCodepoints(face, langs)
			}
			for _, c := range face.cold {
				if ranges := l.coldRanges(face, c, langs, ui); ranges != "" {
					writeFace(&b, alias(fam.Name), face, c.name, ranges)
				}
			}
			if len(ui) > 0 {
				writeFace(&b, alias(fam.Name), face, uiName(langs, ui), unicodeRange(ui, 0))
			}
		}
	}
	return b.String()
}

func writeFace(b *strings.Builder, family string, face *Face, slice, ranges string) {
	weight := fmt.Sprint(face.Info.WeightMin)
	if face.Info.WeightMax != face.Info.WeightMin {
		weight = fmt.Sprintf("%d %d", face.Info.WeightMin, face.Info.WeightMax)
	}
	style := "normal"
	if face.Info.Italic {
		style = "italic"
	}
	fmt.Fprintf(b, "@font-face {\n    font-family: %s;\n    src: url(\"slice/%s/%s.woff2\") format(\"woff2\");\n    font-weight: %s;\n    font-style: %s;\n    font-display: swap;\n",
		cssString(family), face.Key, slice, weight, style)
	if ranges != "" {
		fmt.Fprintf(b, "    unicode-range: %s;\n", ranges)
	}
	b.WriteString("}\n")
}

// cssString quotes a family name for CSS
func cssString(s string) string {
	s = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", " ", "\r", " ", "<", "\\3C ").Replace(s)
	return `"` + s + `"`
}

// QuoteFamily quotes a family name for a CSS font-family list
func QuoteFamily(family string) string {
	return cssString(family)
}

func uiName(langs []string, cps []uint32) string {
	h := sha1.New()
	for _, cp := range cps {
		fmt.Fprintf(h, "%x,", cp)
	}
	return "ui-" + strings.Join(langs, "_") + "-" + hex.EncodeToString(h.Sum(nil))[:8]
}

// coldRanges is the unicode-range of a "cNN" slice without the codepoints of
// the "ui" slice declared with it. No codepoint may be covered by two faces of
// a family: while the face a browser prefers is still loading, Chrome also
// fetches every other face covering the same characters.
func (l *Library) coldRanges(face *Face, c coldSlice, langs []string, ui []uint32) string {
	if len(ui) == 0 {
		return c.ranges
	}
	cacheKey := face.Key + "|" + strings.Join(langs, "_") + "|" + c.name
	l.uiMu.Lock()
	cached, ok := l.rangeCache[cacheKey]
	l.uiMu.Unlock()
	if ok {
		return cached
	}

	var parts []string
	var start, prev uint32
	open := false
	flush := func() {
		if !open {
			return
		}
		if start == prev {
			parts = append(parts, fmt.Sprintf("U+%X", start))
		} else {
			parts = append(parts, fmt.Sprintf("U+%X-%X", start, prev))
		}
		open = false
	}
	for _, cp := range face.codepoints[c.lo:c.hi] {
		if hasCodepoint(ui, cp) {
			flush() // a run may skip codepoints the font lacks, never ui ones
			continue
		}
		if open && cp-prev-1 <= 256 {
			prev = cp
			continue
		}
		flush()
		start, prev, open = cp, cp, true
	}
	flush()
	ranges := strings.Join(parts, ", ")

	l.uiMu.Lock()
	l.rangeCache[cacheKey] = ranges
	l.uiMu.Unlock()
	return ranges
}

// uiCodepoints is the part of a face the "ui" slice of these languages holds
func (l *Library) uiCodepoints(face *Face, langs []string) []uint32 {
	cacheKey := face.Key + "|" + strings.Join(langs, "_")
	l.uiMu.Lock()
	cached, ok := l.uiCache[cacheKey]
	l.uiMu.Unlock()
	if ok {
		return cached
	}

	want := map[uint32]bool{}
	for _, r := range uiBase {
		for cp := r[0]; cp <= r[1]; cp++ {
			want[cp] = true
		}
	}
	l.mu.RLock()
	for _, lang := range langs {
		for _, cp := range l.langChars[lang] {
			want[cp] = true
		}
	}
	for _, cp := range l.sharedChars {
		want[cp] = true
	}
	l.mu.RUnlock()
	cps := []uint32{}
	for cp := range want {
		if hasCodepoint(face.codepoints, cp) {
			cps = append(cps, cp)
		}
	}
	sort.Slice(cps, func(i, j int) bool { return cps[i] < cps[j] })

	l.uiMu.Lock()
	l.uiCache[cacheKey] = cps
	l.uiMu.Unlock()
	return cps
}

/* ── Slices ── */

// slicePlan resolves a slice name: the codepoints it holds, or nil with
// whole=true for a face served whole
func (l *Library) slicePlan(face *Face, name string) (cps []uint32, whole bool, err error) {
	if !slicePattern.MatchString(name) {
		return nil, false, ErrNotFound
	}
	if !face.sliced {
		if name == "all" {
			return nil, true, nil
		}
		return nil, false, ErrNotFound
	}
	for _, c := range face.cold {
		if c.name == name {
			return face.codepoints[c.lo:c.hi], false, nil
		}
	}
	if strings.HasPrefix(name, "ui-") {
		body := strings.TrimPrefix(name, "ui-")
		cut := strings.LastIndex(body, "-")
		langs := strings.Split(body[:cut], "_")
		for _, lang := range langs {
			if !validLang(lang) {
				return nil, false, ErrNotFound
			}
		}
		cps := l.uiCodepoints(face, langs)
		if len(cps) > 0 && uiName(langs, cps) == name {
			return cps, false, nil
		}
	}
	return nil, false, ErrNotFound
}

// SlicePath returns the WOFF2 file of a slice, generating it on first use
func (l *Library) SlicePath(key, name string) (string, error) {
	l.mu.RLock()
	face := l.faces[key]
	l.mu.RUnlock()
	if face == nil {
		return "", ErrNotFound
	}
	cps, whole, err := l.slicePlan(face, name)
	if err != nil {
		return "", err
	}
	if whole && face.Format == "woff2" {
		return face.path, nil
	}

	target := filepath.Join(l.opts.CacheDir, face.Key, name+".woff2")
	if _, err := os.Stat(target); err == nil {
		return target, nil
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
		return target, nil // made while we waited
	}

	var woff2 []byte
	if whole {
		woff2, err = l.encodeWhole(face)
	} else {
		woff2, err = l.encodeSlice(face, cps)
	}
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return "", err
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, woff2, 0644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return target, nil
}

func (l *Library) encodeWhole(face *Face) ([]byte, error) {
	data, err := os.ReadFile(face.path)
	if err != nil {
		return nil, err
	}
	font, _, err := Decode(data)
	if err != nil {
		return nil, err
	}
	tables := map[string][]byte{}
	for tag, t := range font.Tables {
		if tag != "DSIG" {
			tables[tag] = t
		}
	}
	if _, err := AssembleSFNT(font.Flavor, tables); err != nil {
		return nil, err
	}
	return EncodeWOFF2(font.Flavor, tables, brotliQuality)
}

func (l *Library) encodeSlice(face *Face, cps []uint32) ([]byte, error) {
	src, err := l.source(face)
	if err != nil {
		return nil, err
	}
	tables, err := src.slice(cps)
	if err != nil {
		return nil, err
	}
	if _, err := AssembleSFNT(src.font.Flavor, tables); err != nil {
		return nil, err
	}
	return EncodeWOFF2(src.font.Flavor, tables, brotliQuality)
}

// source returns a face parsed for slicing; the last two stay in memory
func (l *Library) source(face *Face) (*source, error) {
	l.srcMu.Lock()
	defer l.srcMu.Unlock()
	for _, c := range l.sources {
		if c.key == face.Key {
			c.used = time.Now()
			return c.src, nil
		}
	}
	data, err := os.ReadFile(face.path)
	if err != nil {
		return nil, err
	}
	font, err := ParseSFNT(data)
	if err != nil {
		return nil, err
	}
	src, err := newSource(font)
	if err != nil {
		return nil, err
	}
	l.sources = append(l.sources, &cachedSource{key: face.Key, src: src, used: time.Now()})
	if len(l.sources) > 2 {
		sort.Slice(l.sources, func(i, j int) bool { return l.sources[i].used.After(l.sources[j].used) })
		l.sources = l.sources[:2]
	}
	return src, nil
}

// Warm generates the "ui" slices of the default fonts in the background,
// so the first page of a fresh start does not wait for them
func (l *Library) Warm(langs []string) {
	assigned := map[string][]string{}
	for _, lang := range langs {
		lang = strings.ToLower(lang)
		if fam := l.Effective("", lang); fam != "" {
			assigned[fam] = append(assigned[fam], lang)
		}
	}
	for name, ls := range assigned {
		fam := l.family(name)
		if fam == nil {
			continue
		}
		sort.Strings(ls)
		for _, face := range fam.Faces {
			if face.sliced {
				if cps := l.uiCodepoints(face, ls); len(cps) > 0 {
					l.SlicePath(face.Key, uiName(ls, cps))
				}
			}
		}
	}
}

// ServeSlice answers a request for a slice file
func (l *Library) ServeSlice(w http.ResponseWriter, r *http.Request, key, name string) {
	file, err := l.SlicePath(key, name)
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
	// the key changes with the font and a ui slice name with its characters
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "font/woff2")
	http.ServeContent(w, r, name+".woff2", st.ModTime(), f)
}
