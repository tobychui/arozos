package git

/*
	git_test.go

	Shared test helpers: an in-memory CredentialDatabase and small utilities for
	building throwaway repositories under t.TempDir().
*/

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// fakeDatabase is an in-memory stand-in for the ArozOS system database. It
// stores marshalled JSON exactly like the real bolt-backed implementation, so
// the ListTable code path is exercised for real.
type fakeDatabase struct {
	mutex  sync.Mutex
	tables map[string]map[string][]byte
}

func newFakeDatabase() *fakeDatabase {
	return &fakeDatabase{tables: map[string]map[string][]byte{}}
}

func (f *fakeDatabase) NewTable(tableName string) error {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	if _, ok := f.tables[tableName]; !ok {
		f.tables[tableName] = map[string][]byte{}
	}
	return nil
}

func (f *fakeDatabase) Write(tableName string, key string, value interface{}) error {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	table, ok := f.tables[tableName]
	if !ok {
		return errors.New("table not exists")
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	table[key] = encoded
	return nil
}

func (f *fakeDatabase) Read(tableName string, key string, assignee interface{}) error {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	table, ok := f.tables[tableName]
	if !ok {
		return errors.New("table not exists")
	}
	encoded, ok := table[key]
	if !ok {
		return errors.New("key not exists")
	}
	return json.Unmarshal(encoded, assignee)
}

func (f *fakeDatabase) KeyExists(tableName string, key string) bool {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	table, ok := f.tables[tableName]
	if !ok {
		return false
	}
	_, ok = table[key]
	return ok
}

func (f *fakeDatabase) Delete(tableName string, key string) error {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	table, ok := f.tables[tableName]
	if !ok {
		return errors.New("table not exists")
	}
	delete(table, key)
	return nil
}

func (f *fakeDatabase) ListTable(tableName string) ([][][]byte, error) {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	table, ok := f.tables[tableName]
	if !ok {
		return nil, errors.New("table not exists")
	}
	results := [][][]byte{}
	for key, value := range table {
		results = append(results, [][]byte{[]byte(key), value})
	}
	return results, nil
}

// newTestManager builds a Manager backed by a fake database and a temporary
// key store.
func newTestManager(t *testing.T) *Manager {
	t.Helper()

	manager, err := NewManager(Options{
		Database:     newFakeDatabase(),
		KeyStorePath: filepath.Join(t.TempDir(), "keystore"),
	})
	if err != nil {
		t.Fatalf("NewManager() returned error: %v", err)
	}
	return manager
}

// newTestRepo initialises an empty repository in a fresh temp folder and
// returns its path.
func newTestRepo(t *testing.T, manager *Manager) string {
	t.Helper()

	repoPath := filepath.Join(t.TempDir(), "repo")
	if err := manager.Init(repoPath); err != nil {
		t.Fatalf("Init() returned error: %v", err)
	}
	return repoPath
}

// writeFile creates or overwrites a file inside a repository.
func writeFile(t *testing.T, repoPath string, name string, content string) {
	t.Helper()

	fullPath := filepath.Join(repoPath, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0775); err != nil {
		t.Fatalf("cannot create folder for %s: %v", name, err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0664); err != nil {
		t.Fatalf("cannot write %s: %v", name, err)
	}
}

// commitFile writes a file and commits it, returning the commit hash.
func commitFile(t *testing.T, manager *Manager, repoPath string, name string, content string, message string) string {
	t.Helper()

	writeFile(t, repoPath, name, content)
	hash, err := manager.Commit(repoPath, &CommitRequest{
		Message: message,
		Files:   []string{name},
		Name:    "Test User",
		Email:   "test@arozos.local",
	})
	if err != nil {
		t.Fatalf("Commit(%s) returned error: %v", name, err)
	}
	return hash
}
