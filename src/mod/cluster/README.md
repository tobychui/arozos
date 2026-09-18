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
| `membership/` | The cluster agent: create / join / leave, replicated membership records, join tokens, heartbeats, health, node states, tunnel host selection, and the admin (System Settings) endpoints. |
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

## Admin API (`/system/cluster/*`, admin only)

`status`, `create`, `join`, `leave`, `config`, `testurl`, `token/new`,
`token/list`, `token/revoke`, `node/remove`, `node/state`, `node/probe`,
`nodes`, `capabilities`. The UI is
[`web/SystemAO/cluster/cluster.html`](../../web/SystemAO/cluster/cluster.html).

## Roadmap

| Phase | Status |
|---|---|
| 1 Membership (keys, ACN, tunnel/relay, join/leave, heartbeat, capabilities, health, settings UI) | done |
| 2 Identity (forward-auth to an origin node, replicated accounts as fallback, signed user assertions) | planned |
| 3 Metadata store (leader lease + replicated log, file records, locations, checksums) | planned |
| 4 Unified namespace (`cluster:/` file system abstraction) | planned |
| 5 Replication (whole files, 4 MB chunked transfer, checksum verified) | planned |
| 6 AGI `cluster` library | planned |
| 7 Job runtime (`run`, capability + locality aware scheduling) | planned |
| 8 Map/Reduce | planned |
| 9 Intelligent scheduling | planned |
