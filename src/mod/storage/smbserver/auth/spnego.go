package auth

import (
	"bytes"
	"errors"
)

/*
	spnego.go

	The GSS-API and SPNEGO framing around NTLM ([RFC 4178], [MS-SPNG]).
	The tokens are a small part of DER, read and written by hand so that
	the parser stays obvious.
*/

var (
	oidSPNEGO = []byte{0x2b, 0x06, 0x01, 0x05, 0x05, 0x02}
	oidNTLM   = []byte{0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a}
)

const (
	tagSequence = 0x30
	tagOID      = 0x06
	tagOctets   = 0x04
	tagEnum     = 0x0a
	tagGeneral  = 0x1b
	tagGSS      = 0x60
	tagInit     = 0xa0
	tagResp     = 0xa1

	stateCompleted  = 0
	stateIncomplete = 1
	stateRejected   = 2
)

// readTLV splits off one DER element.
func readTLV(b []byte) (tag byte, value, rest []byte, err error) {
	if len(b) < 2 {
		return 0, nil, nil, ErrBadToken
	}
	tag = b[0]
	length := int(b[1])
	header := 2
	if length >= 0x80 {
		count := length & 0x7f
		if count == 0 || count > 4 || len(b) < 2+count {
			return 0, nil, nil, ErrBadToken
		}
		length = 0
		for _, v := range b[2 : 2+count] {
			length = length<<8 | int(v)
		}
		header += count
	}
	if length < 0 || length > len(b)-header {
		return 0, nil, nil, ErrBadToken
	}
	return tag, b[header : header+length], b[header+length:], nil
}

func tlv(tag byte, parts ...[]byte) []byte {
	content := bytes.Join(parts, nil)
	n := len(content)
	var out []byte
	switch {
	case n < 0x80:
		out = []byte{tag, byte(n)}
	case n < 0x100:
		out = []byte{tag, 0x81, byte(n)}
	default:
		out = []byte{tag, 0x82, byte(n >> 8), byte(n)}
	}
	return append(out, content...)
}

// clientToken is what a client sent, with the SPNEGO framing removed.
type clientToken struct {
	mechList []byte //The DER MechTypeList, kept for the MIC
	mechs    [][]byte
	ntlm     []byte
	mic      []byte
}

func parseNegTokenInit(content []byte) (*clientToken, error) {
	tag, seq, _, err := readTLV(content)
	if err != nil || tag != tagSequence {
		return nil, ErrBadToken
	}
	out := &clientToken{}
	for len(seq) > 0 {
		var value []byte
		tag, value, seq, err = readTLV(seq)
		if err != nil {
			return nil, err
		}
		switch tag {
		case 0xa0:
			//Keep the list as it was sent, the MIC is computed over its bytes
			listTag, list, _, err := readTLV(value)
			if err != nil || listTag != tagSequence {
				return nil, ErrBadToken
			}
			out.mechList = value
			for len(list) > 0 {
				var oid []byte
				var oidTag byte
				oidTag, oid, list, err = readTLV(list)
				if err != nil || oidTag != tagOID {
					return nil, ErrBadToken
				}
				out.mechs = append(out.mechs, oid)
			}
		case 0xa2:
			octetTag, token, _, err := readTLV(value)
			if err != nil || octetTag != tagOctets {
				return nil, ErrBadToken
			}
			out.ntlm = token
		}
	}
	return out, nil
}

func parseNegTokenResp(content []byte) (*clientToken, error) {
	tag, seq, _, err := readTLV(content)
	if err != nil || tag != tagSequence {
		return nil, ErrBadToken
	}
	out := &clientToken{}
	for len(seq) > 0 {
		var value []byte
		tag, value, seq, err = readTLV(seq)
		if err != nil {
			return nil, err
		}
		switch tag {
		case 0xa2, 0xa3:
			octetTag, token, _, err := readTLV(value)
			if err != nil || octetTag != tagOctets {
				return nil, ErrBadToken
			}
			if tag == 0xa2 {
				out.ntlm = token
			} else {
				out.mic = token
			}
		}
	}
	return out, nil
}

// parseToken removes the framing. Some clients send bare NTLMSSP.
func parseToken(token []byte) (*clientToken, bool, error) {
	if bytes.HasPrefix(token, ntlmSignature) {
		return &clientToken{ntlm: token}, false, nil
	}
	tag, content, _, err := readTLV(token)
	if err != nil {
		return nil, true, err
	}
	switch tag {
	case tagGSS:
		oidTag, oid, rest, err := readTLV(content)
		if err != nil || oidTag != tagOID || !bytes.Equal(oid, oidSPNEGO) {
			return nil, true, ErrBadToken
		}
		innerTag, inner, _, err := readTLV(rest)
		if err != nil || innerTag != tagInit {
			return nil, true, ErrBadToken
		}
		parsed, err := parseNegTokenInit(inner)
		return parsed, true, err
	case tagInit:
		parsed, err := parseNegTokenInit(content)
		return parsed, true, err
	case tagResp:
		parsed, err := parseNegTokenResp(content)
		return parsed, true, err
	}
	return nil, true, ErrBadToken
}

// NegotiateToken is the blob of the NEGOTIATE response. It offers NTLM alone,
// which is what keeps a client from trying Kerberos against a server with
// no KDC.
func NegotiateToken() []byte {
	mechs := tlv(tagSequence, tlv(tagOID, oidNTLM))
	hint := tlv(0xa0, tlv(tagGeneral, []byte("not_defined_in_RFC4178@please_ignore")))
	body := tlv(tagSequence, tlv(0xa0, mechs), tlv(0xa3, tlv(tagSequence, hint)))
	return tlv(tagGSS, tlv(tagOID, oidSPNEGO), tlv(tagInit, body))
}

func negTokenResp(state int, supported bool, response, mic []byte) []byte {
	parts := [][]byte{tlv(0xa0, tlv(tagEnum, []byte{byte(state)}))}
	if supported {
		parts = append(parts, tlv(0xa1, tlv(tagOID, oidNTLM)))
	}
	if len(response) > 0 {
		parts = append(parts, tlv(0xa2, tlv(tagOctets, response)))
	}
	if len(mic) > 0 {
		parts = append(parts, tlv(0xa3, tlv(tagOctets, mic)))
	}
	return tlv(tagResp, tlv(tagSequence, parts...))
}

// Exchange is one login attempt.
type Exchange struct {
	ntlm     *ntlm
	spnego   bool
	mechList []byte
	started  bool
}

// NewExchange starts a login.
func NewExchange(identity Identity, lookup HashLookup) (*Exchange, error) {
	n, err := newNTLM(identity, lookup)
	if err != nil {
		return nil, err
	}
	return &Exchange{ntlm: n}, nil
}

// Step feeds one client token in. It returns the token to send back and
// whether the login is complete. An error ends the login.
func (e *Exchange) Step(token []byte) ([]byte, bool, error) {
	parsed, spnego, err := parseToken(token)
	if err != nil {
		return nil, false, err
	}
	if !e.started {
		e.spnego = spnego
	}
	if parsed.mechList != nil {
		e.mechList = parsed.mechList
	}

	switch messageType(parsed.ntlm) {
	case 1:
		if e.started {
			return nil, false, ErrBadToken
		}
		e.started = true
		challenge, err := e.ntlm.respond(parsed.ntlm)
		if err != nil {
			return nil, false, err
		}
		if !e.spnego {
			return challenge, false, nil
		}
		return negTokenResp(stateIncomplete, true, challenge, nil), false, nil

	case 3:
		if !e.started {
			return nil, false, ErrBadToken
		}
		if err := e.ntlm.verify(parsed.ntlm); err != nil {
			return nil, false, err
		}
		if !e.spnego {
			return nil, true, nil
		}
		var mic []byte
		if len(parsed.mic) > 0 {
			if !e.ntlm.checkClientMIC(e.mechList, parsed.mic) {
				return nil, false, ErrLogonFailure
			}
			mic = e.ntlm.serverMIC(e.mechList)
		}
		return negTokenResp(stateCompleted, false, nil, mic), true, nil
	}

	//A client that opened with a mechanism it wanted more, such as Kerberos,
	//gets told NTLM is the choice and tries again
	if spnego && !e.started && len(parsed.mechs) > 0 {
		for _, m := range parsed.mechs {
			if bytes.Equal(m, oidNTLM) {
				return negTokenResp(stateIncomplete, true, nil, nil), false, nil
			}
		}
		return negTokenResp(stateRejected, false, nil, nil), false, errors.New("smbserver: client does not offer NTLM")
	}
	return nil, false, ErrBadToken
}

// Username returns the verified account after a completed login.
func (e *Exchange) Username() string { return e.ntlm.username }

// AttemptedUser returns the name the client tried, for the log of a failed
// login. It proves nothing about who is on the other end.
func (e *Exchange) AttemptedUser() string { return e.ntlm.attempted }

// SessionKey returns the exported session key after a completed login.
func (e *Exchange) SessionKey() []byte { return e.ntlm.sessionKey }
