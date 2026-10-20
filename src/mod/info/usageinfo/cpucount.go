package usageinfo

import (
	"encoding/binary"
	"runtime"
	"strings"
)

// GetCPUCounts returns the number of physical cores and logical threads of the
// host. cores is 0 when the platform does not expose it (see physicalCores);
// threads always comes from the Go runtime.
func GetCPUCounts() (cores int, threads int) {
	return physicalCores(), runtime.NumCPU()
}

// parsePhysicalCores counts the distinct (physical id, core id) pairs of a
// /proc/cpuinfo dump. Boards that print neither field (many ARM SoCs) list one
// "processor" block per core, so the processor count is used instead.
func parsePhysicalCores(cpuinfo string) int {
	seen := map[string]bool{}
	processors := 0
	physicalID, coreID := "", ""
	flush := func() {
		if coreID != "" {
			seen[physicalID+"/"+coreID] = true
		}
		physicalID, coreID = "", ""
	}

	for _, line := range strings.Split(strings.ReplaceAll(cpuinfo, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		switch key {
		case "processor":
			processors++
		case "physical id":
			physicalID = value
		case "core id":
			coreID = value
		}
	}
	flush()

	if len(seen) > 0 {
		return len(seen)
	}
	return processors
}

// countCoreEntries counts the RelationProcessorCore (0) records in a buffer
// filled by the Windows GetLogicalProcessorInformation call. Each record is
// entrySize bytes long and keeps its little endian Relationship field at
// relOffset (right after the pointer sized ProcessorMask).
func countCoreEntries(buf []byte, entrySize int, relOffset int) int {
	if entrySize <= 0 || relOffset < 0 || relOffset+4 > entrySize {
		return 0
	}
	cores := 0
	for off := 0; off+entrySize <= len(buf); off += entrySize {
		if binary.LittleEndian.Uint32(buf[off+relOffset:off+relOffset+4]) == 0 {
			cores++
		}
	}
	return cores
}
