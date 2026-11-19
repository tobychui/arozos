package syncthingserv

import (
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

/*
	Plan

	The Syncthing configuration is rebuilt from the records on every change
	and once a minute. buildPlan is where every rule about who may sync what
	lives, so it is kept free of Syncthing types and tested on its own:

	- a device only ever gets the folders of the user who added it
	- the devices and folders of a user who may no longer use Syncthing are
	  paused, and those of a deleted account are removed
	- a folder is paused while its user cannot write to it, its drive is not a
	  local disk, or its user's storage quota is full
	- two folders never overlap: the one added later is paused
*/

// Quota is a user's storage quota. Files Syncthing writes are not counted
// as they arrive, so the manager measures the usage again when the folders
// have grown enough to fill it (see quota.go).
type Quota interface {
	//Usage returns the bytes used and allowed, a negative total is no limit
	Usage() (used, total int64)
	//Recount measures the usage again from the disk
	Recount()
}

// Location is where a folder lives on the host.
type Location struct {
	RealPath string //Absolute, with symbolic links resolved
	Quota    Quota  //Nil when the drive does not count toward the quota
}

// Reasons a device or folder is paused, which the pages translate
const (
	ReasonPaused     = "paused"      //The user paused it
	ReasonNotAllowed = "not_allowed" //The user may no longer use Syncthing
	ReasonNoAccess   = "no_access"   //The folder cannot be used, see the text
	ReasonQuota      = "quota"       //The user's storage quota is full
	ReasonOverlap    = "overlap"     //Another folder holds or is inside this path
)

// Reason says why something is paused.
type Reason struct {
	Key  string
	Text string //Detail in English, for ReasonNoAccess
}

type planDevice struct {
	ID      string
	Name    string
	Paused  bool
	Ignored []string
}

type planFolder struct {
	ID          string
	Label       string
	Path        string //Real path on the host
	Mode        string
	VersionDays int
	Devices     []string
	Paused      bool
}

// plan is the Syncthing configuration the records ask for.
type plan struct {
	Devices []planDevice
	Folders []planFolder
}

// planInput is what buildPlan needs to know besides the records.
type planInput struct {
	Devices []Device
	Folders []Folder
	Exists  func(owner string) bool
	Allowed func(owner string) bool
	Resolve func(owner, vpath string) (Location, error)
	//QuotaFull reports a full quota for a folder that counts toward one
	QuotaFull func(folder Folder, loc Location) bool
	//LastPath is where a folder was the last time it resolved, or ""
	LastPath func(folderID string) string
}

// planResult is the plan plus what the pages show about it.
type planResult struct {
	Plan          plan
	DeviceReasons map[string]Reason
	FolderReasons map[string]Reason
	Locations     map[string]Location
	//Gone lists the owners whose account no longer exists
	Gone []string
}

func buildPlan(in planInput) planResult {
	result := planResult{
		DeviceReasons: map[string]Reason{},
		FolderReasons: map[string]Reason{},
		Locations:     map[string]Location{},
	}

	existsCache := map[string]bool{}
	exists := func(owner string) bool {
		if v, ok := existsCache[owner]; ok {
			return v
		}
		v := in.Exists(owner)
		existsCache[owner] = v
		if !v {
			result.Gone = append(result.Gone, owner)
		}
		return v
	}
	allowedCache := map[string]bool{}
	allowed := func(owner string) bool {
		if v, ok := allowedCache[owner]; ok {
			return v
		}
		v := in.Allowed(owner)
		allowedCache[owner] = v
		return v
	}

	//Devices, and who owns each of them
	ownerOf := map[string]string{}
	for _, d := range in.Devices {
		if !exists(d.Owner) {
			continue
		}
		ownerOf[d.ID] = d.Owner
		pd := planDevice{ID: d.ID, Name: d.Name, Ignored: append([]string{}, d.Ignored...)}
		switch {
		case !allowed(d.Owner):
			pd.Paused = true
			result.DeviceReasons[d.ID] = Reason{Key: ReasonNotAllowed}
		case d.Paused:
			pd.Paused = true
			result.DeviceReasons[d.ID] = Reason{Key: ReasonPaused}
		}
		result.Plan.Devices = append(result.Plan.Devices, pd)
	}

	//Folders, the oldest first, so that an overlap pauses the newer one
	folders := append([]Folder{}, in.Folders...)
	sort.SliceStable(folders, func(i, j int) bool { return folders[i].Added < folders[j].Added })
	var claimed []string
	for _, f := range folders {
		if !exists(f.Owner) {
			continue
		}
		pf := planFolder{
			ID:          f.ID,
			Label:       f.Label,
			Mode:        f.Mode,
			VersionDays: f.VersionDays,
			Devices:     []string{},
		}
		if !validMode(pf.Mode) {
			pf.Mode = ModeBackup
		}
		for _, id := range f.Devices {
			if ownerOf[id] == f.Owner {
				pf.Devices = append(pf.Devices, id)
			}
		}

		var reason *Reason
		loc, err := in.Resolve(f.Owner, f.Path)
		switch {
		case !allowed(f.Owner):
			reason = &Reason{Key: ReasonNotAllowed}
		case err != nil:
			reason = &Reason{Key: ReasonNoAccess, Text: err.Error()}
		case overlapsAny(loc.RealPath, claimed):
			reason = &Reason{Key: ReasonOverlap}
		case loc.Quota != nil && in.QuotaFull != nil && in.QuotaFull(f, loc):
			reason = &Reason{Key: ReasonQuota}
		case f.Paused:
			reason = &Reason{Key: ReasonPaused}
		}
		if err == nil {
			pf.Path = loc.RealPath
			result.Locations[f.ID] = loc
			if reason == nil || reason.Key != ReasonOverlap {
				claimed = append(claimed, loc.RealPath)
			}
		} else if in.LastPath != nil {
			//A paused folder keeps the path it last had, so that Syncthing
			//keeps its index and need not hash everything again later.
			//Paused, nothing is read or written there.
			pf.Path = in.LastPath(f.ID)
		}
		if reason != nil {
			pf.Paused = true
			result.FolderReasons[f.ID] = *reason
		}
		if pf.Path == "" {
			//Never known where it is: Syncthing gets no folder at all
			continue
		}
		result.Plan.Folders = append(result.Plan.Folders, pf)
	}

	//A folder a device shares is never also ignored from it (Syncthing
	//would drop the entry, and every apply would put it back)
	shared := map[string]map[string]bool{}
	for _, pf := range result.Plan.Folders {
		for _, id := range pf.Devices {
			if shared[id] == nil {
				shared[id] = map[string]bool{}
			}
			shared[id][pf.ID] = true
		}
	}
	for i, pd := range result.Plan.Devices {
		kept := []string{}
		for _, folderID := range pd.Ignored {
			if !shared[pd.ID][folderID] {
				kept = append(kept, folderID)
			}
		}
		result.Plan.Devices[i].Ignored = kept
	}
	return result
}

// overlapsAny reports a path that is one of the claimed paths, or inside or
// around one of them.
func overlapsAny(path string, claimed []string) bool {
	for _, other := range claimed {
		if pathsOverlap(path, other) {
			return true
		}
	}
	return false
}

func pathsOverlap(a, b string) bool {
	a, b = comparablePath(a), comparablePath(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	sep := string(filepath.Separator)
	return strings.HasPrefix(a, strings.TrimSuffix(b, sep)+sep) || strings.HasPrefix(b, strings.TrimSuffix(a, sep)+sep)
}

func comparablePath(p string) string {
	if p == "" {
		return ""
	}
	p = filepath.Clean(p)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		//Both are case insensitive out of the box
		p = strings.ToLower(p)
	}
	return p
}
