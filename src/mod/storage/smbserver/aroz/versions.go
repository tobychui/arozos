package aroz

import (
	"path"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	versions.go

	Previous Versions over SMB, from the snapshots the File Manager takes
	(mod/filesystem/localversion): a version of docs/report.docx taken at a
	local time T is kept as

		docs/.metadata/.localver/<T as 2006-01-02_15-04-05>/report.docx

	so its share path is all the SMB server needs. Versions are read only:
	.metadata is a protected folder over SMB.
*/

const (
	versionFolder = ".metadata/.localver"
	versionLayout = "2006-01-02_15-04-05"
)

// versionTime reads a snapshot folder name, in the server's local time.
func versionTime(name string) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In1("storage/smbserver/aroz", "versionTime", "name", name), &out0, &out1)
	t, err := time.ParseInLocation(versionLayout, name, time.Local)
	return t, err == nil
}

func joinShare(parts ...string) (out0 string) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "joinShare", "parts", parts), &out0)
	out := path.Join(parts...)
	if out == "." {
		return ""
	}
	return out
}

// Snapshots lists when versions of p were taken. For a folder that is any
// version of a file directly in it, so Windows can look each one up.
func (s *share) Snapshots(p string) (out0 []time.Time) {
	defer logger.Out1(logger.In2("storage/smbserver/aroz", "share.Snapshots", "s", s, "p", p), &out0)
	info, err := s.Stat(p)
	isDir := err == nil && info.IsDir
	if err != nil && p == "" {
		isDir = true
	}
	dir, name := p, ""
	if !isDir {
		dir, name = path.Dir(p), path.Base(p)
		if dir == "." {
			dir = ""
		}
	}
	entries, err := s.ReadDir(joinShare(dir, versionFolder))
	if err != nil {
		logger.DebugErr("storage/smbserver/aroz", err)
		return nil
	}
	out := []time.Time{}
	for _, e := range entries {
		if !e.IsDir {
			continue
		}
		t, ok := versionTime(e.Name)
		if !ok {
			continue
		}
		if name != "" {
			if _, err := s.Stat(joinShare(dir, versionFolder, e.Name, name)); err != nil {
				logger.DebugErr("storage/smbserver/aroz", err)
				continue
			}
		}
		out = append(out, t)
	}
	return out
}

// SnapshotPath finds the version of p taken at t.
func (s *share) SnapshotPath(p string, t time.Time) (out0 string, out1 bool) {
	defer logger.Out2(logger.In3("storage/smbserver/aroz", "share.SnapshotPath", "s", s, "p", p, "&t", &t), &out0, &out1)
	id := t.In(time.Local).Format(versionLayout)
	//A folder: the snapshot folder itself, listing the versions taken then
	if info, err := s.Stat(p); (err == nil && info.IsDir) || p == "" {
		folder := joinShare(p, versionFolder, id)
		if fi, err := s.Stat(folder); err == nil && fi.IsDir {
			return folder, true
		}
		return "", false
	}
	dir := path.Dir(p)
	if dir == "." {
		dir = ""
	}
	version := joinShare(dir, versionFolder, id, path.Base(p))
	if fi, err := s.Stat(version); err == nil && !fi.IsDir {
		return version, true
	}
	return "", false
}
