package auth

import (
	"encoding/binary"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// TestNegotiateMessage returns a minimal NTLM NEGOTIATE_MESSAGE. It exists for
// tests of the server, which need a login without a full client.
func TestNegotiateMessage() []byte {
	w := wire.NewWriter(32)
	w.Bytes(ntlmSignature)
	w.U32(1)
	w.U32(flagUnicode | flagNTLM | flagSign | flagExtendedSession | flag128)
	w.Zero(16)
	return w.B
}

// TestAuthenticateMessage answers a raw CHALLENGE_MESSAGE, and returns the
// message and the session key.
func TestAuthenticateMessage(username, password string, challengeMsg []byte) ([]byte, []byte) {
	infoLen := int(binary.LittleEndian.Uint16(challengeMsg[40:]))
	infoOff := int(binary.LittleEndian.Uint32(challengeMsg[44:]))
	blob := wire.NewWriter(64 + infoLen)
	blob.Bytes([]byte{1, 1, 0, 0, 0, 0, 0, 0})
	blob.U64(wire.Filetime(time.Now()))
	blob.Bytes([]byte{1, 2, 3, 4, 5, 6, 7, 8})
	blob.Zero(4)
	blob.Bytes(challengeMsg[infoOff : infoOff+infoLen])

	key := ntowfv2(NTHash(password), username, "")
	proof := hmacMD5(key, challengeMsg[24:32], blob.B)
	response := append(append([]byte{}, proof...), blob.B...)
	sessionKey := hmacMD5(key, proof)

	user := wire.EncodeUTF16(username)
	const fixed = 64
	w := wire.NewWriter(fixed + len(response) + len(user))
	w.Bytes(ntlmSignature)
	w.U32(3)
	field := func(value []byte, offset int) {
		w.U16(uint16(len(value)))
		w.U16(uint16(len(value)))
		w.U32(uint32(offset))
	}
	field(nil, fixed)
	field(response, fixed)
	field(nil, fixed+len(response))
	field(user, fixed+len(response))
	field(nil, fixed+len(response)+len(user))
	field(nil, fixed+len(response)+len(user))
	w.U32(binary.LittleEndian.Uint32(challengeMsg[20:]))
	w.Bytes(response)
	w.Bytes(user)
	return w.B, sessionKey
}
