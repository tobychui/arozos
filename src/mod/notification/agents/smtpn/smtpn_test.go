package smtpn

import (
	"testing"
)

func TestNewSMTPNotifier(t *testing.T) {
	notifier := NewSMTPNotifier("", 0, "", "")
	if notifier == nil {
		t.Error("Notifier should not be nil")
	}
}
