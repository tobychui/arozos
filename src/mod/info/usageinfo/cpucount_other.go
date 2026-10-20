//go:build !windows

package usageinfo

import "os"

// physicalCores reads the core count from /proc/cpuinfo. Platforms without it
// (macOS, the BSDs) report 0 and the UI shows the thread count only.
func physicalCores() int {
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return 0
	}
	return parsePhysicalCores(string(data))
}
