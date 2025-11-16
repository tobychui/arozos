package billyconv

import (
	"testing"
)

func TestConvertPath(t *testing.T) {
	// Test path conversion
	path := "/test/path"
	converted := ConvertToOSPath(path)
	t.Logf("Converted path: %s", converted)
}
