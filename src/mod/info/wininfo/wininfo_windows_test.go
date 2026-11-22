//go:build windows

package wininfo

import (
	"os"
	"strings"
	"testing"
	"time"
)

// These read the machine the tests run on, so they check shapes and sanity,
// not exact values.

func TestProcessorInfo(t *testing.T) {
	p, err := ProcessorInfo()
	if err != nil {
		t.Fatalf("ProcessorInfo: %v", err)
	}
	if p.Name == "" || p.Identifier == "" {
		t.Errorf("ProcessorInfo = %+v, want a name and an identifier", p)
	}
	if p.MHz == 0 {
		t.Logf("ProcessorInfo reports no clock speed (virtual machine?)")
	}
}

func TestOSName(t *testing.T) {
	name, err := OSName()
	if err != nil {
		t.Fatalf("OSName: %v", err)
	}
	if !strings.HasPrefix(name, "Microsoft Windows") {
		t.Errorf("OSName = %q, want it to start with Microsoft Windows", name)
	}
}

func TestMemory(t *testing.T) {
	m, err := MemoryStatus()
	if err != nil {
		t.Fatalf("MemoryStatus: %v", err)
	}
	if m.Total == 0 || m.Available == 0 || m.Available > m.Total {
		t.Errorf("MemoryStatus = %+v, want 0 < available <= total", m)
	}
	installed, err := InstalledMemory()
	if err != nil {
		t.Fatalf("InstalledMemory: %v", err)
	}
	//The firmware and devices reserve part of the installed memory
	if installed < m.Total {
		t.Errorf("InstalledMemory = %d, want at least the usable %d", installed, m.Total)
	}
}

func TestSystemTimes(t *testing.T) {
	first, err := SystemTimes()
	if err != nil {
		t.Fatalf("SystemTimes: %v", err)
	}
	time.Sleep(200 * time.Millisecond)
	second, err := SystemTimes()
	if err != nil {
		t.Fatalf("SystemTimes: %v", err)
	}
	if second.Kernel+second.User <= first.Kernel+first.User {
		t.Errorf("CPU times did not advance: %+v then %+v", first, second)
	}
	if load := CPULoad(first, second); load < 0 || load > 100 {
		t.Errorf("CPULoad = %v, want 0 to 100", load)
	}
}

func TestLogicalDisks(t *testing.T) {
	disks, err := LogicalDisks()
	if err != nil {
		t.Fatalf("LogicalDisks: %v", err)
	}
	system := os.Getenv("SystemDrive")
	if system == "" {
		t.Skip("SystemDrive is not set")
	}
	for _, d := range disks {
		if strings.EqualFold(d.Root, system) {
			if !d.Ready || d.Size == 0 || d.Free > d.Size || d.FileSystem == "" {
				t.Errorf("system drive = %+v, want a ready volume with a file system and free <= size", d)
			}
			return
		}
	}
	t.Errorf("LogicalDisks = %+v, want the system drive %s", disks, system)
}

func TestNetAdapters(t *testing.T) {
	adapters, err := NetAdapters()
	if err != nil {
		t.Fatalf("NetAdapters: %v", err)
	}
	for _, a := range adapters {
		if a.Name == "" {
			t.Errorf("adapter without a name: %+v", a)
		}
	}
}

func TestUSBDevices(t *testing.T) {
	devices, err := USBDevices()
	if err != nil {
		t.Fatalf("USBDevices: %v", err)
	}
	for _, d := range devices {
		if strings.TrimSpace(d) == "" {
			t.Errorf("USBDevices = %q, holds an empty name", devices)
		}
	}
}

func TestPhysicalDisks(t *testing.T) {
	disks, err := PhysicalDisks()
	if err != nil {
		t.Fatalf("PhysicalDisks: %v", err)
	}
	if len(disks) == 0 {
		t.Skip("no disk drive reported (container?)")
	}
	sized := false
	for _, d := range disks {
		if d.Model == "" {
			t.Errorf("disk without a model: %+v", d)
		}
		if d.Size > 0 {
			sized = true
		}
	}
	if !sized {
		t.Errorf("PhysicalDisks = %+v, want the size of at least one disk", disks)
	}
}
