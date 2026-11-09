package ftp

import (
	"bufio"
	"errors"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	ftpserver "github.com/fclairamb/ftpserverlib"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/user"
)

// fakeClient is the part of a client connection the driver uses
type fakeClient struct {
	ftpserver.ClientContext
	id     uint32
	addr   net.Addr
	mu     sync.Mutex
	closed bool
}

func (c *fakeClient) ID() uint32           { return c.id }
func (c *fakeClient) RemoteAddr() net.Addr { return c.addr }
func (c *fakeClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	return nil
}
func (c *fakeClient) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

func tcpAddr(t *testing.T, s string) net.Addr {
	t.Helper()
	addr, err := net.ResolveTCPAddr("tcp", s)
	if err != nil {
		t.Fatal(err)
	}
	return addr
}

func testUser(name string) *user.User {
	return &user.User{Username: name, HomeDirectories: &storage.StoragePool{Storages: []*filesystem.FileSystemHandler{}}}
}

type authRig struct {
	mu      sync.Mutex
	remotes []string
}

func (r *authRig) options(port int) Options {
	return Options{
		ServerName: "test",
		Port:       port,
		Authenticate: func(username, password, remote string) error {
			r.mu.Lock()
			r.remotes = append(r.remotes, remote)
			r.mu.Unlock()
			if username != "alice" || password != "secret" {
				return errors.New("Invalid username or password")
			}
			return nil
		},
		LookupUser: func(username string) (*user.User, error) { return testUser(username), nil },
	}
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

func TestNewFTPHandlerChecksItsOptions(t *testing.T) {
	rig := &authRig{}
	if _, err := NewFTPHandler(Options{Port: 21}); err == nil {
		t.Error("a handler without user functions was created")
	}
	for _, port := range []int{0, -1, 65534, 70000} {
		if _, err := NewFTPHandler(rig.options(port)); err == nil {
			t.Errorf("port %d was accepted, though passive transfers need the next two", port)
		}
	}
	h, err := NewFTPHandler(rig.options(2121))
	if err != nil {
		t.Fatalf("NewFTPHandler() = %v", err)
	}
	if h.Port != 2121 || h.ServerRunning || h.UPNPEnabled {
		t.Errorf("new handler = %+v", h)
	}
}

// TestHandlerClose_NilServer ensures Close does not panic when server is nil.
func TestHandlerClose_NilServer(t *testing.T) {
	h := &Handler{}
	h.Close()
	if len(h.Clients()) != 0 {
		t.Error("an empty handler lists clients")
	}
	h.DropUser("alice")
}

// TestHandlerStart_NilServer ensures Start returns an error when server is nil.
func TestHandlerStart_NilServer(t *testing.T) {
	if err := (&Handler{}).Start(); err == nil {
		t.Error("expected error when starting with nil server")
	}
}

func TestStartReportsAPortInUse(t *testing.T) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	h, err := NewFTPHandler((&authRig{}).options(l.Addr().(*net.TCPAddr).Port))
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Start(); err == nil {
		h.Close()
		t.Fatal("Start() worked on a port in use")
	}
	if h.ServerRunning {
		t.Error("ServerRunning after a failed start")
	}
}

func TestAddressAllowed(t *testing.T) {
	cases := []struct {
		addr        string
		allowPublic bool
		want        bool
	}{
		{"192.168.0.9:40000", false, true},
		{"172.16.4.4:40000", false, true},
		{"127.0.0.1:40000", false, true},
		{"[fd00::5]:40000", false, true},
		{"1.1.1.1:40000", false, false},
		{"1.1.1.1:40000", true, true},
	}
	for _, c := range cases {
		if got := AddressAllowed(tcpAddr(t, c.addr), c.allowPublic); got != c.want {
			t.Errorf("AddressAllowed(%s, %v) = %v, want %v", c.addr, c.allowPublic, got, c.want)
		}
	}
}

func TestPublicClientIsRefusedOnlyWhenAsked(t *testing.T) {
	driver := &mainDriver{opt: Options{AllowPublic: false}}
	if _, err := driver.ClientConnected(&fakeClient{id: 1, addr: tcpAddr(t, "8.8.8.8:1000")}); err == nil {
		t.Error("a public client was let in")
	}
	if _, err := driver.ClientConnected(&fakeClient{id: 2, addr: tcpAddr(t, "192.168.1.2:1000")}); err != nil {
		t.Errorf("a private client was refused: %v", err)
	}
	driver.opt.AllowPublic = true
	if _, err := driver.ClientConnected(&fakeClient{id: 3, addr: tcpAddr(t, "8.8.8.8:1000")}); err != nil {
		t.Errorf("a public client was refused with public access on: %v", err)
	}
}

func TestClientsAndDropUser(t *testing.T) {
	rig := &authRig{}
	h, err := NewFTPHandler(rig.options(2121))
	if err != nil {
		t.Fatal(err)
	}
	alice := &fakeClient{id: 1, addr: tcpAddr(t, "10.0.0.5:3000")}
	bob := &fakeClient{id: 2, addr: tcpAddr(t, "10.0.0.6:3000")}
	for _, c := range []*fakeClient{alice, bob} {
		if _, err := h.driver.ClientConnected(c); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.driver.AuthUser(alice, "alice", "wrong"); err == nil {
		t.Fatal("a wrong password signed in")
	}
	if _, err := h.driver.AuthUser(alice, "alice", "secret"); err != nil {
		t.Fatalf("AuthUser() = %v", err)
	}
	if strings.Join(rig.remotes, ",") != "10.0.0.5,10.0.0.5" {
		t.Errorf("Authenticate got remotes %v, want the IP without a port", rig.remotes)
	}

	clients := h.Clients()
	if len(clients) != 2 {
		t.Fatalf("Clients() = %v", clients)
	}
	names := map[string]string{}
	for _, c := range clients {
		names[c.Address] = c.Username
		if c.Connected == 0 {
			t.Errorf("client %+v has no connection time", c)
		}
	}
	if names["10.0.0.5"] != "alice" || names["10.0.0.6"] != "" {
		t.Errorf("Clients() = %v, want alice signed in and bob not yet", clients)
	}

	h.DropUser("alice")
	if !alice.isClosed() || bob.isClosed() {
		t.Errorf("after DropUser(alice): alice closed %v, bob closed %v", alice.isClosed(), bob.isClosed())
	}

	h.driver.ClientDisconnected(alice)
	if len(h.Clients()) != 1 {
		t.Errorf("Clients() = %v after alice left", h.Clients())
	}
	h.Close()
	if !bob.isClosed() {
		t.Error("Close() left a client connected")
	}
}

func TestReadOnlyIsGivenToTheSession(t *testing.T) {
	rig := &authRig{}
	opt := rig.options(2121)
	opt.ReadOnly = true
	h, err := NewFTPHandler(opt)
	if err != nil {
		t.Fatal(err)
	}
	c := &fakeClient{id: 1, addr: tcpAddr(t, "10.0.0.5:3000")}
	h.driver.ClientConnected(c)
	session, err := h.driver.AuthUser(c, "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if !session.(aofs).readOnly {
		t.Error("the session is not read only")
	}
}

func TestWritesTo(t *testing.T) {
	cases := []struct {
		flag int
		want bool
	}{
		{os.O_RDONLY, false},
		{os.O_WRONLY, true},
		{os.O_RDWR, true},
		{os.O_RDONLY | os.O_CREATE, true},
		{os.O_RDONLY | os.O_APPEND, true},
		{os.O_RDONLY | os.O_TRUNC, true},
	}
	for _, c := range cases {
		if got := writesTo(c.flag); got != c.want {
			t.Errorf("writesTo(%#x) = %v, want %v", c.flag, got, c.want)
		}
	}
}

func TestReadOnlyRefusesWrites(t *testing.T) {
	a := newTestAofs()
	a.readOnly = true
	if a.checkAllowAccess(&filesystem.FileSystemHandler{UUID: "user"}, "/x", aofsCanWrite) {
		t.Error("a write was allowed in read only mode")
	}
}

// TestSignInOverTheNetwork runs the real server and signs in with a raw FTP
// conversation.
func TestSignInOverTheNetwork(t *testing.T) {
	rig := &authRig{}
	h, err := NewFTPHandler(rig.options(freePort(t)))
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer h.Close()

	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(h.Port), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(conn)
	expect := func(code string) {
		t.Helper()
		line, err := reader.ReadString('\n')
		if err != nil || !strings.HasPrefix(line, code) {
			t.Fatalf("got %q, %v; want %s", line, err, code)
		}
	}
	expect("220")
	conn.Write([]byte("USER alice\r\n"))
	expect("331")
	conn.Write([]byte("PASS secret\r\n"))
	expect("230")

	clients := h.Clients()
	if len(clients) != 1 || clients[0].Username != "alice" || clients[0].Address != "127.0.0.1" {
		t.Errorf("Clients() = %+v", clients)
	}

	h.DropUser("alice")
	if _, err := reader.ReadString('\n'); err == nil {
		//The server may say goodbye first, then the connection must end
		if _, err := reader.ReadString('\n'); err == nil {
			t.Error("the connection is still open after DropUser")
		}
	}
}
