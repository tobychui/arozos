package ldap

import (
	"testing"
)

func TestLdapConfigStruct(t *testing.T) {
	// Test case 1: Create and verify Config structure
	config := Config{
		Enabled:      true,
		BindUsername: "admin",
		BindPassword: "password",
		FQDN:         "ldap.example.com",
		BaseDN:       "dc=example,dc=com",
	}

	if !config.Enabled {
		t.Error("Test case 1 failed. Enabled should be true")
	}
	if config.BindUsername != "admin" {
		t.Error("Test case 1 failed. BindUsername mismatch")
	}
	if config.FQDN != "ldap.example.com" {
		t.Error("Test case 1 failed. FQDN mismatch")
	}
}

func TestUserAccountStruct(t *testing.T) {
	// Test case 1: Create UserAccount with groups
	user := UserAccount{
		Username:   "testuser",
		Group:      []string{"users", "developers"},
		EquivGroup: []string{"staff"},
	}

	if user.Username != "testuser" {
		t.Error("Test case 1 failed. Username mismatch")
	}
	if len(user.Group) != 2 {
		t.Errorf("Test case 1 failed. Expected 2 groups, got %d", len(user.Group))
	}
	if len(user.EquivGroup) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 equiv group, got %d", len(user.EquivGroup))
	}
}
