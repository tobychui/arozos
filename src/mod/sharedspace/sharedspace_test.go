package sharedspace

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	return NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
}

func TestCreateSpace(t *testing.T) {
	m := newTestManager(t)
	tests := []struct {
		name     string
		owner    string
		title    string
		wantName string
	}{
		{"named space", "alice", "Design sync", "Design sync"},
		{"default name", "bob", "", "bob's space"},
		{"overlong name clipped", "carol", strings.Repeat("x", 200), strings.Repeat("x", maxSpaceName)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			space := m.CreateSpace(tt.owner, tt.title)
			if len(space.ID) != spaceIDBytes*2 {
				t.Errorf("space ID %q length = %d, want %d", space.ID, len(space.ID), spaceIDBytes*2)
			}
			if space.Name != tt.wantName {
				t.Errorf("name = %q, want %q", space.Name, tt.wantName)
			}
			if space.Owner != tt.owner {
				t.Errorf("owner = %q, want %q", space.Owner, tt.owner)
			}
			if got, ok := m.GetSpace(space.ID); !ok || got != space {
				t.Errorf("GetSpace(%q) did not return the created space", space.ID)
			}
		})
	}

	if _, ok := m.GetSpace("nonexistent"); ok {
		t.Errorf("GetSpace returned ok for unknown ID")
	}
}

func TestListSpacesByOwner(t *testing.T) {
	m := newTestManager(t)
	m.CreateSpace("alice", "One")
	m.CreateSpace("alice", "Two")
	m.CreateSpace("bob", "Other")

	if got := len(m.ListSpacesByOwner("alice")); got != 2 {
		t.Errorf("alice owns %d spaces, want 2", got)
	}
	if got := len(m.ListSpacesByOwner("bob")); got != 1 {
		t.Errorf("bob owns %d spaces, want 1", got)
	}
	if got := len(m.ListSpacesByOwner("carol")); got != 0 {
		t.Errorf("carol owns %d spaces, want 0", got)
	}
	if m.SpaceCount() != 3 {
		t.Errorf("SpaceCount() = %d, want 3", m.SpaceCount())
	}
}

func TestAddText(t *testing.T) {
	m := newTestManager(t)
	space := m.CreateSpace("alice", "")

	tests := []struct {
		name     string
		text     string
		wantErr  error
		wantText string
	}{
		{"normal text", "hello there", nil, "hello there"},
		{"empty text rejected", "   ", ErrEmptyText, ""},
		{"overlong text clipped", strings.Repeat("a", maxTextLength+100), nil, strings.Repeat("a", maxTextLength)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item, err := space.AddText("alice", tt.text, "test")
			if err != tt.wantErr {
				t.Fatalf("AddText() error = %v, want %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if item.Type != ItemTypeText {
				t.Errorf("item type = %q, want %q", item.Type, ItemTypeText)
			}
			if item.Text != tt.wantText {
				t.Errorf("item text = %q, want %q", item.Text, tt.wantText)
			}
			if stored, ok := space.GetItem(item.ID); !ok || stored != item {
				t.Errorf("GetItem(%q) did not return the added item", item.ID)
			}
		})
	}
}

func TestSaveBlob(t *testing.T) {
	m := newTestManager(t)
	space := m.CreateSpace("alice", "")

	tests := []struct {
		name     string
		itemType string
		fileName string
		content  string
		maxSize  int64
		wantErr  error
	}{
		{"file upload", ItemTypeFile, "notes.txt", "shared notes", 1024, nil},
		{"image upload", ItemTypeImage, "photo.png", "png-bytes", 1024, nil},
		{"invalid type", "video", "clip.mp4", "data", 1024, ErrInvalidItemType},
		{"oversized upload", ItemTypeFile, "big.bin", strings.Repeat("A", 100), 10, ErrItemTooLarge},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item, err := space.SaveBlob(tt.itemType, tt.fileName, "alice", "test", strings.NewReader(tt.content), tt.maxSize)
			if err != tt.wantErr {
				t.Fatalf("SaveBlob() error = %v, want %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if item.Size != int64(len(tt.content)) {
				t.Errorf("item size = %d, want %d", item.Size, len(tt.content))
			}
			data, err := os.ReadFile(item.DiskPath)
			if err != nil {
				t.Fatalf("reading stored blob: %v", err)
			}
			if !bytes.Equal(data, []byte(tt.content)) {
				t.Errorf("stored content = %q, want %q", data, tt.content)
			}
		})
	}

	//Chronological ordering across mixed successes
	items := space.Items()
	if len(items) != 2 {
		t.Fatalf("ItemCount = %d, want 2", len(items))
	}
	if items[0].Name != "notes.txt" || items[1].Name != "photo.png" {
		t.Errorf("items out of order: %q, %q", items[0].Name, items[1].Name)
	}
}

func TestSpaceItemLimit(t *testing.T) {
	m := newTestManager(t)
	space := m.CreateSpace("alice", "")
	space.mu.Lock()
	space.maxItems = 2
	space.mu.Unlock()

	if _, err := space.AddText("alice", "one", "test"); err != nil {
		t.Fatalf("first AddText error = %v", err)
	}
	if _, err := space.AddText("alice", "two", "test"); err != nil {
		t.Fatalf("second AddText error = %v", err)
	}
	if _, err := space.AddText("alice", "three", "test"); err != ErrSpaceFull {
		t.Errorf("AddText on full space error = %v, want ErrSpaceFull", err)
	}
	if _, err := space.SaveBlob(ItemTypeFile, "f.txt", "alice", "test", strings.NewReader("x"), 10); err != ErrSpaceFull {
		t.Errorf("SaveBlob on full space error = %v, want ErrSpaceFull", err)
	}
}

func TestRemoveItemPermissions(t *testing.T) {
	m := newTestManager(t)
	space := m.CreateSpace("alice", "")
	item, err := space.SaveBlob(ItemTypeFile, "doc.pdf", "bob", "test", strings.NewReader("content"), 1024)
	if err != nil {
		t.Fatalf("SaveBlob() error = %v", err)
	}

	tests := []struct {
		name      string
		requester string
		wantErr   error
	}{
		{"stranger denied", "mallory", ErrPermissionDenied},
		{"unknown item", "alice", ErrItemNotFound},
		{"uploader allowed", "bob", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			target := item.ID
			if tt.wantErr == ErrItemNotFound {
				target = "nonexistent"
			}
			if err := space.RemoveItem(target, tt.requester); err != tt.wantErr {
				t.Errorf("RemoveItem() error = %v, want %v", err, tt.wantErr)
			}
		})
	}

	if _, err := os.Stat(item.DiskPath); !os.IsNotExist(err) {
		t.Errorf("blob file still on disk after RemoveItem: %v", err)
	}
	if space.ItemCount() != 0 {
		t.Errorf("ItemCount() = %d after removal, want 0", space.ItemCount())
	}

	//Space owner can remove other users' items
	item2, _ := space.SaveBlob(ItemTypeFile, "doc2.pdf", "bob", "test", strings.NewReader("content"), 1024)
	if err := space.RemoveItem(item2.ID, "alice"); err != nil {
		t.Errorf("owner RemoveItem() error = %v, want nil", err)
	}

	//System (empty requester) can remove anything
	item3, _ := space.AddText("bob", "note", "test")
	if err := space.RemoveItem(item3.ID, ""); err != nil {
		t.Errorf("system RemoveItem() error = %v, want nil", err)
	}
}

func TestListeners(t *testing.T) {
	m := newTestManager(t)
	space := m.CreateSpace("alice", "")

	var seen []*Item
	space.Subscribe("test", func(item *Item) {
		seen = append(seen, item)
	})

	textItem, _ := space.AddText("alice", "hello", "agi")
	blobItem, _ := space.SaveBlob(ItemTypeImage, "pic.png", "bob", "meetroom", strings.NewReader("img"), 1024)

	if len(seen) != 2 {
		t.Fatalf("listener saw %d items, want 2", len(seen))
	}
	if seen[0] != textItem || seen[1] != blobItem {
		t.Errorf("listener received wrong items")
	}
	if seen[0].Origin != "agi" || seen[1].Origin != "meetroom" {
		t.Errorf("origins = %q, %q; want agi, meetroom", seen[0].Origin, seen[1].Origin)
	}

	space.Unsubscribe("test")
	space.AddText("alice", "after unsubscribe", "agi")
	if len(seen) != 2 {
		t.Errorf("listener fired after Unsubscribe")
	}
}

func TestDeleteSpaceCleansUp(t *testing.T) {
	m := newTestManager(t)
	space := m.CreateSpace("alice", "")
	item, err := space.SaveBlob(ItemTypeFile, "doc.pdf", "alice", "test", strings.NewReader("content"), 1024)
	if err != nil {
		t.Fatalf("SaveBlob() error = %v", err)
	}

	if !m.DeleteSpace(space.ID) {
		t.Errorf("DeleteSpace returned false for live space")
	}
	if _, ok := m.GetSpace(space.ID); ok {
		t.Errorf("space still registered after DeleteSpace")
	}
	if _, err := os.Stat(item.DiskPath); !os.IsNotExist(err) {
		t.Errorf("blob file still on disk after DeleteSpace: %v", err)
	}
	if _, err := space.AddText("alice", "late", "test"); err != ErrSpaceClosed {
		t.Errorf("AddText on closed space error = %v, want ErrSpaceClosed", err)
	}
	if _, err := space.SaveBlob(ItemTypeFile, "f.txt", "alice", "test", strings.NewReader("x"), 10); err != ErrSpaceClosed {
		t.Errorf("SaveBlob on closed space error = %v, want ErrSpaceClosed", err)
	}
	//Deleting an unknown space must be a no-op
	if m.DeleteSpace("nonexistent") {
		t.Errorf("DeleteSpace returned true for unknown ID")
	}
}

func TestIsImageName(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"photo.png", true},
		{"photo.PNG", true},
		{"pic.jpeg", true},
		{"pic.jpg", true},
		{"anim.gif", true},
		{"modern.webp", true},
		{"old.bmp", true},
		{"vector.svg", false}, //svg excluded: inline serving would execute scripts
		{"doc.pdf", false},
		{"noextension", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := IsImageName(tt.name); got != tt.want {
			t.Errorf("IsImageName(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}
