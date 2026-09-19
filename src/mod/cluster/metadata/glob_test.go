package metadata

import "testing"

func TestMatchGlob(t *testing.T) {
	tests := []struct {
		pattern string
		path    string
		want    bool
	}{
		{"/photos/*.jpg", "/photos/a.jpg", true},
		{"/photos/*.jpg", "/photos/a.png", false},
		{"/photos/*.jpg", "/photos/2026/a.jpg", false},
		{"/photos/**/*.jpg", "/photos/2026/a.jpg", true},
		{"/photos/**/*.jpg", "/photos/a.jpg", true}, //"**" may match zero folders
		{"/photos/**/*.jpg", "/photos/2026/07/a.jpg", true},
		{"/photos/**", "/photos/2026/07/a.jpg", true},
		{"/photos/**", "/other/a.jpg", false},
		{"cluster:/photos/*.jpg", "/photos/a.jpg", true},
		{"/photos/a?.jpg", "/photos/a1.jpg", true},
		{"/photos/a?.jpg", "/photos/a12.jpg", false},
		{"/*", "/a.txt", true},
		{"/*", "/dir/a.txt", false},
		{"/photos/a.jpg", "/photos/a.jpg", true},
		{"/Photos/*.jpg", "/photos/a.jpg", false},
	}
	for _, tc := range tests {
		if got := MatchGlob(tc.pattern, tc.path); got != tc.want {
			t.Errorf("MatchGlob(%q, %q) = %v want %v", tc.pattern, tc.path, got, tc.want)
		}
	}
}

func TestGlobOverNamespace(t *testing.T) {
	n := newTestNode(t, "solo")
	st := n.meta.st
	paths := []string{"/photos/a.jpg", "/photos/b.png", "/photos/2026/c.jpg", "/photos/2026/07/d.jpg", "/docs/e.jpg"}
	for i, p := range paths {
		st.putFile(&FileRecord{ID: "f" + string(rune('0'+i)), Path: p, Size: int64(i + 1), Version: 1})
	}
	st.putFile(&FileRecord{ID: "d1", Path: "/photos/2026", IsDir: true, Version: 1})
	st.putFile(&FileRecord{ID: "gone", Path: "/photos/z.jpg", Removed: true, Version: 2})

	got := func(pattern string) []string {
		out := []string{}
		for _, rec := range n.meta.Glob(pattern) {
			out = append(out, rec.Path)
		}
		return out
	}
	if g := got("/photos/*.jpg"); len(g) != 1 || g[0] != "/photos/a.jpg" {
		t.Errorf("shallow glob = %v", g)
	}
	//"**" may stand for zero folders, so this also matches /photos/a.jpg
	if g := got("cluster:/photos/**/*.jpg"); len(g) != 3 || g[0] != "/photos/2026/07/d.jpg" || g[2] != "/photos/a.jpg" {
		t.Errorf("deep glob = %v", g)
	}
	if g := got("/photos/**"); len(g) != 4 {
		t.Errorf("all under photos = %v", g)
	}
	if g := got("/**/*.jpg"); len(g) != 4 {
		t.Errorf("all jpg = %v", g)
	}
	if g := got("/nothing/*"); len(g) != 0 {
		t.Errorf("no match should be empty: %v", g)
	}
	if g := got("/docs/e.jpg"); len(g) != 1 {
		t.Errorf("literal path glob = %v", g)
	}
	//Directories and tombstones never appear
	for _, p := range got("/photos/**") {
		if p == "/photos/2026" || p == "/photos/z.jpg" {
			t.Errorf("glob returned %s", p)
		}
	}
}
