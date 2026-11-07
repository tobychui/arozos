package smbserver

import (
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/auth"
	"imuslab.com/arozos/mod/storage/smbserver/crypt"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	rawClient speaks the protocol byte by byte, for what go-smb2 has no call
	for: compounds, share modes, locks, pending requests and cancels. It is
	only used where the behaviour under test is the server's answer to an
	exact sequence, and it never checks its own encoding against itself.
*/

type rawClient struct {
	t       *testing.T
	nc      net.Conn
	mid     uint64
	session uint64
	tree    uint32
	signer  *crypt.Signer
	preauth [64]byte
}

type rawReply struct {
	hdr  wire.Header
	body []byte
	raw  []byte
}

func (c *rawClient) writeFrame(msg []byte) {
	c.t.Helper()
	f := make([]byte, 4+len(msg))
	f[1], f[2], f[3] = byte(len(msg)>>16), byte(len(msg)>>8), byte(len(msg))
	copy(f[4:], msg)
	if _, err := c.nc.Write(f); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

func (c *rawClient) readFrame() []byte {
	c.t.Helper()
	c.nc.SetReadDeadline(time.Now().Add(5 * time.Second))
	head := make([]byte, 4)
	if _, err := io.ReadFull(c.nc, head); err != nil {
		c.t.Fatalf("read: %v", err)
	}
	f := make([]byte, int(head[1])<<16|int(head[2])<<8|int(head[3]))
	if _, err := io.ReadFull(c.nc, f); err != nil {
		c.t.Fatalf("read: %v", err)
	}
	return f
}

// parseReplies splits a frame into its compound parts.
func parseReplies(t *testing.T, f []byte) []rawReply {
	t.Helper()
	out := []rawReply{}
	for {
		h, err := wire.ParseHeader(f)
		if err != nil {
			t.Fatalf("reply: %v", err)
		}
		end := len(f)
		if h.NextCommand != 0 {
			end = int(h.NextCommand)
		}
		out = append(out, rawReply{hdr: h, body: f[wire.HeaderSize:end], raw: f[:end]})
		if h.NextCommand == 0 {
			return out
		}
		f = f[end:]
	}
}

func (c *rawClient) message(cmd uint16, body []byte, flags uint32) []byte {
	h := wire.Header{Command: cmd, Credits: 8, CreditCharge: 1, MessageID: c.mid, SessionID: c.session, TreeID: c.tree, Flags: flags}
	c.mid++
	msg := make([]byte, wire.HeaderSize+len(body))
	h.Put(msg)
	copy(msg[wire.HeaderSize:], body)
	return msg
}

// call sends one signed request and returns its reply, skipping interim ones.
func (c *rawClient) call(cmd uint16, body []byte) rawReply {
	c.t.Helper()
	msg := c.message(cmd, body, 0)
	if c.signer != nil {
		c.signer.Sign(msg)
	}
	c.writeFrame(msg)
	for {
		r := parseReplies(c.t, c.readFrame())[0]
		if r.hdr.Status != wire.StatusPending {
			c.verify(r)
			return r
		}
	}
}

func (c *rawClient) verify(r rawReply) {
	c.t.Helper()
	if c.signer == nil || r.hdr.Status == wire.StatusPending {
		return
	}
	if r.hdr.Flags&wire.FlagSigned == 0 {
		c.t.Fatalf("command %d: reply is not signed (status %x)", r.hdr.Command, r.hdr.Status)
	}
	if !c.signer.Verify(r.raw) {
		c.t.Fatalf("command %d: reply signature is wrong", r.hdr.Command)
	}
}

func negotiateBody(dialects ...uint16) []byte {
	w := wire.NewWriter(64)
	w.U16(36)
	w.U16(uint16(len(dialects)))
	w.U16(wire.SigningEnabled)
	w.U16(0)
	w.U32(0)
	w.Zero(16)
	ctxAt := w.Len()
	w.U32(0)
	w.U16(0)
	w.U16(0)
	for _, d := range dialects {
		w.U16(d)
	}
	for _, d := range dialects {
		if d == wire.Dialect311 {
			w.Align(8)
			for (wire.HeaderSize+w.Len())%8 != 0 {
				w.U8(0)
			}
			binary.LittleEndian.PutUint32(w.B[ctxAt:], uint32(wire.HeaderSize+w.Len()))
			binary.LittleEndian.PutUint16(w.B[ctxAt+4:], 2)
			w.U16(wire.CtxPreauthIntegrity)
			w.U16(38)
			w.U32(0)
			w.U16(1)
			w.U16(32)
			w.U16(wire.HashSHA512)
			w.Zero(32)
			w.Align(8)
			w.U16(wire.CtxSigning)
			w.U16(4)
			w.U32(0)
			w.U16(1)
			w.U16(wire.SigningAESGMAC)
		}
	}
	return w.B
}

func sessionSetupRequest(token []byte) []byte {
	w := wire.NewWriter(24 + len(token))
	w.U16(25)
	w.U8(0)
	w.U8(1)
	w.U32(0)
	w.U32(0)
	w.U16(wire.HeaderSize + 24)
	w.U16(uint16(len(token)))
	w.U64(0)
	w.Bytes(token)
	return w.B
}

// newRawClient logs in at SMB 3.1.1 and connects the share.
func newRawClient(t *testing.T, h *harness) *rawClient {
	t.Helper()
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { nc.Close() })
	c := &rawClient{t: t, nc: nc}

	neg := c.message(wire.CmdNegotiate, negotiateBody(wire.Dialect210, wire.Dialect311), 0)
	c.writeFrame(neg)
	reply := c.readFrame()
	if r := parseReplies(t, reply)[0]; r.hdr.Status != 0 {
		t.Fatalf("negotiate: %x", r.hdr.Status)
	}
	c.preauth = crypt.PreauthHash(crypt.PreauthHash([64]byte{}, neg), reply)

	session, key := loginExchange(t, c)
	c.session = session
	signer, err := crypt.NewSigner(wire.SigningAESGMAC, key)
	if err != nil {
		t.Fatal(err)
	}
	c.signer = signer

	path := wire.EncodeUTF16(`\\host\data`)
	w := wire.NewWriter(8 + len(path))
	w.U16(9)
	w.U16(0)
	w.U16(wire.HeaderSize + 8)
	w.U16(uint16(len(path)))
	w.Bytes(path)
	r := c.call(wire.CmdTreeConnect, w.B)
	if r.hdr.Status != 0 {
		t.Fatalf("tree connect: %x", r.hdr.Status)
	}
	c.tree = r.hdr.TreeID
	return c
}

// loginExchange plays a full NTLMv2 login and returns the signing key, which
// also proves the preauth hash of both sides agrees.
func loginExchange(t *testing.T, c *rawClient) (uint64, []byte) {
	t.Helper()
	first := c.message(wire.CmdSessionSetup, sessionSetupRequest(auth.TestNegotiateMessage()), 0)
	c.writeFrame(first)
	raw := c.readFrame()
	r := parseReplies(t, raw)[0]
	if r.hdr.Status != wire.StatusMoreProcessingRequired {
		t.Fatalf("session setup: %x", r.hdr.Status)
	}
	session := r.hdr.SessionID
	c.preauth = crypt.PreauthHash(crypt.PreauthHash(c.preauth, first), raw)

	token := r.body[8:]
	authMsg, sessionKey := auth.TestAuthenticateMessage(testUserName, testPassword, token)

	c.session = session
	second := c.message(wire.CmdSessionSetup, sessionSetupRequest(authMsg), 0)
	c.writeFrame(second)
	c.preauth = crypt.PreauthHash(c.preauth, second)
	final := parseReplies(t, c.readFrame())[0]
	if final.hdr.Status != 0 {
		t.Fatalf("session setup: %x", final.hdr.Status)
	}
	key := crypt.SigningKey(wire.Dialect311, sessionKey, c.preauth)
	signer, _ := crypt.NewSigner(wire.SigningAESGMAC, key)
	if final.hdr.Flags&wire.FlagSigned == 0 || !signer.Verify(final.raw) {
		t.Fatal("the final SESSION_SETUP must be signed with the derived key")
	}
	return session, key
}

type createOpts struct {
	access, share, disposition, options uint32
}

func createBody(name string, o createOpts) []byte {
	encoded := wire.EncodeUTF16(name)
	w := wire.NewWriter(56 + len(encoded))
	w.U16(57)
	w.U8(0)
	w.U8(0)
	w.U32(2)
	w.Zero(16)
	w.U32(o.access)
	w.U32(0)
	w.U32(o.share)
	w.U32(o.disposition)
	w.U32(o.options)
	w.U16(wire.HeaderSize + 56)
	w.U16(uint16(len(encoded)))
	w.U32(0)
	w.U32(0)
	w.Bytes(encoded)
	if len(encoded) == 0 {
		w.U8(0)
	}
	return w.B
}

func (c *rawClient) create(name string, o createOpts) (wire.FileID, uint32) {
	c.t.Helper()
	r := c.call(wire.CmdCreate, createBody(name, o))
	var id wire.FileID
	if r.hdr.Status == 0 {
		copy(id[:], r.body[64:80])
	}
	return id, r.hdr.Status
}

func closeBody(id wire.FileID) []byte {
	w := wire.NewWriter(24)
	w.U16(24)
	w.U16(0)
	w.U32(0)
	w.Bytes(id[:])
	return w.B
}

func (c *rawClient) close(id wire.FileID) uint32 {
	c.t.Helper()
	return c.call(wire.CmdClose, closeBody(id)).hdr.Status
}

func writeBodyOf(id wire.FileID, offset uint64, data []byte) []byte {
	w := wire.NewWriter(48 + len(data))
	w.U16(49)
	w.U16(wire.HeaderSize + 48)
	w.U32(uint32(len(data)))
	w.U64(offset)
	w.Bytes(id[:])
	w.U32(0)
	w.U32(0)
	w.U16(0)
	w.U16(0)
	w.U32(0)
	w.Bytes(data)
	return w.B
}

func readBodyOf(id wire.FileID, offset uint64, length uint32) []byte {
	w := wire.NewWriter(49)
	w.U16(49)
	w.U8(0)
	w.U8(0)
	w.U32(length)
	w.U64(offset)
	w.Bytes(id[:])
	w.U32(0)
	w.U32(0)
	w.U32(0)
	w.U16(0)
	w.U16(0)
	w.U8(0)
	return w.B
}

func lockBody(id wire.FileID, offset, length uint64, flags uint32) []byte {
	w := wire.NewWriter(48)
	w.U16(48)
	w.U16(1)
	w.U32(0)
	w.Bytes(id[:])
	w.U64(offset)
	w.U64(length)
	w.U32(flags)
	w.U32(0)
	return w.B
}

func setInfoBody(id wire.FileID, class uint8, data []byte) []byte {
	w := wire.NewWriter(32 + len(data))
	w.U16(33)
	w.U8(wire.InfoFile)
	w.U8(class)
	w.U32(uint32(len(data)))
	w.U16(wire.HeaderSize + 32)
	w.U16(0)
	w.U32(0)
	w.Bytes(id[:])
	w.Bytes(data)
	return w.B
}

func queryDirBody(id wire.FileID, class uint8, flags uint8, pattern string) []byte {
	encoded := wire.EncodeUTF16(pattern)
	w := wire.NewWriter(32 + len(encoded))
	w.U16(33)
	w.U8(class)
	w.U8(flags)
	w.U32(0)
	w.Bytes(id[:])
	w.U16(wire.HeaderSize + 32)
	w.U16(uint16(len(encoded)))
	w.U32(65536)
	w.Bytes(encoded)
	return w.B
}

func notifyBody(id wire.FileID) []byte {
	w := wire.NewWriter(32)
	w.U16(32)
	w.U16(0)
	w.U32(4096)
	w.Bytes(id[:])
	w.U32(0x17)
	w.U32(0)
	return w.B
}

func queryInfoBody(id wire.FileID, infoType, class uint8, additional uint32) []byte {
	w := wire.NewWriter(40)
	w.U16(41)
	w.U8(infoType)
	w.U8(class)
	w.U32(65536)
	w.U16(0)
	w.U16(0)
	w.U32(0)
	w.U32(additional)
	w.U32(0)
	w.Bytes(id[:])
	w.U8(0)
	return w.B
}

func netDial(h *harness) (net.Conn, error) { return net.Dial("tcp", h.addr) }
