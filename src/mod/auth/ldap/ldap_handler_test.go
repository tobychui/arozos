package ldap

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/auth/ldap/ldapreader"
	db "imuslab.com/arozos/mod/database"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func newTestDB(t *testing.T) (*db.Database, func()) {
	t.Helper()
	dir, err := os.MkdirTemp("", "arozos-ldap-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	database, err := db.NewDatabase(dir+"/test.db", false)
	if err != nil {
		os.RemoveAll(dir)
		t.Fatalf("NewDatabase: %v", err)
	}
	return database, func() { os.RemoveAll(dir) }
}

// minimalLdapHandler returns a handler suitable for testing the config-only
// endpoints (ReadConfig / WriteConfig). Fields not required by those handlers
// are left nil.
func minimalLdapHandler(coredb *db.Database) *ldapHandler {
	if err := coredb.NewTable("ldap"); err != nil {
		_ = err // table may already exist
	}
	return &ldapHandler{
		coredb:     coredb,
		ldapreader: ldapreader.NewLDAPReader("", "", "", ""),
	}
}

func postForm(t *testing.T, h http.HandlerFunc, values url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

func getReq(t *testing.T, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

// ── ReadConfig ────────────────────────────────────────────────────────────────

func TestLdapReadConfig_DefaultsToDisabled(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	w := getReq(t, h.ReadConfig)

	if w.Code != http.StatusOK {
		t.Fatalf("ReadConfig returned %d, want 200", w.Code)
	}

	var cfg Config
	if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("response is not valid JSON: %v\nbody: %s", err, w.Body.String())
	}
	if cfg.Enabled {
		t.Error("ReadConfig: expected Enabled=false for fresh DB, got true")
	}
}

func TestLdapReadConfig_ReturnsAllFields(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	// Pre-seed values.
	coredb.Write("ldap", "FQDN", "ldap.example.com")
	coredb.Write("ldap", "BaseDN", "cn=users,dc=example,dc=com")
	coredb.Write("ldap", "BindUsername", "admin")

	w := getReq(t, h.ReadConfig)
	var cfg Config
	if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("ReadConfig JSON parse: %v", err)
	}

	if cfg.FQDN != "ldap.example.com" {
		t.Errorf("FQDN: got %q, want %q", cfg.FQDN, "ldap.example.com")
	}
	if cfg.BaseDN != "cn=users,dc=example,dc=com" {
		t.Errorf("BaseDN: got %q, want %q", cfg.BaseDN, "cn=users,dc=example,dc=com")
	}
	if cfg.BindUsername != "admin" {
		t.Errorf("BindUsername: got %q, want %q", cfg.BindUsername, "admin")
	}
}

// ── WriteConfig ───────────────────────────────────────────────────────────────

func TestLdapWriteConfig_MissingEnabledField(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	w := postForm(t, h.WriteConfig, url.Values{"fqdn": {"ldap.example.com"}})

	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("WriteConfig without 'enabled': expected error, got %q", body)
	}
}

func TestLdapWriteConfig_DisabledAllowsEmptyFields(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	// When enabled=false, other required fields are optional.
	values := url.Values{"enabled": {"false"}}
	w := postForm(t, h.WriteConfig, values)

	body := w.Body.String()
	if strings.Contains(body, `"error"`) {
		t.Errorf("WriteConfig disabled: unexpected error: %q", body)
	}
}

func TestLdapWriteConfig_EnabledRequiresFields(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	// enabled=true but missing bind_username, bind_password, fqdn, base_dn.
	values := url.Values{"enabled": {"true"}}
	w := postForm(t, h.WriteConfig, values)
	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("WriteConfig enabled without required fields: expected error, got %q", body)
	}
}

func TestLdapWriteConfig_RoundTrip(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	writeVals := url.Values{
		"enabled":       {"false"},
		"bind_username": {"cn=admin,dc=example,dc=com"},
		"bind_password": {"s3cr3t"},
		"fqdn":          {"ldap.example.com"},
		"base_dn":       {"cn=users,dc=example,dc=com"},
	}
	wWrite := postForm(t, h.WriteConfig, writeVals)
	if strings.Contains(wWrite.Body.String(), `"error"`) {
		t.Fatalf("WriteConfig returned error: %s", wWrite.Body.String())
	}

	wRead := getReq(t, h.ReadConfig)
	var cfg Config
	if err := json.Unmarshal(wRead.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("ReadConfig JSON parse: %v", err)
	}

	checks := []struct{ field, got, want string }{
		{"BindUsername", cfg.BindUsername, "cn=admin,dc=example,dc=com"},
		{"BindPassword", cfg.BindPassword, "s3cr3t"},
		{"FQDN", cfg.FQDN, "ldap.example.com"},
		{"BaseDN", cfg.BaseDN, "cn=users,dc=example,dc=com"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s: got %q, want %q", c.field, c.got, c.want)
		}
	}
}

func TestLdapWriteConfig_UpdateOverwritesPreviousValues(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	h := minimalLdapHandler(coredb)

	// First write.
	postForm(t, h.WriteConfig, url.Values{
		"enabled":       {"false"},
		"bind_username": {"admin"},
		"bind_password": {"pass1"},
		"fqdn":          {"ldap.old.com"},
		"base_dn":       {"dc=old,dc=com"},
	})

	// Second write with new values.
	postForm(t, h.WriteConfig, url.Values{
		"enabled":       {"false"},
		"bind_username": {"newadmin"},
		"bind_password": {"pass2"},
		"fqdn":          {"ldap.new.com"},
		"base_dn":       {"dc=new,dc=com"},
	})

	wRead := getReq(t, h.ReadConfig)
	var cfg Config
	json.Unmarshal(wRead.Body.Bytes(), &cfg) //nolint:errcheck

	if cfg.FQDN != "ldap.new.com" {
		t.Errorf("FQDN after update: got %q, want %q", cfg.FQDN, "ldap.new.com")
	}
	if cfg.BindUsername != "newadmin" {
		t.Errorf("BindUsername after update: got %q, want %q", cfg.BindUsername, "newadmin")
	}
}

// ── Config struct ─────────────────────────────────────────────────────────────

func TestLdapConfig_JSONTags(t *testing.T) {
	cfg := Config{
		Enabled:      true,
		BindUsername: "user",
		BindPassword: "pass",
		FQDN:         "ldap.example.com",
		BaseDN:       "dc=example,dc=com",
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("Marshal Config: %v", err)
	}
	body := string(data)

	for _, want := range []string{`"enabled"`, `"bind_username"`, `"bind_password"`, `"fqdn"`, `"base_dn"`} {
		if !strings.Contains(body, want) {
			t.Errorf("Config JSON missing field %s; body: %s", want, body)
		}
	}
}
