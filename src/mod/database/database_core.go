//go:build !mipsle && !riscv64 && !loong64
// +build !mipsle,!riscv64,!loong64

package database

import (
	"bytes"
	"encoding/json"
	"errors"
	"sync"

	"github.com/boltdb/bolt"
	"imuslab.com/arozos/mod/info/logger"
)

func newDatabase(dbfile string, readOnlyMode bool) (*Database, error) {
	db, err := bolt.Open(dbfile, 0600, nil)
	if err != nil {
		return nil, err
	}

	tableMap := sync.Map{}
	//Build the table list from database
	err = db.View(func(tx *bolt.Tx) error {
		return tx.ForEach(func(name []byte, _ *bolt.Bucket) error {
			tableMap.Store(string(name), "")
			return nil
		})
	})

	return &Database{
		Db:       db,
		Tables:   tableMap,
		ReadOnly: readOnlyMode,
	}, err
}

// Dump the whole db into a log file
func (d *Database) dump(filename string) ([]string, error) {
	results := []string{}

	d.Tables.Range(func(tableName, v interface{}) bool {
		entries, err := d.ListTable(tableName.(string))
		if err != nil {
			logger.PrintAndLog("Database", "Reading table "+tableName.(string)+" failed: "+err.Error(), nil)
			return false
		}
		for _, keypairs := range entries {
			results = append(results, string(keypairs[0])+":"+string(keypairs[1])+"\n")
		}
		return true
	})

	return results, nil
}

// Create a new table
func (d *Database) newTable(tableName string) error {
	if d.ReadOnly == true {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	err := d.Db.(*bolt.DB).Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(tableName))
		if err != nil {
			return err
		}
		return nil
	})

	d.Tables.Store(tableName, "")
	return err
}

// Check is table exists
func (d *Database) tableExists(tableName string) bool {
	if _, ok := d.Tables.Load(tableName); ok {
		return true
	}
	return false
}

// Drop the given table
func (d *Database) dropTable(tableName string) error {
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	err := d.Db.(*bolt.DB).Update(func(tx *bolt.Tx) error {
		err := tx.DeleteBucket([]byte(tableName))
		if err != nil {
			return err
		}
		return nil
	})

	//Delete cache from table sync map
	d.Tables.Delete(tableName)
	return err
}

// Write to table
func (d *Database) write(tableName string, key string, value interface{}) error {
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	jsonString, err := json.Marshal(value)
	if err != nil {
		return err
	}
	err = d.Db.(*bolt.DB).Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(tableName))
		if err != nil {
			return err
		}
		b := tx.Bucket([]byte(tableName))
		err = b.Put([]byte(key), jsonString)
		return err
	})
	return err
}

func (d *Database) read(tableName string, key string, assignee interface{}) error {
	err := d.Db.(*bolt.DB).View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(tableName))
		v := b.Get([]byte(key))
		json.Unmarshal(v, &assignee)
		return nil
	})
	return err
}

func (d *Database) keyExists(tableName string, key string) bool {
	resultIsNil := false
	if !d.TableExists(tableName) {
		//Table not exists. Do not proceed accessing key
		logger.PrintAndLog("Database", "[DB] ERROR: Requesting key from table that didn't exist!!!", nil)
		return false
	}
	err := d.Db.(*bolt.DB).View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(tableName))
		v := b.Get([]byte(key))
		if v == nil {
			resultIsNil = true
		}
		return nil
	})

	if err != nil {
		return false
	} else {
		if resultIsNil {
			return false
		} else {
			return true
		}
	}
}

func (d *Database) writeBatch(ops []BatchOp) error {
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}
	//Marshal first so a bad value fails the batch before anything is written
	values := make([][]byte, len(ops))
	for i, op := range ops {
		if op.Delete {
			continue
		}
		js, err := json.Marshal(op.Value)
		if err != nil {
			return err
		}
		values[i] = js
	}
	return d.Db.(*bolt.DB).Update(func(tx *bolt.Tx) error {
		for i, op := range ops {
			b, err := tx.CreateBucketIfNotExists([]byte(op.Table))
			if err != nil {
				return err
			}
			if op.Delete {
				if err := b.Delete([]byte(op.Key)); err != nil {
					return err
				}
				continue
			}
			if err := b.Put([]byte(op.Key), values[i]); err != nil {
				return err
			}
		}
		return nil
	})
}

func (d *Database) delete(tableName string, key string) error {
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	err := d.Db.(*bolt.DB).Update(func(tx *bolt.Tx) error {
		tx.Bucket([]byte(tableName)).Delete([]byte(key))
		return nil
	})

	return err
}

func (d *Database) listTable(tableName string) ([][][]byte, error) {
	var results [][][]byte
	err := d.Db.(*bolt.DB).View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(tableName))
		c := b.Cursor()

		for k, v := c.First(); k != nil; k, v = c.Next() {
			results = append(results, [][]byte{k, v})
		}
		return nil
	})
	return results, err
}

func (d *Database) close() {
	d.Db.(*bolt.DB).Close()
}

// listTableWithPrefix seeks the cursor to prefix and reads while keys match.
func (d *Database) listTableWithPrefix(tableName string, prefix string) ([][][]byte, error) {
	var results [][][]byte = [][][]byte{}
	err := d.Db.(*bolt.DB).View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(tableName))
		if b == nil {
			return errors.New("table not exists")
		}
		c := b.Cursor()
		p := []byte(prefix)
		for k, v := c.Seek(p); k != nil && bytes.HasPrefix(k, p); k, v = c.Next() {
			key := append([]byte{}, k...)
			val := append([]byte{}, v...)
			results = append(results, [][]byte{key, val})
		}
		return nil
	})
	return results, err
}
