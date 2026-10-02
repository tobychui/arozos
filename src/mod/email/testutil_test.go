package email

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
)

const (
	testMailUser     = "alice@example.test"
	testMailPassword = "correct horse"
)

var testAdmin = Principal{Username: "admin", Admin: true}

// newTestManager returns a manager rooted in a temp dir with the background
// goroutine disabled.
func newTestManager(t *testing.T) *Manager {
	t.Helper()
	manager, err := NewManager(Options{DataDir: t.TempDir(), DisableBackground: true})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	t.Cleanup(manager.Close)
	return manager
}

// testIMAP is an in-memory IMAP server listening on localhost.
type testIMAP struct {
	host string
	port int
	user *imapmemserver.User
}

func startIMAPServer(t *testing.T, caps imap.CapSet) *testIMAP {
	t.Helper()
	memServer := imapmemserver.New()
	user := imapmemserver.NewUser(testMailUser, testMailPassword)
	for _, name := range []string{"INBOX", "Sent", "Drafts", "Trash", "Junk", "Projects"} {
		if err := user.Create(name, nil); err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}
	memServer.AddUser(user)

	if caps == nil {
		caps = imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapIMAP4rev2: {}}
	}
	server := imapserver.New(&imapserver.Options{
		NewSession: func(conn *imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return memServer.NewSession(), nil, nil
		},
		InsecureAuth: true,
		Caps:         caps,
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })

	address := listener.Addr().(*net.TCPAddr)
	return &testIMAP{host: "127.0.0.1", port: address.Port, user: user}
}

// appendRaw stores a message straight into a mailbox of the test server.
func (s *testIMAP) appendRaw(t *testing.T, mailbox string, raw string, flags ...imap.Flag) {
	t.Helper()
	s.appendRawAt(t, mailbox, raw, time.Time{}, flags...)
}

// appendRawAt sets the arrival time (INTERNALDATE has one second precision).
func (s *testIMAP) appendRawAt(t *testing.T, mailbox string, raw string, arrival time.Time, flags ...imap.Flag) {
	t.Helper()
	data := []byte(strings.ReplaceAll(raw, "\n", "\r\n"))
	options := &imap.AppendOptions{Flags: flags, Time: arrival}
	if _, err := s.user.Append(mailbox, &literalReader{Reader: bytes.NewReader(data), size: int64(len(data))}, options); err != nil {
		t.Fatalf("append: %v", err)
	}
}

type literalReader struct {
	io.Reader
	size int64
}

func (r *literalReader) Size() int64 { return r.size }

// testSMTP is a minimal SMTP submission server that records messages.
type testSMTP struct {
	host     string
	port     int
	mutex    sync.Mutex
	messages []receivedMail
}

type receivedMail struct {
	from string
	to   []string
	data []byte
}

func (s *testSMTP) received() []receivedMail {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]receivedMail{}, s.messages...)
}

type smtpSession struct {
	server *testSMTP
	authed bool
	from   string
	to     []string
}

func (s *smtpSession) AuthMechanisms() []string { return []string{sasl.Plain} }

func (s *smtpSession) Auth(mech string) (sasl.Server, error) {
	return sasl.NewPlainServer(func(identity, username, password string) error {
		if username != testMailUser || password != testMailPassword {
			return errors.New("invalid credentials")
		}
		s.authed = true
		return nil
	}), nil
}

func (s *smtpSession) Mail(from string, opts *smtp.MailOptions) error {
	if !s.authed {
		return &smtp.SMTPError{Code: 530, Message: "authentication required"}
	}
	s.from = from
	return nil
}

func (s *smtpSession) Rcpt(to string, opts *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

func (s *smtpSession) Data(r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.server.mutex.Lock()
	s.server.messages = append(s.server.messages, receivedMail{from: s.from, to: s.to, data: data})
	s.server.mutex.Unlock()
	return nil
}

func (s *smtpSession) Reset()        { s.from = ""; s.to = nil }
func (s *smtpSession) Logout() error { return nil }

func startSMTPServer(t *testing.T) *testSMTP {
	t.Helper()
	fake := &testSMTP{}
	server := smtp.NewServer(smtp.BackendFunc(func(c *smtp.Conn) (smtp.Session, error) {
		return &smtpSession{server: fake}, nil
	}))
	server.Domain = "localhost"
	server.AllowInsecureAuth = true
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	fake.host = "127.0.0.1"
	fake.port = listener.Addr().(*net.TCPAddr).Port
	return fake
}

// testAccountInput describes an account on the test servers.
func testAccountInput(imapServer *testIMAP, smtpServer *testSMTP, password string) AccountInput {
	return AccountInput{
		Email:       testMailUser,
		DisplayName: "Alice",
		Provider:    "custom",
		IMAP:        ServerConfig{Host: imapServer.host, Port: imapServer.port, Security: SecurityNone, Username: testMailUser},
		SMTP:        ServerConfig{Host: smtpServer.host, Port: smtpServer.port, Security: SecurityNone, Username: testMailUser},
		Auth:        AuthPassword,
		Password:    password,
		SaveSent:    "always",
	}
}

// addTestAccount wires a manager to fresh test servers.
func addTestAccount(t *testing.T, manager *Manager) (*AccountInfo, *testIMAP, *testSMTP) {
	t.Helper()
	imapServer := startIMAPServer(t, nil)
	smtpServer := startSMTPServer(t)
	info, result, err := manager.AddAccount(testContext(t), testAdmin, testAccountInput(imapServer, smtpServer, testMailPassword))
	if err != nil {
		t.Fatalf("AddAccount: %v (%+v)", err, result)
	}
	return info, imapServer, smtpServer
}

func sampleMessage(subject string, from string, body string) string {
	return "From: " + from + "\n" +
		"To: Alice <" + testMailUser + ">\n" +
		"Subject: " + subject + "\n" +
		"Date: Mon, 02 Mar 2026 10:00:00 +0000\n" +
		"Message-ID: <" + strings.ReplaceAll(strings.ToLower(subject), " ", "-") + "@example.test>\n" +
		"Content-Type: text/plain; charset=utf-8\n\n" +
		body + "\n"
}

func itoa(n int) string { return strconv.Itoa(n) }

// testContext bounds a test's network calls.
func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}
