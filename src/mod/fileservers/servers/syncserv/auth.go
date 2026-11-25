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

func firstHeader(r *http.Request, names ...string) (out0 string) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "firstHeader", "r", r, "names", names), &out0)
	for _, name := range names {
		if value := strings.TrimSpace(r.Header.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

// stripBearer drops a "Bearer " in front of a password.
func stripBearer(value string) (out0 string, out1 bool) {
	defer logger.Out2(logger.In1("fileservers/servers/syncserv", "stripBearer", "value", value), &out0, &out1)
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
func credentials(r *http.Request) (out0 string, out1 string) {
	defer logger.Out2(logger.In1("fileservers/servers/syncserv", "credentials", "r", r), &out0, &out1)
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
func ValidateSyncPassword(password string) (out0 error) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "ValidateSyncPassword", "!password", password), &out0)
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
func (m *Manager) setSyncPassword(username, password string) (out0 error) {
	defer logger.Out1(logger.In3("fileservers/servers/syncserv", "Manager.setSyncPassword", "m", m, "username", username, "!password", password), &out0)
	if err := ValidateSyncPassword(password); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return err
	}
	m.cache.forget(username)
	return m.opt.Sysdb.Write(settingsTable, prefixSecret+username, string(hash))
}

// checkPassword decides the password of an upload request.
func (m *Manager) checkPassword(username, password string, settings UserSettings) (out0 error) {
	defer logger.Out1(logger.In4("fileservers/servers/syncserv", "Manager.checkPassword", "m", m, "username", username, "&settings", &settings, "!password", password), &out0)
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

func newPasswordCache(key []byte) (out0 *passwordCache) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "newPasswordCache", "!&key", &key), &out0)
	return &passwordCache{key: key, m: map[string]verified{}}
}

func (c *passwordCache) sum(username, password string) (out0 []byte) {
	defer logger.Out1(logger.In3("fileservers/servers/syncserv", "passwordCache.sum", "c", c, "username", username, "!password", password), &out0)
	mac := hmac.New(sha256.New, c.key)
	mac.Write([]byte(username))
	mac.Write([]byte{0})
	mac.Write([]byte(password))
	return mac.Sum(nil)
}

func (c *passwordCache) match(username, password string) (out0 bool) {
	defer logger.Out1(logger.In3("fileservers/servers/syncserv", "passwordCache.match", "c", c, "username", username, "!password", password), &out0)
	c.mu.Lock()
	entry, ok := c.m[username]
	c.mu.Unlock()
	if !ok || time.Now().After(entry.until) {
		return false
	}
	return hmac.Equal(entry.sum, c.sum(username, password))
}

func (c *passwordCache) store(username, password string) {
	defer logger.Out0(logger.In3("fileservers/servers/syncserv", "passwordCache.store", "c", c, "username", username, "!password", password))
	sum := c.sum(username, password)
	c.mu.Lock()
	c.m[username] = verified{sum: sum, until: time.Now().Add(verifiedFor)}
	c.mu.Unlock()
}

func (c *passwordCache) forget(username string) {
	defer logger.Out0(logger.In2("fileservers/servers/syncserv", "passwordCache.forget", "c", c, "username", username))
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

func newLimiter() (out0 *limiter) {
	defer logger.Out1(logger.In0("fileservers/servers/syncserv", "newLimiter"), &out0)
	return &limiter{m: map[string]*strike{}}
}

func limiterKeys(username, address string) (out0 string, out1 string) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "limiterKeys", "username", username, "address", address), &out0, &out1)
	return "a/" + address + "/" + username, "u/" + username
}

// wait is how long requests for this user from this address must wait.
func (l *limiter) wait(username, address string, now time.Time) (out0 time.Duration) {
	defer logger.Out1(logger.In4("fileservers/servers/syncserv", "limiter.wait", "l", l, "username", username, "address", address, "&now", &now), &out0)
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
	defer logger.Out0(logger.In4("fileservers/servers/syncserv", "limiter.miss", "l", l, "username", username, "address", address, "&now", &now))
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
	defer logger.Out0(logger.In3("fileservers/servers/syncserv", "limiter.clear", "l", l, "username", username, "address", address))
	byAddress, byUser := limiterKeys(username, address)
	l.mu.Lock()
	delete(l.m, byAddress)
	delete(l.m, byUser)
	l.mu.Unlock()
}
