//go:build !windows

package wininfo

import (
	"errors"
	"testing"
)

func TestUnsupportedPlatform(t *testing.T) {
	calls := map[string]func() error{
		"ProcessorInfo":   func() error { _, err := ProcessorInfo(); return err },
		"OSName":          func() error { _, err := OSName(); return err },
		"MemoryStatus":    func() error { _, err := MemoryStatus(); return err },
		"InstalledMemory": func() error { _, err := InstalledMemory(); return err },
		"SystemTimes":     func() error { _, err := SystemTimes(); return err },
		"LogicalDisks":    func() error { _, err := LogicalDisks(); return err },
		"NetAdapters":     func() error { _, err := NetAdapters(); return err },
		"USBDevices":      func() error { _, err := USBDevices(); return err },
		"PhysicalDisks":   func() error { _, err := PhysicalDisks(); return err },
	}
	for name, fn := range calls {
		if err := fn(); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s error = %v, want ErrUnsupported", name, err)
		}
	}
}
