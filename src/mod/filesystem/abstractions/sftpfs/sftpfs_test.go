package sftpfs

import (
	"net"
	"strconv"
	"testing"
)

// TestNewSFTPFileSystemAbstractionUnreachable fails cleanly when nothing
// listens on the port.
func TestNewSFTPFileSystemAbstractionUnreachable(t *testing.T) {
	//Take a free port and release it, so the dial is refused
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen error: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	_, err = NewSFTPFileSystemAbstraction("nas", "public", "127.0.0.1", port, "/data", "alice", "secret")
	if err == nil {
		t.Fatal("connecting to port " + strconv.Itoa(port) + " should fail")
	}
}

// TestSFTPPathTranslation maps virtual paths under the mount folder and back.
func TestSFTPPathTranslation(t *testing.T) {
	tests := []struct {
		name      string
		hierarchy string
		vpath     string
		rpath     string
	}{
		{"public file", "public", "nas:/Music/a.mp3", "/data/Music/a.mp3"},
		{"public root", "public", "nas:/", "/data"},
		{"user home", "user", "nas:/Desktop", "/data/users/alice/Desktop"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := SFTPFileSystemAbstraction{uuid: "nas", hierarchy: tt.hierarchy, mountFolder: "/data"}
			rpath, err := s.VirtualPathToRealPath(tt.vpath, "alice")
			if err != nil {
				t.Fatalf("VirtualPathToRealPath(%q) error: %v", tt.vpath, err)
			}
			if rpath != tt.rpath {
				t.Errorf("VirtualPathToRealPath(%q) = %q, want %q", tt.vpath, rpath, tt.rpath)
			}
		})
	}

	s := SFTPFileSystemAbstraction{uuid: "nas", hierarchy: "public", mountFolder: "/data"}
	if _, err := s.VirtualPathToRealPath("nas:/../etc", "alice"); err == nil {
		t.Error("a path climbing out of the drive should be refused")
	}
}
