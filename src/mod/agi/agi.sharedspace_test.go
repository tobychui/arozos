package agi

import (
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/sharedspace"
	user "imuslab.com/arozos/mod/user"
)

func TestResolveNotifyRecipients(t *testing.T) {
	members := map[string]string{
		"alice": "owner", "bob": "member", "carol": "member", "dave": "member",
	}
	tests := []struct {
		name      string
		present   map[string]bool
		sender    string
		requested []string
		want      []string
	}{
		{
			name:   "all members except the sender",
			sender: "alice",
			want:   []string{"bob", "carol", "dave"},
		},
		{
			name:    "members present in the space are skipped",
			sender:  "alice",
			present: map[string]bool{"bob": true},
			want:    []string{"carol", "dave"},
		},
		{
			name:      "an explicit list narrows the recipients",
			sender:    "alice",
			requested: []string{"bob", "dave"},
			want:      []string{"bob", "dave"},
		},
		{
			name:      "explicit targets are intersected with members",
			sender:    "alice",
			requested: []string{"bob", "stranger"},
			want:      []string{"bob"},
		},
		{
			name:      "sender and present users are dropped from an explicit list",
			sender:    "alice",
			present:   map[string]bool{"dave": true},
			requested: []string{"alice", "bob", "dave"},
			want:      []string{"bob"},
		},
		{
			name:      "an empty explicit list notifies nobody",
			sender:    "alice",
			requested: []string{},
			want:      []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveNotifyRecipients(members, tt.present, tt.sender, tt.requested)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resolveNotifyRecipients() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestNotifyMembersIntegration drives the injected sharedspace.notifyMembers
// JS function through a real Otto VM against a live space, exercising the full
// path (argument parsing, membership check, presence skip, delivery).
func TestNotifyMembersIntegration(t *testing.T) {
	sm := sharedspace.NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space, err := sm.CreateSpaceWithOptions("alice", "team", sharedspace.SpaceOptions{
		Access: sharedspace.AccessPrivate,
	})
	if err != nil {
		t.Fatalf("CreateSpaceWithOptions() error = %v", err)
	}
	space.AddMember("alice", "bob", sharedspace.RoleMember)
	space.AddMember("alice", "carol", sharedspace.RoleMember)

	var captured []*notification.NotificationPayload
	g := &Gateway{Option: &AgiSysInfo{
		SharedSpaceManager: sm,
		NotificationSender: func(p *notification.NotificationPayload) error {
			captured = append(captured, p)
			return nil
		},
	}}

	run := func(username, script string) otto.Value {
		vm := otto.New()
		g.injectSharedSpaceFunctions(&static.AgiLibInjectionPayload{
			VM:         vm,
			User:       &user.User{Username: username},
			ScriptPath: "./web/Chatspace/backend/notify.js",
		})
		v, runErr := vm.Run(script)
		if runErr != nil {
			t.Fatalf("vm.Run(%q) error = %v", script, runErr)
		}
		return v
	}

	// A member notifies every other member; the sender label is the module root.
	captured = nil
	v := run("alice", `sharedspace.notifyMembers("`+space.ID+`", "alice", "hi team")`)
	if n, _ := v.ToInteger(); n != 2 {
		t.Fatalf("notified = %d, want 2", n)
	}
	if len(captured) != 1 {
		t.Fatalf("sender called %d times, want 1", len(captured))
	}
	got := append([]string{}, captured[0].Receiver...)
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"bob", "carol"}) {
		t.Errorf("receivers = %v, want [bob carol]", got)
	}
	if captured[0].Sender != "Chatspace" {
		t.Errorf("sender label = %q, want Chatspace", captured[0].Sender)
	}
	if captured[0].Message != "hi team" {
		t.Errorf("message = %q, want 'hi team'", captured[0].Message)
	}

	// Members currently connected to the space are skipped (they get it live).
	captured = nil
	space.Channel().Join("carol")
	v = run("alice", `sharedspace.notifyMembers("`+space.ID+`", "alice", "hi")`)
	if n, _ := v.ToInteger(); n != 1 {
		t.Fatalf("notified = %d, want 1 (carol is present)", n)
	}
	if len(captured) != 1 || len(captured[0].Receiver) != 1 || captured[0].Receiver[0] != "bob" {
		t.Errorf("receivers = %v, want [bob]", captured[0].Receiver)
	}

	// An explicit target list is intersected with the members.
	captured = nil
	v = run("alice", `sharedspace.notifyMembers("`+space.ID+`", "alice", "hi", "high", ["bob","stranger"])`)
	if n, _ := v.ToInteger(); n != 1 {
		t.Fatalf("notified = %d, want 1 (only bob is a member)", n)
	}
	if captured[0].Priority != notification.PriorityHigh {
		t.Errorf("priority = %d, want high", captured[0].Priority)
	}

	// A non-member cannot raise notifications for the space.
	captured = nil
	v = run("dave", `sharedspace.notifyMembers("`+space.ID+`", "dave", "hi")`)
	if n, _ := v.ToInteger(); n != -1 {
		t.Errorf("non-member notified = %d, want -1", n)
	}
	if len(captured) != 0 {
		t.Errorf("non-member must not send; captured %d notifications", len(captured))
	}
}

func TestAgiDescribeSpaceAdvancedFields(t *testing.T) {
	sm := sharedspace.NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space, err := sm.CreateSpaceWithOptions("alice", "Project room", sharedspace.SpaceOptions{
		Access:   sharedspace.AccessPublic,
		Metadata: map[string]string{"purpose": "planning"},
	})
	if err != nil {
		t.Fatalf("CreateSpaceWithOptions() error = %v", err)
	}
	space.AddMember("alice", "bob", sharedspace.RoleMember)
	space.CreateDoc("alice", "spec")

	desc := agiDescribeSpace(space)
	if desc["access"] != sharedspace.AccessPublic {
		t.Errorf("access = %v, want public", desc["access"])
	}
	if desc["persistent"] != false {
		t.Errorf("persistent = %v, want false", desc["persistent"])
	}
	if desc["members"] != 2 {
		t.Errorf("members = %v, want 2", desc["members"])
	}
	if desc["docs"] != 1 {
		t.Errorf("docs = %v, want 1", desc["docs"])
	}
	metadata, ok := desc["metadata"].(map[string]string)
	if !ok || metadata["purpose"] != "planning" {
		t.Errorf("metadata = %v", desc["metadata"])
	}
}

func TestAgiDescribeDoc(t *testing.T) {
	sm := sharedspace.NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space := sm.CreateSpace("alice", "")
	doc, err := space.CreateDoc("alice", "notes")
	if err != nil {
		t.Fatalf("CreateDoc() error = %v", err)
	}
	space.UpdateDoc("bob", doc.ID, 1, "content body")
	snapshot, _ := space.GetDoc(doc.ID)

	withContent := agiDescribeDoc(snapshot, true)
	if withContent["docid"] != doc.ID || withContent["revision"] != int64(2) {
		t.Errorf("doc description = %+v", withContent)
	}
	if withContent["content"] != "content body" || withContent["updatedby"] != "bob" {
		t.Errorf("doc content fields = %+v", withContent)
	}

	withoutContent := agiDescribeDoc(snapshot, false)
	if _, leaked := withoutContent["content"]; leaked {
		t.Errorf("content leaked into the no-content description")
	}
}
