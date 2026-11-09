package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/sessions"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	Session revocation

	The login session lives in a signed cookie (gorilla CookieStore), so the
	server keeps no record of it and logging out only overwrites the cookie in
	the browser. Every signed-in request also writes a refreshed copy of the
	cookie (UpdateSessionExpireTime). When the desktop logs out while other
	requests are still in flight, their responses can reach the browser after
	the logout response and put a signed-in cookie back: the user lands on the
	desktop again instead of the login page (issue #314).

	Each login therefore carries a random session id. Logout revokes that id,
	and CheckAuth refuses every cookie holding a revoked id, however late it
	arrives. Revoked ids are kept as long as a cookie signed before the logout
	can still be decoded, and stored in the system database so a restart does
	not bring them back.
*/

const (
	sessionIDKey        = "sid"          //Session value holding the session id
	revokedSessionTable = "auth_revoked" //System database table of revoked session ids
	sessionRevokeKeep   = 86400 * 30     //Seconds a revoked id is remembered (securecookie default max age)
	sessionIDBytes      = 16             //Random bytes in a session id
)

type sessionRevoker struct {
	mutex    sync.RWMutex
	revoked  map[string]int64 //Session id to the unix time it can be forgotten
	database *db.Database
}

// newSessionRevoker loads the revoked session ids still in effect from the
// system database.
func newSessionRevoker(sysdb *db.Database) *sessionRevoker {
	r := &sessionRevoker{
		revoked:  map[string]int64{},
		database: sysdb,
	}
	if sysdb == nil {
		return r
	}
	if err := sysdb.NewTable(revokedSessionTable); err != nil {
		logger.PrintAndLog("Auth", "Unable to create the revoked session table", err)
		return r
	}
	entries, err := sysdb.ListTable(revokedSessionTable)
	if err != nil {
		logger.PrintAndLog("Auth", "Unable to load revoked sessions", err)
		return r
	}
	now := time.Now().Unix()
	for _, keypairs := range entries {
		var expire int64
		if json.Unmarshal(keypairs[1], &expire) != nil || expire <= now {
			sysdb.Delete(revokedSessionTable, string(keypairs[0]))
			continue
		}
		r.revoked[string(keypairs[0])] = expire
	}
	return r
}

// Revoke marks a session id as logged out.
func (r *sessionRevoker) Revoke(sid string) {
	if r == nil || sid == "" {
		return
	}
	expire := time.Now().Unix() + sessionRevokeKeep
	r.mutex.Lock()
	r.revoked[sid] = expire
	r.mutex.Unlock()
	if r.database != nil {
		if err := r.database.Write(revokedSessionTable, sid, expire); err != nil {
			logger.PrintAndLog("Auth", "Unable to store a revoked session", err)
		}
	}
}

// IsRevoked tells if a session id was logged out.
func (r *sessionRevoker) IsRevoked(sid string) bool {
	if r == nil || sid == "" {
		return false
	}
	r.mutex.RLock()
	_, ok := r.revoked[sid]
	r.mutex.RUnlock()
	return ok
}

// Prune forgets the revoked ids no cookie can hold any more.
func (r *sessionRevoker) Prune() {
	if r == nil {
		return
	}
	now := time.Now().Unix()
	expired := []string{}
	r.mutex.Lock()
	for sid, expire := range r.revoked {
		if expire <= now {
			delete(r.revoked, sid)
			expired = append(expired, sid)
		}
	}
	r.mutex.Unlock()
	if r.database == nil || len(expired) == 0 {
		return
	}
	ops := make([]db.BatchOp, 0, len(expired))
	for _, sid := range expired {
		ops = append(ops, db.BatchOp{Table: revokedSessionTable, Key: sid, Delete: true})
	}
	if err := r.database.WriteBatch(ops); err != nil {
		logger.PrintAndLog("Auth", "Unable to prune revoked sessions", err)
	}
}

// newSessionID returns a random session id.
func newSessionID() string {
	buf := make([]byte, sessionIDBytes)
	if _, err := rand.Read(buf); err != nil {
		//crypto/rand does not fail on supported platforms
		panic(err)
	}
	return hex.EncodeToString(buf)
}

// sessionIDOf returns the session id held by a session, empty when it has none.
func sessionIDOf(session *sessions.Session) string {
	sid, _ := session.Values[sessionIDKey].(string)
	return sid
}

// startSession gives a session that is being signed in a new session id.
func startSession(session *sessions.Session) {
	session.Values[sessionIDKey] = newSessionID()
}
