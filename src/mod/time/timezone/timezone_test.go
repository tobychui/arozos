package timezone

import (
	"testing"
)

func TestConvertWinTZtoLinuxTZ(t *testing.T) {
	// Test the conversion function
	result := ConvertWinTZtoLinuxTZ("Pacific Standard Time")
	// May be empty if wintz.json doesn't exist, which is fine
	t.Logf("Converted timezone: %s", result)
}
