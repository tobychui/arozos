package agi

import (
	"errors"
	"testing"

	notification "imuslab.com/arozos/mod/notification"
)

// newNotificationTestGateway builds a minimal Gateway whose NotificationSender
// captures the last payload it received.
func newNotificationTestGateway(sender func(*notification.NotificationPayload) error) *Gateway {
	return &Gateway{
		Option: &AgiSysInfo{
			NotificationSender: sender,
		},
	}
}

func TestBuildAndSendNotification_NoSender(t *testing.T) {
	g := newNotificationTestGateway(nil)
	err := g.buildAndSendNotification("mod", []string{"alice"}, "Title", "Body", "high")
	if err == nil {
		t.Error("expected error when no notification sender is configured")
	}
}

func TestBuildAndSendNotification_EmptyTitle(t *testing.T) {
	g := newNotificationTestGateway(func(p *notification.NotificationPayload) error { return nil })
	err := g.buildAndSendNotification("mod", []string{"alice"}, "", "Body", "high")
	if err == nil {
		t.Error("expected error for empty title")
	}
}

func TestBuildAndSendNotification_Success(t *testing.T) {
	var captured *notification.NotificationPayload
	g := newNotificationTestGateway(func(p *notification.NotificationPayload) error {
		captured = p
		return nil
	})

	err := g.buildAndSendNotification("Backup", []string{"alice", "bob"}, "Done", "Backup finished", "high")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured == nil {
		t.Fatal("expected sender to be called")
	}
	if captured.Title != "Done" || captured.Message != "Backup finished" {
		t.Errorf("unexpected title/message: %+v", captured)
	}
	if captured.Sender != "Backup" {
		t.Errorf("unexpected sender: %s", captured.Sender)
	}
	if captured.Priority != notification.PriorityHigh {
		t.Errorf("expected high priority, got %d", captured.Priority)
	}
	if len(captured.Receiver) != 2 {
		t.Errorf("expected 2 receivers, got %d", len(captured.Receiver))
	}
	if captured.ID == "" {
		t.Error("expected a generated notification ID")
	}
	if captured.Timestamp == 0 {
		t.Error("expected a non-zero timestamp")
	}
}

func TestBuildAndSendNotification_DefaultPriority(t *testing.T) {
	var captured *notification.NotificationPayload
	g := newNotificationTestGateway(func(p *notification.NotificationPayload) error {
		captured = p
		return nil
	})
	//An unknown priority string should fall back to medium.
	if err := g.buildAndSendNotification("mod", []string{"x"}, "T", "M", "bogus"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured.Priority != notification.PriorityMedium {
		t.Errorf("expected medium priority fallback, got %d", captured.Priority)
	}
}

func TestBuildAndSendNotification_SenderErrorPropagates(t *testing.T) {
	g := newNotificationTestGateway(func(p *notification.NotificationPayload) error {
		return errors.New("delivery failed")
	})
	err := g.buildAndSendNotification("mod", []string{"x"}, "T", "M", "low")
	if err == nil {
		t.Error("expected sender error to propagate")
	}
}
