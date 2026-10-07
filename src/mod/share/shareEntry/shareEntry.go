package shareEntry

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
)

/*
	Share Entry

	This module is designed to isolate the entry operatiosn with the
	handle operations so as to reduce the complexity of recursive import
	during development

	A path can carry more than one share. Shares are indexed by their UUID
	(the id in the share link) and by the path hash of the shared file. All
	getters return copies, so a caller can never race against an update -
	change a share through UpdateShare instead of writing to it.
*/

const shareTableName = "share"

type ShareEntryTable struct {
	Database *database.Database

	mu     sync.RWMutex
	byUUID map[string]*ShareOption
	byPath map[string][]string //path hash -> share UUIDs, oldest first
}

func NewShareEntryTable(db *database.Database) *ShareEntryTable {
	//Create the share table if not exists
	db.NewTable(shareTableName)

	table := &ShareEntryTable{
		Database: db,
		byUUID:   map[string]*ShareOption{},
		byPath:   map[string][]string{},
	}

	//Load the old share links
	entries, _ := db.ListTable(shareTableName)
	loaded := []*ShareOption{}
	for _, keypairs := range entries {
		shareObject := new(ShareOption)
		if err := json.Unmarshal(keypairs[1], shareObject); err != nil || shareObject.UUID == "" {
			continue
		}
		if shareObject.migrate() {
			db.Write(shareTableName, shareObject.UUID, shareObject)
		}
		loaded = append(loaded, shareObject)
	}

	//Keep the per path order stable: oldest share first
	sort.SliceStable(loaded, func(i, j int) bool {
		return loaded[i].CreatedAt < loaded[j].CreatedAt
	})
	for _, shareObject := range loaded {
		table.index(shareObject)
	}

	return table
}

// index adds a share into the in-memory maps. Caller must hold the write lock
// (or own the table exclusively).
func (s *ShareEntryTable) index(so *ShareOption) {
	s.byUUID[so.UUID] = so
	if !stringInSlice(so.UUID, s.byPath[so.PathHash]) {
		s.byPath[so.PathHash] = append(s.byPath[so.PathHash], so.UUID)
	}
}

// unindex removes a share from the in-memory maps. Caller must hold the write lock.
func (s *ShareEntryTable) unindex(so *ShareOption) {
	delete(s.byUUID, so.UUID)
	remaining := []string{}
	for _, id := range s.byPath[so.PathHash] {
		if id != so.UUID {
			remaining = append(remaining, id)
		}
	}
	if len(remaining) == 0 {
		delete(s.byPath, so.PathHash)
	} else {
		s.byPath[so.PathHash] = remaining
	}
}

// resolveShareTarget translates and validates the shared path, returning the
// real path and the path hash of the share target.
func resolveShareTarget(srcFsh *filesystem.FileSystemHandler, vpath string, username string) (string, string, error) {
	rpath, err := srcFsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, username)
	if err != nil {
		return "", "", errors.New("Unable to translate path given")
	}

	rpath = filepath.ToSlash(filepath.Clean(rpath))
	//Check if source file exists
	if !srcFsh.FileSystemAbstraction.FileExists(rpath) {
		return "", "", errors.New("Unable to find the file on disk")
	}

	sharePathHash, err := GetPathHash(srcFsh, vpath, username)
	if err != nil {
		return "", "", err
	}
	return rpath, sharePathHash, nil
}

// CreateNewShare returns the first share of the given path, creating a default
// "anyone with the link" share if the path is not shared yet.
//
// Kept for callers that think of a file as having one share (the AGI share
// library and the legacy share/new endpoint). Use CreateShare to add another
// share to an already shared path.
func (s *ShareEntryTable) CreateNewShare(srcFsh *filesystem.FileSystemHandler, vpath string, username string, usergroups []string) (*ShareOption, error) {
	_, sharePathHash, err := resolveShareTarget(srcFsh, vpath, username)
	if err != nil {
		return nil, err
	}

	//Check if the share already exists. If yes, use the previous link
	if existing := s.GetShareObjectFromPathHash(sharePathHash); existing != nil {
		return existing, nil
	}

	return s.CreateShare(srcFsh, vpath, username, ShareSettings{})
}

// CreateShare always creates a new share for the given path with the default
// settings overridden by the given ones.
func (s *ShareEntryTable) CreateShare(srcFsh *filesystem.FileSystemHandler, vpath string, username string, settings ShareSettings) (*ShareOption, error) {
	rpath, sharePathHash, err := resolveShareTarget(srcFsh, vpath, username)
	if err != nil {
		return nil, err
	}

	shareOption := DefaultShareOption()
	shareOption.UUID = uuid.NewV4().String()
	shareOption.PathHash = sharePathHash
	shareOption.FileVirtualPath = vpath
	shareOption.FileRealPath = rpath
	shareOption.Owner = username
	shareOption.IsFolder = srcFsh.FileSystemAbstraction.IsDir(rpath)

	if err := shareOption.Apply(settings, time.Now()); err != nil {
		return nil, err
	}

	if err := s.AddShare(shareOption); err != nil {
		return nil, err
	}
	return shareOption.Clone(), nil
}

// AddShare persists and indexes a fully populated share
func (s *ShareEntryTable) AddShare(so *ShareOption) error {
	if so.UUID == "" || so.PathHash == "" {
		return errors.New("share UUID and path hash cannot be empty")
	}
	so = so.Clone()

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.Database.Write(shareTableName, so.UUID, so); err != nil {
		return err
	}
	s.index(so)
	return nil
}

// UpdateShare applies the given settings to a share and persists the result.
// Nothing is changed if any of the settings is invalid.
func (s *ShareEntryTable) UpdateShare(uuid string, settings ShareSettings) (*ShareOption, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.byUUID[uuid]
	if !ok {
		return nil, errors.New("Share with given uuid not exists")
	}

	next := current.Clone()
	if err := next.Apply(settings, time.Now()); err != nil {
		return nil, err
	}

	if err := s.Database.Write(shareTableName, uuid, next); err != nil {
		return nil, err
	}
	s.byUUID[uuid] = next
	return next.Clone(), nil
}

// Delete all the shares on this path hash
func (s *ShareEntryTable) DeleteShareByPathHash(pathhash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, id := range append([]string{}, s.byPath[pathhash]...) {
		so, ok := s.byUUID[id]
		if !ok {
			continue
		}
		//Remove this from the database
		if err := s.Database.Delete(shareTableName, id); err != nil {
			return err
		}
		s.unindex(so)
	}

	//Already deleted from buffered record if nothing is left
	return nil
}

// Delete a share by its UUID. Deleting a share that does not exist is not an error.
func (s *ShareEntryTable) DeleteShareByUUID(uuid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	so, ok := s.byUUID[uuid]
	if !ok {
		//Already deleted from buffered record.
		return nil
	}

	//Remove this from the database
	if err := s.Database.Delete(shareTableName, so.UUID); err != nil {
		return err
	}
	s.unindex(so)
	return nil
}

func (s *ShareEntryTable) GetShareUUIDFromPathHash(pathhash string) string {
	shareObject := s.GetShareObjectFromPathHash(pathhash)
	if shareObject == nil {
		return ""
	} else {
		return shareObject.UUID
	}
}

// GetShareObjectFromPathHash returns the oldest share on the path, or nil
func (s *ShareEntryTable) GetShareObjectFromPathHash(pathhash string) *ShareOption {
	shares := s.GetSharesFromPathHash(pathhash)
	if len(shares) == 0 {
		return nil
	}
	return shares[0]
}

// GetSharesFromPathHash returns all the shares on the path, oldest first
func (s *ShareEntryTable) GetSharesFromPathHash(pathhash string) []*ShareOption {
	s.mu.RLock()
	defer s.mu.RUnlock()

	results := []*ShareOption{}
	for _, id := range s.byPath[pathhash] {
		if so, ok := s.byUUID[id]; ok {
			results = append(results, so.Clone())
		}
	}
	return results
}

func (s *ShareEntryTable) GetShareObjectFromUUID(uuid string) *ShareOption {
	s.mu.RLock()
	defer s.mu.RUnlock()

	so, ok := s.byUUID[uuid]
	if !ok {
		return nil
	}
	return so.Clone()
}

// ListAllShares returns every share in the system, sorted by UUID
func (s *ShareEntryTable) ListAllShares() []*ShareOption {
	s.mu.RLock()
	results := make([]*ShareOption, 0, len(s.byUUID))
	for _, so := range s.byUUID {
		results = append(results, so.Clone())
	}
	s.mu.RUnlock()

	sort.Slice(results, func(i, j int) bool {
		return results[i].UUID < results[j].UUID
	})
	return results
}

// FileIsShared reports whether the path has at least one share that has not expired
func (s *ShareEntryTable) FileIsShared(pathhash string) bool {
	now := time.Now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, id := range s.byPath[pathhash] {
		if so, ok := s.byUUID[id]; ok && !so.IsExpired(now) {
			return true
		}
	}
	return false
}

func (s *ShareEntryTable) RemoveShareByPathHash(pathhash string) error {
	s.mu.RLock()
	_, ok := s.byPath[pathhash]
	s.mu.RUnlock()
	if !ok {
		return errors.New("Share with given pathhash not exists. Given: " + pathhash)
	}
	return s.DeleteShareByPathHash(pathhash)
}

func (s *ShareEntryTable) RemoveShareByUUID(uuid string) error {
	if s.GetShareObjectFromUUID(uuid) == nil {
		return errors.New("Share with given uuid not exists")
	}
	return s.DeleteShareByUUID(uuid)
}

// RemoveExpiredShares deletes every share that has expired at the given time
// and returns the removed shares.
func (s *ShareEntryTable) RemoveExpiredShares(now time.Time) []*ShareOption {
	removed := []*ShareOption{}
	for _, so := range s.ListAllShares() {
		if so.IsExpired(now) {
			if err := s.DeleteShareByUUID(so.UUID); err == nil {
				removed = append(removed, so)
			}
		}
	}
	return removed
}

func (s *ShareEntryTable) ResolveShareOptionFromShareSubpath(subpath string) (*ShareOption, error) {
	subpathElements := strings.Split(filepath.ToSlash(filepath.Clean(subpath))[1:], "/")
	if len(subpathElements) >= 1 {
		shareObject := s.GetShareObjectFromUUID(subpathElements[0])
		if shareObject == nil {
			return nil, errors.New("Invalid subpath")
		} else {
			return shareObject, nil
		}
	} else {
		return nil, errors.New("Invalid subpath")
	}
}

func GetPathHash(fsh *filesystem.FileSystemHandler, vpath string, username string) (string, error) {
	return fsh.GetUniquePathHash(vpath, username)
}
