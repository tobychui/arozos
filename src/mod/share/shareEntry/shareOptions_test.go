package shareEntry

import (
	"testing"
)

func TestIsOwnedBy(t *testing.T) {
	// Test case 1: Owner matches
	shareOption := &ShareOption{
		Owner: "alice",
	}
	if !shareOption.IsOwnedBy("alice") {
		t.Error("Test case 1 failed. Should return true for owner")
	}

	// Test case 2: Owner does not match
	if shareOption.IsOwnedBy("bob") {
		t.Error("Test case 2 failed. Should return false for non-owner")
	}

	// Test case 3: Empty owner
	shareOption2 := &ShareOption{
		Owner: "",
	}
	if shareOption2.IsOwnedBy("alice") {
		t.Error("Test case 3 failed. Empty owner should not match")
	}

	// Test case 4: Empty username check
	if shareOption.IsOwnedBy("") {
		t.Error("Test case 4 failed. Empty username should not match")
	}

	// Test case 5: Case sensitive check
	if shareOption.IsOwnedBy("Alice") {
		t.Error("Test case 5 failed. Should be case sensitive")
	}

	// Test case 6: Both empty
	if !shareOption2.IsOwnedBy("") {
		t.Error("Test case 6 failed. Empty owner and empty username should match")
	}
}

func TestIsAccessibleBy(t *testing.T) {
	// Test case 1: Permission "anyone"
	shareOption := &ShareOption{
		Owner:      "alice",
		Permission: "anyone",
	}
	if !shareOption.IsAccessibleBy("bob", []string{"group1"}) {
		t.Error("Test case 1 failed. Anyone should have access")
	}

	// Test case 2: Permission "signedin"
	shareOption2 := &ShareOption{
		Owner:      "alice",
		Permission: "signedin",
	}
	if !shareOption2.IsAccessibleBy("bob", []string{"group1"}) {
		t.Error("Test case 2 failed. Signed in users should have access")
	}

	// Test case 3: Permission "samegroup" - user in allowed group
	shareOption3 := &ShareOption{
		Owner:       "alice",
		Permission:  "samegroup",
		Accessibles: []string{"group1", "group2"},
	}
	if !shareOption3.IsAccessibleBy("bob", []string{"group1", "group3"}) {
		t.Error("Test case 3 failed. User in same group should have access")
	}

	// Test case 4: Permission "samegroup" - user not in allowed group
	if shareOption3.IsAccessibleBy("bob", []string{"group3", "group4"}) {
		t.Error("Test case 4 failed. User not in same group should not have access")
	}

	// Test case 5: Permission "groups" - user in allowed group
	shareOption4 := &ShareOption{
		Owner:       "alice",
		Permission:  "groups",
		Accessibles: []string{"group1", "group2"},
	}
	if !shareOption4.IsAccessibleBy("bob", []string{"group1"}) {
		t.Error("Test case 5 failed. User in allowed group should have access")
	}

	// Test case 6: Permission "groups" - user not in allowed group
	if shareOption4.IsAccessibleBy("bob", []string{"group3"}) {
		t.Error("Test case 6 failed. User not in allowed group should not have access")
	}

	// Test case 7: Permission "users" - user in allowed list
	shareOption5 := &ShareOption{
		Owner:       "alice",
		Permission:  "users",
		Accessibles: []string{"bob", "charlie"},
	}
	if !shareOption5.IsAccessibleBy("bob", []string{}) {
		t.Error("Test case 7 failed. User in allowed list should have access")
	}

	// Test case 8: Permission "users" - user not in allowed list
	if shareOption5.IsAccessibleBy("david", []string{}) {
		t.Error("Test case 8 failed. User not in allowed list should not have access")
	}

	// Test case 9: Permission "users" - owner has access
	if !shareOption5.IsAccessibleBy("alice", []string{}) {
		t.Error("Test case 9 failed. Owner should have access even if not in allowed list")
	}

	// Test case 10: Empty user groups with "samegroup"
	shareOption6 := &ShareOption{
		Owner:       "alice",
		Permission:  "samegroup",
		Accessibles: []string{"group1"},
	}
	if shareOption6.IsAccessibleBy("bob", []string{}) {
		t.Error("Test case 10 failed. User with no groups should not have access to samegroup")
	}

	// Test case 11: Empty accessibles with "samegroup"
	shareOption7 := &ShareOption{
		Owner:       "alice",
		Permission:  "samegroup",
		Accessibles: []string{},
	}
	if shareOption7.IsAccessibleBy("bob", []string{"group1"}) {
		t.Error("Test case 11 failed. No accessible groups should deny access")
	}

	// Test case 12: Multiple groups, one matches
	shareOption8 := &ShareOption{
		Owner:       "alice",
		Permission:  "groups",
		Accessibles: []string{"group1", "group2", "group3"},
	}
	if !shareOption8.IsAccessibleBy("bob", []string{"group4", "group2", "group5"}) {
		t.Error("Test case 12 failed. At least one matching group should grant access")
	}

	// Test case 13: Unknown permission type
	shareOption9 := &ShareOption{
		Owner:      "alice",
		Permission: "unknown",
	}
	if shareOption9.IsAccessibleBy("bob", []string{"group1"}) {
		t.Error("Test case 13 failed. Unknown permission should deny access")
	}

	// Test case 14: Empty permission
	shareOption10 := &ShareOption{
		Owner:      "alice",
		Permission: "",
	}
	if shareOption10.IsAccessibleBy("bob", []string{"group1"}) {
		t.Error("Test case 14 failed. Empty permission should deny access")
	}

	// Test case 15: Permission "users" with owner in allowed list
	shareOption11 := &ShareOption{
		Owner:       "alice",
		Permission:  "users",
		Accessibles: []string{"alice", "bob"},
	}
	if !shareOption11.IsAccessibleBy("alice", []string{}) {
		t.Error("Test case 15 failed. Owner should have access")
	}

	// Test case 16: Case sensitivity for username in "users"
	shareOption12 := &ShareOption{
		Owner:       "alice",
		Permission:  "users",
		Accessibles: []string{"bob"},
	}
	if shareOption12.IsAccessibleBy("Bob", []string{}) {
		t.Error("Test case 16 failed. Username should be case sensitive")
	}

	// Test case 17: Case sensitivity for groups
	shareOption13 := &ShareOption{
		Owner:       "alice",
		Permission:  "groups",
		Accessibles: []string{"group1"},
	}
	if shareOption13.IsAccessibleBy("bob", []string{"Group1"}) {
		t.Error("Test case 17 failed. Group names should be case sensitive")
	}
}
