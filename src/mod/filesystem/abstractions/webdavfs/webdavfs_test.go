package webdavfs

import (
	"testing"
)

func TestNewWebDAVFS(t *testing.T) {
	fs := NewWebDAVFS("", "", "")
	if fs == nil {
		t.Error("FS should not be nil")
	}
}
