package sharedspace

/*
	SharedSpace collaborative documents

	Documents are revision-numbered text bodies designed for realtime
	co-editing without an OT/CRDT engine: every update is a
	compare-and-swap against the document's current revision. A client
	sends the full new content together with the revision it based its
	edit on; if the document moved on in the meantime the update is
	rejected with ErrRevisionConflict and the client re-fetches, rebases
	its edit and retries.

	Each accepted update computes a splice patch (common prefix / suffix
	diff) which is broadcast to live subscribers so other editors can
	apply the change in place. The server's content is authoritative:
	a client that detects a revision gap simply re-fetches the document,
	so convergence never depends on patch application.
*/

import (
	"time"
	"unicode/utf8"
)

const (
	//DefaultMaxDocs is the number of documents one space can hold
	DefaultMaxDocs = 64
	//MaxDocLength is the maximum document length in runes (~256KB as
	//UTF-8, safely below the 512KB WebSocket frame limit)
	MaxDocLength      = 262144
	maxDocNameLength  = 128
	docHistoryEntries = 32 // recent revisions kept in memory per document
)

// Doc is one collaborative document. All fields are guarded by the owning
// Space's mutex; consumers only ever see DocSnapshot copies.
type Doc struct {
	id        string
	name      string
	creator   string
	createdAt time.Time
	content   string
	revision  int64
	updatedAt time.Time
	updatedBy string
	history   []DocRevision // ring of recent revisions, newest last
}

// DocPatch is a single splice edit: at rune offset Pos, delete Del runes and
// insert Ins.
type DocPatch struct {
	Pos int
	Del int
	Ins string
}

// DocRevision records one accepted update, for in-memory audit / undo.
type DocRevision struct {
	Revision  int64
	UpdatedBy string
	UpdatedAt time.Time
	Patch     DocPatch
}

// DocSnapshot is an immutable copy of a document's state.
type DocSnapshot struct {
	ID        string
	Name      string
	Creator   string
	Content   string
	Revision  int64
	CreatedAt time.Time
	UpdatedAt time.Time
	UpdatedBy string
}

// snapshot builds a DocSnapshot. Callers must hold the owning Space's mutex.
func (d *Doc) snapshot() *DocSnapshot {
	return &DocSnapshot{
		ID:        d.id,
		Name:      d.name,
		Creator:   d.creator,
		Content:   d.content,
		Revision:  d.revision,
		CreatedAt: d.createdAt,
		UpdatedAt: d.updatedAt,
		UpdatedBy: d.updatedBy,
	}
}

// CreateDoc creates an empty document in the space. Requires post rights.
func (s *Space) CreateDoc(requester string, name string) (*DocSnapshot, error) {
	if !s.CanPost(requester) {
		return nil, ErrPermissionDenied
	}
	name = clipString(name, maxDocNameLength)
	if name == "" {
		name = "Untitled document"
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, ErrSpaceClosed
	}
	if len(s.docs) >= DefaultMaxDocs {
		s.mu.Unlock()
		return nil, ErrDocLimitReached
	}
	now := time.Now()
	doc := &Doc{
		id:        randomID(itemIDBytes),
		name:      name,
		creator:   requester,
		createdAt: now,
		revision:  1,
		updatedAt: now,
		updatedBy: requester,
	}
	s.docs[doc.id] = doc
	snapshot := doc.snapshot()
	s.mu.Unlock()

	s.mgrPersistDoc(snapshot)
	s.emitEvent(&SpaceEvent{Kind: EventDocCreated, Doc: snapshot})
	return snapshot, nil
}

// GetDoc returns a snapshot of the document with the given ID.
func (s *Space) GetDoc(docID string) (*DocSnapshot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[docID]
	if !ok {
		return nil, false
	}
	return doc.snapshot(), true
}

// ListDocs returns snapshots of every document in the space, without their
// content (Content is left empty to keep listings cheap).
func (s *Space) ListDocs() []*DocSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := make([]*DocSnapshot, 0, len(s.docs))
	for _, doc := range s.docs {
		snapshot := doc.snapshot()
		snapshot.Content = ""
		list = append(list, snapshot)
	}
	return list
}

// DocCount returns the number of documents in the space.
func (s *Space) DocCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.docs)
}

// UpdateDoc applies a compare-and-swap update: content replaces the document
// body only when baseRevision matches the current revision, otherwise
// ErrRevisionConflict is returned and the caller must re-fetch and rebase.
// On success the revision increments and a doc-updated event carrying the
// new snapshot and the splice patch is emitted.
func (s *Space) UpdateDoc(requester string, docID string, baseRevision int64, content string) (*DocSnapshot, error) {
	if !s.CanPost(requester) {
		return nil, ErrPermissionDenied
	}
	if utf8.RuneCountInString(content) > MaxDocLength {
		return nil, ErrDocTooLarge
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, ErrSpaceClosed
	}
	doc, ok := s.docs[docID]
	if !ok {
		s.mu.Unlock()
		return nil, ErrDocNotFound
	}
	if doc.revision != baseRevision {
		s.mu.Unlock()
		return nil, ErrRevisionConflict
	}
	patch := computeSplicePatch(doc.content, content)
	doc.content = content
	doc.revision++
	doc.updatedAt = time.Now()
	doc.updatedBy = requester
	doc.history = append(doc.history, DocRevision{
		Revision:  doc.revision,
		UpdatedBy: requester,
		UpdatedAt: doc.updatedAt,
		Patch:     patch,
	})
	if len(doc.history) > docHistoryEntries {
		doc.history = doc.history[len(doc.history)-docHistoryEntries:]
	}
	snapshot := doc.snapshot()
	s.mu.Unlock()

	s.mgrPersistDoc(snapshot)
	s.emitEvent(&SpaceEvent{Kind: EventDocUpdated, Doc: snapshot, Patch: &patch})
	return snapshot, nil
}

// DocHistory returns the recent revision log of a document (newest last).
func (s *Space) DocHistory(docID string) ([]DocRevision, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[docID]
	if !ok {
		return nil, false
	}
	history := make([]DocRevision, len(doc.history))
	copy(history, doc.history)
	return history, true
}

// DeleteDoc removes a document. Only the document's creator, a space
// manager, or the system may delete it.
func (s *Space) DeleteDoc(requester string, docID string) error {
	s.mu.Lock()
	doc, ok := s.docs[docID]
	if !ok {
		s.mu.Unlock()
		return ErrDocNotFound
	}
	if requester != "" && requester != doc.creator && requester != s.Owner && s.members[requester] != RoleAdmin {
		s.mu.Unlock()
		return ErrPermissionDenied
	}
	delete(s.docs, docID)
	snapshot := doc.snapshot()
	s.mu.Unlock()

	s.mgrDeleteDocRecord(docID)
	s.emitEvent(&SpaceEvent{Kind: EventDocDeleted, Doc: snapshot})
	return nil
}

// computeSplicePatch derives the single splice (common prefix / suffix diff)
// that turns oldStr into newStr, in rune offsets.
func computeSplicePatch(oldStr string, newStr string) DocPatch {
	oldRunes := []rune(oldStr)
	newRunes := []rune(newStr)

	prefix := 0
	for prefix < len(oldRunes) && prefix < len(newRunes) && oldRunes[prefix] == newRunes[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(oldRunes)-prefix && suffix < len(newRunes)-prefix &&
		oldRunes[len(oldRunes)-1-suffix] == newRunes[len(newRunes)-1-suffix] {
		suffix++
	}
	return DocPatch{
		Pos: prefix,
		Del: len(oldRunes) - prefix - suffix,
		Ins: string(newRunes[prefix : len(newRunes)-suffix]),
	}
}
