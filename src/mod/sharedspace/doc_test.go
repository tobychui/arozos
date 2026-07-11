package sharedspace

import (
	"path/filepath"
	"strings"
	"testing"
)

func newDocTestSpace(t *testing.T) *Space {
	t.Helper()
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	return m.CreateSpace("alice", "Doc test")
}

func TestDocLifecycle(t *testing.T) {
	space := newDocTestSpace(t)

	doc, err := space.CreateDoc("alice", "Meeting notes")
	if err != nil {
		t.Fatalf("CreateDoc() error = %v", err)
	}
	if doc.Revision != 1 || doc.Name != "Meeting notes" || doc.Creator != "alice" {
		t.Errorf("new doc snapshot = %+v", doc)
	}

	//Default name
	unnamed, _ := space.CreateDoc("alice", "")
	if unnamed.Name != "Untitled document" {
		t.Errorf("unnamed doc name = %q", unnamed.Name)
	}

	got, ok := space.GetDoc(doc.ID)
	if !ok || got.ID != doc.ID {
		t.Fatalf("GetDoc() did not return the document")
	}
	if _, ok := space.GetDoc("nonexistent"); ok {
		t.Errorf("GetDoc(unknown) returned ok")
	}

	list := space.ListDocs()
	if len(list) != 2 {
		t.Fatalf("ListDocs() = %d docs, want 2", len(list))
	}
	for _, snapshot := range list {
		if snapshot.Content != "" {
			t.Errorf("ListDocs() leaked content")
		}
	}
	if space.DocCount() != 2 {
		t.Errorf("DocCount() = %d, want 2", space.DocCount())
	}

	//Deletion permissions: stranger no, creator yes
	if err := space.DeleteDoc("mallory", doc.ID); err != ErrPermissionDenied {
		t.Errorf("stranger DeleteDoc error = %v, want ErrPermissionDenied", err)
	}
	if err := space.DeleteDoc("alice", doc.ID); err != nil {
		t.Errorf("creator DeleteDoc error = %v", err)
	}
	if err := space.DeleteDoc("alice", doc.ID); err != ErrDocNotFound {
		t.Errorf("double DeleteDoc error = %v, want ErrDocNotFound", err)
	}
}

func TestDocUpdateCAS(t *testing.T) {
	space := newDocTestSpace(t)
	doc, _ := space.CreateDoc("alice", "notes")

	//Sequential updates advance the revision
	first, err := space.UpdateDoc("alice", doc.ID, 1, "hello world")
	if err != nil {
		t.Fatalf("first UpdateDoc error = %v", err)
	}
	if first.Revision != 2 || first.Content != "hello world" {
		t.Errorf("first update snapshot = %+v", first)
	}
	second, err := space.UpdateDoc("bob", doc.ID, 2, "hello brave world")
	if err != nil {
		t.Fatalf("second UpdateDoc error = %v", err)
	}
	if second.Revision != 3 || second.UpdatedBy != "bob" {
		t.Errorf("second update snapshot = %+v", second)
	}

	//Stale base revision is rejected without content change
	if _, err := space.UpdateDoc("carol", doc.ID, 2, "clobber"); err != ErrRevisionConflict {
		t.Errorf("stale update error = %v, want ErrRevisionConflict", err)
	}
	if got, _ := space.GetDoc(doc.ID); got.Content != "hello brave world" {
		t.Errorf("conflict mutated content: %q", got.Content)
	}

	//Unknown doc and oversized content
	if _, err := space.UpdateDoc("alice", "nonexistent", 1, "x"); err != ErrDocNotFound {
		t.Errorf("unknown doc error = %v, want ErrDocNotFound", err)
	}
	if _, err := space.UpdateDoc("alice", doc.ID, 3, strings.Repeat("a", MaxDocLength+1)); err != ErrDocTooLarge {
		t.Errorf("oversized update error = %v, want ErrDocTooLarge", err)
	}

	//History records the accepted revisions
	history, ok := space.DocHistory(doc.ID)
	if !ok || len(history) != 2 {
		t.Fatalf("DocHistory() = %d entries, want 2", len(history))
	}
	if history[0].Revision != 2 || history[1].Revision != 3 {
		t.Errorf("history revisions = %d, %d", history[0].Revision, history[1].Revision)
	}
}

func TestDocLimits(t *testing.T) {
	space := newDocTestSpace(t)
	for i := 0; i < DefaultMaxDocs; i++ {
		if _, err := space.CreateDoc("alice", "doc"); err != nil {
			t.Fatalf("CreateDoc #%d error = %v", i, err)
		}
	}
	if _, err := space.CreateDoc("alice", "one too many"); err != ErrDocLimitReached {
		t.Errorf("over-limit CreateDoc error = %v, want ErrDocLimitReached", err)
	}
}

func TestDocPermissions(t *testing.T) {
	m := NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space, _ := m.CreateSpaceWithOptions("alice", "private docs", SpaceOptions{Access: AccessPrivate})

	if _, err := space.CreateDoc("stranger", "sneaky"); err != ErrPermissionDenied {
		t.Errorf("stranger CreateDoc error = %v, want ErrPermissionDenied", err)
	}
	doc, err := space.CreateDoc("alice", "insider")
	if err != nil {
		t.Fatalf("owner CreateDoc error = %v", err)
	}
	if _, err := space.UpdateDoc("stranger", doc.ID, 1, "hijack"); err != ErrPermissionDenied {
		t.Errorf("stranger UpdateDoc error = %v, want ErrPermissionDenied", err)
	}
	//Space admins may delete docs they did not create
	space.AddMember("alice", "adam", RoleAdmin)
	if err := space.DeleteDoc("adam", doc.ID); err != nil {
		t.Errorf("admin DeleteDoc error = %v", err)
	}
}

func TestDocUpdateEmitsPatchEvent(t *testing.T) {
	space := newDocTestSpace(t)
	doc, _ := space.CreateDoc("alice", "notes")

	var events []*SpaceEvent
	space.SubscribeEvents("test", func(event *SpaceEvent) {
		events = append(events, event)
	})

	space.UpdateDoc("alice", doc.ID, 1, "hello")
	if len(events) != 1 || events[0].Kind != EventDocUpdated {
		t.Fatalf("expected one doc-updated event, got %d", len(events))
	}
	if events[0].Patch == nil || events[0].Patch.Ins != "hello" {
		t.Errorf("event patch = %+v", events[0].Patch)
	}
	if events[0].Doc == nil || events[0].Doc.Revision != 2 {
		t.Errorf("event snapshot = %+v", events[0].Doc)
	}

	space.DeleteDoc("alice", doc.ID)
	if len(events) != 2 || events[1].Kind != EventDocDeleted {
		t.Errorf("expected doc-deleted event, got %+v", events)
	}
}

func TestComputeSplicePatch(t *testing.T) {
	tests := []struct {
		name    string
		oldStr  string
		newStr  string
		wantPos int
		wantDel int
		wantIns string
	}{
		{"append", "hello", "hello world", 5, 0, " world"},
		{"prepend", "world", "hello world", 0, 0, "hello "},
		{"insert middle", "helo", "hello", 3, 0, "l"},
		{"delete middle", "hello", "helo", 3, 1, ""},
		{"replace middle", "hello brave world", "hello bold world", 7, 4, "old"},
		{"clear all", "abc", "", 0, 3, ""},
		{"from empty", "", "abc", 0, 0, "abc"},
		{"no change", "same", "same", 4, 0, ""},
		{"unicode aware", "café au lait", "cafés au lait", 4, 0, "s"},
		{"full rewrite", "abc", "xyz", 0, 3, "xyz"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			patch := computeSplicePatch(tt.oldStr, tt.newStr)
			if patch.Pos != tt.wantPos || patch.Del != tt.wantDel || patch.Ins != tt.wantIns {
				t.Errorf("patch = %+v, want {Pos:%d Del:%d Ins:%q}", patch, tt.wantPos, tt.wantDel, tt.wantIns)
			}
			//Applying the patch must reproduce newStr
			oldRunes := []rune(tt.oldStr)
			rebuilt := string(oldRunes[:patch.Pos]) + patch.Ins + string(oldRunes[patch.Pos+patch.Del:])
			if rebuilt != tt.newStr {
				t.Errorf("patch application = %q, want %q", rebuilt, tt.newStr)
			}
		})
	}
}
