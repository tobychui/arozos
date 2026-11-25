package database

/*
	ArOZ Online Database Access Module
	author: tobychui

	This is an improved Object oriented base solution to the original
	aroz online database script.
*/

import (
	"sync"

	"imuslab.com/arozos/mod/info/logger"
)

type Database struct {
	Db       interface{} //The *bbolt.DB handle
	Tables   sync.Map
	ReadOnly bool
}

func NewDatabase(dbfile string, readOnlyMode bool) (*Database, error) {
	logger.DebugTrace("database", "NewDatabase")
	return newDatabase(dbfile, readOnlyMode)
}

/*
	Create / Drop a table
	Usage:
	err := sysdb.NewTable("MyTable")
	err := sysdb.DropTable("MyTable")
*/

func (d *Database) UpdateReadWriteMode(readOnly bool) {
	logger.DebugTrace("database", "Database.UpdateReadWriteMode")
	d.ReadOnly = readOnly
}

// Dump the whole db into a log file
func (d *Database) Dump(filename string) ([]string, error) {
	logger.DebugTrace("database", "Database.Dump")
	return d.dump(filename)
}

// Create a new table
func (d *Database) NewTable(tableName string) error {
	logger.DebugTrace("database", "Database.NewTable")
	return d.newTable(tableName)
}

// Check is table exists
func (d *Database) TableExists(tableName string) bool {
	logger.DebugTrace("database", "Database.TableExists")
	return d.tableExists(tableName)
}

// Drop the given table
func (d *Database) DropTable(tableName string) error {
	logger.DebugTrace("database", "Database.DropTable")
	return d.dropTable(tableName)
}

/*
Write to database with given tablename and key. Example Usage:

	type demo struct{
		content string
	}

	thisDemo := demo{
		content: "Hello World",
	}

err := sysdb.Write("MyTable", "username/message",thisDemo);
*/
func (d *Database) Write(tableName string, key string, value interface{}) error {
	logger.DebugTrace("database", "Database.Write")
	return d.write(tableName, key, value)
}

/*
	Read from database and assign the content to a given datatype. Example Usage:

	type demo struct{
		content string
	}
	thisDemo := new(demo)
	err := sysdb.Read("MyTable", "username/message",&thisDemo);
*/

func (d *Database) Read(tableName string, key string, assignee interface{}) error {
	logger.DebugTrace("database", "Database.Read")
	return d.read(tableName, key, assignee)
}

func (d *Database) KeyExists(tableName string, key string) bool {
	logger.DebugTrace("database", "Database.KeyExists")
	return d.keyExists(tableName, key)
}

/*
Delete a value from the database table given tablename and key

err := sysdb.Delete("MyTable", "username/message");
*/
func (d *Database) Delete(tableName string, key string) error {
	logger.DebugTrace("database", "Database.Delete")
	return d.delete(tableName, key)
}

// BatchOp is one change inside a WriteBatch: a Put of Value under Key, or a
// removal of Key when Delete is true. Value is marshalled to JSON like Write
// does; a json.RawMessage is stored as it is.
type BatchOp struct {
	Table  string
	Key    string
	Value  interface{}
	Delete bool
}

/*
WriteBatch applies many changes at once. On the bolt backend they share one
transaction, so they cost a single disk sync instead of one each, and either
all of them land or none do. Tables are created when missing. Operations run
in the order given.

	err := sysdb.WriteBatch([]database.BatchOp{
		{Table: "MyTable", Key: "a", Value: 1},
		{Table: "MyTable", Key: "b", Delete: true},
	})
*/
func (d *Database) WriteBatch(ops []BatchOp) (out0 error) {
	defer logger.Out1(logger.In2("database", "Database.WriteBatch", "d", d, "ops", ops), &out0)
	if len(ops) == 0 {
		return nil
	}
	return d.writeBatch(ops)
}

/*
	//List table example usage
	//Assume the value is stored as a struct named "groupstruct"

	entries, err := sysdb.ListTable("test")
	if err != nil {
		panic(err)
	}
	for _, keypairs := range entries{
		fmt.Println(string(keypairs[0]))
		group := new(groupstruct)
		json.Unmarshal(keypairs[1], &group)
		fmt.Println(group)
	}

*/

func (d *Database) ListTable(tableName string) ([][][]byte, error) {
	logger.DebugTrace("database", "Database.ListTable")
	return d.listTable(tableName)
}

// ListTableWithPrefix returns only the key/value pairs whose key starts with
// prefix. Backends use a cursor seek so large tables are not scanned fully.
func (d *Database) ListTableWithPrefix(tableName string, prefix string) ([][][]byte, error) {
	logger.DebugTrace("database", "Database.ListTableWithPrefix")
	return d.listTableWithPrefix(tableName, prefix)
}

func (d *Database) Close() {
	logger.DebugTrace("database", "Database.Close")
	d.close()
}
