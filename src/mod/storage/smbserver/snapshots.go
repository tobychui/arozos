package smbserver

import (
	"encoding/binary"
	"sort"
	"strings"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	snapshots.go

	Previous Versions. Windows lists the versions of a file with
	FSCTL_SRV_ENUMERATE_SNAPSHOTS, gets them as "@GMT-YYYY.MM.DD-HH.MM.SS"
	tokens, and opens one with the timewarp create context (TWrp) or with the
	token as a path component. Where the versions are kept is the backend's
	business; a share that has them implements SnapshotShare.

	A version is read only: it lives in a protected folder of the drive, so
	any open asking to change it is refused like any write there.
*/

// SnapshotShare is a Share that keeps earlier versions of files.
type SnapshotShare interface {
	//Snapshots lists when versions of p were taken; for a folder, of the
	//files in it
	Snapshots(p string) []time.Time
	//SnapshotPath is the share path holding p as it was at t
	SnapshotPath(p string, t time.Time) (string, bool)
}

const gmtLayout = "@GMT-2006.01.02-15.04.05"

// parseGMTToken reads an @GMT path component.
func parseGMTToken(s string) (time.Time, bool) {
	if len(s) != len(gmtLayout) || !strings.HasPrefix(s, "@GMT-") {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(gmtLayout, s, time.UTC)
	return t, err == nil
}

// splitGMTToken takes an @GMT component out of a share path.
func splitGMTToken(rel string) (string, time.Time, bool) {
	parts := strings.Split(rel, "/")
	for i, part := range parts {
		if t, ok := parseGMTToken(part); ok {
			rest := append(append([]string{}, parts[:i]...), parts[i+1:]...)
			return strings.Join(rest, "/"), t, true
		}
	}
	return rel, time.Time{}, false
}

// snapshotArray is SRV_SNAPSHOT_ARRAY. A buffer too small for the names
// gets the counts alone, and Windows asks again with room for them.
func snapshotArray(times []time.Time, maxOut uint32) []byte {
	sort.Slice(times, func(i, j int) bool { return times[i].After(times[j]) })
	multi := []byte{}
	for _, t := range times {
		multi = append(multi, wire.EncodeUTF16(t.UTC().Format(gmtLayout))...)
		multi = append(multi, 0, 0)
	}
	if len(times) > 0 {
		multi = append(multi, 0, 0)
	}
	w := wire.NewWriter(16 + len(multi))
	w.U32(uint32(len(times)))
	if len(times) > 0 && uint64(12+len(multi)) <= uint64(maxOut) {
		w.U32(uint32(len(times)))
		w.U32(uint32(len(multi)))
		w.Bytes(multi)
		return w.B
	}
	w.U32(0)
	w.U32(uint32(len(multi)))
	w.Zero(4)
	return w.B
}

func (c *conn) enumerateSnapshots(r *request, q *wire.IoctlRequest) *response {
	if q.MaxOutputResponse < 16 {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	var times []time.Time
	if o.pipe == nil {
		if ss, ok := o.tree.share.(SnapshotShare); ok && o.tree.share.CanRead(o.getPath()) {
			times = ss.Snapshots(o.getPath())
		}
	}
	return ioctlResponse(q, snapshotArray(times, q.MaxOutputResponse), wire.StatusOK)
}

// timewarp reads the TWrp context: a FILETIME in UTC.
func timewarp(data []byte) (time.Time, bool) {
	if len(data) != 8 {
		return time.Time{}, false
	}
	return wire.TimeFromFiletime(binary.LittleEndian.Uint64(data)).UTC().Truncate(time.Second), true
}

// snapshotOf maps a path and a time to the version kept of it, or reports
// that there is none.
func (c *conn) snapshotOf(share Share, rel string, at time.Time) (string, uint32) {
	ss, ok := share.(SnapshotShare)
	if !ok {
		return "", wire.StatusObjectNameNotFound
	}
	//Find the real spelling, if the file still exists; a deleted file's
	//versions are kept under its old name
	base := rel
	if res, err := resolve(share, c.srv.names, rel); err == nil && res.exists {
		base = res.path
	}
	p, ok := ss.SnapshotPath(base, at)
	if !ok {
		return "", wire.StatusObjectNameNotFound
	}
	return p, wire.StatusOK
}
