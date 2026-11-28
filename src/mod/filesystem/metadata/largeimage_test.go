package metadata

import (
	"strconv"
	"testing"
)

func TestCanConvertOversized(t *testing.T) {
	cases := []struct {
		name    string
		memory  uint64
		intSize int
		want    bool
	}{
		{"unknown memory", 0, 64, false},
		{"2GB host", 2 << 30, 64, false},
		{"exactly 4GB", 4 << 30, 64, false},
		{"just above 4GB", 4<<30 + 1, 64, true},
		{"16GB host", 16 << 30, 64, true},
		{"32 bit build on 16GB host", 16 << 30, 32, false},
	}
	for _, c := range cases {
		if got := canConvertOversized(c.memory, c.intSize); got != c.want {
			t.Errorf("%s: canConvertOversized = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestAdmitImageSize(t *testing.T) {
	original := totalSystemMemory
	defer func() { totalSystemMemory = original }()

	const limit = 100
	cases := []struct {
		name   string
		memory uint64
		size   int64
		wantOK bool
	}{
		{"within limit on small host", 1 << 30, limit, true},
		{"oversized on small host", 1 << 30, limit + 1, false},
		{"oversized on large host", 8 << 30, limit + 1, strconv.IntSize == 64},
	}
	for _, c := range cases {
		totalSystemMemory = func() uint64 { return c.memory }
		release, ok := admitImageSize(c.size, limit)
		if ok != c.wantOK {
			t.Fatalf("%s: ok = %v, want %v", c.name, ok, c.wantOK)
		}
		if ok {
			release()
		}
	}
}

// Oversized images hold the decoding lock until they are released
func TestAdmitImageSizeSerialisesLargeImages(t *testing.T) {
	if strconv.IntSize != 64 {
		t.Skip("oversized images are refused on 32 bit builds")
	}
	original := totalSystemMemory
	defer func() { totalSystemMemory = original }()
	totalSystemMemory = func() uint64 { return 8 << 30 }

	release, ok := admitImageSize(2, 1)
	if !ok {
		t.Fatalf("oversized image was refused")
	}
	if largeImageLock.TryLock() {
		largeImageLock.Unlock()
		t.Fatalf("lock was not held while the image is in use")
	}
	release()
	if !largeImageLock.TryLock() {
		t.Fatalf("lock was not released")
	}
	largeImageLock.Unlock()
}
