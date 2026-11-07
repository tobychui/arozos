// Package crypt holds the key derivation and message signing of SMB2 and SMB3.
//
// The standard library has HMAC, AES and GCM. AES-CMAC is written here on top
// of its CBC mode, and GMAC is GCM with an empty plaintext.
package crypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/binary"
	"errors"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// KDF is the SP800-108 counter mode key derivation with HMAC-SHA256 that
// SMB3 uses, producing 128 bits.
func KDF(key, label, context []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte{0, 0, 0, 1})
	h.Write(label)
	h.Write([]byte{0})
	h.Write(context)
	h.Write([]byte{0, 0, 0, 128})
	return h.Sum(nil)[:16]
}

// PreauthHash extends a preauth integrity value with one message.
func PreauthHash(prev [64]byte, msg []byte) [64]byte {
	h := sha512.New()
	h.Write(prev[:])
	h.Write(msg)
	var out [64]byte
	copy(out[:], h.Sum(nil))
	return out
}

// CMAC computes AES-CMAC (RFC 4493).
func CMAC(block cipher.Block, msg []byte) [16]byte {
	var k1, k2, l [16]byte
	block.Encrypt(l[:], l[:])
	doubleBlock(&k1, &l)
	doubleBlock(&k2, &k1)

	full := len(msg) / 16
	lastComplete := len(msg) > 0 && len(msg)%16 == 0
	if lastComplete {
		full--
	}

	//All blocks but the last are plain CBC with a zero IV
	var iv [16]byte
	if full > 0 {
		cbc := cipher.NewCBCEncrypter(block, iv[:])
		var chunk [4096]byte
		rest := msg[:full*16]
		for len(rest) > 0 {
			n := len(rest)
			if n > len(chunk) {
				n = len(chunk)
			}
			cbc.CryptBlocks(chunk[:n], rest[:n])
			copy(iv[:], chunk[n-16:n])
			rest = rest[n:]
		}
	}

	var last [16]byte
	tail := msg[full*16:]
	if lastComplete {
		copy(last[:], tail)
		xorBlock(&last, &k1)
	} else {
		copy(last[:], tail)
		last[len(tail)] = 0x80
		xorBlock(&last, &k2)
	}
	xorBlock(&last, &iv)
	block.Encrypt(last[:], last[:])
	return last
}

func doubleBlock(dst, src *[16]byte) {
	carry := src[0] >> 7
	for i := 0; i < 15; i++ {
		dst[i] = src[i]<<1 | src[i+1]>>7
	}
	dst[15] = src[15] << 1
	if carry != 0 {
		dst[15] ^= 0x87
	}
}

func xorBlock(dst, src *[16]byte) {
	for i := range dst {
		dst[i] ^= src[i]
	}
}

// Signer signs and checks messages of one session.
type Signer struct {
	algorithm uint16
	key       []byte
	block     cipher.Block
	gcm       cipher.AEAD
}

// NewSigner builds a signer for one of the wire.Signing algorithms.
func NewSigner(algorithm uint16, key []byte) (*Signer, error) {
	s := &Signer{algorithm: algorithm, key: key}
	switch algorithm {
	case wire.SigningHMACSHA256:
		return s, nil
	case wire.SigningAESCMAC, wire.SigningAESGMAC:
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		s.block = block
		if algorithm == wire.SigningAESGMAC {
			if s.gcm, err = cipher.NewGCM(block); err != nil {
				return nil, err
			}
		}
		return s, nil
	}
	return nil, errors.New("smbserver: unknown signing algorithm")
}

// compute returns the signature of msg, whose signature field must be zero.
func (s *Signer) compute(msg []byte) [16]byte {
	var out [16]byte
	switch s.algorithm {
	case wire.SigningHMACSHA256:
		h := hmac.New(sha256.New, s.key)
		h.Write(msg)
		copy(out[:], h.Sum(nil))
	case wire.SigningAESCMAC:
		out = CMAC(s.block, msg)
	case wire.SigningAESGMAC:
		//The nonce is the message id, then a bit for the direction and a bit
		//for CANCEL, so a signature cannot be replayed across either.
		var nonce [12]byte
		copy(nonce[:8], msg[24:32])
		var role uint32
		if binary.LittleEndian.Uint32(msg[16:])&wire.FlagResponse != 0 {
			role |= 1
		}
		if binary.LittleEndian.Uint16(msg[12:]) == wire.CmdCancel {
			role |= 2
		}
		binary.LittleEndian.PutUint32(nonce[8:], role)
		copy(out[:], s.gcm.Seal(nil, nonce[:], nil, msg))
	}
	return out
}

// Sign fills in the signature of msg and sets its signed flag.
func (s *Signer) Sign(msg []byte) {
	flags := binary.LittleEndian.Uint32(msg[16:])
	binary.LittleEndian.PutUint32(msg[16:], flags|wire.FlagSigned)
	sig := msg[wire.SignatureAt : wire.SignatureAt+wire.SignatureSz]
	clear(sig)
	out := s.compute(msg)
	copy(sig, out[:])
}

// Verify checks the signature of msg. The signature field is restored
// afterwards, because msg may still be recorded by the capture.
func (s *Signer) Verify(msg []byte) bool {
	if len(msg) < wire.HeaderSize {
		return false
	}
	sig := msg[wire.SignatureAt : wire.SignatureAt+wire.SignatureSz]
	var got [16]byte
	copy(got[:], sig)
	clear(sig)
	want := s.compute(msg)
	copy(sig, got[:])
	return subtle.ConstantTimeCompare(got[:], want[:]) == 1
}

// SigningKey derives the signing key of a session from its session key.
func SigningKey(dialect uint16, sessionKey []byte, preauth [64]byte) []byte {
	switch {
	case dialect >= wire.Dialect311:
		return KDF(sessionKey, []byte("SMBSigningKey\x00"), preauth[:])
	case dialect >= wire.Dialect300:
		return KDF(sessionKey, []byte("SMB2AESCMAC\x00"), []byte("SmbSign\x00"))
	}
	return sessionKey
}
