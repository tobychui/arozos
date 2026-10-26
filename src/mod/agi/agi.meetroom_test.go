package agi

import (
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/meetroom"
	"imuslab.com/arozos/mod/sharedspace"
)

// spaceBoundRoomManager builds the meetroom + sharedspace manager pair the
// way MeetRoomInit wires them in production.
func spaceBoundRoomManager(t *testing.T) (*meetroom.Manager, *sharedspace.Manager) {
	t.Helper()
	rm := meetroom.NewManager(filepath.Join(t.TempDir(), "attachments"))
	sm := sharedspace.NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	rm.BindSpaceManager(sm)
	return rm, sm
}

func TestAgiDescribeRoom(t *testing.T) {
	rm, _ := spaceBoundRoomManager(t)
	room := rm.CreateRoom("alice", "Standup", "hunter2")

	tests := []struct {
		name         string
		includeSpace bool
	}{
		{"with space capability", true},
		{"without space capability", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			desc := agiDescribeRoom(room, tt.includeSpace)
			if desc["roomid"] != room.ID {
				t.Errorf("roomid = %v, want %v", desc["roomid"], room.ID)
			}
			if desc["displayid"] != meetroom.FormatRoomID(room.ID) {
				t.Errorf("displayid = %v, want formatted ID", desc["displayid"])
			}
			if desc["title"] != "Standup" || desc["host"] != "alice" {
				t.Errorf("title/host = %v/%v", desc["title"], desc["host"])
			}
			if desc["protected"] != true {
				t.Errorf("protected = %v, want true", desc["protected"])
			}
			spaceID, revealed := desc["spaceid"]
			if tt.includeSpace && (!revealed || spaceID != room.SpaceID) {
				t.Errorf("spaceid not revealed to authorized caller")
			}
			if !tt.includeSpace && revealed {
				t.Errorf("spaceid leaked to unauthorized caller")
			}
		})
	}
}

func TestAgiAttendanceList(t *testing.T) {
	rm, _ := spaceBoundRoomManager(t)
	room := rm.CreateRoom("alice", "", "")
	host, _ := room.AddParticipant("alice")
	guest, _ := room.AddParticipant("bob")
	room.RemoveParticipant(guest.PeerID)
	_ = host

	list := agiAttendanceList(room.Attendance())
	if len(list) != 2 {
		t.Fatalf("attendance list length = %d, want 2", len(list))
	}
	if list[0]["username"] != "alice" || list[0]["present"] != true {
		t.Errorf("host entry = %+v, want present alice", list[0])
	}
	if list[0]["leftat"] != int64(0) {
		t.Errorf("present entry leftat = %v, want 0", list[0]["leftat"])
	}
	if list[1]["username"] != "bob" || list[1]["present"] != false {
		t.Errorf("guest entry = %+v, want departed bob", list[1])
	}
	if list[1]["leftat"] == int64(0) {
		t.Errorf("departed entry has zero leftat")
	}
}

func TestAgiDescribeSpaceAndItem(t *testing.T) {
	sm := sharedspace.NewManager(filepath.Join(t.TempDir(), "spaces"), 0)
	space := sm.CreateSpace("alice", "Notes")
	textItem, err := space.AddText("alice", "hello", "agi")
	if err != nil {
		t.Fatalf("AddText() error = %v", err)
	}
	blobItem, err := space.SaveBlob(sharedspace.ItemTypeImage, "pic.png", "bob", "agi", strings.NewReader("img"), 1024)
	if err != nil {
		t.Fatalf("SaveBlob() error = %v", err)
	}

	desc := agiDescribeSpace(space)
	if desc["spaceid"] != space.ID || desc["name"] != "Notes" || desc["owner"] != "alice" {
		t.Errorf("space description = %+v", desc)
	}
	if desc["items"] != 2 {
		t.Errorf("space item count = %v, want 2", desc["items"])
	}

	textDesc := agiDescribeItem(textItem)
	if textDesc["type"] != sharedspace.ItemTypeText || textDesc["text"] != "hello" {
		t.Errorf("text item description = %+v", textDesc)
	}
	blobDesc := agiDescribeItem(blobItem)
	if blobDesc["type"] != sharedspace.ItemTypeImage || blobDesc["name"] != "pic.png" {
		t.Errorf("blob item description = %+v", blobDesc)
	}
	if blobDesc["size"] != int64(3) || blobDesc["uploader"] != "bob" {
		t.Errorf("blob size/uploader = %v/%v", blobDesc["size"], blobDesc["uploader"])
	}
}

func TestMeetRoomLibRegistration(t *testing.T) {
	rm, sm := spaceBoundRoomManager(t)
	wired := minimalGateway()
	wired.Option.MeetRoomManager = rm
	wired.Option.SharedSpaceManager = sm
	wired.MeetRoomLibRegister()
	wired.SharedSpaceLibRegister()
	if _, ok := wired.LoadedAGILibrary["meetroom"]; !ok {
		t.Errorf("meetroom lib not registered")
	}
	if _, ok := wired.LoadedAGILibrary["sharedspace"]; !ok {
		t.Errorf("sharedspace lib not registered")
	}
}
