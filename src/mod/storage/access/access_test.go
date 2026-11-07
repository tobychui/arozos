package access

import (
	"testing"

	"imuslab.com/arozos/mod/filesystem/arozfs"
)

func TestLevelsMatchArozfs(t *testing.T) {
	if None != arozfs.FsDenied || Read != arozfs.FsReadOnly || ReadWrite != arozfs.FsReadWrite {
		t.Fatalf("levels %q %q %q differ from arozfs", None, Read, ReadWrite)
	}
}

func TestExplain(t *testing.T) {
	familyOnly := Rule{Other: None, Groups: map[string]string{"family": ReadWrite}}
	notInterns := Rule{Other: ReadWrite, Groups: map[string]string{"interns": None}}
	staffRead := Rule{Other: None, Groups: map[string]string{"staff": Read}}

	tests := []struct {
		name       string
		drive      Drive
		subject    Subject
		rule       Rule
		wantLevel  string
		wantReason string
		wantGroup  string
		wantCapped bool
	}{
		{
			name:       "user drive ignores the rule",
			drive:      Drive{UUID: UserDriveID},
			subject:    Subject{},
			rule:       Rule{Other: None},
			wantLevel:  ReadWrite,
			wantReason: ReasonFixed,
		},
		{
			name:       "tmp drive ignores the rule",
			drive:      Drive{UUID: TmpDriveID},
			subject:    Subject{Groups: []string{"guests"}},
			rule:       Rule{Other: None, Groups: map[string]string{"guests": None}},
			wantLevel:  ReadWrite,
			wantReason: ReasonFixed,
		},
		{
			name:       "home group always has full access",
			drive:      Drive{UUID: "photos", HomeGroup: "family"},
			subject:    Subject{Groups: []string{"family"}},
			rule:       Rule{Other: None, Groups: map[string]string{"family": None}},
			wantLevel:  ReadWrite,
			wantReason: ReasonHome,
			wantGroup:  "family",
		},
		{
			name:       "home group on a read only drive is capped",
			drive:      Drive{UUID: "photos", HomeGroup: "family", ReadOnly: true},
			subject:    Subject{Groups: []string{"family"}},
			rule:       Rule{Other: None},
			wantLevel:  Read,
			wantReason: ReasonHome,
			wantGroup:  "family",
			wantCapped: true,
		},
		{
			name:       "admin keeps a system drive closed to others",
			drive:      Drive{UUID: ClusterDriveID},
			subject:    Subject{Groups: []string{"administrator"}, IsAdmin: true},
			rule:       Rule{Other: None},
			wantLevel:  ReadWrite,
			wantReason: ReasonAdmin,
		},
		{
			name:       "admin row of None cannot lock admins out of the system pool",
			drive:      Drive{UUID: "media"},
			subject:    Subject{Groups: []string{"administrator"}, IsAdmin: true},
			rule:       Rule{Other: None, Groups: map[string]string{"administrator": None}},
			wantLevel:  ReadWrite,
			wantReason: ReasonAdmin,
		},
		{
			name:       "admin is only capped to read on share",
			drive:      Drive{UUID: ShareDriveID, ReadOnly: true},
			subject:    Subject{IsAdmin: true},
			rule:       Rule{Other: None},
			wantLevel:  Read,
			wantReason: ReasonAdmin,
			wantCapped: true,
		},
		{
			name:       "admin gets no shortcut into another group's pool",
			drive:      Drive{UUID: "photos", HomeGroup: "family"},
			subject:    Subject{Groups: []string{"administrator"}, IsAdmin: true},
			rule:       Rule{Other: None},
			wantLevel:  None,
			wantReason: ReasonOther,
		},
		{
			name:       "member of the listed group",
			drive:      Drive{UUID: ClusterDriveID},
			subject:    Subject{Groups: []string{"family"}},
			rule:       familyOnly,
			wantLevel:  ReadWrite,
			wantReason: ReasonGroup,
			wantGroup:  "family",
		},
		{
			name:       "user outside the listed group",
			drive:      Drive{UUID: ClusterDriveID},
			subject:    Subject{Groups: []string{"default"}},
			rule:       familyOnly,
			wantLevel:  None,
			wantReason: ReasonOther,
		},
		{
			name:       "a None row blocks a group from an open drive",
			drive:      Drive{UUID: "media"},
			subject:    Subject{Groups: []string{"interns"}},
			rule:       notInterns,
			wantLevel:  None,
			wantReason: ReasonGroup,
			wantGroup:  "interns",
		},
		{
			name:       "the rest still get the open level",
			drive:      Drive{UUID: "media"},
			subject:    Subject{Groups: []string{"staff"}},
			rule:       notInterns,
			wantLevel:  ReadWrite,
			wantReason: ReasonOther,
		},
		{
			name:       "the highest row of a user's groups wins",
			drive:      Drive{UUID: "media"},
			subject:    Subject{Groups: []string{"interns", "staff"}},
			rule:       Rule{Other: ReadWrite, Groups: map[string]string{"interns": None, "staff": Read}},
			wantLevel:  Read,
			wantReason: ReasonGroup,
			wantGroup:  "staff",
		},
		{
			name:       "a read row reaches into another group's pool",
			drive:      Drive{UUID: "campaigns", HomeGroup: "marketing"},
			subject:    Subject{Groups: []string{"staff"}},
			rule:       staffRead,
			wantLevel:  Read,
			wantReason: ReasonGroup,
			wantGroup:  "staff",
		},
		{
			name:       "a read only drive caps a read write row",
			drive:      Drive{UUID: "archive", ReadOnly: true},
			subject:    Subject{Groups: []string{"family"}},
			rule:       familyOnly,
			wantLevel:  Read,
			wantReason: ReasonGroup,
			wantGroup:  "family",
			wantCapped: true,
		},
		{
			name:       "a damaged level counts as None",
			drive:      Drive{UUID: "media"},
			subject:    Subject{},
			rule:       Rule{Other: "everything"},
			wantLevel:  None,
			wantReason: ReasonOther,
		},
		{
			name:       "a damaged row is not a grant",
			drive:      Drive{UUID: "media"},
			subject:    Subject{Groups: []string{"family"}},
			rule:       Rule{Other: None, Groups: map[string]string{"family": "everything"}},
			wantLevel:  None,
			wantReason: ReasonGroup,
			wantGroup:  "family",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Explain(tt.drive, tt.subject, tt.rule)
			if got.Level != tt.wantLevel {
				t.Errorf("Level = %q, want %q", got.Level, tt.wantLevel)
			}
			if got.Reason != tt.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tt.wantReason)
			}
			if got.Group != tt.wantGroup {
				t.Errorf("Group = %q, want %q", got.Group, tt.wantGroup)
			}
			if got.Capped != tt.wantCapped {
				t.Errorf("Capped = %v, want %v", got.Capped, tt.wantCapped)
			}
		})
	}
}

/*
The defaults must reproduce what every user could do before access lists
existed: the system pool open to everyone, group pools for their members only.
*/
func TestDefaultRuleKeepsTheOldAccess(t *testing.T) {
	member := Subject{Groups: []string{"family"}}
	stranger := Subject{Groups: []string{"default"}}
	admin := Subject{Groups: []string{"administrator"}, IsAdmin: true}

	tests := []struct {
		name    string
		drive   Drive
		subject Subject
		want    string
	}{
		{"home for a user", Drive{UUID: UserDriveID}, stranger, ReadWrite},
		{"tmp for a user", Drive{UUID: TmpDriveID}, stranger, ReadWrite},
		{"system drive for a user", Drive{UUID: "media"}, stranger, ReadWrite},
		{"system drive for an admin", Drive{UUID: "media"}, admin, ReadWrite},
		{"read only system drive", Drive{UUID: "archive", ReadOnly: true}, stranger, Read},
		{"share for a user", Drive{UUID: ShareDriveID, ReadOnly: true}, stranger, Read},
		{"share for an admin", Drive{UUID: ShareDriveID, ReadOnly: true}, admin, Read},
		{"cluster for a user", Drive{UUID: ClusterDriveID}, stranger, ReadWrite},
		{"cluster for an admin", Drive{UUID: ClusterDriveID}, admin, ReadWrite},
		{"group drive for a member", Drive{UUID: "photos", HomeGroup: "family"}, member, ReadWrite},
		{"read only group drive for a member", Drive{UUID: "photos", HomeGroup: "family", ReadOnly: true}, member, Read},
		{"group drive for a stranger", Drive{UUID: "photos", HomeGroup: "family"}, stranger, None},
		{"group drive for an admin who is not a member", Drive{UUID: "photos", HomeGroup: "family"}, admin, None},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := DefaultRule(tt.drive.UUID, tt.drive.HomeGroup)
			if got := Level(tt.drive, tt.subject, rule); got != tt.want {
				t.Errorf("Level = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRuleValidate(t *testing.T) {
	tests := []struct {
		name    string
		rule    Rule
		wantErr bool
	}{
		{"everyone else only", Rule{Other: ReadWrite}, false},
		{"with rows", Rule{Other: None, Groups: map[string]string{"a": Read, "b": None}}, false},
		{"missing level", Rule{}, true},
		{"unknown level", Rule{Other: "writeonly"}, true},
		{"unknown row level", Rule{Other: None, Groups: map[string]string{"a": "writeonly"}}, true},
		{"empty group name", Rule{Other: None, Groups: map[string]string{"": Read}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.rule.Validate(); (err != nil) != tt.wantErr {
				t.Errorf("Validate() = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRuleCloneSharesNothing(t *testing.T) {
	original := Rule{Other: None, Groups: map[string]string{"a": Read}}
	clone := original.Clone()
	clone.Groups["a"] = ReadWrite
	if original.Groups["a"] != Read {
		t.Fatalf("changing the clone changed the original: %v", original.Groups)
	}
}

func TestHigher(t *testing.T) {
	tests := []struct {
		a, b, want string
	}{
		{None, Read, Read},
		{Read, None, Read},
		{Read, ReadWrite, ReadWrite},
		{ReadWrite, None, ReadWrite},
		{None, None, None},
	}
	for _, tt := range tests {
		if got := Higher(tt.a, tt.b); got != tt.want {
			t.Errorf("Higher(%q, %q) = %q, want %q", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestDriveKinds(t *testing.T) {
	tests := []struct {
		uuid        string
		wantFixed   bool
		wantBuiltin bool
	}{
		{UserDriveID, true, true},
		{TmpDriveID, true, true},
		{ShareDriveID, false, true},
		{ClusterDriveID, false, true},
		{"media", false, false},
	}
	for _, tt := range tests {
		if got := IsFixed(tt.uuid); got != tt.wantFixed {
			t.Errorf("IsFixed(%q) = %v, want %v", tt.uuid, got, tt.wantFixed)
		}
		if got := IsBuiltin(tt.uuid); got != tt.wantBuiltin {
			t.Errorf("IsBuiltin(%q) = %v, want %v", tt.uuid, got, tt.wantBuiltin)
		}
	}
}
