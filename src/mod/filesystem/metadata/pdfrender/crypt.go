package pdfrender

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rc4"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/binary"
)

/*
	crypt.go

	The standard security handler, opened with the empty user password. Most
	encrypted PDFs in the wild only restrict printing or copying and open
	without a password, so their thumbnails can still be drawn. Files that
	really need a password return ErrEncrypted.

	Supported: RC4 40-128 bit (V1, V2, R2-R4), AES-128 (V4 AESV2) and AES-256
	(V5, R5 and R6).
*/

var passwordPad = []byte{
	0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
	0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
}

type cryptMethod int

const (
	cryptNone cryptMethod = iota
	cryptRC4
	cryptAESV2
	cryptAESV3
)

type cryptHandler struct {
	key    []byte
	stmM   cryptMethod
	strM   cryptMethod
	rev    int
	encMet bool
}

func newCryptHandler(d *Document, enc Dict) (*cryptHandler, error) {
	if enc == nil || d.name(enc["Filter"]) != "Standard" {
		return nil, ErrEncrypted
	}
	v := d.integer(enc["V"], 0)
	r := d.integer(enc["R"], 0)
	o := []byte(stringOf(d.resolve(enc["O"])))
	u := []byte(stringOf(d.resolve(enc["U"])))
	p := d.integer(enc["P"], 0)
	encMeta := true
	if b, ok := d.resolve(enc["EncryptMetadata"]).(bool); ok {
		encMeta = b
	}
	h := &cryptHandler{rev: r, encMet: encMeta}

	method := cryptRC4
	if v >= 4 {
		//Crypt filters name the method used for streams and strings
		cf := d.dict(enc["CF"])
		methodOf := func(name Name) cryptMethod {
			if name == "Identity" || name == "" {
				return cryptNone
			}
			f := d.dict(cf[name])
			switch d.name(f["CFM"]) {
			case "V2":
				return cryptRC4
			case "AESV2":
				return cryptAESV2
			case "AESV3":
				return cryptAESV3
			case "None":
				return cryptNone
			}
			return cryptRC4
		}
		h.stmM = methodOf(d.name(enc["StmF"]))
		h.strM = methodOf(d.name(enc["StrF"]))
		if h.stmM != cryptNone {
			method = h.stmM
		} else {
			method = h.strM
		}
	} else {
		h.stmM, h.strM = cryptRC4, cryptRC4
	}

	if r >= 5 || method == cryptAESV3 {
		key, ok := aes256Key(r, u, []byte(stringOf(d.resolve(enc["UE"]))))
		if !ok {
			return nil, ErrEncrypted
		}
		h.key = key
		return h, nil
	}

	//R2 - R4 key derivation (algorithm 2)
	keyLen := 5
	if r >= 3 {
		keyLen = d.integer(enc["Length"], 40) / 8
		if keyLen < 5 || keyLen > 16 {
			keyLen = 16
		}
	}
	var id0 []byte
	if ids := d.array(d.trailer["ID"]); len(ids) > 0 {
		id0 = []byte(stringOf(d.resolve(ids[0])))
	}
	if len(o) < 32 || len(u) < 16 {
		return nil, ErrEncrypted
	}
	m := md5.New()
	m.Write(passwordPad)
	m.Write(o[:32])
	var pb [4]byte
	binary.LittleEndian.PutUint32(pb[:], uint32(int32(p)))
	m.Write(pb[:])
	m.Write(id0)
	if r >= 4 && !encMeta {
		m.Write([]byte{0xff, 0xff, 0xff, 0xff})
	}
	key := m.Sum(nil)
	if r >= 3 {
		for i := 0; i < 50; i++ {
			s := md5.Sum(key[:keyLen])
			key = s[:]
		}
	}
	key = key[:keyLen]

	//Check the empty password against /U
	if r == 2 {
		c, _ := rc4.NewCipher(key)
		out := make([]byte, 32)
		c.XORKeyStream(out, passwordPad)
		if len(u) < 32 || !bytes.Equal(out, u[:32]) {
			return nil, ErrEncrypted
		}
	} else {
		m := md5.New()
		m.Write(passwordPad)
		m.Write(id0)
		out := m.Sum(nil)
		for i := 0; i < 20; i++ {
			k := make([]byte, len(key))
			for j := range key {
				k[j] = key[j] ^ byte(i)
			}
			c, _ := rc4.NewCipher(k)
			c.XORKeyStream(out, out)
		}
		if !bytes.Equal(out[:16], u[:16]) {
			return nil, ErrEncrypted
		}
	}
	h.key = key
	return h, nil
}

// aes256Key derives the file key for R5 / R6 with the empty password
func aes256Key(r int, u []byte, ue []byte) ([]byte, bool) {
	if len(u) < 48 || len(ue) < 32 {
		return nil, false
	}
	validationSalt := u[32:40]
	keySalt := u[40:48]
	var hash []byte
	if r >= 6 {
		hash = hash2B(nil, validationSalt, nil)
	} else {
		s := sha256.Sum256(validationSalt)
		hash = s[:]
	}
	if !bytes.Equal(hash, u[:32]) {
		return nil, false
	}
	var ik []byte
	if r >= 6 {
		ik = hash2B(nil, keySalt, nil)
	} else {
		s := sha256.Sum256(keySalt)
		ik = s[:]
	}
	block, err := aes.NewCipher(ik)
	if err != nil {
		return nil, false
	}
	key := make([]byte, 32)
	cipher.NewCBCDecrypter(block, make([]byte, 16)).CryptBlocks(key, ue[:32])
	return key, true
}

// hash2B is algorithm 2.B of ISO 32000-2
func hash2B(password, salt, udata []byte) []byte {
	h := sha256.New()
	h.Write(password)
	h.Write(salt)
	h.Write(udata)
	k := h.Sum(nil)
	for i := 0; ; i++ {
		k1 := make([]byte, 0, 64*(len(password)+len(k)+len(udata)))
		for j := 0; j < 64; j++ {
			k1 = append(k1, password...)
			k1 = append(k1, k...)
			k1 = append(k1, udata...)
		}
		block, _ := aes.NewCipher(k[:16])
		e := make([]byte, len(k1))
		cipher.NewCBCEncrypter(block, k[16:32]).CryptBlocks(e, k1)
		sum := 0
		for _, b := range e[:16] {
			sum += int(b)
		}
		switch sum % 3 {
		case 0:
			s := sha256.Sum256(e)
			k = s[:]
		case 1:
			s := sha512.Sum384(e)
			k = s[:]
		default:
			s := sha512.Sum512(e)
			k = s[:]
		}
		if i+1 >= 64 && int(e[len(e)-1]) <= i+1-32 {
			break
		}
		if i > 1000 {
			break
		}
	}
	return k[:32]
}

func (h *cryptHandler) objectKey(ref Ref, aesMode bool) []byte {
	if h.rev >= 5 {
		return h.key
	}
	m := md5.New()
	m.Write(h.key)
	m.Write([]byte{byte(ref.Num), byte(ref.Num >> 8), byte(ref.Num >> 16), byte(ref.Gen), byte(ref.Gen >> 8)})
	if aesMode {
		m.Write([]byte("sAlT"))
	}
	k := m.Sum(nil)
	n := len(h.key) + 5
	if n > 16 {
		n = 16
	}
	return k[:n]
}

func (h *cryptHandler) decrypt(data []byte, ref Ref, method cryptMethod) []byte {
	switch method {
	case cryptRC4:
		c, err := rc4.NewCipher(h.objectKey(ref, false))
		if err != nil {
			return data
		}
		out := make([]byte, len(data))
		c.XORKeyStream(out, data)
		return out
	case cryptAESV2, cryptAESV3:
		key := h.objectKey(ref, true)
		if method == cryptAESV3 || h.rev >= 5 {
			key = h.key
		}
		if len(data) < 32 || len(data)%16 != 0 {
			if len(data) >= 32 {
				data = data[:len(data)/16*16]
			} else {
				return nil
			}
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return data
		}
		out := make([]byte, len(data)-16)
		cipher.NewCBCDecrypter(block, data[:16]).CryptBlocks(out, data[16:])
		//PKCS#5 padding
		if n := len(out); n > 0 {
			pad := int(out[n-1])
			if pad >= 1 && pad <= 16 && pad <= n {
				out = out[:n-pad]
			}
		}
		return out
	}
	return data
}

// decryptObject decrypts the strings of a parsed object
func (h *cryptHandler) decryptObject(o Object, ref Ref) Object {
	switch v := o.(type) {
	case String:
		if h.strM == cryptNone {
			return v
		}
		return String(h.decrypt([]byte(v), ref, h.strM))
	case Array:
		out := make(Array, len(v))
		for i, e := range v {
			out[i] = h.decryptObject(e, ref)
		}
		return out
	case Dict:
		out := make(Dict, len(v))
		for k, e := range v {
			out[k] = h.decryptObject(e, ref)
		}
		return out
	}
	return o
}

func stringOf(o Object) string {
	s, _ := o.(String)
	return string(s)
}
