package main

/*
	Tests for the cluster side of two features that cross into the core:

	- which node performs nightly maintenance of a file system handler
	- how a cluster file record is turned into the rows and locations the
	  File Manager properties dialog shows
*/

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/cluster/metadata"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/time/nightly"
)

func TestNightlyFshOption(t *testing.T) {
	testcases := []struct {
		name       string
		fsh        *fs.FileSystemHandler
		masterOnly bool
	}{
		{"cluster drive", &fs.FileSystemHandler{Filesystem: "cluster"}, true},
		{"local disk", &fs.FileSystemHandler{Filesystem: "ext4"}, false},
		{"network drive", &fs.FileSystemHandler{Filesystem: "webdav"}, false},
		{"no handler", nil, false},
	}

	for _, tc := range testcases {
		t.Run(tc.name, func(t *testing.T) {
			if got := nightlyFshOption(tc.fsh).MasterNodeOnly; got != tc.masterOnly {
				t.Errorf("Expected MasterNodeOnly to be %v, got %v", tc.masterOnly, got)
			}
		})
	}
}

// Every node sees the same files on cluster:/, so a nightly pass that runs
// on all of them deletes the same expired trash and version history once per
// node. Only the master node does that work; the local drives of each node
// are still maintained by that node.
func TestNightlyShouldMaintainFsh(t *testing.T) {
	previous := nightlyManager
	defer func() { nightlyManager = previous }()
	nightlyManager = nightly.NewNightlyTaskManager(3)

	clusterDrive := &fs.FileSystemHandler{Filesystem: "cluster"}
	localDrive := &fs.FileSystemHandler{Filesystem: "ext4"}

	nightlyManager.SetMasterNodeResolver(func() bool { return false })
	if nightlyShouldMaintainFsh(clusterDrive) {
		t.Error("Expected cluster:/ maintenance to be left to the master node")
	}
	if !nightlyShouldMaintainFsh(localDrive) {
		t.Error("Expected a local drive to be maintained by its own host")
	}

	nightlyManager.SetMasterNodeResolver(func() bool { return true })
	if !nightlyShouldMaintainFsh(clusterDrive) {
		t.Error("Expected the master node to maintain cluster:/")
	}
}

func TestClusterIsMasterNodeWithoutCluster(t *testing.T) {
	previous := clusterManager
	defer func() { clusterManager = previous }()
	clusterManager = nil

	//A host with no cluster is the only node there is
	if !clusterIsMasterNode() {
		t.Error("Expected a host outside a cluster to count as the master node")
	}
}

// Copy ordering: the first question anyone opening the tab has is whether
// the file is on the host they are using, and the second is which copies can
// be read at all.
func TestClusterOrderedLocations(t *testing.T) {
	rec := &metadata.FileRecord{Locations: []metadata.Location{
		{VolumeID: "v-far", NodeID: "node-c", State: metadata.LocFailed},
		{VolumeID: "v-ok", NodeID: "node-b", State: metadata.LocVerified},
		{VolumeID: "v-here", NodeID: "node-a", State: metadata.LocCommitted},
		{VolumeID: "v-stale", NodeID: "node-d", State: metadata.LocStale},
	}}

	got := []string{}
	for _, loc := range clusterOrderedLocations(rec, "node-a") {
		got = append(got, loc.VolumeID)
	}

	wanted := "v-here,v-ok,v-far,v-stale"
	if strings.Join(got, ",") != wanted {
		t.Errorf("Expected the copies in the order %q, got %q", wanted, strings.Join(got, ","))
	}
	if len(got) != len(rec.Locations) {
		t.Errorf("Expected all %d copies to be listed, got %d", len(rec.Locations), len(got))
	}
}

func TestClusterReplicaPolicyField(t *testing.T) {
	testcases := []struct {
		replicas int
		value    string
		arg      string
	}{
		{0, "{0} copy", "1"}, //a folder with no policy keeps one copy
		{1, "{0} copy", "1"},
		{3, "{0} copies", "3"},
	}

	for _, tc := range testcases {
		field := clusterReplicaPolicyField(metadata.Policy{Replicas: tc.replicas})
		if field.Value != tc.value || len(field.Args) != 1 || field.Args[0] != tc.arg {
			t.Errorf("Policy of %d replicas gave %q %v, wanted %q [%s]",
				tc.replicas, field.Value, field.Args, tc.value, tc.arg)
		}
	}
}

func TestClusterCopyCountField(t *testing.T) {
	//Nothing to point out while every copy can be read
	full := clusterCopyCountField(2, 2)
	if full.Value != "{0}" || full.Args[0] != "2" {
		t.Errorf("Expected a plain count, got %q %v", full.Value, full.Args)
	}

	//A copy that cannot be read is the whole point of the row
	partial := clusterCopyCountField(1, 3)
	if partial.Value != "{0} of {1} readable" || partial.Args[0] != "1" || partial.Args[1] != "3" {
		t.Errorf("Expected a readable count, got %q %v", partial.Value, partial.Args)
	}
}

func TestClusterVolumePathText(t *testing.T) {
	vol := metadata.Volume{FshUUID: "user", Subpath: "/cluster"}
	if got := clusterVolumePathText(vol, "/docs/a.txt"); got != "user:/cluster/docs/a.txt" {
		t.Errorf("Expected the path on the holding node, got %q", got)
	}

	//A volume contributed at the root of its drive
	root := metadata.Volume{FshUUID: "s1", Subpath: ""}
	if got := clusterVolumePathText(root, "/a.txt"); got != "s1:/a.txt" {
		t.Errorf("Expected a root volume path, got %q", got)
	}
}

func TestClusterChecksumText(t *testing.T) {
	long := strings.Repeat("a", 64)
	if got := clusterChecksumText(long); len(got) != 27 || !strings.HasSuffix(got, "...") {
		t.Errorf("Expected a shortened hash, got %q", got)
	}
	if got := clusterChecksumText("abc"); got != "abc" {
		t.Errorf("Expected a short hash to be left alone, got %q", got)
	}
	if got := clusterChecksumText(""); got != "" {
		t.Errorf("Expected no text for a file with no hash, got %q", got)
	}
}

func TestClusterCopyStatusCoversEveryState(t *testing.T) {
	//A state with no entry would show up as Unknown in the dialog
	states := []string{metadata.LocPending, metadata.LocWriting, metadata.LocCommitted,
		metadata.LocVerified, metadata.LocStale, metadata.LocFailed}
	for _, state := range states {
		words, ok := clusterCopyStatus[state]
		if !ok {
			t.Errorf("No wording for the copy state %q", state)
			continue
		}
		switch words[1] {
		case arozfs.StorageStateOK, arozfs.StorageStatePending,
			arozfs.StorageStateStale, arozfs.StorageStateError:
		default:
			t.Errorf("Copy state %q maps to the unexpected display state %q", state, words[1])
		}
	}
}
