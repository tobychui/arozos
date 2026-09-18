package metadata

/*
	ACMS manager - the public face of the metadata store on one node.

	Writers call Submit(kind, record); the change is applied locally right
	away (so the caller sees it), then replicated through the leader
	(log.go). Readers use Stat / ListDir / Volumes / PolicyFor which never
	touch the network.
*/

import (
	"errors"
	"sync"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/info/logger"
)

// Option configures the metadata manager. Durations are overridable for tests.
type Option struct {
	Membership    *membership.Manager
	LeaseDuration time.Duration
	LeaseRenew    time.Duration
	LeaseTick     time.Duration
	PendingRetry  time.Duration
	LogKeep       int
}

// Manager is the metadata store of this node.
type Manager struct {
	m   *membership.Manager
	st  *store
	opt Option

	mu        sync.Mutex
	stop      chan struct{}
	wg        sync.WaitGroup
	once      sync.Once
	catchupCh chan struct{}
	appends   int

	//OnChange fires after a record changed locally or by replication.
	OnChange func(kind string, payload []byte)
}

var (
	ErrNotInCluster = errors.New("this node is not part of a cluster")
	ErrNotFound     = errors.New("path not found in the cluster namespace")
	ErrExists       = errors.New("path already exists")
)

// New opens the metadata store on top of a membership manager.
func New(opt Option) (*Manager, error) {
	if opt.Membership == nil {
		return nil, errors.New("membership manager is required")
	}
	if opt.LeaseDuration <= 0 {
		opt.LeaseDuration = 30 * time.Second
	}
	if opt.LeaseRenew <= 0 {
		opt.LeaseRenew = 10 * time.Second
	}
	if opt.LeaseTick <= 0 {
		opt.LeaseTick = 5 * time.Second
	}
	if opt.PendingRetry <= 0 {
		opt.PendingRetry = 15 * time.Second
	}
	if opt.LogKeep <= 0 {
		opt.LogKeep = 10000
	}
	for _, t := range Tables {
		membership.RegisterClusterTable(t)
	}
	mgr := &Manager{
		m:         opt.Membership,
		st:        newStore(opt.Membership.DB()),
		opt:       opt,
		stop:      make(chan struct{}),
		catchupCh: make(chan struct{}, 1),
	}
	mgr.registerACNHandlers()

	prev := mgr.m.OnMembershipChange
	mgr.m.OnMembershipChange = func(in bool) {
		if prev != nil {
			prev(in)
		}
		if !in {
			mgr.resetLocal()
		}
	}

	mgr.wg.Add(3)
	go mgr.leaseLoop()
	go mgr.pendingLoop()
	go mgr.catchupLoop()
	return mgr, nil
}

// Close stops the background loops.
func (mgr *Manager) Close() {
	mgr.once.Do(func() { close(mgr.stop) })
	mgr.wg.Wait()
}

// resetLocal forgets everything after the node left the cluster (the tables
// were already wiped by membership; the in-memory maps must follow).
func (mgr *Manager) resetLocal() {
	mgr.st = newStore(mgr.m.DB())
}

/*
	Writes
*/

// Submit applies a change locally and replicates it. kind is one of
// KindFile / KindVolume / KindPolicy and rec the matching pointer type. The
// record's Version is assigned here; callers never set it.
func (mgr *Manager) Submit(kind string, rec interface{}) error {
	if !mgr.m.InCluster() {
		return ErrNotInCluster
	}
	var version int64
	switch kind {
	case KindFile:
		f, ok := rec.(*FileRecord)
		if !ok || f.ID == "" {
			return errors.New("invalid file record")
		}
		f.Path = NormalizePath(f.Path)
		if old, ok := mgr.st.getFileByID(f.ID); ok {
			version = nextVersion(old.Version)
		} else {
			version = nextVersion(0)
		}
		f.Version = version
	case KindVolume:
		v, ok := rec.(*Volume)
		if !ok || v.ID == "" {
			return errors.New("invalid volume record")
		}
		if old, ok := mgr.st.getVolume(v.ID); ok {
			version = nextVersion(old.Version)
		} else {
			version = nextVersion(0)
		}
		v.Version = version
	case KindPolicy:
		p, ok := rec.(*Policy)
		if !ok || p.Folder == "" {
			return errors.New("invalid policy record")
		}
		p.Folder = TopFolder(p.Folder)
		version = nextVersion(mgr.st.policyFor(p.Folder).Version)
		p.Version = version
	default:
		return errors.New("unknown record kind " + kind)
	}
	entry, err := newEntry(kind, rec, version, mgr.m.NodeID())
	if err != nil {
		return err
	}
	mgr.apply(entry)
	mgr.dispatch(entry)
	return nil
}

// SubmitBatch submits several file records (e.g. a directory rename).
func (mgr *Manager) SubmitBatch(records []*FileRecord) error {
	for _, r := range records {
		if err := mgr.Submit(KindFile, r); err != nil {
			return err
		}
	}
	return nil
}

/*
	Reads
*/

// Stat returns the live record at a logical path.
func (mgr *Manager) Stat(p string) (*FileRecord, error) {
	rec, ok := mgr.st.getFileByPath(p)
	if !ok {
		return nil, ErrNotFound
	}
	return rec, nil
}

// FileByID returns a record (including tombstones) by ID.
func (mgr *Manager) FileByID(id string) (*FileRecord, bool) {
	return mgr.st.getFileByID(id)
}

// ListDir lists the live children of a directory.
func (mgr *Manager) ListDir(p string) ([]FileRecord, error) {
	p = NormalizePath(p)
	if p != "/" {
		rec, ok := mgr.st.getFileByPath(p)
		if !ok {
			return nil, ErrNotFound
		}
		if !rec.IsDir {
			return nil, errors.New("not a directory")
		}
	}
	return mgr.st.listDir(p), nil
}

// ListSubtree lists every live record under a directory, recursively.
func (mgr *Manager) ListSubtree(p string) []FileRecord {
	return mgr.st.listSubtree(p)
}

// AllFiles returns every record including tombstones (planners, reconcile).
func (mgr *Manager) AllFiles() []FileRecord {
	return mgr.st.allFiles()
}

// Volumes lists every known volume (including removed ones).
func (mgr *Manager) Volumes() []Volume {
	return mgr.st.allVolumes()
}

// Volume returns one volume.
func (mgr *Manager) Volume(id string) (*Volume, bool) {
	return mgr.st.getVolume(id)
}

// Policies lists the folder policies.
func (mgr *Manager) Policies() []Policy {
	return mgr.st.allPolicies()
}

// PolicyFor returns the effective policy of a path.
func (mgr *Manager) PolicyFor(p string) Policy {
	return mgr.st.policyFor(p)
}

// Membership exposes the underlying membership manager.
func (mgr *Manager) Membership() *membership.Manager {
	return mgr.m
}

/*
	Status
*/

// Status summarises the store for the settings UI.
type Status struct {
	InCluster    bool   `json:"inCluster"`
	Leader       string `json:"leader"`
	LeaderName   string `json:"leaderName"`
	IsLeader     bool   `json:"isLeader"`
	Term         uint64 `json:"term"`
	LeaseExpires int64  `json:"leaseExpires"`
	Applied      uint64 `json:"applied"`
	LastSeq      uint64 `json:"lastSeq"`
	Files        int    `json:"files"`
	Dirs         int    `json:"dirs"`
	Volumes      int    `json:"volumes"`
	Pending      int    `json:"pending"`
}

// Status builds the current status.
func (mgr *Manager) Status() Status {
	lease := mgr.st.getLease()
	applied, _ := mgr.st.getApplied()
	files, dirs := mgr.st.counts()
	live := 0
	for _, v := range mgr.st.allVolumes() {
		if !v.Removed {
			live++
		}
	}
	st := Status{
		InCluster:    mgr.m.InCluster(),
		Leader:       mgr.Leader(),
		IsLeader:     mgr.IsLeader(),
		Term:         lease.Term,
		LeaseExpires: lease.Expires,
		Applied:      applied,
		LastSeq:      mgr.st.getLastSeq(),
		Files:        files,
		Dirs:         dirs,
		Volumes:      live,
		Pending:      len(mgr.st.pendingEntries()),
	}
	if st.Leader != "" {
		st.LeaderName = mgr.m.NodeName(st.Leader)
	}
	return st
}

func (mgr *Manager) logf(msg string) {
	logger.PrintAndLog("Cluster", msg, nil)
}
