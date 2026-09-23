package storage

/*
	Reconcile: the real files on this node's volumes are authoritative. A
	rescan adopts files that appeared in a contributed folder, restores a
	metadata store that was rebuilt, and downgrades copies that changed on
	disk to stale. It never deletes real files.
*/

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/info/logger"
)

// ReconcileResult summarises one rescan.
type ReconcileResult struct {
	VolumeID string `json:"volumeId"`
	Adopted  int    `json:"adopted"`  // files that had no record
	Attached int    `json:"attached"` // records that gained this volume as a copy
	Stale    int    `json:"stale"`    // copies that no longer match or are missing
	Scanned  int    `json:"scanned"`
	Error    string `json:"error,omitempty"`
	Time     int64  `json:"time"`
}

// ReconcileAll rescans every local volume.
func (s *Service) ReconcileAll() []ReconcileResult {
	out := []ReconcileResult{}
	if !s.Ready() {
		return out
	}
	for _, v := range s.LocalVolumes() {
		out = append(out, s.reconcileVolume(v))
	}
	return out
}

func (s *Service) reconcileVolume(vol metadata.Volume) ReconcileResult {
	res := ReconcileResult{VolumeID: vol.ID, Time: time.Now().Unix()}
	root, err := s.volumeRoot(&vol)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	seen := map[string]bool{}
	cutoff := time.Now().Add(-SessionTTL)
	me := s.m.NodeID()

	walkErr := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if p == root {
			return nil
		}
		name := d.Name()
		if strings.Contains(name, ".part-") {
			if fi, err := d.Info(); err == nil && fi.ModTime().Before(cutoff) {
				os.Remove(p)
			}
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		logical := metadata.NormalizePath(filepath.ToSlash(rel))
		if d.IsDir() {
			if _, err := s.meta.Stat(logical); err != nil {
				s.ensureDirs(logical, "")
			}
			return nil
		}
		res.Scanned++
		seen[logical] = true
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		rec, err := s.meta.Stat(logical)
		if err != nil {
			//No record: adopt the file
			sum, size, err := fileChecksum(p)
			if err != nil {
				return nil
			}
			if err := s.ensureDirs(metadata.ParentPath(logical), ""); err != nil {
				return nil
			}
			newRec := &metadata.FileRecord{
				ID:       uuid.NewV4().String(),
				Path:     logical,
				Size:     size,
				ModTime:  fi.ModTime().Unix(),
				Checksum: sum,
				Primary:  vol.ID,
			}
			newRec.SetLocation(metadata.Location{VolumeID: vol.ID, NodeID: me, State: metadata.LocCommitted, Checksum: sum})
			if s.meta.Submit(metadata.KindFile, newRec) == nil {
				res.Adopted++
			}
			return nil
		}
		if rec.IsDir {
			return nil //a file where the namespace has a directory: leave it alone
		}
		loc, hasLoc := rec.Location(vol.ID)
		if hasLoc && loc.Healthy() && fi.Size() == rec.Size {
			return nil //fast path: size matches, trust it (nightly verify re-checks)
		}
		sum, size, err := fileChecksum(p)
		if err != nil {
			return nil
		}
		if sum == rec.Checksum && size == rec.Size {
			rec.SetLocation(metadata.Location{VolumeID: vol.ID, NodeID: me, State: metadata.LocCommitted, Checksum: sum})
			if rec.Primary == "" {
				rec.Primary = vol.ID
			}
			if s.meta.Submit(metadata.KindFile, rec) == nil {
				res.Attached++
			}
			return nil
		}
		//Content differs from the record
		if len(rec.HealthyLocations()) == 0 || (hasLoc && loc.NodeID == me && fi.ModTime().Unix() > rec.ModTime) {
			//No good copy anywhere (or this copy is newer): the disk wins
			rec.Size = size
			rec.Checksum = sum
			rec.ModTime = fi.ModTime().Unix()
			rec.Primary = vol.ID
			rec.Locations = nil
			rec.SetLocation(metadata.Location{VolumeID: vol.ID, NodeID: me, State: metadata.LocCommitted, Checksum: sum})
			s.meta.Submit(metadata.KindFile, rec)
			res.Attached++
			return nil
		}
		rec.SetLocation(metadata.Location{VolumeID: vol.ID, NodeID: me, State: metadata.LocStale, Checksum: sum})
		if s.meta.Submit(metadata.KindFile, rec) == nil {
			res.Stale++
		}
		return nil
	})
	if walkErr != nil {
		res.Error = walkErr.Error()
	}

	//Copies the record claims on this volume that are missing on disk
	for _, rec := range s.meta.AllFiles() {
		if rec.Removed || rec.IsDir || seen[rec.Path] {
			continue
		}
		loc, ok := rec.Location(vol.ID)
		if !ok || loc.State == metadata.LocStale || loc.State == metadata.LocWriting || loc.State == metadata.LocPending {
			continue
		}
		r := rec.Clone()
		loc.State = metadata.LocStale
		r.SetLocation(loc)
		if s.meta.Submit(metadata.KindFile, r) == nil {
			res.Stale++
		}
	}
	if res.Adopted+res.Attached+res.Stale > 0 {
		logger.PrintAndLog("Cluster", "Volume "+vol.Name+" rescanned: "+itoa(res.Adopted)+" adopted, "+itoa(res.Attached)+" attached, "+itoa(res.Stale)+" stale", nil)
	}
	return res
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
