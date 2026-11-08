package auth

import (
	"bytes"
	"crypto/rc4"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex: %v", err)
	}
	return b
}

// The values of [MS-NLMP] 4.2.1 and 4.2.4.
func TestNLMPVectors(t *testing.T) {
	if got := hex.EncodeToString(NTHash("Password")); got != "a4f49c406510bdcab6824ee7c30fd852" {
		t.Errorf("NT hash = %s", got)
	}

	key := ntowfv2(NTHash("Password"), "User", "Domain")
	if got := hex.EncodeToString(key); got != "0c868a403bfd7a93a3001ef22ef02e3f" {
		t.Errorf("NTOWFv2 = %s", got)
	}

	challenge := unhex(t, "0123456789abcdef")
	blob := unhex(t, "01010000000000000000000000000000aaaaaaaaaaaaaaaa00000000"+
		"02000c0044006f006d00610069006e00"+"01000c00530065007200760065007200"+"0000000000000000")
	proof := hmacMD5(key, challenge, blob)
	if got := hex.EncodeToString(proof); got != "68cd0ab851e51c96aabc927bebef6a1c" {
		t.Errorf("NTProofStr = %s", got)
	}
	if got := hex.EncodeToString(hmacMD5(key, proof)); got != "8de40ccadbc14a82f15cb0ad0de95ca3" {
		t.Errorf("session base key = %s", got)
	}
}

// client plays the part of a real NTLMv2 client against an Exchange.
type client struct {
	user, domain, password string
	useKeyExchange         bool
	sendMIC                bool
	exported               []byte
}

func (c *client) negotiate() []byte {
	flags := flagUnicode | flagNTLM | flagSign | flagExtendedSession | flag128 | flag56
	if c.useKeyExchange {
		flags |= flagKeyExchange
	}
	w := wire.NewWriter(32)
	w.Bytes(ntlmSignature)
	w.U32(1)
	w.U32(flags)
	w.Zero(16)
	return w.B
}

func secBuf(w *wire.Writer, value []byte, offset int) {
	w.U16(uint16(len(value)))
	w.U16(uint16(len(value)))
	w.U32(uint32(offset))
}

func (c *client) authenticate(t *testing.T, negotiate, challengeMsg []byte) []byte {
	t.Helper()
	serverChallenge := challengeMsg[24:32]
	infoLen := int(binary.LittleEndian.Uint16(challengeMsg[40:]))
	infoOff := int(binary.LittleEndian.Uint32(challengeMsg[44:]))
	info := challengeMsg[infoOff : infoOff+infoLen]

	//Rebuild the AV list with the "I sent a MIC" flag before the terminator
	pairs := append([]byte{}, info[:len(info)-4]...)
	if c.sendMIC {
		flag := make([]byte, 8)
		binary.LittleEndian.PutUint16(flag[0:], avFlags)
		binary.LittleEndian.PutUint16(flag[2:], 4)
		binary.LittleEndian.PutUint32(flag[4:], avFlagMICFound)
		pairs = append(pairs, flag...)
	}
	pairs = append(pairs, 0, 0, 0, 0)

	blob := wire.NewWriter(64 + len(pairs))
	blob.Bytes([]byte{1, 1, 0, 0, 0, 0, 0, 0})
	blob.U64(wire.Filetime(time.Now()))
	blob.Bytes([]byte{1, 2, 3, 4, 5, 6, 7, 8})
	blob.Zero(4)
	blob.Bytes(pairs)

	key := ntowfv2(NTHash(c.password), c.user, c.domain)
	proof := hmacMD5(key, serverChallenge, blob.B)
	response := append(append([]byte{}, proof...), blob.B...)
	base := hmacMD5(key, proof)

	var encrypted []byte
	c.exported = base
	if c.useKeyExchange {
		c.exported = bytes.Repeat([]byte{0x5a}, 16)
		cipher, _ := rc4.NewCipher(base)
		encrypted = make([]byte, 16)
		cipher.XORKeyStream(encrypted, c.exported)
	}

	domain := wire.EncodeUTF16(c.domain)
	user := wire.EncodeUTF16(c.user)
	const fixed = 88
	lmOff := fixed
	ntOff := lmOff
	domOff := ntOff + len(response)
	userOff := domOff + len(domain)
	wsOff := userOff + len(user)
	keyOff := wsOff

	w := wire.NewWriter(fixed + len(response) + 64)
	w.Bytes(ntlmSignature)
	w.U32(3)
	secBuf(w, nil, lmOff)
	secBuf(w, response, ntOff)
	secBuf(w, domain, domOff)
	secBuf(w, user, userOff)
	secBuf(w, nil, wsOff)
	secBuf(w, encrypted, keyOff)
	w.U32(binary.LittleEndian.Uint32(challengeMsg[20:]))
	w.Zero(8)  //Version
	w.Zero(16) //MIC
	w.Bytes(response)
	w.Bytes(domain)
	w.Bytes(user)
	w.Bytes(encrypted)

	if c.sendMIC {
		copy(w.B[72:], hmacMD5(c.exported, negotiate, challengeMsg, w.B))
	}
	return w.B
}

func lookupFor(password string) HashLookup {
	return func(username string) (string, []byte, bool) {
		if strings.EqualFold(username, "alice") {
			return "alice", NTHash(password), true
		}
		return "", nil, false
	}
}

var testIdentity = Identity{NetbiosName: "AROZ", NetbiosDom: "WORKGROUP", DNSName: "aroz.local", DNSDomain: "local"}

func runLogin(t *testing.T, c *client, serverPassword string) (*Exchange, error) {
	t.Helper()
	e, err := NewExchange(testIdentity, lookupFor(serverPassword))
	if err != nil {
		t.Fatal(err)
	}
	negotiate := c.negotiate()
	challenge, done, err := e.Step(negotiate)
	if err != nil || done {
		t.Fatalf("negotiate: done=%v err=%v", done, err)
	}
	_, done, err = e.Step(c.authenticate(t, negotiate, challenge))
	if err == nil && !done {
		t.Fatal("a verified login must complete")
	}
	return e, err
}

func TestLogin(t *testing.T) {
	cases := []struct {
		name   string
		client client
		server string
		wantOK bool
	}{
		{"correct password", client{user: "alice", domain: "PC", password: "pw"}, "pw", true},
		{"other case", client{user: "ALICE", domain: "PC", password: "pw"}, "pw", true},
		{"empty domain", client{user: "alice", password: "pw"}, "pw", true},
		{"key exchange", client{user: "alice", domain: "PC", password: "pw", useKeyExchange: true}, "pw", true},
		{"with MIC", client{user: "alice", domain: "PC", password: "pw", useKeyExchange: true, sendMIC: true}, "pw", true},
		{"wrong password", client{user: "alice", domain: "PC", password: "nope"}, "pw", false},
		{"unknown user", client{user: "mallory", domain: "PC", password: "pw"}, "pw", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cl := c.client
			e, err := runLogin(t, &cl, c.server)
			if c.wantOK {
				if err != nil {
					t.Fatalf("login: %v", err)
				}
				if e.Username() != "alice" {
					t.Errorf("username = %q, want the account's spelling", e.Username())
				}
				if !bytes.Equal(e.SessionKey(), cl.exported) {
					t.Errorf("session keys differ")
				}
				return
			}
			if err != ErrLogonFailure {
				t.Errorf("err = %v, want logon failure", err)
			}
		})
	}
}

func TestLoginRefusesWeakResponses(t *testing.T) {
	e, _ := NewExchange(testIdentity, lookupFor("pw"))
	c := &client{user: "alice", domain: "PC", password: "pw"}
	negotiate := c.negotiate()
	challenge, _, err := e.Step(negotiate)
	if err != nil {
		t.Fatal(err)
	}
	msg := c.authenticate(t, negotiate, challenge)

	//Cut the response to the 24 bytes of NTLMv1
	binary.LittleEndian.PutUint16(msg[20:], 24)
	if _, _, err := e.Step(msg); err != ErrLogonFailure {
		t.Errorf("NTLMv1 sized response: err = %v", err)
	}
	//And remove it altogether, which is an anonymous login
	binary.LittleEndian.PutUint16(msg[20:], 0)
	if _, _, err := e.Step(msg); err != ErrLogonFailure {
		t.Errorf("empty response: err = %v", err)
	}
}

func TestChangedMICIsRefused(t *testing.T) {
	e, _ := NewExchange(testIdentity, lookupFor("pw"))
	c := &client{user: "alice", domain: "PC", password: "pw", useKeyExchange: true, sendMIC: true}
	negotiate := c.negotiate()
	challenge, _, _ := e.Step(negotiate)
	msg := c.authenticate(t, negotiate, challenge)
	msg[72] ^= 1
	if _, _, err := e.Step(msg); err != ErrLogonFailure {
		t.Errorf("err = %v", err)
	}
}

func TestSPNEGOFraming(t *testing.T) {
	c := &client{user: "alice", domain: "PC", password: "pw", useKeyExchange: true, sendMIC: true}
	negotiate := c.negotiate()

	mechList := tlv(tagSequence, tlv(tagOID, oidNTLM))
	init := tlv(tagGSS, tlv(tagOID, oidSPNEGO), tlv(tagInit, tlv(tagSequence,
		tlv(0xa0, mechList), tlv(0xa2, tlv(tagOctets, negotiate)))))

	e, _ := NewExchange(testIdentity, lookupFor("pw"))
	reply, done, err := e.Step(init)
	if err != nil || done {
		t.Fatalf("init: done=%v err=%v", done, err)
	}
	parsed, _, err := parseToken(reply)
	if err != nil || messageType(parsed.ntlm) != 2 {
		t.Fatalf("reply carries no challenge: %v", err)
	}

	auth := c.authenticate(t, negotiate, parsed.ntlm)

	//The client's mechListMIC, computed as Windows does
	probe := &ntlm{sessionKey: c.exported, flags: flagKeyExchange}
	if err := probe.deriveSigningKeys(); err != nil {
		t.Fatal(err)
	}
	mic := mac(probe.clientSign, probe.clientSeal, true, 0, mechList)

	resp := tlv(tagResp, tlv(tagSequence, tlv(0xa2, tlv(tagOctets, auth)), tlv(0xa3, tlv(tagOctets, mic))))
	final, done, err := e.Step(resp)
	if err != nil || !done {
		t.Fatalf("auth: done=%v err=%v", done, err)
	}

	//And the reply must carry the server's MIC, which Windows checks
	tag, content, _, err := readTLV(final)
	if err != nil || tag != tagResp {
		t.Fatalf("final token: %v", err)
	}
	got, err := parseNegTokenResp(content)
	if err != nil {
		t.Fatal(err)
	}
	want := mac(probe.serverSign, probe.serverSeal, true, 0, mechList)
	if !bytes.Equal(got.mic, want) {
		t.Errorf("server MIC\n got %x\nwant %x", got.mic, want)
	}
}

func TestWrongMechListMICIsRefused(t *testing.T) {
	c := &client{user: "alice", domain: "PC", password: "pw", useKeyExchange: true}
	negotiate := c.negotiate()
	mechList := tlv(tagSequence, tlv(tagOID, oidNTLM))
	init := tlv(tagGSS, tlv(tagOID, oidSPNEGO), tlv(tagInit, tlv(tagSequence,
		tlv(0xa0, mechList), tlv(0xa2, tlv(tagOctets, negotiate)))))

	e, _ := NewExchange(testIdentity, lookupFor("pw"))
	reply, _, err := e.Step(init)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, _ := parseToken(reply)
	auth := c.authenticate(t, negotiate, parsed.ntlm)
	resp := tlv(tagResp, tlv(tagSequence, tlv(0xa2, tlv(tagOctets, auth)), tlv(0xa3, tlv(tagOctets, make([]byte, 16)))))
	if _, _, err := e.Step(resp); err != ErrLogonFailure {
		t.Errorf("err = %v", err)
	}
}

func TestClientOpeningWithAnotherMech(t *testing.T) {
	kerberos := []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x12, 0x01, 0x02, 0x02}
	token := func(mechs ...[]byte) []byte {
		list := [][]byte{}
		for _, m := range mechs {
			list = append(list, tlv(tagOID, m))
		}
		return tlv(tagGSS, tlv(tagOID, oidSPNEGO), tlv(tagInit, tlv(tagSequence,
			tlv(0xa0, tlv(tagSequence, list...)), tlv(0xa2, tlv(tagOctets, []byte("a kerberos ticket"))))))
	}

	e, _ := NewExchange(testIdentity, lookupFor("pw"))
	reply, done, err := e.Step(token(kerberos, oidNTLM))
	if err != nil || done || len(reply) == 0 {
		t.Fatalf("NTLM on offer: reply=%d done=%v err=%v", len(reply), done, err)
	}

	e, _ = NewExchange(testIdentity, lookupFor("pw"))
	if _, _, err := e.Step(token(kerberos)); err == nil {
		t.Error("a client without NTLM cannot log in")
	}
}

func TestNegotiateTokenParses(t *testing.T) {
	parsed, spnego, err := parseToken(NegotiateToken())
	if err != nil || !spnego {
		t.Fatalf("spnego=%v err=%v", spnego, err)
	}
	if len(parsed.mechs) != 1 || !bytes.Equal(parsed.mechs[0], oidNTLM) {
		t.Errorf("mechs = %x", parsed.mechs)
	}
}

func TestRedactAuthenticate(t *testing.T) {
	e, _ := NewExchange(testIdentity, lookupFor("pw"))
	c := &client{user: "alice", domain: "PC", password: "pw", useKeyExchange: true, sendMIC: true}
	negotiate := c.negotiate()
	challenge, _, _ := e.Step(negotiate)
	msg := c.authenticate(t, negotiate, challenge)

	frame := append(make([]byte, 40), msg...)
	RedactAuthenticate(frame)
	got := frame[40:]

	response, _ := field(got, 20)
	if !bytes.Equal(response, make([]byte, len(response))) {
		t.Error("the NT response must be blanked")
	}
	key, _ := field(got, 52)
	if !bytes.Equal(key, make([]byte, len(key))) {
		t.Error("the session key must be blanked")
	}
	if !bytes.Equal(got[72:88], make([]byte, 16)) {
		t.Error("the MIC must be blanked")
	}
	name, _ := field(got, 36)
	if string(name) != string(wire.EncodeUTF16("alice")) {
		t.Error("the user name is useful for debugging and must stay")
	}
}

// Tokens are parsed before any login, so none may panic on any input.
func FuzzStep(f *testing.F) {
	f.Add(NegotiateToken())
	c := &client{user: "alice", domain: "PC", password: "pw"}
	f.Add(c.negotiate())
	f.Fuzz(func(t *testing.T, b []byte) {
		e, err := NewExchange(testIdentity, lookupFor("pw"))
		if err != nil {
			t.Fatal(err)
		}
		e.Step(b)
		e.Step(b)
		RedactAuthenticate(append([]byte{}, b...))
	})
}
