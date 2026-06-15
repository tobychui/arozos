//go:build darwin

package diskmg

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

/* ── diskutil list -plist (after plutil JSON conversion) ── */

type duListOutput struct {
	AllDisksAndPartitions []duDiskEntry `json:"AllDisksAndPartitions"`
	WholeDisks            []string      `json:"WholeDisks"`
}

type duDiskEntry struct {
	Content            string         `json:"Content"`
	DeviceIdentifier   string         `json:"DeviceIdentifier"`
	Size               int64          `json:"Size"`
	OSInternal         bool           `json:"OSInternal"`
	Partitions         []duPartEntry  `json:"Partitions"`
	APFSVolumes        []duAPFSVolume `json:"APFSVolumes"`
	APFSPhysicalStores []struct {
		DeviceIdentifier string `json:"DeviceIdentifier"`
	} `json:"APFSPhysicalStores"`
}

type duPartEntry struct {
	Content          string `json:"Content"`
	DeviceIdentifier string `json:"DeviceIdentifier"`
	Size             int64  `json:"Size"`
	VolumeName       string `json:"VolumeName"`
}

type duAPFSVolume struct {
	DeviceIdentifier string `json:"DeviceIdentifier"`
	VolumeName       string `json:"VolumeName"`
	MountPoint       string `json:"MountPoint"`
	Size             int64  `json:"Size"`
	CapacityInUse    int64  `json:"CapacityInUse"`
	OSInternal       bool   `json:"OSInternal"`
	MountedSnapshots []struct {
		SnapshotMountPoint string `json:"SnapshotMountPoint"`
		SnapshotBSD        string `json:"SnapshotBSD"`
	} `json:"MountedSnapshots"`
}

/* ── diskutil info -plist (after plutil JSON conversion) ── */

type duInfoOutput struct {
	MediaName                      string `json:"MediaName"`
	Internal                       bool   `json:"Internal"`
	RemovableMediaOrExternalDevice bool   `json:"RemovableMediaOrExternalDevice"`
}

/* ── Response types sent to the frontend ── */

// DarwinDisk represents one physical disk or APFS container returned to the UI.
type DarwinDisk struct {
	Identifier string            `json:"identifier"`
	Model      string            `json:"model"`
	Size       int64             `json:"size"`
	Internal   bool              `json:"internal"`
	Removable  bool              `json:"removable"`
	Partitions []DarwinPartition `json:"partitions"`
}

// DarwinPartition represents a GPT partition or an APFS volume.
type DarwinPartition struct {
	Identifier    string `json:"identifier"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	Fstype        string `json:"fstype"`
	Mountpoint    string `json:"mountpoint"`
	Size          int64  `json:"size"`
	CapacityInUse int64  `json:"capacityInUse"`
	UsedPct       int    `json:"usedPct"`
}

/* ── Helpers ── */

// diskutilToJSON runs diskutil with the given args, pipes the plist output
// through plutil to get JSON, and returns the raw JSON bytes.
func diskutilToJSON(args ...string) ([]byte, error) {
	duOut, err := exec.Command("diskutil", args...).Output()
	if err != nil {
		return nil, err
	}
	plCmd := exec.Command("plutil", "-convert", "json", "-o", "-", "-")
	plCmd.Stdin = bytes.NewReader(duOut)
	return plCmd.Output()
}

// contentToFstype maps a diskutil "Content" partition type to a conventional
// filesystem label shown in the UI.
func contentToFstype(content string) string {
	switch content {
	case "EFI":
		return "msdos"
	case "Apple_APFS", "Apple_APFS_Container":
		return "apfs"
	case "Apple_HFS", "Apple_Boot", "Recovery HD":
		return "hfs"
	case "Microsoft Basic Data":
		return "ntfs"
	case "Linux Filesystem":
		return "ext4"
	case "GUID_partition_scheme", "Apple_partition_scheme":
		return ""
	default:
		return strings.ToLower(content)
	}
}

/* ── Handlers ── */

// handleViewDarwin serves GET /system/disk/diskmg/view on macOS.
// It returns a JSON array of DarwinDisk objects covering every physical disk
// and APFS container (with volumes) visible to diskutil.
func handleViewDarwin(w http.ResponseWriter, r *http.Request) {
	// One call gives us the complete disk/partition/APFS-volume tree.
	jsonOut, err := diskutilToJSON("list", "-plist")
	if err != nil {
		utils.SendErrorResponse(w, "diskutil list failed: "+err.Error())
		return
	}

	var dl duListOutput
	if err := json.Unmarshal(jsonOut, &dl); err != nil {
		utils.SendErrorResponse(w, "parse diskutil list: "+err.Error())
		return
	}

	result := make([]DarwinDisk, 0, len(dl.AllDisksAndPartitions))

	for _, entry := range dl.AllDisksAndPartitions {
		disk := DarwinDisk{
			Identifier: entry.DeviceIdentifier,
			Size:       entry.Size,
			Internal:   true,
			Partitions: []DarwinPartition{},
		}

		// Fetch model name (and true internal/removable flags) for each whole disk.
		// This is one extra exec per disk but the count is always small (2-4 disks).
		if infoJSON, err := diskutilToJSON("info", "-plist", entry.DeviceIdentifier); err == nil {
			var info duInfoOutput
			if json.Unmarshal(infoJSON, &info) == nil {
				disk.Model = info.MediaName
				disk.Internal = info.Internal
				disk.Removable = info.RemovableMediaOrExternalDevice
			}
		}

		// GPT / MBR partitions (physical slices like disk0s1, disk0s2)
		for _, p := range entry.Partitions {
			part := DarwinPartition{
				Identifier: p.DeviceIdentifier,
				Name:       p.VolumeName,
				Type:       p.Content,
				Fstype:     contentToFstype(p.Content),
				Size:       p.Size,
			}
			disk.Partitions = append(disk.Partitions, part)
		}

		// APFS volumes (synthesized inside an APFS container like disk1)
		for _, v := range entry.APFSVolumes {
			mountPoint := v.MountPoint
			// Sealed system volumes mount via a snapshot; the real mount point
			// is in MountedSnapshots[0].SnapshotMountPoint.
			if mountPoint == "" && len(v.MountedSnapshots) > 0 {
				mountPoint = v.MountedSnapshots[0].SnapshotMountPoint
			}

			usedPct := 0
			if entry.Size > 0 && v.CapacityInUse > 0 {
				usedPct = int(float64(v.CapacityInUse) / float64(entry.Size) * 100)
				if usedPct > 100 {
					usedPct = 100
				}
			}

			part := DarwinPartition{
				Identifier:    v.DeviceIdentifier,
				Name:          v.VolumeName,
				Type:          "APFS Volume",
				Fstype:        "apfs",
				Mountpoint:    mountPoint,
				Size:          v.CapacityInUse, // show actual space in use as the volume "size"
				CapacityInUse: v.CapacityInUse,
				UsedPct:       usedPct,
			}
			disk.Partitions = append(disk.Partitions, part)
		}

		result = append(result, disk)
	}

	js, _ := json.Marshal(result)
	utils.SendJSONResponse(w, string(js))
}

// handleMountDarwin handles mount / unmount for macOS via diskutil.
// It accepts GET parameters: dev (disk identifier), umount (true/false).
// The format and mnt parameters accepted by the Linux handler are ignored here
// because diskutil determines the mount point automatically.
func handleMountDarwin(w http.ResponseWriter, r *http.Request) {
	targetDev, err := utils.GetPara(r, "dev")
	if err != nil || targetDev == "" {
		utils.SendErrorResponse(w, "dev not defined")
		return
	}
	if !isDarwinDeviceValid(targetDev) {
		utils.SendErrorResponse(w, "Invalid device identifier: "+targetDev)
		return
	}

	umount, _ := utils.GetPara(r, "umount")

	var cmd *exec.Cmd
	if umount == "true" {
		cmd = exec.Command("diskutil", "unmount", targetDev)
	} else {
		cmd = exec.Command("diskutil", "mount", targetDev)
	}

	out, cmdErr := cmd.CombinedOutput()
	msg := strings.TrimSpace(string(out))
	if cmdErr != nil {
		utils.SendErrorResponse(w, msg)
		return
	}
	utils.SendTextResponse(w, msg)
}

// isDarwinDeviceValid returns true when id looks like a valid macOS disk
// identifier: disk<N> or disk<N>s<N>[s<N>...], e.g. disk0, disk0s1, disk1s4s1.
func isDarwinDeviceValid(id string) bool {
	if !strings.HasPrefix(id, "disk") {
		return false
	}
	rest := id[4:]
	if rest == "" {
		return false
	}
	for _, c := range rest {
		if (c < '0' || c > '9') && c != 's' {
			return false
		}
	}
	return true
}
