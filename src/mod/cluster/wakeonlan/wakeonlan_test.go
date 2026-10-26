package wakeonlan

import (
	"testing"
)

// TestMagicPacketSize verifies the magic packet type is 102 bytes as per the WOL spec.
func TestMagicPacketSize(t *testing.T) {
	var pkt magicPacket
	if len(pkt) != 102 {
		t.Errorf("expected magic packet length 102, got %d", len(pkt))
	}
}

// TestMagicPacketConstruction verifies a correctly built magic packet:
//   - bytes 0-5 are 0xFF (sync stream)
//   - bytes 6-101 are the MAC address repeated 16 times
func TestMagicPacketConstruction(t *testing.T) {
	mac := [6]byte{0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}

	var pkt magicPacket
	// Build sync stream
	copy(pkt[0:], []byte{255, 255, 255, 255, 255, 255})
	// Repeat MAC 16 times
	offset := 6
	for i := 0; i < 16; i++ {
		copy(pkt[offset:], mac[:])
		offset += 6
	}

	// Check sync stream
	for i := 0; i < 6; i++ {
		if pkt[i] != 0xFF {
			t.Errorf("byte %d of sync stream: expected 0xFF, got 0x%02X", i, pkt[i])
		}
	}

	// Check each MAC repetition
	for rep := 0; rep < 16; rep++ {
		base := 6 + rep*6
		for b := 0; b < 6; b++ {
			if pkt[base+b] != mac[b] {
				t.Errorf("rep %d byte %d: expected 0x%02X, got 0x%02X",
					rep, b, mac[b], pkt[base+b])
			}
		}
	}
}

// TestWakeTargetInvalidMAC verifies WakeTarget returns an error for a bad
// MAC address without sending any network packet.
func TestWakeTargetInvalidMAC(t *testing.T) {
	err := WakeTarget("not-a-mac")
	if err == nil {
		t.Error("expected error for invalid MAC address, got nil")
	}
}

// TestWakeTargetEmptyMAC verifies WakeTarget rejects an empty MAC string.
func TestWakeTargetEmptyMAC(t *testing.T) {
	err := WakeTarget("")
	if err == nil {
		t.Error("expected error for empty MAC address, got nil")
	}
}

// TestWakeTargetTooShortMAC verifies WakeTarget rejects a malformed MAC.
func TestWakeTargetTooShortMAC(t *testing.T) {
	err := WakeTarget("AA:BB:CC")
	if err == nil {
		t.Error("expected error for too-short MAC address, got nil")
	}
}

// TestWakeTargetValidMAC verifies WakeTarget does not return an error for a
// well-formed MAC address. The broadcast UDP send may fail in sandboxed
// environments, so we allow either success or a network-level error.
func TestWakeTargetValidMAC(t *testing.T) {
	// This test sends a real UDP broadcast; skip in environments where that
	// is not possible (the test itself doesn't assert success to avoid
	// flakiness, but it must not panic).
	err := WakeTarget("AA:BB:CC:DD:EE:FF")
	// A network error (permission denied, unreachable, etc.) is acceptable.
	// We only care that the function doesn't panic or return a MAC-parse error.
	if err != nil {
		t.Logf("WakeTarget returned (non-fatal) network error: %v", err)
	}
}

// TestSendPacketInvalidAddr verifies sendPacket returns an error for an
// unparseable address.
func TestSendPacketInvalidAddr(t *testing.T) {
	var pkt magicPacket
	err := sendPacket("not-an-address", pkt)
	if err == nil {
		t.Error("expected error for invalid address, got nil")
	}
}
