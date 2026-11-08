package smbserver

import (
	"bytes"
	"encoding/binary"
	"net"
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// authenticateAt builds an inbound frame holding an AUTHENTICATE_MESSAGE at
// offset at, whose NT response is proof, padded to size bytes.
func authenticateAt(at int, proof []byte, size int) []byte {
	frame := make([]byte, size)
	copy(frame, []byte{0xFE, 'S', 'M', 'B'})
	msg := frame[at:]
	copy(msg, []byte("NTLMSSP\x00\x03\x00\x00\x00"))
	const payload = 88
	binary.LittleEndian.PutUint16(msg[20:], uint16(len(proof)))
	binary.LittleEndian.PutUint16(msg[22:], uint16(len(proof)))
	binary.LittleEndian.PutUint32(msg[24:], payload)
	copy(msg[payload:], proof)
	return frame
}

func readCapture(t *testing.T, dir string) []byte {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(dir, "smb-*.pcap"))
	if len(files) != 1 {
		t.Fatalf("pcap files %v", files)
	}
	data, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// The response of a login is blanked even where the cut of a large message
// falls inside it.
func TestCaptureRedactsBeforeCutting(t *testing.T) {
	proof := bytes.Repeat([]byte("secretproof!"), 30)
	tests := []struct {
		name string
		at   int
		size int
		full bool
	}{
		{"response crosses the cut", 300, captureLargeMsg + 1000, false},
		{"response before the cut", wire.HeaderSize, captureLargeMsg + 1000, false},
		{"small message", wire.HeaderSize, 1024, false},
		{"full capture", 300, captureLargeMsg + 1000, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			c, err := newCapture(dir, tt.full)
			if err != nil {
				t.Fatal(err)
			}
			a, b := net.Pipe()
			defer a.Close()
			defer b.Close()
			frame := authenticateAt(tt.at, proof, tt.size)
			live := append([]byte(nil), frame...)
			c.record(&conn{id: 1, nc: a}, true, frame)
			c.close()

			got := readCapture(t, dir)
			if bytes.Contains(got, []byte("secretproof!")) {
				t.Error("part of the NT response reached the capture")
			}
			if !bytes.Contains(got, []byte("NTLMSSP\x00\x03")) {
				t.Error("the message itself should still be recorded")
			}
			if !bytes.Equal(frame, live) {
				t.Error("the live frame must not be changed")
			}
		})
	}
}
