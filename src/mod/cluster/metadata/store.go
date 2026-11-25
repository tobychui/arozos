package metadata

/*
	ACMS local store: in-memory maps backed by cluster.db tables.

	Tables (all registered as cluster tables, wiped on leave):
		meta_files    ID     -> FileRecord
		meta_paths    Path   -> ID
		meta_volumes  ID     -> Volume
		meta_policy   Folder -> Policy
		meta_log      %020d  -> Entry
		meta_pending  uuid   -> Entry (changes not yet accepted by a leader)
		meta_state    lease / applied / term
*/

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	tableFiles    = "meta_files"
	tablePaths    = "meta_paths"
	tableVolumes  = "meta_volumes"
	tablePolicy   = "meta_policy"
	tableJobs     = "meta_jobs"
	tableSettings = "meta_settings"
	tableLog      = "meta_log"
	tablePending  = "meta_pending"
	tableState    = "meta_state"
	stateLease    = "lease"
	stateApplied  = "applied"
	stateTerm     = "term"
	defaultPolicy = 1
)

// Tables lists every cluster.db table used by the metadata store.
var Tables = []string{tableFiles, tablePaths, tableVolumes, tablePolicy, tableJobs, tableSettings, tableLog, tablePending, tableState}

type store struct {
	db      *database.Database
	persist *persister //disk writes happen here, never under mu
	mu      sync.RWMutex

	files    map[string]*FileRecord
	paths    map[string]string
	volumes  map[string]*Volume
	policies map[string]*Policy
	jobs     map[string]*Job
	settings map[string]*Setting
	pending  map[string]Entry

	lastSeq uint64
	applied uint64
	term    uint64

	//The lease has its own lock: renewing it must never wait behind the
	//namespace, or a busy leader loses its lease.
	leaseMu sync.RWMutex
	lease   Lease
}

func logKey(seq uint64) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("cluster/metadata", "logKey: seq=%d", seq)
	}
	return fmt.Sprintf("%020d", seq)
}

func newStore(db *database.Database) *store {
	logger.Debug("cluster/metadata", "newStore")
	s := &store{
		db:       db,
		files:    map[string]*FileRecord{},
		paths:    map[string]string{},
		volumes:  map[string]*Volume{},
		policies: map[string]*Policy{},
		jobs:     map[string]*Job{},
		settings: map[string]*Setting{},
		pending:  map[string]Entry{},
	}
	for _, t := range Tables {
		db.NewTable(t)
	}
	s.load()
	s.persist = newPersister(db)
	return s
}

// close commits pending disk writes and stops the writer.
func (s *store) close() {
	logger.DebugTrace("cluster/metadata", "store.close")
	s.persist.close()
}

// discard drops pending disk writes; used when the tables were wiped.
func (s *store) discard() {
	logger.DebugTrace("cluster/metadata", "store.discard")
	s.persist.discard()
}

func (s *store) load() {
	logger.Debug("cluster/metadata", "store.load")
	if entries, err := s.db.ListTable(tableFiles); err == nil {
		for _, kv := range entries {
			var rec FileRecord
			if json.Unmarshal(kv[1], &rec) == nil && rec.ID != "" {
				s.files[rec.ID] = &rec
				if !rec.Removed {
					s.paths[rec.Path] = rec.ID
				}
			}
		}
	}
	if entries, err := s.db.ListTable(tableVolumes); err == nil {
		for _, kv := range entries {
			var v Volume
			if json.Unmarshal(kv[1], &v) == nil && v.ID != "" {
				s.volumes[v.ID] = &v
			}
		}
	}
	if entries, err := s.db.ListTable(tablePolicy); err == nil {
		for _, kv := range entries {
			var p Policy
			if json.Unmarshal(kv[1], &p) == nil && p.Folder != "" {
				s.policies[p.Folder] = &p
			}
		}
	}
	if entries, err := s.db.ListTable(tableJobs); err == nil {
		for _, kv := range entries {
			var j Job
			if json.Unmarshal(kv[1], &j) == nil && j.ID != "" {
				s.jobs[j.ID] = &j
			}
		}
	}
	if entries, err := s.db.ListTable(tableSettings); err == nil {
		for _, kv := range entries {
			var st Setting
			if json.Unmarshal(kv[1], &st) == nil && st.Key != "" {
				s.settings[st.Key] = &st
			}
		}
	}
	if entries, err := s.db.ListTable(tablePending); err == nil {
		for _, kv := range entries {
			var e Entry
			if json.Unmarshal(kv[1], &e) == nil {
				s.pending[string(kv[0])] = e
			}
		}
	}
	if entries, err := s.db.ListTable(tableLog); err == nil && len(entries) > 0 {
		var last Entry
		if json.Unmarshal(entries[len(entries)-1][1], &last) == nil {
			s.lastSeq = last.Seq
		}
	}
	s.db.Read(tableState, stateApplied, &s.applied)
	s.db.Read(tableState, stateTerm, &s.term)
	s.db.Read(tableState, stateLease, &s.lease)
}

/*
	Files
*/

// putFile merges a record last-writer-wins. Returns true when stored.
func (s *store) putFile(in *FileRecord) bool {
	logger.Debug("cluster/metadata", "store.putFile")
	if in == nil || in.ID == "" || in.Path == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := in.Clone()
	rec.Path = NormalizePath(rec.Path)
	existing, ok := s.files[rec.ID]
	if ok && rec.Version <= existing.Version {
		return false
	}
	if ok && existing.Path != rec.Path && s.paths[existing.Path] == rec.ID {
		delete(s.paths, existing.Path)
		s.persist.del(tablePaths, existing.Path)
	}
	s.files[rec.ID] = rec
	s.persist.put(tableFiles, rec.ID, rec)
	if rec.Removed {
		if s.paths[rec.Path] == rec.ID {
			delete(s.paths, rec.Path)
			s.persist.del(tablePaths, rec.Path)
		}
	} else {
		//A newer record for the same path replaces an older one's claim
		if otherID, taken := s.paths[rec.Path]; taken && otherID != rec.ID {
			if other, ok := s.files[otherID]; ok && other.Version < rec.Version {
				s.paths[rec.Path] = rec.ID
				s.persist.put(tablePaths, rec.Path, rec.ID)
			}
		} else {
			s.paths[rec.Path] = rec.ID
			s.persist.put(tablePaths, rec.Path, rec.ID)
		}
	}
	return true
}

func (s *store) getFileByID(id string) (*FileRecord, bool) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.getFileByID: id=%.120q", id)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.files[id]
	if !ok {
		return nil, false
	}
	return rec.Clone(), true
}

func (s *store) getFileByPath(p string) (*FileRecord, bool) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.getFileByPath: p=%.120q", p)
	}
	p = NormalizePath(p)
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.paths[p]
	if !ok {
		return nil, false
	}
	rec, ok := s.files[id]
	if !ok || rec.Removed {
		return nil, false
	}
	return rec.Clone(), true
}

// listDir returns the live children of a directory path, sorted by name.
func (s *store) listDir(dir string) []FileRecord {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.listDir: dir=%.120q", dir)
	}
	dir = NormalizePath(dir)
	prefix := dir + "/"
	if dir == "/" {
		prefix = "/"
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []FileRecord{}
	for p, id := range s.paths {
		if !strings.HasPrefix(p, prefix) || p == dir {
			continue
		}
		rest := strings.TrimPrefix(p, prefix)
		if rest == "" || strings.Contains(rest, "/") {
			continue
		}
		if rec, ok := s.files[id]; ok && !rec.Removed {
			out = append(out, *rec.Clone())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// listSubtree returns every live record under a directory (recursive).
func (s *store) listSubtree(dir string) []FileRecord {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.listSubtree: dir=%.120q", dir)
	}
	dir = NormalizePath(dir)
	prefix := dir + "/"
	if dir == "/" {
		prefix = "/"
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []FileRecord{}
	for p, id := range s.paths {
		if !strings.HasPrefix(p, prefix) || p == dir {
			continue
		}
		if rec, ok := s.files[id]; ok && !rec.Removed {
			out = append(out, *rec.Clone())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func (s *store) allFiles() []FileRecord {
	logger.Debug("cluster/metadata", "store.allFiles")
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]FileRecord, 0, len(s.files))
	for _, rec := range s.files {
		out = append(out, *rec.Clone())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func (s *store) counts() (files int, dirs int) {
	logger.Debug("cluster/metadata", "store.counts")
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, id := range s.paths {
		if rec, ok := s.files[id]; ok {
			if rec.IsDir {
				dirs++
			} else {
				files++
			}
		}
	}
	return
}

/*
	Volumes and policies
*/

func (s *store) putVolume(in *Volume) bool {
	logger.Debug("cluster/metadata", "store.putVolume")
	if in == nil || in.ID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.volumes[in.ID]; ok && in.Version <= existing.Version {
		return false
	}
	v := *in
	s.volumes[v.ID] = &v
	s.persist.put(tableVolumes, v.ID, v)
	return true
}

func (s *store) getVolume(id string) (*Volume, bool) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.getVolume: id=%.120q", id)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.volumes[id]
	if !ok {
		return nil, false
	}
	c := *v
	return &c, true
}

func (s *store) allVolumes() []Volume {
	logger.Debug("cluster/metadata", "store.allVolumes")
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Volume, 0, len(s.volumes))
	for _, v := range s.volumes {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (s *store) putPolicy(in *Policy) bool {
	logger.Debug("cluster/metadata", "store.putPolicy")
	if in == nil || in.Folder == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := *in
	p.Folder = TopFolder(p.Folder)
	if existing, ok := s.policies[p.Folder]; ok && p.Version <= existing.Version {
		return false
	}
	s.policies[p.Folder] = &p
	s.persist.put(tablePolicy, p.Folder, p)
	return true
}

func (s *store) allPolicies() []Policy {
	logger.Debug("cluster/metadata", "store.allPolicies")
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Policy, 0, len(s.policies))
	for _, p := range s.policies {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Folder < out[j].Folder })
	return out
}

func (s *store) policyFor(p string) Policy {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.policyFor: p=%.120q", p)
	}
	folder := TopFolder(p)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if pol, ok := s.policies[folder]; ok && pol.Replicas > 0 {
		return *pol
	}
	return Policy{Folder: folder, Replicas: defaultPolicy}
}

/*
	Jobs
*/

func (s *store) putJob(in *Job) bool {
	logger.Debug("cluster/metadata", "store.putJob")
	if in == nil || in.ID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.jobs[in.ID]; ok && in.Version <= existing.Version {
		return false
	}
	j := *in
	s.jobs[j.ID] = &j
	s.persist.put(tableJobs, j.ID, j)
	return true
}

func (s *store) getJob(id string) (*Job, bool) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.getJob: id=%.120q", id)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	j, ok := s.jobs[id]
	if !ok {
		return nil, false
	}
	c := *j
	return &c, true
}

func (s *store) allJobs() []Job {
	logger.Debug("cluster/metadata", "store.allJobs")
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, *j)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created > out[j].Created })
	return out
}

// gcJobs drops finished job records older than cutoff.
func (s *store) gcJobs(cutoff int64, keepStatus map[string]bool) int {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.gcJobs: cutoff=%d len(keepStatus)=%d", cutoff, len(keepStatus))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for id, j := range s.jobs {
		if j.Created < cutoff && !keepStatus[j.Status] {
			delete(s.jobs, id)
			s.persist.del(tableJobs, id)
			n++
		}
	}
	return n
}

func (s *store) putSetting(in *Setting) bool {
	logger.Debug("cluster/metadata", "store.putSetting")
	if in == nil || in.Key == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.settings[in.Key]; ok && in.Version <= existing.Version {
		return false
	}
	st := *in
	s.settings[st.Key] = &st
	s.persist.put(tableSettings, st.Key, st)
	return true
}

func (s *store) getSetting(key string) (*Setting, bool) {
	logger.Debug("cluster/metadata", "store.getSetting")
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.settings[key]
	if !ok {
		return nil, false
	}
	c := *st
	return &c, true
}

/*
	Log and state
*/

// appendLog assigns the next sequence number in the given term and persists.
func (s *store) appendLog(e Entry, term uint64) Entry {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.appendLog: term=%d", term)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastSeq++
	e.Seq = s.lastSeq
	e.Term = term
	s.persist.put(tableLog, logKey(e.Seq), e)
	return e
}

// logAfter returns up to max entries with Seq > after. ok is false when the
// requested range was compacted away.
func (s *store) logAfter(after uint64, max int) ([]Entry, bool) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.logAfter: after=%d max=%d", after, max)
	}
	//The log is read back from disk, so commit what is still queued first
	s.persist.flush()
	lastSeq := s.getLastSeq()
	entries, err := s.db.ListTableWithPrefix(tableLog, "")
	if err != nil {
		return nil, false
	}
	out := []Entry{}
	var first uint64
	for _, kv := range entries {
		var e Entry
		if json.Unmarshal(kv[1], &e) != nil {
			continue
		}
		if first == 0 {
			first = e.Seq
		}
		if e.Seq > after {
			out = append(out, e)
			if len(out) >= max {
				break
			}
		}
	}
	if after > 0 && (first > after+1 || (len(entries) == 0 && lastSeq > after)) {
		return nil, false
	}
	return out, true
}

// compactLog keeps only the newest keepLast entries.
func (s *store) compactLog(keepLast int) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.compactLog: keepLast=%d", keepLast)
	}
	s.persist.flush()
	entries, err := s.db.ListTableWithPrefix(tableLog, "")
	if err != nil || len(entries) <= keepLast {
		return
	}
	for _, kv := range entries[:len(entries)-keepLast] {
		s.persist.del(tableLog, string(kv[0]))
	}
}

func (s *store) getLastSeq() uint64 {
	logger.Debug("cluster/metadata", "store.getLastSeq")
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastSeq
}

func (s *store) setLastSeq(seq uint64) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.setLastSeq: seq=%d", seq)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq > s.lastSeq {
		s.lastSeq = seq
	}
}

func (s *store) getApplied() (uint64, uint64) {
	logger.Debug("cluster/metadata", "store.getApplied")
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.applied, s.term
}

func (s *store) setApplied(seq uint64, term uint64) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.setApplied: seq=%d term=%d", seq, term)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.applied = seq
	s.term = term
	s.persist.put(tableState, stateApplied, seq)
	s.persist.put(tableState, stateTerm, term)
}

func (s *store) getLease() Lease {
	logger.Debug("cluster/metadata", "store.getLease")
	s.leaseMu.RLock()
	defer s.leaseMu.RUnlock()
	return s.lease
}

func (s *store) setLease(l Lease) {
	logger.Debug("cluster/metadata", "store.setLease")
	s.leaseMu.Lock()
	s.lease = l
	s.leaseMu.Unlock()
	s.persist.put(tableState, stateLease, l)
}

func (s *store) addPending(id string, e Entry) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.addPending: id=%.120q", id)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[id] = e
	s.persist.put(tablePending, id, e)
}

func (s *store) removePending(id string) {
	if logger.IsDebug() {
		logger.Debugf("cluster/metadata", "store.removePending: id=%.120q", id)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pending, id)
	s.persist.del(tablePending, id)
}

func (s *store) pendingEntries() map[string]Entry {
	logger.Debug("cluster/metadata", "store.pendingEntries")
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]Entry{}
	for k, v := range s.pending {
		out[k] = v
	}
	return out
}

func (s *store) snapshot() Snapshot {
	logger.Debug("cluster/metadata", "store.snapshot")
	s.mu.RLock()
	defer s.mu.RUnlock()
	snap := Snapshot{LastSeq: s.lastSeq, Term: s.term, Files: []FileRecord{}, Volumes: []Volume{}, Policies: []Policy{}, Jobs: []Job{}, Settings: []Setting{}}
	for _, rec := range s.files {
		snap.Files = append(snap.Files, *rec.Clone())
	}
	for _, v := range s.volumes {
		snap.Volumes = append(snap.Volumes, *v)
	}
	for _, p := range s.policies {
		snap.Policies = append(snap.Policies, *p)
	}
	for _, j := range s.jobs {
		snap.Jobs = append(snap.Jobs, *j)
	}
	for _, st := range s.settings {
		snap.Settings = append(snap.Settings, *st)
	}
	return snap
}
