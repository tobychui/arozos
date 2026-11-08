package smbserver

import (
	"errors"
	"hash/fnv"
	"os"
	"path"
	"strings"
	"sync"
	"time"
	"unicode"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	names.go

	Everything between a Windows path and a share path: splitting off stream
	names, refusing traversal, case insensitive lookup, and the private use
	characters that let Windows see Linux names it would otherwise forbid.
*/

const (
	maxPathLength    = 32767
	maxNameComponent = 255

	//Folders ArozOS keeps its own data in
	protectedFolder = ".metadata"
)

// The private use characters SMB clients agree on for names Windows forbids.
var forbiddenToPrivate = map[rune]rune{
	'"':  0xF020,
	'*':  0xF021,
	':':  0xF022,
	'<':  0xF023,
	'>':  0xF024,
	'?':  0xF025,
	'\\': 0xF026,
	'|':  0xF027,
}

const (
	privateSpace  = 0xF028
	privatePeriod = 0xF029
)

var privateToForbidden = func() map[rune]rune {
	m := map[rune]rune{privateSpace: ' ', privatePeriod: '.'}
	for k, v := range forbiddenToPrivate {
		m[v] = k
	}
	return m
}()

// toWireName turns a name on disk into one Windows accepts.
func toWireName(name string) string {
	runes := []rune(name)
	for i, r := range runes {
		if p, ok := forbiddenToPrivate[r]; ok {
			runes[i] = p
		}
	}
	//Windows drops a trailing space or dot, which would make the file
	//unreachable, so they are kept through the private range too
	if n := len(runes); n > 0 {
		switch runes[n-1] {
		case ' ':
			runes[n-1] = privateSpace
		case '.':
			if name != "." && name != ".." {
				runes[n-1] = privatePeriod
			}
		}
	}
	return string(runes)
}

// fromWireName is the inverse of toWireName.
func fromWireName(name string) string {
	if !strings.ContainsFunc(name, func(r rune) bool { return r >= 0xF020 && r <= 0xF029 }) {
		return name
	}
	runes := []rune(name)
	for i, r := range runes {
		if p, ok := privateToForbidden[r]; ok {
			runes[i] = p
		}
	}
	return string(runes)
}

// parsePath validates a path from the client and returns it share relative.
// Stream syntax is resolved here, so nothing past this point sees a colon that
// Windows meant as a separator. A named stream is refused here; CREATE uses
// parsePathStream, which allows them.
func parsePath(name string) (string, uint32) {
	rel, stream, status := parsePathStream(name)
	if status == wire.StatusOK && stream != "" {
		return "", wire.StatusObjectNameInvalid
	}
	return rel, status
}

// parsePathStream also returns the named stream of the last component, "" for
// the file itself (":" and "::$DATA" name the file too).
func parsePathStream(name string) (string, string, uint32) {
	if len(name) > maxPathLength {
		return "", "", wire.StatusObjectNameInvalid
	}
	if strings.IndexByte(name, 0) >= 0 {
		return "", "", wire.StatusObjectNameInvalid
	}
	name = strings.TrimPrefix(name, `\`)
	if name == "" {
		return "", "", wire.StatusOK
	}
	stream := ""

	parts := strings.Split(name, `\`)
	out := make([]string, 0, len(parts))
	for i, part := range parts {
		if part == "" {
			//A trailing separator names the same folder, others are malformed
			if i == len(parts)-1 {
				continue
			}
			return "", "", wire.StatusObjectNameInvalid
		}

		//name:stream:type, where the type can only be the data type
		if colon := strings.IndexByte(part, ':'); colon >= 0 {
			if i != len(parts)-1 {
				return "", "", wire.StatusObjectNameInvalid
			}
			spec := part[colon+1:]
			part = part[:colon]
			streamName, kind := spec, ""
			if j := strings.IndexByte(spec, ':'); j >= 0 {
				streamName, kind = spec[:j], strings.ToUpper(spec[j+1:])
			}
			if kind != "" && kind != "$DATA" {
				return "", "", wire.StatusObjectNameInvalid
			}
			if streamName != "" {
				if strings.ContainsAny(streamName, `/\`) || len([]rune(streamName)) > maxNameComponent {
					return "", "", wire.StatusObjectNameInvalid
				}
				for _, r := range streamName {
					if unicode.IsControl(r) {
						return "", "", wire.StatusObjectNameInvalid
					}
				}
				//macOS sends the colons of extended attribute names in
				//the private range, so they arrive as colons here
				stream = fromWireName(streamName)
			}
			if part == "" {
				continue
			}
		}

		if part == "." || part == ".." {
			return "", "", wire.StatusObjectPathSyntaxBad
		}
		if strings.ContainsAny(part, `<>"|?*/`) {
			return "", "", wire.StatusObjectNameInvalid
		}
		for _, r := range part {
			if unicode.IsControl(r) {
				return "", "", wire.StatusObjectNameInvalid
			}
		}
		if len([]rune(part)) > maxNameComponent {
			return "", "", wire.StatusObjectNameInvalid
		}
		out = append(out, fromWireName(part))
	}
	return strings.Join(out, "/"), stream, wire.StatusOK
}

func joinPath(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/" + name
}

// isInternal reports the folder ArozOS keeps its own data in. It is left out
// of listings: clients that saw it would try to delete it with the folder it
// is in, and be refused. Paths into it still work, for versions and streams.
func isInternal(name string) bool { return name == protectedFolder }

// isProtected reports a path inside a folder ArozOS keeps for itself.
func isProtected(p string) bool {
	for _, part := range strings.Split(p, "/") {
		if part == protectedFolder {
			return true
		}
	}
	return false
}

// resolved is the outcome of a path lookup.
type resolved struct {
	path         string
	info         FileInfo
	exists       bool
	parentExists bool
}

// nameCache remembers folder listings for a moment, so that the lookups Windows
// repeats for files that do not exist, such as desktop.ini, do not read a large
// folder every time. A hit only gives the spelling: the file is then checked on
// disk, so a stale entry can never return wrong data, and writes through this
// server invalidate the folder at once.
type nameCache struct {
	mu      sync.Mutex
	folders map[string]*cachedFolder
}

type cachedFolder struct {
	loaded time.Time
	names  map[string]string //Folded name to real name
}

const (
	nameCacheTTL     = 2 * time.Second
	nameCacheFolders = 1024
)

func newNameCache() *nameCache {
	return &nameCache{folders: map[string]*cachedFolder{}}
}

// find returns the real spelling of name in dir.
func (n *nameCache) find(s Share, dir, name string) (string, bool, error) {
	key := fileKey(s, dir)
	folded := strings.ToLower(name)

	n.mu.Lock()
	folder := n.folders[key]
	if folder != nil && time.Since(folder.loaded) < nameCacheTTL {
		real, ok := folder.names[folded]
		n.mu.Unlock()
		return real, ok, nil
	}
	n.mu.Unlock()

	entries, err := s.ReadDir(dir)
	if err != nil {
		return "", false, err
	}
	folder = &cachedFolder{loaded: time.Now(), names: make(map[string]string, len(entries))}
	for _, e := range entries {
		folder.names[strings.ToLower(e.Name)] = e.Name
	}

	n.mu.Lock()
	if len(n.folders) >= nameCacheFolders {
		n.folders = map[string]*cachedFolder{}
	}
	n.folders[key] = folder
	n.mu.Unlock()

	real, ok := folder.names[folded]
	return real, ok, nil
}

// forget drops a folder after something in it changed.
func (n *nameCache) forget(s Share, dir string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.folders, fileKey(s, dir))
}

// resolve looks a path up the way NTFS does, ignoring case. The exact name is
// tried first, so only a miss goes to the name cache.
func resolve(s Share, names *nameCache, rel string) (resolved, error) {
	info, err := s.Stat(rel)
	if err == nil {
		return resolved{path: rel, info: info, exists: true, parentExists: true}, nil
	}
	if !isMissing(err) {
		return resolved{}, err
	}
	if rel == "" {
		return resolved{}, err
	}

	parts := strings.Split(rel, "/")
	current := ""
	for i, part := range parts {
		last := i == len(parts)-1
		next := joinPath(current, part)
		info, err := s.Stat(next)
		if err != nil {
			if !isMissing(err) {
				return resolved{}, err
			}
			real, found, err := names.find(s, current, part)
			if err != nil {
				if isMissing(err) {
					return resolved{path: rel}, nil
				}
				return resolved{}, err
			}
			if found {
				next = joinPath(current, real)
				info, err = s.Stat(next)
				if err != nil && !isMissing(err) {
					return resolved{}, err
				}
				found = err == nil
			}
			if !found {
				if last {
					return resolved{path: joinPath(current, part), parentExists: true}, nil
				}
				return resolved{path: rel}, nil
			}
		}
		if !last && !info.IsDir {
			return resolved{path: rel}, nil
		}
		current = next
		if last {
			return resolved{path: current, info: info, exists: true, parentExists: true}, nil
		}
	}
	return resolved{path: rel}, nil
}

// fileKey identifies a file in the shared table. It folds case, so one file
// reached by two spellings on a case insensitive drive stays one entry. On a
// case sensitive drive two names differing only in case then share a row,
// which can only make share modes stricter than needed.
func fileKey(s Share, p string) string {
	return s.Key() + "\x00" + strings.ToLower(p)
}

// fileNumber returns a stable 64 bit id for a file.
func fileNumber(s Share, p string, info FileInfo) uint64 {
	if info.ID != 0 {
		return info.ID
	}
	h := fnv.New64a()
	h.Write([]byte(s.Key()))
	h.Write([]byte{0})
	h.Write([]byte(strings.ToLower(p)))
	return h.Sum64()
}

func baseName(p string) string {
	if p == "" {
		return ""
	}
	return path.Base(p)
}

func dirName(p string) string {
	i := strings.LastIndexByte(p, '/')
	if i < 0 {
		return ""
	}
	return p[:i]
}

// isMissing reports a not found error of any flavour.
func isMissing(err error) bool {
	return errors.Is(err, os.ErrNotExist) || isNotDirectory(err)
}

// statusOf maps a backend error to a status.
func statusOf(err error) uint32 {
	switch {
	case err == nil:
		return wire.StatusOK
	case errors.Is(err, ErrFileTooLarge):
		return wire.StatusFileTooLarge
	case errors.Is(err, os.ErrNotExist):
		return wire.StatusObjectNameNotFound
	case isNotDirectory(err):
		return wire.StatusObjectPathNotFound
	case errors.Is(err, os.ErrPermission):
		return wire.StatusAccessDenied
	case errors.Is(err, os.ErrExist):
		return wire.StatusObjectNameCollision
	case isDiskFull(err):
		return wire.StatusDiskFull
	case isNotEmpty(err):
		return wire.StatusDirectoryNotEmpty
	}
	return wire.StatusUnsuccessful
}

// matchPattern is the wildcard matching of FsRtlIsNameInExpression. Beyond
// * and ?, Windows rewrites patterns into the DOS forms: < is DOS_STAR, > is
// DOS_QM and " is DOS_DOT.
func matchPattern(pattern, name string) bool {
	if pattern == "" || pattern == "*" || pattern == "*.*" {
		return true
	}
	return matchRunes([]rune(strings.ToUpper(pattern)), []rune(strings.ToUpper(name)))
}

func matchRunes(p, n []rune) bool {
	for len(p) > 0 {
		switch p[0] {
		case '*':
			for i := 0; i <= len(n); i++ {
				if matchRunes(p[1:], n[i:]) {
					return true
				}
			}
			return false
		case '<':
			//Matches up to and including the last dot, or everything
			for i := 0; i <= len(n); i++ {
				if matchRunes(p[1:], n[i:]) {
					return true
				}
				if i < len(n) && n[i] == '.' && !containsDot(n[i+1:]) {
					return matchRunes(p[1:], n[i+1:]) || matchRunes(p[1:], n[i:])
				}
			}
			return false
		case '?':
			if len(n) == 0 {
				return false
			}
			n = n[1:]
		case '>':
			//One character, or nothing at a dot or the end
			if len(n) > 0 && n[0] != '.' {
				n = n[1:]
			}
		case '"':
			if len(n) > 0 {
				if n[0] != '.' {
					return false
				}
				n = n[1:]
			}
		default:
			if len(n) == 0 || n[0] != p[0] {
				return false
			}
			n = n[1:]
		}
		p = p[1:]
	}
	return len(n) == 0
}

func containsDot(n []rune) bool {
	for _, r := range n {
		if r == '.' {
			return true
		}
	}
	return false
}

func hasWildcard(pattern string) bool {
	return strings.ContainsAny(pattern, `*?<>"`)
}
