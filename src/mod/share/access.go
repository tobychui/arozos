package share

/*
	Share access control

	Decides whether a request to /share/... may open a share:

	1. The share must exist and not have expired
	2. The visitor must be in the share's audience (anyone / signed in /
	   same group / listed groups / listed users)
	3. A password protected share must have been unlocked. Unlocking sets a
	   signed, HttpOnly cookie scoped to /share/ that is bound to the share
	   and to its current password, so changing the password signs everyone out.
*/

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/utils"
)

const (
	shareMetaTable           = "share_meta"
	shareCookieSecretKey     = "cookie_secret"
	shareSessionCookiePrefix = "ao_share_"
	shareSessionLifetime     = 12 * time.Hour

	//Password guessing limit, per share and client address
	maxPasswordAttempts   = 10
	passwordAttemptWindow = 10 * time.Minute
)

// accessGuard holds the state needed for password sessions
type accessGuard struct {
	secret []byte

	mu       sync.Mutex
	attempts map[string]*passwordAttempts
}

type passwordAttempts struct {
	count       int
	windowStart time.Time
}

// newAccessGuard loads (or creates) the cookie signing secret. Storing it in
// the database keeps unlocked shares unlocked across restarts.
func (s *Manager) newAccessGuard() *accessGuard {
	guard := &accessGuard{attempts: map[string]*passwordAttempts{}}
	if s.options.ShareEntryTable == nil || s.options.ShareEntryTable.Database == nil {
		guard.secret = randomSecret()
		return guard
	}

	db := s.options.ShareEntryTable.Database
	db.NewTable(shareMetaTable)
	secretHex := ""
	if err := db.Read(shareMetaTable, shareCookieSecretKey, &secretHex); err == nil {
		if secret, err := hex.DecodeString(secretHex); err == nil && len(secret) == 32 {
			guard.secret = secret
			return guard
		}
	}

	guard.secret = randomSecret()
	db.Write(shareMetaTable, shareCookieSecretKey, hex.EncodeToString(guard.secret))
	return guard
}

func randomSecret() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		//crypto/rand failing is not recoverable in a meaningful way
		panic(err)
	}
	return secret
}

func sessionCookieName(so *shareEntry.ShareOption) string {
	return shareSessionCookiePrefix + so.UUID
}

// sign returns the session signature for the given share and expiry time
func (g *accessGuard) sign(so *shareEntry.ShareOption, expires int64) string {
	mac := hmac.New(sha256.New, g.secret)
	mac.Write([]byte(so.UUID + "\n" + so.PasswordHash + "\n" + strconv.FormatInt(expires, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

// issueSession sets the cookie that unlocks a password protected share
func (g *accessGuard) issueSession(w http.ResponseWriter, r *http.Request, so *shareEntry.ShareOption) {
	expiresAt := time.Now().Add(shareSessionLifetime)
	if so.ExpireAt > 0 && so.ExpireAt < expiresAt.Unix() {
		expiresAt = time.Unix(so.ExpireAt, 0)
	}
	expires := expiresAt.Unix()
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName(so),
		Value:    strconv.FormatInt(expires, 10) + "." + g.sign(so, expires),
		Path:     "/share/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	})
}

// hasValidSession reports whether the request carries an unexpired session
// for the share's current password.
func (g *accessGuard) hasValidSession(r *http.Request, so *shareEntry.ShareOption) bool {
	cookie, err := r.Cookie(sessionCookieName(so))
	if err != nil {
		return false
	}
	expiresStr, signature, found := strings.Cut(cookie.Value, ".")
	if !found {
		return false
	}
	expires, err := strconv.ParseInt(expiresStr, 10, 64)
	if err != nil || time.Now().Unix() >= expires {
		return false
	}
	return hmac.Equal([]byte(signature), []byte(g.sign(so, expires)))
}

// allowAttempt reports whether the client may try another password. Failed
// attempts are counted by recordFailure.
func (g *accessGuard) allowAttempt(key string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	record, ok := g.attempts[key]
	if !ok || now.Sub(record.windowStart) > passwordAttemptWindow {
		return true
	}
	return record.count < maxPasswordAttempts
}

func (g *accessGuard) recordFailure(key string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()

	//Drop stale records so the map cannot grow without bound
	for k, record := range g.attempts {
		if now.Sub(record.windowStart) > passwordAttemptWindow {
			delete(g.attempts, k)
		}
	}

	record, ok := g.attempts[key]
	if !ok {
		record = &passwordAttempts{windowStart: now}
		g.attempts[key] = record
	}
	record.count++
}

func (g *accessGuard) clearFailures(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.attempts, key)
}

func attemptKey(r *http.Request, so *shareEntry.ShareOption) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return so.UUID + "|" + host
}

// lookupActiveShare returns the share with the given id if it exists and has not expired
func (s *Manager) lookupActiveShare(id string) *shareEntry.ShareOption {
	so := s.GetShareObjectFromUUID(id)
	if so == nil || so.IsExpired(time.Now()) {
		return nil
	}
	return so
}

/*
authorizeShareAccess checks the audience and the password of a share. It
writes the rejection itself and returns false if the request must stop.

raw is true for requests that fetch content (download, preview, zip,
upload) rather than a page, which get a status code instead of a redirect
to the login page or the password form.
*/
func (s *Manager) authorizeShareAccess(w http.ResponseWriter, r *http.Request, so *shareEntry.ShareOption, raw bool) bool {
	if !s.checkAudience(w, r, so, raw) {
		return false
	}

	if so.HasPassword() && !s.guard.hasValidSession(r, so) {
		if raw {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("401 - Password required"))
		} else {
			s.servePasswordPage(w, r, so, false, http.StatusOK)
		}
		return false
	}
	return true
}

// checkAudience checks that the visitor is someone the share is for
func (s *Manager) checkAudience(w http.ResponseWriter, r *http.Request, so *shareEntry.ShareOption, raw bool) bool {
	rejectUnauthorized := func() {
		if raw {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("401 - Unauthorized"))
		} else {
			http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.html")+"?redirect=/share/"+so.UUID, http.StatusTemporaryRedirect)
		}
	}
	rejectForbidden := func() {
		if raw {
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("403 - Forbidden"))
		} else {
			ServePermissionDeniedPage(w)
		}
	}

	switch so.Permission {
	case shareEntry.PermissionAnyone:
		return true
	case shareEntry.PermissionSignedIn:
		if !s.options.AuthAgent.CheckAuth(r) {
			rejectUnauthorized()
			return false
		}
		return true
	case shareEntry.PermissionSameGroup, shareEntry.PermissionGroups, shareEntry.PermissionUsers:
		thisuserinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			//User not logged in. Redirect to login page
			rejectUnauthorized()
			return false
		}

		//The owner can always open their own share
		if thisuserinfo.Username == so.Owner {
			return true
		}

		thisUsersGroupByName := thisuserinfo.GetUserPermissionGroupNames()
		allowed := false
		switch so.Permission {
		case shareEntry.PermissionSameGroup:
			//Every group of the owner (at share time) must be one of the user's groups
			allowed = true
			for _, allowedpg := range so.Accessibles {
				if !utils.StringInArray(thisUsersGroupByName, allowedpg) {
					allowed = false
				}
			}
		case shareEntry.PermissionGroups:
			for _, thisUserPg := range thisUsersGroupByName {
				if utils.StringInArray(so.Accessibles, thisUserPg) {
					allowed = true
				}
			}
		case shareEntry.PermissionUsers:
			allowed = utils.StringInArray(so.Accessibles, thisuserinfo.Username)
		}

		if !allowed {
			rejectForbidden()
			return false
		}
		return true
	}

	//Unsupported mode. Show notfound
	http.NotFound(w, r)
	return false
}

/*
handlePasswordSubmit handles POST /share/auth/{uuid} from the password page.
On success the share is unlocked and the visitor is sent back to it.
*/
func (s *Manager) handlePasswordSubmit(w http.ResponseWriter, r *http.Request, id string) {
	so := s.lookupActiveShare(id)
	if so == nil {
		s.serveNotFoundPage(w, r, id)
		return
	}

	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/share/"+so.UUID+"/", http.StatusSeeOther)
		return
	}

	if !s.checkAudience(w, r, so, false) {
		return
	}

	if !so.HasPassword() {
		http.Redirect(w, r, "/share/"+so.UUID+"/", http.StatusSeeOther)
		return
	}

	now := time.Now()
	key := attemptKey(r, so)
	if !s.guard.allowAttempt(key, now) {
		s.servePasswordPage(w, r, so, true, http.StatusTooManyRequests)
		return
	}

	r.ParseForm()
	if !so.CheckPassword(r.PostForm.Get("password")) {
		s.guard.recordFailure(key, now)
		s.servePasswordPage(w, r, so, true, http.StatusUnauthorized)
		return
	}

	s.guard.clearFailures(key)
	s.guard.issueSession(w, r, so)
	http.Redirect(w, r, "/share/"+so.UUID+"/", http.StatusSeeOther)
}

// servePasswordPage renders the password form. It deliberately shows nothing
// about the shared file.
func (s *Manager) servePasswordPage(w http.ResponseWriter, r *http.Request, so *shareEntry.ShareOption, failed bool, status int) {
	errorMessage := ""
	if failed {
		errorMessage = "Incorrect password, please try again."
		if status == http.StatusTooManyRequests {
			errorMessage = "Too many attempts. Please wait a few minutes and try again."
		}
	}

	content, err := utils.Templateload("./system/share/password.html", map[string]string{
		"hostname": s.options.HostName,
		"reqid":    so.UUID,
		"error":    errorMessage,
		"reqtime":  strconv.Itoa(int(time.Now().Unix())),
	})
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("401 - This share is password protected"))
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write([]byte(content))
}

// serveNotFoundPage renders the "share not found" page, also used for expired shares
func (s *Manager) serveNotFoundPage(w http.ResponseWriter, r *http.Request, id string) {
	content, err := utils.Templateload("./system/share/notfound.html", map[string]string{
		"hostname": s.options.HostName,
		"reqid":    id,
		"reqtime":  strconv.Itoa(int(time.Now().Unix())),
	})
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte(content))
}

func ServePermissionDeniedPage(w http.ResponseWriter) {
	w.WriteHeader(http.StatusForbidden)
	pageContent := []byte("Permissioned Denied")
	if utils.FileExists("system/share/permissionDenied.html") {
		content, err := os.ReadFile("system/share/permissionDenied.html")
		if err == nil {
			pageContent = content
		}
	}
	w.Write([]byte(pageContent))
}
