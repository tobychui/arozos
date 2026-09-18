package storage

/*
	Copy primitives used by the replication service (mod/cluster/replication):

	- PullCopy: fetch a verified copy of a file onto one of this node's volumes
	- DropCopy: remove a copy from any volume and forget it in the record
	- VerifyLocalCopies: re-checksum this node's copies within a byte budget
	- StartEvacuation / EvacuationStatus / FinishEvacuation: move everything
	  off a volume before it is retired
*/

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/info/logger"
)

// PullRequest describes one copy to make on the receiving node.
type PullRequest struct {
	FileID       string `json:"fileId"`
	Path         string `json:"path"`
	SourceNode   string `json:"sourceNode"`
	SourceVolume string `json:"sourceVolume"`
	TargetVolume string `json:"targetVolume"`
	Checksum     string `json:"checksum"`
	Size         int64  `json:"size"`
}

var (
	ErrFileGone       = errors.New("file no longer exists in the namespace")
	ErrSourceNotReady = errors.New("source copy is not readable")
)

// PullCopy makes a verified copy of a file on a local volume, fetching the
// bytes from the source volume (remote through the chunked protocol, or a
// local copy when the source is on this node too).
func (s *Service) PullCopy(ctx context.Context, req PullRequest) error {
	rec, ok := s.meta.FileByID(req.FileID)
	if !ok || rec.Removed || rec.IsDir {
		return ErrFileGone
	}
	if rec.Checksum != req.Checksum || rec.Path != metadata.NormalizePath(req.Path) {
		//The file changed since the task was planned; let the planner retry
		return errors.New("file changed since the copy was planned")
	}
	target, ok := s.meta.Volume(req.TargetVolume)
	if !ok || target.Removed || target.NodeID != s.m.NodeID() {
		return ErrNotLocalVolume
	}
	real, err := s.realPath(target, rec.Path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(real), 0755); err != nil {
		return err
	}
	part := real + ".part-" + uuid.NewV4().String()
	defer os.Remove(part)

	source, ok := s.meta.Volume(req.SourceVolume)
	if !ok || source.Removed {
		return ErrSourceNotReady
	}
	if source.NodeID == s.m.NodeID() {
		srcReal, err := s.realPath(source, rec.Path)
		if err != nil {
			return err
		}
		if err := copyFile(srcReal, part); err != nil {
			return err
		}
		sum, size, err := fileChecksum(part)
		if err != nil {
			return err
		}
		if sum != rec.Checksum || size != rec.Size {
			return ErrChecksum
		}
	} else {
		f, err := os.Create(part)
		if err != nil {
			return err
		}
		err = s.client.Download(ctx, source.NodeID, source.ID, rec.Path, f, rec.Checksum, nil)
		f.Close()
		if err != nil {
			return err
		}
	}
	if err := os.Rename(part, real); err != nil {
		return err
	}

	//Publish the new copy
	latest, ok := s.meta.FileByID(req.FileID)
	if !ok || latest.Removed || latest.Checksum != rec.Checksum {
		os.Remove(real)
		return ErrFileGone
	}
	latest.SetLocation(metadata.Location{VolumeID: target.ID, NodeID: s.m.NodeID(), State: metadata.LocVerified, Checksum: rec.Checksum})
	if latest.Primary == "" {
		latest.Primary = target.ID
	}
	if err := s.meta.Submit(metadata.KindFile, latest); err != nil {
		return err
	}
	if s.OnReplicaVerified != nil {
		s.OnReplicaVerified(*latest, target.ID)
	}
	return nil
}

// DropCopy removes the copy of a file on a volume (local or remote) and
// forgets it in the record. It never removes the last healthy copy.
func (s *Service) DropCopy(fileID string, volumeID string) error {
	rec, ok := s.meta.FileByID(fileID)
	if !ok {
		return ErrFileGone
	}
	loc, has := rec.Location(volumeID)
	if !has {
		return nil
	}
	if !rec.Removed && loc.Healthy() {
		others := 0
		for _, l := range rec.HealthyLocations() {
			if l.VolumeID != volumeID {
				others++
			}
		}
		if others == 0 {
			return errors.New("refusing to drop the last healthy copy")
		}
	}
	rec.RemoveLocation(volumeID)
	if rec.Primary == volumeID {
		rec.Primary = ""
		if h := rec.HealthyLocations(); len(h) > 0 {
			rec.Primary = h[0].VolumeID
		}
	}
	if err := s.meta.Submit(metadata.KindFile, rec); err != nil {
		return err
	}
	s.deletePhysical(loc, rec.Path)
	return nil
}

// VerifyResult summarises a verification pass.
type VerifyResult struct {
	Checked  int   `json:"checked"`
	Bytes    int64 `json:"bytes"`
	Verified int   `json:"verified"`
	Stale    int   `json:"stale"`
	Time     int64 `json:"time"`
}

// VerifyLocalCopies re-checksums this node's copies, least recently checked
// first, until budget bytes have been read. Mismatching or missing copies
// become stale; good ones become verified with a fresh timestamp.
func (s *Service) VerifyLocalCopies(budget int64) VerifyResult {
	res := VerifyResult{Time: time.Now().Unix()}
	if !s.Ready() {
		return res
	}
	me := s.m.NodeID()
	type item struct {
		rec metadata.FileRecord
		loc metadata.Location
	}
	items := []item{}
	for _, rec := range s.meta.AllFiles() {
		if rec.Removed || rec.IsDir {
			continue
		}
		for _, loc := range rec.Locations {
			if loc.NodeID == me && loc.Healthy() {
				items = append(items, item{rec, loc})
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].loc.Updated < items[j].loc.Updated })
	for _, it := range items {
		if budget > 0 && res.Bytes >= budget {
			break
		}
		vol, ok := s.meta.Volume(it.loc.VolumeID)
		if !ok {
			continue
		}
		real, err := s.realPath(vol, it.rec.Path)
		if err != nil {
			continue
		}
		res.Checked++
		sum, size, err := fileChecksum(real)
		res.Bytes += size
		latest, ok := s.meta.FileByID(it.rec.ID)
		if !ok || latest.Removed {
			continue
		}
		loc, has := latest.Location(it.loc.VolumeID)
		if !has {
			continue
		}
		if err != nil || sum != latest.Checksum || size != latest.Size {
			loc.State = metadata.LocStale
			res.Stale++
			logger.PrintAndLog("Cluster", "Copy of "+latest.Path+" on "+vol.Name+" failed verification", nil)
			if s.OnReplicaStale != nil {
				defer s.OnReplicaStale(*latest, vol.ID)
			}
		} else {
			loc.State = metadata.LocVerified
			loc.Checksum = sum
			res.Verified++
		}
		latest.SetLocation(loc)
		s.meta.Submit(metadata.KindFile, latest)
	}
	return res
}

// StartEvacuation marks a local volume as evacuating (read only, no new
// copies); the replication planner then moves its copies elsewhere.
func (s *Service) StartEvacuation(volumeID string) error {
	vol, ok := s.meta.Volume(volumeID)
	if !ok || vol.Removed {
		return errors.New("volume not found")
	}
	if vol.NodeID != s.m.NodeID() {
		return ErrNotLocalVolume
	}
	if vol.Evacuating {
		return nil
	}
	vol.Evacuating = true
	vol.ReadOnly = true
	return s.meta.Submit(metadata.KindVolume, vol)
}

// CancelEvacuation makes the volume writable again.
func (s *Service) CancelEvacuation(volumeID string) error {
	vol, ok := s.meta.Volume(volumeID)
	if !ok || vol.Removed || vol.NodeID != s.m.NodeID() {
		return errors.New("volume not found on this node")
	}
	vol.Evacuating = false
	vol.ReadOnly = false
	return s.meta.Submit(metadata.KindVolume, vol)
}

// EvacuationStatus reports what still references a volume.
type EvacuationStatus struct {
	VolumeID   string `json:"volumeId"`
	Evacuating bool   `json:"evacuating"`
	Remaining  int    `json:"remaining"` // files that still have a copy here
	SoleCopies int    `json:"soleCopies"`
	Bytes      int64  `json:"bytes"`
	Removed    bool   `json:"removed"`
}

// EvacuationStatus counts the copies still held on a volume.
func (s *Service) EvacuationStatus(volumeID string) EvacuationStatus {
	st := EvacuationStatus{VolumeID: volumeID}
	vol, ok := s.meta.Volume(volumeID)
	if !ok {
		return st
	}
	st.Evacuating, st.Removed = vol.Evacuating, vol.Removed
	for _, rec := range s.meta.AllFiles() {
		if rec.Removed || rec.IsDir {
			continue
		}
		if _, has := rec.Location(volumeID); has {
			st.Remaining++
			st.Bytes += rec.Size
			healthy := rec.HealthyLocations()
			if len(healthy) == 1 && healthy[0].VolumeID == volumeID {
				st.SoleCopies++
			}
		}
	}
	return st
}

// FinishEvacuation retires an evacuating volume once nothing references it.
func (s *Service) FinishEvacuation(volumeID string) (bool, error) {
	vol, ok := s.meta.Volume(volumeID)
	if !ok || vol.Removed || !vol.Evacuating {
		return false, nil
	}
	if st := s.EvacuationStatus(volumeID); st.Remaining > 0 {
		return false, nil
	}
	vol.Removed = true
	if err := s.meta.Submit(metadata.KindVolume, vol); err != nil {
		return false, err
	}
	s.forgetVolumeLocations(volumeID)
	logger.PrintAndLog("Cluster", "Volume "+vol.Name+" evacuated and retired", nil)
	return true, nil
}
