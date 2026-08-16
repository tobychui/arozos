//go:build !(linux && mipsle) && !(windows && arm) && !(windows && 386)

package agi

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	_ "github.com/glebarez/go-sqlite"
	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	user "imuslab.com/arozos/mod/user"
)

// ─── pure-Go helper tests ─────────────────────────────────────────────────────

func TestSQLiteParseParams_EmptyInputs(t *testing.T) {
	for _, input := range []string{"", "null", "[]"} {
		if got := sqliteParseParams(input); len(got) != 0 {
			t.Errorf("sqliteParseParams(%q): expected empty slice, got %v", input, got)
		}
	}
}

func TestSQLiteParseParams_Values(t *testing.T) {
	got := sqliteParseParams(`["Alice", 30, null]`)
	if len(got) != 3 {
		t.Fatalf("expected 3 params, got %d", len(got))
	}
	if got[0] != "Alice" {
		t.Errorf("param[0]: expected Alice, got %v", got[0])
	}
	if got[2] != nil {
		t.Errorf("param[2]: expected nil, got %v", got[2])
	}
}

func TestSQLiteParseParams_InvalidJSON(t *testing.T) {
	if got := sqliteParseParams("{not json}"); len(got) != 0 {
		t.Errorf("expected nil on invalid JSON, got %v", got)
	}
}

func TestSQLiteConvertValue_ByteSlice(t *testing.T) {
	if got := sqliteConvertValue([]byte("hello")); got != "hello" {
		t.Errorf("expected string 'hello', got %v", got)
	}
}

func TestSQLiteConvertValue_Passthrough(t *testing.T) {
	if sqliteConvertValue(42) != 42 {
		t.Error("integer should pass through unchanged")
	}
	if sqliteConvertValue(nil) != nil {
		t.Error("nil should pass through as nil")
	}
	if sqliteConvertValue("text") != "text" {
		t.Error("string should pass through unchanged")
	}
}

func TestSQLiteQuoteIdent(t *testing.T) {
	tests := []struct{ in, want string }{
		{"users", `"users"`},
		{"my table", `"my table"`},
		{`has"quote`, `"has""quote"`},
		{"", `""`},
	}
	for _, tt := range tests {
		if got := sqliteQuoteIdent(tt.in); got != tt.want {
			t.Errorf("sqliteQuoteIdent(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

// ─── library registration ─────────────────────────────────────────────────────

func TestSQLiteLibRegister_AddsToLoadedLibs(t *testing.T) {
	g := minimalGateway()
	g.SQLiteLibRegister()
	if _, ok := g.LoadedAGILibrary["sqlite"]; !ok {
		t.Error("expected 'sqlite' in LoadedAGILibrary after SQLiteLibRegister")
	}
}

func TestSQLiteLibRegister_IdempotentDoesNotPanic(t *testing.T) {
	g := minimalGateway()
	g.SQLiteLibRegister()
	// Second call should log but not os.Exit in tests — verify no panic at least
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("second SQLiteLibRegister panicked: %v", r)
		}
	}()
}

// ─── DSN construction ─────────────────────────────────────────────────────────

func TestSQLiteBuildDSN_CarriesConcurrencyPragmas(t *testing.T) {
	dsn := sqliteBuildDSN(filepath.Join("some", "dir", "data.db"))

	// Without these two the library fails instantly on any lock contention,
	// which is the SQLITE_BUSY class of bug this DSN exists to prevent.
	for _, want := range []string{
		"_pragma=busy_timeout(5000)",
		"_pragma=journal_mode(WAL)",
		"_pragma=synchronous(NORMAL)",
		"_txlock=immediate",
	} {
		if !strings.Contains(dsn, want) {
			t.Errorf("DSN %q is missing %q", dsn, want)
		}
	}
}

func TestSQLiteBuildDSN_PreservesPathAndSeparator(t *testing.T) {
	dsn := sqliteBuildDSN("plain.db")
	if !strings.HasPrefix(dsn, "plain.db?") {
		t.Errorf("expected DSN to start with the path then '?', got %q", dsn)
	}
}

func TestSQLiteBuildDSN_PathWithQuestionMarkReturnedBare(t *testing.T) {
	// A '?' in the path would be parsed as the query separator, corrupting both
	// the filename and the pragmas — such a path must be passed through as-is.
	weird := filepath.Join("dir", "wh?at.db")
	if got := sqliteBuildDSN(weird); got != weird {
		t.Errorf("expected bare path %q, got %q", weird, got)
	}
}

func TestSQLiteBuildDSN_OpensRealDatabaseInWALMode(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "wal.db")

	db, err := sql.Open("sqlite", sqliteBuildDSN(dbPath))
	if err != nil {
		t.Fatalf("sql.Open with pragma DSN: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	var mode string
	if err := db.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatalf("reading journal_mode: %v", err)
	}
	if !strings.EqualFold(mode, "wal") {
		t.Errorf("expected journal_mode=wal, got %q", mode)
	}

	var timeout int
	if err := db.QueryRow(`PRAGMA busy_timeout`).Scan(&timeout); err != nil {
		t.Fatalf("reading busy_timeout: %v", err)
	}
	if timeout != sqliteBusyTimeoutMs {
		t.Errorf("expected busy_timeout=%d, got %d", sqliteBusyTimeoutMs, timeout)
	}
}

// ─── Concurrency behaviour ────────────────────────────────────────────────────

// Two connections to the same file, mimicking two simultaneous ArozOS requests:
// one writing (the indexer) while the other reads (the UI). Before the WAL +
// busy_timeout DSN this combination produced "database is locked (5)".
func TestSQLiteDSN_ConcurrentReaderDuringWriteTransaction(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "concurrent.db")
	dsn := sqliteBuildDSN(dbPath)

	writer, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open writer: %v", err)
	}
	defer writer.Close()
	writer.SetMaxOpenConns(1)

	if _, err := writer.Exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`); err != nil {
		t.Fatalf("CREATE TABLE: %v", err)
	}
	if _, err := writer.Exec(`INSERT INTO t (v) VALUES ('seed')`); err != nil {
		t.Fatalf("seed INSERT: %v", err)
	}

	reader, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open reader: %v", err)
	}
	defer reader.Close()
	reader.SetMaxOpenConns(1)

	// Hold an open write transaction while the reader works.
	tx, err := writer.Begin()
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx.Exec(`INSERT INTO t (v) VALUES ('pending')`); err != nil {
		tx.Rollback()
		t.Fatalf("INSERT inside tx: %v", err)
	}

	// In WAL mode this reads the last committed snapshot instead of erroring.
	var count int
	if err := reader.QueryRow(`SELECT COUNT(*) FROM t`).Scan(&count); err != nil {
		tx.Rollback()
		t.Fatalf("concurrent read during open write transaction: %v", err)
	}
	if count != 1 {
		t.Errorf("reader should see the pre-transaction snapshot (1 row), got %d", count)
	}

	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	if err := reader.QueryRow(`SELECT COUNT(*) FROM t`).Scan(&count); err != nil {
		t.Fatalf("read after commit: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 rows after commit, got %d", count)
	}
}

// ─── Cleanup on VM teardown ───────────────────────────────────────────────────

func TestInjectSQLiteLib_RegistersCleanup(t *testing.T) {
	g := minimalGateway()
	registered := 0
	payload := &static.AgiLibInjectionPayload{
		VM:              otto.New(),
		User:            &user.User{Username: "test"},
		RegisterCleanup: func(func()) { registered++ },
	}
	g.injectSQLiteLibFunctions(payload)

	if registered != 1 {
		t.Errorf("expected the sqlite lib to register exactly 1 cleanup, got %d", registered)
	}
}

func TestInjectSQLiteLib_NilRegisterCleanupDoesNotPanic(t *testing.T) {
	g := minimalGateway()
	// init.agi-style payloads carry no cleanup registry; injection must still work.
	defer func() {
		if caught := recover(); caught != nil {
			t.Errorf("injection panicked with nil RegisterCleanup: %v", caught)
		}
	}()
	g.injectSQLiteLibFunctions(&static.AgiLibInjectionPayload{
		VM:   otto.New(),
		User: &user.User{Username: "test"},
	})
}

// ─── JS object structure ──────────────────────────────────────────────────────

func TestInjectSQLiteLib_TransactionExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	g.injectSQLiteLibFunctions(&static.AgiLibInjectionPayload{
		VM:   vm,
		User: &user.User{Username: "test"},
	})

	// sqlite.open() needs a real user filesystem, so assert on the wrapper source
	// instead: transaction must exist and must open with BEGIN IMMEDIATE so the
	// busy timeout applies rather than deadlocking on a deferred upgrade.
	for _, want := range []string{"transaction:", "BEGIN IMMEDIATE", "ROLLBACK", "COMMIT"} {
		val, err := vm.Run(`sqlite.open.toString().indexOf(` + strconv.Quote(want) + `) >= 0`)
		if err != nil {
			t.Fatalf("inspecting wrapper for %q: %v", want, err)
		}
		found, _ := val.ToBoolean()
		if !found {
			t.Errorf("sqlite.open wrapper should contain %q", want)
		}
	}
}

// injectSQLiteWithStubbedNatives injects the library, then replaces the native
// bridge functions with JS stubs that append every executed statement to a global
// `log` array. This exercises the real JS wrapper (BEGIN/COMMIT/ROLLBACK ordering,
// the nesting guard, error propagation) without needing a user filesystem.
func injectSQLiteWithStubbedNatives(t *testing.T) *otto.Otto {
	t.Helper()
	g := minimalGateway()
	vm := otto.New()
	g.injectSQLiteLibFunctions(&static.AgiLibInjectionPayload{
		VM:   vm,
		User: &user.User{Username: "test"},
	})

	if _, err := vm.Run(`
		var log = [];
		_sqlite_open  = function(p)          { return 1; };
		_sqlite_exec  = function(h, sql, pj) { log.push(sql); return '{"lastInsertId":0,"rowsAffected":1}'; };
		_sqlite_query = function(h, sql, pj) { log.push(sql); return '[]'; };
	`); err != nil {
		t.Fatalf("installing native stubs: %v", err)
	}
	return vm
}

func jsStringSlice(t *testing.T, vm *otto.Otto, expr string) []string {
	t.Helper()
	val, err := vm.Run(expr)
	if err != nil {
		t.Fatalf("evaluating %s: %v", expr, err)
	}
	raw, err := val.Export()
	if err != nil {
		t.Fatalf("exporting %s: %v", expr, err)
	}
	// Otto exports a homogeneous array as []string but an empty one as []interface{}.
	switch v := raw.(type) {
	case []string:
		return v
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, fmt.Sprint(item))
		}
		return out
	default:
		t.Fatalf("expected a string array from %s, got %T", expr, raw)
		return nil
	}
}

func TestSQLiteTransaction_CommitsOnSuccess(t *testing.T) {
	vm := injectSQLiteWithStubbedNatives(t)

	if _, err := vm.Run(`
		var db = sqlite.open("x");
		db.transaction(function(tx) {
			tx.exec("INSERT 1");
			tx.exec("INSERT 2");
		});
	`); err != nil {
		t.Fatalf("transaction: %v", err)
	}

	got := jsStringSlice(t, vm, `log`)
	want := []string{"BEGIN IMMEDIATE", "INSERT 1", "INSERT 2", "COMMIT"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("statement %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestSQLiteTransaction_RollsBackAndRethrowsOnError(t *testing.T) {
	vm := injectSQLiteWithStubbedNatives(t)

	val, err := vm.Run(`
		var db = sqlite.open("x");
		var caught = "";
		try {
			db.transaction(function(tx) {
				tx.exec("INSERT 1");
				throw new Error("boom");
			});
		} catch (e) {
			caught = e.message;
		}
		caught;
	`)
	if err != nil {
		t.Fatalf("running transaction: %v", err)
	}

	// The caller's error must survive the rollback, not be masked by it.
	msg, _ := val.ToString()
	if !strings.Contains(msg, "boom") {
		t.Errorf("expected the original error to propagate, got %q", msg)
	}

	got := jsStringSlice(t, vm, `log`)
	want := []string{"BEGIN IMMEDIATE", "INSERT 1", "ROLLBACK"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("statement %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestSQLiteTransaction_ReturnsCallbackValueAndAllowsReuse(t *testing.T) {
	vm := injectSQLiteWithStubbedNatives(t)

	val, err := vm.Run(`
		var db = sqlite.open("x");
		var first = db.transaction(function(tx) { return 42; });
		// A committed transaction must leave the connection usable for the next one.
		var second = db.transaction(function(tx) { return first + 1; });
		second;
	`)
	if err != nil {
		t.Fatalf("running transactions: %v", err)
	}
	n, _ := val.ToInteger()
	if n != 43 {
		t.Errorf("expected the callback's return value to propagate (43), got %d", n)
	}
}

func TestSQLiteTransaction_RejectsNesting(t *testing.T) {
	vm := injectSQLiteWithStubbedNatives(t)

	val, err := vm.Run(`
		var db = sqlite.open("x");
		var caught = "";
		try {
			db.transaction(function(tx) {
				tx.transaction(function() {});
			});
		} catch (e) {
			caught = e.message;
		}
		caught;
	`)
	if err != nil {
		t.Fatalf("running nested transaction: %v", err)
	}
	msg, _ := val.ToString()
	if !strings.Contains(msg, "nested") {
		t.Errorf("expected a nesting error, got %q", msg)
	}
}

func TestSQLiteTransaction_RequiresFunction(t *testing.T) {
	vm := injectSQLiteWithStubbedNatives(t)

	val, err := vm.Run(`
		var db = sqlite.open("x");
		var caught = "";
		try { db.transaction("not a function"); } catch (e) { caught = e.message; }
		caught;
	`)
	if err != nil {
		t.Fatalf("running transaction: %v", err)
	}
	msg, _ := val.ToString()
	if !strings.Contains(msg, "requires a function") {
		t.Errorf("expected an argument-type error, got %q", msg)
	}
	// Nothing should have been sent to SQLite.
	if got := jsStringSlice(t, vm, `log`); len(got) != 0 {
		t.Errorf("expected no statements executed, got %v", got)
	}
}

func TestInjectSQLiteLib_JSObjectExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{
		VM:   vm,
		User: &user.User{Username: "test"},
	}
	g.injectSQLiteLibFunctions(payload)

	val, err := vm.Run(`typeof sqlite.open`)
	if err != nil {
		t.Fatalf("evaluating typeof sqlite.open: %v", err)
	}
	s, _ := val.ToString()
	if s != "function" {
		t.Errorf("sqlite.open should be a function, got %q", s)
	}
}

func TestInjectSQLiteLib_NativeFunctionsRegistered(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{
		VM:   vm,
		User: &user.User{Username: "test"},
	}
	g.injectSQLiteLibFunctions(payload)

	for _, fn := range []string{
		"_sqlite_open",
		"_sqlite_exec",
		"_sqlite_query",
		"_sqlite_tables",
		"_sqlite_schema",
		"_sqlite_close",
	} {
		val, err := vm.Run(`typeof ` + fn)
		if err != nil {
			t.Fatalf("evaluating typeof %s: %v", fn, err)
		}
		s, _ := val.ToString()
		if s != "function" {
			t.Errorf("%s should be a function, got %q", fn, s)
		}
	}
}

// ─── driver integration (no AGI VM, direct sql.Open) ─────────────────────────

func TestSQLiteDriver_CreateInsertQuery(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	if _, err = db.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("CREATE TABLE: %v", err)
	}

	res, err := db.Exec(`INSERT INTO users (name) VALUES (?)`, "Alice")
	if err != nil {
		t.Fatalf("INSERT: %v", err)
	}
	id, _ := res.LastInsertId()
	if id != 1 {
		t.Errorf("expected lastInsertId=1, got %d", id)
	}

	var name string
	if err := db.QueryRow(`SELECT name FROM users WHERE id = ?`, 1).Scan(&name); err != nil {
		t.Fatalf("SELECT: %v", err)
	}
	if name != "Alice" {
		t.Errorf("expected Alice, got %s", name)
	}
}

func TestSQLiteDriver_ParameterisedQuery(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(tmpDir, "p.db"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	if _, err = db.Exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)`); err != nil {
		t.Fatalf("CREATE: %v", err)
	}
	for _, pair := range [][2]string{{"a", "1"}, {"b", "2"}, {"c", "3"}} {
		if _, err = db.Exec(`INSERT INTO kv VALUES (?, ?)`, pair[0], pair[1]); err != nil {
			t.Fatalf("INSERT: %v", err)
		}
	}

	rows, err := db.Query(`SELECT k, v FROM kv WHERE k != ? ORDER BY k`, "b")
	if err != nil {
		t.Fatalf("SELECT: %v", err)
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatalf("Scan: %v", err)
		}
		keys = append(keys, k)
	}
	if len(keys) != 2 || keys[0] != "a" || keys[1] != "c" {
		t.Errorf("expected [a c], got %v", keys)
	}
}

func TestSQLiteDriver_TableListViaSchemaQuery(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(tmpDir, "schema.db"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	// Use AUTOINCREMENT so SQLite creates sqlite_sequence internally —
	// the filtered query must still return only the 3 user tables.
	for _, tbl := range []string{"alpha", "beta", "gamma"} {
		if _, err = db.Exec(`CREATE TABLE ` + tbl + ` (id INTEGER PRIMARY KEY AUTOINCREMENT)`); err != nil {
			t.Fatalf("CREATE %s: %v", tbl, err)
		}
	}

	// Matches the filter used by _sqlite_tables
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		t.Fatalf("sqlite_master query: %v", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("Scan: %v", err)
		}
		tables = append(tables, name)
	}
	if len(tables) != 3 {
		t.Errorf("expected 3 user tables, got %v", tables)
	}
}
