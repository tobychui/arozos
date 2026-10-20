package locale

/*
	locale.go

	Serves the system locale files. They live in system/locale and are
	reached at the URL they always had, /SystemAO/locale/<file>, so every
	page keeps loading "../locale/<file>.json" as before.

	Locale JSON files are rendered per user: for each language whose pages
	use a font from the font library (see mod/locale/fonts), the language's
	block gets
	  fontFamily  the library family first, then the file's own fonts
	  systemFont  the library family alone
	  fontCSS     the path of the style sheet declaring it, relative to the file
	so a font is changed in one place instead of in every locale file.

	The fonts/ folder holds the font library: fonts/fonts.css is the user's
	style sheet (fonts.css?preview=1&lang=xx the library preview one) and
	fonts/slice/<key>/<name>.woff2 the font slices.
*/

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/locale/fonts"
)

// URLPrefix is where the locale files are served
const URLPrefix = "/SystemAO/locale/"

// utf8BOM starts some of the locale files
var utf8BOM = []byte("\xef\xbb\xbf")

// servedExts are the file types served from the locale folder
var servedExts = map[string]string{
	".json": "application/json; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".txt":  "text/plain; charset=utf-8",
	".md":   "text/plain; charset=utf-8",
}

// Options configures a Server
type Options struct {
	Root       string         // system/locale
	LegacyRoot string         // optional read-only fallback (the old web/SystemAO/locale)
	Fonts      *fonts.Library // may be nil: files are then served unchanged
}

// Language is a language the system has interface strings for
type Language struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// Server serves the locale folder
type Server struct {
	opts Options

	mu        sync.Mutex
	cache     map[string]*cachedFile
	languages []Language
}

type cachedFile struct {
	modTime time.Time
	size    int64
	raw     []byte
	top     []member // nil when the file is not a JSON object
	keysAt  int      // index of "keys" in top, -1 when absent
	langs   []member // the members of "keys"
}

// NewServer prepares the locale server and reads the language list and the
// characters each language uses
func NewServer(opts Options) (*Server, error) {
	if _, err := os.Stat(opts.Root); err != nil {
		return nil, err
	}
	s := &Server{opts: opts, cache: map[string]*cachedFile{}}
	s.Rescan()
	return s, nil
}

// Root returns the locale folder
func (s *Server) Root() string {
	return s.opts.Root
}

// Languages lists the languages of the system's interface strings
func (s *Server) Languages() []Language {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Language(nil), s.languages...)
}

// LanguageCodes lists the language codes, lower case
func (s *Server) LanguageCodes() []string {
	langs := s.Languages()
	codes := make([]string, len(langs))
	for i, l := range langs {
		codes[i] = l.Code
	}
	return codes
}

// Rescan rereads every locale file: the language list (from
// system_settings.json, else file_explorer.json) and the text of each
// language, which it hands to the font library
func (s *Server) Rescan() {
	texts := map[string]*strings.Builder{}
	names := map[string]string{}
	var order []string

	filepath.Walk(s.opts.Root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if p != s.opts.Root && filepath.Base(p) == "fonts" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.ToLower(filepath.Ext(p)) != ".json" {
			return nil
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		var doc struct {
			Keys map[string]json.RawMessage `json:"keys"`
		}
		if json.Unmarshal(bytes.TrimPrefix(raw, utf8BOM), &doc) != nil {
			return nil
		}
		base := filepath.Base(p)
		for code, block := range doc.Keys {
			lang := strings.ToLower(code)
			if texts[lang] == nil {
				texts[lang] = &strings.Builder{}
			}
			var values map[string]interface{}
			if json.Unmarshal(block, &values) == nil {
				collectText(values, texts[lang])
				if name, ok := values["name"].(string); ok && (base == "system_settings.json" || (base == "file_explorer.json" && names[lang] == "")) {
					if _, seen := names[lang]; !seen {
						order = append(order, lang)
					}
					names[lang] = name
				}
			}
		}
		return nil
	})

	langs := make([]Language, 0, len(names))
	sort.Strings(order)
	for _, code := range order {
		langs = append(langs, Language{Code: code, Name: names[code]})
	}
	all := map[string]string{}
	for lang, b := range texts {
		all[lang] = b.String()
	}
	// language pickers show every language by its own name, in any language
	var allNames strings.Builder
	for _, l := range langs {
		allNames.WriteString(l.Name)
	}

	s.mu.Lock()
	s.languages = langs
	s.cache = map[string]*cachedFile{}
	s.mu.Unlock()
	if s.opts.Fonts != nil {
		s.opts.Fonts.SetLanguageText(all, allNames.String())
	}
}

// collectText appends every string of a locale block except the font ones
func collectText(v interface{}, b *strings.Builder) {
	switch t := v.(type) {
	case string:
		b.WriteString(t)
		b.WriteByte('\n')
	case map[string]interface{}:
		for k, child := range t {
			if k != "fontFamily" {
				collectText(child, b)
			}
		}
	case []interface{}:
		for _, child := range t {
			collectText(child, b)
		}
	}
}

// resolve maps a path below URLPrefix to a file, nil when it is not served
func (s *Server) resolve(rel string) (string, os.FileInfo) {
	if rel == "" || strings.ContainsAny(rel, "\\\x00:") || strings.HasPrefix(rel, "/") {
		return "", nil
	}
	clean := path.Clean(rel)
	if clean != rel || clean == "." || strings.HasPrefix(clean, "../") || clean == ".." {
		return "", nil
	}
	for _, part := range strings.Split(clean, "/") {
		if strings.HasPrefix(part, ".") {
			return "", nil
		}
	}
	if _, ok := servedExts[strings.ToLower(path.Ext(clean))]; !ok {
		return "", nil
	}
	for _, root := range []string{s.opts.Root, s.opts.LegacyRoot} {
		if root == "" {
			continue
		}
		full := filepath.Join(root, filepath.FromSlash(clean))
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			return full, st
		}
	}
	return "", nil
}

// Serve answers a request below URLPrefix for a logged in user
func (s *Server) Serve(w http.ResponseWriter, r *http.Request, username string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, URLPrefix)

	if s.opts.Fonts != nil {
		if rel == "fonts/fonts.css" {
			s.serveStyleSheet(w, r, username)
			return
		}
		if strings.HasPrefix(rel, "fonts/slice/") {
			parts := strings.Split(strings.TrimPrefix(rel, "fonts/slice/"), "/")
			if len(parts) == 2 && strings.HasSuffix(parts[1], ".woff2") {
				s.opts.Fonts.ServeSlice(w, r, parts[0], strings.TrimSuffix(parts[1], ".woff2"))
				return
			}
			http.NotFound(w, r)
			return
		}
	}

	full, st := s.resolve(rel)
	if full == "" {
		http.NotFound(w, r)
		return
	}
	ext := strings.ToLower(path.Ext(rel))
	w.Header().Set("Content-Type", servedExts[ext])
	if ext != ".json" {
		serveFile(w, r, full, st)
		return
	}

	file := s.load(full, st)
	var out []byte
	if s.opts.Fonts != nil {
		out = s.render(file, strings.Count(rel, "/"), username)
	}
	if out == nil {
		//No library font in this file for this user: the file as it is
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, st.Name(), st.ModTime(), bytes.NewReader(file.raw))
		return
	}
	sendRevalidated(w, r, out)
}

func serveFile(w http.ResponseWriter, r *http.Request, full string, st os.FileInfo) {
	f, err := os.Open(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}

// sendRevalidated sends a per user response the browser revalidates by ETag
func sendRevalidated(w http.ResponseWriter, r *http.Request, body []byte) {
	sum := sha1.Sum(body)
	etag := `"` + hex.EncodeToString(sum[:10]) + `"`
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Method == http.MethodHead {
		return
	}
	w.Write(body)
}

// load returns a locale file, parsed, from the cache while it is unchanged
func (s *Server) load(full string, st os.FileInfo) *cachedFile {
	s.mu.Lock()
	c := s.cache[full]
	s.mu.Unlock()
	if c != nil && c.modTime.Equal(st.ModTime()) && c.size == st.Size() {
		return c
	}
	raw, _ := os.ReadFile(full)
	c = &cachedFile{modTime: st.ModTime(), size: st.Size(), raw: raw, keysAt: -1}
	if top, err := objectMembers(bytes.TrimPrefix(raw, utf8BOM)); err == nil {
		c.top = top
		for i, m := range top {
			if m.key == "keys" {
				if langs, err := objectMembers(m.value); err == nil {
					c.keysAt, c.langs = i, langs
				}
			}
		}
	}
	s.mu.Lock()
	s.cache[full] = c
	s.mu.Unlock()
	return c
}

// render returns a locale file with the user's library fonts filled in, or
// nil when no language of the file uses one. Everything else, including the
// order of the keys, stays as the file has it.
func (s *Server) render(file *cachedFile, depth int, username string) []byte {
	if file.keysAt < 0 {
		return nil
	}
	langs := make([]member, len(file.langs))
	changed := false
	for i, m := range file.langs {
		langs[i] = m
		family := s.opts.Fonts.Effective(username, strings.ToLower(m.key))
		if family == "" {
			continue
		}
		block, err := objectMembers(m.value)
		if err != nil {
			continue
		}
		stack := ""
		kept := make([]member, 0, len(block)+3)
		for _, bm := range block {
			switch bm.key {
			case "fontFamily":
				json.Unmarshal(bm.value, &stack)
			case "systemFont", "fontCSS":
			default:
				kept = append(kept, bm)
			}
		}
		if strings.TrimSpace(stack) == "" {
			stack = s.opts.Fonts.Fallback(m.key)
		}
		added := []member{
			stringMember("fontFamily", fonts.QuoteFamily(family)+", "+stack),
			stringMember("systemFont", family),
			stringMember("fontCSS", strings.Repeat("../", depth)+"fonts/fonts.css"),
		}
		// after "name", where the files keep fontFamily
		at := 0
		if len(kept) > 0 && kept[0].key == "name" {
			at = 1
		}
		block = append(append(append([]member{}, kept[:at]...), added...), kept[at:]...)
		langs[i].value = encodeObject(block)
		changed = true
	}
	if !changed {
		return nil
	}
	top := append([]member(nil), file.top...)
	top[file.keysAt].value = encodeObject(langs)
	var out bytes.Buffer
	if json.Indent(&out, encodeObject(top), "", "    ") != nil {
		return nil
	}
	out.WriteByte('\n')
	return out.Bytes()
}

// member is one key of a JSON object, its value left as written
type member struct {
	key   string
	value json.RawMessage
}

// objectMembers splits a JSON object into its members, in order
func objectMembers(raw []byte) ([]member, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, errors.New("not a JSON object")
	}
	var members []member
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, ok := tok.(string)
		if !ok {
			return nil, errors.New("invalid object key")
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		members = append(members, member{key, value})
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('}') {
		return nil, errors.New("unterminated JSON object")
	}
	return members, nil
}

func encodeObject(members []member) []byte {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, m := range members {
		if i > 0 {
			b.WriteByte(',')
		}
		key, _ := json.Marshal(m.key)
		b.Write(key)
		b.WriteByte(':')
		b.Write(m.value)
	}
	b.WriteByte('}')
	return b.Bytes()
}

func stringMember(key, value string) member {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.Encode(value)
	return member{key, json.RawMessage(bytes.TrimSpace(b.Bytes()))}
}

// serveStyleSheet sends the user's font style sheet, or the preview one
func (s *Server) serveStyleSheet(w http.ResponseWriter, r *http.Request, username string) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	var css string
	if r.URL.Query().Get("preview") != "" {
		css = s.opts.Fonts.PreviewStyleSheet(strings.ToLower(r.URL.Query().Get("lang")))
	} else {
		css = s.opts.Fonts.StyleSheet(username, s.LanguageCodes())
	}
	sendRevalidated(w, r, []byte(css))
}
