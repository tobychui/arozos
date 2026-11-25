package syncserv

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	auth.go

	How an upload request signs in: the user name in the Username header and
	the password as Authorization: Bearer <password>. HTTP Basic works too,
	for curl and for a browser opening the address to test the password.
*/

const (
	refusedSignIn  = "Invalid username or password"
	minPasswordLen = 8
	maxPasswordLen = 72 //bcrypt reads no further
	verifiedFor    = 10 * time.Minute
)

var errRefused = errors.New(refusedSignIn)

func firstHeader(r *http.Request, names ...string) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "firstHeader: r=%s len(names)=%d", logger.RequestSummary(r), len(names))
	}
	for _, name := range names {
		if value := strings.TrimSpace(r.Header.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

// stripBearer drops a "Bearer " in front of a password.
func stripBearer(value string) (string, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "stripBearer: value=%.120q", value)
	}
	value = strings.TrimSpace(value)
	if len(value) > 7 && strings.EqualFold(value[:7], "bearer ") {
		return strings.TrimSpace(value[7:]), true
	}
	return value, false
}

// credentials reads the user name and password of an upload request.
//
// X-User-Name and X-User-Cred come first: a proxy in front of the server
// (Cloudflare Access, a tunnel) may remove the Authorization header or put
// its own in it, and these headers pass untouched. X-User-Cred holds the
// password alone; a "Bearer " in front is tolerated.
func credentials(r *http.Request) (string, string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "credentials: r=%s", logger.RequestSummary(r))
	}
	username := firstHeader(r, "X-User-Name", "Username", "X-Username")
	if cred := r.Header.Get("X-User-Cred"); strings.TrimSpace(cred) != "" {
		password, _ := stripBearer(cred)
		return username, password
	}
	if basicUser, basicPassword, ok := r.BasicAuth(); ok {
		if strings.TrimSpace(basicUser) != "" {
			username = strings.TrimSpace(basicUser)
		}
		return username, basicPassword
	}
	password, bearer := stripBearer(r.Header.Get("Authorization"))
	if !bearer {
		password = ""
	}
	return username, password
}

// ValidateSyncPassword checks a new sync password.
func ValidateSyncPassword(password string) error {
	logger.Debug("fileservers/servers/syncserv", "ValidateSyncPassword")
	if len(password) < minPasswordLen {
		return errors.New("The sync password must be at least 8 characters long")
	}
	if len(password) > maxPasswordLen {
		return errors.New("The sync password must be at most 72 bytes long")
	}
	if strings.TrimSpace(password) != password {
		return errors.New("The sync password cannot start or end with a space")
	}
	for _, r := range password {
		if r < 0x20 || r == 0x7f {
			return errors.New("The sync password cannot contain control characters")
		}
	}
	return nil
}

// setSyncPassword stores the hash of a user's sync password.
func (m *Manager) setSyncPassword(username, password string) error {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.setSyncPassword: username=%.120q", username)
	}
	if err := ValidateSyncPassword(password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	m.cache.forget(username)
	return m.opt.Sysdb.Write(settingsTable, prefixSecret+username, string(hash))
}

// checkPassword decides the password of an upload request.
func (m *Manager) checkPassword(username, password string, settings UserSettings) error {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.checkPassword: username=%.120q", username)
	}
	if password == "" {
		return errRefused
	}
	if settings.LoginPassword {
		if m.opt.CheckLoginPassword != nil && m.opt.CheckLoginPassword(username, password) {
			return nil
		}
		return errRefused
	}
	if len(password) > maxPasswordLen {
		return errRefused
	}
	if m.cache.match(username, password) {
		return nil
	}
	hash := ""
	if err := m.opt.Sysdb.Read(settingsTable, prefixSecret+username, &hash); err != nil || hash == "" {
		return errRefused
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return errRefused
	}
	m.cache.store(username, password)
	return nil
}

/*
	Verified passwords

	bcrypt takes a good part of a second on a small board, and a phone sends
	one request per photo, so a password that was right is remembered (as a
	keyed hash, in memory only) for ten minutes.
*/

type verified struct {
	sum   []byte
	until time.Time
}

type passwordCache struct {
	key []byte
	mu  sync.Mutex
	m   map[string]verified
}

func newPasswordCache(key []byte) *passwordCache {
	logger.DebugTrace("fileservers/servers/syncserv", "newPasswordCache")
	return &passwordCache{key: key, m: map[string]verified{}}
}

func (c *passwordCache) sum(username, password string) []byte {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "passwordCache.sum: username=%.120q", username)
	}
	mac := hmac.New(sha256.New, c.key)
	mac.Write([]byte(username))
	mac.Write([]byte{0})
	mac.Write([]byte(password))
	return mac.Sum(nil)
}

func (c *passwordCache) match(username, password string) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "passwordCache.match: username=%.120q", username)
	}
	c.mu.Lock()
	entry, ok := c.m[username]
	c.mu.Unlock()
	if !ok || time.Now().After(entry.until) {
		return false
	}
	return hmac.Equal(entry.sum, c.sum(username, password))
}

func (c *passwordCache) store(username, password string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "passwordCache.store: username=%.120q", username)
	}
	sum := c.sum(username, password)
	c.mu.Lock()
	c.m[username] = verified{sum: sum, until: time.Now().Add(verifiedFor)}
	c.mu.Unlock()
}

func (c *passwordCache) forget(username string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "passwordCache.forget: username=%.120q", username)
	}
	c.mu.Lock()
	delete(c.m, username)
	c.mu.Unlock()
}

/*
	Wrong passwords

	After a few wrong passwords from one address for one user, and after
	more from anywhere for one user, requests for that user wait: two
	seconds, then twice as long after every further miss, up to 15 minutes.
	A right password clears both counts.
*/

const (
	freeMissesPerAddress = 5
	freeMissesPerUser    = 30
	maxWait              = 15 * time.Minute
	forgetMissesAfter    = time.Hour
)

type strike struct {
	misses int
	until  time.Time
	last   time.Time
}

type limiter struct {
	mu sync.Mutex
	m  map[string]*strike
}

func newLimiter() *limiter {
	logger.DebugTrace("fileservers/servers/syncserv", "newLimiter")
	return &limiter{m: map[string]*strike{}}
}

func limiterKeys(username, address string) (string, string) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncserv", "limiterKeys: username=%.120q", username)
	}
	return "a/" + address + "/" + username, "u/" + username
}

// wait is how long requests for this user from this address must wait.
func (l *limiter) wait(username, address string, now time.Time) time.Duration {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "limiter.wait: username=%.120q", username)
	}
	byAddress, byUser := limiterKeys(username, address)
	l.mu.Lock()
	defer l.mu.Unlock()
	longest := time.Duration(0)
	for _, key := range []string{byAddress, byUser} {
		if s, ok := l.m[key]; ok && s.until.After(now) && s.until.Sub(now) > longest {
			longest = s.until.Sub(now)
		}
	}
	return longest
}

func (l *limiter) miss(username, address string, now time.Time) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "limiter.miss: username=%.120q", username)
	}
	byAddress, byUser := limiterKeys(username, address)
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.m) > 4096 {
		for key, s := range l.m {
			if now.Sub(s.last) > forgetMissesAfter {
				delete(l.m, key)
			}
		}
	}
	for key, free := range map[string]int{byAddress: freeMissesPerAddress, byUser: freeMissesPerUser} {
		s, ok := l.m[key]
		if !ok || now.Sub(s.last) > forgetMissesAfter {
			s = &strike{}
			l.m[key] = s
		}
		s.misses++
		s.last = now
		if over := s.misses - free; over > 0 {
			wait := maxWait
			if over < 10 {
				wait = time.Duration(1<<uint(over)) * time.Second
				if wait > maxWait {
					wait = maxWait
				}
			}
			s.until = now.Add(wait)
		}
	}
}

func (l *limiter) clear(username, address string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "limiter.clear: username=%.120q", username)
	}
	byAddress, byUser := limiterKeys(username, address)
	l.mu.Lock()
	delete(l.m, byAddress)
	delete(l.m, byUser)
	l.mu.Unlock()
}
