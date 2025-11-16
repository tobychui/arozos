package webdavserv

import (
	"testing"
)

func TestNewWebDAVServer(t *testing.T) {
	server := NewWebDAVServer(nil, 0, "")
	if server == nil {
		t.Error("Server should not be nil")
	}
}
