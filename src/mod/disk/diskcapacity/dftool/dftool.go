package dftool

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

type Capacity struct {
	PhysicalDevice string //The ID of the physical device, like C:/ or /dev/sda1
	Used           int64  //Used capacity in bytes
	Available      int64  //Avilable capacity in bytes
	Total          int64  //Total capacity in bytes
}

// UsedPercent returns the percentage of disk space currently used (0–100).
// Returns 0 if Total is zero to avoid division by zero.
func (c *Capacity) UsedPercent() (out0 float64) {
	defer logger.Out1(logger.In1("disk/diskcapacity/dftool", "Capacity.UsedPercent", "c", c), &out0)
	if c.Total == 0 {
		return 0
	}
	return float64(c.Used) / float64(c.Total) * 100
}

// FreeBytes returns the number of bytes available for use.
func (c *Capacity) FreeBytes() (out0 int64) {
	defer logger.Out1(logger.In1("disk/diskcapacity/dftool", "Capacity.FreeBytes", "c", c), &out0)
	return c.Available
}

// IsEmpty returns true when no capacity information has been populated
// (i.e. Total is zero).
func (c *Capacity) IsEmpty() (out0 bool) {
	defer logger.Out1(logger.In1("disk/diskcapacity/dftool", "Capacity.IsEmpty", "c", c), &out0)
	return c.Total == 0
}

// String returns a human-readable summary of the capacity.
func (c *Capacity) String() string {
	logger.DebugTrace("disk/diskcapacity/dftool", "Capacity.String")
	return fmt.Sprintf("%s: used=%d available=%d total=%d", c.PhysicalDevice, c.Used, c.Available, c.Total)
}

// parseDFOutput parses the last data line from `df -kP` output and returns a
// Capacity struct. Capacity values are reported by df in 1024-byte blocks and
// are converted to bytes before being returned.
func parseDFOutput(output string) (out0 *Capacity, out1 error) {
	defer logger.Out2(logger.In1("disk/diskcapacity/dftool", "parseDFOutput", "output", output), &out0, &out1)
	diskInfo := strings.TrimSpace(output)
	tmp := strings.Split(diskInfo, "\n")
	targetDiskInfo := strings.Join(tmp[len(tmp)-1:], " ")
	for strings.Contains(targetDiskInfo, "  ") {
		targetDiskInfo = strings.ReplaceAll(targetDiskInfo, "  ", " ")
	}

	diskInfoSlice := strings.Split(targetDiskInfo, " ")

	if len(diskInfoSlice) < 4 {
		return nil, errors.New("Malformed output for df -P")
	}

	//Extract capacity information from df output
	total, err := strconv.ParseInt(diskInfoSlice[1], 10, 64)
	if err != nil {
		logger.DebugErr("disk/diskcapacity/dftool", err)
		return nil, errors.New("Malformed output for df -P")
	}

	used, err := strconv.ParseInt(diskInfoSlice[2], 10, 64)
	if err != nil {
		logger.DebugErr("disk/diskcapacity/dftool", err)
		return nil, errors.New("Malformed output for df -P")
	}

	availbe, err := strconv.ParseInt(diskInfoSlice[3], 10, 64)
	if err != nil {
		logger.DebugErr("disk/diskcapacity/dftool", err)
		return nil, errors.New("Malformed output for df -P")
	}

	//Return the capacity info struct, capacity is reported in 1024 bytes block
	return &Capacity{
		PhysicalDevice: diskInfoSlice[0],
		Used:           used * 1024,
		Available:      availbe * 1024,
		Total:          total * 1024,
	}, nil
}

// GetCapacityInfoFromPath reports the size of the disk holding realpath.
// How it is found depends on the platform (dftool_windows.go, dftool_unix.go).
func GetCapacityInfoFromPath(realpath string) (out0 *Capacity, out1 error) {
	defer logger.Out2(logger.In1("disk/diskcapacity/dftool", "GetCapacityInfoFromPath", "realpath", realpath), &out0, &out1)
	rpathAbs, err := filepath.Abs(realpath)
	if err != nil {
		logger.DebugErr("disk/diskcapacity/dftool", err)
		return nil, err
	}
	return capacityOf(rpathAbs)
}
