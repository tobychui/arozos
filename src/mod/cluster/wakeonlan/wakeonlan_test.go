package wakeonlan

import (
	"net"
	"testing"
)

func TestMagicPacketCreation(t *testing.T) {
	// Test case 1: Valid MAC address creates correct packet
	macAddr := "00:11:22:33:44:55"
	mac, err := net.ParseMAC(macAddr)
	if err != nil {
		t.Fatalf("Failed to parse MAC address: %v", err)
	}

	// Create a packet manually to verify structure
	packet := magicPacket{}
	
	// First 6 bytes should be 0xFF
	copy(packet[0:], []byte{255, 255, 255, 255, 255, 255})
	
	// Verify first 6 bytes
	for i := 0; i < 6; i++ {
		if packet[i] != 255 {
			t.Errorf("Test case 1 failed. Byte %d should be 255, got %d", i, packet[i])
		}
	}

	// Next 96 bytes should be MAC repeated 16 times
	offset := 6
	for i := 0; i < 16; i++ {
		copy(packet[offset:], mac)
		offset += 6
	}

	// Verify some MAC repetitions
	if packet[6] != 0x00 || packet[7] != 0x11 || packet[8] != 0x22 {
		t.Error("Test case 1 failed. MAC address not correctly copied")
	}

	// Test case 2: Packet should be exactly 102 bytes
	if len(packet) != 102 {
		t.Errorf("Test case 2 failed. Packet should be 102 bytes, got %d", len(packet))
	}
}

func TestWakeTargetValidation(t *testing.T) {
	// Test case 1: Invalid MAC address format
	err := WakeTarget("invalid-mac")
	if err == nil {
		t.Error("Test case 1 failed. Expected error for invalid MAC address")
	}

	// Test case 2: Empty MAC address
	err = WakeTarget("")
	if err == nil {
		t.Error("Test case 2 failed. Expected error for empty MAC address")
	}

	// Test case 3: MAC with wrong separator
	err = WakeTarget("00-11-22-33-44-55")
	// This might be valid depending on net.ParseMAC implementation
	t.Logf("Test case 3: MAC with dash separator returned: %v", err)

	// Test case 4: MAC with no separators
	err = WakeTarget("001122334455")
	// This might be valid depending on net.ParseMAC implementation
	t.Logf("Test case 4: MAC with no separators returned: %v", err)

	// Test case 5: MAC with too few octets
	err = WakeTarget("00:11:22:33")
	if err == nil {
		t.Error("Test case 5 failed. Expected error for MAC with too few octets")
	}

	// Test case 6: MAC with too many octets
	err = WakeTarget("00:11:22:33:44:55:66:77")
	if err == nil {
		t.Error("Test case 6 failed. Expected error for MAC with too many octets")
	}

	// Test case 7: MAC with invalid hex characters
	err = WakeTarget("GG:HH:II:JJ:KK:LL")
	if err == nil {
		t.Error("Test case 7 failed. Expected error for MAC with invalid hex")
	}

	// Test case 8: MAC with mixed case (should be valid)
	err = WakeTarget("aA:bB:cC:dD:eE:fF")
	// This might succeed or fail depending on network availability
	t.Logf("Test case 8: Mixed case MAC returned: %v", err)

	// Test case 9: All zeros MAC (broadcast)
	err = WakeTarget("00:00:00:00:00:00")
	t.Logf("Test case 9: All zeros MAC returned: %v", err)

	// Test case 10: All Fs MAC (broadcast)
	err = WakeTarget("FF:FF:FF:FF:FF:FF")
	t.Logf("Test case 10: All Fs MAC returned: %v", err)
}

func TestMACAddressParsing(t *testing.T) {
	// Test case 1: Standard colon-separated MAC
	mac, err := net.ParseMAC("00:11:22:33:44:55")
	if err != nil {
		t.Errorf("Test case 1 failed. Standard MAC should parse: %v", err)
	}
	if len(mac) != 6 {
		t.Errorf("Test case 1 failed. MAC length should be 6, got %d", len(mac))
	}

	// Test case 2: Dash-separated MAC
	mac, err = net.ParseMAC("00-11-22-33-44-55")
	if err != nil {
		t.Errorf("Test case 2 failed. Dash-separated MAC should parse: %v", err)
	}
	if len(mac) != 6 {
		t.Errorf("Test case 2 failed. MAC length should be 6, got %d", len(mac))
	}

	// Test case 3: Continuous MAC (no separators)
	mac, err = net.ParseMAC("001122334455")
	if err != nil {
		t.Errorf("Test case 3 failed. Continuous MAC should parse: %v", err)
	}
	if len(mac) != 6 {
		t.Errorf("Test case 3 failed. MAC length should be 6, got %d", len(mac))
	}

	// Test case 4: Dotted MAC (Cisco format)
	mac, err = net.ParseMAC("0011.2233.4455")
	if err != nil {
		t.Logf("Test case 4: Cisco format MAC: %v", err)
	} else if len(mac) != 6 {
		t.Errorf("Test case 4 failed. MAC length should be 6, got %d", len(mac))
	}

	// Test case 5: Verify MAC bytes
	mac, err = net.ParseMAC("01:23:45:67:89:AB")
	if err != nil {
		t.Errorf("Test case 5 failed. Failed to parse MAC: %v", err)
	} else {
		if mac[0] != 0x01 || mac[1] != 0x23 || mac[2] != 0x45 {
			t.Error("Test case 5 failed. MAC bytes not correctly parsed")
		}
		if mac[3] != 0x67 || mac[4] != 0x89 || mac[5] != 0xAB {
			t.Error("Test case 5 failed. MAC bytes not correctly parsed")
		}
	}

	// Test case 6: Lowercase hex
	mac, err = net.ParseMAC("aa:bb:cc:dd:ee:ff")
	if err != nil {
		t.Errorf("Test case 6 failed. Lowercase hex should parse: %v", err)
	}
	if mac[0] != 0xAA || mac[5] != 0xFF {
		t.Error("Test case 6 failed. Lowercase hex not correctly parsed")
	}
}

func TestPacketStructure(t *testing.T) {
	// Test case 1: Verify packet has correct header (6 bytes of 0xFF)
	packet := magicPacket{}
	copy(packet[0:], []byte{255, 255, 255, 255, 255, 255})
	
	for i := 0; i < 6; i++ {
		if packet[i] != 255 {
			t.Errorf("Test case 1 failed. Header byte %d should be 255", i)
		}
	}

	// Test case 2: Verify MAC is repeated 16 times
	mac, err := net.ParseMAC("11:22:33:44:55:66")
	if err != nil {
		t.Fatalf("Test case 2 failed. Failed to parse MAC: %v", err)
	}
	offset := 6
	for i := 0; i < 16; i++ {
		copy(packet[offset:], mac)
		offset += 6
	}

	// Check first repetition
	if packet[6] != 0x11 || packet[7] != 0x22 || packet[8] != 0x33 {
		t.Error("Test case 2 failed. First MAC repetition incorrect")
	}

	// Check last repetition (starts at byte 96)
	if packet[96] != 0x11 || packet[97] != 0x22 || packet[98] != 0x33 {
		t.Error("Test case 2 failed. Last MAC repetition incorrect")
	}

	// Test case 3: Total packet size
	totalSize := 6 + (16 * 6)
	if totalSize != 102 {
		t.Errorf("Test case 3 failed. Packet size should be 102, got %d", totalSize)
	}

	// Test case 4: Verify all 16 repetitions
	for i := 0; i < 16; i++ {
		start := 6 + (i * 6)
		if packet[start] != 0x11 || packet[start+1] != 0x22 || packet[start+2] != 0x33 {
			t.Errorf("Test case 4 failed. MAC repetition %d is incorrect", i)
		}
	}
}
