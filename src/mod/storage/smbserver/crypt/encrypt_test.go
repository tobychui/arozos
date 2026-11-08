package crypt

import (
	"bytes"
	"crypto/aes"
	"encoding/binary"
	"encoding/hex"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// Known answers from NIST SP 800-38C appendix C and RFC 3610 section 8.
func TestCCMVectors(t *testing.T) {
	cases := []struct {
		name                  string
		key, nonce, aad, text string
		tagLen                int
		want                  string
	}{
		{"SP800-38C C.1", "404142434445464748494a4b4c4d4e4f", "10111213141516", "0001020304050607", "20212223", 4, "7162015b4dac255d"},
		{"SP800-38C C.2", "404142434445464748494a4b4c4d4e4f", "1011121314151617", "000102030405060708090a0b0c0d0e0f", "202122232425262728292a2b2c2d2e2f", 6, "d2a1f0e051ea5f62081a7792073d593d1fc64fbfaccd"},
		{"RFC 3610 #1", "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf", "00000003020100a0a1a2a3a4a5", "0001020304050607", "08090a0b0c0d0e0f101112131415161718191a1b1c1d1e", 8, "588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0"},
	}
	for _, c := range cases {
		block, _ := aes.NewCipher(unhex(t, c.key))
		nonce := unhex(t, c.nonce)
		aead, err := NewCCM(block, len(nonce), c.tagLen)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		sealed := aead.Seal(nil, nonce, unhex(t, c.text), unhex(t, c.aad))
		if hex.EncodeToString(sealed) != c.want {
			t.Errorf("%s: sealed %x, want %s", c.name, sealed, c.want)
			continue
		}
		plain, err := aead.Open(nil, nonce, sealed, unhex(t, c.aad))
		if err != nil || !bytes.Equal(plain, unhex(t, c.text)) {
			t.Errorf("%s: open gave %x, %v", c.name, plain, err)
		}
		sealed[0] ^= 1
		if _, err := aead.Open(nil, nonce, sealed, unhex(t, c.aad)); err == nil {
			t.Errorf("%s: a changed byte must not decrypt", c.name)
		}
	}
}

func TestCCMLengths(t *testing.T) {
	block, _ := aes.NewCipher(make([]byte, 16))
	aead, _ := NewCCM(block, 11, 16)
	nonce := make([]byte, 11)
	aad := bytes.Repeat([]byte{7}, 32)
	for _, n := range []int{0, 1, 15, 16, 17, 64 << 10, 1<<20 + 3} {
		text := bytes.Repeat([]byte{byte(n)}, n)
		sealed := aead.Seal(nil, nonce, text, aad)
		if len(sealed) != n+16 {
			t.Errorf("%d bytes sealed to %d", n, len(sealed))
		}
		got, err := aead.Open(nil, nonce, sealed, aad)
		if err != nil || !bytes.Equal(got, text) {
			t.Errorf("%d bytes: %v", n, err)
		}
	}
	if _, err := NewCCM(block, 6, 16); err == nil {
		t.Error("a 6 byte nonce must be refused")
	}
	if _, err := NewCCM(block, 11, 5); err == nil {
		t.Error("an odd tag length must be refused")
	}
}

func TestKDFBitsMatchesKDF(t *testing.T) {
	key := bytes.Repeat([]byte{1}, 16)
	if !bytes.Equal(KDFBits(key, []byte("L\x00"), []byte("C\x00"), 128), KDF(key, []byte("L\x00"), []byte("C\x00"))) {
		t.Error("128 bits must equal KDF")
	}
	if got := KDFBits(key, []byte("L\x00"), []byte("C\x00"), 256); len(got) != 32 {
		t.Errorf("256 bits gave %d bytes", len(got))
	}
}

func TestEncryptionKeysDiffer(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 16)
	var preauth [64]byte
	for _, tc := range []struct {
		dialect, cipher uint16
		size            int
	}{
		{wire.Dialect300, CipherAES128CCM, 16},
		{wire.Dialect311, CipherAES128GCM, 16},
		{wire.Dialect311, CipherAES256GCM, 32},
	} {
		out, in := EncryptionKeys(tc.dialect, tc.cipher, key, preauth)
		if len(out) != tc.size || len(in) != tc.size || bytes.Equal(out, in) {
			t.Errorf("%x %x: keys %x %x", tc.dialect, tc.cipher, out, in)
		}
	}
	//3.1.1 keys depend on the preauth hash, 3.0 keys do not
	preauth[0] = 1
	a, _ := EncryptionKeys(wire.Dialect311, CipherAES128GCM, key, [64]byte{})
	b, _ := EncryptionKeys(wire.Dialect311, CipherAES128GCM, key, preauth)
	if bytes.Equal(a, b) {
		t.Error("3.1.1 keys must bind the preauth hash")
	}
}

func TestTransformRoundTrip(t *testing.T) {
	for _, id := range []uint16{CipherAES128CCM, CipherAES128GCM, CipherAES256CCM, CipherAES256GCM} {
		key := bytes.Repeat([]byte{3}, keyBits(id)/8)
		sender, _ := NewCipher(id, key)
		receiver, _ := NewCipher(id, key)
		plain := bytes.Repeat([]byte("SMB2 message "), 100)
		msg := sender.Seal(0x1122334455667788, plain)

		if !bytes.Equal(msg[:4], TransformMagic) || binary.LittleEndian.Uint32(msg[36:]) != uint32(len(plain)) {
			t.Fatalf("cipher %d: bad transform header", id)
		}
		if sid, ok := TransformSession(msg); !ok || sid != 0x1122334455667788 {
			t.Errorf("cipher %d: session %x", id, sid)
		}
		got, err := receiver.Open(msg)
		if err != nil || !bytes.Equal(got, plain) {
			t.Fatalf("cipher %d: %v", id, err)
		}

		//The header is authenticated as well as the body
		bad := append([]byte{}, msg...)
		bad[44] ^= 1
		if _, err := receiver.Open(bad); err == nil {
			t.Errorf("cipher %d: a changed session id must not decrypt", id)
		}
		bad = append([]byte{}, msg...)
		bad[len(bad)-1] ^= 1
		if _, err := receiver.Open(bad); err == nil {
			t.Errorf("cipher %d: a changed body must not decrypt", id)
		}

		//Every message gets its own nonce
		again := sender.Seal(1, plain)
		if bytes.Equal(msg[20:36], again[20:36]) {
			t.Errorf("cipher %d: a nonce was used twice", id)
		}
	}
	if _, err := NewCipher(CipherAES256GCM, make([]byte, 16)); err == nil {
		t.Error("a 128 bit key must not make an AES-256 cipher")
	}
}
