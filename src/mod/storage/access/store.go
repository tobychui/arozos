package access

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"imuslab.com/arozos/mod/info/logger"
)

const storeVersion = 1

// storeFile is the layout of the rule file on disk
type storeFile struct {
	Version int             `json:"version"`
	Drives  map[string]Rule `json:"drives"`
}

/*
Store keeps the rules of the drives of this host in one JSON file. Only drives
whose rule was changed appear in it; every other drive has its DefaultRule.

A rule file that cannot be read must not quietly reopen drives an admin closed,
so such a store answers None for every drive and refuses writes, which would
overwrite the rules still in the file, until the file is repaired or removed.
Admins keep their access through the rules in Explain.
*/
type Store struct {
	filename string
	mu       sync.RWMutex
	drives   map[string]Rule
	loadErr  error
}

// NewStore opens the rule file. A file that does not exist yet is an empty
// store; check Err for one that could not be read.
func NewStore(filename string) (out0 *Store) {
	defer logger.Out1(logger.In1("storage/access", "NewStore", "filename", filename), &out0)
	s := &Store{filename: filename, drives: map[string]Rule{}}
	content, err := os.ReadFile(filename)
	if errors.Is(err, os.ErrNotExist) {
		return s
	}
	if err != nil {
		logger.DebugErr("storage/access", err)
		s.loadErr = err
		return s
	}

	loaded := storeFile{}
	if err := json.Unmarshal(content, &loaded); err != nil {
		logger.DebugErr("storage/access", err)
		s.loadErr = err
		return s
	}
	if loaded.Version > storeVersion {
		s.loadErr = fmt.Errorf("rule file version %d is newer than this build", loaded.Version)
		return s
	}
	for uuid, rule := range loaded.Drives {
		if err := rule.Validate(); err != nil {
			logger.DebugErr("storage/access", err)
			s.loadErr = fmt.Errorf("rule of drive %s: %w", uuid, err)
			return s
		}
		s.drives[uuid] = rule
	}
	return s
}

// Err returns why the rule file could not be read, or nil
func (s *Store) Err() (out0 error) {
	defer logger.Out1(logger.In1("storage/access", "Store.Err", "s", s), &out0)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadErr
}

// Rule implements Source
func (s *Store) Rule(uuid string) (out0 Rule, out1 bool) {
	defer logger.Out2(logger.In2("storage/access", "Store.Rule", "s", s, "uuid", uuid), &out0, &out1)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.loadErr != nil {
		return Rule{Other: None}, true
	}
	rule, ok := s.drives[uuid]
	if !ok {
		return Rule{}, false
	}
	return rule.Clone(), true
}

// Set saves the rule of a drive
func (s *Store) Set(uuid string, rule Rule) (out0 error) {
	defer logger.Out1(logger.In3("storage/access", "Store.Set", "s", s, "uuid", uuid, "&rule", &rule), &out0)
	if uuid == "" {
		return errors.New("drive id is empty")
	}
	if IsFixed(uuid) {
		return errors.New(uuid + ":/ is open to everyone and has no access list")
	}
	if err := rule.Validate(); err != nil {
		logger.DebugErr("storage/access", err)
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.update(func(drives map[string]Rule) {
		drives[uuid] = rule.Clone()
	})
}

// Remove forgets the rule of a drive, which goes back to its default
func (s *Store) Remove(uuid string) (out0 error) {
	defer logger.Out1(logger.In2("storage/access", "Store.Remove", "s", s, "uuid", uuid), &out0)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.drives[uuid]; !ok {
		return nil
	}
	return s.update(func(drives map[string]Rule) {
		delete(drives, uuid)
	})
}

// RemoveGroup drops the rows of a deleted group, so that a new group of the
// same name does not inherit them
func (s *Store) RemoveGroup(group string) (out0 error) {
	defer logger.Out1(logger.In2("storage/access", "Store.RemoveGroup", "s", s, "group", group), &out0)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.update(func(drives map[string]Rule) {
		for uuid, rule := range drives {
			if _, ok := rule.Groups[group]; !ok {
				continue
			}
			rule = rule.Clone()
			delete(rule.Groups, group)
			drives[uuid] = rule
		}
	})
}

// update applies a change to a copy of the rules and only keeps it once it
// is on disk. The caller holds the lock.
func (s *Store) update(change func(drives map[string]Rule)) (out0 error) {
	defer logger.Out1(logger.In2("storage/access", "Store.update", "s", s, "change", change), &out0)
	if s.loadErr != nil {
		return fmt.Errorf("the rule file could not be read, repair or remove %s first: %w", s.filename, s.loadErr)
	}

	next := make(map[string]Rule, len(s.drives)+1)
	for uuid, rule := range s.drives {
		next[uuid] = rule
	}
	change(next)

	if err := s.write(next); err != nil {
		logger.DebugErr("storage/access", err)
		return err
	}
	s.drives = next
	return nil
}

// write replaces the rule file in one step, so a crash leaves the old or the
// new file and never half of one
func (s *Store) write(drives map[string]Rule) (out0 error) {
	defer logger.Out1(logger.In2("storage/access", "Store.write", "s", s, "drives", drives), &out0)
	content, err := json.MarshalIndent(storeFile{Version: storeVersion, Drives: drives}, "", "  ")
	if err != nil {
		logger.DebugErr("storage/access", err)
		return err
	}

	dir := filepath.Dir(s.filename)
	if err := os.MkdirAll(dir, 0775); err != nil {
		logger.DebugErr("storage/access", err)
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(s.filename)+".*.tmp")
	if err != nil {
		logger.DebugErr("storage/access", err)
		return err
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(content); err != nil {
		logger.DebugErr("storage/access", err)
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		logger.DebugErr("storage/access", err)
		return err
	}
	return os.Rename(tmp.Name(), s.filename)
}

// bridgeRecord is one entry of the bridge file earlier builds kept
type bridgeRecord struct {
	FSHUUID string
	SPOwner string
}

/*
MigrateBridges turns the records of the old bridge file into rows and renames
the file, which keeps a backup and stops this from running twice. A drive that
was bridged into a pool gets a row with the access that pool's members had. The
system pool has no members, bridging into it gave the drive to every user, so
there the default access level is raised instead.

homeOf returns the home group of a drive and whether the drive is known at all;
a bridged drive that cannot be found is treated as a group pool drive, so it is
not opened to anybody the record does not name.

It returns how many records were converted. A file that does not exist is not
an error.
*/
func (s *Store) MigrateBridges(bridgeFile string, homeOf func(uuid string) (home string, known bool)) (out0 int, out1 error) {
	defer logger.Out2(logger.In3("storage/access", "Store.MigrateBridges", "s", s, "bridgeFile", bridgeFile, "homeOf", homeOf), &out0, &out1)
	content, err := os.ReadFile(bridgeFile)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		logger.DebugErr("storage/access", err)
		return 0, err
	}

	records := []bridgeRecord{}
	if err := json.Unmarshal(content, &records); err != nil {
		logger.DebugErr("storage/access", err)
		return 0, err
	}

	s.mu.Lock()
	err = s.update(func(drives map[string]Rule) {
		for _, record := range records {
			if record.FSHUUID == "" || record.SPOwner == "" || IsBuiltin(record.FSHUUID) {
				continue
			}

			rule, ok := drives[record.FSHUUID]
			if ok {
				rule = rule.Clone()
			} else {
				home, known := homeOf(record.FSHUUID)
				if !known {
					home = record.SPOwner
				}
				rule = DefaultRule(record.FSHUUID, home)
			}

			if record.SPOwner == "system" {
				rule.Other = ReadWrite
			} else {
				if rule.Groups == nil {
					rule.Groups = map[string]string{}
				}
				rule.Groups[record.SPOwner] = ReadWrite
			}
			drives[record.FSHUUID] = rule
		}
	})
	s.mu.Unlock()
	if err != nil {
		logger.DebugErr("storage/access", err)
		return 0, err
	}

	return len(records), os.Rename(bridgeFile, bridgeFile+".migrated")
}
