package usageinfo

import (
	"testing"
)

func TestNewUsageCollector(t *testing.T) {
	collector := NewUsageCollector()
	if collector == nil {
		t.Error("Collector should not be nil")
	}
}
