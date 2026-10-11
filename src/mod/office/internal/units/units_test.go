package units

import (
	"testing"
)

func TestEmuConversion(t *testing.T) {
	if PxToEmu(960) != 9144000 {
		t.Errorf("pxToEmu(960) = %d, want 9144000", PxToEmu(960))
	}
	if px := EmuToPx(9144000, 1.0); px < 959.9 || px > 960.1 {
		t.Errorf("emuToPx(9144000) = %v, want 960", px)
	}
}
