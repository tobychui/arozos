package ftpserv

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/user"
)

type rig struct {
	m        *Manager
	opt      *ManagerOption
	db       *database.Database
	current  string
	confirm  bool
	accounts map[string][]string //Username to groups
	checked  []string            //Passwords checked by CheckPassword
	logins   []string
}

func newRigWithDB(t *testing.T, db *database.Database) *rig {
	t.Helper()
	r := &rig{db: db, current: "alice", confirm: true, accounts: map[string][]string{
		"alice": {"default"},
		"bob":   {"ftpusers"},
		"carol": {"administrator"},
	}}
	r.opt = &ManagerOption{
		Hostname: "test",
		Sysdb:    db,
		CurrentUser: func(w http.ResponseWriter, req *http.Request) (string, error) {
			return r.current, nil
		},
		ConfirmPassword: func(w http.ResponseWriter, req *http.Request) bool {
			if !r.confirm {
				w.WriteHeader(http.StatusForbidden)
			}
			return r.confirm
		},
		CheckPassword: func(username, password, remote string) error {
			r.checked = append(r.checked, username)
			if password != "secret" {
				return errors.New("wrong password")
			}
			return nil
		},
		LogAuth: func(username, remote string, ok bool) {
			r.logins = append(r.logins, username+" "+strconv.FormatBool(ok))
		},
		LookupUser: func(username string) (*user.User, error) { return &user.User{Username: username}, nil },
		UserExists: func(username string) bool { _, ok := r.accounts[username]; return ok },
		ListUsers: func() []string {
			names := []string{}
			for name := range r.accounts {
				names = append(names, name)
			}
			return names
		},
		InGroups: func(username string, groups []string) bool {
			for _, have := range r.accounts[username] {
				for _, want := range groups {
					if have == want {
						return true
					}
				}
			}
			return false
		},
	}
	r.m = NewFTPManager(r.opt)
	t.Cleanup(r.m.Close)
	return r
}

func newDB(t *testing.T) *database.Database {
	t.Helper()
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newRig(t *testing.T) *rig {
	t.Helper()
	return newRigWithDB(t, newDB(t))
}

func freePort(t *testing.T) int {
	t.Helper()
	//The passive ports after it must be free as well, so ask for a few
	for i := 0; i < 20; i++ {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := l.Addr().(*net.TCPAddr).Port
		l.Close()
		if port < 65533 {
			return port
		}
	}
	t.Fatal("no free port")
	return 0
}

func post(h http.HandlerFunc, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

func get(h http.HandlerFunc) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h(w, httptest.NewRequest(http.MethodGet, "/", nil))
	return w
}

func isOK(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if strings.Contains(w.Body.String(), `"error"`) || w.Code != http.StatusOK {
		t.Fatalf("response %d: %s", w.Code, w.Body.String())
	}
}

func isError(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("response %d: %s, want an error", w.Code, w.Body.String())
	}
}

func config(t *testing.T, r *rig) AdminConfig {
	t.Helper()
	var c AdminConfig
	if err := json.Unmarshal(get(r.m.HandleConfig).Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func status(t *testing.T, r *rig) UserStatus {
	t.Helper()
	var s UserStatus
	if err := json.Unmarshal(get(r.m.HandleStatus).Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func validForm(port int) url.Values {
	return url.Values{"port": {strconv.Itoa(port)}, "idle": {"15"}}
}

func TestDefaults(t *testing.T) {
	r := newRig(t)
	c := config(t, r)
	if c.Running || c.Port != DefaultPort || c.Upnp || c.Passive || !c.AllowPublic || c.ReadOnly || c.IdleMinutes != DefaultIdleMinutes || c.UpnpAvailable {
		t.Errorf("defaults = %+v", c)
	}
	if s := status(t, r); s.Activated || s.Running || s.Username != "alice" {
		t.Errorf("status = %+v", s)
	}
}

func TestActivateNeedsTheLoginPassword(t *testing.T) {
	r := newRig(t)
	r.confirm = false
	w := post(r.m.HandleActivate, url.Values{"password": {"nope"}})
	if w.Code != http.StatusForbidden {
		t.Errorf("status %d, want 403", w.Code)
	}
	if r.m.UserEnabled("alice") {
		t.Error("FTP was turned on without the login password")
	}
	r.confirm = true
	isOK(t, post(r.m.HandleActivate, url.Values{"password": {"secret"}}))
	if !status(t, r).Activated {
		t.Error("FTP is not on after activating")
	}
}

func TestActivateMustBeAPost(t *testing.T) {
	r := newRig(t)
	isError(t, get(r.m.HandleActivate))
	isError(t, get(r.m.HandleDeactivate))
	if r.m.UserEnabled("alice") {
		t.Error("a GET turned FTP on")
	}
}

func TestOnlyUsersWithFTPOnCanSignIn(t *testing.T) {
	r := newRig(t)
	if err := r.m.authenticate("alice", "secret", "10.0.0.1"); err == nil {
		t.Fatal("alice signed in before turning FTP on")
	}
	if len(r.checked) != 0 {
		t.Errorf("the password of an account without FTP was checked: %v", r.checked)
	}
	isOK(t, post(r.m.HandleActivate, url.Values{"password": {"secret"}}))
	if err := r.m.authenticate("alice", "secret", "10.0.0.1"); err != nil {
		t.Errorf("alice cannot sign in with FTP on: %v", err)
	}
	err := r.m.authenticate("alice", "wrong", "10.0.0.1")
	if err == nil || err.Error() != refusedSignIn {
		t.Errorf("wrong password: %v, want %q", err, refusedSignIn)
	}
	if strings.Join(r.logins, ",") != "alice false,alice true,alice false" {
		t.Errorf("logged %v", r.logins)
	}
}

func TestDeactivateAndRevoke(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleActivate, url.Values{"password": {"secret"}}))
	isOK(t, post(r.m.HandleDeactivate, nil))
	if r.m.UserEnabled("alice") {
		t.Error("FTP is still on after deactivating")
	}

	r.current = "bob"
	isOK(t, post(r.m.HandleActivate, url.Values{"password": {"secret"}}))
	isOK(t, post(r.m.HandleRevoke, url.Values{"username": {"bob"}}))
	if r.m.UserEnabled("bob") {
		t.Error("FTP is still on for bob after an admin revoked it")
	}
	isError(t, post(r.m.HandleRevoke, url.Values{}))
}

func TestUsersListLeavesDeletedAccountsOut(t *testing.T) {
	r := newRig(t)
	for _, name := range []string{"bob", "alice", "ghost"} {
		r.m.setUser(name, true)
	}
	var rows []UserRow
	json.Unmarshal(get(r.m.HandleUsers).Body.Bytes(), &rows)
	if len(rows) != 2 || rows[0].Username != "alice" || rows[1].Username != "bob" || rows[0].Enabled == 0 {
		t.Errorf("users = %+v, want alice and bob", rows)
	}
	if r.m.UserEnabled("ghost") {
		t.Error("the deleted account kept FTP on")
	}
}

func TestGroupAccessMovesToUsers(t *testing.T) {
	db := newDB(t)
	db.NewTable(settingsTable)
	db.Write(settingsTable, "groups", []string{"ftpusers", "administrator"})
	r := newRigWithDB(t, db)
	if !r.m.UserEnabled("bob") || !r.m.UserEnabled("carol") || r.m.UserEnabled("alice") {
		t.Errorf("after migration: alice %v, bob %v, carol %v; want bob and carol", r.m.UserEnabled("alice"), r.m.UserEnabled("bob"), r.m.UserEnabled("carol"))
	}
	if db.KeyExists(settingsTable, "groups") {
		t.Error("the old group list is still there")
	}

	//Only once: someone who turns FTP off afterwards stays off
	r.m.setUser("bob", false)
	again := newRigWithDB(t, db)
	if again.m.UserEnabled("bob") {
		t.Error("the migration ran again")
	}
}

func TestBadSettingsAreRefused(t *testing.T) {
	r := newRig(t)
	bad := []url.Values{
		{"port": {"0"}, "idle": {"15"}},
		{"port": {"65534"}, "idle": {"15"}},
		{"port": {"x"}, "idle": {"15"}},
		{"port": {"2121"}, "idle": {"0"}},
		{"port": {"2121"}, "idle": {"2000"}},
		{"port": {"2121"}, "idle": {"15"}, "publicip": {"not an ip"}},
	}
	for _, form := range bad {
		isError(t, post(r.m.HandleConfig, form))
	}
	if c := config(t, r); c.Port != DefaultPort || c.IdleMinutes != DefaultIdleMinutes {
		t.Errorf("settings changed by refused requests: %+v", c)
	}
}

func TestSettingsAreSaved(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleConfig, url.Values{
		"port": {"2121"}, "idle": {"30"}, "upnp": {"true"}, "passive": {"true"},
		"publicip": {" 203.0.113.9 "}, "public": {"false"}, "readonly": {"true"},
	}))
	c := config(t, r)
	if c.Port != 2121 || c.IdleMinutes != 30 || !c.Upnp || !c.Passive || c.PublicIP != "203.0.113.9" || c.AllowPublic || !c.ReadOnly {
		t.Errorf("after saving: %+v", c)
	}
}

func TestStartsRestartsAndRemembers(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleConfig, validForm(freePort(t))))
	if err := r.m.FTPServerToggle(true); err != nil {
		t.Fatalf("FTPServerToggle(true) = %v", err)
	}
	if !r.m.IsFtpServerEnabled() || !status(t, r).Running {
		t.Fatal("not running")
	}

	port := freePort(t)
	w := post(r.m.HandleConfig, validForm(port))
	isOK(t, w)
	if !strings.Contains(w.Body.String(), `"Restarted":true`) {
		t.Errorf("response %s, want Restarted", w.Body.String())
	}
	conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("nothing listens on the new port: %v", err)
	}
	conn.Close()

	//A restart of ArozOS starts it again
	r.m.Close()
	again := NewFTPManager(r.opt)
	defer again.Close()
	if !again.IsFtpServerEnabled() {
		t.Error("not running after a restart")
	}
	if err := again.FTPServerToggle(false); err != nil || again.IsFtpServerEnabled() {
		t.Errorf("FTPServerToggle(false) = %v, running %v", err, again.IsFtpServerEnabled())
	}
}

func TestPortInUseIsReported(t *testing.T) {
	r := newRig(t)
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	isOK(t, post(r.m.HandleConfig, validForm(l.Addr().(*net.TCPAddr).Port)))
	if err := r.m.FTPServerToggle(true); err == nil {
		t.Fatal("started on a port in use")
	}
	if c := config(t, r); c.Running || c.LastError == "" {
		t.Errorf("after a failed start: %+v", c)
	}
	if r.db.KeyExists(settingsTable, "default") {
		var on bool
		r.db.Read(settingsTable, "default", &on)
		if on {
			t.Error("a failed start was remembered as on")
		}
	}
}
