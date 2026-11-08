package crypt

import (
	"crypto/aes"
	"encoding/hex"
	"testing"

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

// The vectors of RFC 4493 section 4.
func TestCMACVectors(t *testing.T) {
	key := unhex(t, "2b7e151628aed2a6abf7158809cf4f3c")
	msg := unhex(t, "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710")
	cases := []struct {
		n    int
		want string
	}{
		{0, "bb1d6929e95937287fa37d129b756746"},
		{16, "070a16b46b4d4144f79bdd9dd04a287c"},
		{40, "dfa66747de9ae63030ca32611497c827"},
		{64, "51f0bebf7e3b9d92fc49741779363cfe"},
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		got := CMAC(block, msg[:c.n])
		if hex.EncodeToString(got[:]) != c.want {
			t.Errorf("length %d: got %x want %s", c.n, got, c.want)
		}
	}
}

// A long message takes the chunked CBC path, and must agree with the plain
// block by block definition.
func TestCMACLongMessage(t *testing.T) {
	block, _ := aes.NewCipher(make([]byte, 16))
	msg := make([]byte, 20000)
	for i := range msg {
		msg[i] = byte(i * 7)
	}

	var k1, k2, l, x [16]byte
	block.Encrypt(l[:], l[:])
	doubleBlock(&k1, &l)
	doubleBlock(&k2, &k1)
	n := len(msg) / 16
	for i := 0; i < n-1; i++ {
		for j := 0; j < 16; j++ {
			x[j] ^= msg[i*16+j]
		}
		block.Encrypt(x[:], x[:])
	}
	for j := 0; j < 16; j++ {
		x[j] ^= msg[(n-1)*16+j] ^ k1[j]
	}
	block.Encrypt(x[:], x[:])

	if got := CMAC(block, msg); got != x {
		t.Errorf("chunked path disagrees\n got %x\nwant %x", got, x)
	}
}

func message(id uint64, flags uint32, cmd uint16) []byte {
	m := make([]byte, wire.HeaderSize+40)
	h := wire.Header{MessageID: id, Flags: flags, Command: cmd}
	h.Put(m)
	return m
}

func TestSignAndVerify(t *testing.T) {
	key := make([]byte, 16)
	for i := range key {
		key[i] = byte(i)
	}
	for _, alg := range []uint16{wire.SigningHMACSHA256, wire.SigningAESCMAC, wire.SigningAESGMAC} {
		s, err := NewSigner(alg, key)
		if err != nil {
			t.Fatalf("algorithm %d: %v", alg, err)
		}
		m := message(5, wire.FlagResponse, wire.CmdRead)
		s.Sign(m)
		if !s.Verify(m) {
			t.Errorf("algorithm %d: its own signature failed", alg)
		}
		m[wire.HeaderSize+3] ^= 1
		if s.Verify(m) {
			t.Errorf("algorithm %d: a changed body passed", alg)
		}
	}
}

func TestVerifyKeepsTheSignature(t *testing.T) {
	s, _ := NewSigner(wire.SigningAESCMAC, make([]byte, 16))
	m := message(1, 0, wire.CmdEcho)
	s.Sign(m)
	before := append([]byte{}, m...)
	s.Verify(m)
	if string(before) != string(m) {
		t.Error("Verify must leave the message as it found it")
	}
}

// GMAC binds direction and CANCEL into the nonce, so a signature taken from
// one direction must not verify in the other.
func TestGMACNonceBindsDirectionAndCancel(t *testing.T) {
	s, _ := NewSigner(wire.SigningAESGMAC, make([]byte, 16))

	request := message(9, 0, wire.CmdEcho)
	s.Sign(request)
	sigRequest := append([]byte{}, request[wire.SignatureAt:wire.SignatureAt+16]...)

	cancel := message(9, 0, wire.CmdCancel)
	s.Sign(cancel)
	if string(sigRequest) == string(cancel[wire.SignatureAt:wire.SignatureAt+16]) {
		t.Error("cancel must change the signature")
	}
}

func TestSigningKeyByDialect(t *testing.T) {
	session := make([]byte, 16)
	var preauth [64]byte

	if got := SigningKey(wire.Dialect210, session, preauth); string(got) != string(session) {
		t.Error("SMB 2.x signs with the session key itself")
	}
	k30 := SigningKey(wire.Dialect300, session, preauth)
	k302 := SigningKey(wire.Dialect302, session, preauth)
	if string(k30) != string(k302) {
		t.Error("3.0 and 3.0.2 share a derivation")
	}
	k311 := SigningKey(wire.Dialect311, session, preauth)
	if string(k311) == string(k30) {
		t.Error("3.1.1 derives from the preauth hash")
	}
	preauth[0] = 1
	if string(k311) == string(SigningKey(wire.Dialect311, session, preauth)) {
		t.Error("the 3.1.1 key must change with the preauth hash")
	}
}

func TestPreauthHashChains(t *testing.T) {
	var zero [64]byte
	a := PreauthHash(zero, []byte("one"))
	b := PreauthHash(a, []byte("two"))
	if a == b || a == zero {
		t.Error("each message must change the value")
	}
	if a != PreauthHash(zero, []byte("one")) {
		t.Error("the hash must be repeatable")
	}
}

func BenchmarkSign1MiB(b *testing.B) {
	key := make([]byte, 16)
	msg := make([]byte, 1<<20)
	h := wire.Header{}
	h.Put(msg)
	for _, c := range []struct {
		name string
		alg  uint16
	}{{"HMAC", wire.SigningHMACSHA256}, {"CMAC", wire.SigningAESCMAC}, {"GMAC", wire.SigningAESGMAC}} {
		b.Run(c.name, func(b *testing.B) {
			s, _ := NewSigner(c.alg, key)
			b.SetBytes(int64(len(msg)))
			for i := 0; i < b.N; i++ {
				s.Sign(msg)
			}
		})
	}
}
