# ArozOS Cluster

Several independent ArozOS installations expose **one logical computer
interface** (namespace, identity, compute) while keeping their own hardware,
OS and storage. Every node keeps working as a normal standalone ArozOS when
the cluster is unreachable.

This directory holds the cluster runtime. It is built in phases; the table at
the end lists what exists today.

## Packages

| Package | Role |
|---|---|
| `acn/` | **ArozOS Cluster Node protocol** – the node-to-node transport. Ed25519 node keys, signed HTTP requests with replay protection, direct / tunnel / relay routing, and the WebSocket reverse tunnel for NAT-only nodes. |
| `capability/` | Portable detection of what a node offers (OS, arch, cores, RAM, tools such as ffmpeg/docker/nvidia, CPU feature flags) plus `Requirements` matching for the scheduler, and a cross-platform `DiskUsage`. |
| `membership/` | The cluster agent: create / join / leave, replicated membership records, join tokens, heartbeats, health, node states, tunnel host selection, cluster-wide settings, and the admin (System Settings) endpoints. |
| `identity/` | **ArozOS Identity** – forward authentication to the cluster's identity origin, replicated account directory as fallback, password write-back, and signed user assertions for cross-node requests. |
| `metadata/` | **ArozOS Cluster Metadata Store** – replicated namespace index (file records, copies, volumes, folder policies), leader lease and replicated log with catch-up and snapshots. |
| `storage/` | **ArozOS Cluster Storage** – contributed volumes, chunked SHA-256 verified transfers, placement, reads/writes for the drive, reconcile of real files, and the copy primitives (pull, drop, verify, evacuate). The drive itself is `mod/filesystem/abstractions/clusterfs`. |
| `events/` | **ArozOS Event Bus** – publish/subscribe with cluster-wide fan-out and de-duplication, `node.*` events from membership, persistent AGI script hooks, and a WebSocket feed for web clients (`/system/cluster/events/ws`). The AGI `cluster` library lives in `mod/agi/agi.cluster.go`. |
| `jobs/` | **ArozOS Job Runtime and Scheduler** – replicated job records, a leader-side scheduler that matches node capabilities and input locality, per-node execution of AGI job scripts with progress, logs, leases, timeouts and cancellation. |
| `scheduling/` | **ArozOS Cluster Scheduling** – the one placement scorer used by jobs, write placement and replication. Cluster-wide tunable weights, per-factor explanations, node ranking with reasons. |
| `replication/` | Leader-side planner and per-node worker that keep every file at its policy's copy count, repair stale copies, mark offline nodes' copies stale and evacuate volumes. |
| `wakeonlan/` | Wake-on-LAN packets for offline LAN neighbours. |

Core wiring lives in [`src/cluster.go`](../../cluster.go); the ACN endpoints
are mounted in [`src/main.router.go`](../../main.router.go) under
`/cluster/acn/*` **before** the user-session check, because nodes authenticate
with signatures rather than cookies. `cluster` is a reserved subservice path.

Cluster state is stored in its own key-value database `system/cluster.db`,
never in `ao.db`; the node key is `system/cluster/node.key`.

## ACN – node-to-node protocol

Every ACN request carries:

```
X-Aroz-Node:      <sender node UUID>
X-Aroz-Cluster:   <cluster UUID>
X-Aroz-Timestamp: <unix seconds>
X-Aroz-Nonce:     <random hex>
X-Aroz-Signature: base64(Ed25519(METHOD \n target \n cluster \n node \n ts \n nonce \n sha256(body)))
```

The receiver resolves the sender in its membership list, checks the cluster
ID, a ±5 minute clock window, that the nonce is unseen, and the signature.
Only then is the nonce spent, so junk requests cannot poison the replay cache.

### Routing

`acn.Transport.Do(nodeID, method, path, body)` picks the route; callers never
deal with addresses:

1. **Tunnel** – the peer has a live tunnel terminating on this node.
2. **Direct** – the peer advertises a URL (behind Cloudflare is fine).
3. **Relay** – the peer is tunnelled to another node: the request is sent to
   `https://<via>/cluster/acn/relay/<peer>/cluster/acn/<path>` and that node
   forwards it over its tunnel. The signature is made over the *original*
   path, so both the relay and the final node verify the same signature.

### Reverse tunnel

A node without a public URL opens one WebSocket to a reachable member
(`GET /cluster/acn/tunnel`, signed). Requests to it are multiplexed as binary
frames `[kind][hdr len][header JSON][body]`, executed against the node's own
ACN handler and answered on the same socket. Both ends ping every 30 s so
Cloudflare's 100 s idle limit never trips; the client reconnects with backoff
and re-picks a host (the admin's preferred one, otherwise the healthiest
reachable member).

Frames are capped at 16 MB, which keeps future file transfers at 4 MB chunks
well under Cloudflare's 100 MB request limit.

### Built-in endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /cluster/acn/hello` | none | reachability probe (`{"acn":true,...}`) |
| `POST /cluster/acn/ping` | signed | round-trip check |
| `GET /cluster/acn/tunnel` | signed | tunnel upgrade |
| `* /cluster/acn/relay/{node}/...` | signed | forward to a tunnelled node |
| `POST /cluster/acn/join` | join token | add a node |
| `POST /cluster/acn/heartbeat` | signed | liveness + membership exchange |
| `GET /cluster/acn/members` | signed | full membership dump |
| `POST /cluster/acn/members/sync` | signed | push membership changes |
| `POST /cluster/acn/leave` | signed | sender leaves |
| `POST /cluster/acn/evict` | signed | sender removed the receiver |
| `GET /cluster/acn/latency` | signed | sender's round trips to its own peers |

## Membership

Each node owns one `NodeRecord` (ID, name, public key, advertised URL, tunnel
host, version, capabilities, admin state) with an `Updated` version stamp.
Records travel with every heartbeat and are merged **last-writer-wins** per
record, so membership converges without a master. A node is authoritative for
its own record; other members may only change its admin state or remove it.
Removed nodes stay as tombstones for 7 days so the removal propagates.

Liveness is computed, not gossiped:

| State | Meaning |
|---|---|
| `ONLINE` | heard from within 45 s |
| `DEGRADED` | online but CPU/RAM ≥ 97 % or disk ≤ 2 % free |
| `UNKNOWN` | silent for 45 s – 3 min |
| `OFFLINE` | silent for more than 3 min |
| `MAINTENANCE` / `DRAINING` | set by an admin, overrides the above |

Heartbeats go to every peer every 15 s (full mesh; clusters are small). A
NAT-only node is still seen as online by everyone because its tunnel host
learns its `LastSeen` and gossips it.

### Joining

1. On a member **with an advertised URL**, generate a join token in
   System Settings › Cluster. The token (`aroz-join:<base64 JSON>`) embeds the
   cluster ID, the issuing node's URL and a secret whose SHA-256 is stored.
2. Paste it on the new node. It POSTs its record to the issuer's `/join`,
   receives the cluster info and member list, and starts heartbeating. If it
   has no URL it immediately tunnels to the issuer.
3. The issuer pushes the new member list to everyone else.

## Identity (AID)

Package `identity/`. One member can be made the **identity origin** (the
SSO owner) in System Settings › Cluster › Identity; the choice is a
cluster-wide setting replicated by gossip (`ClusterInfo.IdentityOrigin`,
last-writer-wins on `SettingsVersion`).

On every other member the auth agent's `ForwardAuth` hook runs before the
local password table:

1. **Forward auth** – the member sends the username and the SHA-512 hash of
   the typed password to the origin (`POST /cluster/acn/auth/verify`, signed).
   The origin compares hashes in constant time and answers with the user's
   group names. Never the clear-text password.
2. **Mirror** – on success the member creates or updates the account locally
   (hash + the groups that exist on that node, matched by name) and opens a
   normal local session. Group settings stay node-specific, so create the
   same permission groups on every node.
3. **Fallback** – if the origin is *unreachable* the hook has no opinion and
   the local table decides, which works because members pull the origin's
   account directory (`GET /cluster/acn/auth/directory`) at boot, every 5
   minutes and whenever the origin setting changes. If the origin is
   reachable and says "wrong password", the login is rejected (no fallback).
4. **Write-back** – password changes of mirrored accounts on a member are
   forwarded to the origin (`POST /cluster/acn/auth/setpassword`) so the next
   sync does not revert them.

Rules: only accounts the member mirrored are ever touched; a pre-existing
local account with the same name is left as is (listed as "local only").
Accounts whose groups do not exist on the member are skipped and listed.
The origin itself always authenticates locally.

**Signed user assertions** (`identity.Assertion`) let node A act on node B
for a logged-in user: `Issue(username)` produces
`base64url(payload).base64url(Ed25519 signature)`, carried in the
`X-Aroz-User` header, and `Verify` checks it against the issuer's published
node key from the membership list, with a 5 minute lifetime. No node needs to
contact the origin to trust a cross-node request.

Admin API: `/system/cluster/identity/{status,origin,sync}`.

Note: the directory carries password hashes, so put node URLs behind HTTPS
(Cloudflare or your own certificates) in production.

## Metadata store (ACMS)

Package `metadata/`. The replicated index of the namespace: `FileRecord`
(logical path, size, checksum, owner, copies as `Location`s with a state),
`Volume` (a folder a node contributes) and `Policy` (replica count per
top-level folder). Records carry a `Version` from `membership.NextVersion`
and merge last-writer-wins on every node, so the store converges without a
master and can always be rebuilt from the real files (storage reconcile).

- **Leader lease** (`lease.go`): the eligible member that joined first
  (ties by ID) claims a 30 s lease with a higher term when no live lease
  exists and renews it every 10 s; every member accepts a lease with a
  higher term. No quorum, so two-node clusters fail over. `IsLeader()` /
  `Leader()` are what other services use to serialise decisions (placement,
  replication, scheduling).
- **Replicated log** (`log.go`): `Submit(kind, record)` applies locally at
  once, then the leader assigns a sequence number and pushes the entry to
  online peers (`meta/append`). Followers submit through the leader
  (`meta/submit`) or queue in `meta_pending` until one is reachable. Gaps
  are filled by `meta/log?after=N`; a compacted range or a new term triggers
  a full `meta/snapshot`. Only one goroutine drains the pending queue at a
  time; other callers ask it for another round.
- **Persistence** (`persist.go`): the store serves everything from memory
  and writes its disk copy behind. A change updates memory under the store
  lock and queues its disk write; queued writes are coalesced per key and
  committed in one `database.WriteBatch` transaction every 50 ms, and
  `Close` commits the rest. No disk sync ever happens under the store lock,
  and the lease has its own lock, so a burst of writes cannot starve lease
  renewal. A crash loses at most the last flush interval of this node's disk
  copy, which catch-up or a snapshot restores like any other gap. Reading
  the log back (`meta/log`, compaction) flushes first.
- Tables (`meta_*`) are registered with `membership.RegisterClusterTable`
  and wiped when the node leaves; the old store's queued writes are dropped
  then, so they cannot bring wiped records back.

Admin API: `/system/cluster/meta/{status,ls,stat,policy/list,policy/set}`.

## Storage (ACS) and the `cluster:/` drive

Package `storage/` plus the file-system backend
`mod/filesystem/abstractions/clusterfs`. When a node is in a cluster **and
the cluster has at least one volume**, the core mounts a `Cluster` drive
(`cluster:/`, public hierarchy, buffered) into the base storage pool, so File
Manager, WebDAV, media serving and the AGI `filelib` use it like any other
drive. Without a cluster or without a volume the drive is unmounted, so it is
missing from File Manager and from everything that walks the mounted drives
(nightly tasks included). `clusterSyncDrive` in `src/cluster.go` re-checks on
every membership change and every volume record change.

- **Volumes**: an admin contributes a folder of a local drive
  (`storage/volume/add`, e.g. `user:/cluster`). Files in the namespace are
  ordinary files inside those folders; a rescan (`storage/rescan`, also
  every 30 min) adopts files placed there by other means and flags copies
  that vanished or changed as `stale`.
- **Writes** spool locally while hashing, ask the leader for placement
  (local volume first, then the existing primary, then most free space),
  copy the bytes (local rename-in-place or a chunked upload), and only then
  publish the record: the namespace never shows a half-written file.
- **Reads** open a local copy when there is one, otherwise stream from an
  online node through the chunked protocol while verifying the checksum.
- **Chunked transfer** (`store/begin`, `store/chunk`, `store/commit`,
  `store/read`, …): 4 MiB signed requests with per-chunk SHA-256 and a
  whole-file SHA-256 at commit, resumable, `.part-<session>` files renamed
  into place, sized for Cloudflare's request limits.

- **Nearly full volumes**: below 5 % free a volume goes read only
  (`LowSpace`) and stops taking new files, and it recovers above 7 %. The
  cluster-wide setting `storage.autoReadOnly` (Cluster Settings > Storage)
  turns this off; volumes the guard had locked become writable again at
  each node's next volume refresh (within a minute). Read only set by an
  admin is never touched.
- **Nightly maintenance**: every member sees the same files on `cluster:/`,
  so a nightly pass that walks it from each node deletes the same expired
  trash and the same old version history once per node. Work on a drive
  shared by the cluster is therefore left to the **master node**, the
  holder of the metadata leader lease: `nightly.TaskOption{MasterNodeOnly:
  true}` marks it, `nightlyShouldMaintainFsh` in `src/cluster.go` answers it
  per file system handler, and a host outside a cluster is its own master so
  nothing changes for a single node. Each node still maintains its own local
  drives every night.
- **Where a file is**: the abstraction implements
  `arozfs.StorageInfoProvider`, so the File Manager properties dialog gains a
  Cluster tab listing the copies of the file with the node and volume holding
  each one, its state, the replica policy and the checksum
  (`/system/file_system/getStorageInfo` → `src/cluster.fsinfo.go`). The shape
  is generic: any abstraction that can explain where its files live gets the
  same tab.

Admin API: `/system/cluster/storage/{status,volume/add,volume/remove,volume/readonly,rescan,autoreadonly}`.

## Replication

Package `replication/`. Keeps every file at the copy count its folder policy
(or the record's own `Replicas`) asks for, on different nodes.

- **Planner** runs on the metadata leader every 60 s (and on demand). Per
  file: fewer healthy copies than wanted → one pull task to a node without a
  copy (an existing stale copy is repaired in place); more than wanted → the
  copy on the fullest non-primary volume is dropped; copies on an
  *evacuating* volume are re-created elsewhere and then dropped; healthy
  copies on a node that has been OFFLINE for more than 10 minutes are marked
  `stale` (never deleted; reconcile restores them when the node returns).
  Limits: 4 tasks in flight per node, 16 in total; failed files back off
  exponentially and give up for an hour after 5 attempts.
- **Worker** on the target node pulls the bytes with the chunked protocol
  (`storage.Service.PullCopy`), verifies the checksum, publishes a
  `verified` location and reports to the leader, renewing a 30 s task lease
  every 10 s. Tasks are ephemeral: a new leader simply plans again.
- **Verification**: a nightly pass re-checksums up to 1 GB of this node's
  copies (least recently checked first) and downgrades mismatches to
  `stale`; `Verify this node` runs it on demand.
- **Evacuation**: `storage/volume/evacuate` marks a volume read only, the
  planner moves everything off it, and the volume is retired when nothing
  references it. `Remove` refuses volumes that hold the only copy of a file.

Endpoints: signed `repl/{pull,lease,done,plan}`; admin
`/system/cluster/repl/{status,plan,verify}` and
`/system/cluster/storage/volume/evacuate{,/cancel,/status}`.

## Jobs (AJR / AJS)

Package `jobs/`. A job is an AGI script that defines `run(job)`; the source is
captured at submit time, so nodes of different OS and architecture can run it.
Each job is one replicated record (`metadata.KindJob`), so any node answers
status queries locally and a new leader resumes scheduling.

- **Scheduling** runs on the metadata leader every 3 s. Candidates are nodes
  that are ONLINE or DEGRADED and whose capability manifest satisfies the
  job's requirements; they are ranked by the shared scorer in `scheduling/`
  (see [Scheduling](#scheduling)), whose locality input is the share of the
  job's input bytes that already have a healthy copy on that node. A node that
  refuses a job (no account for the owner, cannot execute) is remembered and
  not offered it again. `jobs.Explain(id)` re-runs the ranking for a finished
  or waiting job and returns every candidate with its factors.
- **Pinning**: a job may carry `Nodes`, a list of node ids it is allowed to
  run on (AGI `nodes`, HTTP form field `nodes`). Other nodes are ineligible
  with the reason "job is limited to other nodes", and map and reduce children
  inherit the list. Sending one pinned job per member is how a script runs
  something on every node; see `examples/clusters_jobs/hello_world`.
- **Execution**: the chosen node wraps the script with a prelude that provides
  `job.log()`, `job.progress()`, `job.cancelled()` and `job.abortIfCancelled()`,
  runs it as the owner through the AGI gateway, and publishes the return value
  as the job output. At most `NumCPU()` jobs run per node; the rest wait.
- **Dispatch once**: scheduling passes are serialised, so two passes never
  both see a job as queued and hand it out twice, and a node accepts each
  job once even if a hand-over is repeated. A node that answers a hand-over
  with a temporary error (a tunnel still connecting after a restart, not
  yet knowing the leader) is retried; only "the owner has no account here"
  or "this node cannot run jobs" keeps it away from that job for good.
- **Leases**: a running node refreshes the job lease every 10 s. If it goes
  silent the leader requeues the job, and fails it after `MaxAttempts`.
  Cancellation marks the record; the running node interrupts its VM.
- Finished records are kept for 72 hours; `job.completed` and `job.failed`
  events are published on the event bus.

### Map / reduce

A job with a `Dataset` glob becomes a map/reduce parent, coordinated by the
leader and never assigned to a node. The leader expands the glob over the
namespace (`metadata.Glob`, supporting `*`, `**` and `?`), groups the files by
the node that already holds a healthy copy, splits each group into partitions
of `PartitionMax` files (default 50) and submits one map child per partition,
so map work runs where the bytes are. When every map child has succeeded the
emitted pairs are grouped by key and a single reduce child is submitted; its
output becomes the parent's. A failed child fails the parent and cancels the
rest. A dataset with an unreachable file fails the job and names it; a dataset
matching nothing succeeds with an empty result.

APIs: signed `jobs/{run,done,submit}`; user-facing
`/system/cluster/jobs/{submit,status,get,cancel}` (own jobs; admins see all);
AGI `cluster.jobs.*`. UI: `web/SystemAO/cluster/jobs.html` ("Cluster Jobs" in
System Settings).

## Scheduling

Package `scheduling/`. Three layers have to answer the same question – the job
scheduler, write placement in `storage/` and the replication planner – so they
all call one scorer. Every candidate is scored in the range 0 to 1:

| Factor | Default weight | Measured as |
|---|---|---|
| data locality | 0.45 | share of the input bytes already on the node |
| free CPU | 0.20 | `1 - cpuUsage` from the node's health report |
| free memory | 0.10 | `1 - ramUsed/ramTotal` |
| free disk | 0.05 | largest free fraction among the node's volumes |
| queue depth | 0.10 | penalty, saturating at 8 queued items |
| network distance | 0.05 | penalty, from the heartbeat round trip, saturating at 1000 ms |
| health | 0.05 | penalty when the node is DEGRADED |
| wanted features | 0.10 | optional capabilities a job prefers but does not require |
| site diversity | 0.05 | how far a new copy would sit from the copies that already exist |

The weights are a replicated cluster setting (`metadata.KindSetting`, key
`scheduling.weights`), so every node scores identically and a new leader keeps
the admin's tuning. Each weight is between 0 and 1; `reset=true` restores the
shipped defaults.

`Rank` also decides eligibility. A caller supplies the hard rule (capability
match, usable state, a volume with room), and the scorer holds DEGRADED nodes
back whenever a healthy eligible node exists, sorts ineligible nodes last and
keeps their reason, so `Best` can explain an empty result instead of failing
silently. Every score carries its `Factors`, which is what the admin page and
`sched/explain` show.

Round-trip latency is measured by `membership` on every heartbeat and smoothed
with an exponential moving average (alpha 0.3); the local node reports 0 and a
peer never heard from reports -1.

**Site diversity.** A second copy is worth more on a node far from the first,
because distance usually means a different site. Each node only measures its
own round trips, and those vectors are not gossiped: they change constantly and
would churn the membership records. Instead the replication planner asks the
members for their vector over the signed `GET /cluster/acn/latency` endpoint and
caches the resulting matrix for two minutes (`membership.LatencyMatrix`,
`membership.PairLatency`). A candidate's diversity is its distance to the
*nearest* node that already holds the file, as a fraction of one second. It is
only computed when the cluster has three or more nodes and there is more than
one place the copy could go; otherwise the factor is left out of the score
entirely, which is also what jobs and plain writes do.

Two guards use the same data. `storage` marks a volume read-only and
`LowSpace` once it drops below 5 % free, publishes a `node.diskfull` event and
clears the flag again at 7 %, so a filling node stops taking writes before it
breaks. Nodes an admin set to DRAINING keep serving reads but take no new
copies, and the replication planner moves their copies away like an evacuating
volume.

Endpoints: `/system/cluster/sched/status` (weights, a per-node score preview
and the latency matrix), `sched/weights` (GET / POST, any subset of the fields
or `reset=true`) and `sched/explain?job=<id>`. UI: the Scheduling card on the
Cluster Settings page (weight sliders) and the Cluster Info page (score
preview, latency matrix and the explain box).

Weights are read back through the defaults, so a record written by an older
version keeps the shipped value for a weight it never knew about.

## Admin API (`/system/cluster/*`, admin only)

`status`, `create`, `join`, `leave`, `config`, `testurl`, `token/new`,
`token/list`, `token/revoke`, `node/remove`, `node/state`, `node/probe`,
`nodes`, `capabilities`, `sched/{status,weights,explain}`.

The UI is three System Settings tabs in the Cluster group:

| Tab | Page | What it holds |
|---|---|---|
| Cluster Settings | [`cluster.html`](../../web/SystemAO/cluster/cluster.html) | this node's name and URL, create / join / leave, join tokens, identity origin, volumes and the nearly-full toggle, replica policies, member maintenance and draining, scheduling weights |
| Cluster Info | [`clusterinfo.html`](../../web/SystemAO/cluster/clusterinfo.html) | this node's reachability, platform and health, the cluster summary and namespace state, the node table with probes, replication health and tools, scheduling scores, the latency matrix and the job explainer |
| Cluster Jobs | [`jobs.html`](../../web/SystemAO/cluster/jobs.html) | submit, follow and cancel jobs |

They share `cluster.css` and `cluster.common.js`. Every string is localized
through [`web/SystemAO/locale/cluster.json`](../../web/SystemAO/locale/cluster.json)
(en-us, zh-tw, zh-hk, zh-cn, ja-jp, ko-kr): static labels carry a `locale`
attribute, scripts call `CL.t(key, fallback)`, and messages that come back
from the server go through `CL.tr(message)`, which matches `msg/<text>`
entries exactly and `msgp/<template>` entries with `{0}`-style parts (each
part translated again). When you add a server message that reaches these
pages, add it to the locale file too; untranslated messages simply stay in
English.

Start ArozOS with `-disable_cluster` to leave the whole feature off: no
cluster agent, no `cluster:/` drive, no cluster tabs, and `/cluster/acn/*`
answers 404.

## Roadmap

The detailed, task-by-task work order for everything still open is in
[TASKS.md](TASKS.md). Read it before touching Phases 3 to 9.

| Phase | Status |
|---|---|
| 1 Membership (keys, ACN, tunnel/relay, join/leave, heartbeat, capabilities, health, settings UI) | done |
| 2 Identity (forward-auth to an origin node, replicated accounts as fallback, signed user assertions) | done |
| 3 Metadata store (leader lease + replicated log, file records, locations, checksums) | done |
| 4 Unified namespace (`cluster:/` file system abstraction, volumes, chunked transfer, reconcile) | done |
| 5 Replication (planner, worker, verification, offline stale marking, evacuation) | done |
| 6 AGI `cluster` library and event bus (file / replica / node events, script hooks, WebSocket feed) | done |
| 7 Job runtime and scheduler (AGI job scripts, capability + locality scheduling, leases, cancellation, UI) | done |
| 8 Map/reduce (dataset globbing, locality partitioning, map and reduce children) | done |
| 9 Intelligent scheduling (shared weighted scorer, latency tracking, site diversity, disk-full guard, explanations) | done |

All nine phases are complete. New work on the cluster starts from the packages
above rather than from TASKS.md, which is kept as the design record.
