package sharedspace

import (
	"path/filepath"
	"testing"
)

// newAccessTestSpace builds a space with one admin ("adam") and one plain
// member ("mia") besides the owner ("alice").
func newAccessTestSpace(t *testing.T, access string) (*Manager, *Space) {
	t.Helper()
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space, err := m.CreateSpaceWithOptions("alice", "ACL test", SpaceOptions{Access: access})
	if err != nil {
		t.Fatalf("CreateSpaceWithOptions() error = %v", err)
	}
	if err := space.AddMember("alice", "adam", RoleAdmin); err != nil {
		t.Fatalf("AddMember(adam) error = %v", err)
	}
	if err := space.AddMember("alice", "mia", RoleMember); err != nil {
		t.Fatalf("AddMember(mia) error = %v", err)
	}
	return m, space
}

func TestAccessMatrix(t *testing.T) {
	tests := []struct {
		access     string
		username   string
		wantRead   bool
		wantPost   bool
		wantManage bool
	}{
		{AccessOpen, "alice", true, true, true}, //owner
		{AccessOpen, "adam", true, true, true},  //space admin
		{AccessOpen, "mia", true, true, false},  //member
		{AccessOpen, "stranger", true, true, false},
		{AccessOpen, "", true, true, true}, //system authority
		{AccessPublic, "alice", true, true, true},
		{AccessPublic, "stranger", true, true, false},
		{AccessPublic, "", true, true, true},
		{AccessPrivate, "alice", true, true, true},
		{AccessPrivate, "adam", true, true, true},
		{AccessPrivate, "mia", true, true, false},
		{AccessPrivate, "stranger", false, false, false},
		{AccessPrivate, "", true, true, true},
	}
	for _, tt := range tests {
		t.Run(tt.access+"/"+tt.username, func(t *testing.T) {
			_, space := newAccessTestSpace(t, tt.access)
			if got := space.CanRead(tt.username); got != tt.wantRead {
				t.Errorf("CanRead(%q) = %v, want %v", tt.username, got, tt.wantRead)
			}
			if got := space.CanPost(tt.username); got != tt.wantPost {
				t.Errorf("CanPost(%q) = %v, want %v", tt.username, got, tt.wantPost)
			}
			if got := space.CanManage(tt.username); got != tt.wantManage {
				t.Errorf("CanManage(%q) = %v, want %v", tt.username, got, tt.wantManage)
			}
		})
	}
}

func TestCreateSpaceWithOptionsValidation(t *testing.T) {
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)

	if _, err := m.CreateSpaceWithOptions("alice", "x", SpaceOptions{Access: "secret"}); err != ErrInvalidAccess {
		t.Errorf("invalid access error = %v, want ErrInvalidAccess", err)
	}
	//Memory-only manager cannot create persistent spaces
	if _, err := m.CreateSpaceWithOptions("alice", "x", SpaceOptions{Persistent: true}); err != ErrPersistenceOff {
		t.Errorf("persistent-on-memory-manager error = %v, want ErrPersistenceOff", err)
	}
	//Default access is open, owner is seeded as member
	space, err := m.CreateSpaceWithOptions("alice", "x", SpaceOptions{})
	if err != nil {
		t.Fatalf("CreateSpaceWithOptions() error = %v", err)
	}
	if space.AccessMode() != AccessOpen {
		t.Errorf("default access = %q, want open", space.AccessMode())
	}
	if role, ok := space.Role("alice"); !ok || role != RoleOwner {
		t.Errorf("owner role = %q/%v, want owner/true", role, ok)
	}
	//Initial metadata is sanitized in
	space2, _ := m.CreateSpaceWithOptions("alice", "x", SpaceOptions{
		Metadata: map[string]string{"purpose": "chat", "": "dropped"},
	})
	if meta := space2.Metadata(); meta["purpose"] != "chat" || len(meta) != 1 {
		t.Errorf("initial metadata = %v, want {purpose:chat}", meta)
	}
}

func TestMembershipManagement(t *testing.T) {
	_, space := newAccessTestSpace(t, AccessPrivate)

	tests := []struct {
		name    string
		action  func() error
		wantErr error
	}{
		{"stranger cannot invite", func() error { return space.AddMember("stranger", "eve", RoleMember) }, ErrPermissionDenied},
		{"member cannot invite", func() error { return space.AddMember("mia", "eve", RoleMember) }, ErrPermissionDenied},
		{"invalid role rejected", func() error { return space.AddMember("alice", "eve", "superuser") }, ErrInvalidRole},
		{"owner role not grantable", func() error { return space.AddMember("alice", "eve", RoleOwner) }, ErrInvalidRole},
		{"admin can invite", func() error { return space.AddMember("adam", "eve", RoleMember) }, nil},
		{"duplicate invite rejected", func() error { return space.AddMember("alice", "eve", RoleMember) }, ErrMemberExists},
		{"owner cannot be removed", func() error { return space.RemoveMember("alice", "alice") }, ErrPermissionDenied},
		{"stranger cannot remove", func() error { return space.RemoveMember("stranger", "mia") }, ErrPermissionDenied},
		{"self-leave allowed", func() error { return space.RemoveMember("eve", "eve") }, nil},
		{"remove non-member", func() error { return space.RemoveMember("alice", "eve") }, ErrNotMember},
		{"owner role immutable", func() error { return space.SetMemberRole("alice", "alice", RoleAdmin) }, ErrPermissionDenied},
		{"member cannot change roles", func() error { return space.SetMemberRole("mia", "mia", RoleAdmin) }, ErrPermissionDenied},
		{"promote member to admin", func() error { return space.SetMemberRole("alice", "mia", RoleAdmin) }, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.action(); err != tt.wantErr {
				t.Errorf("error = %v, want %v", err, tt.wantErr)
			}
		})
	}

	if role, _ := space.Role("mia"); role != RoleAdmin {
		t.Errorf("mia role after promotion = %q, want admin", role)
	}
	if space.MemberCount() != 3 {
		t.Errorf("MemberCount() = %d, want 3 (alice, adam, mia)", space.MemberCount())
	}
}

func TestJoinPublic(t *testing.T) {
	tests := []struct {
		access  string
		wantErr error
	}{
		{AccessOpen, nil},
		{AccessPublic, nil},
		{AccessPrivate, ErrPermissionDenied},
	}
	for _, tt := range tests {
		t.Run(tt.access, func(t *testing.T) {
			_, space := newAccessTestSpace(t, tt.access)
			if err := space.JoinPublic("newbie"); err != tt.wantErr {
				t.Fatalf("JoinPublic() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr == nil {
				if role, ok := space.Role("newbie"); !ok || role != RoleMember {
					t.Errorf("joined role = %q/%v, want member", role, ok)
				}
				if err := space.JoinPublic("newbie"); err != ErrMemberExists {
					t.Errorf("re-join error = %v, want ErrMemberExists", err)
				}
			}
		})
	}
}

func TestSetAccessAndMetadata(t *testing.T) {
	_, space := newAccessTestSpace(t, AccessOpen)

	if err := space.SetAccess("mia", AccessPrivate); err != ErrPermissionDenied {
		t.Errorf("member SetAccess error = %v, want ErrPermissionDenied", err)
	}
	if err := space.SetAccess("alice", "bogus"); err != ErrInvalidAccess {
		t.Errorf("bogus access error = %v, want ErrInvalidAccess", err)
	}
	if err := space.SetAccess("alice", AccessPrivate); err != nil {
		t.Fatalf("owner SetAccess error = %v", err)
	}
	if space.AccessMode() != AccessPrivate {
		t.Errorf("access = %q after SetAccess, want private", space.AccessMode())
	}
	if space.CanRead("stranger") {
		t.Errorf("stranger can still read after going private")
	}

	if err := space.SetMeta("mia", "k", "v"); err != ErrPermissionDenied {
		t.Errorf("member SetMeta error = %v, want ErrPermissionDenied", err)
	}
	if err := space.SetMeta("alice", "purpose", "standup notes"); err != nil {
		t.Fatalf("SetMeta error = %v", err)
	}
	if space.Metadata()["purpose"] != "standup notes" {
		t.Errorf("metadata not stored: %v", space.Metadata())
	}
	//Empty value deletes the key
	if err := space.SetMeta("alice", "purpose", ""); err != nil {
		t.Fatalf("SetMeta delete error = %v", err)
	}
	if _, exists := space.Metadata()["purpose"]; exists {
		t.Errorf("metadata key survived deletion")
	}
	//Entry cap
	for i := 0; i < maxMetadataKeys; i++ {
		if err := space.SetMeta("alice", "key"+string(rune('a'+i%26))+string(rune('a'+i/26)), "v"); err != nil {
			t.Fatalf("SetMeta cap-fill error = %v", err)
		}
	}
	if err := space.SetMeta("alice", "onemore", "v"); err != ErrMetadataLimit {
		t.Errorf("over-cap SetMeta error = %v, want ErrMetadataLimit", err)
	}
}

func TestSpaceListings(t *testing.T) {
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	m.CreateSpaceWithOptions("alice", "Open", SpaceOptions{})
	pub, _ := m.CreateSpaceWithOptions("alice", "Public", SpaceOptions{Access: AccessPublic})
	priv, _ := m.CreateSpaceWithOptions("bob", "Private", SpaceOptions{Access: AccessPrivate})
	priv.AddMember("bob", "alice", RoleMember)

	publicSpaces := m.ListPublicSpaces()
	if len(publicSpaces) != 1 || publicSpaces[0].ID != pub.ID {
		t.Errorf("ListPublicSpaces() returned %d spaces, want just the public one", len(publicSpaces))
	}
	if got := len(m.ListSpacesByMember("alice")); got != 3 {
		t.Errorf("alice is member of %d spaces, want 3", got)
	}
	if got := len(m.ListSpacesByMember("bob")); got != 1 {
		t.Errorf("bob is member of %d spaces, want 1", got)
	}
	if got := len(m.ListSpaces()); got != 3 {
		t.Errorf("ListSpaces() = %d, want 3", got)
	}
}

func TestAdminCanRemoveOthersItems(t *testing.T) {
	_, space := newAccessTestSpace(t, AccessOpen)
	item, err := space.AddText("mia", "my message", "test")
	if err != nil {
		t.Fatalf("AddText() error = %v", err)
	}
	//A space admin who is neither uploader nor owner may remove items
	if err := space.RemoveItem(item.ID, "adam"); err != nil {
		t.Errorf("admin RemoveItem error = %v, want nil", err)
	}
	//A plain member may not remove someone else's item
	item2, _ := space.AddText("adam", "admin note", "test")
	if err := space.RemoveItem(item2.ID, "mia"); err != ErrPermissionDenied {
		t.Errorf("member RemoveItem error = %v, want ErrPermissionDenied", err)
	}
}

func TestSpaceDiskUsage(t *testing.T) {
	m, space := newAccessTestSpace(t, AccessOpen)
	space.AddText("alice", "12345", "test")
	if usage := m.SpaceDiskUsage(space.ID); usage != 5 {
		t.Errorf("SpaceDiskUsage() = %d, want 5", usage)
	}
	if usage := m.SpaceDiskUsage("nonexistent"); usage != 0 {
		t.Errorf("SpaceDiskUsage(unknown) = %d, want 0", usage)
	}
}
