package smbserv

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
	"time"

	"github.com/hirochachacha/go-smb2"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/storage/smbserver/aroz"
	"imuslab.com/arozos/mod/storage/smbserver/auth"
)

type testAccount struct {
	fsh *filesystem.FileSystemHandler
}

func (a *testAccount) GetAllFileSystemHandler() []*filesystem.FileSystemHandler {
	return []*filesystem.FileSystemHandler{a.fsh}
}
func (a *testAccount) CanRead(string) bool  { return true }
func (a *testAccount) CanWrite(string) bool { return true }

type rig struct {
	m        *Manager
	opt      *ManagerOption
	db       *database.Database
	dir      string
	conflict string
	current  string
	confirm  bool
}

func newRig(t *testing.T) *rig {
	t.Helper()
	dir := t.TempDir()
	db, err := database.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	r := &rig{db: db, dir: dir, current: "alice", confirm: true}
	fsh := &filesystem.FileSystemHandler{
		UUID:                  "media",
		Name:                  "Media",
		Hierarchy:             "public",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("media", dir, "public", false),
	}
	r.opt = &ManagerOption{
		ServerName: "AROZTEST",
		DeviceID:   "test-device",
		Sysdb:      db,
		SecretDir:  filepath.Join(dir, "smb"),
		CurrentUser: func(w http.ResponseWriter, req *http.Request) (string, error) {
			return r.current, nil
		},
		ConfirmPassword: func(w http.ResponseWriter, req *http.Request) bool {
			if !r.confirm {
				w.WriteHeader(http.StatusForbidden)
			}
			return r.confirm
		},
		LookupUser:   func(string) (aroz.Account, aroz.Quota, error) { return &testAccount{fsh: fsh}, nil, nil },
		UserExists:   func(name string) bool { return name == "alice" || name == "bob" },
		PortConflict: func() string { return r.conflict },
	}
	m, err := NewManager(r.opt)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	r.m = m
	return r
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
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

func errorOf(w *httptest.ResponseRecorder) string {
	var out struct {
		Error string `json:"error"`
	}
	json.Unmarshal(w.Body.Bytes(), &out)
	return out.Error
}

func usePort(t *testing.T, r *rig, port int) {
	t.Helper()
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(port)}}))
}

func TestStartsAndStops(t *testing.T) {
	r := newRig(t)
	if r.m.IsEnabled() {
		t.Fatal("the server must be off by default")
	}
	port := freePort(t)
	usePort(t, r, port)
	if err := r.m.ServerToggle(true); err != nil {
		t.Fatal(err)
	}
	if !r.m.IsEnabled() {
		t.Error("expected it to run")
	}
	c, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatalf("not listening: %v", err)
	}
	c.Close()
	if err := r.m.ServerToggle(false); err != nil {
		t.Fatal(err)
	}
	if r.m.IsEnabled() {
		t.Error("expected it to stop")
	}
	if err := r.m.ServerToggle(false); err != nil {
		t.Errorf("stopping twice: %v", err)
	}
}

func TestEnabledSurvivesARestart(t *testing.T) {
	r := newRig(t)
	usePort(t, r, freePort(t))
	if err := r.m.ServerToggle(true); err != nil {
		t.Fatal(err)
	}
	r.m.Close()

	again, err := NewManager(r.opt)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	if !again.IsEnabled() {
		t.Error("the server must come back after a reboot")
	}
}

func TestFailedBootKeepsTheChoice(t *testing.T) {
	r := newRig(t)
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	usePort(t, r, l.Addr().(*net.TCPAddr).Port)
	r.db.Write(settingsTable, "enabled", true)

	again, err := NewManager(r.opt)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	if again.IsEnabled() {
		t.Fatal("the port is taken")
	}
	if !again.savedEnabled() {
		t.Error("a busy port at boot must not turn the service off for good")
	}
}

func TestPortConflictIsExplained(t *testing.T) {
	r := newRig(t)
	r.conflict = "Samba"
	err := r.m.ServerToggle(true)
	if err == nil || !strings.Contains(err.Error(), "Samba") {
		t.Fatalf("err = %v", err)
	}
	if r.m.IsEnabled() {
		t.Error("it must not start")
	}
	var config AdminConfig
	json.Unmarshal(get(r.m.HandleConfig).Body.Bytes(), &config)
	if !strings.Contains(config.LastError, "Samba") || config.LastErrorKey != "conflict" {
		t.Errorf("the settings page must show why, in the user's language: %+v", config)
	}
}

func TestAnotherPortAvoidsTheConflict(t *testing.T) {
	r := newRig(t)
	r.conflict = "Samba"
	usePort(t, r, freePort(t))
	if err := r.m.ServerToggle(true); err != nil {
		t.Errorf("only the default port is contested: %v", err)
	}
}

func TestHoldsDefaultPort(t *testing.T) {
	r := newRig(t)
	if r.m.HoldsDefaultPort() {
		t.Error("a stopped server holds nothing")
	}
	usePort(t, r, freePort(t))
	r.m.ServerToggle(true)
	if r.m.HoldsDefaultPort() {
		t.Error("another port leaves Samba alone")
	}
}

func TestBindErrors(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{"listen tcp :445: bind: address already in use", "already in use"},
		{"listen tcp :445: bind: permission denied", "cap_net_bind_service"},
		{"something else", "something else"},
	}
	for _, c := range cases {
		if got := bindError(445, errors.New(c.raw)).Error(); !strings.Contains(got, c.want) {
			t.Errorf("%q gave %q", c.raw, got)
		}
	}
}

func TestBadPortIsRefusedAndTheOldOneKept(t *testing.T) {
	r := newRig(t)
	good := freePort(t)
	usePort(t, r, good)
	if err := r.m.ServerToggle(true); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"0", "70000", "abc", ""} {
		if msg := errorOf(post(r.m.HandleConfig, url.Values{"port": {bad}})); msg == "" {
			t.Errorf("port %q accepted", bad)
		}
	}

	busy, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	w := post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(busy.Addr().(*net.TCPAddr).Port)}})
	if !strings.Contains(errorOf(w), "already in use") {
		t.Fatalf("response: %s", w.Body.String())
	}
	if r.m.Port() != good || !r.m.IsEnabled() {
		t.Errorf("a failed change must leave the service as it was: port %d running %v", r.m.Port(), r.m.IsEnabled())
	}
}

func activate(r *rig, login, smb string) *httptest.ResponseRecorder {
	return post(r.m.HandleActivate, url.Values{"password": {login}, "smbpassword": {smb}})
}

func TestActivateStoresThePassword(t *testing.T) {
	r := newRig(t)
	isOK(t, activate(r, "login", "a good password"))
	_, hash, ok := r.m.creds.Lookup("alice")
	if !ok || string(hash) != string(auth.NTHash("a good password")) {
		t.Error("the password must be stored")
	}
}

func TestActivateNeedsTheLoginPassword(t *testing.T) {
	r := newRig(t)
	r.confirm = false
	if w := activate(r, "wrong", "a good password"); w.Code != http.StatusForbidden {
		t.Errorf("code %d", w.Code)
	}
	if r.m.creds.Has("alice") {
		t.Error("nothing may be stored without the login password")
	}
}

func TestActivateChecksTheNewPassword(t *testing.T) {
	r := newRig(t)
	for _, pw := range []string{"", "short", strings.Repeat("x", 128)} {
		if msg := errorOf(activate(r, "login", pw)); msg == "" {
			t.Errorf("password of length %d accepted", len(pw))
		}
	}
	if r.m.creds.Has("alice") {
		t.Error("nothing may be stored")
	}
}

func TestPasswordsAreNotTakenFromTheURL(t *testing.T) {
	r := newRig(t)
	req := httptest.NewRequest(http.MethodPost, "/?smbpassword=a+good+password&password=login", nil)
	w := httptest.NewRecorder()
	r.m.HandleActivate(w, req)
	if errorOf(w) == "" {
		t.Error("a password in the URL must be ignored")
	}
	get := httptest.NewRequest(http.MethodGet, "/?smbpassword=a+good+password", nil)
	w = httptest.NewRecorder()
	r.m.HandleActivate(w, get)
	if errorOf(w) == "" {
		t.Error("a GET must never activate")
	}
}

func dialAs(t *testing.T, port int, user, password string) (*smb2.Session, net.Conn, error) {
	t.Helper()
	nc, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	d := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: user, Password: password}}
	s, err := d.Dial(nc)
	if err != nil {
		nc.Close()
		return nil, nil, err
	}
	return s, nc, nil
}

func running(t *testing.T, r *rig) int {
	t.Helper()
	port := freePort(t)
	usePort(t, r, port)
	if err := r.m.ServerToggle(true); err != nil {
		t.Fatal(err)
	}
	return port
}

func TestActivatedUserLogsInOverSMB(t *testing.T) {
	r := newRig(t)
	port := running(t, r)

	if _, _, err := dialAs(t, port, "alice", "a good password"); err == nil {
		t.Fatal("no login before activation")
	}
	isOK(t, activate(r, "login", "a good password"))
	s, nc, err := dialAs(t, port, "alice", "a good password")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer nc.Close()
	shares, err := s.ListSharenames()
	if err != nil || len(shares) != 2 {
		t.Fatalf("shares %v %v", shares, err)
	}

	var clients []struct{ Username string }
	json.Unmarshal(get(r.m.HandleClients).Body.Bytes(), &clients)
	if len(clients) != 1 || clients[0].Username != "alice" {
		t.Errorf("clients = %+v", clients)
	}
}

func waitForNoClients(t *testing.T, r *rig) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.TrimSpace(get(r.m.HandleClients).Body.String()) == "[]" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Error("the client is still connected")
}

func TestPasswordChangeDropsOldSessions(t *testing.T) {
	r := newRig(t)
	port := running(t, r)
	isOK(t, activate(r, "login", "first password"))
	_, nc, err := dialAs(t, port, "alice", "first password")
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()

	isOK(t, activate(r, "login", "second password"))
	waitForNoClients(t, r)
	if _, _, err := dialAs(t, port, "alice", "first password"); err == nil {
		t.Error("the old password still logs in")
	}
}

func TestDeactivateEndsAccess(t *testing.T) {
	r := newRig(t)
	port := running(t, r)
	isOK(t, activate(r, "login", "a good password"))
	_, nc, err := dialAs(t, port, "alice", "a good password")
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()

	isOK(t, post(r.m.HandleDeactivate, nil))
	waitForNoClients(t, r)
	if _, _, err := dialAs(t, port, "alice", "a good password"); err == nil {
		t.Error("a deactivated user must not log in")
	}
}

func TestAdminRevoke(t *testing.T) {
	r := newRig(t)
	isOK(t, activate(r, "login", "a good password"))
	if !strings.Contains(get(r.m.HandleUsers).Body.String(), "alice") {
		t.Error("the user must be listed")
	}
	isOK(t, post(r.m.HandleRevoke, url.Values{"username": {"alice"}}))
	if r.m.creds.Has("alice") {
		t.Error("revoke must remove the password")
	}
	if errorOf(post(r.m.HandleRevoke, url.Values{})) == "" {
		t.Error("a missing name must be refused")
	}
}

func TestStatus(t *testing.T) {
	r := newRig(t)
	var status UserStatus
	json.Unmarshal(get(r.m.HandleStatus).Body.Bytes(), &status)
	if status.Running || status.Activated || status.Port != DefaultPort || status.Username != "alice" {
		t.Errorf("before: %+v", status)
	}
	if len(status.Shares) != 1 || status.Shares[0].Name != "media" || status.Shares[0].Comment != "Media" {
		t.Errorf("shares = %+v", status.Shares)
	}
	isOK(t, activate(r, "login", "a good password"))
	json.Unmarshal(get(r.m.HandleStatus).Body.Bytes(), &status)
	if !status.Activated {
		t.Error("activation must show")
	}
	if strings.Contains(get(r.m.HandleStatus).Body.String(), "password") {
		t.Error("the status must not carry anything secret")
	}
}

func TestEndpoints(t *testing.T) {
	r := newRig(t)
	eps := r.m.GetEndpoints(nil)
	if len(eps) != 1 || eps[0].ProtocolName != "smb://" || eps[0].Port != 0 {
		t.Errorf("default port: %+v", eps[0])
	}
	usePort(t, r, 1445)
	if got := r.m.GetEndpoints(nil)[0].Port; got != 1445 {
		t.Errorf("port = %d", got)
	}
}

func TestPublicAddressSettingIsKept(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {"1445"}, "public": {"true"}}))
	if !r.m.allowPublic() {
		t.Error("the setting must stick")
	}
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {"1445"}}))
	if r.m.allowPublic() {
		t.Error("an unticked box must turn it off")
	}
}

func TestFailureDelay(t *testing.T) {
	r := newRig(t)
	isOK(t, activate(r, "login", "a good password"))

	//Windows sends the signed in user first, on every connection
	for i := 0; i < 10; i++ {
		if got := r.m.failureDelay("user", "192.168.0.26:58388", false); got != 0 {
			t.Fatalf("an account with no SMB password must not build up a delay: %v", got)
		}
	}

	var last time.Duration
	for i := 0; i < 5; i++ {
		got := r.m.failureDelay("alice", "192.168.0.26:58388", false)
		if got < last {
			t.Errorf("attempt %d: %v after %v", i, got, last)
		}
		last = got
	}
	if last < 5*time.Second {
		t.Errorf("the delay should have grown, it is %v", last)
	}
	if last > 30*time.Second {
		t.Errorf("the delay passed its ceiling: %v", last)
	}
	if got := r.m.failureDelay("alice", "192.168.0.99:58388", false); got > 3*time.Second {
		t.Errorf("another address starts fresh: %v", got)
	}

	r.m.failureDelay("alice", "192.168.0.26:58388", true)
	if got := r.m.failureDelay("alice", "192.168.0.26:58388", false); got > 3*time.Second {
		t.Errorf("a good login must reset the count: %v", got)
	}
}

func TestImport(t *testing.T) {
	r := newRig(t)
	if errorOf(post(r.m.HandleImport, nil)) == "" {
		t.Error("there is no Samba to import from")
	}

	isOK(t, activate(r, "login", "keep this one"))
	r.opt.SambaHashes = func() (map[string][]byte, error) {
		return map[string][]byte{
			"alice":    auth.NTHash("from samba"),
			"bob":      auth.NTHash("bob's samba password"),
			"stranger": auth.NTHash("not an arozos account"),
		}, nil
	}
	w := post(r.m.HandleImport, nil)
	isOK(t, w)
	if strings.TrimSpace(w.Body.String()) != "1" {
		t.Errorf("imported %s", w.Body.String())
	}
	if _, hash, _ := r.m.creds.Lookup("alice"); string(hash) != string(auth.NTHash("keep this one")) {
		t.Error("an existing SMB password must win")
	}
	if !r.m.creds.Has("bob") {
		t.Error("bob must be imported")
	}
	if r.m.creds.Has("stranger") {
		t.Error("only ArozOS accounts come over")
	}

	r.opt.SambaHashes = func() (map[string][]byte, error) { return nil, errors.New("pdbedit failed") }
	if !strings.Contains(errorOf(post(r.m.HandleImport, nil)), "pdbedit") {
		t.Error("a failure must be reported")
	}
}
