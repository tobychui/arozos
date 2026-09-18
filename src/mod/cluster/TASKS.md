# ArozOS Cluster – Implementation Tasks for Phases 3 to 9

This file is the work order for finishing the cluster. Phases 1 (membership,
ACN transport) and 2 (identity) are done and verified. Everything below is
written so that it can be implemented one task at a time, in order, without
having to re-derive the design. **Read [README.md](README.md) and
[`CLAUDE.md`](../../../CLAUDE.md) first**, then read this file top to bottom
before starting any task. Do not skip the "Ground rules" section.

**Status (2026-09-19): Phases 3 to 6 are implemented and verified.**
- 6.1: node events are computed locally on every node (no fan-out needed);
  hooks read the event with `postPara("event")`; the web feed is served by
  the user router (any logged-in user); hooks listing at
  `/system/cluster/events/hooks`. 6.2: the provider interface is
  `agi.ClusterProvider`, wired after `ClusterInit` through
  `AGIGateway.ClusterLibRegister()` because AGI starts before the cluster.
Deviations from the text below, kept deliberately small:
- 5.1/5.2: replication tasks are ephemeral (in memory on the leader, with a
  50-entry history) instead of a `repl_tasks` table; the metadata records are
  the source of truth and a new leader re-plans within one interval. Empty
  files are replicated like any other. Over-replication drops require the
  remaining copies to be healthy, not strictly `verified`, because writers
  publish `committed` copies.
- 5.1: a stale copy on an online node is repaired in place (the planner
  prefers the volume that holds the stale copy as the target).
- 5.4: evacuation lives in `storage` (`StartEvacuation`, `EvacuationStatus`,
  `FinishEvacuation`, `Volume.Evacuating`) and the planner drives it; the
  leader retires the volume once nothing references it.
- 3.4: a follower whose `applied` counter is 0 (fresh node or new term) always
  takes a snapshot instead of paging the log, because the log may have been
  compacted below what it needs.
- 3.5: `leaseTick` also asks for a catch-up whenever a follower sees
  `applied < lastSeq` (learned from lease pushes), which keeps followers
  current between heartbeats.
- 4.5: `Write` publishes the record only after the bytes are in place (no
  intermediate `writing` location), matching the design's "only COMMITTED
  files become visible". `LocWriting`/`LocPending` remain for Phase 5.
- 4.5: `Info` lives in `storage` and `clusterfs` has its own `Info`; the core
  adapts between them (`clusterBackend` in `src/cluster.go`).
- Membership timing constants became variables so tests can shorten them;
  `storage` and `metadata` tests set them in `init()`.
- 4.6: the drive is mounted from `cluster.go` through
  `membership.Manager.OnMembershipChange` exactly as planned; `listRoots`
  reports it as `Cluster=cluster:/`.

Terminology: *node* = one ArozOS installation; *member* = node in the cluster;
*leader* = the member currently holding the metadata lease; *origin* = the
identity origin node (Phase 2); *volume* = a folder a node contributes to the
cluster namespace; *record* = one entry in the metadata store.

---

## 0. Ground rules (apply to every task)

### 0.1 Repository conventions (enforced by hooks and CI)
1. Log only through `logger.PrintAndLog("Cluster", message, err)` from
   `imuslab.com/arozos/mod/info/logger`. Never import `log`.
2. Every new package under `src/mod/` ships a `*_test.go`. Every new exported
   function is covered by a test. Style: `t.TempDir()`, `t.Fatalf`,
   table-driven where it fits.
3. No new dependencies unless MIT/BSD/Apache-2.0/MPL-2.0/ISC and truly needed.
   Everything below is designed to need **no** new module.
4. Authenticated HTTP endpoints for browsers go through
   `prout.NewModuleRouter(...)` (see `src/cluster.go`, the `registerAdmin`
   closure). Node-to-node endpoints go through `acn.Server.HandleFunc` (signed)
   and are mounted automatically under `/cluster/acn/`.
5. Stay portable: no hard-coded OS paths, no `exec.Command` in shared code,
   build tags for anything OS specific (see `capability/diskusage_*.go`).
6. No emoji anywhere (Go, HTML, JS, CSS). Use inline SVG or Semantic UI icons.

### 0.2 Things that bit us already (do not repeat)
- **Line endings.** Several core files are checked out with CRLF. If an edit
  produces a whole-file diff in `git diff --stat`, run `sed -i 's/\r$//' <file>`
  on that file; the repository content is LF.
- **Bolt cannot run under `-race`.** `go test -race` panics inside
  `github.com/boltdb/bolt` (checkptr). Run cluster packages without `-race`;
  the `acn` package has no Bolt and may use `-race`.
- **Page scripts must not use `var status`**: it shadows `window.status` and
  silently stringifies objects. Name page state `clusterStatus` etc.
- **`go mod tidy` pulls in modules imported by user files under `src/files/`.**
  Do not run it blindly; if you must, revert unrelated additions in `go.mod`.
- **One millisecond is not unique.** Every replicated record carries a version
  produced by `nextVersion(prev)` (`membership/types.go`), which is strictly
  greater than the previous value. Copy that helper into new packages (or
  export it) and never compare with `>=`.
- **Windows temp-dir cleanup** fails for tests that keep a Bolt DB open;
  always `Close()` managers in `t.Cleanup`.
- **Do not run two ArozOS instances from `src/`** (Bolt lock on `ao.db`). See
  0.5 for the two-node recipe.

### 0.3 Building blocks that already exist (use these, do not reinvent)

| Need | Use |
|---|---|
| Send a signed request to a member by ID | `clusterManager.Transport().DoJSON(ctx, nodeID, method, path, in, out)` or `.Do(...)` for raw bytes. Routing (direct / tunnel / relay) is automatic. |
| Add a signed node endpoint | `clusterManager.Server().HandleFunc(acn.BasePath+"/x", func(w, r, sender *acn.SignedIdentity, body []byte))`. Body is already read and verified. |
| Know who is in the cluster and their state | `clusterManager.NodeViews()` (`[]membership.NodeView`, has `State`, `Local`, `Capabilities`, `Health`, `AdvertiseURL`, `TunnelVia`). |
| Own node ID / cluster ID | `clusterManager.NodeID()`, `clusterManager.Cluster()` (nil when standalone), `clusterManager.InCluster()`. |
| Persist cluster-scoped state | `clusterManager.DB()` (`*database.Database`, file `system/cluster.db`). Register new table names with `membership.RegisterClusterTable(name)` (task 3.1 adds this) so they are wiped on leave. |
| React to cluster-wide setting changes | `clusterManager.OnClusterChange` (chain it: keep the previous callback, see `identity.New`). |
| Node capabilities and requirement matching | `capability.Manifest.Satisfies(capability.Requirements)`. |
| Disk free space of a path | `capability.DiskUsage(path)`. |
| Cross-node user identity | `clusterIdentity.Issue(username, ttl)` → token; `clusterIdentity.Attach(req, username)` sets `X-Aroz-User`; on the receiving side `clusterIdentity.FromRequest(r)` → `*identity.Assertion{User, Groups, Issuer}`. |
| Resolve a user on this node | `userHandler.GetUserInfoFromUsername(username)` → `*user.User` (has `CanRead/CanWrite(vpath)`, `GetAllFileSystemHandler()`). |
| Local file systems | `GetAllLoadedFsh()` in `src/storage.go`; each `*filesystem.FileSystemHandler` has `.UUID`, `.Path`, `.FileSystemAbstraction` (interface in `mod/filesystem/filesystem.go`), `.RequireBuffer`. |
| Run an AGI script as a user | `AGIGateway.ExecuteAGIScriptAsUser(fsh, scriptVpath, user, w, r)` and `AGIGateway.ExecuteAGIScript(content, fsh, scriptFile, scope, w, r, user)` (`mod/agi/agi.go`). |
| Register an AGI library | `g.RegisterLib("name", injectFunc)` in `mod/agi/moduleManager.go` `LoadAllFunctionalModules`; injection payload `static.AgiLibInjectionPayload{VM, User, ScriptFsh, ScriptPath, Writer, Request}`. Pattern: `mod/agi/agi.sysinfo.go`. |
| Periodic system tasks | `nightlyManager.RegisterNightlyTask(func())`, or your own `time.Ticker` goroutine stopped in `Close()`. |
| Settings page | Add a card to `src/web/SystemAO/cluster/cluster.html` (same CSS variables, `t(key, fallback)` for strings, `apiPost`/`$.getJSON` helpers) or a new page registered with `registerSetting(settingModule{Group: "Cluster", RequireAdmin: true, ...})` in `src/cluster.go`. |

### 0.4 Testing pattern for multi-node logic
Copy the helper style from `identity/identity_test.go`: create N
`membership.NewManager` instances with `t.TempDir()` databases, expose each
with `httptest.NewServer(m.ACNHandler())`, set the URL through
`m.UpdateConfig`, create a cluster on one, `NewJoinToken` + `JoinCluster` the
others, and `waitFor(...)` conditions with a 5 s deadline. Build your new
package's manager on top of each membership manager exactly like
`identity.New` does. Never sleep fixed durations; poll with `waitFor`.

### 0.5 Live two-node verification
Build once (`cd src && go build -o arozos.exe .`), then make two isolated
copies **outside** `src/`: copy `src/system` (delete `logs`, `dev.uuid`,
`cluster.db*`, `cluster/`), create an empty `files/`, junction or copy
`src/web` as `web`, copy the binary. Run each copy with
`.\arozos.exe -port 808X -allow_mdns=false -allow_ssdp=false -uuid node-x -hostname NodeX`
(use the explicit `.\` or you may launch a stale binary from `PATH`). Set a
known admin password only in the copies (write `passhash/<user>` in the copied
`ao.db` with `auth.Hash`). Log in from a browser with
`fetch('/system/auth/login', {method:'POST', body:new URLSearchParams({username, password, rmbme:'false'})})`
and open `/SystemAO/cluster/cluster.html`. Stop the processes when done; do
not commit changes to `.claude/launch.json` or the `system/` folders.

### 0.6 Definition of done for every task
- `cd src && go build ./... && go vet ./mod/cluster/... && gofmt -l <your files>` clean.
- `go test ./mod/cluster/...` green (no `-race`), repeated with `-count=3`.
- `sh scripts/check-conventions.sh <changed files>` shows no ERROR lines
  attributable to your lines (pre-existing warnings in `main.go`, `user.go`,
  `mod/auth/auth.go` are known).
- README.md roadmap row updated; any new endpoint listed in README.md.
- If the change is visible in the UI, verified live per 0.5 with a screenshot.

---

## Phase 3 – Metadata store (ACMS)

**Goal.** One replicated index of *what files exist in the cluster namespace
and where their copies are*, plus a leader lease used to serialise decisions
(placement, replication, scheduling). Files themselves never move through
this layer. Consistency model (decided with the project owner): **no Raft**.
Records are last-writer-wins by version; the log is only a replication
vehicle; correctness can always be restored by rescanning real files.

Package: `src/mod/cluster/metadata`. Wire in `src/cluster.go` after the
identity service as `clusterMetadata *metadata.Manager`.

### Task 3.1 – Cluster-scoped tables registry (membership)
Files: `membership/store.go`, `membership/store_test.go`.
1. Add
   ```go
   var extraClusterTables = []string{}
   var extraTablesMu sync.Mutex
   // RegisterClusterTable declares a cluster.db table that belongs to cluster
   // membership: it is created on open and dropped when the node leaves.
   func RegisterClusterTable(name string)
   ```
   `newStore` must create every registered table (call after
   `db.NewTable(TableIdentity)`), and `wipeCluster` must drop + recreate them.
   Because packages call `RegisterClusterTable` from their `New(...)`, also
   create the table at registration time when a store is already open: give
   `store` a package-level pointer `currentStore *store` set in `newStore`
   and cleared in `close()`; `RegisterClusterTable` calls
   `currentStore.db.NewTable(name)` when non-nil.
2. Test: register a table, create a manager, write a key, `LeaveCluster`,
   assert the key is gone and the table still exists.

### Task 3.2 – Prefix listing in the database package
Files: `mod/database/database.go`, `database_core.go`, `database_openwrt.go`,
tests in both `database_core_test.go`/`database_public_test.go`.
1. Add `func (d *Database) ListTableWithPrefix(tableName string, prefix string) ([][][]byte, error)`
   implemented with a Bolt cursor `Seek([]byte(prefix))` looping while
   `bytes.HasPrefix(k, prefix)`. Implement it in **both** core files
   (`database_core.go` and the mipsle/riscv64 `database_openwrt.go`) or the
   cross-compile breaks.
2. Test with keys `a/1`, `a/2`, `b/1`: prefix `a/` returns exactly two.

### Task 3.3 – Records and local store
File: `metadata/types.go`, `metadata/store.go`, `metadata/store_test.go`.

Copy `nextVersion` from membership (or export it as
`membership.NextVersion` and use that). All `Version` fields use it.

```go
// Volume is a folder one node contributes to the namespace.
type Volume struct {
    ID        string `json:"id"`        // uuid
    NodeID    string `json:"nodeId"`
    Name      string `json:"name"`      // display
    FshUUID   string `json:"fshUuid"`   // local file system handler the folder lives on
    Subpath   string `json:"subpath"`   // path inside that fsh, always "/x/y" form
    Capacity  int64  `json:"capacity"`  // bytes, refreshed by the owner node
    Free      int64  `json:"free"`
    ReadOnly  bool   `json:"readOnly"`
    Removed   bool   `json:"removed"`
    Version   int64  `json:"version"`
}

const (
    LocPending   = "pending"   // placement decided, nothing written yet
    LocWriting   = "writing"   // bytes are being written
    LocCommitted = "committed" // fully written, checksum matched by the writer
    LocVerified  = "verified"  // re-read and checksum matched after commit
    LocStale     = "stale"     // node offline too long or checksum mismatch; do not read
    LocFailed    = "failed"
)

type Location struct {
    VolumeID string `json:"volumeId"`
    NodeID   string `json:"nodeId"`
    State    string `json:"state"`
    Checksum string `json:"checksum"` // sha256 hex of the copy on that volume
    Updated  int64  `json:"updated"`
}

type FileRecord struct {
    ID        string     `json:"id"`       // uuid, stable across renames
    Path      string     `json:"path"`     // logical path, "/photos/2026/a.jpg"; "/" for root; no trailing slash
    IsDir     bool       `json:"isDir"`
    Size      int64      `json:"size"`
    ModTime   int64      `json:"modTime"`
    Checksum  string     `json:"checksum"` // sha256 hex, "" for directories
    Owner     string     `json:"owner"`    // username that created it
    Primary   string     `json:"primary"`  // VolumeID of the preferred copy
    Locations []Location `json:"locations"`
    Replicas  int        `json:"replicas"` // desired copies, 0 = use folder policy
    Removed   bool       `json:"removed"`  // tombstone
    Version   int64      `json:"version"`
}

// Policy is the desired replica count for a top-level folder.
type Policy struct {
    Folder   string `json:"folder"`   // "/photos"
    Replicas int    `json:"replicas"` // >= 1
    Version  int64  `json:"version"`
}
```

Tables (register all with `membership.RegisterClusterTable`):
`meta_files` (ID → FileRecord), `meta_paths` (Path → ID), `meta_volumes`
(ID → Volume), `meta_policy` (Folder → Policy), `meta_log` (zero-padded 20
digit Seq → Entry), `meta_state` (`lease`, `applied`, `lastseq`).

Store API (all methods take and return copies, guard with a `sync.RWMutex`,
keep in-memory maps for files/paths/volumes/policies loaded at open):
`putFile(rec) (changed bool)` – LWW on Version; when the path changed, delete
the old `meta_paths` key and write the new one; tombstones keep their path
entry so a re-create with a newer version wins.
`getFileByID`, `getFileByPath`, `listDir(path) []FileRecord` – children are
records whose `Path` has `dir + "/"` as prefix and no further `/` (skip
tombstones); use `ListTableWithPrefix` on `meta_paths` for cold loads.
`putVolume`, `volumes()`, `putPolicy`, `policies()`, `policyFor(path)` –
walks up to the first path segment; default `Policy{Replicas: 1}`.
`appendLog(entry)`, `logAfter(seq, max)`, `compactLog(keepLast int)`,
`lastSeq()`, `applied()`/`setApplied(seq)`, `lease()`/`setLease()`.
Tests: LWW (older version ignored), rename moves the path index, tombstone
hides from `listDir`, prefix listing of nested dirs, policy lookup for
`/photos/2026/a.jpg` returns the `/photos` policy.

### Task 3.4 – Replicated log
File: `metadata/log.go`, `metadata/log_test.go`.

```go
type Entry struct {
    Seq     uint64          `json:"seq"`  // assigned by the leader, 0 while pending
    Term    uint64          `json:"term"`
    Kind    string          `json:"kind"` // "file", "volume", "policy"
    Payload json.RawMessage `json:"payload"`
    Version int64           `json:"version"` // copied from the record
    Origin  string          `json:"origin"`  // node that produced the change
}
```
`apply(entry)` decodes by `Kind` and calls the matching `put*`. Applying is
idempotent (LWW), so replays are harmless.

Flow:
1. `Manager.Submit(kind, record)` (public): stamp `Version = nextVersion(old)`,
   `apply` locally **immediately** (the local view must reflect the change
   before returning), then if this node is leader → `assign` (Seq =
   lastSeq+1, Term = current) → `appendLog` → fan-out
   `POST /cluster/acn/meta/append {Entries: [entry]}` to every ONLINE peer
   (best effort, in goroutines). If not leader → push to `pending` queue
   (in memory + table `meta_pending` keyed by a uuid) and send
   `POST /cluster/acn/meta/submit {Entry}` to the leader; on success remove
   from pending. A background loop retries pending entries every 15 s.
2. Followers receiving `append`: `apply` each entry, `setApplied(seq)` if
   `seq == applied+1`, otherwise store and request catch-up.
3. Catch-up: `GET /cluster/acn/meta/log?after=<applied>` from the leader
   (max 500 entries per call, loop until caught up). If the leader answers
   `410 Gone` (compacted), call `GET /cluster/acn/meta/snapshot` which
   returns every current record (files, volumes, policies) plus `lastSeq`;
   apply all, `setApplied(lastSeq)`.
4. Leader compaction: keep the last 10 000 entries; run after every 1 000
   appends.
5. On leadership change (new term), followers reset `applied` to 0 and do a
   full snapshot once (simple and safe).

Tests (3 managers over `httptest`): submit on leader replicates to both
followers within 5 s; submit on a follower reaches everyone; a follower that
was stopped (close its server, keep the manager) catches up by log when
restarted within the log window and by snapshot after `compactLog(0)`; an
older version arriving later never overwrites a newer record.

### Task 3.5 – Leader lease
File: `metadata/lease.go`, `metadata/lease_test.go`.

```go
type Lease struct {
    Holder  string `json:"holder"`
    Term    uint64 `json:"term"`
    Expires int64  `json:"expires"` // unix seconds
}
const LeaseDuration = 30 * time.Second
const LeaseRenew    = 10 * time.Second
```
Algorithm (runs in a goroutine every 5 s on every member; deterministic, no
quorum, works with 2 nodes):
1. `candidate()` = among `NodeViews()` with `State` ONLINE or DEGRADED (never
   MAINTENANCE/DRAINING/OFFLINE/UNKNOWN), the record with the smallest
   `Joined`, ties by smallest `ID`. The local node counts as ONLINE.
2. If the current lease is unexpired and its holder is still eligible → if
   holder is me, renew when `Expires - now < LeaseRenew`: bump `Expires`,
   push `POST /cluster/acn/meta/lease {Lease}` to all peers.
3. If the lease is expired **or** the holder is no longer eligible, and the
   candidate is me → claim: `Term+1`, `Holder = me`, push to peers.
4. Receiving `lease`: accept if `in.Term > mine.Term`, or same term and same
   holder (renewal). Reject otherwise (respond 409 with my lease so the
   sender learns the higher term and steps down).
5. `IsLeader()` = holder is me and not expired. `Leader()` returns holder or
   `""`. Callers that need the leader and get `""` must retry later, never
   proceed locally except for `Submit` (which queues, see 3.4).
6. Log leadership changes once per change.
Tests: with A (joined first) and B, A becomes leader within 15 s; stop A's
server, B becomes leader after `LeaseDuration`; restart A, A sees B's higher
term and stays follower until B's lease expires (A only claims when B is not
eligible, i.e. offline). Split-brain healing: fake two leases with different
terms, the higher term wins on both sides.

### Task 3.6 – ACN and admin endpoints, wiring, UI
Files: `metadata/handlers_acn.go`, `metadata/handlers_admin.go`,
`src/cluster.go`, `cluster.html`.
- Signed: `POST meta/append`, `POST meta/submit`, `GET meta/log?after=`,
  `GET meta/snapshot`, `POST meta/lease`, `GET meta/stat?path=` (returns the
  record, used by Phase 4 for cache misses).
- Admin (`/system/cluster/meta/*`): `status` → `{leader, term, isLeader,
  leaseExpires, applied, lastSeq, files, dirs, volumes, pending}`; `ls?path=`;
  `stat?path=`; `policy/list`, `policy/set` (folder, replicas).
- UI: a "Metadata" card on `cluster.html` showing leader, term, counts,
  pending entries, and the policy table with an editable replica count per
  top-level folder.
- Wiring: `clusterMetadata, _ = metadata.New(metadata.Option{Membership: clusterManager})`
  after identity; `Close()` in `ClusterShutdown` before the membership manager.

Acceptance: two live nodes, `status` shows the same leader and term on both,
setting a policy on one appears on the other within 15 s.

---

## Phase 4 – Unified namespace (`cluster:/`)

**Goal.** A `cluster:/` drive appears in File Manager (and every app, WebDAV,
AGI `filelib`) on every member. Reads and writes go to whichever node holds
the bytes; the user never sees nodes or paths. Files stay whole files on
ordinary folders that admins picked (volumes). Transfers between nodes are
4 MiB chunks with per-chunk and whole-file SHA-256 because deployments sit
behind Cloudflare (100 MB / 100 s limits).

Packages: `src/mod/cluster/storage` (volumes + chunk transfer, "ACS") and
`src/mod/filesystem/abstractions/clusterfs` (the drive).

### Task 4.1 – Volumes
Files: `storage/volumes.go`, `storage/volumes_test.go`, admin handlers, UI.
1. Admin picks a folder: `POST /system/cluster/storage/volume/add`
   with `fsh=<uuid>&path=<subpath>&name=`. Validate: fsh exists in
   `GetAllLoadedFsh()`, is local (`Filesystem` not a network type,
   `!RequireBuffer`), path exists or can be created, not already a volume,
   not the user root itself. Create `Volume{ID: uuid, NodeID: self, ...}`,
   compute Capacity/Free with `capability.DiskUsage(realPath)`, and
   `clusterMetadata.Submit("volume", v)`.
2. `volume/remove` sets `Removed = true` (data stays on disk; replication in
   Phase 5 re-creates copies elsewhere first when possible, see 5.4).
3. Every 60 s the owner refreshes `Free` for its volumes (Submit only when the
   value changed by more than 1 %).
4. `realPath(vol, logical string) (string, error)`: join
   `fsh.Path`, `vol.Subpath`, `logical`; reject any result that escapes the
   volume root (`filepath.Clean` + prefix check). All local file access in
   this package goes through this helper and the local fsh's
   `FileSystemAbstraction`.
5. UI: "Storage" card listing this node's volumes (name, folder, free/total,
   file count) with add/remove, and a read-only list of other nodes' volumes.
Default suggestion in the UI: `user:/cluster` (create it if missing).

### Task 4.2 – Chunked transfer protocol (server side)
Files: `storage/transfer_server.go`, `storage/transfer_test.go`.

Constants: `ChunkSize = 4 << 20`, `MaxChunkSize = 8 << 20`,
`SessionTTL = 30 * time.Minute`.

Endpoints (all signed, all operate on **this node's** volumes only; reject
with 404 when `VolumeID` is not local):
| Endpoint | Body / query | Reply |
|---|---|---|
| `POST store/begin` | `{VolumeID, Path, Size, Checksum, FileID}` | `{SessionID, Have: []int}` (chunk indexes already present when resuming an existing session for the same FileID+Checksum) |
| `POST store/chunk?session=&index=` | raw bytes, header `X-Aroz-Chunk-Sha256` | `{Index, Received}`; 409 on hash mismatch |
| `POST store/commit` | `{SessionID}` | `{Checksum, Size}` after streaming SHA-256 of the assembled file equals `Checksum`; 409 otherwise (file deleted) |
| `POST store/abort` | `{SessionID}` | ok |
| `GET store/read?volume=&path=&offset=&length=` | length ≤ MaxChunkSize | raw bytes + `X-Aroz-Chunk-Sha256` + `X-Aroz-File-Size` |
| `GET store/stat?volume=&path=` | | `{Exists, IsDir, Size, ModTime}` |
| `POST store/mkdir`, `store/delete` (file or empty dir; `Recursive` flag), `store/rename` (same volume) | `{VolumeID, Path, NewPath, Recursive}` | ok |
| `GET store/list?volume=&path=` | | `[{Name, IsDir, Size, ModTime}]` (used by scan) |
| `POST store/checksum` | `{VolumeID, Path}` | `{Checksum}` streamed SHA-256 |

Implementation notes:
- Sessions live in a map guarded by a mutex; chunks are written with
  `WriteAt` into `<realPath>.part-<SessionID>`; on commit rename to the final
  path (`os.Rename` semantics through the local fsh: write `.part`, then
  `Rename`). Never leave partial files under the final name.
- A sweeper goroutine removes sessions and `.part` files older than
  `SessionTTL`.
- `read` must set `Content-Length`; compute the chunk hash while copying.
- Bodies are already buffered by the ACN verifier (`MaxSignedBody` 64 MiB), so
  reading `body []byte` from the handler signature is fine.
Tests: begin/chunk/commit round trip with a 10 MiB random file (3 chunks),
resume after dropping one chunk (`Have` lists the others), corrupt chunk →
409, wrong final checksum → 409 and no file left, read with offsets
reassembles the file bit-exactly, path escape (`../`) → 400.

### Task 4.3 – Transfer client
File: `storage/transfer_client.go`, tests in `transfer_test.go`.
```go
type Client struct{ Transport *acn.Transport }
func (c *Client) Upload(ctx, nodeID, volumeID, path string, fileID string, r io.Reader, size int64, checksum string, progress func(done int64)) error
func (c *Client) Download(ctx, nodeID, volumeID, path string, w io.Writer, expectChecksum string, progress func(done int64)) error
func (c *Client) Stat / Mkdir / Delete / Rename / List / Checksum (thin wrappers)
```
Upload: `begin` → for each chunk not in `Have`: read `ChunkSize` bytes,
sha256, send with up to 3 retries (new nonce each time – the transport signs
per request) → `commit`. Download: loop `read` with `offset += length`,
verify each chunk hash, feed a running SHA-256, compare with
`expectChecksum` at the end (return `ErrChecksumMismatch`). Both must abort on
`ctx.Done()`. Use `acn.Transport.Do` for raw bodies (set
`Content-Type: application/octet-stream`).

### Task 4.4 – The `clusterfs` abstraction
Files: `mod/filesystem/abstractions/clusterfs/clusterfs.go`, `clusterfs_test.go`.

Constructor:
```go
type Backend interface {           // implemented by mod/cluster/storage.Service
    Stat(logical string) (*metadata.FileRecord, error)
    List(logical string) ([]metadata.FileRecord, error)
    Mkdir(logical string, owner string) error
    Remove(logical string, recursive bool) error
    Rename(old, new string) error
    OpenRead(logical string) (io.ReadCloser, error)
    Write(logical string, r io.Reader, size int64, owner string) error
    Ready() bool
}
func New(uuid string, backend Backend) *ClusterFileSystem
```
Mapping of `FileSystemAbstraction` methods (mirror `webdavfs` for the
signature list):
- `Name()` → `"cluster"`; hierarchy is always `public`; `VirtualPathToRealPath`
  strips `cluster:` and returns the logical path (`/photos/a.jpg`);
  `RealPathToVirtualPath` prefixes `cluster:`.
- `Stat` → `Backend.Stat` → build an `os.FileInfo` (write a small
  `fileInfo` struct: Name = base, Size, Mode 0644 / 0755|ModeDir, ModTime).
- `ReadDir` → `Backend.List` → `[]fs.DirEntry` (write `dirEntry` wrapper).
- `ReadStream` → `Backend.OpenRead`; `WriteStream` → `Backend.Write` (size
  unknown → pass -1; the service buffers to a local temp file first to compute
  size and checksum, see 4.5).
- `ReadFile`/`WriteFile` via the stream methods. `Mkdir`/`MkdirAll` →
  `Backend.Mkdir` (MkdirAll creates parents from the top). `Remove` →
  non-recursive, `RemoveAll` → recursive. `Rename` → `Backend.Rename`.
- `Open`, `Create`, `OpenFile`, `Chmod`, `Chown`, `Chtimes` → return
  `errors.New("filesystem type not supported")` (same as webdavfs; the core
  uses buffered streams when `RequireBuffer` is true).
- `FileExists`/`IsDir`/`GetFileSize`/`GetModTime` from `Stat`.
- `Glob` → emulate exactly like `webdavfs.Glob` (depth-limited `ReadDir`).
- `Walk` → recursive `List` calling `filepath.WalkFunc`.
- `Heartbeat` → `nil` when `Backend.Ready()`, else an error (the core
  reconnect loop in `storage.go` will otherwise try to rebuild the handler;
  make `Ready()` true whenever the node is in a cluster).
- `Close` → nil.
Tests use a fake `Backend` (map-based) and assert every method, including
path normalisation (`cluster:/a/../b` → `/b`, Windows backslashes → `/`).

### Task 4.5 – The storage service (placement, reads, writes)
File: `storage/service.go`, `storage/service_test.go`.

```go
type Service struct {
    m       *membership.Manager
    meta    *metadata.Manager
    client  *Client
    tmpDir  string          // *tmp_directory from flags, use a "cluster" subfolder
    volumes func() []metadata.Volume // from metadata
}
```
- **Stat/List** read the metadata store only (never the network).
- **Mkdir**: create the `FileRecord{IsDir:true}` and its missing parents
  (`Submit`); no physical directory is made until a file is written under it.
- **Write** (the important one):
  1. Refuse when not in a cluster or when no volume exists (error text: "no
     cluster volume available; add one in System Settings > Cluster").
  2. Spool the reader to `tmpDir/<uuid>.spool` while hashing (SHA-256) and
     counting bytes → `size`, `checksum`.
  3. Placement `pickVolume(size)`: candidates = volumes not Removed, not
     ReadOnly, owner node ONLINE/DEGRADED, `Free > size*1.1 + 64 MiB`. Prefer
     (a) a **local** volume, (b) the volume whose node currently holds the
     record's Primary (overwrite case), (c) the volume with most free space.
     If the leader is reachable ask it (`POST meta/place {Size, Path}`, the
     leader runs the same function over its view) so two nodes writing at
     once do not both pick the same nearly-full volume; if the leader is
     unreachable, decide locally.
  4. Create/refresh the record: `Locations=[{VolumeID, NodeID, State: writing}]`,
     `Primary = VolumeID`, `Size`, `Checksum`, `ModTime = now`, `Owner`;
     `Submit`. Parents that do not exist get directory records.
  5. Copy bytes: local volume → stream the spool to `realPath` via a `.part`
     rename; remote → `client.Upload(...)`. On failure set the location
     `failed`, delete the spool, return the error (the record stays with a
     failed location; a retry overwrites).
  6. Set the location `committed` (Checksum) and `Submit`; delete the spool;
     `events.Publish("file.created"|"file.updated")` (Phase 6; leave a hook
     `OnFileWritten func(rec)` for now).
- **OpenRead**: pick a location in order: local volume with State
  committed/verified → open the real file; else remote locations sorted by
  node state ONLINE first, then lowest measured latency (Phase 9; use the
  order of `NodeViews()` for now) → `io.Pipe` fed by `client.Download` in a
  goroutine, verifying the checksum from the record. If every location fails
  return `ErrNoHealthyCopy`.
- **Remove**: mark the record (and children when recursive) as tombstones
  via `Submit`, then delete the physical copies on every location (local
  directly, remote via `client.Delete`); failures are logged and the
  location marked `stale` so the reconcile job (4.7) cleans up later.
- **Rename**: metadata first (path index moves, ID unchanged), then physical
  renames on each location's volume; on physical failure mark that location
  `stale` and let replication (Phase 5) restore a copy under the new name.
  Renaming a directory renames every record beneath it (batch `Submit`).
Tests with the fake transport from `identity_test.go` style plus real
managers: write on A lands on A's volume; write on B when only A has a volume
uploads to A and is readable from B; rename keeps the ID; remove leaves a
tombstone and deletes the physical file; read of a record whose only location
is on an OFFLINE node returns `ErrNoHealthyCopy`.

### Task 4.6 – Mount the drive
Files: `src/cluster.go`, `src/storage.go`, `mod/filesystem/arozfs/arozfs.go`,
`mod/filesystem/config.go`.
1. Add `"cluster"` to `arozfs.GetSupportedFileSystemTypes()` and to
   `IsNetworkDrive`; add `"cluster"` to the reserved UUID list in
   `filesystem.ValidateOption`.
2. In `cluster.go`, function `clusterMountDrive()`: when
   `clusterManager.InCluster()` and no handler with UUID `cluster` is in
   `baseStoragePool`, build
   `&fs.FileSystemHandler{Name: "Cluster", UUID: "cluster", Path: "cluster:/", Hierarchy: "public", RequireBuffer: true, Filesystem: "cluster", FileSystemAbstraction: clusterfs.New("cluster", clusterStorage), InitiationTime: now, RuntimePersistenceConfig: {LocalBufferPath: *tmp_directory}}`
   and `baseStoragePool.AttachFsHandler`. `clusterUnmountDrive()` detaches
   it. Call mount at boot (after `StorageInit` and `ClusterInit`) and from
   `OnClusterChange`/after join; call unmount from leave/evict (add a
   `membership.Manager.OnMembershipChange func(inCluster bool)` callback
   fired by `CreateCluster`, `JoinCluster`, `LeaveCluster`, `wipeLocalState`).
3. Users see it immediately because `User.HomeDirectories` points at the
   same pool object. Check `system_fs_listDrives` output in the File Manager.
4. Uploads through the web UI go via `RequireBuffer` paths in
   `file_system.go` (buffer to local temp, then `WriteStream`); nothing to
   change there, but test a 20 MB upload and a download from the other node.
Acceptance (live): upload a photo on node A into `cluster:/photos`, open
Photo on node B and view it; delete it on B, gone on A.

### Task 4.7 – Scan and reconcile
File: `storage/reconcile.go`, tests.
Runs on each node for **its own volumes** every 30 min and on demand
(`POST /system/cluster/storage/rescan`):
1. Walk the volume folder (skip `.part-*`). For each file: find the record by
   logical path (`vol` root = `/`); if none → create a record with a single
   `committed` location on this volume (this is how pre-existing files in a
   contributed folder join the namespace, and how a rebuilt metadata store
   recovers). If the record exists but has no location on this volume → add
   one as `committed` after checksumming. If the size differs from the
   record → checksum; if it differs from the record's checksum, mark this
   location `stale` (the newer mtime wins only if the record's own
   location list has no verified copy; otherwise the stale copy is repaired
   by Phase 5).
2. For each record location on this volume whose file is missing → mark
   `stale`.
3. Delete orphaned `.part-*` older than `SessionTTL`.
Never delete real files during reconcile.

---

## Phase 5 – Replication

**Goal.** Every file has the number of verified copies its folder policy asks
for, on different nodes; copies are checksum verified; a dead node's files are
still readable; an admin can move a volume's content elsewhere.

Package: `src/mod/cluster/replication`. Runs **only on the leader**
(`clusterMetadata.IsLeader()`); every node executes the transfer work it is
told to do.

### Task 5.1 – Planner
`replication/planner.go` + tests. Every 60 s on the leader:
1. For each non-tombstone file record (skip dirs, skip `Size == 0`):
   `want = rec.Replicas || policyFor(rec.Path).Replicas`;
   `have = count(locations with State in {committed, verified} on nodes
   that are ONLINE/DEGRADED and volumes not Removed)`.
2. If `have < want`: choose a target volume: not on a node that already has a
   copy, owner ONLINE, `Free > size*1.1`, most free space; skip if none.
   Create `Task{ID, FileID, Path, SourceNode, SourceVolume, TargetNode,
   TargetVolume, Checksum, State: queued, Attempts, LeaseExpires}` in table
   `repl_tasks` (registered cluster table) and send
   `POST /cluster/acn/repl/pull {Task}` to the target node.
3. If `have > want` (policy lowered) and every extra copy is verified:
   delete the copy on the volume with the least free space (`client.Delete`
   + remove the location). Never go below 1 verified copy.
4. Limit: at most 4 tasks in flight per target node, 16 in total.
Unit test the planner with an in-memory metadata store: under-replicated
file gets exactly one task; over-replicated file loses the right copy; no
task when no eligible volume.

### Task 5.2 – Worker
`replication/worker.go` + tests. On the target node, `pull`:
1. Set a location `{TargetVolume, State: writing}` on the record (`Submit`).
2. `client.Download` from `SourceNode/SourceVolume` into `realPath + .part`,
   verifying the checksum; rename into place.
3. Set the location `verified` with the checksum; `Submit`; answer the leader
   with `POST /cluster/acn/repl/done {TaskID, OK, Error}`.
4. Renew the task lease every 10 s (`POST repl/lease`); the leader re-queues
   tasks whose lease expired (`Attempts++`, give up after 5 and log).
Test with 3 real managers: policy 2 on `/docs`, write a file on A, within
10 s (use short intervals in tests via `Option.PlanInterval`) it has a
verified copy on B or C; stop B's server, wait, the file stays readable from
C; corrupt B's copy on disk and force a verify (5.3) → location stale → a
new copy is made.

### Task 5.3 – Verification and failover
`replication/verify.go`. Nightly (`nightlyManager.RegisterNightlyTask`) each
node re-checksums up to 1 GB of its own copies (oldest verified first) and
downgrades mismatches to `stale`; the planner then repairs them. The leader
marks every location on a node that has been OFFLINE for more than 10 min as
`stale` (it does not delete); when the node is back and reconcile (4.7)
confirms the files, the locations return to `committed` → verify → `verified`.
Reads (4.5) already skip `stale`.

### Task 5.4 – Migration / evacuation
Admin action `POST /system/cluster/storage/volume/evacuate?id=` on the owner
node: sets `Volume.ReadOnly = true`, then for every record with a location on
that volume with fewer verified copies elsewhere than `want`, creates a
replication task to another node with `Priority` high; when every file has
another verified copy, deletes local copies and marks the volume `Removed`.
Progress endpoint `volume/evacuate/status?id=`. UI: "Evacuate" button with a
progress bar; "Remove" is only allowed when the volume holds no sole copies
(otherwise the UI offers Evacuate).

### Task 5.5 – UI
Cluster page "Replication" card: policies (from 3.6) with replica counts,
counters (under-replicated, in flight, stale), a "Repair now" button (runs
the planner once), and a per-file inspector `stat?path=` showing locations
with state badges (reuse `cl-badge` classes: verified=ONLINE, writing=
DEGRADED, stale=OFFLINE).

---

## Phase 6 – AGI `cluster` library and the event bus (AEB)

### Task 6.1 – Event bus
Package `src/mod/cluster/events`.
```go
type Event struct {
    ID     string          `json:"id"`     // uuid, used for de-duplication
    Type   string          `json:"type"`   // "file.created" "file.updated" "file.removed" "file.renamed"
                                          // "node.online" "node.offline" "node.joined" "node.left"
                                          // "replica.verified" "replica.stale" "job.completed" "job.failed"
    Node   string          `json:"node"`   // origin node
    Path   string          `json:"path,omitempty"`
    FileID string          `json:"fileId,omitempty"`
    User   string          `json:"user,omitempty"`
    Time   int64           `json:"time"`
    Data   json.RawMessage `json:"data,omitempty"`
}
type Bus struct{ ... }
func (b *Bus) Publish(e Event)                       // local subscribers + fan-out to peers
func (b *Bus) Subscribe(types []string, fn func(Event)) (unsubscribe func())
```
- Fan-out: `POST /cluster/acn/events/publish {Events: [...]}` to every
  ONLINE peer, batched every 200 ms, fire-and-forget, retried once. Receivers
  drop IDs seen in the last 10 min (ring buffer + map).
- Node events come from membership: add `membership.Manager.OnNodeState
  func(nodeID string, old, new NodeState)` fired from a 5 s ticker that
  compares computed states with the previous tick.
- File events come from `storage.Service` (`OnFileWritten`, removed, renamed
  hooks) and replication (`replica.*`).
- Web clients: `GET /system/cluster/events/ws` (admin router with
  `AdminOnly: false`, module "System Setting") upgrades to a WebSocket and
  streams JSON events; optional `?types=file.created,file.removed`. Use
  `gorilla/websocket` like `src/cast.go`; ping every 30 s.
- AGI script hooks: table `event_hooks` (registered cluster table) keyed by
  uuid → `{Owner, Types, ScriptVpath, FshUUID}`. On each event, for each
  matching hook run the script with `AGIGateway.ExecuteAGIScriptAsUser`
  after setting a global `EVENT` (JSON string) – add an `injectEventGlobal`
  helper in `mod/agi` that the runner calls before execution (do this by
  writing the event to the request context: create a fake
  `*http.Request` with a body containing the event and have the script read
  it with the existing `POST` helpers; simplest: pass the event as POST field
  `event`). Run at most 4 hooks concurrently; log failures.
Tests: local publish/subscribe with type filter, de-dup of the same ID, fan-out
between two managers reaches the other side's subscriber.

### Task 6.2 – AGI library `cluster`
File `mod/agi/agi.cluster.go` (+ `agi.cluster_test.go` for pure helpers),
registered in `LoadAllFunctionalModules` only when `g.Option.ClusterProvider
!= nil` (add that field to `AgiSysInfo`; the core passes an adapter struct
built in `src/agi.go`).

Functions (all return plain JSON-able values; errors become JS exceptions via
`vm.MakeCustomError`):
```
requirelib("cluster");
cluster.inCluster()               -> bool
cluster.self()                    -> {id, name, state, capabilities}
cluster.nodes()                   -> [ {id, name, state, os, arch, cores, ram, features:[...], local:true} ]
cluster.status()                  -> {cluster:{id,name}, leader, identityOrigin, volumes:[...]}
cluster.stat("cluster:/photos/a.jpg")     -> {path, isDir, size, modTime, checksum, replicas, locations:[{node, volume, state}]}
cluster.list("cluster:/photos")           -> [stat-like objects]
cluster.setReplicas("cluster:/photos/a.jpg", 2)   // admin only, per file
cluster.policy("/photos", 2)                       // admin only, per folder
cluster.on("file.created", "cluster:/apps/indexer/hook.agi")   -> hookId   (owner = current user)
cluster.off(hookId)
cluster.hooks()                   -> [ {id, types, script} ]
cluster.emit("app.custom", {any json})          // Type is prefixed "app." if missing
```
Permission: `stat/list` check `u.CanRead(vpath)`; `setReplicas/policy` require
`u.IsAdmin()`. Path arguments accept `cluster:/...` or `/...`. Reuse
`static.RelativeVpathRewrite` like `agi.file.go`. Document every function in
`mod/agi/README.md` **and** add the section to
`src/web/Terminal/docs/api.json` (see the README maintainer note).

Ordinary file access does **not** need this library: `filelib` already works
on `cluster:/` paths through the mounted drive.

---

## Phase 7 – Job runtime (AJR) and scheduler (AJS)

**Goal.** `agi.Compute.Run(job)` from the design: an application submits a
job; the cluster picks a node that satisfies the job's requirements and holds
the input data; the node runs the job as the submitting user; results are
readable from anywhere. Jobs are **AGI scripts** (JavaScript), the only
portable payload across heterogeneous nodes.

Package `src/mod/cluster/jobs`. Tables (registered): `jobs_spec`, `jobs_state`.
Leader-only scheduling loop; execution anywhere.

### Task 7.1 – Job model
```go
type Spec struct {
    ID           string                  `json:"id"`
    Name         string                  `json:"name"`
    Owner        string                  `json:"owner"`        // username; the job runs with this user's permissions on the executing node
    Script       string                  `json:"script"`       // full JS source captured at submit time (nodes may not share the source path)
    ScriptName   string                  `json:"scriptName"`   // for logs, e.g. "transcode.agi"
    Args         json.RawMessage         `json:"args"`
    Inputs       []string                `json:"inputs"`       // cluster:/ paths used for locality scoring
    Requirements capability.Requirements `json:"requirements"`
    Priority     int                     `json:"priority"`     // higher first, default 0
    TimeoutSec   int                     `json:"timeoutSec"`   // default 3600
    MaxAttempts  int                     `json:"maxAttempts"`  // default 3
    Kind         string                  `json:"kind"`         // "run" | "map" | "reduce" (Phase 8)
    ParentID     string                  `json:"parentId,omitempty"`
    Created      int64                   `json:"created"`
    Version      int64                   `json:"version"`
}
type State struct {
    ID           string `json:"id"`
    Status       string `json:"status"` // queued scheduled running succeeded failed cancelled
    Node         string `json:"node"`
    Attempts     int    `json:"attempts"`
    LeaseExpires int64  `json:"leaseExpires"`
    Progress     float64 `json:"progress"` // 0..1
    Output       json.RawMessage `json:"output,omitempty"`  // whatever the script returned via job.output()
    Log          []string `json:"log"`     // last 200 lines from job.log()
    Error        string `json:"error,omitempty"`
    Started, Finished int64
    Version      int64
}
```
Both are replicated through the metadata log (`Kind: "jobspec"`,
`"jobstate"`), so every node can answer status queries locally.

### Task 7.2 – Script contract (what job authors write)
A job script defines one of:
```js
// single-node job
function run(job) {           // job = {id, name, args, inputs, node}
    job.log("starting");      // appended to State.Log
    job.progress(0.5);        // 0..1
    var f = requirelib("filelib");  // normal AGI libraries work; paths like cluster:/... work
    return {ok: true, frames: 120}; // becomes State.Output (JSON)
}
```
The runtime executes the script source with the standard user scope, then
evaluates `run(JOB)` where `JOB` is the injected object. `job.log`,
`job.progress`, `job.output`, `job.abortIfCancelled()` are Go functions
injected as `_job_log` etc. and wrapped in a JS prelude the runtime prepends:
```js
var JOB = JSON.parse(_job_spec()); JOB.log=function(m){_job_log(String(m))}; JOB.progress=function(p){_job_progress(p)}; JOB.abortIfCancelled=function(){if(_job_cancelled()){throw new Error("cancelled")}};
```
and appends `_job_output(JSON.stringify(run(JOB)))`. Missing `run` → failed
with a clear error. A script may also define `setup(ctx)` (called once with
`{node, capabilities}` before `run`); optional.

### Task 7.3 – Execution on a node
`jobs/runner.go`. Endpoint `POST /cluster/acn/jobs/run {SpecID}` (leader →
node). The node:
1. Loads the spec from its replicated table (or asks the leader `GET
   jobs/spec?id=` if not yet replicated).
2. Resolves the owner with `userHandler.GetUserInfoFromUsername`; if the user
   does not exist on this node → answer `409 user-not-available` (the
   scheduler picks another node; Phase 2 replication makes this rare).
3. Runs in a goroutine: build the source = prelude + spec.Script + epilogue;
   call `AGIGateway.ExecuteAGIScript(source, nil /*fsh*/, spec.ScriptName, "", recorder, nil, user)`
   with a `httptest.ResponseRecorder`-like writer to capture `sendResp`
   output; apply `TimeoutSec` with `vm.Interrupt` (the AGI runtime already
   supports timeouts through the VM registry; add an option to
   `ExecuteAGIScript` if needed).
4. Sends `POST jobs/lease {ID}` to the leader every 10 s while running;
   `POST jobs/done {ID, OK, Output, Error, Log}` at the end.
5. At most `runtime.NumCPU()` jobs run concurrently per node; more are
   queued locally (report `Status: scheduled` until started).

### Task 7.4 – Scheduler (leader)
`jobs/scheduler.go`. Every 3 s on the leader:
1. Candidates = `NodeViews()` with State ONLINE or DEGRADED (not
   MAINTENANCE/DRAINING), `Capabilities.Satisfies(spec.Requirements)`.
2. Score each candidate (Phase 9 refines): `locality` = bytes of
   `spec.Inputs` that have a verified location on that node ÷ total input
   bytes (0 when no inputs); `load` = 1 − CPUUsage/100; `mem` = free RAM
   fraction; `running` = jobs currently assigned there.
   `score = 0.6*locality + 0.25*load + 0.15*mem − 0.1*running`; DEGRADED
   nodes ×0.5.
3. Assign the best node: state `scheduled`, `Node`, `LeaseExpires =
   now+30s`, `Attempts++`; `Submit`; send `jobs/run`. On send failure → back
   to `queued` immediately.
4. Jobs whose lease expired while `running`/`scheduled` → `queued` again
   (`Attempts` kept); if `Attempts >= MaxAttempts` → `failed` with
   "node lost". Emit `job.completed` / `job.failed` events.
5. Cancel: `POST /system/cluster/jobs/cancel?id=` marks the state
   `cancelled`; the running node polls `_job_cancelled()` from the state
   table and interrupts the VM.

### Task 7.5 – APIs and UI
- Admin/user router (`AdminOnly: false`, module "Tasks Scheduler"):
  `/system/cluster/jobs/submit` (POST JSON spec; `Owner` forced to the
  session user; `Script` read from `scriptVpath` on the submitting node),
  `list` (own jobs; admins see all), `status?id=`, `cancel?id=`,
  `output?id=`.
- AGI (`cluster` lib): `cluster.jobs.submit({name, script:"cluster:/x.agi", args, inputs, requirements})
  -> id`, `cluster.jobs.status(id)`, `cluster.jobs.cancel(id)`,
  `cluster.jobs.wait(id, timeoutSec)` (polls every second inside Go, not JS).
- UI: `src/web/SystemAO/cluster/jobs.html` (register as setting "Cluster
  Jobs", group "Cluster", RequireAdmin false): table of jobs with status
  badge, node, progress bar, duration; a detail panel with log and output;
  submit form (script path picker, args JSON, requirements checkboxes built
  from the union of node features).
Tests: 2 managers, submit a job whose script returns `{sum: args.a+args.b}`
→ `succeeded` with that output; requirement `features:["nonexistent"]` →
stays `queued` and the status explains "no eligible node"; kill the executing
node's server mid-job (script sleeps via `_job_sleep(ms)` helper you add for
tests) → rescheduled on the other node.

---

## Phase 8 – Map/Reduce

Build on Phase 7. Package `jobs/mapreduce.go`.

### Task 8.1 – Model
```go
type MapReduceSpec struct {
    Spec                  // Kind: "mapreduce"; Script holds BOTH mapper and reducer functions
    Dataset      string   `json:"dataset"`      // glob on cluster:/ e.g. "cluster:/photos/**/*.jpg"
    PartitionMax int      `json:"partitionMax"` // files per map task, default 50
    ReduceOn     string   `json:"reduceOn"`     // "" = leader picks
}
```
Script contract:
```js
function mapper(files, emit) {            // files = ["cluster:/photos/a.jpg", ...] all on THIS node when possible
    files.forEach(function(f){ emit(keyFor(f), 1); });
}
function reducer(key, values) { return values.length; }   // called once per key with all values
```
### Task 8.2 – Expansion and partitioning (leader)
1. Expand `Dataset` with a glob over metadata paths (support `*`, `**`,
   `?`; implement `metadata.Glob(pattern) []FileRecord`, tests included).
2. Group files by the node holding a verified copy (first choice: the node
   that holds most of the file's bytes; files with no online copy → fail the
   job with the list). Split each group into partitions of `PartitionMax`.
3. Create one child `Spec{Kind:"map", ParentID, Inputs: partition,
   Script: parent script, Requirements: parent requirements}` per partition;
   the scheduler's locality scoring then places them on the data.
4. Map prelude/epilogue: `var EMITTED=[]; function emit(k,v){EMITTED.push([k,v])}`
   … `mapper(JOB.inputs, emit); _job_output(JSON.stringify(EMITTED))`.
5. When all map children succeeded: gather outputs (they are in the
   replicated state table; cap each at 8 MiB, else write to
   `cluster:/.jobs/<id>/part-N.json` and pass paths), group by key, create
   one `reduce` child whose `Args` = `{groups: {key: [values]}}` (or the part
   paths), epilogue evaluates `reducer` per key and outputs `{key: result}`.
6. Parent `Output` = reducer output; parent `Progress` = done children ÷
   total. Any child failing after retries fails the parent with the child's
   error.
Tests: 3 nodes, 9 files spread over two nodes, mapper emits
`(extension, 1)`, reducer sums → parent output `{"jpg": 6, "png": 3}`;
assert every map job ran on a node holding its inputs (inspect
`State.Node` vs locations).

---

## Phase 9 – Intelligent scheduling and placement

### Task 9.1 – Network cost matrix
`membership`: extend `ProbeNode` results into a rolling average per peer
(`latency map[string]float64`, EWMA α=0.3) refreshed by the heartbeat loop
(measure heartbeat round trips; no extra traffic). Expose
`Manager.Latency(nodeID) (ms float64, known bool)`. Gossip is unnecessary:
each node only needs its own view.

### Task 9.2 – Scoring v2
Replace the Phase 7 formula with a pluggable `Scorer` interface and the
default:
```
score = w_loc*locality + w_cpu*(1-cpu) + w_mem*memFree + w_disk*diskFree
      - w_q*queueDepth - w_lat*(latencyToInputsMs/1000) - w_deg*(degraded?1:0)
```
Weights default `{0.45, 0.2, 0.1, 0.05, 0.1, 0.05, 0.05}` and are editable in
System Settings (table `sched_weights`, replicated as a metadata entry
`Kind: "schedweights"`). Add `capability` preference: a job may list
`Preferred []string` features (e.g. `cuda`) that add +0.1 when present
without being required.

### Task 9.3 – Placement v2 for writes and replicas
Use the same scorer for `pickVolume` (Phase 4.5) and the replication planner
(5.1): prefer the writer's node, then nodes with low latency to the writer,
then free space; keep at least `Free > size*1.1 + 64 MiB`. Spread replicas
across nodes with the largest pairwise latency (site diversity) when three
or more nodes exist.

### Task 9.4 – Health-aware behaviour
- DEGRADED nodes receive no new jobs or replicas unless no other node
  qualifies.
- Nodes in MAINTENANCE/DRAINING never receive work; DRAINING nodes have their
  running jobs finished and their replicas re-created elsewhere (reuse 5.4
  evacuation logic for all their volumes), then the admin can safely turn the
  node off.
- A node whose disk free falls under 5 % is treated as ReadOnly for
  placement and an event `node.diskfull` is emitted.

### Task 9.5 – Observability
Cluster page "Scheduling" card: weights editor, per-node score preview for a
sample requirement, current queue depths, latency matrix. Expose
`/system/cluster/sched/explain?job=<id>` returning the scored candidate list
so users can see why a node was chosen.

---

## Order of work and estimates

| Step | Tasks | Notes |
|---|---|---|
| 1 | 3.1, 3.2, 3.3 | pure storage code, fully unit-testable |
| 2 | 3.4, 3.5, 3.6 | first multi-node behaviour; verify live |
| 3 | 4.1, 4.2, 4.3 | transfer protocol; test with 10 MiB+ files |
| 4 | 4.4, 4.5, 4.6 | the drive appears; biggest user-visible milestone |
| 5 | 4.7, 5.1, 5.2, 5.3 | durability |
| 6 | 5.4, 5.5, 6.1, 6.2 | admin comfort + developer API |
| 7 | 7.1–7.5 | compute |
| 8 | 8.1, 8.2 | map/reduce |
| 9 | 9.1–9.5 | tuning |

Each numbered task is one pull request sized unit. Finish a task completely
(code, tests, README row, UI when applicable, live check) before starting the
next. When something in this file turns out to be impossible as written,
change the smallest thing necessary, document the deviation at the top of
the relevant section in this file, and keep going.
