package crypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"sync"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	encrypt.go

	SMB3 encryption: the transform header, the four ciphers and their keys.
	GCM is in the standard library; CCM is not, and is written here from
	NIST SP 800-38C on top of the AES block cipher.
*/

// Ciphers of the encryption capabilities context.
const (
	CipherAES128CCM uint16 = 0x0001
	CipherAES128GCM uint16 = 0x0002
	CipherAES256CCM uint16 = 0x0003
	CipherAES256GCM uint16 = 0x0004
)

// TransformHeaderSize is the size of SMB2_TRANSFORM_HEADER.
const TransformHeaderSize = 52

// TransformMagic starts an encrypted message: 0xFD 'S' 'M' 'B'.
var TransformMagic = []byte{0xFD, 'S', 'M', 'B'}

// ErrDecrypt means a message did not decrypt: a wrong key, or tampering.
var ErrDecrypt = errors.New("crypt: the message does not decrypt")

// KDFBits is KDF with the output length L of the counter mode KDF.
func KDFBits(key, label, context []byte, bits int) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte{0, 0, 0, 1})
	h.Write(label)
	h.Write([]byte{0})
	h.Write(context)
	var l [4]byte
	binary.BigEndian.PutUint32(l[:], uint32(bits))
	h.Write(l[:])
	return h.Sum(nil)[:bits/8]
}

func keyBits(cipherID uint16) int {
	if cipherID == CipherAES256CCM || cipherID == CipherAES256GCM {
		return 256
	}
	return 128
}

// EncryptionKeys derives the keys of a session: what the server encrypts
// with, and what it decrypts with.
func EncryptionKeys(dialect, cipherID uint16, sessionKey []byte, preauth [64]byte) (serverOut, serverIn []byte) {
	bits := keyBits(cipherID)
	if dialect >= wire.Dialect311 {
		return KDFBits(sessionKey, []byte("SMBS2CCipherKey\x00"), preauth[:], bits),
			KDFBits(sessionKey, []byte("SMBC2SCipherKey\x00"), preauth[:], bits)
	}
	return KDFBits(sessionKey, []byte("SMB2AESCCM\x00"), []byte("ServerOut\x00"), bits),
		KDFBits(sessionKey, []byte("SMB2AESCCM\x00"), []byte("ServerIn \x00"), bits)
}

// Cipher seals or opens transform messages with one key.
type Cipher struct {
	aead     cipher.AEAD
	nonceLen int

	mu     sync.Mutex
	prefix [4]byte
	count  uint64
}

// NewCipher makes the cipher of a negotiated algorithm.
func NewCipher(cipherID uint16, key []byte) (*Cipher, error) {
	if len(key)*8 != keyBits(cipherID) {
		return nil, errors.New("crypt: wrong key size for the cipher")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	c := &Cipher{}
	switch cipherID {
	case CipherAES128GCM, CipherAES256GCM:
		c.aead, err = cipher.NewGCM(block)
		c.nonceLen = 12
	case CipherAES128CCM, CipherAES256CCM:
		c.aead, err = NewCCM(block, 11, 16)
		c.nonceLen = 11
	default:
		return nil, errors.New("crypt: unknown cipher")
	}
	if err != nil {
		return nil, err
	}
	rand.Read(c.prefix[:])
	return c, nil
}

// nonce is unique per message: a counter behind a random prefix. A key lives
// only as long as its session, so the counter never wraps.
func (c *Cipher) nonce() []byte {
	c.mu.Lock()
	c.count++
	n := c.count
	c.mu.Unlock()
	out := make([]byte, c.nonceLen)
	copy(out, c.prefix[:c.nonceLen-8])
	binary.BigEndian.PutUint64(out[c.nonceLen-8:], n)
	return out
}

// Seal wraps one SMB2 message, or a whole compound, in a transform header.
func (c *Cipher) Seal(sessionID uint64, plain []byte) []byte {
	out := make([]byte, TransformHeaderSize, TransformHeaderSize+len(plain)+16)
	copy(out, TransformMagic)
	nonce := c.nonce()
	copy(out[20:], nonce)
	binary.LittleEndian.PutUint32(out[36:], uint32(len(plain)))
	binary.LittleEndian.PutUint16(out[42:], 0x0001) //Encrypted
	binary.LittleEndian.PutUint64(out[44:], sessionID)

	sealed := c.aead.Seal(nil, nonce, plain, out[20:TransformHeaderSize])
	tag := sealed[len(sealed)-16:]
	copy(out[4:20], tag)
	return append(out, sealed[:len(sealed)-16]...)
}

// TransformSession reads the session id of a transform message.
func TransformSession(msg []byte) (uint64, bool) {
	if len(msg) < TransformHeaderSize || subtle.ConstantTimeCompare(msg[:4], TransformMagic) != 1 {
		return 0, false
	}
	return binary.LittleEndian.Uint64(msg[44:]), true
}

// Open checks and decrypts a transform message.
func (c *Cipher) Open(msg []byte) ([]byte, error) {
	if len(msg) < TransformHeaderSize {
		return nil, ErrDecrypt
	}
	size := binary.LittleEndian.Uint32(msg[36:])
	body := msg[TransformHeaderSize:]
	if uint64(size) != uint64(len(body)) || binary.LittleEndian.Uint16(msg[42:]) != 0x0001 {
		return nil, ErrDecrypt
	}
	nonce := msg[20 : 20+c.nonceLen]
	sealed := make([]byte, 0, len(body)+16)
	sealed = append(sealed, body...)
	sealed = append(sealed, msg[4:20]...)
	plain, err := c.aead.Open(sealed[:0], nonce, sealed, msg[20:TransformHeaderSize])
	if err != nil {
		return nil, ErrDecrypt
	}
	return plain, nil
}

// ccm is AES-CCM (NIST SP 800-38C) as a cipher.AEAD.
type ccm struct {
	block    cipher.Block
	nonceLen int
	tagLen   int
}

// NewCCM returns CCM over a 16 byte block cipher. nonceLen is 7 to 13 and
// tagLen an even number from 4 to 16.
func NewCCM(block cipher.Block, nonceLen, tagLen int) (cipher.AEAD, error) {
	if block.BlockSize() != 16 || nonceLen < 7 || nonceLen > 13 || tagLen < 4 || tagLen > 16 || tagLen%2 != 0 {
		return nil, errors.New("crypt: bad CCM parameters")
	}
	return &ccm{block: block, nonceLen: nonceLen, tagLen: tagLen}, nil
}

func (c *ccm) NonceSize() int { return c.nonceLen }
func (c *ccm) Overhead() int  { return c.tagLen }

// lengthSize is q, the bytes that hold the message length.
func (c *ccm) lengthSize() int { return 15 - c.nonceLen }

func (c *ccm) maxLength() uint64 {
	q := c.lengthSize()
	if q >= 8 {
		return ^uint64(0)
	}
	return 1<<(8*uint(q)) - 1
}

// mac is the CBC-MAC of the formatted B0, associated data and message.
func (c *ccm) mac(nonce, plain, data []byte) [16]byte {
	var b0 [16]byte
	flags := byte((c.tagLen-2)/2) << 3
	flags |= byte(c.lengthSize() - 1)
	if len(data) > 0 {
		flags |= 0x40
	}
	b0[0] = flags
	copy(b0[1:], nonce)
	n := uint64(len(plain))
	for i := 15; i > c.nonceLen; i-- {
		b0[i] = byte(n)
		n >>= 8
	}

	var x [16]byte
	c.block.Encrypt(x[:], b0[:])
	absorb := func(buf []byte) {
		for len(buf) > 0 {
			k := subtle.XORBytes(x[:], x[:], buf)
			c.block.Encrypt(x[:], x[:])
			buf = buf[k:]
		}
	}
	if len(data) > 0 {
		var head []byte
		switch {
		case uint64(len(data)) < 0xFF00:
			head = []byte{byte(len(data) >> 8), byte(len(data))}
		case uint64(len(data)) <= 0xFFFFFFFF:
			head = []byte{0xFF, 0xFE, 0, 0, 0, 0}
			binary.BigEndian.PutUint32(head[2:], uint32(len(data)))
		default:
			head = []byte{0xFF, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0}
			binary.BigEndian.PutUint64(head[2:], uint64(len(data)))
		}
		//The length and the data are one stream, padded to a block at the end
		a := append(head, data...)
		if rem := len(a) % 16; rem != 0 {
			a = append(a, make([]byte, 16-rem)...)
		}
		absorb(a)
	}
	if len(plain) > 0 {
		p := plain
		if rem := len(p) % 16; rem != 0 {
			p = append(append([]byte{}, p...), make([]byte, 16-rem)...)
		}
		absorb(p)
	}
	return x
}

// ctr encrypts with the counter blocks A1, A2, ... and returns S0 for the tag.
func (c *ccm) ctr(dst, src, nonce []byte) [16]byte {
	var a [16]byte
	a[0] = byte(c.lengthSize() - 1)
	copy(a[1:], nonce)
	var s0 [16]byte
	c.block.Encrypt(s0[:], a[:])

	var stream [16]byte
	counter := uint64(1)
	for off := 0; off < len(src); off += 16 {
		ctrBlock := a
		n := counter
		for i := 15; i > c.nonceLen; i-- {
			ctrBlock[i] = byte(n)
			n >>= 8
		}
		c.block.Encrypt(stream[:], ctrBlock[:])
		end := off + 16
		if end > len(src) {
			end = len(src)
		}
		subtle.XORBytes(dst[off:end], src[off:end], stream[:end-off])
		counter++
	}
	return s0
}

func (c *ccm) Seal(dst, nonce, plain, data []byte) []byte {
	if len(nonce) != c.nonceLen || uint64(len(plain)) > c.maxLength() {
		panic("crypt: bad CCM nonce or message length")
	}
	t := c.mac(nonce, plain, data)
	ret, out := sliceForAppend(dst, len(plain)+c.tagLen)
	s0 := c.ctr(out, plain, nonce)
	subtle.XORBytes(out[len(plain):], t[:c.tagLen], s0[:c.tagLen])
	return ret
}

func (c *ccm) Open(dst, nonce, sealed, data []byte) ([]byte, error) {
	if len(nonce) != c.nonceLen || len(sealed) < c.tagLen {
		return nil, ErrDecrypt
	}
	body := sealed[:len(sealed)-c.tagLen]
	tag := sealed[len(sealed)-c.tagLen:]
	if uint64(len(body)) > c.maxLength() {
		return nil, ErrDecrypt
	}
	plain := make([]byte, len(body))
	s0 := c.ctr(plain, body, nonce)
	t := c.mac(nonce, plain, data)
	var want [16]byte
	subtle.XORBytes(want[:c.tagLen], t[:c.tagLen], s0[:c.tagLen])
	if subtle.ConstantTimeCompare(want[:c.tagLen], tag) != 1 {
		clear(plain)
		return nil, ErrDecrypt
	}
	ret, out := sliceForAppend(dst, len(plain))
	copy(out, plain)
	return ret, nil
}

// sliceForAppend grows in to hold n more bytes, as the standard AEADs do.
func sliceForAppend(in []byte, n int) (head, tail []byte) {
	if total := len(in) + n; cap(in) >= total {
		head = in[:total]
	} else {
		head = make([]byte, total)
		copy(head, in)
	}
	tail = head[len(in):]
	return
}
