package usageinfo

import (
	"math"
	"sync"
	"time"
)

/*
	Usage history

	Keeps the CPU, RAM and network throughput of the last hour and the last
	day in memory, for the 1 h / 24 h views of the Performance page. Nothing is
	written to disk: the history starts empty after a restart.

	The monitor adds one CPU / RAM sample per second. Every HistoryStep the
	samples are averaged into one point of the hourly series, together with the
	network rate over that step; every DayStep worth of hourly points is
	averaged again into one point of the daily series.
*/

const (
	HistoryStep = 10 * time.Second // resolution of the 1 h series
	DayStep     = 2 * time.Minute  // resolution of the 24 h series
	hourPoints  = int(time.Hour / HistoryStep)
	dayPoints   = int(24 * time.Hour / DayStep)
)

// HistoryPoint is one averaged sample. RX and TX are in bits per second and
// are -1 when the network counters could not be read for that period.
type HistoryPoint struct {
	T   int64   // unix time of the end of the period
	CPU float64 // average CPU usage in percent
	RAM float64 // average RAM usage in percent
	RX  float64
	TX  float64
}

// ring is a fixed size circular buffer of points, oldest first
type ring struct {
	points []HistoryPoint
	start  int
	count  int
}

func newRing(size int) *ring {
	return &ring{points: make([]HistoryPoint, size)}
}

func (r *ring) push(p HistoryPoint) {
	size := len(r.points)
	if r.count < size {
		r.points[(r.start+r.count)%size] = p
		r.count++
		return
	}
	r.points[r.start] = p
	r.start = (r.start + 1) % size
}

func (r *ring) list() []HistoryPoint {
	out := make([]HistoryPoint, r.count)
	for i := 0; i < r.count; i++ {
		out[i] = r.points[(r.start+i)%len(r.points)]
	}
	return out
}

// accumulator averages the values added since the last reset
type accumulator struct {
	cpu, ram float64
	n        int
	rx, tx   float64
	nNet     int
}

func (a *accumulator) add(cpu, ram float64) {
	a.cpu += cpu
	a.ram += ram
	a.n++
}

func (a *accumulator) addNet(rx, tx float64) {
	if rx < 0 || tx < 0 {
		return
	}
	a.rx += rx
	a.tx += tx
	a.nNet++
}

func (a *accumulator) point(t time.Time) HistoryPoint {
	p := HistoryPoint{T: t.Unix(), RX: -1, TX: -1}
	if a.n > 0 {
		p.CPU = round1(a.cpu / float64(a.n))
		p.RAM = round1(a.ram / float64(a.n))
	}
	if a.nNet > 0 {
		p.RX = math.Round(a.rx / float64(a.nNet))
		p.TX = math.Round(a.tx / float64(a.nNet))
	}
	return p
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

// History holds the hourly and daily series. It is safe for concurrent use.
type History struct {
	mu        sync.RWMutex
	hour      *ring
	day       *ring
	step      accumulator // samples of the current hourly point
	dayAcc    accumulator // hourly points of the current daily point
	dayFill   int         // hourly points folded into dayAcc so far
	perDayPnt int         // hourly points per daily point
}

// NewHistory creates an empty history
func NewHistory() *History {
	return &History{
		hour:      newRing(hourPoints),
		day:       newRing(dayPoints),
		perDayPnt: int(DayStep / HistoryStep),
	}
}

// AddSample records one CPU / RAM reading, in percent
func (h *History) AddSample(cpu, ram float64) {
	h.mu.Lock()
	h.step.add(cpu, ram)
	h.mu.Unlock()
}

// Commit closes the current period at time t with the network rate measured
// over it (bits per second, negative when unknown). Periods without any
// CPU / RAM sample are skipped, so a stalled monitor leaves a gap rather than
// a run of zeros.
func (h *History) Commit(t time.Time, rx, tx float64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.step.n == 0 {
		return
	}
	h.step.addNet(rx, tx)
	p := h.step.point(t)
	h.step = accumulator{}
	h.hour.push(p)

	h.dayAcc.add(p.CPU, p.RAM)
	h.dayAcc.addNet(p.RX, p.TX)
	h.dayFill++
	if h.dayFill >= h.perDayPnt {
		h.day.push(h.dayAcc.point(t))
		h.dayAcc = accumulator{}
		h.dayFill = 0
	}
}

// Series returns the points of a range, oldest first, and the period length
// of each point. rangeName is "1h" or "24h"; anything else means "1h".
func (h *History) Series(rangeName string) ([]HistoryPoint, time.Duration) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if rangeName == "24h" {
		return h.day.list(), DayStep
	}
	return h.hour.list(), HistoryStep
}

/*
	Package level history fed by StartBackgroundMonitor
*/

var (
	globalHistory = NewHistory()
	netSourceMu   sync.RWMutex
	netSource     func() (int64, int64, error)
)

// SetNetworkCounterSource sets the function that returns the accumulated
// received and transmitted bits of the host. The history samples it every
// HistoryStep to compute the network rate. Without a source the network part
// of the history stays empty.
func SetNetworkCounterSource(source func() (rx int64, tx int64, err error)) {
	netSourceMu.Lock()
	netSource = source
	netSourceMu.Unlock()
}

// GetHistory returns the recorded usage history of a range ("1h" or "24h")
func GetHistory(rangeName string) ([]HistoryPoint, time.Duration) {
	return globalHistory.Series(rangeName)
}

// rateTracker turns accumulated counters into a rate between two readings
type rateTracker struct {
	lastRX, lastTX int64
	lastAt         time.Time
	ok             bool
}

// next returns the rate since the previous reading, or -1, -1 when there is no
// usable previous reading (first call, read error or a counter reset)
func (r *rateTracker) next(rx, tx int64, err error, now time.Time) (float64, float64) {
	if err != nil {
		r.ok = false
		return -1, -1
	}
	prev, prevRX, prevTX, prevAt := r.ok, r.lastRX, r.lastTX, r.lastAt
	r.lastRX, r.lastTX, r.lastAt, r.ok = rx, tx, now, true
	secs := now.Sub(prevAt).Seconds()
	if !prev || secs <= 0 || rx < prevRX || tx < prevTX {
		return -1, -1
	}
	return float64(rx-prevRX) / secs, float64(tx-prevTX) / secs
}

// startHistoryCommitter closes one history period every HistoryStep
func startHistoryCommitter() {
	go func() {
		tracker := &rateTracker{}
		readNet := func(now time.Time) (float64, float64) {
			netSourceMu.RLock()
			source := netSource
			netSourceMu.RUnlock()
			if source == nil {
				return -1, -1
			}
			rx, tx, err := source()
			return tracker.next(rx, tx, err, now)
		}

		readNet(time.Now()) //Seed the counters
		ticker := time.NewTicker(HistoryStep)
		defer ticker.Stop()
		for now := range ticker.C {
			rx, tx := readNet(now)
			globalHistory.Commit(now, rx, tx)
		}
	}()
}
