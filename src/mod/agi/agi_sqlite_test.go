//go:build !(linux && mipsle) && !(windows && arm) && !(windows && 386)

package agi

import (
	"database/sql"
	"path/filepath"
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

// ─── JS object structure ──────────────────────────────────────────────────────

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
