# Built-in SMB server: proposal

Status: Phases 1 to 5 are built on branch `v3.0.5_smb` and passed Windows 11
24H2 sessions, smbclient, go-smb2 and the macOS client. Only the durable handle
reconnect has not been exercised by Windows yet (section 14). Phase 6 is built
and passed smbclient, the macOS client and a Windows session (section 15). Section 13 records what real
Windows sessions changed in this plan, section 14 what Phases 4 and 5 found.
Surveyed 2026-11-07.

## 1. Verdict

**This is feasible.** Go can listen on port 445 and speak SMB 2/3 well enough
for Windows Explorer, with no Samba and no cgo. Three separate Go projects
report working Windows clients. The cryptography comes from the standard
library, `golang.org/x/crypto` (already a dependency) and a few small helpers.
The first six phases of the roadmap need no new Go dependency.

**Recommendation:** write the server in the tree at `src/mod/storage/smbserver`
rather than depending on a library. Every permissively licensed library is
under five months old with almost no users, so a dependency brings no field
testing. They are useful as references instead (section 5).

Two limits cannot be engineered away:

1. **ArozOS hosted on Windows cannot have port 445.** The Windows kernel owns
   it. Binding failed on this machine for `:445`, `127.0.0.1:445` and
   `127.0.0.2:445`, with the listener held by PID 4. Linux, the main NAS
   target, is not affected. See section 8.
2. **Microsoft is retiring NTLM.** NTLMv2 is the right choice today, but the
   next major Windows release is targeted to turn it off by default. This hits
   every standalone NAS, Samba included, so moving to a built-in server does
   not make it worse. See section 7.

**How far the evidence goes:** the survey read the source and documentation of
these projects without running them, so the Windows results below are their own
reports. Windows 11 24H2 has since been tested against Samba on the Mac host
(section 13), and a real login from that session replays correctly through the
new code. Windows against the built-in server is the Phase 1 gate.

## 2. What exists today

`mod/fileservers/servers/samba` wraps a system Samba install. Its limits are
the reason for this work:

| Today | Effect |
|---|---|
| `NewSambaShareManager` returns an error unless Linux with `/bin/smbcontrol` | No SMB on Windows, macOS or a minimal Linux |
| Edits `/etc/samba/smb.conf`, runs `sudo adduser`, `smbpasswd`, `pdbedit`, restarts smbd | Needs sudo, creates one Unix account per ArozOS user, and a change restarts the daemon |
| `syncUserShares` skips `IsNetworkDrive()` drives | `cluster:/`, `share:/`, S3, FTP and WebDAV drives are unreachable |
| smbd reads smb.conf, not the drive access lists | `SyncDriveAccess` must keep a copy in step |
| A share is named `<username>_<drive>` for isolated drives | Awkward paths, because smbd cannot resolve per user |

## 3. What Windows Explorer needs

The dialect is not the hard part. Windows negotiates anything from 2.0.2 to
3.1.1 by default, so even 2.1 would connect. **Target 3.1.1 and accept down to
2.1**: 3.1.1 protects the negotiation against downgrade, and 2.1 is the lowest
dialect with large reads and writes.

| Requirement | Why | If it is missing |
|---|---|---|
| Signing | Required by default on all connections from Windows 11 24H2 and Server 2025 | Connection refused |
| Real authentication, no guest | Windows 11 Pro blocks guest, and signing cannot work with guest | Connection refused |
| NTLMv2 inside SPNEGO | The workgroup path; there is no domain controller | Cannot log in |
| TCP port 445 | `\\host\share` always dials 445 and has no port syntax | Explorer cannot connect |
| Answer the SMB1 negotiate | Windows may open with it, and we reply with SMB2 | Mount fails |
| Compound requests | Windows chains create, query and close | Mount or listing fails |
| Credits, multi-credit I/O | Flow control and large reads and writes | Stalls, poor speed |
| `VALIDATE_NEGOTIATE_INFO` | Downgrade check for 3.0 and 3.0.2 clients | Client drops the connection |
| File and volume info classes | Explorer reads many; layouts must be exact | Odd errors, wrong sizes |
| `IPC$` with srvsvc over DCE/RPC | How `\\host` lists its shares | Only full `\\host\share` paths work |
| lsarpc and dssetup over DCE/RPC | The Security tab turns SIDs into names with them | Raw SIDs instead of names |
| Security descriptors | The Properties dialog asks for them | Properties errors; can be synthesized |
| `MxAc` and `QFid` create contexts | Windows asks on most opens, and `MxAc` is how it learns what the user may do | Wrong or missing menu items |
| `CHANGE_NOTIFY` | Live refresh of open folders | Folders refresh less often, otherwise fine |
| WS-Discovery | The Network view; NetBIOS browsing is gone | Not listed; typing the address still works |

Not needed: SMB1, NetBIOS ports 137 to 139, multichannel, RDMA, DFS,
compression, persistent handles, printers. Windows may still ask for a DFS
referral, which is answered with `STATUS_NOT_FOUND`.

## 4. Survey of Go SMB servers

Size is non-test Go source. Windows evidence is what each project reports.

| Project | Licence | Activity | Size | Dialects | Encryption | Windows evidence | Pluggable FS |
|---|---|---|---|---|---|---|---|
| [go-filesystems/smb](https://github.com/go-filesystems/smb) | BSD-3 | Since Sep 2026, active | 176 KB | 2.1 to 3.0.2 | None | Windows 11 ARM64 25H2, 3.0.2, signed, via a forwarded 445 | Yes, pre-1.0 interface |
| [sonroyaalmerol/go-smb-server](https://github.com/sonroyaalmerol/go-smb-server) | MIT | No push since 15 Jul 2026, 10 open PRs | 140 KB | 2.0.2 to 3.1.1 | AES-128-CCM | None on main; open PR #3 reports Windows Server 2025 | Yes |
| [softwarity/smbserver](https://github.com/softwarity/smbserver) | Apache-2.0 | Published Oct 2026 | 116 KB | 2.0.2, 2.1 (3.0 if pinned) | None | Best: redirector and Explorer copy engine in CI, on a high port | No, one folder and one user |
| [ahmetozer/gosamba](https://github.com/ahmetozer/gosamba) | Apache-2.0 | Jun to Sep 2026 | 682 KB | 2.0.2 to 3.1.1 | Yes | None published; `smbclient` on Linux | No, an app with `internal/` code, and no Windows host |
| [macos-fuse-t/go-smb2](https://github.com/macos-fuse-t/go-smb2) | **AGPL-3.0** or commercial | Since 2023, 143 stars | 844 KB | SMB2/3 | Not stated | macOS focus | Yes |
| [gavriva/smb2](https://github.com/gavriva/smb2) | MIT | One push, 2017 | 60 KB | Not stated | Not stated | None | Basic |
| [izouxv/smbapi](https://github.com/izouxv/smbapi) | **None** | Last push Jan 2024 | 175 KB | Not stated | Not stated | iPhone and macOS claimed | Unclear |

Conclusions:

- **Ruled out by licence:** the AGPL project (rule 3) and `smbapi`, which has no
  licence at all and so cannot be used.
- **No mature permissive option.** The usable ones have 0 to 7 stars and are
  months old. The only project with real adoption is the AGPL one.
- **`go-smb-server` cannot be used from main.** Its Windows, locking,
  concurrency and session security fixes all sit in unmerged PRs, and the fork
  default branches do not carry them either.
- **`go-filesystems/smb` is the closest fit**, but it lacks 3.1.1, encryption,
  oplocks and streams, and it requires Go 1.27.1 (ArozOS is on 1.26.10).
- **The job is bounded.** Complete servers here run from 116 KB to 682 KB of
  Go, which is roughly 4,000 to 21,000 lines.

### What their bug history teaches

These come from the `go-smb-server` PRs and are a free defect list for us:

- **Before PR #3, neither Windows Server 2025 nor the Linux kernel client could
  complete a mount**, although `smbclient` and a Go client passed. Causes
  included the SMB1 opening, NTLMSSP framing and challenge flags, compound
  offsets, `FileId` handling in related compounds, and info class layouts.
- **Never grant an oplock before breaks exist.** Clients wrote back stale
  cached data, which is silent corruption.
- **A self-written test client proves little.** Every LOCK from Windows failed
  because of a wrong offset, and the end-to-end test passed because it built
  requests with the same mistake (PR #5). Test against real clients.
- **One request at a time per connection is too slow.** Reading 64 MiB from an
  object store took 2.3 to 5.8 s serially and 0.5 to 3.2 s concurrently
  (PR #6). Design for concurrency from the first day.
- **Compound signing is a security boundary.** Verify each part against its
  original bytes, sign after offsets are final, and never fall back to
  plaintext when encryption fails (PR #12).

## 5. Recommended approach

| Option | Upside | Downside |
|---|---|---|
| A. Depend on a library | Least code at first | No option has both Windows proof and 3.1.1; thin maintenance; our needs would become forks anyway |
| B. Fork one into the tree | Starts from working code | Inherits a design we did not choose; gaps remain large; merge burden |
| **C. Write it in the tree** | Fits ArozOS exactly, no new dependency, one concurrency and security design | Most up-front work; we own all the bugs |

**Choose C.** The difficult parts are ArozOS-specific anyway: per-user dynamic
shares, access checks on every operation, staged drives, quotas and the
credential store. The core is a fixed public specification with free conformance
tools, and this matches how `mod/office` and `pdfrender` were done. **Fallback:**
if Phase 1 stalls on interop, fork `go-filesystems/smb` (BSD-3) as the seed.

Reuse rules: permissive code may be borrowed with its notice kept, for example
CCM and CMAC from `hirochachacha/go-smb2` (BSD, internal there, so copied) and
the test matrix idea from `softwarity/smbserver`. Do not read or copy from the
AGPL project.

```
src/mod/storage/smbserver/
    server.go, conn.go   listener, connection limits, reader and writer goroutines
    wire/                headers, commands, info classes, status codes
    auth/                SPNEGO and NTLMv2 (Kerberos later)
    crypt/               key derivation, CMAC, GMAC, CCM, GCM, preauth hash
    rpc/                 DCE/RPC and NDR for srvsvc, lsarpc and dssetup
    state/               share modes, pending deletes, byte-range locks
    capture.go           opt in pcap and trace log, works with no root on any host
    backend.go           the small interface the core calls
    aroz/                that interface over *user.User and FileSystemHandler
src/mod/fileservers/servers/smbserv/   fileservers.Server glue, settings, activation
src/web/SystemAO/disk/smb.html         settings page (instr/smb.html for connection help)
```

Only `aroz/` imports ArozOS packages, so the protocol core stays testable by
itself. This is the same split as `sftpserver.Access`.

## 6. Mapping to the ArozOS file system

### Shares and users

- **A share is a drive.** `\\host\user` is the signed-in user's `user:/`, and
  the list comes from `GetAllFileSystemHandler()` for that session. The server
  knows who is connected, so the `<username>_<drive>` naming goes away:
  `VirtualPathToRealPath(vpath, username)` already resolves isolated drives.
- **One share per drive, not one virtual root.** Free space, read-only state
  and the drive name then all behave naturally in Windows.
- **No shares on arbitrary host paths.** Admins add a drive instead, which keeps
  every path under the access lists.
- **The session holds a username, not a frozen permission set.** As in
  `sftpserver/vroot.go`, ask `CanRead` and `CanWrite` on each operation, so a
  rule change reaches open sessions. Every write path must check `CanWrite`.
- **Files are owned by the ArozOS process**, like everything File Manager
  writes. No Unix accounts are needed.

### Passwords: the one real gap

NTLM needs the **NT hash**, MD4 of the UTF-16 password. ArozOS stores
`sha512(password)` in `auth/passhash/<user>`, and one cannot be derived from the
other. So `ValidateUsernameAndPassword` cannot be used, and existing accounts
cannot work over SMB until a password is supplied once.

**Recommendation: a dedicated SMB password per user**, set when the user
activates SMB, after confirming the login password. They may type the same one,
or take a generated one, and Windows Credential Manager remembers it.

- An NT hash is enough to log in over SMB and is quick to crack. Keeping it
  separate means a leak does not expose the web login, and it can be revoked.
- It works for LDAP and OAuth accounts, which have no local password to reuse.
- It needs no hooks in the password change paths (`user.go`, `system.resetpw.go`,
  the cluster write-back).
- Store it encrypted with AES-GCM, following `mod/email/secretbox.go`.
- **Store the Kerberos AES keys at the same time**, which are also derived from
  the password. This keeps a Kerberos path open without asking everyone again.

Clusters: start with activation per node, and later verify NTLM at the identity
origin over ACN, so that a member need not hold the hash.

### Operations

| SMB | ArozOS |
|---|---|
| `TREE_CONNECT` | Find the drive in `GetAllFileSystemHandler()`, `CanRead` on its root |
| `CREATE` | `CanRead` / `CanWrite` by requested access, then `OpenFile` or a staged handle |
| `READ`, `WRITE`, `FLUSH` | `ReadAt`, `WriteAt`, `Sync` |
| `QUERY_DIRECTORY` | `ReadDir` once per handle, then page from the snapshot |
| Set end of file / allocation | `Truncate` |
| Rename | `Rename`, both ends checked; across drives is refused so Windows copies instead |
| Delete | Marked on the open, then `Remove` at last close |
| Basic info | `Chtimes` |
| Volume size | `diskcapacity.ResolveCapacityInfo` on local drives, capped by remaining `StorageQuota` on `user:/` |
| Creation time | `filesystem.GetFileCreationTime`, falling back to modified time |
| Security descriptor | Synthesized from the user's access level; changes are accepted and ignored |

### Windows behaviour the server must provide itself

`FileSystemAbstraction` has none of this, and it should not gain it:

| Behaviour | Approach |
|---|---|
| Share modes, byte-range locks | In-memory tables keyed by drive and path |
| Case-insensitive names | Exact match first, then a case-folded scan of the parent, with a short cache |
| Names Windows forbids (`:`, `?`, trailing dot) | Map to the private Unicode range other SMB clients use |
| Stable file IDs | The inode on local drives, otherwise a hash of drive and path |
| Alternate data streams | Do not advertise them at first, then keep small streams in memory |
| `.metadata` folders | Report as hidden; refuse writes into them over SMB |
| Symlinks | Refuse links that lead outside the drive root |
| Path safety | Reject `..` and stream syntax before resolving; test against the `user:../bob` class of bug |

**Oplocks and other writers:** File Manager and WebDAV writes bypass the server,
so they will not break an SMB client's cache. Samba has the same gap by default
(`kernel oplocks = no`). Accept it, grant no oplocks until breaks work, and
document it.

### Drive types

| Drive | `RequireBuffer` | Plan |
|---|---|---|
| Local disks | false | Direct `OpenFile`; Phases 1 and 2 |
| `smb`, `sftp` | false | Direct; check behaviour under load in Phase 4 |
| `webdav`, `ftp`, `s3`, `cluster` | true | **Staged handle**, Phase 4 |
| `share:/` | Handled inside sharefs | Read-only; already refuses writes |

`Open` and `OpenFile` return "not supported" on all four buffered types, so
random I/O needs a new layer. WebDAV's `BufferFsIoHandler` is no model: it holds
the file in memory and refuses anything over 28 MB. FTP does not support these
drives at all.

A staged handle copies the file to `LocalBufferPath` when first read (extending
`BufferRemoteToLocal`), does random I/O on that copy, and commits by `WriteStream`
at close. This suits `cluster:/`, which already publishes whole files. Rules:

- Long transfers must return `STATUS_PENDING` first, or the Windows request
  timer expires while waiting.
- `CLOSE` waits for the upload and reports failure, because Windows gives the
  user little feedback at that point. On failure, keep the staged file and log.
- Each save uploads the whole file. An admin limit caps the staged size.

### Quotas and trash

- **Quota:** call `StorageQuota.HaveSpace` as writes extend a file, and return
  `STATUS_DISK_FULL`. Follow FTP here; **WebDAV and SFTP have no quota check
  today**, which is a separate existing gap.
- **Trash:** SMB delete is permanent, as with Samba today. Sending deletes to
  ArozOS trash can be an option in Phase 6.

## 7. Security

This is a new network parser, and the installer's service has no `User=` line,
so it normally runs as root. Go removes memory corruption, not logic bugs.

- **Never:** SMB1 sessions, guest or anonymous sessions, NTLMv1, unsigned
  sessions on any dialect that can sign.
- **Before login:** only `NEGOTIATE` and `SESSION_SETUP` are reachable. Apply
  message size limits, a 30 second login deadline, and per-IP connection caps.
- **Failed logins:** check `ValidateLoginIpAccess` at accept. Delay failures,
  as Windows does with 2 seconds per attempt, and adapt `explogin`, whose API
  takes an `*http.Request`. Log with `LogAuthByRequestInfo(..., "smb")`.
- **Exposure:** `ForwardPortIfUpnp: false`, and default to private network
  addresses only, with an explicit admin override. Port 445 must not reach the
  internet.
- **Hardening:** fuzz every decoder reachable before login, run `GOARCH=386`
  tests, and test boundary values, as for the other untrusted-file parsers.

**NTLM retirement.** Microsoft's FAQ gives the "next major release of Server and
Client (subject to change)" as the target, with no date. Admins can re-enable
NTLM at first, but that ability "will be narrowed" over time, and NTLM-only
appliances "will need" vendor updates. Windows' own LocalKDC does not help a
third-party server, which needs its own Kerberos support. Samba developers are
working on a local KDC with IAKerb, and that is the path to follow (Phase 7).

## 8. Platforms and ports

| Host | Port 445 | Windows Explorer access |
|---|---|---|
| Linux as root (the installer's service) | Works | Full |
| Linux without root | Needs `cap_net_bind_service`, or systemd `AmbientCapabilities` | Full |
| Linux with Samba running | Taken by smbd | Only one can run; the settings page says why |
| macOS | Needs File Sharing off, and a normal user can bind it on all addresses but not on one | Full, tested |
| Windows | **Held by the kernel** | Alternate port only: Windows 11 24H2+ or Server 2025 clients, mapped by an admin with `New-SmbMapping -TcpPort`; no `\\host` browsing |

The server stays pure Go and builds for every Makefile target, with a
configurable port. Freeing 445 on a Windows host would mean disabling the
Windows Server service, which ArozOS must not do for the user.

Low-end boards need measuring: signing every packet in software may limit
speed on ARM and MIPS, since signing cannot be turned off for Windows 11 clients.

## 9. Roadmap

Size and effort are rough estimates from the surveyed projects, for one
developer, before any prototype. Each phase ends with a check on **real clients
at default settings**.

| Phase | Result | Lines | Effort |
|---|---|---|---|
| 0. Rig | Test bench, CI, codec | 1k | 3 to 4 days |
| 1. Read-only | Browse and copy out in Explorer | 6k | 2 to 3 weeks |
| 2. Writes | Safe for everyday apps | 4k | 2 to 3 weeks |
| 3. Product | Experimental release | 1.5k + UI | 1 week |
| 4. All drives | Cluster, S3, FTP, WebDAV | 1k | 1 week |
| 5. Speed and resilience | Caching, reconnect, encryption | 4k | 3 to 4 weeks |
| 6. Reach | Discovery, macOS, extras | 2k | 2 weeks |
| 7. After NTLM | Kerberos, then retire the Samba wrapper | Open | Open |

Phases 0 to 3 are the first usable release, at about 6 to 8 weeks.

### Phase 0: test rig and foundations

- Set up the Mac host and Windows 11 24H2 client (section 10).
- Capture real sessions to use as codec fixtures.
- Build the `wire` codec and NTLMv2 against the MS-NLMP test vectors.
- Measure CMAC, GMAC and GCM speed on a Raspberry Pi class board.

**Done when** captured Windows traffic round-trips through the codec exactly.

### Phase 1: read-only Explorer, the go/no-go gate

- Negotiate 2.1 to 3.1.1 with the SMB1 opening, preauth integrity, SPNEGO and
  NTLMv2, and all signing algorithms.
- Compound requests, credits, multi-credit I/O, and a concurrent connection
  design with one writer goroutine.
- Tree connect, create, close, read, query directory, query info, `IPC$`,
  srvsvc, lsarpc and dssetup, and `CHANGE_NOTIFY` that pends and cancels cleanly.
- Local drives and `share:/`, with passwords set by a temporary admin command.

**Done when** Windows 11 24H2, against a host on port 445, lists `\\host`,
browses, opens Properties, and copies out 10 GB with matching hashes, and a wrong
password is refused and logged. Windows 10 and a Linux host follow before release. **If this is not reached, revisit the
fork fallback before going on.**

### Phase 2: writes that real applications trust

- All create dispositions, write, flush, set info, delete on close, rename.
- Share modes, byte-range locks, case-insensitive lookup, name mapping, file IDs.
- `CanWrite` on every path, quota checks, read-only drives reported as such.

**Done when** Explorer copy, move, rename and delete, Word and Excel saves
(temp file, then rename), VS Code and `robocopy /MIR` all work, data hashes
match, and agreed `smbtorture` smb2 suites pass.

### Phase 3: product integration, shipped as experimental

- `fileservers.Server` entry (`ID: "smb"`), a settings page, connection help, and
  system locale strings. Popups use `ssdialog`.
- User activation, encrypted credential store, revocation, IP checks, login
  delay, auth log, and a connected clients list.
- Mutual exclusion with Samba, and a clear message when 445 is taken.
- Optional import of existing hashes from `pdbedit -Lw`, so Samba users need not
  set a password again.

**Done when** a fresh install can enable SMB and connect from Windows with no
terminal use. The Samba wrapper stays available.

### Phase 4: every drive type

- Staged handles with admin limits and interim responses.
- `cluster:/`, S3, FTP and WebDAV, plus checks on `smb` and `sftp`.
- Cluster activation and the NTLM verify over ACN if wanted.

**Done when** Explorer can read, edit and save on each drive type, and a failed
upload is reported and loses no data.

Built: WebDAV, FTP and S3 files are staged (`aroz/staged.go`): the download runs
in the background and a read is answered as soon as its range arrived, writes
wait for the whole copy, and the upload happens at CLOSE, whose status reports
a failure. A failed upload's copy is moved to `system/smb/failed/`, because the
tmp folder is emptied at boot. Admins set the largest staged file (System
Settings > File Servers, 4096 MB by default, 0 for none). Any request still
running after a second gets an interim `STATUS_PENDING`. SFTP and SMB drives
have real file handles and need no staging. Verified against real WebDAV, FTP,
SFTP and Samba servers; cluster and S3 only through a fake buffered drive. The
optional cluster NTLM verify over ACN was left out.

### Phase 5: speed and resilience

- Oplocks and leases, **with breaks working first**.
- Durable handles, so open files survive Wi-Fi drops and sleep.
- AES-128/256 GCM and CCM encryption, with a per-share "require" option.
- Server-side copy, and notify from in-server events plus light polling of
  watched folders only, which works on every drive type with no new dependency.

**Done when** the TCP cut tests pass during a copy, encrypted sessions pass the
Phase 2 set, and throughput is within an agreed range of Samba on the same box.

Built: leases (V1 and V2, R/RH/RW/RWH, breaks that wait for the holder's answer
for at most 35 seconds), durable handles V2 on top of handle caching leases,
AES-128/256 GCM and CCM encryption with one server wide "require encryption"
switch instead of a per share one, server side copy (`FSCTL_SRV_COPYCHUNK` and
`_WRITE`) and `CHANGE_NOTIFY`. See section 14 for how each one behaves.

### Phase 6: reach and extras

- WS-Discovery responder (UDP 3702, TCP 5357) for the Network view, and
  `_smb._tcp` through `mod/network/mdns`.
- macOS and iOS: named streams and the Apple extensions.
- Previous Versions backed by `localversion`, and deletes into ArozOS trash.

Built, except the Apple create context (`AAPL`): see section 15.

### Phase 7: after NTLM

- Follow the Samba local KDC work, and evaluate IAKerb with a small built-in KDC.
- Decide when the built-in server replaces the Samba wrapper, then remove it.
- Optional: SMB over QUIC for safe remote access.

## 10. Testing

**A Windows host cannot test Explorer against a local server**, because Windows
owns 445, so development moved to a Mac. A normal user can hold port 445 there,
and a Windows 11 24H2 laptop on the network reaches it, which is the strict
client the signing defaults are about.

The Mac differs from the main Linux target in ways a test has to allow for:

- Its system disk ignores case, which hides the case folding code. Use a
  case sensitive APFS volume as a test drive (`hdiutil` needs no root).
- `tcpdump` needs root, so capture happens inside the server (`-smb_capture`).
- `smbtorture` and the Linux `cifs` mount are not available, so they stay in CI.
- Speed on small boards still needs a real board.

Still needed before release: a Windows 10 client, a Linux host, and CI.

| Layer | Tool | Runs |
|---|---|---|
| Unit | Go tests, MS-NLMP and signing vectors, fuzzing | Every push |
| Integration | `hirochachacha/go-smb2`, already in `go.mod` | Every push |
| Real clients | `smbclient`, `rpcclient` and the macOS kernel client, every dialect and signing algorithm; Wireshark as a second reader of the RPC replies | Every push where installed |
| Real clients | A Linux `cifs` mount | CI |
| Windows | `net use /TCPPORT` on a Windows Server 2025 runner, as softwarity does | CI |
| Windows on 445 | Explorer, Office and `robocopy` against the Linux host | Each phase |
| Conformance | `smbtorture`, Microsoft's MIT-licensed WindowsProtocolTestSuites | Phase 2 onward |
| Resilience | Cut TCP during copies, large file hashes | Phase 5 |

Windows reports defects as vague errors long after the cause, so the server can
write a pcap and a trace of each command and status (`capture.go`). It needs no
root and works on every host. File contents are cut from it, and every NTLM
AUTHENTICATE is blanked: Windows sends one derived from the signed in user's real
password before it ever shows a login box, so a capture must never keep them.

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A client behaviour no document mentions | Schedule | Real clients from Phase 1, trace proxy, go/no-go gate |
| Silent data corruption | Severe | No caching grants until breaks work, hash tests, flush maps to `Sync`, staged data kept on failure |
| Security flaw in a root process | Severe | Section 7 limits, fuzzing, private networks by default, experimental label first |
| NTLM turned off by default | High, long term | Admin re-enable at first; Kerberos keys stored from the start; Phase 7 |
| Slow on small boards | Medium | Measure in Phase 0; prefer GMAC where the client allows it |
| Long-term ownership of a protocol server | Medium | Narrow scope, conformance suites in CI, Samba wrapper kept until proven |
| Hash stored on the server | Medium | Dedicated SMB password, encrypted at rest, revocable |
| Staged saves on slow remotes | Medium | Size limit, interim responses, documented behaviour |

## 12. Decisions needed

1. **Approach:** write it in the tree (recommended), or fork a library?  
=> in tree
2. **Passwords:** a dedicated SMB password (recommended), or reuse the login
   password and hook every password change?
=> Ask the user for new password on SMB server enable on their account
3. **Samba wrapper:** keep it until the built-in server has proven itself
   (recommended), or replace it at Phase 3?
   => recommend method
4. **Windows hosts:** accept alternate port only (recommended)?
=> yes
5. **First target:** Phases 0 to 3 as the first release (recommended)?
=> yes, do it in one go
6. **Test hardware:** which Linux box and Windows 11 24H2+ client can Phase 0 use?
=> I have switched over to a mac machine, try it here?

## 13. What a real Windows session showed

A Windows 11 24H2 laptop (build 26100) used a Samba share on the Mac through a
capture proxy, on 2026-11-07. It confirmed the opening with SMB1, the signing
rules and the compound and `CHANGE_NOTIFY` behaviour, and added these:

| Seen | Consequence |
|---|---|
| The Security tab calls lsarpc (`lsa_OpenPolicy3`, `lsa_LookupSids2`, `lsa_QueryInfoPolicy`) and dssetup, and `samr` for full names | Built lsarpc and dssetup. `samr` is left out: the tab still showed `alice (AROZTEST\alice)` without it |
| Office opens `wkssvc`, though Explorer does not | Built `NetWkstaGetInfo` |
| Identities in a descriptor need names and must stay stable | A machine SID and user SIDs are derived from the install's id, with nothing extra to store |
| Most opens carry `MxAc`, `QFid`, lease and durable handle requests | `MxAc` and `QFid` are answered. Leases and durable handles were declined by omission until Phase 5 |
| Directory class 81 is tried first, in a compound pair, then class 37 | `STATUS_INVALID_INFO_CLASS` for any class not implemented |
| Object id calls come for shortcuts and recent files, whether a volume claims them or not | Answered with an id worked out from the file, nothing stored |
| Windows asks for only the credits a read costs, and expects the server to add more | Credits follow Samba: what was spent plus the request minus one. Repaying only what was spent left one read in flight, 20 MiB/s on a 33 ms link |
| Word writes through one handle and renames through another | A rename reaches every handle of the file |
| `sample.bin:Zone.Identifier` is opened even with streams not advertised | Refused with `STATUS_OBJECT_NAME_INVALID` |
| Interim `STATUS_PENDING` responses are unsigned, even inside a signed compound | Same here |
| The login carries a `mechListMIC` and expects one back | Implemented, not skipped |

Fixed against that capture before Windows ever touched the server: a replay of
the real login through the new code verifies the NTLMv2 response, MIC and
`mechListMIC`, produces a final token byte identical to Samba's, and derives a
key that verifies every signed message of the session. All 752 Windows requests
in it parse. The capture itself stays out of the repository: it holds the
laptop's name and file contents.

Open from the Windows tests: Word 2007 hung on closing a document it had saved
(`AppHangB1`, 50 seconds of SMB silence, the document intact). Every request was
answered and the connection stayed up, and an `.odt` retest worked, so it is
treated as an old Word problem for now. `CHANGE_NOTIFY` requests did not
complete then; since Phase 5 they do, and the 2026-11-08 session saved and
closed a Word 2007 document with no hang.

Users need System Settings access to reach the activation page, as with every
file server. The `default` group of a fresh install does not have it.

## 14. What Phases 4 and 5 built and found

Tested on the Mac against real WebDAV (`x/net/webdav`), FTP (`ftpserverlib`),
SFTP (`pkg/sftp`) and Samba servers mounted as ArozOS drives, and with
smbclient 4.25, go-smb2 and the macOS SMB client as clients.

| Found | Done |
|---|---|
| The WebDAV drive reported a missing file as a bare HTTP 404, so nothing could tell "not found" from a failure | `webdavfs` maps 404/410 to `fs.ErrNotExist` and 401/403 to `fs.ErrPermission` |
| The FTP drive had no `Stat` at all, and `FileExists` and `IsDir` failed on servers without MLST | `ftpfs.Stat` uses MLST and falls back to listing the parent; 550 maps to not found |
| `ftpfs.ReadStream` quit the FTP connection before the caller read the data | The connection now closes with the stream |
| WebDAV and FTP cannot set file times, and Explorer sets them at the end of every copy | A time change those drives cannot make is accepted and ignored |
| The CLOSE post query answered with the size from before a staged upload | It is asked after the close |
| A CREATE cancelled after it went async still opened the file, and nobody would close it | The open is closed when its answer cannot be delivered |
| A handle being written on a staged drive reported the drive's old size | `PendingFile` lets the handle report its own |
| macOS asks for a resume key on the share root to learn whether server side copy exists | Any handle gets a key; copying from a folder fails later |
| macOS asks for leases (RH and RWH) and durable handles on nearly every open | Granted on local drives; macOS answered breaks within milliseconds and reread data changed by another client or on disk |
| macOS writes `._name` AppleDouble files for metadata, as with any server without named streams | Left as is; named streams are Phase 6 |
| Homebrew Samba on macOS created folders with mode 000 for the SMB drive test | A test rig setting (`nt acl support = no`), not an ArozOS problem |

How the Phase 5 parts behave:

- **Leases** are only granted on drives the server can check often (local
  ones), because changes made around the server, through the File Manager or
  on the host, cannot be broken in advance. A validator compares the size and
  time of every R-leased file every 3 seconds and breaks the lease when they
  changed without this server doing it. W is only granted while nobody else
  has the file open. Another open breaks W, and H when a cached handle's share
  mode would refuse it; an overwrite breaks everything; a write breaks R;
  rename and delete break H. Attribute-only opens break nothing, or Explorer
  would break every lease it walks past. Breaks of W or H wait for the client's
  answer (or the timeout); breaks of R alone do not wait.
- **Durable handles** are granted only with an H lease. A connection that dies
  keeps them for the requested timeout (60 seconds by default, 5 minutes at
  most); logoff, revoked access and an open needing the lease close them.
  `PreviousSessionId` drops a session the server had not noticed was dead.
- **Encryption** is negotiated whenever the client offers it. With "require
  encryption" on, clients without it are refused at login and plain requests
  on an encrypted session get `STATUS_ACCESS_DENIED`. CCM is written in
  `crypt/encrypt.go` and checked against NIST SP 800-38C and RFC 3610 vectors.
  Captures keep the decrypted messages.
- **CHANGE_NOTIFY** reports this server's own changes at once to every client
  watching, and finds changes made around it by listing watched folders on
  local drives every 3 seconds. Changes while no request waits are queued,
  and too many become `STATUS_NOTIFY_ENUM_DIR`.
- **Server side copy** follows the Windows server limits (256 chunks, 1 MiB
  each, 16 MiB per request) and runs each chunk through the same access, lock
  and quota checks as a READ and a WRITE.

The Windows 11 session of 2026-11-08 confirmed it on the real client:

- Copy and paste of a 500 MB file within a share used `FSCTL_SRV_COPYCHUNK`
  (30 requests, nothing over the network) and finished at once. Windows first
  tries `FSCTL_OFFLOAD_READ` and `FSCTL_QUERY_FILE_REGIONS`; both are refused
  with `STATUS_INVALID_DEVICE_REQUEST` and it falls back by itself.
- Explorer asked for RWH leases and durable handles on its opens and got them.
- Files created, renamed and deleted from the File Manager showed up in an open
  Explorer window without a refresh.
- With "require encryption" on, Explorer reconnected by itself, negotiated
  AES-128-GCM and copied the 500 MB file.
- A 15 second Wi-Fi drop did not end the TCP connection, so the durable
  reconnect path (`DH2C`) is still only tested by `lease_test.go`. Sleeping the
  laptop for a few minutes with a document open would exercise it.

Throughput on the Mac's loopback with smbclient and a 300 MB file: about
1.9 GB/s up and down, as Samba on the same machine; about 1.7 GB/s encrypted,
Samba 1.5 to 1.7 GB/s.

## 15. What Phase 6 built and found

- **Network view.** `mod/network/wsd` answers WS-Discovery Probe and Resolve
  on UDP 3702, says Hello and Bye, and serves the device metadata Windows asks
  for on TCP 5357 (`AROZTEST/Workgroup:WORKGROUP`). Windows then opens
  `\\AROZTEST`, which it can only find through LLMNR when no DNS server knows
  the name, so the package also answers LLMNR (UDP 5355) for that one name. It
  runs only on port 445, which is all the Network view knows, and never on a
  Windows host, which announces itself. A port another program holds (wsdd,
  systemd-resolved) is logged and left out. Checked with real multicast
  queries on the Mac's LAN interface; the Network view itself still needs
  Windows.
- **macOS Finder.** `_smb._tcp` and `_device-info._tcp` (model `RackMac`, for
  the icon) through zeroconf, which works beside mDNSResponder. Seen by
  `dns-sd -B`. Follows `-allow_mdns`. Both announcements share one admin
  switch, "Show this server on the network", on by default.
- **Trash.** With "Deleted files go to the trash bin" on (off by default, as
  with Samba and as Windows expects of a network drive), deleted files move
  into the drive's `.trash` the way the File Manager does it, through one
  shared `system_fs_moveToTrash`. Only files go there: Explorer deletes a
  folder's content first, so files arrive one by one under their old folders,
  and emptied folders are deleted for good, as Samba's recycle module does.
  Office, LibreOffice, macOS and Explorer helper files (`~$*`, `*.tmp`, `._*`,
  `Thumbs.db` and the like) skip the bin, and a full bin deletes for good,
  because an SMB client cannot be asked what to do instead.
- **Previous Versions.** The snapshots the File Manager takes
  (`.metadata/.localver/<local time>/<file>`) are listed by
  `FSCTL_SRV_ENUMERATE_SNAPSHOTS` as `@GMT` tokens and opened by the `TWrp`
  create context or an `@GMT` path component, read only. The core only knows
  the `SnapshotShare` interface; the layout is the backend's. smbclient read an
  old version back by its token and was refused writing to it.
- **Named streams.** Kept as files in `.metadata/.streams/<file>/`, escaped,
  and moved or deleted with their file over SMB. The core passes a stream to
  the backend as `path + NUL + name`, because a colon can be part of a file
  name (mapped from the private range) or of a macOS attribute name. With
  `FILE_NAMED_STREAMS` claimed, macOS stores its extended attributes, Finder
  info and tags as streams and stops writing `._` files; `xattr -w`, `cp -p`
  and `mv` kept them. Windows keeps `Zone.Identifier` on downloads. Changes
  made through the File Manager leave streams behind.
- **`.metadata` is left out of listings.** Once streams put it in many
  folders, `rm -rf` and Explorer tried to delete it with its folder and were
  refused, so the folder never emptied. It is now unlisted (paths into it
  still work), a folder holding nothing else counts as empty, and it is
  deleted with its folder.
- **Left out: `AAPL`.** Named streams were what stopped the `._` files. The
  rest of the Apple context, directory listings packed with Finder info and
  resource fork sizes, server side copy of metadata and Time Machine, is
  intricate, could only be checked against this Mac's client, and is not
  needed for the goal. smbclient's `allinfo` stops at the 8.3 short name query,
  which this server answers "not found" as NTFS does with short names off.

A Windows session on 2026-11-08 confirmed it: `AROZTEST` showed up in the
Network view and opened with a double click; the Previous Versions tab listed
the snapshot, opened it and restored it; a file deleted in Explorer came back
from the web desktop's trash bin; downloads copied into the share kept their
`Zone.Identifier`; and a folder with files in it was deleted whole. Windows
also asks `FSCTL_PIPE_WAIT` before opening named pipes, which this server
refuses with `STATUS_INVALID_DEVICE_REQUEST`; nothing visible depends on it,
and answering it is a small follow-up.

## Sources

- [SMB security hardening](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-security-hardening), Microsoft Learn: signing, guest, NTLM blocking, rate limiter
- [Configure alternative SMB ports](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-ports), Microsoft Learn
- [Accessing a third-party NAS with SMB in Windows 11 24H2 may fail](https://techcommunity.microsoft.com/blog/filecab/accessing-a-third-party-nas-with-smb-in-windows-11-24h2-may-fail/4154300), Microsoft
- [Retiring NTLM: frequently asked questions](https://techcommunity.microsoft.com/blog/windows-itpro-blog/retiring-ntlm-frequently-asked-questions/4550522), Microsoft
- [sambaXP](https://sambaxp.org/): local KDC and IAKerb talk abstract
- [Eliminating NTLM in Storage](https://www.snia.org/sniadeveloper/session/19287), SNIA
- [WindowsProtocolTestSuites](https://github.com/microsoft/WindowsProtocolTestSuites), Microsoft
- `go-smb-server` PRs [#3](https://github.com/sonroyaalmerol/go-smb-server/pull/3), [#5](https://github.com/sonroyaalmerol/go-smb-server/pull/5), [#6](https://github.com/sonroyaalmerol/go-smb-server/pull/6), [#12](https://github.com/sonroyaalmerol/go-smb-server/pull/12)
- [Verifying with Windows](https://github.com/go-filesystems/smb/blob/main/docs/verifying-with-windows.md), go-filesystems/smb
