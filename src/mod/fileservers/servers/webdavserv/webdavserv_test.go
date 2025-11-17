package webdavserv

import (
	"testing"
)

func TestNewWebDAVManager(t *testing.T) {
	manager := NewWebDAVManager(nil)
	if manager == nil {
		t.Error("Manager should not be nil")
	}
}
