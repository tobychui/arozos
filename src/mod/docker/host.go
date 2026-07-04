package docker

/*
	host.go

	Lightweight host resource snapshot for the Docker Manager overview cards
	(CPU / RAM / Storage / Load). CPU and RAM reuse the shared usageinfo monitor;
	storage and load average are read via build-tagged platform helpers
	(host_linux.go / host_darwin.go / host_windows.go) so each platform reports
	what it can and the rest degrade to "unavailable".
*/

import (
	"encoding/json"
	"net/http"
	"runtime"

	"imuslab.com/arozos/mod/info/usageinfo"
	"imuslab.com/arozos/mod/utils"
)

// HostStats is the JSON payload for /system/docker/host/stats.
type HostStats struct {
	CPUPercent       float64 `json:"cpuPercent"`
	CPUCores         int     `json:"cpuCores"`
	RAMUsed          int64   `json:"ramUsed"`  // bytes
	RAMTotal         int64   `json:"ramTotal"` // bytes
	RAMPercent       float64 `json:"ramPercent"`
	StorageUsed      int64   `json:"storageUsed"`  // bytes
	StorageTotal     int64   `json:"storageTotal"` // bytes
	StoragePercent   float64 `json:"storagePercent"`
	StorageAvailable bool    `json:"storageAvailable"`
	Load1            float64 `json:"load1"`
	Load5            float64 `json:"load5"`
	Load15           float64 `json:"load15"`
	LoadAvailable    bool    `json:"loadAvailable"`
}

// GetHostStats samples the current host resource usage.
func (d *DockerManager) GetHostStats() HostStats {
	s := HostStats{CPUCores: runtime.NumCPU()}

	//CPU% and RAM% from the shared (non-blocking) background monitor when ready.
	cpu, _, _, ramPct, ready := usageinfo.GetCachedStats()
	if ready {
		s.CPUPercent = cpu
		s.RAMPercent = ramPct
	} else {
		s.CPUPercent = usageinfo.GetCPUUsage()
	}

	//Numeric RAM bytes for the "x GB / y GB" display.
	used, total := usageinfo.GetNumericRAMUsage()
	s.RAMUsed, s.RAMTotal = used, total
	if total > 0 && s.RAMPercent == 0 {
		s.RAMPercent = float64(used) / float64(total) * 100
	}

	//Storage of the volume hosting the arozos working directory.
	if su, st, ok := hostStorageUsage(); ok && st > 0 {
		s.StorageUsed, s.StorageTotal = su, st
		s.StoragePercent = float64(su) / float64(st) * 100
		s.StorageAvailable = true
	}

	//Load average (Linux only).
	if l1, l5, l15, ok := hostLoadAvg(); ok {
		s.Load1, s.Load5, s.Load15 = l1, l5, l15
		s.LoadAvailable = true
	}

	return s
}

// HandleHostStats serves the host resource snapshot as JSON.
func (d *DockerManager) HandleHostStats(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(d.GetHostStats())
	utils.SendJSONResponse(w, string(js))
}
