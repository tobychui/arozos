package raid

import (
	"fmt"
	"os/exec"
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
func GetRAIDStatus(arrayName string) (RAIDStatus, error) {
	cmd := exec.Command("mdadm", "--detail", arrayName)

	output, err := cmd.CombinedOutput()
	if err != nil {
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
func (status RAIDStatus) toString() string {
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
