package dirserv

import (
	"testing"
)

func TestNewDirectoryServer(t *testing.T) {
	server := NewDirectoryServer(nil)
	if server == nil {
		t.Error("Server should not be nil")
	}
}
