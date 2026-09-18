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
  a full `meta/snapshot`.
- Tables (`meta_*`) are registered with `membership.RegisterClusterTable`
  and wiped when the node leaves.

Admin API: `/system/cluster/meta/{status,ls,stat,policy/list,policy/set}`.

## Storage (ACS) and the `cluster:/` drive

Package `storage/` plus the file-system backend
`mod/filesystem/abstractions/clusterfs`. When a node is in a cluster the core
mounts a `Cluster` drive (`cluster:/`, public hierarchy, buffered) into the
base storage pool, so File Manager, WebDAV, media serving and the AGI
`filelib` use it like any other drive.

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

Admin API: `/system/cluster/storage/{status,volume/add,volume/remove,volume/readonly,rescan}`.

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

## Admin API (`/system/cluster/*`, admin only)

`status`, `create`, `join`, `leave`, `config`, `testurl`, `token/new`,
`token/list`, `token/revoke`, `node/remove`, `node/state`, `node/probe`,
`nodes`, `capabilities`. The UI is
[`web/SystemAO/cluster/cluster.html`](../../web/SystemAO/cluster/cluster.html).

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
| 7 Job runtime (`run`, capability + locality aware scheduling) | planned |
| 8 Map/Reduce | planned |
| 9 Intelligent scheduling | planned |
