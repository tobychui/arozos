package smbfs

import "testing"

// Translation needs no connection, so the abstraction is built bare
func TestVirtualPathToRealPath(t *testing.T) {
	tests := []struct {
		hierarchy string
		vpath     string
		want      string
	}{
		{"user", "nas:/Desktop/a.txt", "share\\users\\alice\\Desktop\\a.txt"},
		{"user", "nas:/", "share\\users\\alice"},
		{"user", "nas:/Desktop/../Music", "share\\users\\alice\\Music"},
		{"public", "nas:/docs/a.txt", "share\\docs\\a.txt"},
		{"public", "nas:/", "share"},
	}

	for _, tt := range tests {
		a := ServerMessageBlockFileSystemAbstraction{UUID: "nas", Hierarchy: tt.hierarchy, fsaRoot: "share"}
		got, err := a.VirtualPathToRealPath(tt.vpath, "alice")
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
		a := ServerMessageBlockFileSystemAbstraction{UUID: "nas", Hierarchy: hierarchy, fsaRoot: "share"}
		for _, vpath := range []string{"nas:../bob/secret.txt", "nas:/../bob", "nas:/a/../../bob", "nas:..\\bob"} {
			if got, err := a.VirtualPathToRealPath(vpath, "alice"); err == nil {
				t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want an error", hierarchy, vpath, got)
			}
		}
	}
}
