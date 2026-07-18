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
	//Default: desktop enabled for every priority.
	for _, label := range []string{"low", "medium", "high"} {
		if !pref.Channels["desktop"][label] {
			t.Errorf("expected desktop enabled by default for %s", label)
		}
	}
}

func TestSetAndGet_RoundTrip(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	in := UserPreference{
		Channels: map[string]map[string]bool{
			"telegram": {"high": true},
			"desktop":  {"low": true, "medium": true, "high": true},
		},
		TelegramChatID: "999",
	}
	if err := s.Set("alice", in); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := s.Get("alice")
	if !out.Channels["telegram"]["high"] {
		t.Errorf("telegram/high did not round-trip: %+v", out.Channels)
	}
	if out.Channels["telegram"]["low"] {
		t.Errorf("telegram/low should be false: %+v", out.Channels)
	}
	if !out.Channels["desktop"]["medium"] {
		t.Errorf("desktop/medium did not round-trip: %+v", out.Channels)
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

func TestSet_NormalizesChannels(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	//Include an invalid priority label and an all-false row that should be dropped.
	s.Set("bob", UserPreference{
		Channels: map[string]map[string]bool{
			"desktop":  {"high": true, "bogus": true},
			"telegram": {"low": false, "medium": false, "high": false},
		},
	})
	out := s.Get("bob")
	if out.Channels["desktop"]["high"] != true {
		t.Errorf("expected desktop/high retained")
	}
	if _, ok := out.Channels["desktop"]["bogus"]; ok {
		t.Errorf("expected invalid priority label dropped")
	}
	if _, ok := out.Channels["telegram"]; ok {
		t.Errorf("expected all-false telegram row dropped, got %+v", out.Channels)
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

func TestResolveAgents_Matrix(t *testing.T) {
	s, _ := NewStore(newFakeKV())
	s.Set("alice", UserPreference{
		Channels: map[string]map[string]bool{
			"desktop":  {"low": true, "medium": true, "high": true},
			"telegram": {"high": true},
			"smtpn":    {"high": true},
		},
	})
	available := []string{"desktop", "telegram", "smtpn", "webhook"}

	//Low priority -> only desktop.
	low := s.ResolveAgents("alice", notification.PriorityLow, available, nil)
	if len(low) != 1 || low[0] != "desktop" {
		t.Errorf("expected [desktop] for low, got %v", low)
	}

	//High priority -> desktop, telegram, smtpn (order follows available list).
	high := s.ResolveAgents("alice", notification.PriorityHigh, available, nil)
	if len(high) != 3 || !contains(high, "desktop") || !contains(high, "telegram") || !contains(high, "smtpn") {
		t.Errorf("expected [desktop telegram smtpn] for high, got %v", high)
	}

	//Requested subset restricts further.
	got := s.ResolveAgents("alice", notification.PriorityHigh, available, []string{"telegram"})
	if len(got) != 1 || got[0] != "telegram" {
		t.Errorf("expected [telegram], got %v", got)
	}

	//A priority with no enabled channel returns nil (medium: only desktop is on,
	//telegram/smtpn are high-only).
	med := s.ResolveAgents("alice", notification.PriorityMedium, []string{"telegram", "smtpn"}, nil)
	if med != nil {
		t.Errorf("expected nil when no channel enabled at this priority, got %v", med)
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
