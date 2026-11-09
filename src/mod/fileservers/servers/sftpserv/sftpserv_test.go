package sftpserv

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
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage/sftpserver"
)

type noAccess struct{}

func (noAccess) GetAllFileSystemHandler() []*filesystem.FileSystemHandler { return nil }
func (noAccess) CanRead(string) bool                                      { return false }
func (noAccess) CanWrite(string) bool                                     { return false }

type rig struct {
	m      *Manager
	opt    *ManagerOption
	db     *database.Database
	logins []string
}

func newRig(t *testing.T) *rig {
	t.Helper()
	dir := t.TempDir()
	db, err := database.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	r := &rig{db: db}
	r.opt = &ManagerOption{
		Hostname: "test",
		KeyFile:  filepath.Join(dir, "sftp", "host.key"),
		Sysdb:    db,
		CurrentUser: func(w http.ResponseWriter, req *http.Request) (string, error) {
			return "alice", nil
		},
		CheckPassword: func(username, password, remote string) error {
			if password != "secret" {
				return errors.New("wrong password")
			}
			return nil
		},
		LogAuth: func(username, remote string, ok bool) {
			r.logins = append(r.logins, username+" "+strconv.FormatBool(ok))
		},
		LookupUser: func(string) (sftpserver.Access, error) { return noAccess{}, nil },
	}
	r.m = NewSFTPServer(r.opt)
	t.Cleanup(r.m.Close)
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

func config(t *testing.T, r *rig) AdminConfig {
	t.Helper()
	var c AdminConfig
	if err := json.Unmarshal(get(r.m.HandleConfig).Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestDefaults(t *testing.T) {
	r := newRig(t)
	c := config(t, r)
	if c.Running || c.Port != DefaultPort || c.Upnp || !c.AllowPublic || c.ReadOnly || c.UpnpAvailable {
		t.Errorf("defaults = %+v", c)
	}
	if !strings.HasPrefix(c.Fingerprint, "SHA256:") {
		t.Errorf("Fingerprint = %q, want a SHA256 fingerprint", c.Fingerprint)
	}
}

func TestConfigIsSaved(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {"2200"}, "upnp": {"true"}, "public": {"false"}, "readonly": {"true"}}))
	c := config(t, r)
	if c.Port != 2200 || !c.Upnp || c.AllowPublic || !c.ReadOnly {
		t.Errorf("after saving: %+v", c)
	}
}

func TestBadPortIsRefused(t *testing.T) {
	r := newRig(t)
	for _, port := range []string{"", "0", "70000", "abc"} {
		w := post(r.m.HandleConfig, url.Values{"port": {port}})
		if !strings.Contains(w.Body.String(), "error") {
			t.Errorf("port %q was accepted", port)
		}
	}
	if c := config(t, r); c.Port != DefaultPort {
		t.Errorf("Port = %d after refused changes, want %d", c.Port, DefaultPort)
	}
}

func TestStartsStopsAndRemembers(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(freePort(t))}}))
	if err := r.m.ServerToggle(true); err != nil {
		t.Fatalf("ServerToggle(true) = %v", err)
	}
	if !r.m.IsEnabled() {
		t.Fatal("not running after ServerToggle(true)")
	}

	//A restart of ArozOS starts it again
	r.m.Close()
	again := NewSFTPServer(r.opt)
	defer again.Close()
	if !again.IsEnabled() {
		t.Error("not running after a restart")
	}
	if err := again.ServerToggle(false); err != nil {
		t.Fatalf("ServerToggle(false) = %v", err)
	}
	if again.IsEnabled() {
		t.Error("still running after ServerToggle(false)")
	}
}

func TestSavingWhileRunningRestarts(t *testing.T) {
	r := newRig(t)
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(freePort(t))}}))
	if err := r.m.ServerToggle(true); err != nil {
		t.Fatalf("ServerToggle(true) = %v", err)
	}
	port := freePort(t)
	w := post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(port)}})
	isOK(t, w)
	if !strings.Contains(w.Body.String(), `"Restarted":true`) {
		t.Errorf("response %s, want Restarted", w.Body.String())
	}
	conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("nothing listens on the new port: %v", err)
	}
	conn.Close()
}

func TestPortInUseIsReported(t *testing.T) {
	r := newRig(t)
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(l.Addr().(*net.TCPAddr).Port)}}))
	if err := r.m.ServerToggle(true); err == nil {
		t.Fatal("started on a port in use")
	}
	if c := config(t, r); c.LastError == "" || c.Running {
		t.Errorf("after a failed start: %+v", c)
	}
}

func TestStatusNamesTheUser(t *testing.T) {
	r := newRig(t)
	var s UserStatus
	json.Unmarshal(get(r.m.HandleStatus).Body.Bytes(), &s)
	if s.Username != "alice" || s.Running || s.Port != DefaultPort || s.Fingerprint == "" {
		t.Errorf("status = %+v", s)
	}
}

func TestAuthenticateLogsAndHidesTheReason(t *testing.T) {
	r := newRig(t)
	if err := r.m.authenticate("alice", "secret", "10.0.0.2"); err != nil {
		t.Errorf("right password: %v", err)
	}
	err := r.m.authenticate("alice", "nope", "10.0.0.2")
	if err == nil || err.Error() != "Invalid username or password" {
		t.Errorf("wrong password: %v", err)
	}
	if strings.Join(r.logins, ",") != "alice true,alice false" {
		t.Errorf("logged %v", r.logins)
	}
}
