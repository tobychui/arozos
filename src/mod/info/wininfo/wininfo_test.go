package wininfo

import (
	"math"
	"testing"
)

func TestCPULoad(t *testing.T) {
	tests := []struct {
		name string
		prev CPUTimes
		cur  CPUTimes
		want float64
	}{
		{name: "idle machine", prev: CPUTimes{Idle: 100, Kernel: 100, User: 0}, cur: CPUTimes{Idle: 200, Kernel: 200, User: 0}, want: 0},
		{name: "quarter busy", prev: CPUTimes{}, cur: CPUTimes{Idle: 75, Kernel: 80, User: 20}, want: 25},
		{name: "fully busy", prev: CPUTimes{Idle: 10, Kernel: 10, User: 0}, cur: CPUTimes{Idle: 10, Kernel: 60, User: 50}, want: 100},
		{name: "no time passed", prev: CPUTimes{Idle: 5, Kernel: 5, User: 5}, cur: CPUTimes{Idle: 5, Kernel: 5, User: 5}, want: 0},
		{name: "counter went back", prev: CPUTimes{Idle: 50, Kernel: 90, User: 10}, cur: CPUTimes{Idle: 10, Kernel: 20, User: 5}, want: 0},
		{name: "idle larger than total", prev: CPUTimes{}, cur: CPUTimes{Idle: 90, Kernel: 50, User: 10}, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CPULoad(tt.prev, tt.cur)
			if math.Abs(got-tt.want) > 0.001 {
				t.Errorf("CPULoad = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestOSDisplayName(t *testing.T) {
	tests := []struct {
		name    string
		product string
		build   int
		want    string
	}{
		{name: "windows 10", product: "Windows 10 Pro", build: 19045, want: "Microsoft Windows 10 Pro"},
		{name: "windows 11 still says 10", product: "Windows 10 Pro", build: 22631, want: "Microsoft Windows 11 Pro"},
		{name: "server", product: "Windows Server 2022 Standard", build: 20348, want: "Microsoft Windows Server 2022 Standard"},
		{name: "already prefixed", product: "Microsoft Windows 7 Ultimate", build: 7601, want: "Microsoft Windows 7 Ultimate"},
		{name: "spaces trimmed", product: "  Windows 10 Home ", build: 0, want: "Microsoft Windows 10 Home"},
		{name: "empty", product: "", build: 22000, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := osDisplayName(tt.product, tt.build); got != tt.want {
				t.Errorf("osDisplayName = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatLinkSpeed(t *testing.T) {
	tests := []struct {
		bps  uint64
		want string
	}{
		{0, "N/A"},
		{^uint64(0), "N/A"},
		{1000000000, "1 Gbps"},
		{2500000000, "2.5 Gbps"},
		{866700000, "866.7 Mbps"},
		{100000000, "100 Mbps"},
		{54000, "54 Kbps"},
		{300, "300 bps"},
	}
	for _, tt := range tests {
		if got := FormatLinkSpeed(tt.bps); got != tt.want {
			t.Errorf("FormatLinkSpeed(%d) = %q, want %q", tt.bps, got, tt.want)
		}
	}
}

func TestOperStateName(t *testing.T) {
	tests := []struct {
		status uint32
		want   string
	}{
		{1, "up"},
		{2, "down"},
		{3, "testing"},
		{4, "unknown"},
		{5, "dormant"},
		{6, "down"},
		{7, "dormant"},
		{99, "unknown"},
	}
	for _, tt := range tests {
		if got := OperStateName(tt.status); got != tt.want {
			t.Errorf("OperStateName(%d) = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestDuplexName(t *testing.T) {
	tests := []struct {
		duplex Duplex
		want   string
	}{
		{DuplexFull, "Full"},
		{DuplexHalf, "Half"},
		{DuplexUnknown, "N/A"},
	}
	for _, tt := range tests {
		if got := DuplexName(tt.duplex); got != tt.want {
			t.Errorf("DuplexName(%d) = %q, want %q", tt.duplex, got, tt.want)
		}
	}
}
