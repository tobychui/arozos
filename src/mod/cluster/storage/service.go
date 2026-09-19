package storage

/*
	ArozOS Cluster Storage (ACS)

	The storage service turns the metadata index into a usable file system:

	- volumes: folders on local drives that this node contributes
	- transfer: signed, chunked (4 MiB, SHA-256 verified) moves of whole files
	  between nodes, sized for Cloudflare's request limits
	- placement: which volume receives a new file
	- reads and writes for the cluster:/ drive (mod/filesystem/abstractions/clusterfs)
	- reconcile: rescans of local volumes so real files stay authoritative

	Files are never split across nodes; a file is one ordinary file on one or
	more volumes.
*/

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/cluster/scheduling"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	// ChunkSize is the transfer unit between nodes.
	ChunkSize = 4 << 20
	// MaxChunkSize bounds a single read request.
	MaxChunkSize = 8 << 20
	// SessionTTL is how long an unfinished upload session is kept.
	SessionTTL = 30 * time.Minute
	// placementHeadroom is kept free on a volume beyond the file size.
	placementHeadroom = 64 << 20
)

var (
	ErrNoVolume       = errors.New("no cluster volume available; add one in System Settings > Cluster > Storage")
	ErrNoHealthyCopy  = errors.New("no healthy copy of this file is reachable right now")
	ErrNotLocalVolume = errors.New("volume is not on this node")
	ErrPathEscape     = errors.New("path escapes the volume")
	ErrIsDirectory    = errors.New("is a directory")
	ErrNotDirectory   = errors.New("not a directory")
	ErrNotEmpty       = errors.New("directory not empty")
	ErrChecksum       = errors.New("checksum mismatch")
)

// Option configures the storage service.
type Option struct {
	Membership *membership.Manager
	Metadata   *metadata.Manager
	//Scheduler scores the nodes when choosing where a new file goes.
	Scheduler *scheduling.Manager
	TmpDir    string
	// LocalRoots maps local (non network, non buffered) file system handler
	// UUIDs to their real root paths. Provided by the core.
	LocalRoots        func() map[string]string
	RefreshInterval   time.Duration
	ReconcileInterval time.Duration
}

// Service is the storage layer of this node.
type Service struct {
	m      *membership.Manager
	meta   *metadata.Manager
	client *Client
	sched  *scheduling.Manager
	opt    Option

	sessMu   sync.Mutex
	sessions map[string]*session

	stop chan struct{}
	wg   sync.WaitGroup
	once sync.Once

	//Hooks for the event bus (Phase 6); may be nil
	OnFileWritten func(rec metadata.FileRecord)
	OnFileRemoved func(rec metadata.FileRecord)
	OnFileRenamed func(oldPath string, rec metadata.FileRecord)
	//Replica hooks fired by PullCopy / VerifyLocalCopies
	OnReplicaVerified func(rec metadata.FileRecord, volumeID string)
	OnReplicaStale    func(rec metadata.FileRecord, volumeID string)
	//OnDiskFull fires when a volume drops under the low water mark.
	OnDiskFull func(vol metadata.Volume)
}

// New creates the service and registers its node endpoints.
func New(opt Option) (*Service, error) {
	if opt.Membership == nil || opt.Metadata == nil || opt.LocalRoots == nil {
		return nil, errors.New("membership, metadata and local roots are required")
	}
	if opt.TmpDir == "" {
		opt.TmpDir = os.TempDir()
	}
	if opt.RefreshInterval <= 0 {
		opt.RefreshInterval = 60 * time.Second
	}
	if opt.ReconcileInterval <= 0 {
		opt.ReconcileInterval = 30 * time.Minute
	}
	os.MkdirAll(filepath.Join(opt.TmpDir, "cluster"), 0755)
	if opt.Scheduler == nil {
		sc, err := scheduling.New(opt.Membership, opt.Metadata)
		if err != nil {
			return nil, err
		}
		opt.Scheduler = sc
	}
	s := &Service{
		m:        opt.Membership,
		meta:     opt.Metadata,
		sched:    opt.Scheduler,
		client:   &Client{Transport: opt.Membership.Transport()},
		opt:      opt,
		sessions: map[string]*session{},
		stop:     make(chan struct{}),
	}
	s.registerACNHandlers()
	s.wg.Add(1)
	go s.maintenanceLoop()
	return s, nil
}

// Close stops background work.
func (s *Service) Close() {
	s.once.Do(func() { close(s.stop) })
	s.wg.Wait()
}

// Ready reports whether the cluster:/ drive can serve requests.
func (s *Service) Ready() bool {
	return s.m.InCluster()
}

func (s *Service) maintenanceLoop() {
	defer s.wg.Done()
	refresh := time.NewTicker(s.opt.RefreshInterval)
	reconcile := time.NewTicker(s.opt.ReconcileInterval)
	sweep := time.NewTicker(time.Minute)
	defer refresh.Stop()
	defer reconcile.Stop()
	defer sweep.Stop()
	//First reconcile shortly after boot picks up files already in contributed folders
	first := time.NewTimer(10 * time.Second)
	defer first.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-refresh.C:
			s.refreshVolumes()
		case <-first.C:
			s.ReconcileAll()
		case <-reconcile.C:
			s.ReconcileAll()
		case <-sweep.C:
			s.sweepSessions()
		}
	}
}

/*
	Placement
*/

func (s *Service) nodeState(nodeID string) membership.NodeState {
	for _, n := range s.m.NodeViews() {
		if n.ID == nodeID {
			return n.State
		}
	}
	return membership.StateOffline
}

func usable(state membership.NodeState) bool {
	return state == membership.StateOnline || state == membership.StateDegraded
}

// pickVolume chooses the volume that should receive a new copy of size
// bytes. Nodes are ranked by the cluster scorer (so a busy, distant or
// nearly full node loses), preferNode and preferVolume win ties, and the
// roomiest writable volume of the winning node is used.
func (s *Service) pickVolume(size int64, preferNode string, preferVolume string, exclude []string) (*metadata.Volume, error) {
	need := size + size/10 + placementHeadroom
	excluded := map[string]bool{}
	for _, id := range exclude {
		excluded[id] = true
	}
	//Group the usable volumes by node
	byNode := map[string][]metadata.Volume{}
	for _, v := range s.meta.Volumes() {
		if v.Removed || v.ReadOnly || v.Evacuating || v.Free < need || excluded[v.ID] {
			continue
		}
		byNode[v.NodeID] = append(byNode[v.NodeID], v)
	}
	if len(byNode) == 0 {
		return nil, ErrNoVolume
	}
	candidates := []scheduling.Candidate{}
	for _, n := range s.m.NodeViews() {
		vols, ok := byNode[n.ID]
		if !ok {
			continue
		}
		best := 0.0
		for _, v := range vols {
			if v.Capacity > 0 {
				if f := float64(v.Free) / float64(v.Capacity); f > best {
					best = f
				}
			}
		}
		c := scheduling.Candidate{Node: n, FreeDisk: best, LatencyToData: -1, Diversity: -1}
		if n.ID == preferNode {
			c.Locality = 1 //writing where the bytes already are costs nothing
		}
		candidates = append(candidates, c)
	}
	ranked := s.sched.Rank(candidates, func(c scheduling.Candidate) (bool, string) {
		if !usable(c.Node.State) {
			return false, "node is " + strings.ToLower(string(c.Node.State))
		}
		return true, ""
	})
	nodeID, why := scheduling.Best(ranked)
	if nodeID == "" {
		if why != "" {
			//Keep the sentinel so callers can still test for it, but say
			//why the only candidate was turned down
			return nil, fmt.Errorf("%w (%s)", ErrNoVolume, why)
		}
		return nil, ErrNoVolume
	}
	vols := byNode[nodeID]
	sort.Slice(vols, func(i, j int) bool {
		if (vols[i].ID == preferVolume) != (vols[j].ID == preferVolume) {
			return vols[i].ID == preferVolume
		}
		if vols[i].Free != vols[j].Free {
			return vols[i].Free > vols[j].Free
		}
		return vols[i].ID < vols[j].ID
	})
	v := vols[0]
	return &v, nil
}

// PlaceRequest asks the leader where a new file should go.
type PlaceRequest struct {
	Size          int64  `json:"size"`
	Path          string `json:"path"`
	PreferNode    string `json:"preferNode"`
	PreferVolume  string `json:"preferVolume"`
	ExcludeVolume string `json:"excludeVolume,omitempty"`
}

type PlaceResponse struct {
	VolumeID string `json:"volumeId"`
}

// place decides the volume for a write, consulting the leader when this
// node is not the leader and the leader is reachable.
func (s *Service) place(size int64, logical string, preferVolume string) (*metadata.Volume, error) {
	me := s.m.NodeID()
	if leader := s.meta.Leader(); leader != "" && leader != me {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var resp PlaceResponse
		err := s.m.Transport().DoJSON(ctx, leader, http.MethodPost, pathPlace, PlaceRequest{Size: size, Path: logical, PreferNode: me, PreferVolume: preferVolume}, &resp)
		if err == nil && resp.VolumeID != "" {
			if v, ok := s.meta.Volume(resp.VolumeID); ok && !v.Removed {
				return v, nil
			}
		}
	}
	return s.pickVolume(size, me, preferVolume, nil)
}

/*
	Backend for the cluster:/ drive
*/

// Info is the file-system view of a record.
type Info struct {
	Path    string
	IsDir   bool
	Size    int64
	ModTime int64
}

func infoOf(rec *metadata.FileRecord) Info {
	return Info{Path: rec.Path, IsDir: rec.IsDir, Size: rec.Size, ModTime: rec.ModTime}
}

// Stat returns the entry at a logical path.
func (s *Service) Stat(logical string) (Info, error) {
	logical = metadata.NormalizePath(logical)
	if logical == "/" {
		return Info{Path: "/", IsDir: true, ModTime: time.Now().Unix()}, nil
	}
	rec, err := s.meta.Stat(logical)
	if err != nil {
		return Info{}, os.ErrNotExist
	}
	return infoOf(rec), nil
}

// List returns the children of a directory.
func (s *Service) List(logical string) ([]Info, error) {
	logical = metadata.NormalizePath(logical)
	if logical != "/" {
		rec, err := s.meta.Stat(logical)
		if err != nil {
			return nil, os.ErrNotExist
		}
		if !rec.IsDir {
			return nil, ErrNotDirectory
		}
	}
	recs, err := s.meta.ListDir(logical)
	if err != nil {
		return nil, err
	}
	out := make([]Info, 0, len(recs))
	for i := range recs {
		out = append(out, infoOf(&recs[i]))
	}
	return out, nil
}

// ensureDirs creates directory records for every missing parent of logical.
func (s *Service) ensureDirs(logical string, owner string) error {
	logical = metadata.NormalizePath(logical)
	if logical == "/" {
		return nil
	}
	parent := metadata.ParentPath(logical)
	if err := s.ensureDirs(parent, owner); err != nil {
		return err
	}
	if rec, err := s.meta.Stat(logical); err == nil {
		if !rec.IsDir {
			return ErrNotDirectory
		}
		return nil
	}
	return s.meta.Submit(metadata.KindFile, &metadata.FileRecord{
		ID:      uuid.NewV4().String(),
		Path:    logical,
		IsDir:   true,
		ModTime: time.Now().Unix(),
		Owner:   owner,
	})
}

// Mkdir creates a directory (and its parents) in the namespace.
func (s *Service) Mkdir(logical string, owner string) error {
	if !s.Ready() {
		return metadata.ErrNotInCluster
	}
	logical = metadata.NormalizePath(logical)
	if rec, err := s.meta.Stat(logical); err == nil {
		if rec.IsDir {
			return nil
		}
		return metadata.ErrExists
	}
	return s.ensureDirs(logical, owner)
}

// Write stores a new version of a file: spool + hash locally, place, copy,
// then publish the record.
func (s *Service) Write(logical string, r io.Reader, owner string) error {
	if !s.Ready() {
		return metadata.ErrNotInCluster
	}
	logical = metadata.NormalizePath(logical)
	if logical == "/" {
		return ErrIsDirectory
	}
	if rec, err := s.meta.Stat(logical); err == nil && rec.IsDir {
		return ErrIsDirectory
	}
	if err := s.ensureDirs(metadata.ParentPath(logical), owner); err != nil {
		return err
	}

	//1. spool and hash
	spool, err := os.CreateTemp(filepath.Join(s.opt.TmpDir, "cluster"), "spool-*")
	if err != nil {
		return err
	}
	spoolPath := spool.Name()
	defer os.Remove(spoolPath)
	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(spool, h), r)
	spool.Close()
	if err != nil {
		return err
	}
	checksum := hex.EncodeToString(h.Sum(nil))

	//2. placement (overwrite prefers the existing primary)
	preferVolume := ""
	existing, _ := s.meta.Stat(logical)
	if existing != nil {
		preferVolume = existing.Primary
	}
	vol, err := s.place(size, logical, preferVolume)
	if err != nil {
		return err
	}

	//3. copy bytes first: the namespace only ever shows committed files
	fileID := uuid.NewV4().String()
	if existing != nil {
		fileID = existing.ID
	}
	if vol.NodeID == s.m.NodeID() {
		err = s.writeLocalFile(vol, logical, spoolPath, size, checksum)
	} else {
		err = s.uploadRemote(vol, logical, fileID, spoolPath, size, checksum)
	}
	if err != nil {
		return err
	}

	//4. publish the record with the new copy as its only location
	rec := &metadata.FileRecord{ID: fileID, Path: logical, Owner: owner}
	if existing != nil {
		rec = existing.Clone()
		rec.Locations = nil
	}
	rec.IsDir = false
	rec.Size = size
	rec.Checksum = checksum
	rec.ModTime = time.Now().Unix()
	rec.Primary = vol.ID
	rec.SetLocation(metadata.Location{VolumeID: vol.ID, NodeID: vol.NodeID, State: metadata.LocCommitted, Checksum: checksum})
	if err := s.meta.Submit(metadata.KindFile, rec); err != nil {
		return err
	}
	if existing != nil {
		//Physically remove superseded copies on other volumes (best effort)
		for _, old := range existing.Locations {
			if old.VolumeID != vol.ID {
				s.deletePhysical(old, logical)
			}
		}
	}
	if s.OnFileWritten != nil {
		s.OnFileWritten(*rec)
	}
	return nil
}

func (s *Service) writeLocalFile(vol *metadata.Volume, logical string, spoolPath string, size int64, checksum string) error {
	real, err := s.realPath(vol, logical)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(real), 0755); err != nil {
		return err
	}
	part := real + ".part-" + uuid.NewV4().String()
	if err := copyFile(spoolPath, part); err != nil {
		os.Remove(part)
		return err
	}
	if err := os.Rename(part, real); err != nil {
		os.Remove(part)
		return err
	}
	return nil
}

func (s *Service) uploadRemote(vol *metadata.Volume, logical string, fileID string, spoolPath string, size int64, checksum string) error {
	f, err := os.Open(spoolPath)
	if err != nil {
		return err
	}
	defer f.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()
	return s.client.Upload(ctx, vol.NodeID, vol.ID, logical, fileID, f, size, checksum, nil)
}

// OpenRead returns a stream of the file from the best available copy.
func (s *Service) OpenRead(logical string) (io.ReadCloser, error) {
	if !s.Ready() {
		return nil, metadata.ErrNotInCluster
	}
	rec, err := s.meta.Stat(logical)
	if err != nil {
		return nil, os.ErrNotExist
	}
	if rec.IsDir {
		return nil, ErrIsDirectory
	}
	locs := s.orderedLocations(rec)
	if len(locs) == 0 {
		return nil, ErrNoHealthyCopy
	}
	var lastErr error = ErrNoHealthyCopy
	for _, loc := range locs {
		vol, ok := s.meta.Volume(loc.VolumeID)
		if !ok || vol.Removed {
			continue
		}
		if vol.NodeID == s.m.NodeID() {
			real, err := s.realPath(vol, rec.Path)
			if err != nil {
				lastErr = err
				continue
			}
			f, err := os.Open(real)
			if err != nil {
				lastErr = err
				continue
			}
			return f, nil
		}
		//Remote copy: stream through a pipe while verifying the checksum
		pr, pw := io.Pipe()
		go func(v metadata.Volume) {
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
			defer cancel()
			err := s.client.Download(ctx, v.NodeID, v.ID, rec.Path, pw, rec.Checksum, nil)
			pw.CloseWithError(err)
		}(*vol)
		return pr, nil
	}
	return nil, lastErr
}

// orderedLocations lists readable copies, local first, then online nodes in
// membership order.
func (s *Service) orderedLocations(rec *metadata.FileRecord) []metadata.Location {
	me := s.m.NodeID()
	out := []metadata.Location{}
	for _, l := range rec.HealthyLocations() {
		if l.NodeID == me {
			out = append(out, l)
		}
	}
	for _, l := range rec.HealthyLocations() {
		if l.NodeID != me && usable(s.nodeState(l.NodeID)) {
			out = append(out, l)
		}
	}
	return out
}

// Remove deletes a file or directory from the namespace and its copies.
func (s *Service) Remove(logical string, recursive bool) error {
	if !s.Ready() {
		return metadata.ErrNotInCluster
	}
	logical = metadata.NormalizePath(logical)
	if logical == "/" {
		return errors.New("cannot remove the namespace root")
	}
	rec, err := s.meta.Stat(logical)
	if err != nil {
		return os.ErrNotExist
	}
	targets := []metadata.FileRecord{*rec}
	if rec.IsDir {
		children := s.meta.ListSubtree(logical)
		if len(children) > 0 && !recursive {
			return ErrNotEmpty
		}
		targets = append(targets, children...)
	}
	for i := range targets {
		t := targets[i].Clone()
		t.Removed = true
		if err := s.meta.Submit(metadata.KindFile, t); err != nil {
			return err
		}
		if !t.IsDir {
			for _, loc := range t.Locations {
				s.deletePhysical(loc, t.Path)
			}
		} else {
			s.removePhysicalDir(t.Path)
		}
		if s.OnFileRemoved != nil {
			s.OnFileRemoved(*t)
		}
	}
	return nil
}

// Rename moves a file or directory (and everything beneath it).
func (s *Service) Rename(oldPath string, newPath string) error {
	if !s.Ready() {
		return metadata.ErrNotInCluster
	}
	oldPath = metadata.NormalizePath(oldPath)
	newPath = metadata.NormalizePath(newPath)
	if oldPath == "/" || newPath == "/" || oldPath == newPath {
		return errors.New("invalid rename")
	}
	rec, err := s.meta.Stat(oldPath)
	if err != nil {
		return os.ErrNotExist
	}
	if _, err := s.meta.Stat(newPath); err == nil {
		return metadata.ErrExists
	}
	if err := s.ensureDirs(metadata.ParentPath(newPath), rec.Owner); err != nil {
		return err
	}
	targets := []metadata.FileRecord{*rec}
	if rec.IsDir {
		targets = append(targets, s.meta.ListSubtree(oldPath)...)
	}
	for i := range targets {
		t := targets[i].Clone()
		from := t.Path
		t.Path = newPath + t.Path[len(oldPath):]
		if !t.IsDir {
			for _, loc := range t.Locations {
				if err := s.renamePhysical(loc, from, t.Path); err != nil {
					loc.State = metadata.LocStale
					t.SetLocation(loc)
				}
			}
		}
		if err := s.meta.Submit(metadata.KindFile, t); err != nil {
			return err
		}
		if s.OnFileRenamed != nil {
			s.OnFileRenamed(from, *t)
		}
	}
	s.removePhysicalDir(oldPath)
	return nil
}

/*
	Physical helpers (local or through the transfer client)
*/

func (s *Service) deletePhysical(loc metadata.Location, logical string) {
	vol, ok := s.meta.Volume(loc.VolumeID)
	if !ok {
		return
	}
	if vol.NodeID == s.m.NodeID() {
		if real, err := s.realPath(vol, logical); err == nil {
			os.Remove(real)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.client.Delete(ctx, vol.NodeID, vol.ID, logical, false); err != nil {
		logger.PrintAndLog("Cluster", "Unable to delete copy of "+logical+" on "+s.m.NodeName(vol.NodeID)+": "+err.Error(), nil)
	}
}

// removePhysicalDir removes now-empty directories on every volume (best effort).
func (s *Service) removePhysicalDir(logical string) {
	for _, vol := range s.meta.Volumes() {
		if vol.Removed {
			continue
		}
		if vol.NodeID == s.m.NodeID() {
			if real, err := s.realPath(&vol, logical); err == nil {
				os.Remove(real) //fails when not empty, which is fine
			}
			continue
		}
		if usable(s.nodeState(vol.NodeID)) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			s.client.Delete(ctx, vol.NodeID, vol.ID, logical, false)
			cancel()
		}
	}
}

func (s *Service) renamePhysical(loc metadata.Location, from string, to string) error {
	vol, ok := s.meta.Volume(loc.VolumeID)
	if !ok {
		return ErrNotLocalVolume
	}
	if vol.NodeID == s.m.NodeID() {
		src, err := s.realPath(vol, from)
		if err != nil {
			return err
		}
		dst, err := s.realPath(vol, to)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		return os.Rename(src, dst)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.client.Rename(ctx, vol.NodeID, vol.ID, from, to)
}

func copyFile(src string, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func fileChecksum(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}
