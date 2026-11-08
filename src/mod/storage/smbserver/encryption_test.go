package smbserver

import (
	"bytes"
	"crypto/rand"
	"io"
	"net"
	"sync"
	"testing"

	"github.com/hirochachacha/go-smb2"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// wireTap counts what the server sends: plain SMB2 or transforms.
type wireTap struct {
	net.Conn
	mu            sync.Mutex
	buf           []byte
	plain, sealed int
}

func (w *wireTap) Read(p []byte) (int, error) {
	n, err := w.Conn.Read(p)
	w.mu.Lock()
	w.buf = append(w.buf, p[:n]...)
	for len(w.buf) >= 8 {
		size := int(w.buf[1])<<16 | int(w.buf[2])<<8 | int(w.buf[3])
		if len(w.buf) < 4+size {
			break
		}
		if w.buf[4] == 0xFD {
			w.sealed++
		} else {
			w.plain++
		}
		w.buf = w.buf[4+size:]
	}
	w.mu.Unlock()
	return n, err
}

func (w *wireTap) counts() (int, int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.plain, w.sealed
}

func requireEncryption(c *Config) { c.RequireEncryption = true }

func dialTapped(t *testing.T, h *harness, dialect uint16) (*smb2.Session, *wireTap, error) {
	t.Helper()
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	tap := &wireTap{Conn: nc}
	d := &smb2.Dialer{
		Negotiator: smb2.Negotiator{SpecifiedDialect: dialect},
		Initiator:  &smb2.NTLMInitiator{User: testUserName, Password: testPassword},
	}
	s, err := d.Dial(tap)
	if err != nil {
		nc.Close()
		return nil, tap, err
	}
	t.Cleanup(func() { s.Logoff() })
	return s, tap, nil
}

func TestEncryptedSessions(t *testing.T) {
	for _, tc := range []struct {
		name    string
		dialect uint16
	}{
		{"3.1.1 AES-128-GCM", wire.Dialect311},
		{"3.0.2 AES-128-CCM", wire.Dialect302},
		{"3.0 AES-128-CCM", wire.Dialect300},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t, requireEncryption, noPoll)
			s, tap, err := dialTapped(t, h, tc.dialect)
			if err != nil {
				t.Fatalf("login: %v", err)
			}
			_, sealedAtLogin := tap.counts()
			fs, err := s.Mount("data")
			if err != nil {
				t.Fatalf("mount: %v", err)
			}
			defer fs.Umount()

			data := make([]byte, 3<<20+77)
			rand.Read(data)
			if err := fs.WriteFile("secret.bin", data, 0644); err != nil {
				t.Fatalf("write: %v", err)
			}
			f, err := fs.Open("secret.bin")
			if err != nil {
				t.Fatal(err)
			}
			got, err := io.ReadAll(f)
			f.Close()
			if err != nil || !bytes.Equal(got, data) {
				t.Fatalf("read back %d bytes: %v", len(got), err)
			}
			if _, err := fs.ReadDir(""); err != nil {
				t.Errorf("list: %v", err)
			}

			plain, sealed := tap.counts()
			if sealedAtLogin != 0 {
				t.Errorf("%d messages were sealed before the login finished", sealedAtLogin)
			}
			//Negotiate and the two session setup replies are the only plain ones
			if plain > 3 || sealed < 5 {
				t.Errorf("plain %d, sealed %d: everything after the login must be encrypted", plain, sealed)
			}
		})
	}
}

func TestEncryptionRefusesSMB21(t *testing.T) {
	h := newHarness(t, requireEncryption, noPoll)
	if _, _, err := dialTapped(t, h, wire.Dialect210); err == nil {
		t.Error("SMB 2.1 cannot encrypt, so the login must fail")
	}
	h.backend.mu.Lock()
	defer h.backend.mu.Unlock()
	for _, l := range h.backend.logs {
		if l == "fail:"+testUserName {
			t.Error("a client that cannot encrypt did not get the password wrong")
		}
	}
}

func TestEncryptionIsOptionalUnlessRequired(t *testing.T) {
	h := newHarness(t, noPoll)
	s, tap, err := dialTapped(t, h, wire.Dialect311)
	if err != nil {
		t.Fatal(err)
	}
	fs, err := s.Mount("data")
	if err != nil {
		t.Fatal(err)
	}
	fs.WriteFile("a.txt", []byte("x"), 0644)
	fs.Umount()
	if _, sealed := tap.counts(); sealed != 0 {
		t.Errorf("%d messages sealed on a session that did not ask for it", sealed)
	}
}

func TestPlainRequestsOnAnEncryptedSessionAreRefused(t *testing.T) {
	h := newHarness(t, noPoll)
	c := newRawClient(t, h)
	//The raw client never encrypts; turning the rule on for its session
	//stands in for a client that stopped encrypting
	h.srv.mu.Lock()
	for conn := range h.srv.conns {
		conn.mu.Lock()
		for _, sess := range conn.sessions {
			sess.mu.Lock()
			sess.encrypt = true
			sess.mu.Unlock()
		}
		conn.mu.Unlock()
	}
	h.srv.mu.Unlock()
	if _, st := c.create("x.txt", openRW); st != wire.StatusAccessDenied {
		t.Errorf("status %x", st)
	}
}
