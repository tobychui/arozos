package agi

import (
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/sharedspace"
)

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
