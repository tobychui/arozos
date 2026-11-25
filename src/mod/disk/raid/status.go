package raid

import (
	"fmt"
	"os/exec"

	"imuslab.com/arozos/mod/info/logger"
)

// RAIDStatus represents the status of a RAID array.
type RAIDStatus int

const (
	RAIDStatusNormal    RAIDStatus = 0
	RAIDStatusOneFailed RAIDStatus = 1
	RAIDStatusUnusable  RAIDStatus = 2
	RAIDStatusError     RAIDStatus = 4
	RAIDStatusUnknown   RAIDStatus = -1
)

// GetRAIDStatus scans and checks a given RAID array and returns the array status.
func GetRAIDStatus(arrayName string) (out0 RAIDStatus, out1 error) {
	defer logger.Out2(logger.In1("disk/raid", "GetRAIDStatus", "arrayName", arrayName), &out0, &out1)
	cmd := exec.Command("mdadm", "--detail", arrayName)

	output, err := cmd.CombinedOutput()
	if err != nil {
		logger.DebugErr("disk/raid", err)
		// Error occurred while getting information about the array
		return RAIDStatusError, fmt.Errorf("error getting RAID array status: %v", err)
	}

	exitStatus := cmd.ProcessState.ExitCode()
	switch exitStatus {
	case 0:
		// The array is functioning normally
		return RAIDStatusNormal, nil
	case 1:
		// The array has at least one failed device
		return RAIDStatusOneFailed, nil
	case 2:
		// The array has multiple failed devices such that it is unusable
		return RAIDStatusUnusable, nil
	case 4:
		// There was an error while trying to get information about the device
		return RAIDStatusError, fmt.Errorf("error getting information about the RAID array: %s", string(output))
	default:
		// Unknown exit status
		return RAIDStatusUnknown, fmt.Errorf("unknown exit status: %d", exitStatus)
	}
}

// toString returns the string representation of the RAIDStatus.
func (status RAIDStatus) toString() (out0 string) {
	defer logger.Out1(logger.In1("disk/raid", "RAIDStatus.toString", "&status", &status), &out0)
	switch status {
	case RAIDStatusNormal:
		return "Normal"
	case RAIDStatusOneFailed:
		return "One Failed Device"
	case RAIDStatusUnusable:
		return "Unusable (Multiple Failed Devices)"
	case RAIDStatusError:
		return "Error"
	case RAIDStatusUnknown:
		return "Unknown"
	default:
		return "Invalid Status"
	}
}

// Report if the RAID array is healthy
func (status RAIDStatus) isHealthy() (out0 bool) {
	defer logger.Out1(logger.In1("disk/raid", "RAIDStatus.isHealthy", "&status", &status), &out0)
	switch status {
	case RAIDStatusNormal:
		return true
	default:
		return false
	}
}
