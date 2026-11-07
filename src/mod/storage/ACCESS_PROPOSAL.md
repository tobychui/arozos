# Proposal: one access list per drive

Status: implemented on branch `v3.0.5`. Kept as the design record; see "Who can
use a drive" in the root `CLAUDE.md` for how it works now, and
[What changed during the work](#what-changed-during-the-work) for where the
result differs from the text below.

The findings below came from reading the code before the work started. Paths are
relative to `src/`, and line numbers refer to the code as it was then.

## Summary

Give every drive one access list: a row per permission group, plus an
"Everyone else" row. That one mechanism covers all four problems.

| Problem | What changes |
|---|---|
| 1. share:/ and cluster:/ show as Removed | They are listed as built-in drives, and the server works out each drive's state instead of the page guessing it. |
| 2. cluster:/ has no access control | It gets an access list like any other drive, kept the same on every cluster node. share:/ gets one too. |
| 3. The editors are dated | A new Add Drive flow inside the settings page replaces the Edit window. The Bridge window goes away. |
| 4. Other Permission does not work | It becomes the "Everyone else" row, set per drive and actually enforced. |

**Can bridging go?** Yes, but Other Permission alone cannot replace it, because
it is one value for everybody outside the group. Bridging means "this one drive,
for this one group". The access list does both jobs, so bridging can be removed
once the list exists. See [Can Other Permission replace bridging?](#can-other-permission-replace-bridging)

**Existing installs keep working as they do now.** The default rules reproduce
today's access, and existing bridges are converted to rows on first boot.

## What the code does today

### Why share:/ and cluster:/ show as Removed

`poolList.html` works out a drive's state by comparing the live pool with the
config file. A drive that is live, but has no config row and no bridge record,
is labelled Removed and loses its buttons (lines 286-309).

share:/ and cluster:/ are attached by code (`sharedDriveAttach`,
`clusterMountDrive`), so they never have a config row. Both drives are working
normally. Only the label is wrong.

### Why cluster:/ cannot be restricted

`clusterMountDrive` attaches the drive to the base pool (`cluster.go:375`), and
every user gets the base pool as `HomeDirectories` (`mod/user/user.go:105`).
Nothing filters a base pool drive by group.

### Why Other Permission does nothing

It is a label with nothing behind it:

- The values are hard-coded when pools load: `readwrite` for system, `denied` for
  groups (`storage.go:123`, `242`, `256`). No endpoint changes them and they are
  never saved.
- `GetHighestAccessRightStoragePool` adds `u.HomeDirectories` even for a group
  pool (`mod/user/permissionHandler.go:166`). Every drive therefore resolves to
  the system pool, and line 127, the only line that reads the value, is never
  reached.
- `GetAllFileSystemHandler` only walks the base pool and the user's own groups
  (`mod/user/directoryHandler.go:55`). A non-member never has the drive, so the
  value could not grant anything even if it were read.

**Do not fix line 166 on its own.** Line 107 compares the pool owner, which is a
group name, with the username. With only line 166 fixed, group members count as
"others" on their own pool, get `denied`, and lose their group drives.

### Other bugs found along the way

| Where | Bug | Effect |
|---|---|---|
| `storage.pool.go:340`, `375` | Reloading the system pool closes cluster:/, and `LoadBaseStoragePool` only re-adds share:/ | cluster:/ disappears for all users until a restart or a volume change |
| `storage.go:332`, `mod/filesystem/config.go:46` | Drive IDs are only checked against reserved names, and `GetAllLoadedFsh` keeps one handler per ID | Two groups can both define `data:/`, and a global lookup may serve one group the other group's drive |
| `mod/filesystem/config.go:46` | `share` is not a reserved ID | A drive with that ID turns off Shared with me, with only a log line |
| `storage.pool.go:98-108` | Editing skips `ValidateOption` | Edit can save a config that New would refuse |
| `storage.pool.go:249-268` | The new ID is used to find the old row | Changing a drive's ID keeps the old row and adds a second one |
| `storage.pool.go:570`, `poolList.html:239` | `listraw` returns the raw config and the page logs it | Network drive passwords and S3 keys reach the browser console |
| `poolList.html:247` | Any stopped drive marks every config row as found | Offline drives vanish from the list while another drive is stopped |
| `storage.pool.go:325` | Stop only flips an in-memory flag | A stopped drive comes back after a restart |
| `fshedit.html:69-79`, `296` | The title elements are inside an HTML comment | New drive still says "Edit File System Handler", as in your screenshot |

## Can Other Permission replace bridging?

Not as it is defined. To give `staff` one `marketing` drive using only Other
Permission, you would have to open every `marketing` drive to every user.

| Need | Other Permission (per pool) | Bridge | Access list (per drive) |
|---|---|---|---|
| Give access to one specific group | No | Yes | Yes |
| Share one drive of a pool, not all | No | Yes | Yes |
| Read only for those users, read write for the owners | Yes | No | Yes |
| Open a drive to all users | Yes | Only by bridging into system | Yes |
| Restrict share:/ or cluster:/ | No | No | Yes |
| Survives a pool reload without extra code | Yes | No, needs re-bridging | Yes |

Your instinct is right that the two features overlap. The fix is to merge them:
Other Permission becomes the "Everyone else" row, and each bridge becomes a group
row.

**Alternatives I rejected:**

- **Special pools for share and cluster.** Pools are tied one to one with
  permission groups, so a pool with no group does not fit, and pool-level rules
  still cannot share a single drive.
- **Keeping bridging and letting admins bridge cluster:/ into chosen pools.**
  This gives no per-group read only, no "everyone" default, and keeps the
  re-bridging logic in every reload path.

## Proposed model

A **drive** is what the code calls a File System Handler. Pools stay: a pool is
still where a drive's config lives, and its group is the drive's **home group**.
Pools just stop being the only thing that decides access.

Each drive has an access list with two parts:

- **Group rows:** a group and a level.
- **Everyone else:** the level for users who match no row. This is what Other
  Permission was meant to be.

The levels are the existing constants: None (`denied`), Read (`readonly`) and
Read & write (`readwrite`).

### How a user's level is worked out

The first rule that matches wins:

1. `user:/` and `tmp:/`: Read & write, always.
2. The user is in the drive's home group: Read & write.
3. The user is in an admin group, and the drive is built-in or in the system
   pool: Read & write.
4. Any of the user's groups has a row: the highest of those rows.
5. Otherwise: the Everyone else level.

The result is then capped: a read-only drive, and share:/ always, never gives
more than Read. A level of None hides the drive completely.

Rule 4 taking priority over Everyone else is what lets an admin block one group,
and it matches how owner, group and other work on Unix.

### Examples

| Goal | Everyone else | Group rows |
|---|---|---|
| cluster:/ for `family` only | None | `family`: Read & write |
| A drive for everyone except `interns` | Read & write | `interns`: None |
| A `marketing` drive that `staff` can read | None | `staff`: Read |

### Defaults

A drive with no saved rule uses these, which match today's behaviour:

| Drive | Everyone else |
|---|---|
| System pool drive | Read & write |
| Group pool drive | None |
| share:/ | Read |
| cluster:/ | Read & write |

### Where rules are stored

Local rules go in `system/storage.access.json`, not in `system/storage/`, because
files in that folder are named after groups. Only drives with a changed rule
appear:

```json
{
  "version": 1,
  "drives": {
    "media": { "other": "denied", "groups": { "family": "readwrite", "guests": "readonly" } },
    "share": { "other": "readonly", "groups": { "guests": "denied" } }
  }
}
```

Rules are keyed by drive ID, so IDs must be unique across all pools. New and
edited drives are validated for this. Duplicates that already exist are covered
in [Decisions for you](#decisions-for-you).

## How share:/ and cluster:/ are exposed

Both appear in a Built-in section of the page, next to `user:/` and `tmp:/`. They
cannot be edited, stopped or removed, and the server refuses those calls too. An
admin only sets who can use them.

### share:/

- The drive is read only, so the page offers just two levels: **Visible** and
  **Hidden**.
- Hidden removes the drive and its sidebar entry. It does not revoke any shares,
  and share links keep opening as before.
- The rule is local to the node.

### cluster:/

- **The rule is replicated.** A local file would not work: every member serves
  the same files, so a rule set on node A would leave them open through node B.
  It is stored with `Submit(KindSetting, ...)`, the way scheduling weights are
  (`mod/cluster/scheduling/scheduling.go:159`). `clusterMetadata.OnChange` needs
  to handle `KindSetting` as well as `KindVolume` so that each node refreshes.
- **Groups match by name**, which is already the cluster's rule ("create the same
  permission groups on every node"). The editor warns when a row names a group
  that does not exist on this node.
- **Jobs follow the rule** because they run as their owner on the executing node
  (`cluster.jobs.go:43`).
- **When the drive is not mounted** (not in a cluster, or no volumes yet), the row
  shows "Not active" with a link to Cluster Settings. Its rule cannot be edited
  then, because `Submit` returns `ErrNotInCluster`. With `-disable_cluster` the
  row is hidden.

## What must be fixed for rules to hold

Today, a user can write to anything they can see unless the whole drive is read
only, so several paths never check. Without these fixes, a Read or None rule would
look active in the UI but be bypassed. All of this has to ship before the first
rule can be set.

| Path | Today | Needed |
|---|---|---|
| SFTP (`mod/storage/sftpserver/vroot.go`) | Writes straight to the drive, and the drive list is fixed at login | Check the level on every operation, so a rule change applies to open sessions |
| WebDAV (`mod/storage/webdav/fshAdapter.go`) | `OpenFile`, `Mkdir`, `RemoveAll` and `Rename` have no per-user check | Same as SFTP |
| Samba (`mod/fileservers/servers/samba/handlers.go:367`) | Shares are created when a user is activated, and the OS enforces them | Honour Read, and update or remove shares when rules change |
| Global drive lookup (`GetFSHandlerSubpathFromVpath`, `GetFsHandlerByUUID`) | Searches every pool and relies on the caller to check | Audit all callers (details below) |
| Cluster job datasets (`mod/cluster/jobs/mapreduce.go:102`) | Patterns expand from the metadata index with no user check, so a denied user could still get file paths | Refuse a dataset unless the user can read cluster:/ |
| Shared with me sidebar (`mod/share/drive.go:315`) | Always available to every user | Hide the entry and return nothing when the level is None |
| Quota (`mod/user/user.go:112`) | Each user's quota manager keeps the drive list from first use | Clear the buffer when rules change |

**The lookup audit matters most.** A missing check on these lookups was harmless
for cluster:/ and share:/ while every user could reach them. A rough scan of
`src/*.go` found 26 functions using them, 8 with no check in the same function:

- 3 are bridge code that gets deleted.
- 2 look fine: `sharedDriveCopyDenied`, and the admin installer in `module.go`.
- 3 are file operation helpers whose callers I checked only in part.

The `mod/` packages were not scanned, so this needs a proper pass during the work.

FTP, TFTP and the cluster AGI calls already use `CanRead` / `CanWrite`. AGI
`filelib` uses them too, but I did not check every function.

## Backend changes

| Area | Change |
|---|---|
| `mod/storage/access` (new, with tests) | Rule type, the level calculation, and a file store with an in-memory copy and atomic writes |
| `mod/user/directoryHandler.go` | `GetAllFileSystemHandler` walks every pool and keeps drives where the user's level is not None |
| `mod/user/permissionHandler.go` | `GetPathAccessPermission` uses the new calculation; `GetHighestAccessRightStoragePool` is deleted |
| `mod/storage/storage.go` | `OtherPermission` and `HasHigherOrEqualPermissionThan` are deleted |
| `storage.go`, `cluster.go`, `file_system.share.go` | One `attachBuiltinDrives` step used by both boot and reload, which also fixes the lost cluster:/ |
| `storage.pool.go` | New endpoints below; validation on edit; built-in drives refused by edit, stop and remove |
| `mod/filesystem/config.go` | Reserve `share`; check that IDs are unique across pools |
| `mod/permission/group.go` | Deleting a group removes its rows, so a new group with the same name does not inherit them |

New endpoints, all on the admin router:

| Endpoint | Purpose |
|---|---|
| `GET /system/storage/drives` | Every drive with its pool, kind, state and access summary, computed on the server and with no credentials. Replaces `listraw` and the per-drive `checkBridge` calls. |
| `GET` / `POST /system/storage/access` | Read or set one drive's access list |
| `GET /system/storage/access/explain?user=&drive=` | Shows which rule decided a user's level, like `/system/cluster/sched/explain` |

Saving a drive mounts it straight away with `AttachFsHandler`, so most changes no
longer need a pool reload. The "THIS WILL CRASH THE SYSTEM" reload moves to an
advanced menu.

**Deleted with bridging:** `storage.bridge.go`, `mod/storage/bridge/`,
`fshBridge.html`, the `bridge` and `checkBridge` endpoints, and the re-bridge logic
in `HandleStoragePoolReload`.

## UI

The page becomes a proper settings fragment using the `--ss-*` tokens and `ss-*`
components, so it follows the theme. It also gets a locale file,
`system/locale/disk/storagepool.json`, in the six File Manager languages. Today
the page is hard-coded English, as your first screenshot shows. "File System
Handler" and "FSH" disappear from the UI in favour of "drive".

### Drives view

```
Manage where files are stored and who can use them.     [ Drives | Who can access ]
                                                                     [ + Add drive ]
BUILT-IN
  user:/      Home folders       Online       Everyone: Read & write       (fixed)
  tmp:/       Temporary files    Online       Everyone: Read & write       (fixed)
  share:/     Shared with me     Online       Everyone: Visible            [Access]
  cluster:/   Cluster            Online       family: Read & write         [Access]

SYSTEM POOL
  media:/     Media    Local     Online       Everyone: Read & write       [Access] [...]
  test:/      test     Local     Offline      Everyone: Read & write       [Access] [...]

GROUP POOL: FAMILY
  photos:/    Photos   SMB       Online       family, guests (Read)        [Access] [...]
```

The `[...]` menu holds Edit, Stop and Remove.

### Who can access view

This is the one-screen answer to "which group can use which drive". Each cell is a
dropdown, and changes save as they are made.

```
              administrator   default        family         guests     Everyone else
share:/       Visible*        Visible        Visible        Hidden     Visible
cluster:/     Read & write*   None           Read & write   None       None
media:/       Read & write*   Read & write   Read & write   Read       Read & write
photos:/      None            None           Home group*    Read       None

* fixed by rule: admin access or home group
```

On a phone, the matrix becomes a group picker with a list of drives below it.

### Add and edit drive

This opens as a panel inside the page instead of a float window, in three steps:

1. **What are you adding?** A folder on this server, a physical disk, or a network
   drive.
2. **Details.** Only the fields for that choice.
3. **Who can use it?** The same access editor as above.

| Today | Proposed |
|---|---|
| Every field shown at once, with type defaulting to NTFS | Step 1 decides which fields appear; a plain folder needs no filesystem type |
| UUID typed by hand, editable later | "Drive ID" filled in from the name, shown as `photos:/`, locked when editing |
| Hierarchy: Isolated User Folders / Public Access Folders | "Folder layout": one shared folder, or a private folder per user, each with a one-line explanation |
| Access Permission dropdown | "Read only drive" switch |
| Mount device, partition UUID, mount point and automount always visible | Physical disk only; Browse fills them in |
| Confirm, then a Reload Now / Later page | Save mounts the drive straight away |
| `alert()` errors | Errors next to the field, plus a Test button for paths and network logins |
| Fixed white float windows | Follows the theme and language of System Settings |

## Migration

No rule file means defaults, so only bridges need converting. On first boot, for
each record in `system/bridge.json`:

- Write a row giving `SPOwner` Read & write on that drive, which is the access it
  has today.
- If `SPOwner` is `system`, set Everyone else to Read & write instead, because
  bridging into the system pool gave the drive to every user.
- Keep rows for drives that are offline at that moment.

The file is then renamed to `system/bridge.json.migrated`, which keeps a backup
and stops the step running twice.

## Delivery order

Each step can ship on its own:

1. **Built-in drives show correctly (problem 1).** The `drives` endpoint, no more
   Removed label, reload keeps cluster:/, ID validation, and no credentials in the
   browser. Access does not change.
2. **Access engine and enforcement.** The new calculation and every fix in
   [What must be fixed](#what-must-be-fixed-for-rules-to-hold). Users see no
   change, because no rules can be set yet.
3. **Access UI and cluster replication (problems 2 and 4).** Both views and the
   replicated cluster rule.
4. **Remove bridging.** Migration, then delete the code and the window.
5. **New Add Drive flow (problem 3).** Independent of steps 2 to 4, so it can
   happen at any point after step 1.

**Testing:**

- Table-driven tests for the level calculation.
- A test proving the defaults give the same result as today across a matrix of
  users and drives. This is the main safety net for existing installs.
- Denied write tests for SFTP and WebDAV.
- A migration test, including a bridge into the system pool.
- A live two-node test: restrict cluster:/ on one node and confirm the other node
  denies access.
- A pass through the real UI on a scratch instance.

## Decisions for you

1. **Can a group row say None to block a group?** Recommended: yes. Without it,
   "everyone except interns" cannot be expressed. The alternative is grants only,
   which is slightly simpler.
   => YES
2. **Should admins always keep access to built-in and system drives?** Recommended:
   yes, so an admin cannot lock themselves out of cluster:/ in the File Manager.
   Group pool drives stay hidden from admins who are not members, as they are now.
   => YES
3. **Should a share still reach someone denied the drive it came from?** For
   example, Alice shares `cluster:/report.pdf` with Bob, who has None on cluster:/.
   Recommended: yes, because a share is a deliberate exception for one file. If
   Alice later loses access to the drive, her shares stop working
   (`mod/share/drive.go:257`). A per-drive "no sharing" switch could come later.
   => YES
4. **Should cluster:/ have one rule for the whole cluster?** Recommended: yes.
   Per-node rules would let the same file be allowed on one node and denied on
   another.
   => YES
5. **What should happen to duplicate drive IDs that already exist?** Recommended:
   log a warning and flag them on the page, but keep them loaded. Changing an ID
   automatically would break share links and saved paths. Until the admin renames
   one, a rule on that ID applies to both drives.
   => SOUNDS GOOD

## What changed during the work

- **More write paths needed a check.** The table in
  [What must be fixed](#what-must-be-fixed-for-rules-to-hold) missed these, which
  wrote to a user's drive without `CanWrite`: AGI `ffmpeg`, `imagelib` resize,
  crop and RAW conversion, and SQLite (a user who may only read now gets a read
  only connection). Emptying the trash also skips drives the user may only read.
- **`/system/storage/pool/list` went too.** Like `listraw` it sent stored logins
  to the browser, through each drive's start options.
- **SFTP reads** opened files read write, which a Read level would have refused,
  so reading now opens them read only.
- **"Everyone else" is called "Default access" in the UI**, and a group that
  follows it says "Use default". It sits in the first column of the matrix: the
  groups read as exceptions to it, and it stays in view when there are more
  groups than fit. In the rule file the level is still the `other` field.
- **`clusterMetadata.OnChange` is not what keeps nodes up to date.** Each access
  check reads the replicated value, so a rule applies as soon as it arrives. The
  hook only clears the quota managers and updates Samba.
- **Samba** needed `read list` rather than `read only`, since one share can have
  users at both levels. `RemoveSambaShareConfig` also had `/etc/samba/smb.conf`
  hard-coded and now uses the configured path.
- **Stop** still lasts until the next restart or reload. The menu says so.

## Out of scope

- Rules on individual folders inside a drive.
- Rows for individual users rather than groups.
- Private per-user folders on cluster:/.
- Uploading into editable shares from share:/.
- Encrypting network drive passwords, which sit in plain text in the storage
  config files.
