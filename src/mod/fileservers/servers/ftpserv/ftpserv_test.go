package ftpserv

import (
	"testing"
)

func TestNewFTPServer(t *testing.T) {
	server := NewFTPServer(nil, 0, "")
	if server == nil {
		t.Error("Server should not be nil")
	}
}
