package share

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/share/shareEntry"
)

func shareFor(permission string, names ...string) *shareEntry.ShareOption {
	so := shareEntry.DefaultShareOption()
	so.UUID = "share-uuid"
	so.Owner = "owner"
	so.FileVirtualPath = "user:/Music/album"
	so.IsFolder = true
	so.Permission = permission
	so.Accessibles = names
	return so
}

func TestInvitedNames(t *testing.T) {
	tests := []struct {
		name   string
		before *shareEntry.ShareOption
		after  *shareEntry.ShareOption
		want   []string
	}{
		{"new user share", nil, shareFor("users", "alice", "bob"), []string{"alice", "bob"}},
		{"new group share", nil, shareFor("groups", "staff"), []string{"staff"}},
		{"public link", nil, shareFor("anyone"), []string{}},
		{"user added", shareFor("users", "alice"), shareFor("users", "alice", "bob"), []string{"bob"}},
		{"user removed", shareFor("users", "alice", "bob"), shareFor("users", "alice"), []string{}},
		{"settings only", shareFor("users", "alice"), shareFor("users", "alice"), []string{}},
		{"public to users", shareFor("anyone"), shareFor("users", "alice"), []string{"alice"}},
		{"users to groups", shareFor("users", "staff"), shareFor("groups", "staff"), []string{"staff"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := invitedNames(tc.before, tc.after)
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBuildInviteNotification(t *testing.T) {
	so := shareFor("users", "alice")
	so.AccessLevel = shareEntry.AccessLevelEdit
	so.ExpireAt = time.Date(2030, 1, 2, 12, 0, 0, 0, time.Local).Unix()

	payload := buildInviteNotification(so, "owner", []string{"alice"})
	if payload.Sender != notificationSender || payload.Priority != notification.PriorityMedium {
		t.Errorf("unexpected sender / priority: %+v", payload)
	}
	if len(payload.Receiver) != 1 || payload.Receiver[0] != "alice" {
		t.Errorf("Receiver = %v", payload.Receiver)
	}
	for _, want := range []string{"owner", `"album"`, "folder", "upload", "2030-01-02", "no action needed"} {
		if !strings.Contains(payload.Message, want) {
			t.Errorf("message %q should mention %q", payload.Message, want)
		}
	}

	var open map[string]interface{}
	if err := json.Unmarshal([]byte(payload.Payload), &open); err != nil {
		t.Fatalf("payload is not JSON: %v", err)
	}
	if open["url"] != "share/share-uuid/" {
		t.Errorf("click target = %v, want the share link", open["url"])
	}
}

func TestNotifyInvitees(t *testing.T) {
	var sent []*notification.NotificationPayload
	m := newTestManager(t)
	m.options.NotificationSender = func(p *notification.NotificationPayload) error {
		sent = append(sent, p)
		return nil
	}

	//Owner and the person sharing are never notified
	m.notifyInvitees(nil, shareFor("users", "alice", "owner", "editor", "alice"), "editor")
	if len(sent) != 1 || strings.Join(sent[0].Receiver, ",") != "alice" {
		t.Fatalf("sent %+v, want one notice to alice", sent)
	}

	//Nothing new: nothing sent
	sent = nil
	m.notifyInvitees(shareFor("users", "alice"), shareFor("users", "alice"), "owner")
	if len(sent) != 0 {
		t.Errorf("expected no notice, got %+v", sent)
	}

	//Expired shares grant nothing
	expired := shareFor("users", "bob")
	expired.ExpireAt = time.Now().Unix() - 10
	m.notifyInvitees(nil, expired, "owner")
	if len(sent) != 0 {
		t.Errorf("expected no notice for an expired share, got %+v", sent)
	}

	//No sender configured: no panic
	m.options.NotificationSender = nil
	m.notifyInvitees(nil, shareFor("users", "carol"), "owner")
}
