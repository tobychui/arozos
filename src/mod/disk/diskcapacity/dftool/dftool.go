package dftool

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/disk/diskspace"
)

type Capacity struct {
	PhysicalDevice string //The ID of the physical device, like C:/ or /dev/sda1
	Used           int64  //Used capacity in bytes
	Available      int64  //Avilable capacity in bytes
	Total          int64  //Total capacity in bytes
}

// UsedPercent returns the percentage of disk space currently used (0–100).
// Returns 0 if Total is zero to avoid division by zero.
func (c *Capacity) UsedPercent() float64 {
	if c.Total == 0 {
		return 0
	}
	return float64(c.Used) / float64(c.Total) * 100
}

// FreeBytes returns the number of bytes available for use.
func (c *Capacity) FreeBytes() int64 {
	return c.Available
}

// IsEmpty returns true when no capacity information has been populated
// (i.e. Total is zero).
func (c *Capacity) IsEmpty() bool {
	return c.Total == 0
}

// String returns a human-readable summary of the capacity.
func (c *Capacity) String() string {
	return fmt.Sprintf("%s: used=%d available=%d total=%d", c.PhysicalDevice, c.Used, c.Available, c.Total)
}

// parseDFOutput parses the last data line from `df -P` output and returns a
// Capacity struct. Capacity values are reported by df in 1024-byte blocks and
// are converted to bytes before being returned.
func parseDFOutput(output string) (*Capacity, error) {
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
		return nil, errors.New("Malformed output for df -P")
	}

	used, err := strconv.ParseInt(diskInfoSlice[2], 10, 64)
	if err != nil {
		return nil, errors.New("Malformed output for df -P")
	}

	availbe, err := strconv.ParseInt(diskInfoSlice[3], 10, 64)
	if err != nil {
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

func GetCapacityInfoFromPath(realpath string) (*Capacity, error) {
	rpathAbs, err := filepath.Abs(realpath)
	if err != nil {
		return nil, err
	}

	if runtime.GOOS == "windows" {
		//Windows
		//Extract disk ID from path
		rpathAbs = filepath.ToSlash(filepath.Clean(rpathAbs))
		diskRoot := strings.Split(rpathAbs, "/")[0]

		//Match the disk space info generated from diskspace
		logicDiskInfo := diskspace.GetAllLogicDiskInfo()
		for _, ldi := range logicDiskInfo {
			if strings.TrimSpace(ldi.Device) == strings.TrimSpace(diskRoot) {
				//Matching device ID
				return &Capacity{
					PhysicalDevice: ldi.Device,
					Used:           ldi.Used,
					Available:      ldi.Available,
					Total:          ldi.Volume,
				}, nil
			}
		}

	} else {
		//Assume Linux or Mac
		//Use command: df -P {abs_path}
		cmd := exec.Command("df", "-P", rpathAbs)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return nil, err
		}

		return parseDFOutput(string(out))
	}

	return nil, errors.New("Unable to resolve matching disk capacity information")
}
