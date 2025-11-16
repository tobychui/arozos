package timezone

import (
	"testing"
)

func TestGetLocalTimeZone(t *testing.T) {
	tz := GetLocalTimeZone()
	if tz == "" {
		t.Error("Timezone should not be empty")
	}
	t.Logf("Local timezone: %s", tz)
}
