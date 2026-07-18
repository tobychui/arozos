package desktopn

import (
	"testing"

	notification "imuslab.com/arozos/mod/notification"
)

func TestAgentMetadata(t *testing.T) {
	a := NewDesktopNotificationAgent()
	if a.Name() != "desktop" {
		t.Errorf("unexpected name: %s", a.Name())
	}
	if a.Desc() == "" {
		t.Error("expected non-empty description")
	}
	if !a.IsConsumer() {
		t.Error("expected desktop agent to be a consumer")
	}
	if a.IsProducer() {
		t.Error("expected desktop agent to not be a producer")
	}
}

func TestConsumerAndPoll(t *testing.T) {
	a := NewDesktopNotificationAgent()
	err := a.ConsumerNotification(&notification.NotificationPayload{
		ID:       "n1",
		Title:    "Hi",
		Message:  "there",
		Sender:   "test",
		Priority: notification.PriorityHigh,
		Receiver: []string{"alice", "bob"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if a.PeekCount("alice") != 1 || a.PeekCount("bob") != 1 {
		t.Errorf("expected both recipients to have 1 pending notification")
	}

	items := a.PollNotifications("alice")
	if len(items) != 1 {
		t.Fatalf("expected 1 notification for alice, got %d", len(items))
	}
	if items[0].Priority != "high" {
		t.Errorf("expected priority 'high', got %s", items[0].Priority)
	}
	//Poll should clear the buffer.
	if a.PeekCount("alice") != 0 {
		t.Errorf("expected alice buffer cleared after poll")
	}
	//bob is untouched.
	if a.PeekCount("bob") != 1 {
		t.Errorf("expected bob to still have 1 pending notification")
	}
}

func TestPoll_EmptyReturnsEmptySlice(t *testing.T) {
	a := NewDesktopNotificationAgent()
	items := a.PollNotifications("nobody")
	if items == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(items) != 0 {
		t.Errorf("expected 0 items, got %d", len(items))
	}
}

func TestClear(t *testing.T) {
	a := NewDesktopNotificationAgent()
	a.ConsumerNotification(&notification.NotificationPayload{ID: "x", Receiver: []string{"carol"}})
	a.Clear("carol")
	if a.PeekCount("carol") != 0 {
		t.Errorf("expected carol buffer cleared")
	}
}

func TestBufferCap(t *testing.T) {
	a := NewDesktopNotificationAgent()
	a.maxBuffered = 3
	for i := 0; i < 10; i++ {
		a.ConsumerNotification(&notification.NotificationPayload{
			ID:       string(rune('a' + i)),
			Receiver: []string{"dan"},
		})
	}
	if a.PeekCount("dan") != 3 {
		t.Fatalf("expected buffer capped at 3, got %d", a.PeekCount("dan"))
	}
	items := a.PollNotifications("dan")
	//Only the newest 3 should survive (ids 'h','i','j').
	if items[len(items)-1].ID != string(rune('a'+9)) {
		t.Errorf("expected newest notification retained, got %s", items[len(items)-1].ID)
	}
}

func TestProduceNotification_NoOp(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ProduceNotification panicked: %v", r)
		}
	}()
	NewDesktopNotificationAgent().ProduceNotification(nil)
}
