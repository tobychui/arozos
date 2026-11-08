package wire

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"strings"
)

// SID is a Windows security identifier. Nothing in the server decides access
// from one: they only let the Properties dialog show who a file belongs to.
type SID struct {
	Authority uint64
	SubAuth   []uint32
}

// Well known identities
var (
	SIDEveryone = SID{Authority: 1, SubAuth: []uint32{0}}
	SIDUsers    = SID{Authority: 5, SubAuth: []uint32{32, 545}}
)

// MachineSID derives a stable S-1-5-21 domain SID from a seed, so an install
// keeps its identities across restarts with nothing extra to store.
func MachineSID(seed []byte) SID {
	sum := sha256.Sum256(append([]byte("arozos-smb-machine-sid"), seed...))
	return SID{Authority: 5, SubAuth: []uint32{
		21,
		binary.LittleEndian.Uint32(sum[0:]),
		binary.LittleEndian.Uint32(sum[4:]),
		binary.LittleEndian.Uint32(sum[8:]),
	}}
}

// UserSID derives the identity of a user below a machine SID. RIDs below 1000
// are reserved by Windows, so they are skipped.
func UserSID(machine SID, username string) SID {
	rid := crc32.ChecksumIEEE([]byte(strings.ToLower(username)))&0x3FFFFFFF + 1000
	sub := append(append([]uint32{}, machine.SubAuth...), rid)
	return SID{Authority: machine.Authority, SubAuth: sub}
}

// Bytes returns the binary form used in security descriptors.
func (s SID) Bytes() []byte {
	b := make([]byte, 8+4*len(s.SubAuth))
	b[0] = 1
	b[1] = uint8(len(s.SubAuth))
	for i := 0; i < 6; i++ {
		b[2+i] = byte(s.Authority >> (8 * (5 - i)))
	}
	for i, v := range s.SubAuth {
		binary.LittleEndian.PutUint32(b[8+4*i:], v)
	}
	return b
}

// String returns the S-1-... form.
func (s SID) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "S-1-%d", s.Authority)
	for _, v := range s.SubAuth {
		fmt.Fprintf(&b, "-%d", v)
	}
	return b.String()
}

// Equal reports whether two SIDs are the same.
func (s SID) Equal(o SID) bool {
	if s.Authority != o.Authority || len(s.SubAuth) != len(o.SubAuth) {
		return false
	}
	for i := range s.SubAuth {
		if s.SubAuth[i] != o.SubAuth[i] {
			return false
		}
	}
	return true
}
