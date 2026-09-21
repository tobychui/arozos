package main

/*
	Where a cluster:/ file physically lives.

	The cluster drive presents one namespace, but every file in it sits on
	one or more real volumes on real nodes, and which those are changes over
	time as the replication planner works. Nothing in an ordinary file
	listing shows that, so this file answers it: given a namespace path, it
	reads the metadata record and turns the record, the volumes it points at
	and the state of the nodes holding them into the generic shape the File
	Manager properties dialog renders (mod/filesystem/arozfs/storageinfo.go).

	It is a read of the local replica of the metadata store, so it costs
	nothing and works even while some of the nodes involved are offline.
*/

import (
	"errors"
	"path"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// Copy states in the words the dialog shows, and the colour each one gets
var clusterCopyStatus = map[string][2]string{
	metadata.LocVerified:  {"Verified", arozfs.StorageStateOK},
	metadata.LocCommitted: {"Committed", arozfs.StorageStateOK},
	metadata.LocPending:   {"Pending", arozfs.StorageStatePending},
	metadata.LocWriting:   {"Writing", arozfs.StorageStatePending},
	metadata.LocStale:     {"Stale", arozfs.StorageStateStale},
	metadata.LocFailed:    {"Failed", arozfs.StorageStateError},
}

// Node states in the words the dialog shows
var clusterNodeStateWords = map[membership.NodeState]string{
	membership.StateOnline:      "Online",
	membership.StateDegraded:    "Degraded",
	membership.StateOffline:     "Offline",
	membership.StateDraining:    "Draining",
	membership.StateMaintenance: "Maintenance",
	membership.StateUnknown:     "Unknown",
}

// StorageInfo resolves one namespace path into the copies that hold it. It
// completes the clusterfs.InfoBackend interface.
func (b *clusterBackend) StorageInfo(logical string) (arozfs.StorageInfo, error) {
	if clusterManager == nil || clusterMetadata == nil || !clusterManager.InCluster() {
		return arozfs.StorageInfo{}, errors.New("this node is not in a cluster")
	}

	rec, err := clusterMetadata.Stat(logical)
	if err != nil {
		return arozfs.StorageInfo{}, err
	}

	info := arozfs.StorageInfo{
		Type:  "cluster",
		Title: "Cluster",
	}

	//Properties of the file itself
	clusterName := ""
	if c := clusterManager.Cluster(); c != nil {
		clusterName = c.Name
	}
	policy := clusterMetadata.PolicyFor(rec.Path)
	info.Fields = append(info.Fields,
		arozfs.StorageInfoField{Key: "Cluster", Value: clusterName},
		arozfs.StorageInfoField{Key: "Namespace Path", Value: rec.Path},
	)

	if rec.IsDir {
		//A folder holds no copies of its own: what it decides is how many
		//copies the files created inside it are kept at
		info.Fields = append(info.Fields,
			clusterReplicaPolicyField(policy),
			arozfs.StorageInfoField{Key: "Items Inside", Value: clusterFolderItemCount(rec.Path)},
		)
		return info, nil
	}

	healthy := len(rec.HealthyLocations())
	info.Fields = append(info.Fields,
		clusterReplicaPolicyField(policy),
		clusterCopyCountField(healthy, len(rec.Locations)),
		arozfs.StorageInfoField{Key: "Checksum", Value: clusterChecksumText(rec.Checksum)},
		arozfs.StorageInfoField{Key: "File ID", Value: rec.ID},
	)
	if master := clusterMetadata.Leader(); master != "" {
		info.Fields = append(info.Fields,
			arozfs.StorageInfoField{Key: "Master Node", Value: clusterNodeLabelWithID(master)})
	}

	//One entry per physical copy, this node first so the reader sees at a
	//glance whether the file is on the host they are logged in to
	localNode := clusterManager.NodeID()
	for _, loc := range clusterOrderedLocations(rec, localNode) {
		info.Items = append(info.Items, clusterCopyItem(rec, loc, localNode))
	}

	return info, nil
}

// clusterOrderedLocations lists the copies of a file with this node first,
// then the readable ones, keeping the record order within each group.
func clusterOrderedLocations(rec *metadata.FileRecord, localNode string) []metadata.Location {
	ordered := []metadata.Location{}
	for pass := 0; pass < 3; pass++ {
		for _, loc := range rec.Locations {
			isLocal := loc.NodeID == localNode
			switch pass {
			case 0:
				if !isLocal {
					continue
				}
			case 1:
				if isLocal || !loc.Healthy() {
					continue
				}
			default:
				if isLocal || loc.Healthy() {
					continue
				}
			}
			ordered = append(ordered, loc)
		}
	}
	return ordered
}

// clusterCopyItem describes one physical copy of a file.
func clusterCopyItem(rec *metadata.FileRecord, loc metadata.Location, localNode string) arozfs.StorageInfoItem {
	status, state := "Unknown", arozfs.StorageStateUnknown
	if words, ok := clusterCopyStatus[loc.State]; ok {
		status, state = words[0], words[1]
	}

	item := arozfs.StorageInfoItem{
		Title:  clusterNodeLabel(loc.NodeID),
		State:  state,
		Status: status,
		Local:  loc.NodeID == localNode,
		Fields: []arozfs.StorageInfoField{{Key: "Node ID", Value: loc.NodeID}},
	}

	//Node health, as an offline node explains a copy that cannot be read
	if nodeState, found := clusterNodeState(loc.NodeID); found {
		words, ok := clusterNodeStateWords[nodeState]
		if !ok {
			words = string(nodeState)
		}
		item.Fields = append(item.Fields, arozfs.StorageInfoField{Key: "Node State", Value: words})
		if state == arozfs.StorageStateOK && nodeState != membership.StateOnline &&
			nodeState != membership.StateDegraded {
			//The copy itself is fine, the node holding it is not
			item.State = arozfs.StorageStateStale
		}
	} else {
		item.Fields = append(item.Fields,
			arozfs.StorageInfoField{Key: "Node State", Value: "Not a member"})
		item.State = arozfs.StorageStateStale
	}

	//The volume it landed on, and where that volume sits on the holding node
	if vol, ok := clusterMetadata.Volume(loc.VolumeID); ok {
		item.Subtitle = clusterVolumeRootText(*vol)
		item.Fields = append(item.Fields,
			arozfs.StorageInfoField{Key: "Volume", Value: vol.Name},
			arozfs.StorageInfoField{Key: "Volume ID", Value: vol.ID},
			arozfs.StorageInfoField{Key: "Volume Path", Value: clusterVolumePathText(*vol, rec.Path)},
		)
		if vol.Capacity > 0 {
			item.Fields = append(item.Fields, arozfs.StorageInfoField{Key: "Volume Free",
				Value: "{0} of {1}",
				Args:  []string{fs.GetFileDisplaySize(vol.Free, 2), fs.GetFileDisplaySize(vol.Capacity, 2)}})
		}
		if vol.Evacuating {
			item.Fields = append(item.Fields,
				arozfs.StorageInfoField{Key: "Volume Access", Value: "Evacuating"})
		} else if vol.ReadOnly || vol.LowSpace {
			item.Fields = append(item.Fields,
				arozfs.StorageInfoField{Key: "Volume Access", Value: "Read only"})
		}
	} else {
		//The volume record is gone, so name the copy by the ids it still has
		item.Subtitle = loc.NodeID + ":" + loc.VolumeID
		item.Fields = append(item.Fields,
			arozfs.StorageInfoField{Key: "Volume ID", Value: loc.VolumeID})
	}

	if loc.VolumeID == rec.Primary {
		item.Fields = append(item.Fields, arozfs.StorageInfoField{Key: "Primary Copy", Value: "Yes"})
	}

	//A copy whose hash no longer matches the file is worth seeing
	if loc.Checksum != "" && rec.Checksum != "" && loc.Checksum != rec.Checksum {
		item.Fields = append(item.Fields,
			arozfs.StorageInfoField{Key: "Checksum", Value: clusterChecksumText(loc.Checksum)})
	}

	if loc.Updated > 0 {
		item.Fields = append(item.Fields, arozfs.StorageInfoField{Key: "Last Checked",
			Value: time.Unix(loc.Updated, 0).Format("2006-01-02 15:04:05")})
	}

	return item
}

// clusterNodeState returns the computed state of a node, and whether the node
// is still a member at all.
func clusterNodeState(nodeID string) (membership.NodeState, bool) {
	for _, n := range clusterManager.NodeViews() {
		if n.ID == nodeID {
			return n.State, true
		}
	}
	return membership.StateUnknown, false
}

// clusterNodeLabel names a node, falling back to its ID when it has no name.
func clusterNodeLabel(nodeID string) string {
	name := clusterManager.NodeName(nodeID)
	if strings.TrimSpace(name) == "" {
		return nodeID
	}
	return name
}

// clusterNodeLabelWithID names a node and states its ID. Node names are
// operator set and default to the same "My ArOZ" on every host, so a name on
// its own cannot say which node is meant.
func clusterNodeLabelWithID(nodeID string) string {
	name := clusterManager.NodeName(nodeID)
	if strings.TrimSpace(name) == "" || name == nodeID {
		return nodeID
	}
	return name + " (" + nodeID + ")"
}

/*
	Paths across the cluster

	A path is only an answer if it says which node it is on, and the only
	thing that identifies a node is its UUID: names repeat, and the default
	name is the same on every fresh install. So every path this report shows
	is written <node uuid>:<drive uuid>/<path on that drive>, e.g.

		3f7a...c1:user/cluster/photos/a.jpg

	which reads as: on node 3f7a…c1, drive user, at /cluster/photos/a.jpg.
*/

// clusterVolumeRootText is the folder a volume contributes, node included.
func clusterVolumeRootText(vol metadata.Volume) string {
	return vol.NodeID + ":" + vol.FshUUID + path.Join("/", vol.Subpath)
}

// clusterVolumePathText is where one copy of a file sits, node included.
func clusterVolumePathText(vol metadata.Volume, logical string) string {
	return vol.NodeID + ":" + vol.FshUUID + path.Join("/", vol.Subpath, logical)
}

// clusterReplicaPolicyField reports how many copies of each file the folder
// policy asks for.
func clusterReplicaPolicyField(policy metadata.Policy) arozfs.StorageInfoField {
	if policy.Replicas <= 1 {
		return arozfs.StorageInfoField{Key: "Replica Policy", Value: "{0} copy",
			Args: []string{"1"}}
	}
	return arozfs.StorageInfoField{Key: "Replica Policy", Value: "{0} copies",
		Args: []string{strconv.Itoa(policy.Replicas)}}
}

// clusterCopyCountField reports how many copies of a file can be read now.
func clusterCopyCountField(healthy int, total int) arozfs.StorageInfoField {
	if healthy == total {
		return arozfs.StorageInfoField{Key: "Copies", Value: "{0}",
			Args: []string{strconv.Itoa(total)}}
	}
	return arozfs.StorageInfoField{Key: "Copies", Value: "{0} of {1} readable",
		Args: []string{strconv.Itoa(healthy), strconv.Itoa(total)}}
}

// clusterChecksumText shortens a hash to something a dialog row can hold.
func clusterChecksumText(checksum string) string {
	if checksum == "" {
		return ""
	}
	if len(checksum) > 24 {
		return checksum[:24] + "..."
	}
	return checksum
}

// clusterFolderItemCount counts the records directly inside a folder.
func clusterFolderItemCount(folder string) string {
	entries, err := clusterMetadata.ListDir(folder)
	if err != nil {
		return "0"
	}
	return strconv.Itoa(len(entries))
}
