package raid

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// RAIDInfo represents information about a RAID array.
type RAIDInfo struct {
	DevicePath     string
	Version        string
	CreationTime   time.Time
	RaidLevel      string
	ArraySize      int
	UsedDevSize    int
	RaidDevices    int
	TotalDevices   int
	Persistence    string
	UpdateTime     time.Time
	State          string
	ActiveDevices  int
	WorkingDevices int
	FailedDevices  int
	SpareDevices   int
	Consistency    string
	RebuildStatus  string
	Name           string
	UUID           string
	Events         int
	DeviceInfo     []DeviceInfo
}

// DeviceInfo represents information about a device in a RAID array.
type DeviceInfo struct {
	State      []string
	DevicePath string
	RaidDevice int //Sequence of the raid device?
}

// GetRAIDInfo retrieves information about a RAID array using the mdadm command.
// arrayName must be in full path (e.g. /dev/md0)
func (m *Manager) GetRAIDInfo(arrayName string) (*RAIDInfo, error) {
	cmd := exec.Command("sudo", "mdadm", "--detail", arrayName)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("error running mdadm command: %v", err)
	}

	info := parseRAIDInfo(string(output))

	//Fill in the device path so other service can use it more easily
	info.DevicePath = arrayName
	return info, nil
}

// parseRAIDInfo parses the output of mdadm --detail command and returns the RAIDInfo struct.
func parseRAIDInfo(output string) *RAIDInfo {
	lines := strings.Split(output, "\n")

	raidInfo := &RAIDInfo{}
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			switch fields[0] {
			case "Version":
				raidInfo.Version = fields[2]
			case "Creation":
				creationTimeStr := strings.Join(fields[3:], " ")
				creationTime, _ := time.Parse(time.ANSIC, creationTimeStr)
				raidInfo.CreationTime = creationTime
			case "Raid":
				if fields[1] == "Level" {
					//Raid Level
					raidInfo.RaidLevel = fields[3]
				} else if fields[1] == "Devices" {
					raidInfo.RaidDevices, _ = strconv.Atoi(fields[3])
				}
			case "Array":
				raidInfo.ArraySize, _ = strconv.Atoi(fields[3])
			case "Used":
				raidInfo.UsedDevSize, _ = strconv.Atoi(fields[4])
			case "Total":
				raidInfo.TotalDevices, _ = strconv.Atoi(fields[3])
			case "Persistence":
				raidInfo.Persistence = strings.Join(fields[2:], " ")
			case "Update":
				updateTimeStr := strings.Join(fields[3:], " ")
				updateTime, _ := time.Parse(time.ANSIC, updateTimeStr)
				raidInfo.UpdateTime = updateTime
			case "State":
				raidInfo.State = strings.Join(fields[2:], " ")
			case "Active":
				raidInfo.ActiveDevices, _ = strconv.Atoi(fields[3])
			case "Working":
				raidInfo.WorkingDevices, _ = strconv.Atoi(fields[3])
			case "Failed":
				raidInfo.FailedDevices, _ = strconv.Atoi(fields[3])
			case "Spare":
				raidInfo.SpareDevices, _ = strconv.Atoi(fields[3])
			case "Consistency":
				raidInfo.Consistency = strings.Join(fields[3:], " ")
			case "Rebuild":
				raidInfo.RebuildStatus = strings.Join(fields[3:], " ")
			case "Name":
				raidInfo.Name = strings.Join(fields[2:], " ")
			case "UUID":
				raidInfo.UUID = fields[2]
			case "Events":
				raidInfo.Events, _ = strconv.Atoi(fields[2])
			default:
				if len(fields) >= 5 && fields[0] != "Number" {
					deviceInfo := DeviceInfo{}

					if len(fields) > 3 {
						rdNo, err := strconv.Atoi(fields[3])
						if err != nil {
							rdNo = -1
						}
						deviceInfo.RaidDevice = rdNo

					}

					if len(fields) > 5 {
						//Only active disks have fields > 5, e.g.
						// 0       8       16        0      active sync   /dev/sdb
						deviceInfo.State = fields[4 : len(fields)-1]
						deviceInfo.DevicePath = fields[len(fields)-1]
					} else {
						//Failed disk, e.g.
						//  -       0        0        1      removed

						deviceInfo.State = fields[4:]
						//TODO: Add custom tags
					}

					raidInfo.DeviceInfo = append(raidInfo.DeviceInfo, deviceInfo)
				}
			}
		}
	}

	return raidInfo
}

// PrettyPrintRAIDInfo pretty prints the RAIDInfo struct.
func (info *RAIDInfo) PrettyPrintRAIDInfo() {
	fmt.Println("RAID Array Information:")
	fmt.Printf("  Version: %s\n", info.Version)
	fmt.Printf("  Creation Time: %s\n", info.CreationTime.Format("Mon Jan 02 15:04:05 2006"))
	fmt.Printf("  Raid Level: %s\n", info.RaidLevel)
	fmt.Printf("  Array Size: %d\n", info.ArraySize)
	fmt.Printf("  Used Dev Size: %d\n", info.UsedDevSize)
	fmt.Printf("  Raid Devices: %d\n", info.RaidDevices)
	fmt.Printf("  Total Devices: %d\n", info.TotalDevices)
	fmt.Printf("  Persistence: %s\n", info.Persistence)
	fmt.Printf("  Update Time: %s\n", info.UpdateTime.Format("Mon Jan 02 15:04:05 2006"))
	fmt.Printf("  State: %s\n", info.State)
	fmt.Printf("  Active Devices: %d\n", info.ActiveDevices)
	fmt.Printf("  Working Devices: %d\n", info.WorkingDevices)
	fmt.Printf("  Failed Devices: %d\n", info.FailedDevices)
	fmt.Printf("  Spare Devices: %d\n", info.SpareDevices)
	fmt.Printf("  Consistency Policy: %s\n", info.Consistency)
	fmt.Printf("  Name: %s\n", info.Name)
	fmt.Printf("  UUID: %s\n", info.UUID)
	fmt.Printf("  Events: %d\n", info.Events)

	fmt.Println("\nDevice Information:")
	fmt.Printf("%s %s\n", "State", "DevicePath")
	for _, device := range info.DeviceInfo {
		fmt.Printf("%s %s\n", strings.Join(device.State, ","), device.DevicePath)
	}
}
