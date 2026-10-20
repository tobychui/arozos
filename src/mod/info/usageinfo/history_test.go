package usageinfo

import (
	"errors"
	"testing"
	"time"
)

func TestRingKeepsNewestInOrder(t *testing.T) {
	tests := []struct {
		name   string
		size   int
		pushes int
		want   []int64
	}{
		{name: "empty", size: 3, pushes: 0, want: []int64{}},
		{name: "partly filled", size: 3, pushes: 2, want: []int64{1, 2}},
		{name: "exactly full", size: 3, pushes: 3, want: []int64{1, 2, 3}},
		{name: "wrapped twice", size: 3, pushes: 7, want: []int64{5, 6, 7}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRing(tt.size)
			for i := 1; i <= tt.pushes; i++ {
				r.push(HistoryPoint{T: int64(i)})
			}
			got := r.list()
			if len(got) != len(tt.want) {
				t.Fatalf("got %d points, want %d", len(got), len(tt.want))
			}
			for i, p := range got {
				if p.T != tt.want[i] {
					t.Errorf("point %d = %d, want %d", i, p.T, tt.want[i])
				}
			}
		})
	}
}

func TestHistoryCommitAverages(t *testing.T) {
	h := NewHistory()
	base := time.Unix(1700000000, 0)

	//A period without samples is skipped
	h.Commit(base, 100, 100)
	if pts, _ := h.Series("1h"); len(pts) != 0 {
		t.Fatalf("expected no point for an empty period, got %d", len(pts))
	}

	h.AddSample(10, 40)
	h.AddSample(30, 60)
	h.Commit(base.Add(HistoryStep), 800, 400)
	h.AddSample(50, 50)
	h.Commit(base.Add(2*HistoryStep), -1, -1)

	pts, step := h.Series("1h")
	if step != HistoryStep {
		t.Errorf("step = %v, want %v", step, HistoryStep)
	}
	want := []HistoryPoint{
		{T: base.Add(HistoryStep).Unix(), CPU: 20, RAM: 50, RX: 800, TX: 400},
		{T: base.Add(2 * HistoryStep).Unix(), CPU: 50, RAM: 50, RX: -1, TX: -1},
	}
	if len(pts) != len(want) {
		t.Fatalf("got %d points, want %d", len(pts), len(want))
	}
	for i := range want {
		if pts[i] != want[i] {
			t.Errorf("point %d = %+v, want %+v", i, pts[i], want[i])
		}
	}
}

func TestHistoryFoldsIntoDaySeries(t *testing.T) {
	h := NewHistory()
	base := time.Unix(1700000000, 0)
	per := int(DayStep / HistoryStep)

	for i := 0; i < per*2+1; i++ {
		cpu := 10.0
		if i >= per {
			cpu = 30
		}
		h.AddSample(cpu, 20)
		rx := 1000.0
		if i == 0 {
			rx = -1 //an unknown rate is left out of the average
		}
		h.Commit(base.Add(time.Duration(i+1)*HistoryStep), rx, 500)
	}

	day, step := h.Series("24h")
	if step != DayStep {
		t.Errorf("step = %v, want %v", step, DayStep)
	}
	if len(day) != 2 {
		t.Fatalf("got %d daily points, want 2 (the third is still open)", len(day))
	}
	if day[0].CPU != 10 || day[1].CPU != 30 {
		t.Errorf("daily CPU = %v, %v; want 10, 30", day[0].CPU, day[1].CPU)
	}
	if day[0].RX != 1000 || day[0].TX != 500 {
		t.Errorf("daily network = %v / %v; want 1000 / 500", day[0].RX, day[0].TX)
	}
	if hour, _ := h.Series("anything"); len(hour) != per*2+1 {
		t.Errorf("unknown range should return the hourly series, got %d points", len(hour))
	}
}

func TestRateTracker(t *testing.T) {
	base := time.Unix(1700000000, 0)
	tests := []struct {
		name   string
		rx, tx int64
		err    error
		at     time.Duration
		wantRX float64
		wantTX float64
	}{
		{name: "first reading has no rate", rx: 1000, tx: 500, at: 0, wantRX: -1, wantTX: -1},
		{name: "rate over ten seconds", rx: 11000, tx: 2500, at: 10 * time.Second, wantRX: 1000, wantTX: 200},
		{name: "read error", err: errors.New("no counters"), at: 20 * time.Second, wantRX: -1, wantTX: -1},
		{name: "after an error the next reading only seeds", rx: 20000, tx: 3000, at: 30 * time.Second, wantRX: -1, wantTX: -1},
		{name: "counter reset", rx: 10, tx: 10, at: 40 * time.Second, wantRX: -1, wantTX: -1},
		{name: "recovers after reset", rx: 510, tx: 210, at: 50 * time.Second, wantRX: 50, wantTX: 20},
	}

	tracker := &rateTracker{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rx, tx := tracker.next(tt.rx, tt.tx, tt.err, base.Add(tt.at))
			if rx != tt.wantRX || tx != tt.wantTX {
				t.Errorf("rate = %v / %v, want %v / %v", rx, tx, tt.wantRX, tt.wantTX)
			}
		})
	}
}

func TestParsePhysicalCores(t *testing.T) {
	x86 := ""
	for p := 0; p < 12; p++ {
		x86 += "processor\t: " + string(rune('0'+p%10)) + "\nphysical id\t: 0\ncore id\t\t: " + string(rune('0'+p%6)) + "\n\n"
	}
	tests := []struct {
		name    string
		cpuinfo string
		want    int
	}{
		{name: "six cores twelve threads", cpuinfo: x86, want: 6},
		{name: "arm board without core ids", cpuinfo: "processor : 0\nBogoMIPS : 108\n\nprocessor : 1\nBogoMIPS : 108\n\nprocessor : 2\n\nprocessor : 3\n", want: 4},
		{name: "two sockets", cpuinfo: "processor: 0\nphysical id: 0\ncore id: 0\n\nprocessor: 1\nphysical id: 1\ncore id: 0\n", want: 2},
		{name: "windows line endings", cpuinfo: "processor: 0\r\ncore id: 0\r\n\r\nprocessor: 1\r\ncore id: 1\r\n", want: 2},
		{name: "empty", cpuinfo: "", want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parsePhysicalCores(tt.cpuinfo); got != tt.want {
				t.Errorf("parsePhysicalCores() = %d, want %d", got, tt.want)
			}
		})
	}
}
