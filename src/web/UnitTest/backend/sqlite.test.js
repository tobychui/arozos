/*
    sqlite.test.js
    Unit test for the AGI SQLite library (requirelib("sqlite")).

    Creates user:/Desktop/unit_test.sqlite with three tables and test data,
    then exercises the full sqlite API: exec, query, queryRow, tables, schema,
    UPDATE, DELETE, JOINs, and NULL handling.

    A failed assertion throws an Error → AGI returns HTTP 500 → test runner marks FAIL.
    On success the script sends a summary → HTTP 200 → PASS.
*/

if (!requirelib("sqlite")) {
    throw new Error("requirelib('sqlite') returned false — SQLite library not available on this server");
}

var DB_PATH = "user:/Desktop/unit_test.sqlite";
var passed  = [];

// assert() throws with a descriptive message so the test runner shows FAIL
function assert(label, condition) {
    if (!condition) {
        throw new Error("ASSERTION FAILED: " + label);
    }
    passed.push(label);
}

function assertEq(label, actual, expected) {
    if (actual !== expected) {
        throw new Error("ASSERTION FAILED: " + label +
            " — expected " + JSON.stringify(expected) +
            " but got "    + JSON.stringify(actual));
    }
    passed.push(label);
}

// ── Open database ─────────────────────────────────────────────────────────────
var db = sqlite.open(DB_PATH);
assert("sqlite.open returns connection object", db !== null && typeof db === "object");
assert("connection has exec method",      typeof db.exec      === "function");
assert("connection has query method",     typeof db.query     === "function");
assert("connection has queryRow method",  typeof db.queryRow  === "function");
assert("connection has tables method",    typeof db.tables    === "function");
assert("connection has schema method",    typeof db.schema    === "function");
assert("connection has close method",     typeof db.close     === "function");

// ── Create tables (idempotent) ────────────────────────────────────────────────
db.exec(
    "CREATE TABLE IF NOT EXISTS users (" +
    "  id    INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  name  TEXT    NOT NULL," +
    "  email TEXT    UNIQUE," +
    "  age   INTEGER" +
    ")"
);
db.exec(
    "CREATE TABLE IF NOT EXISTS products (" +
    "  id    INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  name  TEXT    NOT NULL," +
    "  price REAL    NOT NULL," +
    "  stock INTEGER DEFAULT 0" +
    ")"
);
db.exec(
    "CREATE TABLE IF NOT EXISTS orders (" +
    "  id         INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  user_id    INTEGER NOT NULL," +
    "  product_id INTEGER NOT NULL," +
    "  quantity   INTEGER NOT NULL," +
    "  note       TEXT" +
    ")"
);
passed.push("CREATE TABLE IF NOT EXISTS (users, products, orders)");

// ── Reset for idempotent runs ─────────────────────────────────────────────────
db.exec("DELETE FROM orders");
db.exec("DELETE FROM products");
db.exec("DELETE FROM users");
// Reset autoincrement counters so IDs are predictable across runs
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','products','orders')");

// ── Insert — users ────────────────────────────────────────────────────────────
var r;
r = db.exec("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", ["Alice Chen",  "alice@example.com", 28]);
assertEq("INSERT users[1] lastInsertId", r.lastInsertId, 1);
assertEq("INSERT users[1] rowsAffected", r.rowsAffected, 1);

db.exec("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", ["Bob Kumar",   "bob@example.com",   35]);
r = db.exec("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", ["Carol White", "carol@example.com", null]);
assertEq("INSERT users[3] lastInsertId", r.lastInsertId, 3);

// ── Insert — products ─────────────────────────────────────────────────────────
db.exec("INSERT INTO products (name, price, stock) VALUES (?, ?, ?)", ["Widget A", 9.99,   100]);
db.exec("INSERT INTO products (name, price, stock) VALUES (?, ?, ?)", ["Widget B", 24.99,   50]);
db.exec("INSERT INTO products (name, price, stock) VALUES (?, ?, ?)", ["Gadget X", 149.99,  12]);

// ── Insert — orders ───────────────────────────────────────────────────────────
db.exec("INSERT INTO orders (user_id, product_id, quantity, note) VALUES (?, ?, ?, ?)", [1, 1, 3,    "first order"]);
db.exec("INSERT INTO orders (user_id, product_id, quantity, note) VALUES (?, ?, ?, ?)", [1, 3, 1,    null]);
db.exec("INSERT INTO orders (user_id, product_id, quantity, note) VALUES (?, ?, ?, ?)", [2, 2, 5,    "bulk buy"]);
passed.push("INSERT rows into users, products, orders");

// ── query() — basic SELECT ────────────────────────────────────────────────────
var users = db.query("SELECT * FROM users ORDER BY id");
assertEq("query() returns 3 users",        users.length,    3);
assertEq("users[0].name",                  users[0].name,   "Alice Chen");
assertEq("users[0].email",                 users[0].email,  "alice@example.com");
assertEq("users[0].age (integer)",         users[0].age,    28);
assertEq("users[1].name",                  users[1].name,   "Bob Kumar");

// ── NULL handling ─────────────────────────────────────────────────────────────
assert("NULL age stored as null (not zero/undefined)", users[2].age === null);
var orders = db.query("SELECT * FROM orders ORDER BY id");
assert("NULL note stored as null",          orders[1].note === null);

// ── query() — parameterised WHERE ────────────────────────────────────────────
var young = db.query("SELECT * FROM users WHERE age < ?", [30]);
assertEq("parameterised WHERE age<30 count", young.length,      1);
assertEq("parameterised WHERE result name",  young[0].name,     "Alice Chen");

var expensive = db.query("SELECT * FROM products WHERE price > ?", [20]);
assertEq("parameterised WHERE price>20",     expensive.length,  2);

// ── queryRow() ────────────────────────────────────────────────────────────────
var alice = db.queryRow("SELECT * FROM users WHERE email = ?", ["alice@example.com"]);
assert("queryRow returns object",            alice !== null);
assertEq("queryRow field value",             alice.email, "alice@example.com");

var miss = db.queryRow("SELECT * FROM users WHERE id = ?", [999]);
assert("queryRow no-match returns null",     miss === null);

// ── Aggregate queries ─────────────────────────────────────────────────────────
var cnt = db.queryRow("SELECT COUNT(*) AS cnt FROM products");
assertEq("COUNT(*) products",                parseInt(cnt.cnt), 3);

var total = db.queryRow("SELECT SUM(stock) AS s FROM products");
assertEq("SUM(stock)",                       parseInt(total.s), 162);   // 100+50+12

// ── JOIN query ────────────────────────────────────────────────────────────────
var detail = db.query(
    "SELECT o.id, u.name AS buyer, p.name AS item, o.quantity, p.price " +
    "FROM orders o " +
    "JOIN users u ON u.id = o.user_id " +
    "JOIN products p ON p.id = o.product_id " +
    "ORDER BY o.id"
);
assertEq("JOIN returns 3 rows",              detail.length,         3);
assertEq("JOIN first row buyer",             detail[0].buyer,       "Alice Chen");
assertEq("JOIN first row item",              detail[0].item,        "Widget A");
assertEq("JOIN first row quantity",          detail[0].quantity,    3);
assertEq("JOIN third row buyer",             detail[2].buyer,       "Bob Kumar");

// ── tables() ─────────────────────────────────────────────────────────────────
var tbls = db.tables();
assertEq("tables() count",                  tbls.length,           4);
assert("tables() has users",                tbls.indexOf("users")    >= 0);
assert("tables() has products",             tbls.indexOf("products") >= 0);
assert("tables() has orders",               tbls.indexOf("orders")   >= 0);

// ── schema() ─────────────────────────────────────────────────────────────────
var sch = db.schema("users");
assertEq("schema() 4 columns",              sch.length,   4);
assertEq("schema col[0] name",              sch[0].name,  "id");
assertEq("schema col[0] pk",               sch[0].pk,    1);
assertEq("schema col[1] name",              sch[1].name,  "name");
assertEq("schema col[1] notnull",           sch[1].notnull, 1);
assertEq("schema col[3] name",              sch[3].name,  "age");
assertEq("schema col[3] notnull (nullable)", sch[3].notnull, 0);

// ── UPDATE ────────────────────────────────────────────────────────────────────
var upd = db.exec("UPDATE users SET age = ? WHERE name = ?", [29, "Alice Chen"]);
assertEq("UPDATE rowsAffected",             upd.rowsAffected, 1);

var check = db.queryRow("SELECT age FROM users WHERE name = ?", ["Alice Chen"]);
assertEq("UPDATE value persisted",          check.age, 29);

// UPDATE no-match returns 0 rows affected
var noUpd = db.exec("UPDATE users SET age = 0 WHERE id = ?", [999]);
assertEq("UPDATE no-match rowsAffected=0",  noUpd.rowsAffected, 0);

// ── DELETE ────────────────────────────────────────────────────────────────────
var del = db.exec("DELETE FROM orders WHERE quantity = ?", [5]);
assertEq("DELETE rowsAffected",             del.rowsAffected,  1);

var remaining = db.queryRow("SELECT COUNT(*) AS cnt FROM orders");
assertEq("DELETE reduces row count",        parseInt(remaining.cnt), 2);

// ── exec() result shape ───────────────────────────────────────────────────────
var ins = db.exec("INSERT INTO products (name, price, stock) VALUES (?, ?, ?)", ["New Item", 1.00, 5]);
assert("exec() has lastInsertId key",       typeof ins.lastInsertId !== "undefined");
assert("exec() has rowsAffected key",       typeof ins.rowsAffected !== "undefined");
assertEq("exec() rowsAffected for INSERT",  ins.rowsAffected, 1);

// ── close() ───────────────────────────────────────────────────────────────────
var closeResult = db.close();
assert("close() returns true", closeResult === true);
passed.push("db.close()");

// ── Summary ───────────────────────────────────────────────────────────────────
sendResp(
    "SQLite library test PASSED (" + passed.length + " assertions)\n" +
    "Database written to: " + DB_PATH + "\n" +
    "Tables created: users (3 rows), products (4 rows), orders (2 rows)\n\n" +
    passed.map(function(s, i) { return (i + 1) + ". " + s; }).join("\n")
);
