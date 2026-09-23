package storage

/*
	Volumes: folders on this node's local drives that hold cluster files.
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	//diskFullFraction is the free space below which a volume stops taking
	//new files; it starts again above diskRecoverFraction.
	diskFullFraction    = 0.05
	diskRecoverFraction = 0.07
)

// LocalVolumes lists this node's volumes that are not removed.
func (s *Service) LocalVolumes() []metadata.Volume {
	out := []metadata.Volume{}
	for _, v := range s.meta.Volumes() {
		if v.NodeID == s.m.NodeID() && !v.Removed {
			out = append(out, v)
		}
	}
	return out
}

// volumeRoot returns the real directory of a local volume.
func (s *Service) volumeRoot(vol *metadata.Volume) (string, error) {
	if vol.NodeID != s.m.NodeID() {
		return "", ErrNotLocalVolume
	}
	roots := s.opt.LocalRoots()
	root, ok := roots[vol.FshUUID]
	if !ok {
		return "", errors.New("local drive " + vol.FshUUID + " is not mounted")
	}
	return filepath.Clean(filepath.Join(root, filepath.FromSlash(vol.Subpath))), nil
}

// realPath maps a logical path onto a local volume, refusing escapes.
func (s *Service) realPath(vol *metadata.Volume, logical string) (string, error) {
	root, err := s.volumeRoot(vol)
	if err != nil {
		return "", err
	}
	logical = metadata.NormalizePath(logical)
	full := filepath.Clean(filepath.Join(root, filepath.FromSlash(logical)))
	if full != root && !strings.HasPrefix(full, root+string(filepath.Separator)) {
		return "", ErrPathEscape
	}
	return full, nil
}

func normalizeSubpath(p string) string {
	p = strings.ReplaceAll(strings.TrimSpace(p), "\\", "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = filepath.ToSlash(filepath.Clean(p))
	if p == "." {
		p = "/"
	}
	return p
}

// AddVolume contributes a folder of a local drive to the cluster.
func (s *Service) AddVolume(fshUUID string, subpath string, name string) (*metadata.Volume, error) {
	if !s.m.InCluster() {
		return nil, metadata.ErrNotInCluster
	}
	roots := s.opt.LocalRoots()
	root, ok := roots[fshUUID]
	if !ok {
		return nil, errors.New("drive " + fshUUID + " is not a local drive on this node")
	}
	subpath = normalizeSubpath(subpath)
	if strings.Contains(subpath, "..") {
		return nil, ErrPathEscape
	}
	dir := filepath.Clean(filepath.Join(root, filepath.FromSlash(subpath)))
	if subpath == "/" && fshUUID == "user" {
		return nil, errors.New("the user root itself cannot be a cluster volume; pick a sub folder such as /cluster")
	}
	for _, v := range s.meta.Volumes() {
		if !v.Removed && v.NodeID == s.m.NodeID() && v.FshUUID == fshUUID && v.Subpath == subpath {
			return nil, errors.New("this folder is already a cluster volume")
		}
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		//The node is named by its ID wherever a volume is pointed at, so the
		//default name says nothing about which node it is on: node names are
		//operator set and every fresh install answers to "My ArOZ", which
		//would make two volumes of the same folder indistinguishable.
		name = fshUUID + ":" + subpath
	}
	vol := &metadata.Volume{
		ID:      uuid.NewV4().String(),
		NodeID:  s.m.NodeID(),
		Name:    strings.TrimSpace(name),
		FshUUID: fshUUID,
		Subpath: subpath,
	}
	if free, total, err := capability.DiskUsage(dir); err == nil {
		vol.Free, vol.Capacity = free, total
	}
	if err := s.meta.Submit(metadata.KindVolume, vol); err != nil {
		return nil, err
	}
	go s.reconcileVolume(*vol)
	return vol, nil
}

// RemoveVolume stops contributing a folder. Files stay on disk. It refuses
// when the volume holds the only healthy copy of any file; evacuate first.
func (s *Service) RemoveVolume(id string) error {
	vol, ok := s.meta.Volume(id)
	if !ok || vol.Removed {
		return errors.New("volume not found")
	}
	if vol.NodeID != s.m.NodeID() {
		return ErrNotLocalVolume
	}
	if sole := s.SoleCopies(id); sole > 0 {
		return fmt.Errorf("this volume holds the only copy of %d file(s); evacuate it first", sole)
	}
	vol.Removed = true
	if err := s.meta.Submit(metadata.KindVolume, vol); err != nil {
		return err
	}
	s.forgetVolumeLocations(id)
	return nil
}

// forgetVolumeLocations drops a retired volume from every record. The files
// stay on disk; they are simply no longer reachable through the cluster.
func (s *Service) forgetVolumeLocations(volumeID string) {
	for _, rec := range s.meta.AllFiles() {
		if _, has := rec.Location(volumeID); !has {
			continue
		}
		r := rec.Clone()
		r.RemoveLocation(volumeID)
		if r.Primary == volumeID {
			r.Primary = ""
			if h := r.HealthyLocations(); len(h) > 0 {
				r.Primary = h[0].VolumeID
			}
		}
		s.meta.Submit(metadata.KindFile, r)
	}
}

// SoleCopies counts files whose only healthy copy sits on the volume.
func (s *Service) SoleCopies(volumeID string) int {
	n := 0
	for _, rec := range s.meta.AllFiles() {
		if rec.Removed || rec.IsDir {
			continue
		}
		healthy := rec.HealthyLocations()
		if len(healthy) == 1 && healthy[0].VolumeID == volumeID {
			n++
		}
	}
	return n
}

// SetVolumeReadOnly toggles placement on a local volume.
func (s *Service) SetVolumeReadOnly(id string, ro bool) error {
	vol, ok := s.meta.Volume(id)
	if !ok || vol.Removed {
		return errors.New("volume not found")
	}
	if vol.NodeID != s.m.NodeID() {
		return ErrNotLocalVolume
	}
	vol.ReadOnly = ro
	return s.meta.Submit(metadata.KindVolume, vol)
}

// refreshVolumes republishes free space when it moved by more than 1 %.
func (s *Service) refreshVolumes() {
	auto := s.AutoReadOnly()
	for _, v := range s.LocalVolumes() {
		root, err := s.volumeRoot(&v)
		if err != nil {
			continue
		}
		free, total, err := capability.DiskUsage(root)
		if err != nil {
			continue
		}
		delta := v.Free - free
		if delta < 0 {
			delta = -delta
		}
		//A volume under the low water mark stops taking new files until it
		//recovers, so a node never fills its own disk (unless an admin turned
		//that off for the cluster).
		wasFull := v.ReadOnly && v.LowSpace
		mark, clear := lowSpaceAction(free, total, wasFull, auto)
		changed := total != v.Capacity || (total > 0 && delta*100 > total)
		if mark {
			v.ReadOnly, v.LowSpace, changed = true, true, true
			logger.PrintAndLog("Cluster", "Volume "+v.Name+" is nearly full and stops taking new files", nil)
			if s.OnDiskFull != nil {
				s.OnDiskFull(v)
			}
		} else if clear {
			v.ReadOnly, v.LowSpace, changed = false, false, true
			if auto {
				logger.PrintAndLog("Cluster", "Volume "+v.Name+" has room again and takes new files", nil)
			} else {
				logger.PrintAndLog("Cluster", "Volume "+v.Name+" takes new files again: automatic read-only is turned off", nil)
			}
		}
		if changed {
			v.Free, v.Capacity = free, total
			s.meta.Submit(metadata.KindVolume, &v)
		}
	}
}

// AutoReadOnlyKey is the replicated setting that turns the nearly-full guard
// on or off for the whole cluster.
const AutoReadOnlyKey = "storage.autoReadOnly"

type autoReadOnlySetting struct {
	Enabled bool `json:"enabled"`
}

// AutoReadOnly reports whether volumes that are nearly full are made read
// only automatically. It is on unless an admin turned it off.
func (s *Service) AutoReadOnly() bool {
	st, ok := s.meta.Setting(AutoReadOnlyKey)
	if !ok {
		return true
	}
	var v autoReadOnlySetting
	if json.Unmarshal(st.Value, &v) != nil {
		return true
	}
	return v.Enabled
}

// SetAutoReadOnly turns the nearly-full guard on or off for every node. This
// node applies it at once; the others at their next volume refresh.
func (s *Service) SetAutoReadOnly(enabled bool) error {
	js, err := json.Marshal(autoReadOnlySetting{Enabled: enabled})
	if err != nil {
		return err
	}
	if err := s.meta.Submit(metadata.KindSetting, &metadata.Setting{Key: AutoReadOnlyKey, Value: js}); err != nil {
		return err
	}
	go s.refreshVolumes()
	return nil
}

// lowSpaceAction decides what the guard does to one volume. wasFull says the
// guard itself made the volume read only earlier. With the guard on, a volume
// is marked below the low water mark and released above the recover mark;
// with it off, nothing is marked and anything the guard had marked is
// released, while read-only set by an admin is never touched.
func lowSpaceAction(free int64, total int64, wasFull bool, auto bool) (mark bool, clear bool) {
	if !auto {
		return false, wasFull
	}
	full, recovered := spaceState(free, total, wasFull)
	return full && !wasFull, recovered
}

// spaceState decides whether a volume is too full to take new files. The two
// thresholds differ so a volume hovering at the limit does not flap: it stops
// below diskFullFraction and only starts again above diskRecoverFraction.
func spaceState(free int64, total int64, wasFull bool) (full bool, recovered bool) {
	if total <= 0 {
		return false, false
	}
	frac := float64(free) / float64(total)
	if wasFull {
		return true, frac > diskRecoverFraction
	}
	return frac < diskFullFraction, false
}

// VolumeStats counts files held on a local volume (for the UI).
func (s *Service) VolumeStats(id string) (files int, bytes int64) {
	for _, rec := range s.meta.AllFiles() {
		if rec.Removed || rec.IsDir {
			continue
		}
		if loc, ok := rec.Location(id); ok && loc.Healthy() {
			files++
			bytes += rec.Size
		}
	}
	return
}

func modTimeOf(fi os.FileInfo) int64 {
	if fi == nil {
		return time.Now().Unix()
	}
	return fi.ModTime().Unix()
}
