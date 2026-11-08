// Package auth verifies logins: SPNEGO around NTLMv2.
//
// NTLMv1, LM responses and anonymous logins are refused. Everything here
// runs before the client has proved anything, so token parsing is bounded
// the same way as the wire package.
package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/rc4"
	"encoding/binary"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/md4"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// Negotiate flags of [MS-NLMP] 2.2.2.5
const (
	flagUnicode         uint32 = 0x00000001
	flagRequestTarget   uint32 = 0x00000004
	flagSign            uint32 = 0x00000010
	flagSeal            uint32 = 0x00000020
	flagNTLM            uint32 = 0x00000200
	flagAlwaysSign      uint32 = 0x00008000
	flagTargetServer    uint32 = 0x00020000
	flagExtendedSession uint32 = 0x00080000
	flagTargetInfo      uint32 = 0x00800000
	flagVersion         uint32 = 0x02000000
	flag128             uint32 = 0x20000000
	flagKeyExchange     uint32 = 0x40000000
	flag56              uint32 = 0x80000000
)

// AV pair ids of [MS-NLMP] 2.2.2.1
const (
	avEOL          uint16 = 0
	avNbComputer   uint16 = 1
	avNbDomain     uint16 = 2
	avDNSComputer  uint16 = 3
	avDNSDomain    uint16 = 4
	avTimestamp    uint16 = 7
	avFlags        uint16 = 6
	avFlagMICFound uint32 = 0x00000002
)

var ntlmSignature = []byte("NTLMSSP\x00")

// ErrLogonFailure means the credentials were wrong.
var ErrLogonFailure = errors.New("smbserver: logon failure")

// ErrBadToken means the security token could not be parsed.
var ErrBadToken = errors.New("smbserver: bad security token")

// HashLookup returns the NT hash of a user. The name is what the client
// typed. The returned name is the account's real spelling.
type HashLookup func(username string) (name string, ntHash []byte, ok bool)

// Identity is how the server describes itself in the NTLM challenge.
type Identity struct {
	NetbiosName string
	NetbiosDom  string
	DNSName     string
	DNSDomain   string
}

// NTHash is MD4 of the UTF-16LE password. It is what a login is verified
// against, and it is as good as the password for SMB, so it is a secret.
func NTHash(password string) []byte {
	h := md4.New()
	h.Write(wire.EncodeUTF16(password))
	return h.Sum(nil)
}

func hmacMD5(key []byte, parts ...[]byte) []byte {
	h := hmac.New(md5.New, key)
	for _, p := range parts {
		h.Write(p)
	}
	return h.Sum(nil)
}

// ntowfv2 is the NTLMv2 key of [MS-NLMP] 3.3.2.
func ntowfv2(ntHash []byte, username, domain string) []byte {
	return hmacMD5(ntHash, wire.EncodeUTF16(strings.ToUpper(username)+domain))
}

// ntlm is the server side of one NTLM exchange.
type ntlm struct {
	identity  Identity
	lookup    HashLookup
	challenge [8]byte

	negotiateMsg []byte
	challengeMsg []byte
	flags        uint32

	username   string //Account name, once verified
	attempted  string //What the client typed, verified or not
	sessionKey []byte

	clientSign, serverSign []byte
	clientSeal, serverSeal *rc4.Cipher
}

func newNTLM(identity Identity, lookup HashLookup) (*ntlm, error) {
	n := &ntlm{identity: identity, lookup: lookup}
	if _, err := rand.Read(n.challenge[:]); err != nil {
		return nil, err
	}
	return n, nil
}

func messageType(token []byte) uint32 {
	if len(token) < 12 || !bytes.Equal(token[:8], ntlmSignature) {
		return 0
	}
	return binary.LittleEndian.Uint32(token[8:])
}

// respond answers a NEGOTIATE_MESSAGE with a CHALLENGE_MESSAGE.
func (n *ntlm) respond(negotiate []byte) ([]byte, error) {
	if messageType(negotiate) != 1 || len(negotiate) < 16 {
		return nil, ErrBadToken
	}
	clientFlags := binary.LittleEndian.Uint32(negotiate[12:])

	//Windows expects these whatever it asked for, and the rest are mirrored
	n.flags = flagUnicode | flagRequestTarget | flagNTLM | flagAlwaysSign |
		flagTargetServer | flagExtendedSession | flagTargetInfo | flagVersion
	n.flags |= clientFlags & (flagSign | flagSeal | flag128 | flag56 | flagKeyExchange)

	n.negotiateMsg = append([]byte{}, negotiate...)
	n.challengeMsg = n.buildChallenge(time.Now())
	return n.challengeMsg, nil
}

func avPair(w *wire.Writer, id uint16, value []byte) {
	w.U16(id)
	w.U16(uint16(len(value)))
	w.Bytes(value)
}

func (n *ntlm) buildChallenge(now time.Time) []byte {
	target := wire.EncodeUTF16(n.identity.NetbiosDom)

	info := wire.NewWriter(128)
	avPair(info, avNbDomain, target)
	avPair(info, avNbComputer, wire.EncodeUTF16(n.identity.NetbiosName))
	avPair(info, avDNSDomain, wire.EncodeUTF16(n.identity.DNSDomain))
	avPair(info, avDNSComputer, wire.EncodeUTF16(n.identity.DNSName))
	stamp := make([]byte, 8)
	binary.LittleEndian.PutUint64(stamp, wire.Filetime(now))
	avPair(info, avTimestamp, stamp)
	avPair(info, avEOL, nil)

	const fixed = 56
	w := wire.NewWriter(fixed + len(target) + info.Len())
	w.Bytes(ntlmSignature)
	w.U32(2)
	w.U16(uint16(len(target)))
	w.U16(uint16(len(target)))
	w.U32(fixed)
	w.U32(n.flags)
	w.Bytes(n.challenge[:])
	w.Zero(8)
	w.U16(uint16(info.Len()))
	w.U16(uint16(info.Len()))
	w.U32(uint32(fixed + len(target)))
	w.Bytes([]byte{6, 1, 0, 0, 0, 0, 0, 15}) //Version: 6.1, NTLM revision 15
	w.Bytes(target)
	w.Bytes(info.B)
	return w.B
}

// field reads one security buffer of an AUTHENTICATE_MESSAGE.
func field(msg []byte, at int) ([]byte, error) {
	if at+8 > len(msg) {
		return nil, ErrBadToken
	}
	length := int(binary.LittleEndian.Uint16(msg[at:]))
	offset := int(binary.LittleEndian.Uint32(msg[at+4:]))
	if length == 0 {
		return nil, nil
	}
	if offset < 0 || offset > len(msg) || length > len(msg)-offset {
		return nil, ErrBadToken
	}
	return msg[offset : offset+length], nil
}

// micRequired reads the AV pairs inside an NTLMv2 response and reports
// whether the client says it included a MIC.
func micRequired(blob []byte) bool {
	const pairsAt = 28 //Inside the blob, after the fixed client challenge
	if len(blob) < pairsAt {
		return false
	}
	r := wire.NewReader(blob[pairsAt:])
	for !r.Bad() {
		id := r.U16()
		length := int(r.U16())
		if r.Bad() || id == avEOL {
			return false
		}
		value := r.Bytes(length)
		if id == avFlags && len(value) == 4 {
			return binary.LittleEndian.Uint32(value)&avFlagMICFound != 0
		}
	}
	return false
}

// verify checks an AUTHENTICATE_MESSAGE. On success the username and session
// key are set.
func (n *ntlm) verify(msg []byte) error {
	if messageType(msg) != 3 || len(msg) < 64 {
		return ErrBadToken
	}
	ntResponse, err := field(msg, 20)
	if err != nil {
		return err
	}
	rawDomain, err := field(msg, 28)
	if err != nil {
		return err
	}
	rawUser, err := field(msg, 36)
	if err != nil {
		return err
	}
	encryptedKey, err := field(msg, 52)
	if err != nil {
		return err
	}
	domain, ok := wire.DecodeUTF16(rawDomain)
	if !ok {
		return ErrBadToken
	}
	username, ok := wire.DecodeUTF16(rawUser)
	if !ok {
		return ErrBadToken
	}

	n.attempted = username

	//An NTLMv2 response is longer than the 24 bytes of NTLMv1, and an empty
	//one is an anonymous login. Neither is ever accepted.
	if username == "" || len(ntResponse) <= 24 {
		return ErrLogonFailure
	}

	account, ntHash, found := n.lookup(username)
	if !found {
		return ErrLogonFailure
	}

	key := ntowfv2(ntHash, username, domain)
	proof := ntResponse[:16]
	blob := ntResponse[16:]
	if !hmac.Equal(proof, hmacMD5(key, n.challenge[:], blob)) {
		return ErrLogonFailure
	}

	//The session key either comes straight from the proof, or the client
	//picked a random one and sent it encrypted with that key
	sessionKey := hmacMD5(key, proof)
	if n.flags&flagKeyExchange != 0 {
		if len(encryptedKey) != 16 {
			return ErrLogonFailure
		}
		c, err := rc4.NewCipher(sessionKey)
		if err != nil {
			return err
		}
		exported := make([]byte, 16)
		c.XORKeyStream(exported, encryptedKey)
		sessionKey = exported
	}

	if micRequired(blob) {
		if err := n.verifyMIC(msg, sessionKey); err != nil {
			return err
		}
	}

	n.username = account
	n.sessionKey = sessionKey
	return n.deriveSigningKeys()
}

// verifyMIC checks the MIC, which covers all three NTLM messages and so
// protects the negotiated flags from being changed on the way.
func (n *ntlm) verifyMIC(msg, sessionKey []byte) error {
	const micAt, micSize = 72, 16
	if len(msg) < micAt+micSize {
		return ErrLogonFailure
	}
	clean := append([]byte{}, msg...)
	clear(clean[micAt : micAt+micSize])
	if !hmac.Equal(msg[micAt:micAt+micSize], hmacMD5(sessionKey, n.negotiateMsg, n.challengeMsg, clean)) {
		return ErrLogonFailure
	}
	return nil
}

func md5Of(parts ...[]byte) []byte {
	h := md5.New()
	for _, p := range parts {
		h.Write(p)
	}
	return h.Sum(nil)
}

func (n *ntlm) deriveSigningKeys() error {
	n.clientSign = md5Of(n.sessionKey, []byte("session key to client-to-server signing key magic constant\x00"))
	n.serverSign = md5Of(n.sessionKey, []byte("session key to server-to-client signing key magic constant\x00"))
	var err error
	n.clientSeal, err = rc4.NewCipher(md5Of(n.sessionKey, []byte("session key to client-to-server sealing key magic constant\x00")))
	if err != nil {
		return err
	}
	n.serverSeal, err = rc4.NewCipher(md5Of(n.sessionKey, []byte("session key to server-to-client sealing key magic constant\x00")))
	return err
}

// mac computes an NTLM signature with extended session security, as used for
// the SPNEGO mechListMIC.
func mac(signKey []byte, seal *rc4.Cipher, keyExchange bool, seq uint32, data []byte) []byte {
	seqBytes := make([]byte, 4)
	binary.LittleEndian.PutUint32(seqBytes, seq)
	checksum := hmacMD5(signKey, seqBytes, data)[:8]
	if keyExchange {
		seal.XORKeyStream(checksum, checksum)
	}
	out := wire.NewWriter(16)
	out.U32(1)
	out.Bytes(checksum)
	out.U32(seq)
	return out.B
}

// checkClientMIC verifies a mechListMIC sent by the client.
func (n *ntlm) checkClientMIC(mechList, sig []byte) bool {
	want := mac(n.clientSign, n.clientSeal, n.flags&flagKeyExchange != 0, 0, mechList)
	return hmac.Equal(want, sig)
}

// serverMIC returns the mechListMIC the client expects in reply.
func (n *ntlm) serverMIC(mechList []byte) []byte {
	return mac(n.serverSign, n.serverSeal, n.flags&flagKeyExchange != 0, 0, mechList)
}

var authenticateSignature = []byte("NTLMSSP\x00\x03\x00\x00\x00")

// HoldsAuthenticate reports whether a frame carries an AUTHENTICATE_MESSAGE,
// so that a recorder only copies the frames it has to redact.
func HoldsAuthenticate(frame []byte) bool {
	return bytes.Contains(frame, authenticateSignature)
}

// RedactAuthenticate blanks everything a password could be attacked from in a
// recorded AUTHENTICATE_MESSAGE, in place. Windows sends one for the signed
// in user unprompted, so a capture must never keep them. Pass the whole
// message: a cut one is blanked as far as it goes, but redacting before the
// cut is what guarantees nothing is missed.
func RedactAuthenticate(frame []byte) {
	for {
		at := bytes.Index(frame, authenticateSignature)
		if at < 0 {
			return
		}
		msg := frame[at:]
		for _, offset := range []int{12, 20, 52} {
			redactField(msg, offset)
		}
		if len(msg) >= 88 {
			clear(msg[72:88])
		} else if len(msg) > 72 {
			clear(msg[72:])
		}
		frame = msg[8:]
	}
}

// redactField blanks the field described at msg[at:], and the part msg holds
// of one that runs past its end, so no half of a response survives.
func redactField(msg []byte, at int) {
	if at+8 > len(msg) {
		return
	}
	length := int(binary.LittleEndian.Uint16(msg[at:]))
	offset := int(binary.LittleEndian.Uint32(msg[at+4:]))
	if length == 0 || offset < 0 || offset >= len(msg) {
		return
	}
	end := offset + length
	if end > len(msg) {
		end = len(msg)
	}
	clear(msg[offset:end])
}
