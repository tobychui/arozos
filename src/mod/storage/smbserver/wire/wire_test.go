package wire

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"
)

func TestHeaderRoundTrip(t *testing.T) {
	cases := []Header{
		{Command: CmdCreate, MessageID: 7, TreeID: 3, SessionID: 9, Credits: 4, CreditCharge: 2},
		{Command: CmdChangeNotify, Flags: FlagAsync | FlagResponse, AsyncID: 0x1122334455, SessionID: 1, Status: StatusPending},
	}
	for _, want := range cases {
		b := make([]byte, HeaderSize)
		want.Put(b)
		got, err := ParseHeader(b)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got != want {
			t.Errorf("round trip changed the header\n got %+v\nwant %+v", got, want)
		}
	}
}

func TestParseHeaderRefusesBadInput(t *testing.T) {
	good := make([]byte, HeaderSize)
	(&Header{}).Put(good)
	wrongSize := append([]byte{}, good...)
	wrongSize[4] = 1
	wrongProto := append([]byte{}, good...)
	wrongProto[0] = 0xFF

	for name, b := range map[string][]byte{"short": good[:63], "size": wrongSize, "proto": wrongProto, "nil": nil} {
		if _, err := ParseHeader(b); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestSliceBounds(t *testing.T) {
	msg := make([]byte, 100)
	cases := []struct {
		off, n int
		ok     bool
	}{
		{64, 36, true},
		{64, 37, false},
		{100, 0, true},
		{10, 4, false}, //Inside the header
		{101, 1, false},
		{1 << 30, 1 << 30, false},
	}
	for _, c := range cases {
		if _, ok := Slice(msg, c.off, c.n); ok != c.ok {
			t.Errorf("Slice(%d,%d) ok=%v want %v", c.off, c.n, ok, c.ok)
		}
	}
}

func TestUTF16RoundTrip(t *testing.T) {
	for _, s := range []string{"", "plain.txt", "中文檔案.txt", "musical \U0001D11E clef"} {
		got, ok := DecodeUTF16(EncodeUTF16(s))
		if !ok || got != s {
			t.Errorf("round trip of %q gave %q ok=%v", s, got, ok)
		}
	}
	if _, ok := DecodeUTF16([]byte{1, 2, 3}); ok {
		t.Error("an odd length must be refused")
	}
}

func TestFiletime(t *testing.T) {
	when := time.Date(2026, 11, 7, 12, 0, 0, 123456700, time.UTC)
	if got := TimeFromFiletime(Filetime(when)); !got.Equal(when) {
		t.Errorf("round trip gave %v", got)
	}
	if Filetime(time.Time{}) != 0 {
		t.Error("the zero time must map to zero")
	}
	//1 January 1970 is a fixed point of the two epochs
	if got := Filetime(time.Unix(0, 0)); got != 116444736000000000 {
		t.Errorf("unix epoch = %d", got)
	}
}

func TestParseLockOffsets(t *testing.T) {
	msg := make([]byte, HeaderSize+24+24*2)
	(&Header{Command: CmdLock}).Put(msg)
	b := msg[HeaderSize:]
	binary.LittleEndian.PutUint16(b[0:], 48)
	binary.LittleEndian.PutUint16(b[2:], 2)
	b[8] = 0xAB //First byte of the file id
	binary.LittleEndian.PutUint64(b[24:], 100)
	binary.LittleEndian.PutUint64(b[32:], 10)
	binary.LittleEndian.PutUint32(b[40:], LockExclusive)
	binary.LittleEndian.PutUint64(b[48:], 200)
	binary.LittleEndian.PutUint64(b[56:], 20)
	binary.LittleEndian.PutUint32(b[64:], LockUnlock)

	q, err := ParseLock(msg)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if q.FileID[0] != 0xAB {
		t.Errorf("file id read from the wrong offset: %x", q.FileID)
	}
	want := []LockElement{{100, 10, LockExclusive}, {200, 20, LockUnlock}}
	for i := range want {
		if q.Locks[i] != want[i] {
			t.Errorf("lock %d = %+v want %+v", i, q.Locks[i], want[i])
		}
	}
}

func TestParseMultiProtocol(t *testing.T) {
	frame := make([]byte, 32)
	copy(frame, []byte{0xFF, 'S', 'M', 'B', 0x72})
	data := []byte("\x02NT LM 0.12\x00\x02SMB 2.002\x00\x02SMB 2.???\x00")
	frame = append(frame, 0, byte(len(data)), 0)
	frame = append(frame, data...)

	got, err := ParseMultiProtocol(frame)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got) != 3 || got[2] != "SMB 2.???" {
		t.Errorf("dialects = %q", got)
	}
	if _, err := ParseMultiProtocol(frame[:34]); err == nil {
		t.Error("a truncated frame must be refused")
	}
}

func buildCreate(t *testing.T, name string, contexts []byte) []byte {
	t.Helper()
	nameBytes := EncodeUTF16(name)
	msg := make([]byte, HeaderSize+56)
	(&Header{Command: CmdCreate}).Put(msg)
	b := msg[HeaderSize:]
	binary.LittleEndian.PutUint16(b[0:], 57)
	binary.LittleEndian.PutUint32(b[24:], FileReadData)
	binary.LittleEndian.PutUint32(b[36:], DispositionOpen)
	binary.LittleEndian.PutUint16(b[44:], uint16(HeaderSize+56))
	binary.LittleEndian.PutUint16(b[46:], uint16(len(nameBytes)))
	msg = append(msg, nameBytes...)
	if len(contexts) > 0 {
		for len(msg)%8 != 0 {
			msg = append(msg, 0)
		}
		binary.LittleEndian.PutUint32(msg[HeaderSize+48:], uint32(len(msg)))
		binary.LittleEndian.PutUint32(msg[HeaderSize+52:], uint32(len(contexts)))
		msg = append(msg, contexts...)
	}
	return msg
}

func buildContext(name string, data []byte, next uint32) []byte {
	c := make([]byte, 16)
	binary.LittleEndian.PutUint32(c[0:], next)
	binary.LittleEndian.PutUint16(c[4:], 16)
	binary.LittleEndian.PutUint16(c[6:], uint16(len(name)))
	binary.LittleEndian.PutUint16(c[10:], 24)
	binary.LittleEndian.PutUint32(c[12:], uint32(len(data)))
	c = append(c, name...)
	for len(c) < 24 {
		c = append(c, 0)
	}
	return append(c, data...)
}

func TestParseCreateContexts(t *testing.T) {
	chain := append(buildContext("MxAc", nil, 24), buildContext("QFid", []byte{1, 2}, 0)...)
	q, err := ParseCreate(buildCreate(t, `folder\檔案.txt`, chain))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if q.Name != `folder\檔案.txt` {
		t.Errorf("name = %q", q.Name)
	}
	if len(q.Contexts) != 2 || q.Contexts[0].Name != "MxAc" || q.Contexts[1].Name != "QFid" {
		t.Fatalf("contexts = %+v", q.Contexts)
	}
	if !bytes.Equal(q.Contexts[1].Data, []byte{1, 2}) {
		t.Errorf("context data = %v", q.Contexts[1].Data)
	}
}

func TestParseCreateRefusesLoopingChain(t *testing.T) {
	//A next offset below the entry size would walk backwards forever
	chain := buildContext("MxAc", nil, 8)
	if _, err := ParseCreate(buildCreate(t, "a", chain)); err == nil {
		t.Error("expected an error")
	}
}

func TestSIDForms(t *testing.T) {
	if got := SIDEveryone.String(); got != "S-1-1-0" {
		t.Errorf("everyone = %s", got)
	}
	want := []byte{1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0}
	if !bytes.Equal(SIDEveryone.Bytes(), want) {
		t.Errorf("binary form = %v", SIDEveryone.Bytes())
	}

	m1, m2 := MachineSID([]byte("a")), MachineSID([]byte("a"))
	if !m1.Equal(m2) {
		t.Error("a machine SID must be stable for one seed")
	}
	if m1.Equal(MachineSID([]byte("b"))) {
		t.Error("different seeds must differ")
	}
	u := UserSID(m1, "Alice")
	if !u.Equal(UserSID(m1, "alice")) {
		t.Error("a user SID must not depend on the case the client typed")
	}
	if rid := u.SubAuth[len(u.SubAuth)-1]; rid < 1000 {
		t.Errorf("rid %d is in the reserved range", rid)
	}
}

// Parsers run before login, so none may panic on any input.
func FuzzRequestParsers(f *testing.F) {
	seed := make([]byte, HeaderSize+64)
	(&Header{}).Put(seed)
	f.Add(seed)
	f.Fuzz(func(t *testing.T, b []byte) {
		ParseHeader(b)
		ParseNegotiate(b)
		ParseMultiProtocol(b)
		ParseSessionSetup(b)
		ParseTreeConnect(b)
		ParseCreate(b)
		ParseClose(b)
		ParseFlush(b)
		ParseRead(b)
		ParseWrite(b)
		ParseLock(b)
		ParseIoctl(b)
		ParseQueryDirectory(b)
		ParseChangeNotify(b)
		ParseQueryInfo(b)
		ParseSetInfo(b)
	})
}
