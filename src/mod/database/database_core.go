package database

import (
	"bytes"
	"encoding/json"
	"errors"

	"go.etcd.io/bbolt"
	"imuslab.com/arozos/mod/info/logger"
)

func newDatabase(dbfile string, readOnlyMode bool) (out0 *Database, out1 error) {
	defer logger.Out2(logger.In2("database", "newDatabase", "dbfile", dbfile, "readOnlyMode", readOnlyMode), &out0, &out1)
	db, err := bbolt.Open(dbfile, 0600, nil)
	if err != nil {
		logger.DebugErr("database", err)
		return nil, err
	}

	if !readOnlyMode {
		if err := migrateLegacyFsdb(db, dbfile); err != nil {
			logger.DebugErr("database", err)
			logger.PrintAndLog("Database", "Importing legacy file system database failed", err)
		}
	}

	d := &Database{
		Db:       db,
		ReadOnly: readOnlyMode,
	}
	//Build the table list from database
	err = db.View(func(tx *bbolt.Tx) error {
		return tx.ForEach(func(name []byte, _ *bbolt.Bucket) error {
			d.Tables.Store(string(name), "")
			return nil
		})
	})
	return d, err
}

// Dump the whole db into a log file
func (d *Database) dump(filename string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In2("database", "Database.dump", "d", d, "filename", filename), &out0, &out1)
	results := []string{}

	d.Tables.Range(func(tableName, v interface{}) bool {
		entries, err := d.ListTable(tableName.(string))
		if err != nil {
			logger.DebugErr("database", err)
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
func (d *Database) newTable(tableName string) (out0 error) {
	defer logger.Out1(logger.In2("database", "Database.newTable", "d", d, "tableName", tableName), &out0)
	if d.ReadOnly == true {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	err := d.Db.(*bbolt.DB).Update(func(tx *bbolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(tableName))
		if err != nil {
			logger.DebugErr("database", err)
			return err
		}
		return nil
	})

	d.Tables.Store(tableName, "")
	return err
}

// Check is table exists
func (d *Database) tableExists(tableName string) (out0 bool) {
	defer logger.Out1(logger.In2("database", "Database.tableExists", "d", d, "tableName", tableName), &out0)
	if _, ok := d.Tables.Load(tableName); ok {
		return true
	}
	return false
}

// Drop the given table
func (d *Database) dropTable(tableName string) (out0 error) {
	defer logger.Out1(logger.In2("database", "Database.dropTable", "d", d, "tableName", tableName), &out0)
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	err := d.Db.(*bbolt.DB).Update(func(tx *bbolt.Tx) error {
		err := tx.DeleteBucket([]byte(tableName))
		if err != nil {
			logger.DebugErr("database", err)
			return err
		}
		return nil
	})

	//Delete cache from table sync map
	d.Tables.Delete(tableName)
	return err
}

// Write to table
func (d *Database) write(tableName string, key string, value interface{}) (out0 error) {
	defer logger.Out1(logger.In4("database", "Database.write", "d", d, "tableName", tableName, "!key", key, "!&value", &value), &out0)
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	jsonString, err := json.Marshal(value)
	if err != nil {
		logger.DebugErr("database", err)
		return err
	}
	err = d.Db.(*bbolt.DB).Update(func(tx *bbolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(tableName))
		if err != nil {
			logger.DebugErr("database", err)
			return err
		}
		b := tx.Bucket([]byte(tableName))
		err = b.Put([]byte(key), jsonString)
		return err
	})
	return err
}

func (d *Database) read(tableName string, key string, assignee interface{}) (out0 error) {
	defer logger.Out1(logger.In4("database", "Database.read", "d", d, "tableName", tableName, "assignee", assignee, "!key", key), &out0)
	err := d.Db.(*bbolt.DB).View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(tableName))
		v := b.Get([]byte(key))
		json.Unmarshal(v, &assignee)
		return nil
	})
	return err
}

func (d *Database) keyExists(tableName string, key string) (out0 bool) {
	defer logger.Out1(logger.In3("database", "Database.keyExists", "d", d, "tableName", tableName, "!key", key), &out0)
	resultIsNil := false
	if !d.TableExists(tableName) {
		//Table not exists. Do not proceed accessing key
		logger.PrintAndLog("Database", "[DB] ERROR: Requesting key from table that didn't exist!!!", nil)
		return false
	}
	err := d.Db.(*bbolt.DB).View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(tableName))
		v := b.Get([]byte(key))
		if v == nil {
			resultIsNil = true
		}
		return nil
	})

	if err != nil {
		logger.DebugErr("database", err)
		return false
	} else {
		if resultIsNil {
			return false
		} else {
			return true
		}
	}
}

func (d *Database) writeBatch(ops []BatchOp) (out0 error) {
	defer logger.Out1(logger.In2("database", "Database.writeBatch", "d", d, "ops", ops), &out0)
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
			logger.DebugErr("database", err)
			return err
		}
		values[i] = js
	}
	return d.Db.(*bbolt.DB).Update(func(tx *bbolt.Tx) error {
		for i, op := range ops {
			b, err := tx.CreateBucketIfNotExists([]byte(op.Table))
			if err != nil {
				logger.DebugErr("database", err)
				return err
			}
			if op.Delete {
				if err := b.Delete([]byte(op.Key)); err != nil {
					logger.DebugErr("database", err)
					return err
				}
				continue
			}
			if err := b.Put([]byte(op.Key), values[i]); err != nil {
				logger.DebugErr("database", err)
				return err
			}
		}
		return nil
	})
}

func (d *Database) delete(tableName string, key string) (out0 error) {
	defer logger.Out1(logger.In3("database", "Database.delete", "d", d, "tableName", tableName, "!key", key), &out0)
	if d.ReadOnly {
		return errors.New("Operation rejected in ReadOnly mode")
	}

	err := d.Db.(*bbolt.DB).Update(func(tx *bbolt.Tx) error {
		tx.Bucket([]byte(tableName)).Delete([]byte(key))
		return nil
	})

	return err
}

func (d *Database) listTable(tableName string) (out0 [][][]byte, out1 error) {
	defer logger.Out2(logger.In2("database", "Database.listTable", "d", d, "tableName", tableName), &out0, &out1)
	var results [][][]byte
	err := d.Db.(*bbolt.DB).View(func(tx *bbolt.Tx) error {
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
	logger.DebugTrace("database", "Database.close")
	d.Db.(*bbolt.DB).Close()
}

// listTableWithPrefix seeks the cursor to prefix and reads while keys match.
func (d *Database) listTableWithPrefix(tableName string, prefix string) (out0 [][][]byte, out1 error) {
	defer logger.Out2(logger.In3("database", "Database.listTableWithPrefix", "d", d, "tableName", tableName, "prefix", prefix), &out0, &out1)
	var results [][][]byte = [][][]byte{}
	err := d.Db.(*bbolt.DB).View(func(tx *bbolt.Tx) error {
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
