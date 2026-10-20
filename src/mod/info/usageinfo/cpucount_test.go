package usageinfo

import (
	"encoding/binary"
	"testing"
)

func TestCountCoreEntries(t *testing.T) {
	//Build a buffer of records with the given relationships
	build := func(entrySize, relOffset int, rels ...uint32) []byte {
		buf := make([]byte, entrySize*len(rels))
		for i, r := range rels {
			binary.LittleEndian.PutUint32(buf[i*entrySize+relOffset:], r)
		}
		return buf
	}

	tests := []struct {
		name      string
		buf       []byte
		entrySize int
		relOffset int
		want      int
	}{
		{name: "64 bit layout", buf: build(32, 8, 0, 2, 0, 3, 0, 1), entrySize: 32, relOffset: 8, want: 3},
		{name: "32 bit layout", buf: build(24, 4, 0, 0, 2), entrySize: 24, relOffset: 4, want: 2},
		{name: "trailing partial record ignored", buf: append(build(32, 8, 0), make([]byte, 10)...), entrySize: 32, relOffset: 8, want: 1},
		{name: "empty buffer", buf: nil, entrySize: 32, relOffset: 8, want: 0},
		{name: "invalid entry size", buf: build(32, 8, 0), entrySize: 0, relOffset: 8, want: 0},
		{name: "offset outside record", buf: build(32, 8, 0), entrySize: 8, relOffset: 8, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := countCoreEntries(tt.buf, tt.entrySize, tt.relOffset); got != tt.want {
				t.Errorf("countCoreEntries() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestGetCPUCounts(t *testing.T) {
	cores, threads := GetCPUCounts()
	if threads <= 0 {
		t.Fatalf("threads = %d, want > 0", threads)
	}
	if cores < 0 || cores > threads {
		t.Errorf("cores = %d with %d threads, want 0..threads", cores, threads)
	}
}
