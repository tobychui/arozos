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
	logger.DebugTrace("cluster/metadata", "logKey")
	return fmt.Sprintf("%020d", seq)
}

func newStore(db *database.Database) (out0 *store) {
	defer logger.Out1(logger.In1("cluster/metadata", "newStore", "db", db), &out0)
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
	defer logger.Out0(logger.In1("cluster/metadata", "store.load", "s", s))
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
func (s *store) putFile(in *FileRecord) (out0 bool) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.putFile", "s", s, "in", in), &out0)
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

func (s *store) getFileByID(id string) (out0 *FileRecord, out1 bool) {
	defer logger.Out2(logger.In2("cluster/metadata", "store.getFileByID", "s", s, "id", id), &out0, &out1)
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.files[id]
	if !ok {
		return nil, false
	}
	return rec.Clone(), true
}

func (s *store) getFileByPath(p string) (out0 *FileRecord, out1 bool) {
	defer logger.Out2(logger.In2("cluster/metadata", "store.getFileByPath", "s", s, "p", p), &out0, &out1)
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
func (s *store) listDir(dir string) (out0 []FileRecord) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.listDir", "s", s, "dir", dir), &out0)
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
func (s *store) listSubtree(dir string) (out0 []FileRecord) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.listSubtree", "s", s, "dir", dir), &out0)
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

func (s *store) allFiles() (out0 []FileRecord) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.allFiles", "s", s), &out0)
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
	defer logger.Out2(logger.In1("cluster/metadata", "store.counts", "s", s), &files, &dirs)
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

func (s *store) putVolume(in *Volume) (out0 bool) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.putVolume", "s", s, "in", in), &out0)
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

func (s *store) getVolume(id string) (out0 *Volume, out1 bool) {
	defer logger.Out2(logger.In2("cluster/metadata", "store.getVolume", "s", s, "id", id), &out0, &out1)
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.volumes[id]
	if !ok {
		return nil, false
	}
	c := *v
	return &c, true
}

func (s *store) allVolumes() (out0 []Volume) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.allVolumes", "s", s), &out0)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Volume, 0, len(s.volumes))
	for _, v := range s.volumes {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (s *store) putPolicy(in *Policy) (out0 bool) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.putPolicy", "s", s, "in", in), &out0)
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

func (s *store) allPolicies() (out0 []Policy) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.allPolicies", "s", s), &out0)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Policy, 0, len(s.policies))
	for _, p := range s.policies {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Folder < out[j].Folder })
	return out
}

func (s *store) policyFor(p string) (out0 Policy) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.policyFor", "s", s, "p", p), &out0)
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

func (s *store) putJob(in *Job) (out0 bool) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.putJob", "s", s, "in", in), &out0)
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

func (s *store) getJob(id string) (out0 *Job, out1 bool) {
	defer logger.Out2(logger.In2("cluster/metadata", "store.getJob", "s", s, "id", id), &out0, &out1)
	s.mu.RLock()
	defer s.mu.RUnlock()
	j, ok := s.jobs[id]
	if !ok {
		return nil, false
	}
	c := *j
	return &c, true
}

func (s *store) allJobs() (out0 []Job) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.allJobs", "s", s), &out0)
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
func (s *store) gcJobs(cutoff int64, keepStatus map[string]bool) (out0 int) {
	defer logger.Out1(logger.In3("cluster/metadata", "store.gcJobs", "s", s, "cutoff", cutoff, "keepStatus", keepStatus), &out0)
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

func (s *store) putSetting(in *Setting) (out0 bool) {
	defer logger.Out1(logger.In2("cluster/metadata", "store.putSetting", "s", s, "in", in), &out0)
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

func (s *store) getSetting(key string) (out0 *Setting, out1 bool) {
	defer logger.Out2(logger.In2("cluster/metadata", "store.getSetting", "s", s, "!key", key), &out0, &out1)
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
func (s *store) appendLog(e Entry, term uint64) (out0 Entry) {
	defer logger.Out1(logger.In3("cluster/metadata", "store.appendLog", "s", s, "&e", &e, "term", term), &out0)
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
func (s *store) logAfter(after uint64, max int) (out0 []Entry, out1 bool) {
	defer logger.Out2(logger.In3("cluster/metadata", "store.logAfter", "s", s, "after", after, "max", max), &out0, &out1)
	//The log is read back from disk, so commit what is still queued first
	s.persist.flush()
	lastSeq := s.getLastSeq()
	entries, err := s.db.ListTableWithPrefix(tableLog, "")
	if err != nil {
		logger.DebugErr("cluster/metadata", err)
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
	defer logger.Out0(logger.In2("cluster/metadata", "store.compactLog", "s", s, "keepLast", keepLast))
	s.persist.flush()
	entries, err := s.db.ListTableWithPrefix(tableLog, "")
	if err != nil || len(entries) <= keepLast {
		return
	}
	for _, kv := range entries[:len(entries)-keepLast] {
		s.persist.del(tableLog, string(kv[0]))
	}
}

func (s *store) getLastSeq() (out0 uint64) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.getLastSeq", "s", s), &out0)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastSeq
}

func (s *store) setLastSeq(seq uint64) {
	defer logger.Out0(logger.In2("cluster/metadata", "store.setLastSeq", "s", s, "seq", seq))
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq > s.lastSeq {
		s.lastSeq = seq
	}
}

func (s *store) getApplied() (out0 uint64, out1 uint64) {
	defer logger.Out2(logger.In1("cluster/metadata", "store.getApplied", "s", s), &out0, &out1)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.applied, s.term
}

func (s *store) setApplied(seq uint64, term uint64) {
	defer logger.Out0(logger.In3("cluster/metadata", "store.setApplied", "s", s, "seq", seq, "term", term))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.applied = seq
	s.term = term
	s.persist.put(tableState, stateApplied, seq)
	s.persist.put(tableState, stateTerm, term)
}

func (s *store) getLease() (out0 Lease) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.getLease", "s", s), &out0)
	s.leaseMu.RLock()
	defer s.leaseMu.RUnlock()
	return s.lease
}

func (s *store) setLease(l Lease) {
	defer logger.Out0(logger.In2("cluster/metadata", "store.setLease", "s", s, "&l", &l))
	s.leaseMu.Lock()
	s.lease = l
	s.leaseMu.Unlock()
	s.persist.put(tableState, stateLease, l)
}

func (s *store) addPending(id string, e Entry) {
	defer logger.Out0(logger.In3("cluster/metadata", "store.addPending", "s", s, "id", id, "&e", &e))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[id] = e
	s.persist.put(tablePending, id, e)
}

func (s *store) removePending(id string) {
	defer logger.Out0(logger.In2("cluster/metadata", "store.removePending", "s", s, "id", id))
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pending, id)
	s.persist.del(tablePending, id)
}

func (s *store) pendingEntries() (out0 map[string]Entry) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.pendingEntries", "s", s), &out0)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]Entry{}
	for k, v := range s.pending {
		out[k] = v
	}
	return out
}

func (s *store) snapshot() (out0 Snapshot) {
	defer logger.Out1(logger.In1("cluster/metadata", "store.snapshot", "s", s), &out0)
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
