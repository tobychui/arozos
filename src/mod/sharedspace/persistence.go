package sharedspace

/*
	SharedSpace persistence

	Persistent spaces write through to the ArozOS system database and
	keep their blobs under a durable storage root, so chat history,
	shared files and collaborative documents survive server restarts.

	Layout (values are JSON, one bolt transaction per write):

	  table "sharedspace":      key "space/<spaceID>" -> spaceRecord
	                            (key "conf/<name>" is reserved for the
	                            admin configuration written by the main
	                            package)
	  table "sharedspaceitem":  key "<spaceID>/<itemID>" -> itemRecord
	  table "sharedspacedoc":   key "<spaceID>/<docID>"  -> docRecord

	Blobs live at <persistRoot>/<spaceID>/<itemID>; disk paths are never
	persisted - they are rebuilt from the root at reload. Reload is
	self-healing: records whose space vanished, blob went missing or
	JSON no longer parses are deleted, and blob directories without a
	live space are removed.
*/

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

const (
	dbTableSpaces    = "sharedspace"
	dbTableItems     = "sharedspaceitem"
	dbTableDocs      = "sharedspacedoc"
	dbSpaceKeyPrefix = "space/"
)

// spaceRecord is the persisted form of a Space.
type spaceRecord struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Owner     string            `json:"owner"`
	CreatedAt int64             `json:"createdat"`
	Access    string            `json:"access"`
	Metadata  map[string]string `json:"metadata"`
	Members   map[string]string `json:"members"`
	MaxItems  int               `json:"maxitems"`
}

// itemRecord is the persisted form of an Item. Disk paths are rebuilt from
// the persistent root at reload and never stored.
type itemRecord struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Text      string `json:"text"`
	Size      int64  `json:"size"`
	Uploader  string `json:"uploader"`
	Origin    string `json:"origin"`
	Seq       int64  `json:"seq"`
	CreatedAt int64  `json:"createdat"`
	HasBlob   bool   `json:"hasblob"`
}

// docRecord is the persisted form of a document (current revision only; the
// in-memory history ring is not persisted).
type docRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Creator   string `json:"creator"`
	Content   string `json:"content"`
	Revision  int64  `json:"revision"`
	CreatedAt int64  `json:"createdat"`
	UpdatedAt int64  `json:"updatedat"`
	UpdatedBy string `json:"updatedby"`
}

// initPersistenceTables creates the sharedspace tables when missing.
func (m *Manager) initPersistenceTables() {
	m.db.NewTable(dbTableSpaces)
	m.db.NewTable(dbTableItems)
	m.db.NewTable(dbTableDocs)
}

// record snapshots the space's persisted state.
func (s *Space) record() *spaceRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	metadata := make(map[string]string, len(s.metadata))
	for key, value := range s.metadata {
		metadata[key] = value
	}
	members := make(map[string]string, len(s.members))
	for username, role := range s.members {
		members[username] = role
	}
	return &spaceRecord{
		ID:        s.ID,
		Name:      s.Name,
		Owner:     s.Owner,
		CreatedAt: s.CreatedAt.Unix(),
		Access:    s.access,
		Metadata:  metadata,
		Members:   members,
		MaxItems:  s.maxItems,
	}
}

// persistSpace writes the space record through to the database. No-op for
// ephemeral spaces or persistence-less managers.
func (m *Manager) persistSpace(s *Space) {
	if s == nil || !s.Persistent || m.db == nil {
		return
	}
	err := m.db.Write(dbTableSpaces, dbSpaceKeyPrefix+s.ID, s.record())
	if err != nil {
		logger.PrintAndLog("SharedSpace", "Failed to persist space "+s.ID, err)
	}
}

// mgrPersistSpace lets Space methods write their record through without
// holding any lock. Nil-safe for spaces built directly in tests.
func (s *Space) mgrPersistSpace() {
	if s.mgr != nil {
		s.mgr.persistSpace(s)
	}
}

// mgrPersistItem writes an item record through to the database.
func (s *Space) mgrPersistItem(item *Item) {
	if s.mgr == nil || !s.Persistent || s.mgr.db == nil {
		return
	}
	record := &itemRecord{
		ID:        item.ID,
		Type:      item.Type,
		Name:      item.Name,
		Text:      item.Text,
		Size:      item.Size,
		Uploader:  item.Uploader,
		Origin:    item.Origin,
		Seq:       item.Seq,
		CreatedAt: item.CreatedAt.Unix(),
		HasBlob:   item.DiskPath != "",
	}
	err := s.mgr.db.Write(dbTableItems, s.ID+"/"+item.ID, record)
	if err != nil {
		logger.PrintAndLog("SharedSpace", "Failed to persist item "+item.ID, err)
	}
}

// mgrDeleteItemRecord removes an item record from the database.
func (s *Space) mgrDeleteItemRecord(itemID string) {
	if s.mgr == nil || !s.Persistent || s.mgr.db == nil {
		return
	}
	s.mgr.db.Delete(dbTableItems, s.ID+"/"+itemID)
}

// mgrPersistDoc writes a document record through to the database.
func (s *Space) mgrPersistDoc(snapshot *DocSnapshot) {
	if s.mgr == nil || !s.Persistent || s.mgr.db == nil {
		return
	}
	record := &docRecord{
		ID:        snapshot.ID,
		Name:      snapshot.Name,
		Creator:   snapshot.Creator,
		Content:   snapshot.Content,
		Revision:  snapshot.Revision,
		CreatedAt: snapshot.CreatedAt.Unix(),
		UpdatedAt: snapshot.UpdatedAt.Unix(),
		UpdatedBy: snapshot.UpdatedBy,
	}
	err := s.mgr.db.Write(dbTableDocs, s.ID+"/"+snapshot.ID, record)
	if err != nil {
		logger.PrintAndLog("SharedSpace", "Failed to persist document "+snapshot.ID, err)
	}
}

// mgrDeleteDocRecord removes a document record from the database.
func (s *Space) mgrDeleteDocRecord(docID string) {
	if s.mgr == nil || !s.Persistent || s.mgr.db == nil {
		return
	}
	s.mgr.db.Delete(dbTableDocs, s.ID+"/"+docID)
}

// deleteSpaceRecords removes every database record belonging to a space.
func (m *Manager) deleteSpaceRecords(spaceID string) {
	if m.db == nil {
		return
	}
	m.db.Delete(dbTableSpaces, dbSpaceKeyPrefix+spaceID)
	for _, table := range []string{dbTableItems, dbTableDocs} {
		entries, err := m.db.ListTable(table)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			key := string(entry[0])
			if strings.HasPrefix(key, spaceID+"/") {
				m.db.Delete(table, key)
			}
		}
	}
}

// loadPersistedSpaces rebuilds every persistent space from the database at
// construction time, restoring items (with blobs) and documents.
func (m *Manager) loadPersistedSpaces() {
	entries, err := m.db.ListTable(dbTableSpaces)
	if err != nil {
		logger.PrintAndLog("SharedSpace", "Failed to list persisted spaces", err)
		return
	}

	//1. Space records
	for _, entry := range entries {
		key := string(entry[0])
		if !strings.HasPrefix(key, dbSpaceKeyPrefix) {
			continue //conf/* and future keys
		}
		record := spaceRecord{}
		if err := json.Unmarshal(entry[1], &record); err != nil || record.ID == "" {
			logger.PrintAndLog("SharedSpace", "Dropping corrupted space record "+key, err)
			m.db.Delete(dbTableSpaces, key)
			continue
		}
		if !validAccessMode(record.Access) {
			record.Access = AccessOpen
		}
		if record.MaxItems <= 0 {
			record.MaxItems = m.defaultMaxItems
		}
		members := record.Members
		if members == nil {
			members = map[string]string{}
		}
		members[record.Owner] = RoleOwner
		metadata := record.Metadata
		if metadata == nil {
			metadata = map[string]string{}
		}
		space := &Space{
			ID:          record.ID,
			Name:        record.Name,
			Owner:       record.Owner,
			access:      record.Access,
			Persistent:  true,
			CreatedAt:   time.Unix(record.CreatedAt, 0),
			storageDir:  filepath.Join(m.persistRoot, record.ID),
			metadata:    metadata,
			members:     members,
			docs:        make(map[string]*Doc),
			items:       []*Item{},
			itemIdx:     make(map[string]*Item),
			listeners:   make(map[string]func(*Item)),
			evListeners: make(map[string]func(*SpaceEvent)),
			nextSeq:     1,
			maxItems:    record.MaxItems,
			trimOldest:  true,
			mgr:         m,
		}
		m.spaces[space.ID] = space
	}

	//2. Item records
	itemEntries, err := m.db.ListTable(dbTableItems)
	if err == nil {
		for _, entry := range itemEntries {
			key := string(entry[0])
			slash := strings.Index(key, "/")
			if slash <= 0 {
				m.db.Delete(dbTableItems, key)
				continue
			}
			spaceID := key[:slash]
			space, exists := m.spaces[spaceID]
			if !exists {
				m.db.Delete(dbTableItems, key) //space vanished: self-heal
				continue
			}
			record := itemRecord{}
			if err := json.Unmarshal(entry[1], &record); err != nil || record.ID == "" {
				logger.PrintAndLog("SharedSpace", "Dropping corrupted item record "+key, err)
				m.db.Delete(dbTableItems, key)
				continue
			}
			item := &Item{
				ID:        record.ID,
				Type:      record.Type,
				Name:      record.Name,
				Text:      record.Text,
				Size:      record.Size,
				Uploader:  record.Uploader,
				Origin:    record.Origin,
				Seq:       record.Seq,
				CreatedAt: time.Unix(record.CreatedAt, 0),
			}
			if record.HasBlob {
				item.DiskPath = filepath.Join(m.persistRoot, spaceID, record.ID)
				if _, err := os.Stat(item.DiskPath); err != nil {
					m.db.Delete(dbTableItems, key) //blob vanished: self-heal
					continue
				}
			}
			space.items = append(space.items, item)
			space.itemIdx[item.ID] = item
		}
	}

	//3. Document records
	docEntries, err := m.db.ListTable(dbTableDocs)
	if err == nil {
		for _, entry := range docEntries {
			key := string(entry[0])
			slash := strings.Index(key, "/")
			if slash <= 0 {
				m.db.Delete(dbTableDocs, key)
				continue
			}
			spaceID := key[:slash]
			space, exists := m.spaces[spaceID]
			if !exists {
				m.db.Delete(dbTableDocs, key)
				continue
			}
			record := docRecord{}
			if err := json.Unmarshal(entry[1], &record); err != nil || record.ID == "" {
				logger.PrintAndLog("SharedSpace", "Dropping corrupted document record "+key, err)
				m.db.Delete(dbTableDocs, key)
				continue
			}
			space.docs[record.ID] = &Doc{
				id:        record.ID,
				name:      record.Name,
				creator:   record.Creator,
				createdAt: time.Unix(record.CreatedAt, 0),
				content:   record.Content,
				revision:  record.Revision,
				updatedAt: time.Unix(record.UpdatedAt, 0),
				updatedBy: record.UpdatedBy,
			}
		}
	}

	//4. Restore chronological ordering and the per-space sequence counter
	loadedSpaces := 0
	for _, space := range m.spaces {
		sort.Slice(space.items, func(i, j int) bool {
			return space.items[i].Seq < space.items[j].Seq
		})
		if count := len(space.items); count > 0 {
			space.nextSeq = space.items[count-1].Seq + 1
		}
		loadedSpaces++
	}

	//5. Remove blob directories that no longer belong to a live space
	if dirEntries, err := os.ReadDir(m.persistRoot); err == nil {
		for _, dirEntry := range dirEntries {
			if !dirEntry.IsDir() {
				continue
			}
			if _, exists := m.spaces[dirEntry.Name()]; !exists {
				os.RemoveAll(filepath.Join(m.persistRoot, dirEntry.Name()))
			}
		}
	}

	if loadedSpaces > 0 {
		logger.PrintAndLog("SharedSpace", "Restored "+strconv.Itoa(loadedSpaces)+" persistent shared space(s)", nil)
	}
}

// SweepStaleSpaces deletes persistent spaces whose most recent activity
// (newest item, newest document update, or creation) is older than maxAge
// and that have no live channel subscribers. It returns the IDs it deleted.
// Ephemeral spaces are left to their owning subsystems (e.g. MeetRoom).
func (m *Manager) SweepStaleSpaces(maxAge time.Duration) []string {
	if maxAge <= 0 {
		return nil
	}
	cutoff := time.Now().Add(-maxAge)

	var stale []string
	m.mu.RLock()
	for id, space := range m.spaces {
		if !space.Persistent {
			continue
		}
		space.mu.Lock()
		last := space.CreatedAt
		for _, item := range space.items {
			if item.CreatedAt.After(last) {
				last = item.CreatedAt
			}
		}
		for _, doc := range space.docs {
			if doc.updatedAt.After(last) {
				last = doc.updatedAt
			}
		}
		channel := space.channel
		space.mu.Unlock()
		if channel != nil && channel.Count() > 0 {
			continue
		}
		if last.Before(cutoff) {
			stale = append(stale, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range stale {
		m.DeleteSpace(id)
		logger.PrintAndLog("SharedSpace", "Removed stale shared space "+id, nil)
	}
	return stale
}
