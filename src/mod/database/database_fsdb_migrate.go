package database

/*
	Legacy file system database import

	Before the switch to bbolt, builds for linux/mipsle, riscv64 and loong64
	could not use boltdb and kept every table as a folder under
	fsdb/<dbfile>/ with one <key>.entry file (the JSON value) per key.
	bbolt runs on every platform, so on first start those entries are copied
	into the bolt file and the folder is renamed to <dbfile>.migrated.
*/

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"go.etcd.io/bbolt"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	legacyFsdbRoot      = "fsdb"
	legacyFsdbSlashSign = "-SLASH_SIGN-"
	legacyFsdbEntryExt  = ".entry"
)

// legacyFsdbPath is where the old file system backend kept dbfile.
func legacyFsdbPath(dbfile string) string {
	return filepath.Join(legacyFsdbRoot, filepath.Clean(dbfile))
}

// importLegacyFsdb copies the tables of a legacy file system database into
// db, skipping keys the bolt file already holds, and returns how many keys
// were imported. It does not touch the legacy folder.
func importLegacyFsdb(db *bbolt.DB, legacyDir string) (int, error) {
	tables, err := os.ReadDir(legacyDir)
	if err != nil {
		return 0, err
	}
	imported := 0
	err = db.Update(func(tx *bbolt.Tx) error {
		for _, table := range tables {
			if !table.IsDir() {
				continue
			}
			b, err := tx.CreateBucketIfNotExists([]byte(table.Name()))
			if err != nil {
				return err
			}
			entries, err := os.ReadDir(filepath.Join(legacyDir, table.Name()))
			if err != nil {
				return err
			}
			for _, entry := range entries {
				if entry.IsDir() || filepath.Ext(entry.Name()) != legacyFsdbEntryExt {
					continue
				}
				key := strings.TrimSuffix(entry.Name(), legacyFsdbEntryExt)
				key = strings.ReplaceAll(key, legacyFsdbSlashSign, "/")
				if key == "" || b.Get([]byte(key)) != nil {
					continue
				}
				value, err := os.ReadFile(filepath.Join(legacyDir, table.Name(), entry.Name()))
				if err != nil {
					return err
				}
				if err := b.Put([]byte(key), value); err != nil {
					return err
				}
				imported++
			}
		}
		return nil
	})
	return imported, err
}

// migrateLegacyFsdb imports fsdb/<dbfile> when it exists and renames the
// folder so the import runs only once. A failed import leaves the folder in
// place to be retried on the next start.
func migrateLegacyFsdb(db *bbolt.DB, dbfile string) error {
	legacyDir := legacyFsdbPath(dbfile)
	info, err := os.Stat(legacyDir)
	if err != nil || !info.IsDir() {
		return nil
	}
	imported, err := importLegacyFsdb(db, legacyDir)
	if err != nil {
		return err
	}
	logger.PrintAndLog("Database", "Imported "+strconv.Itoa(imported)+" keys from legacy file system database "+legacyDir, nil)
	return os.Rename(legacyDir, legacyDir+".migrated")
}
