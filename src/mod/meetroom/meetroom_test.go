package meetroom

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	return NewManager(filepath.Join(t.TempDir(), "attachments"))
}

func TestCreateRoom(t *testing.T) {
	m := newTestManager(t)
	tests := []struct {
		name          string
		host          string
		title         string
		password      string
		wantTitle     string
		wantProtected bool
	}{
		{"open room with title", "alice", "Standup", "", "Standup", false},
		{"password room", "bob", "Secret sync", "hunter2", "Secret sync", true},
		{"default title", "carol", "", "", "carol's Meeting", false},
		{"overlong title clipped", "dave", strings.Repeat("x", 200), "", strings.Repeat("x", maxTitleLength), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			room := m.CreateRoom(tt.host, tt.title, tt.password)
			if len(room.ID) != roomIDLength {
				t.Errorf("room ID %q length = %d, want %d", room.ID, len(room.ID), roomIDLength)
			}
			for _, c := range room.ID {
				if c < '0' || c > '9' {
					t.Errorf("room ID %q contains non-digit %q", room.ID, c)
				}
			}
			if room.Title != tt.wantTitle {
				t.Errorf("title = %q, want %q", room.Title, tt.wantTitle)
			}
			if room.Host != tt.host {
				t.Errorf("host = %q, want %q", room.Host, tt.host)
			}
			if room.HasPassword() != tt.wantProtected {
				t.Errorf("HasPassword() = %v, want %v", room.HasPassword(), tt.wantProtected)
			}
			if got, ok := m.GetRoom(room.ID); !ok || got != room {
				t.Errorf("GetRoom(%q) did not return the created room", room.ID)
			}
		})
	}
}

func TestCreateRoomUniqueIDs(t *testing.T) {
	m := newTestManager(t)
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		room := m.CreateRoom("host", "", "")
		if seen[room.ID] {
			t.Fatalf("duplicate room ID generated: %s", room.ID)
		}
		seen[room.ID] = true
	}
	if m.RoomCount() != 100 {
		t.Errorf("RoomCount() = %d, want 100", m.RoomCount())
	}
}

func TestValidateJoin(t *testing.T) {
	m := newTestManager(t)
	open := m.CreateRoom("alice", "Open", "")
	locked := m.CreateRoom("bob", "Locked", "hunter2")

	tests := []struct {
		name     string
		roomID   string
		password string
		wantErr  error
	}{
		{"open room no password", open.ID, "", nil},
		{"open room ignores password", open.ID, "whatever", nil},
		{"locked room correct password", locked.ID, "hunter2", nil},
		{"locked room wrong password", locked.ID, "letmein", ErrInvalidPassword},
		{"locked room empty password", locked.ID, "", ErrInvalidPassword},
		{"unknown room", "000000000", "", ErrRoomNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := m.ValidateJoin(tt.roomID, tt.password)
			if err != tt.wantErr {
				t.Errorf("ValidateJoin(%q, %q) error = %v, want %v", tt.roomID, tt.password, err, tt.wantErr)
			}
		})
	}
}

func TestParticipantLifecycle(t *testing.T) {
	m := newTestManager(t)
	room := m.CreateRoom("alice", "", "")

	host, err := room.AddParticipant("alice")
	if err != nil {
		t.Fatalf("AddParticipant(alice) error = %v", err)
	}
	guest, err := room.AddParticipant("bob")
	if err != nil {
		t.Fatalf("AddParticipant(bob) error = %v", err)
	}

	if !host.IsHost {
		t.Errorf("host participant IsHost = false, want true")
	}
	if guest.IsHost {
		t.Errorf("guest participant IsHost = true, want false")
	}
	if host.PeerID == guest.PeerID {
		t.Errorf("peer IDs collide: %d", host.PeerID)
	}
	if room.ParticipantCount() != 2 {
		t.Errorf("ParticipantCount() = %d, want 2", room.ParticipantCount())
	}
	if p, ok := room.GetParticipant(guest.PeerID); !ok || p != guest {
		t.Errorf("GetParticipant(%d) did not return the guest", guest.PeerID)
	}

	room.RemoveParticipant(guest.PeerID)
	if room.ParticipantCount() != 1 {
		t.Errorf("ParticipantCount() after remove = %d, want 1", room.ParticipantCount())
	}
	if _, open := <-guest.Send; open {
		t.Errorf("removed participant's send channel still open")
	}
	//Removing twice must not panic
	room.RemoveParticipant(guest.PeerID)
}

func TestBroadcastAndSendTo(t *testing.T) {
	m := newTestManager(t)
	room := m.CreateRoom("alice", "", "")
	a, _ := room.AddParticipant("alice")
	b, _ := room.AddParticipant("bob")
	c, _ := room.AddParticipant("carol")

	room.Broadcast([]byte("hello"), a.PeerID)
	select {
	case msg := <-b.Send:
		if string(msg) != "hello" {
			t.Errorf("b received %q, want %q", msg, "hello")
		}
	default:
		t.Errorf("b received nothing from broadcast")
	}
	select {
	case msg := <-c.Send:
		if string(msg) != "hello" {
			t.Errorf("c received %q, want %q", msg, "hello")
		}
	default:
		t.Errorf("c received nothing from broadcast")
	}
	select {
	case msg := <-a.Send:
		t.Errorf("excluded sender received %q", msg)
	default:
	}

	if !room.SendTo(b.PeerID, []byte("direct")) {
		t.Errorf("SendTo(%d) = false, want true", b.PeerID)
	}
	if msg := <-b.Send; string(msg) != "direct" {
		t.Errorf("b received %q, want %q", msg, "direct")
	}
	if room.SendTo(9999, []byte("direct")) {
		t.Errorf("SendTo(9999) = true for unknown peer, want false")
	}
}

func TestAttachmentLifecycle(t *testing.T) {
	m := newTestManager(t)
	room := m.CreateRoom("alice", "", "")

	tests := []struct {
		name     string
		roomID   string
		fileName string
		content  string
		maxSize  int64
		wantErr  error
	}{
		{"normal upload", room.ID, "notes.txt", "meeting notes", 1024, nil},
		{"unknown room", "000000000", "notes.txt", "data", 1024, ErrRoomNotFound},
		{"oversized upload", room.ID, "big.bin", strings.Repeat("A", 100), 10, ErrAttachmentTooLarge},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			att, err := m.SaveAttachment(tt.roomID, tt.fileName, "alice", strings.NewReader(tt.content), tt.maxSize)
			if err != tt.wantErr {
				t.Fatalf("SaveAttachment() error = %v, want %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if att.Size != int64(len(tt.content)) {
				t.Errorf("attachment size = %d, want %d", att.Size, len(tt.content))
			}
			stored, ok := m.GetAttachment(tt.roomID, att.ID)
			if !ok {
				t.Fatalf("GetAttachment(%q) not found", att.ID)
			}
			data, err := os.ReadFile(stored.DiskPath)
			if err != nil {
				t.Fatalf("reading stored attachment: %v", err)
			}
			if !bytes.Equal(data, []byte(tt.content)) {
				t.Errorf("stored content = %q, want %q", data, tt.content)
			}
		})
	}

	if _, ok := m.GetAttachment(room.ID, "nonexistent"); ok {
		t.Errorf("GetAttachment returned ok for unknown file ID")
	}
}

func TestCloseRoomCleansUp(t *testing.T) {
	m := newTestManager(t)
	room := m.CreateRoom("alice", "", "")
	p, _ := room.AddParticipant("alice")
	att, err := m.SaveAttachment(room.ID, "doc.pdf", "alice", strings.NewReader("content"), 1024)
	if err != nil {
		t.Fatalf("SaveAttachment() error = %v", err)
	}

	members := m.CloseRoom(room.ID)
	if len(members) != 1 || members[0] != p {
		t.Errorf("CloseRoom returned %d members, want the 1 participant", len(members))
	}
	if _, ok := m.GetRoom(room.ID); ok {
		t.Errorf("room still registered after CloseRoom")
	}
	if _, open := <-p.Send; open {
		t.Errorf("participant send channel still open after CloseRoom")
	}
	if _, err := os.Stat(att.DiskPath); !os.IsNotExist(err) {
		t.Errorf("attachment file still on disk after CloseRoom: %v", err)
	}
	if _, err := room.AddParticipant("bob"); err != ErrRoomClosed {
		t.Errorf("AddParticipant on closed room error = %v, want ErrRoomClosed", err)
	}
	//Closing an unknown room must be a no-op
	if members := m.CloseRoom("000000000"); members != nil {
		t.Errorf("CloseRoom on unknown ID returned %v, want nil", members)
	}
}

func TestSweepIdleRooms(t *testing.T) {
	m := newTestManager(t)
	idle := m.CreateRoom("alice", "Idle", "")
	occupied := m.CreateRoom("bob", "Busy", "")
	occupied.AddParticipant("bob")
	fresh := m.CreateRoom("carol", "Fresh", "")

	//Backdate the idle room's activity clock
	idle.mu.Lock()
	idle.lastActivity = time.Now().Add(-time.Hour)
	idle.mu.Unlock()
	occupied.mu.Lock()
	occupied.lastActivity = time.Now().Add(-time.Hour)
	occupied.mu.Unlock()

	closed := m.SweepIdleRooms(30 * time.Minute)
	if len(closed) != 1 || closed[0] != idle.ID {
		t.Errorf("SweepIdleRooms closed %v, want [%s]", closed, idle.ID)
	}
	if _, ok := m.GetRoom(occupied.ID); !ok {
		t.Errorf("occupied room was swept")
	}
	if _, ok := m.GetRoom(fresh.ID); !ok {
		t.Errorf("fresh room was swept")
	}
}

func TestRoomIDFormatting(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		wantFormat    string
		wantNormalize string
	}{
		{"standard ID", "123456789", "123-456-789", "123456789"},
		{"dashed input", "123-456-789", "123-456-789", "123456789"},
		{"spaced input", "123 456 789", "123 456 789", "123456789"},
		{"short ID passthrough", "1234", "1234", "1234"},
		{"junk stripped", "12a34!56789", "12a34!56789", "123456789"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeRoomID(tt.input); got != tt.wantNormalize {
				t.Errorf("NormalizeRoomID(%q) = %q, want %q", tt.input, got, tt.wantNormalize)
			}
		})
	}
	//FormatRoomID only reformats full-length normalized IDs
	if got := FormatRoomID("123456789"); got != "123-456-789" {
		t.Errorf("FormatRoomID = %q, want 123-456-789", got)
	}
	if got := FormatRoomID("1234"); got != "1234" {
		t.Errorf("FormatRoomID(short) = %q, want passthrough", got)
	}
}

func TestParticipantMessageIsValidJSONFrame(t *testing.T) {
	//Guards the wire contract: frames pushed by the transport layer are
	//opaque bytes; make sure Broadcast does not mutate or alias them.
	m := newTestManager(t)
	room := m.CreateRoom("alice", "", "")
	a, _ := room.AddParticipant("alice")

	original := []byte(`{"type":"chat","text":"hi"}`)
	room.Broadcast(original, -1)
	original[2] = 'X' //mutate the caller's buffer after broadcast

	got := <-a.Send
	var decoded map[string]interface{}
	if err := json.Unmarshal(got, &decoded); err != nil {
		t.Fatalf("broadcast frame corrupted by caller mutation: %v", err)
	}
	if decoded["type"] != "chat" {
		t.Errorf("frame type = %v, want chat", decoded["type"])
	}
}
