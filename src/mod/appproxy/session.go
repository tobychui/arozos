package appproxy

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	session.go

	Login hand-off for subdomain mode. The ArozOS session cookie is host-only,
	so an app on its own hostname cannot see it. Instead:

	1. /app/<slug>/ on the ArozOS host (where the user is logged in) issues a
	   short lived one-time ticket bound to the user and the endpoint, and
	   redirects to https://<hostname>/__appproxy/claim?t=<ticket>
	2. The app host exchanges the ticket for its own session cookie.

	Sessions live in memory: after a restart the next navigation silently
	repeats the hand-off while the user is still logged in to ArozOS.
*/

const (
	ticketTTL  = 60 * time.Second
	sessionTTL = 12 * time.Hour

	//How long a session trusts its cached user record before looking it up again
	identityRecheck = time.Minute
)

type ticket struct {
	username string
	slug     string
	returnTo string
	expires  time.Time
}

type session struct {
	username  string
	slug      string
	expires   time.Time
	checkedAt time.Time
	identity  *Identity
}

type sessionStore struct {
	mu        sync.Mutex
	tickets   map[string]*ticket
	sessions  map[string]*session
	lastSweep time.Time
}

func newSessionStore() *sessionStore {
	logger.DebugTrace("appproxy", "newSessionStore")
	return &sessionStore{
		tickets:  map[string]*ticket{},
		sessions: map[string]*session{},
	}
}

func randomToken() (out0 string) {
	defer logger.Out1(logger.In0("appproxy", "randomToken"), &out0)
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		logger.DebugErr("appproxy", err)
		panic("appproxy: no system randomness: " + err.Error())
	}
	return hex.EncodeToString(b)
}

// sweep drops expired entries, at most once a minute. Caller holds the lock
func (s *sessionStore) sweep(now time.Time) {
	defer logger.Out0(logger.In2("appproxy", "sessionStore.sweep", "s", s, "&now", &now))
	if now.Sub(s.lastSweep) < time.Minute {
		return
	}
	s.lastSweep = now
	for k, t := range s.tickets {
		if now.After(t.expires) {
			delete(s.tickets, k)
		}
	}
	for k, ss := range s.sessions {
		if now.After(ss.expires) {
			delete(s.sessions, k)
		}
	}
}

// issueTicket creates a one-time ticket for a user to enter an endpoint
func (s *sessionStore) issueTicket(username string, slug string, returnTo string) (out0 string) {
	defer logger.Out1(logger.In4("appproxy", "sessionStore.issueTicket", "s", s, "username", username, "slug", slug, "returnTo", returnTo), &out0)
	now := time.Now()
	token := randomToken()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep(now)
	s.tickets[token] = &ticket{username: username, slug: slug, returnTo: returnTo, expires: now.Add(ticketTTL)}
	return token
}

// claimTicket consumes a ticket for the endpoint and opens a session. It
// returns the session token and the path to continue to
func (s *sessionStore) claimTicket(token string, slug string) (out0 string, out1 string, out2 bool) {
	defer logger.Out3(logger.In3("appproxy", "sessionStore.claimTicket", "s", s, "slug", slug, "!token", token), &out0, &out1, &out2)
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tickets[token]
	if !ok {
		return "", "", false
	}
	//One-time: consumed even when it does not match
	delete(s.tickets, token)
	if t.slug != slug || now.After(t.expires) {
		return "", "", false
	}
	sessionToken := randomToken()
	s.sessions[sessionToken] = &session{username: t.username, slug: slug, expires: now.Add(sessionTTL)}
	return sessionToken, t.returnTo, true
}

// resolve returns the user of a session cookie on an endpoint, revalidating
// the account through lookup at most once a minute
func (s *sessionStore) resolve(token string, slug string, lookup func(string) *Identity) (out0 *Identity) {
	defer logger.Out1(logger.In4("appproxy", "sessionStore.resolve", "s", s, "slug", slug, "lookup", lookup, "!token", token), &out0)
	if token == "" {
		return nil
	}
	now := time.Now()
	s.mu.Lock()
	ss, ok := s.sessions[token]
	if !ok || ss.slug != slug || now.After(ss.expires) {
		if ok {
			delete(s.sessions, token)
		}
		s.mu.Unlock()
		return nil
	}
	if ss.identity != nil && now.Sub(ss.checkedAt) < identityRecheck {
		id := ss.identity
		s.mu.Unlock()
		return id
	}
	username := ss.username
	s.mu.Unlock()

	//Look the account up outside the lock, it may hit the database
	id := lookup(username)

	s.mu.Lock()
	defer s.mu.Unlock()
	if id == nil {
		//Account removed
		delete(s.sessions, token)
		return nil
	}
	if ss, ok := s.sessions[token]; ok {
		ss.identity = id
		ss.checkedAt = now
	}
	return id
}

// revoke ends one session
func (s *sessionStore) revoke(token string) {
	defer logger.Out0(logger.In2("appproxy", "sessionStore.revoke", "s", s, "!token", token))
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}

// dropEndpoint ends every session and ticket of an endpoint
func (s *sessionStore) dropEndpoint(slug string) {
	defer logger.Out0(logger.In2("appproxy", "sessionStore.dropEndpoint", "s", s, "slug", slug))
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, t := range s.tickets {
		if t.slug == slug {
			delete(s.tickets, k)
		}
	}
	for k, ss := range s.sessions {
		if ss.slug == slug {
			delete(s.sessions, k)
		}
	}
}
