package webdavfs

import "testing"

// Translation needs no connection, so the abstraction is built bare
func TestVirtualPathToRealPath(t *testing.T) {
	tests := []struct {
		hierarchy string
		vpath     string
		want      string
	}{
		{"user", "dav:/Desktop/a.txt", "users/alice/Desktop/a.txt"},
		{"user", "dav:/", "users/alice"},
		{"public", "dav:/docs/a.txt", "/docs/a.txt"},
		{"public", "dav:/", "/"},
	}

	for _, tt := range tests {
		e := WebDAVFileSystem{UUID: "dav", Hierarchy: tt.hierarchy}
		got, err := e.VirtualPathToRealPath(tt.vpath, "alice")
		if err != nil {
			t.Errorf("[%s] VirtualPathToRealPath(%q) unexpected error: %v", tt.hierarchy, tt.vpath, err)
			continue
		}
		if got != tt.want {
			t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want %q", tt.hierarchy, tt.vpath, got, tt.want)
		}
	}
}

func TestVirtualPathToRealPath_RejectsTraversal(t *testing.T) {
	for _, hierarchy := range []string{"user", "public"} {
		e := WebDAVFileSystem{UUID: "dav", Hierarchy: hierarchy}
		for _, vpath := range []string{"dav:../bob/secret.txt", "dav:/../bob", "dav:/a/../../bob"} {
			if got, err := e.VirtualPathToRealPath(vpath, "alice"); err == nil {
				t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want an error", hierarchy, vpath, got)
			}
		}
	}
}
