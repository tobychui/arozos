//go:build !(linux && mipsle) && !(windows && arm) && !(windows && 386)

package agi

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "github.com/glebarez/go-sqlite"
	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	AGI SQLite Library

	Provides SQLite database access for AGI scripts via requirelib("sqlite").

	JavaScript API:
	  var db = sqlite.open("user:/.appdata/myapp/data.sqlite");
	  db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)");
	  db.exec("INSERT INTO t (name) VALUES (?)", ["Alice"]);
	  var rows    = db.query("SELECT * FROM t WHERE id > ?", [0]);
	  var row     = db.queryRow("SELECT * FROM t WHERE id = ?", [1]);
	  var tables  = db.tables();
	  var schema  = db.schema("t");
	  db.close();

	Each call to sqlite.open() returns an object bound to a single connection.
	Connections are cleaned up when the script ends or db.close() is called.
*/

func (g *Gateway) SQLiteLibRegister() {
	err := g.RegisterLib("sqlite", g.injectSQLiteLibFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectSQLiteLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	var mu sync.Mutex
	var nextHandle int64
	openDBs := make(map[int64]*sql.DB)

	getDB := func(h int64) *sql.DB {
		mu.Lock()
		defer mu.Unlock()
		return openDBs[h]
	}

	// _sqlite_open(vpath) => handle integer, or throws on error
	vm.Set("_sqlite_open", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}

		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}

		_, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			panic(vm.MakeCustomError("IOError", err.Error()))
		}

		if err := os.MkdirAll(filepath.Dir(rpath), 0755); err != nil {
			panic(vm.MakeCustomError("IOError", err.Error()))
		}

		db, err := sql.Open("sqlite", rpath)
		if err != nil {
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}
		if err := db.Ping(); err != nil {
			db.Close()
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}

		mu.Lock()
		nextHandle++
		handle := nextHandle
		openDBs[handle] = db
		mu.Unlock()

		val, _ := vm.ToValue(handle)
		return val
	})

	// _sqlite_exec(handle, sql, paramsJSON) => JSON {lastInsertId, rowsAffected}
	vm.Set("_sqlite_exec", func(call otto.FunctionCall) otto.Value {
		handle, err := call.Argument(0).ToInteger()
		if err != nil || handle < 1 {
			panic(vm.MakeCustomError("InvalidHandle", "Invalid database handle"))
		}
		sqlStmt, _ := call.Argument(1).ToString()
		paramsJSON, _ := call.Argument(2).ToString()
		params := sqliteParseParams(paramsJSON)

		db := getDB(int64(handle))
		if db == nil {
			panic(vm.MakeCustomError("InvalidHandle", "Database handle not found or already closed"))
		}

		result, err := db.Exec(sqlStmt, params...)
		if err != nil {
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}
		lastID, _ := result.LastInsertId()
		affected, _ := result.RowsAffected()

		out, _ := json.Marshal(map[string]interface{}{
			"lastInsertId": lastID,
			"rowsAffected": affected,
		})
		val, _ := vm.ToValue(string(out))
		return val
	})

	// _sqlite_query(handle, sql, paramsJSON) => JSON array of row objects
	vm.Set("_sqlite_query", func(call otto.FunctionCall) otto.Value {
		handle, err := call.Argument(0).ToInteger()
		if err != nil || handle < 1 {
			panic(vm.MakeCustomError("InvalidHandle", "Invalid database handle"))
		}
		sqlStmt, _ := call.Argument(1).ToString()
		paramsJSON, _ := call.Argument(2).ToString()
		params := sqliteParseParams(paramsJSON)

		db := getDB(int64(handle))
		if db == nil {
			panic(vm.MakeCustomError("InvalidHandle", "Database handle not found or already closed"))
		}

		rows, err := db.Query(sqlStmt, params...)
		if err != nil {
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}
		defer rows.Close()

		cols, err := rows.Columns()
		if err != nil {
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}

		var results []map[string]interface{}
		for rows.Next() {
			vals := make([]interface{}, len(cols))
			ptrs := make([]interface{}, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				panic(vm.MakeCustomError("SQLiteError", err.Error()))
			}
			row := make(map[string]interface{}, len(cols))
			for i, col := range cols {
				row[col] = sqliteConvertValue(vals[i])
			}
			results = append(results, row)
		}
		if results == nil {
			results = []map[string]interface{}{}
		}

		out, err := json.Marshal(results)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		val, _ := vm.ToValue(string(out))
		return val
	})

	// _sqlite_tables(handle) => JSON array of table name strings
	vm.Set("_sqlite_tables", func(call otto.FunctionCall) otto.Value {
		handle, err := call.Argument(0).ToInteger()
		if err != nil || handle < 1 {
			panic(vm.MakeCustomError("InvalidHandle", "Invalid database handle"))
		}
		db := getDB(int64(handle))
		if db == nil {
			panic(vm.MakeCustomError("InvalidHandle", "Database handle not found or already closed"))
		}

		rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		if err != nil {
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}
		defer rows.Close()

		var tables []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err == nil {
				tables = append(tables, name)
			}
		}
		if tables == nil {
			tables = []string{}
		}
		out, _ := json.Marshal(tables)
		val, _ := vm.ToValue(string(out))
		return val
	})

	// _sqlite_schema(handle, tableName) => JSON array of column info objects
	vm.Set("_sqlite_schema", func(call otto.FunctionCall) otto.Value {
		handle, err := call.Argument(0).ToInteger()
		if err != nil || handle < 1 {
			panic(vm.MakeCustomError("InvalidHandle", "Invalid database handle"))
		}
		tableName, _ := call.Argument(1).ToString()
		db := getDB(int64(handle))
		if db == nil {
			panic(vm.MakeCustomError("InvalidHandle", "Database handle not found or already closed"))
		}

		rows, err := db.Query("PRAGMA table_info(" + sqliteQuoteIdent(tableName) + ")")
		if err != nil {
			panic(vm.MakeCustomError("SQLiteError", err.Error()))
		}
		defer rows.Close()

		type colInfo struct {
			CID       int     `json:"cid"`
			Name      string  `json:"name"`
			Type      string  `json:"type"`
			NotNull   int     `json:"notnull"`
			DfltValue *string `json:"dflt_value"`
			PK        int     `json:"pk"`
		}

		var cols []colInfo
		for rows.Next() {
			var c colInfo
			if err := rows.Scan(&c.CID, &c.Name, &c.Type, &c.NotNull, &c.DfltValue, &c.PK); err == nil {
				cols = append(cols, c)
			}
		}
		if cols == nil {
			cols = []colInfo{}
		}
		out, _ := json.Marshal(cols)
		val, _ := vm.ToValue(string(out))
		return val
	})

	// _sqlite_close(handle) => true
	vm.Set("_sqlite_close", func(call otto.FunctionCall) otto.Value {
		handle, err := call.Argument(0).ToInteger()
		if err != nil {
			return otto.FalseValue()
		}
		mu.Lock()
		db, ok := openDBs[int64(handle)]
		if ok {
			delete(openDBs, int64(handle))
		}
		mu.Unlock()
		if ok && db != nil {
			db.Close()
		}
		return otto.TrueValue()
	})

	// JavaScript wrapper — builds a connection object around a raw handle
	vm.Run(`
var sqlite = {};
sqlite.open = function(path) {
    var handle = _sqlite_open(path);
    if (handle === null || handle === undefined) { return null; }
    return {
        _handle: handle,
        exec: function(sql, params) {
            var r = _sqlite_exec(handle, sql, JSON.stringify(params || []));
            return JSON.parse(r);
        },
        query: function(sql, params) {
            var r = _sqlite_query(handle, sql, JSON.stringify(params || []));
            return JSON.parse(r);
        },
        queryRow: function(sql, params) {
            var rows = JSON.parse(_sqlite_query(handle, sql, JSON.stringify(params || [])));
            return rows.length > 0 ? rows[0] : null;
        },
        tables: function() {
            return JSON.parse(_sqlite_tables(handle));
        },
        schema: function(tableName) {
            return JSON.parse(_sqlite_schema(handle, tableName));
        },
        close: function() {
            return _sqlite_close(handle);
        }
    };
};
`)
}

// sqliteParseParams unmarshals a JSON array of query parameter values.
func sqliteParseParams(paramsJSON string) []interface{} {
	if paramsJSON == "" || paramsJSON == "null" || paramsJSON == "[]" {
		return nil
	}
	var raw []interface{}
	if err := json.Unmarshal([]byte(paramsJSON), &raw); err != nil {
		return nil
	}
	return raw
}

// sqliteConvertValue normalises values scanned from SQLite rows for JSON encoding.
func sqliteConvertValue(v interface{}) interface{} {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return v
}

// sqliteQuoteIdent safely double-quotes an SQL identifier.
func sqliteQuoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
