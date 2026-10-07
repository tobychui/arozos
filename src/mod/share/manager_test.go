package share

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/share/shareEntry"
)

func newPostRequest(form url.Values) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/system/file_system/share/update", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return r
}

func TestValidateShareModes(t *testing.T) {
	tests := []struct {
		mode      string
		wantOK    bool
		wantType  string
		wantNames []string
	}{
		{"anyone", true, "anyone", []string{}},
		{"signedin", true, "signedin", []string{}},
		{"samegroup", true, "samegroup", []string{}},
		{"users:alice,bob", true, "users", []string{"alice", "bob"}},
		{"groups:staff", true, "groups", []string{"staff"}},
		{"users:", false, "", nil},
		{"users: , ", false, "users", []string{}},
		{"everyone", false, "", []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.mode, func(t *testing.T) {
			ok, sharetype, names := validateShareModes(tc.mode)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if sharetype != tc.wantType || strings.Join(names, ",") != strings.Join(tc.wantNames, ",") {
				t.Errorf("got %q %v, want %q %v", sharetype, names, tc.wantType, tc.wantNames)
			}
		})
	}
}

func TestParseShareSettings(t *testing.T) {
	t.Run("empty request changes nothing", func(t *testing.T) {
		settings, err := parseShareSettings(newPostRequest(url.Values{}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if settings.Permission != nil || settings.AccessLevel != nil || settings.AllowDownload != nil ||
			settings.ShowFileList != nil || settings.Password != nil || settings.ExpireAt != nil {
			t.Errorf("expected no settings, got %+v", settings)
		}
	})

	t.Run("full settings", func(t *testing.T) {
		settings, err := parseShareSettings(newPostRequest(url.Values{
			"permission":    {"users"},
			"accessibles":   {"alice, bob,"},
			"accessLevel":   {"edit"},
			"allowDownload": {"false"},
			"showFileList":  {"true"},
			"password":      {"pw"},
			"expireAt":      {"1900000000"},
		}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if *settings.Permission != "users" || strings.Join(settings.Accessibles, ",") != "alice,bob" {
			t.Errorf("permission %q %v", *settings.Permission, settings.Accessibles)
		}
		if *settings.AccessLevel != "edit" || *settings.AllowDownload || !*settings.ShowFileList {
			t.Errorf("flags not parsed: %+v", settings)
		}
		if *settings.Password != "pw" || *settings.ExpireAt != 1900000000 {
			t.Errorf("password or expiry not parsed")
		}
	})

	t.Run("legacy mode", func(t *testing.T) {
		settings, err := parseShareSettings(newPostRequest(url.Values{"mode": {"groups:staff"}}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if *settings.Permission != "groups" || settings.Accessibles[0] != "staff" {
			t.Errorf("legacy mode not parsed: %+v", settings)
		}
	})

	t.Run("clear password wins", func(t *testing.T) {
		settings, _ := parseShareSettings(newPostRequest(url.Values{"password": {"pw"}, "clearPassword": {"true"}}))
		if settings.Password == nil || *settings.Password != "" {
			t.Error("clearPassword should set an empty password")
		}
	})

	t.Run("expire in", func(t *testing.T) {
		before := time.Now().Unix()
		settings, err := parseShareSettings(newPostRequest(url.Values{"expireIn": {"3600"}, "expireAt": {"1"}}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if *settings.ExpireAt < before+3600 || *settings.ExpireAt > time.Now().Unix()+3600 {
			t.Errorf("ExpireAt = %d, want about now+3600", *settings.ExpireAt)
		}
	})

	for _, bad := range []url.Values{
		{"expireIn": {"-5"}},
		{"expireIn": {"soon"}},
		{"expireAt": {"tomorrow"}},
		{"mode": {"everyone"}},
	} {
		if _, err := parseShareSettings(newPostRequest(bad)); err == nil {
			t.Errorf("expected an error for %v", bad)
		}
	}
}

func TestNewShareInfo_HidesSecrets(t *testing.T) {
	so := shareEntry.DefaultShareOption()
	so.UUID = "abc"
	so.FileRealPath = "/srv/data/users/alice/secret.txt"
	if err := so.SetPassword("pw"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	info := newShareInfo(so, time.Now())
	if !info.HasPassword || info.SharePath != "/share/abc" {
		t.Errorf("unexpected info: %+v", info)
	}
	js, _ := json.Marshal(info)
	if strings.Contains(string(js), so.PasswordHash) || strings.Contains(string(js), "/srv/data") {
		t.Errorf("share info leaks secrets: %s", js)
	}
}

func TestPageSettingsJSON(t *testing.T) {
	so := shareEntry.DefaultShareOption()
	so.IsFolder = true
	so.AccessLevel = shareEntry.AccessLevelEdit
	so.AllowDownload = false
	so.ExpireAt = 42

	var got map[string]interface{}
	if err := json.Unmarshal([]byte(pageSettingsJSON(so)), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if got["allowDownload"] != false || got["showFileList"] != true || got["canUpload"] != true || got["expireAt"] != float64(42) {
		t.Errorf("unexpected settings: %v", got)
	}
}

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "share.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	return NewShareManager(Options{ShareEntryTable: shareEntry.NewShareEntryTable(database)})
}

func TestAccessGuard_SecretPersists(t *testing.T) {
	m := newTestManager(t)
	again := NewShareManager(m.options)
	if string(m.guard.secret) != string(again.guard.secret) || len(m.guard.secret) != 32 {
		t.Error("cookie secret should be generated once and reloaded from the database")
	}
}

func TestAccessGuard_Session(t *testing.T) {
	m := newTestManager(t)
	so := shareEntry.DefaultShareOption()
	so.UUID = "share-1"
	so.SetPassword("pw")

	//No cookie
	if m.guard.hasValidSession(httptest.NewRequest(http.MethodGet, "/share/share-1/", nil), so) {
		t.Fatal("a request without cookie must not be unlocked")
	}

	rec := httptest.NewRecorder()
	m.guard.issueSession(rec, httptest.NewRequest(http.MethodPost, "/share/auth/share-1", nil), so)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].Path != "/share/" {
		t.Fatalf("unexpected session cookie: %+v", cookies)
	}

	withCookie := func(c *http.Cookie) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/share/share-1/", nil)
		r.AddCookie(c)
		return r
	}

	if !m.guard.hasValidSession(withCookie(cookies[0]), so) {
		t.Fatal("issued session should be valid")
	}

	//Tampered expiry
	tampered := *cookies[0]
	_, sig, _ := strings.Cut(tampered.Value, ".")
	tampered.Value = "9999999999." + sig
	if m.guard.hasValidSession(withCookie(&tampered), so) {
		t.Error("a session with a forged expiry must be rejected")
	}

	//Session of another share
	other := so.Clone()
	other.UUID = "share-2"
	forged := *cookies[0]
	forged.Name = sessionCookieName(other)
	if m.guard.hasValidSession(withCookie(&forged), other) {
		t.Error("a session must not unlock another share")
	}

	//Changing the password signs everyone out
	changed := so.Clone()
	changed.SetPassword("new password")
	if m.guard.hasValidSession(withCookie(cookies[0]), changed) {
		t.Error("a session must not survive a password change")
	}
}

func TestAccessGuard_AttemptLimit(t *testing.T) {
	m := newTestManager(t)
	now := time.Unix(1_000_000, 0)
	key := "share|1.2.3.4"

	for i := 0; i < maxPasswordAttempts; i++ {
		if !m.guard.allowAttempt(key, now) {
			t.Fatalf("attempt %d should be allowed", i+1)
		}
		m.guard.recordFailure(key, now)
	}
	if m.guard.allowAttempt(key, now) {
		t.Fatal("attempts over the limit must be refused")
	}
	if !m.guard.allowAttempt("share|5.6.7.8", now) {
		t.Error("another client must not be affected")
	}
	if !m.guard.allowAttempt(key, now.Add(passwordAttemptWindow+time.Second)) {
		t.Error("the limit should reset after the window")
	}

	m.guard.clearFailures(key)
	if !m.guard.allowAttempt(key, now) {
		t.Error("a successful login should clear the failures")
	}
}

func TestSanitizeUploadFilename(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"photo.jpg", "photo.jpg", false},
		{"  notes.txt ", "notes.txt", false},
		{"../../etc/passwd", "passwd", false},
		{`C:\Users\bob\report.pdf`, "report.pdf", false},
		{"100%.txt", "100_.txt", false},
		{"..", "", true},
		{"", "", true},
		{"a<b>.txt", "", true},
		{"bad\x00name", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := sanitizeUploadFilename(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Errorf("expected an error, got %q", got)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Errorf("got %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestUniqueDestination(t *testing.T) {
	taken := map[string]bool{
		"/data/a.txt":     true,
		"/data/a (1).txt": true,
		"/data/archive":   true,
	}
	exists := func(p string) bool { return taken[p] }

	tests := []struct {
		name string
		want string
	}{
		{"b.txt", "/data/b.txt"},
		{"a.txt", "/data/a (2).txt"},
		{"archive", "/data/archive (1)"},
	}
	for _, tc := range tests {
		if got := uniqueDestination(exists, "/data", tc.name); got != tc.want {
			t.Errorf("uniqueDestination(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}
