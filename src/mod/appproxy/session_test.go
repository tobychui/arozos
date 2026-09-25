package appproxy

import (
	"testing"
	"time"
)

func TestTicketLifecycle(t *testing.T) {
	s := newSessionStore()
	lookup := func(u string) *Identity { return testUsers[u] }

	tk := s.issueTicket("alice", "app", "/page")
	if _, _, ok := s.claimTicket(tk, "other"); ok {
		t.Fatalf("a ticket must not open another app")
	}
	if _, _, ok := s.claimTicket(tk, "app"); ok {
		t.Fatalf("a failed claim must still consume the ticket")
	}

	tk = s.issueTicket("alice", "app", "/page")
	token, returnTo, ok := s.claimTicket(tk, "app")
	if !ok || returnTo != "/page" {
		t.Fatalf("claim = %v %q", ok, returnTo)
	}
	if id := s.resolve(token, "app", lookup); id == nil || id.Username != "alice" {
		t.Errorf("resolve = %+v", id)
	}
	if id := s.resolve(token, "other", lookup); id != nil {
		t.Errorf("a session must not open another app")
	}
	if id := s.resolve("", "app", lookup); id != nil {
		t.Errorf("empty token resolved")
	}
}

func TestExpiredTicket(t *testing.T) {
	s := newSessionStore()
	tk := s.issueTicket("alice", "app", "/")
	s.tickets[tk].expires = time.Now().Add(-time.Second)
	if _, _, ok := s.claimTicket(tk, "app"); ok {
		t.Errorf("expired ticket accepted")
	}
}

func TestSessionRevalidation(t *testing.T) {
	s := newSessionStore()
	users := map[string]*Identity{"carol": {Username: "carol"}}
	lookup := func(u string) *Identity { return users[u] }

	tk := s.issueTicket("carol", "app", "/")
	token, _, _ := s.claimTicket(tk, "app")
	if s.resolve(token, "app", lookup) == nil {
		t.Fatalf("session not resolved")
	}

	//The account is removed; once the cached record is stale the session ends
	delete(users, "carol")
	s.sessions[token].checkedAt = time.Now().Add(-2 * identityRecheck)
	if s.resolve(token, "app", lookup) != nil {
		t.Errorf("session of a removed user still valid")
	}
	if _, ok := s.sessions[token]; ok {
		t.Errorf("session of a removed user not dropped")
	}
}

func TestDropEndpointSessions(t *testing.T) {
	s := newSessionStore()
	lookup := func(u string) *Identity { return testUsers[u] }
	a, _, _ := s.claimTicket(s.issueTicket("alice", "a", "/"), "a")
	b, _, _ := s.claimTicket(s.issueTicket("alice", "b", "/"), "b")
	s.dropEndpoint("a")
	if s.resolve(a, "a", lookup) != nil {
		t.Errorf("dropped endpoint session still valid")
	}
	if s.resolve(b, "b", lookup) == nil {
		t.Errorf("other endpoint session dropped")
	}
}

func TestSafeReturnPath(t *testing.T) {
	tests := map[string]string{
		"/page?x=1":        "/page?x=1",
		"//evil.com":       "/",
		"https://evil.com": "/",
		"/\\evil.com":      "/",
		"":                 "/",
	}
	for in, want := range tests {
		if got := safeReturnPath(in); got != want {
			t.Errorf("safeReturnPath(%q) = %q, want %q", in, got, want)
		}
	}
}
