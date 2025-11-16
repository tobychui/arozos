package ldapreader

import (
	"testing"
)

func TestNewLDAPReader(t *testing.T) {
	// Test case 1: Create LDAP reader with test parameters
	reader := NewLDAPReader("testuser", "testpass", "ldap.example.com", "dc=example,dc=com")
	if reader == nil {
		t.Error("Test case 1 failed. Reader should not be nil")
	}

	// Test case 2: Verify reader can be created with empty parameters
	emptyReader := NewLDAPReader("", "", "", "")
	if emptyReader == nil {
		t.Error("Test case 2 failed. Reader should not be nil even with empty parameters")
	}
}
