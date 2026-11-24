//go:build windows

package dftool

import (
	"errors"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/disk/diskspace"
)

// capacityOf finds the logical disk an absolute path is on, such as C:.
func capacityOf(rpathAbs string) (*Capacity, error) {
	rpathAbs = filepath.ToSlash(filepath.Clean(rpathAbs))
	diskRoot := strings.Split(rpathAbs, "/")[0]
	for _, ldi := range diskspace.GetAllLogicDiskInfo() {
		if strings.TrimSpace(ldi.Device) == strings.TrimSpace(diskRoot) {
			return &Capacity{
				PhysicalDevice: ldi.Device,
				Used:           ldi.Used,
				Available:      ldi.Available,
				Total:          ldi.Volume,
			}, nil
		}
	}
	return nil, errors.New("Unable to resolve matching disk capacity information")
}
