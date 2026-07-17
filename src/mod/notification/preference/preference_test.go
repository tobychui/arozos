package preference

import (
	"encoding/json"
	"testing"

	notification "imuslab.com/arozos/mod/notification"
)

// fakeKV is an in-memory KVStore for testing.
type fakeKV struct {
	tables map[string]map[string]string
}

func newFakeKV() *fakeKV {
	return &fakeKV{tables: map[string]map[string]string{}}
}

func (f *fakeKV) NewTable(table string) error {
	if f.tables[table] == nil {
		f.tables[table] = map[string]string{}
	}
	return nil
}

func (f *fakeKV) Write(table, key string, value interface{}) error {
	if f.tables[table] == nil {
		f.tables[table] = map[string]string{}
	}
	//Match mod/database semantics: store JSON-encoded value.
	js, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f.tables[table][key] = string(js)
	return nil
}

func (f *fakeKV) Read(table, key string, assignee interface{}) error {
	raw, ok := f.tables[table][key]
	if !ok {
		return json.Unmarshal([]byte("null"), assignee)
	}
	return json.Unmarshal([]byte(raw), assignee)
}

func (f *fakeKV) KeyExists(table, key string) bool {
	_, ok := f.tables[table][key]
	return ok
}

func TestNewStore_NilDB(t *testing.T) {
	if _, err := NewStore(nil); err == nil {
		t.Error("expected error for nil KVStore")
	}
}

func TestGet_DefaultWhenMissing(t *testing.T) {
	s, err := NewStore(newFakeKV())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	pref := s.Get("newuser")
	if !pref.EnabledAgents["desktop"] {
		t.Error("expected desktop enabled by default")
	}
	if pref.MinPriority != notification.PriorityLow {
		t.Errorf("expected default min priority low, got %d", pref.MinPriority)
	}
}

func TestSetAndGet_RoundTrip(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	in := UserPreference{
		EnabledAgents:  map[string]bool{"telegram": true, "desktop": false},
		MinPriority:    notification.PriorityHigh,
		TelegramChatID: "999",
	}
	if err := s.Set("alice", in); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := s.Get("alice")
	if !out.EnabledAgents["telegram"] || out.EnabledAgents["desktop"] {
		t.Errorf("enabled agents did not round-trip: %+v", out.EnabledAgents)
	}
	if out.MinPriority != notification.PriorityHigh {
		t.Errorf("min priority did not round-trip: %d", out.MinPriority)
	}
	if out.TelegramChatID != "999" {
		t.Errorf("telegram chat id did not round-trip: %s", out.TelegramChatID)
	}
}

func TestSet_EmptyUsername(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	if err := s.Set("", UserPreference{}); err == nil {
		t.Error("expected error for empty username")
	}
}

func TestSet_NormalizesPriority(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	s.Set("bob", UserPreference{MinPriority: 999})
	if got := s.Get("bob").MinPriority; got != notification.PriorityHigh {
		t.Errorf("expected priority clamped to high, got %d", got)
	}
}

func TestTelegramChatIDResolver(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	resolver := s.TelegramChatIDResolver()

	if _, err := resolver("nolink"); err == nil {
		t.Error("expected error for user without linked chat id")
	}

	s.Set("linked", UserPreference{TelegramChatID: "123"})
	id, err := resolver("linked")
	if err != nil || id != "123" {
		t.Errorf("expected chat id 123, got %q err=%v", id, err)
	}
}

func TestWebhookResolver(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	resolver := s.WebhookResolver()

	if _, err := resolver("nohook"); err == nil {
		t.Error("expected error for user without webhook")
	}

	pref := UserPreference{}
	pref.Webhook.URL = "https://example.com/hook"
	s.Set("hooked", pref)
	target, err := resolver("hooked")
	if err != nil || target.URL != "https://example.com/hook" {
		t.Errorf("unexpected webhook target: %+v err=%v", target, err)
	}
}

func TestResolveAgents(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	s.Set("alice", UserPreference{
		EnabledAgents: map[string]bool{"desktop": true, "telegram": true, "smtpn": false},
		MinPriority:   notification.PriorityMedium,
	})
	available := []string{"desktop", "telegram", "smtpn", "webhook"}

	//Below threshold -> dropped.
	if got := s.ResolveAgents("alice", notification.PriorityLow, available, nil); got != nil {
		t.Errorf("expected nil for below-threshold priority, got %v", got)
	}

	//At/above threshold -> only enabled agents.
	got := s.ResolveAgents("alice", notification.PriorityHigh, available, nil)
	if len(got) != 2 || !contains(got, "desktop") || !contains(got, "telegram") {
		t.Errorf("expected [desktop telegram], got %v", got)
	}

	//Requested subset restricts further.
	got = s.ResolveAgents("alice", notification.PriorityHigh, available, []string{"telegram"})
	if len(got) != 1 || got[0] != "telegram" {
		t.Errorf("expected [telegram], got %v", got)
	}

	//Requested agent that is not enabled -> dropped.
	if got := s.ResolveAgents("alice", notification.PriorityHigh, available, []string{"smtpn"}); got != nil {
		t.Errorf("expected nil when requested agent disabled, got %v", got)
	}
}

func TestResolveAgents_DefaultUserDesktopOnly(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	available := []string{"desktop", "telegram"}
	got := s.ResolveAgents("brandnew", notification.PriorityLow, available, nil)
	if len(got) != 1 || got[0] != "desktop" {
		t.Errorf("expected default user to resolve to [desktop], got %v", got)
	}
}
