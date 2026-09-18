package metadata

/*
	ArozOS Cluster Metadata Store (ACMS) - types

	The metadata store is the replicated index of the cluster namespace:
	which logical paths exist, which volumes hold a copy of each file, and
	the replica policy per folder. Files themselves never pass through it.

	Consistency model: every record carries a Version stamp; records are
	merged last-writer-wins on every node. The replicated log (log.go) only
	carries records between nodes; a node that missed entries can always be
	brought back in line with a snapshot, and the real files on disk remain
	the ultimate source of truth (storage reconcile).
*/

import (
	"encoding/json"
	"path"
	"strings"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
)

// Volume is a folder one node contributes to the namespace.
type Volume struct {
	ID       string `json:"id"`
	NodeID   string `json:"nodeId"`
	Name     string `json:"name"`
	FshUUID  string `json:"fshUuid"`
	Subpath  string `json:"subpath"` // inside the fsh, "/x/y" form
	Capacity int64  `json:"capacity"`
	Free     int64  `json:"free"`
	ReadOnly bool   `json:"readOnly"`
	//Evacuating volumes accept no new copies and have their existing copies
	//moved elsewhere by the replication service before they are removed.
	Evacuating bool  `json:"evacuating"`
	Removed    bool  `json:"removed"`
	Version    int64 `json:"version"`
}

// Location states of one physical copy.
const (
	LocPending   = "pending"
	LocWriting   = "writing"
	LocCommitted = "committed"
	LocVerified  = "verified"
	LocStale     = "stale"
	LocFailed    = "failed"
)

// Location is one physical copy of a file.
type Location struct {
	VolumeID string `json:"volumeId"`
	NodeID   string `json:"nodeId"`
	State    string `json:"state"`
	Checksum string `json:"checksum"`
	Updated  int64  `json:"updated"`
}

// Healthy reports whether the copy can be read.
func (l Location) Healthy() bool {
	return l.State == LocCommitted || l.State == LocVerified
}

// FileRecord describes one logical path (file or directory).
type FileRecord struct {
	ID        string     `json:"id"`
	Path      string     `json:"path"`
	IsDir     bool       `json:"isDir"`
	Size      int64      `json:"size"`
	ModTime   int64      `json:"modTime"`
	Checksum  string     `json:"checksum"`
	Owner     string     `json:"owner"`
	Primary   string     `json:"primary"`
	Locations []Location `json:"locations"`
	Replicas  int        `json:"replicas"`
	Removed   bool       `json:"removed"`
	Version   int64      `json:"version"`
}

// Clone returns an independent copy.
func (f *FileRecord) Clone() *FileRecord {
	c := *f
	c.Locations = append([]Location{}, f.Locations...)
	return &c
}

// Location returns the copy on the given volume, if any.
func (f *FileRecord) Location(volumeID string) (Location, bool) {
	for _, l := range f.Locations {
		if l.VolumeID == volumeID {
			return l, true
		}
	}
	return Location{}, false
}

// SetLocation adds or replaces the copy on the given volume.
func (f *FileRecord) SetLocation(loc Location) {
	loc.Updated = time.Now().Unix()
	for i, l := range f.Locations {
		if l.VolumeID == loc.VolumeID {
			f.Locations[i] = loc
			return
		}
	}
	f.Locations = append(f.Locations, loc)
}

// RemoveLocation drops the copy on the given volume.
func (f *FileRecord) RemoveLocation(volumeID string) {
	out := f.Locations[:0]
	for _, l := range f.Locations {
		if l.VolumeID != volumeID {
			out = append(out, l)
		}
	}
	f.Locations = out
}

// HealthyLocations lists readable copies.
func (f *FileRecord) HealthyLocations() []Location {
	out := []Location{}
	for _, l := range f.Locations {
		if l.Healthy() {
			out = append(out, l)
		}
	}
	return out
}

// Policy is the desired replica count for a top-level folder.
type Policy struct {
	Folder   string `json:"folder"`
	Replicas int    `json:"replicas"`
	Version  int64  `json:"version"`
}

// Record kinds carried by the log.
const (
	KindFile   = "file"
	KindVolume = "volume"
	KindPolicy = "policy"
)

// Entry is one replicated change.
type Entry struct {
	Seq     uint64          `json:"seq"`
	Term    uint64          `json:"term"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
	Version int64           `json:"version"`
	Origin  string          `json:"origin"`
}

// Lease is the metadata leadership lease.
type Lease struct {
	Holder  string `json:"holder"`
	Term    uint64 `json:"term"`
	Expires int64  `json:"expires"`
}

// Wire payloads
type AppendRequest struct {
	Entries []Entry `json:"entries"`
}

type LogResponse struct {
	Entries []Entry `json:"entries"`
	LastSeq uint64  `json:"lastSeq"`
	Term    uint64  `json:"term"`
}

type Snapshot struct {
	Files    []FileRecord `json:"files"`
	Volumes  []Volume     `json:"volumes"`
	Policies []Policy     `json:"policies"`
	LastSeq  uint64       `json:"lastSeq"`
	Term     uint64       `json:"term"`
}

type LeaseRequest struct {
	Lease   Lease  `json:"lease"`
	LastSeq uint64 `json:"lastSeq"`
}

type LeaseResponse struct {
	Lease   Lease  `json:"lease"`
	LastSeq uint64 `json:"lastSeq"`
}

// NormalizePath turns any user supplied logical path into the canonical
// form: forward slashes, cleaned, leading slash, no trailing slash except
// for the root, optional "cluster:" prefix removed.
func NormalizePath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, "\\", "/")
	if i := strings.Index(p, ":"); i >= 0 && i < 16 && !strings.Contains(p[:i], "/") {
		p = p[i+1:]
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)
	if p == "." {
		p = "/"
	}
	return p
}

// ParentPath returns the parent of a normalized path ("/" for the root).
func ParentPath(p string) string {
	if p == "/" {
		return "/"
	}
	return path.Dir(p)
}

// TopFolder returns "/photos" for "/photos/2026/a.jpg" ("/" for root entries).
func TopFolder(p string) string {
	p = NormalizePath(p)
	if p == "/" {
		return "/"
	}
	parts := strings.SplitN(strings.TrimPrefix(p, "/"), "/", 2)
	return "/" + parts[0]
}

func nextVersion(prev int64) int64 { return membership.NextVersion(prev) }
