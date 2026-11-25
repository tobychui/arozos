//go:build !windows

package usageinfo

import "imuslab.com/arozos/mod/info/logger"
import "os"

// physicalCores reads the core count from /proc/cpuinfo. Platforms without it
// (macOS, the BSDs) report 0 and the UI shows the thread count only.
func physicalCores() (out0 int) {
	defer logger.Out1(logger.In0("info/usageinfo", "physicalCores"), &out0)
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		logger.DebugErr("info/usageinfo", err)
		return 0
	}
	return parsePhysicalCores(string(data))
}
