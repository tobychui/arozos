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
	db *database.Database
	mu sync.RWMutex

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
	lease   Lease
}

func logKey(seq uint64) string { return fmt.Sprintf("%020d", seq) }

func newStore(db *database.Database) *store {
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
	return s
}

func (s *store) load() {
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
		s.db.Delete(tablePaths, existing.Path)
	}
	s.files[rec.ID] = rec
	s.db.Write(tableFiles, rec.ID, rec)
	if rec.Removed {
		if s.paths[rec.Path] == rec.ID {
			delete(s.paths, rec.Path)
			s.db.Delete(tablePaths, rec.Path)
		}
	} else {
		//A newer record for the same path replaces an older one's claim
		if otherID, taken := s.paths[rec.Path]; taken && otherID != rec.ID {
			if other, ok := s.files[otherID]; ok && other.Version < rec.Version {
				s.paths[rec.Path] = rec.ID
				s.db.Write(tablePaths, rec.Path, rec.ID)
			}
		} else {
			s.paths[rec.Path] = rec.ID
			s.db.Write(tablePaths, rec.Path, rec.ID)
		}
	}
	return true
}

func (s *store) getFileByID(id string) (*FileRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.files[id]
	if !ok {
		return nil, false
	}
	return rec.Clone(), true
}

func (s *store) getFileByPath(p string) (*FileRecord, bool) {
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
	s.db.Write(tableVolumes, v.ID, v)
	return true
}

func (s *store) getVolume(id string) (*Volume, bool) {
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
	s.db.Write(tablePolicy, p.Folder, p)
	return true
}

func (s *store) allPolicies() []Policy {
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
	s.db.Write(tableJobs, j.ID, j)
	return true
}

func (s *store) getJob(id string) (*Job, bool) {
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
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for id, j := range s.jobs {
		if j.Created < cutoff && !keepStatus[j.Status] {
			delete(s.jobs, id)
			s.db.Delete(tableJobs, id)
			n++
		}
	}
	return n
}

func (s *store) putSetting(in *Setting) bool {
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
	s.db.Write(tableSettings, st.Key, st)
	return true
}

func (s *store) getSetting(key string) (*Setting, bool) {
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
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastSeq++
	e.Seq = s.lastSeq
	e.Term = term
	s.db.Write(tableLog, logKey(e.Seq), e)
	return e
}

// logAfter returns up to max entries with Seq > after. ok is false when the
// requested range was compacted away.
func (s *store) logAfter(after uint64, max int) ([]Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
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
	if after > 0 && (first > after+1 || (len(entries) == 0 && s.lastSeq > after)) {
		return nil, false
	}
	return out, true
}

// compactLog keeps only the newest keepLast entries.
func (s *store) compactLog(keepLast int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.db.ListTableWithPrefix(tableLog, "")
	if err != nil || len(entries) <= keepLast {
		return
	}
	for _, kv := range entries[:len(entries)-keepLast] {
		s.db.Delete(tableLog, string(kv[0]))
	}
}

func (s *store) getLastSeq() uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastSeq
}

func (s *store) setLastSeq(seq uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq > s.lastSeq {
		s.lastSeq = seq
	}
}

func (s *store) getApplied() (uint64, uint64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.applied, s.term
}

func (s *store) setApplied(seq uint64, term uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.applied = seq
	s.term = term
	s.db.Write(tableState, stateApplied, seq)
	s.db.Write(tableState, stateTerm, term)
}

func (s *store) getLease() Lease {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lease
}

func (s *store) setLease(l Lease) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lease = l
	s.db.Write(tableState, stateLease, l)
}

func (s *store) addPending(id string, e Entry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[id] = e
	s.db.Write(tablePending, id, e)
}

func (s *store) removePending(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pending, id)
	s.db.Delete(tablePending, id)
}

func (s *store) pendingEntries() map[string]Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]Entry{}
	for k, v := range s.pending {
		out[k] = v
	}
	return out
}

func (s *store) snapshot() Snapshot {
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
