package metadata

/*
	Namespace globbing.

	Patterns are matched against logical paths:
		*   any run of characters except "/"
		**  any run of characters including "/" (crosses folders; it may also
		    stand for no folder at all, so a deep pattern still matches a
		    file that sits directly in the folder)
		?   exactly one character except "/"
	Everything else matches literally. "cluster:" prefixes are accepted.
*/

import (
	"sort"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// MatchGlob reports whether a logical path matches a glob pattern.
func MatchGlob(pattern string, path string) bool {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "MatchGlob: pattern=%.120q path=%.120q", pattern, path)
	}
	pattern = NormalizePath(pattern)
	path = NormalizePath(path)
	return matchSegments(splitPath(pattern), splitPath(path))
}

func splitPath(p string) []string {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "splitPath: p=%.120q", p)
	}
	p = strings.Trim(p, "/")
	if p == "" {
		return []string{}
	}
	return strings.Split(p, "/")
}

// matchSegments matches path segments against pattern segments, where "**"
// consumes any number of segments.
func matchSegments(pat []string, seg []string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("cluster/metadata", "matchSegments: len(pat)=%d len(seg)=%d", len(pat), len(seg))
	}
	if len(pat) == 0 {
		return len(seg) == 0
	}
	if pat[0] == "**" {
		//"**" at the end matches everything below
		if len(pat) == 1 {
			return true
		}
		for i := 0; i <= len(seg); i++ {
			if matchSegments(pat[1:], seg[i:]) {
				return true
			}
		}
		return false
	}
	if len(seg) == 0 {
		return false
	}
	if !matchOne(pat[0], seg[0]) {
		return false
	}
	return matchSegments(pat[1:], seg[1:])
}

// matchOne matches a single segment with * and ? wildcards.
func matchOne(pattern string, name string) bool {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "matchOne: pattern=%.120q name=%.120q", pattern, name)
	}
	pi, ni := 0, 0
	star, match := -1, 0
	for ni < len(name) {
		switch {
		case pi < len(pattern) && (pattern[pi] == '?' || pattern[pi] == name[ni]):
			pi++
			ni++
		case pi < len(pattern) && pattern[pi] == '*':
			star = pi
			match = ni
			pi++
		case star >= 0:
			pi = star + 1
			match++
			ni = match
		default:
			return false
		}
	}
	for pi < len(pattern) && pattern[pi] == '*' {
		pi++
	}
	return pi == len(pattern)
}

// Glob returns every live file record whose path matches the pattern,
// sorted by path. Directories are skipped.
func (mgr *Manager) Glob(pattern string) []FileRecord {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "Manager.Glob: pattern=%.120q", pattern)
	}
	pattern = NormalizePath(pattern)
	//Narrow the scan to the literal prefix before the first wildcard
	prefix := "/"
	segs := splitPath(pattern)
	literal := []string{}
	for _, s := range segs {
		if strings.ContainsAny(s, "*?") {
			break
		}
		literal = append(literal, s)
	}
	if len(literal) > 0 {
		prefix = "/" + strings.Join(literal, "/")
	}
	candidates := mgr.ListSubtree(prefix)
	if rec, err := mgr.Stat(prefix); err == nil && !rec.IsDir {
		candidates = append(candidates, *rec)
	}
	out := []FileRecord{}
	for _, rec := range candidates {
		if rec.IsDir || rec.Removed {
			continue
		}
		if MatchGlob(pattern, rec.Path) {
			out = append(out, rec)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}
