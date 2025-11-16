package ldapreader

import (
	"testing"
)

func TestNewLdapReader(t *testing.T) {
	reader := NewLdapReader("", "", "", "", "")
	if reader == nil {
		t.Error("Reader should not be nil")
	}
}
