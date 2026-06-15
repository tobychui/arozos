# CLAUDE.md

Guidance for Claude Code (and human contributors) working in this repository.

## What ArozOS is

ArozOS is a self-hosted, web-based cloud desktop / NAS operating system written
in Go. It runs as a single binary on everything from a Raspberry Pi to a desktop
server. The Go module lives in [`src/`](src/) (module path `imuslab.com/arozos`);
the repository root holds docs, the installer and release tooling.

License: **GPLv3** (see [`LICENSE`](LICENSE)).

## What AGI is

In this codebase **AGI** stands for **ArOZ Online JavaScript Gateway Interface**
— *not* "Artificial General Intelligence". It is the server-side JavaScript
runtime that powers ArozOS web apps: module scripts with a `.agi` (or `.js`)
extension are executed inside a sandboxed [Otto](https://github.com/robertkrimen/otto)
JavaScript VM, **one fresh VM per request/script**, with permission-checked
access to ArozOS functions (file system, database, sharing, IoT, image/zip/
ffmpeg helpers, SQLite, WebSockets, an LLM/`aimodel` chat library, and more).

- **Where it lives:** [`src/mod/agi/`](src/mod/agi/) (`agi*.go`); the runtime
  version is the `AgiVersion` constant in [`src/mod/agi/agi.go`](src/mod/agi/agi.go).
  The gateway is constructed in [`src/agi.go`](src/agi.go) (`AGIInit`, run from
  [`src/startup.go`](src/startup.go)) via `agi.NewGateway(agi.AgiSysInfo{…})`.
- **Built-in globals & functions:** core globals (`USERNAME`, `USERICON`,
  `HTTP_RESP`, `LOADED_MODULES`, …) and functions (`sendResp`, `sendJSONResp`,
  `registerModule`, `requirelib`, `includes`, `execd`, the `…DBItem` DB helpers,
  …) are injected per VM by `injectStandardLibs` / `injectUserFunctions`
  ([`src/mod/agi/agi.user.go`](src/mod/agi/agi.user.go)).
- **Loadable libraries** — pulled in on demand with `requirelib("name")`;
  registered in `LoadAllFunctionalModules`
  ([`src/mod/agi/moduleManager.go`](src/mod/agi/moduleManager.go)): `filelib`,
  `imagelib`, `http`, `share`, `iot`, `appdata`, `sysinfo`, `ziplib` (incl. 7z),
  `sqlite`, `aimodel`, and `ffmpeg` (only when ffmpeg is on the host), plus
  `websocket` and `scheduler` which are injected only in an HTTP request context.
- **Execution entry points:**
  - **`init.agi`** — a web app's startup/registration script, scanned at boot
    from `./web/*/init.agi` (`InitiateAllWebAppModules`) and run with **system
    scope only** (no user functions); used to `registerModule(…)`.
  - **Front-end calls** — `/system/ajgi/interface` (logged-in users) and
    `/api/ajgi/interface` (token auth; this is the `-rpt` callback subservices
    receive). Both run scripts scoped to the invoking user's permissions.
  - **Serverless / external endpoints**, plus nightly tasks and user-approved
    scheduled (cron) tasks.
- **Full API reference:** [`src/mod/agi/README.md`](src/mod/agi/README.md). When
  you change AGI functions or signatures, also update the in-app help data file
  [`src/web/Terminal/docs/api.json`](src/web/Terminal/docs/api.json) to match
  (one object per library section; the README's maintainer note explains how).

## What a WebApp is

A **WebApp** (a.k.a. a *module*) is a user-facing application that shows up on
the ArozOS desktop. Each one is a folder under [`src/web/`](src/web/) — e.g.
`Photo/`, `Music/`, `NotepadA/`, `Calendar/`, `Code Studio/` — holding the
front-end assets (HTML/JS/CSS) plus an optional `init.agi` and any backend
`.agi` scripts it calls.

- **Registration:** a web app announces itself from its `init.agi` by calling
  `registerModule(JSON.stringify(moduleLaunchInfo))`. The launch-info object
  maps field-for-field to the `ModuleInfo` struct in
  [`src/mod/modules/module.go`](src/mod/modules/module.go): `Name`, `Desc`,
  `Group`, `IconPath`, `Version`, `StartDir`, `SupportFW`/`LaunchFWDir`,
  `SupportEmb`/`LaunchEmb`, `InitFWSize`, `InitEmbSize`, `SupportedExt`. See
  [`src/web/Photo/init.agi`](src/web/Photo/init.agi) for a minimal example.
- **Launch modes:** full page (`StartDir`), **floatWindow** (`SupportFW` +
  `LaunchFWDir`, sized by `InitFWSize`), and **embedded** (`SupportEmb` +
  `LaunchEmb`, sized by `InitEmbSize`) — embedded is what loads when a file is
  opened *with* the module. `SupportedExt` registers the file-type associations
  that let the module become a default opener.
- **Go-side handling:** `ModuleHandler`
  ([`src/mod/modules/module.go`](src/mod/modules/module.go)) holds the
  loaded-module list; `RegisterModuleFromAGI` is the hook `init.agi` drives, and
  module visibility is filtered per user by `GetModuleListJSONForUser` (users
  only see modules they have permission for).
- **Scope reminder:** `init.agi` runs with **system scope** (registration /
  system functions only — don't call user or file functions there); backend
  `.agi` scripts invoked from the front end run with the **invoking user's**
  scope. Subservices (below) also register through `ModuleInfo`, so they appear
  on the desktop just like WebApps.

## What a SubService is

A **SubService** lets ArozOS launch an **independent binary web server** (written
in any language) as a child process and **reverse-proxy it under the main
server**, so it appears as a normal ArozOS module. Reach for it when a feature
needs a real native binary rather than a sandboxed AGI script — heavy compute,
an existing Go/Rust/… server, or third-party software such as Syncthing.

- **Where it lives:** package [`src/mod/subservice/`](src/mod/subservice/)
  (`SubService`, `SubServiceRouter`); wiring + boot-time scan in
  [`src/subservice.go`](src/subservice.go) (`SubserviceInit`, run from
  [`src/startup.go`](src/startup.go)). Disable it all with the
  `-disable_subservice` flag; reverse-proxy ports start at `subserviceBasePort`
  (`12810`, [`src/flags.go`](src/flags.go)).
- **Folder convention:** drop the binary in `./subservice/<name>/`, named for
  its platform — `<name>.exe` (Windows) or `<name>_<GOOS>_<GOARCH>` (e.g.
  `demo_linux_amd64`); on Linux an apt-installed binary on `PATH` is preferred.
- **Lifecycle:** ArozOS probes the binary with `<bin> -info` (it must print its
  `ModuleInfo` as JSON — or ship a `moduleInfo.json` instead), then launches it
  as `<bin> -port <port> -rpt http://localhost:<parentPort>/api/ajgi/interface`
  (the `-rpt` URL is the AGI callback so the service can call ArozOS APIs back).
  The reverse-proxy URL prefix is the directory part of `StartDir` and must not
  collide with a reserved path (`web`, `system`, `ws`, …,
  [`src/subservice.go`](src/subservice.go)). A failed proxy is auto-restarted.
- **Auth:** proxied requests are permission-checked (per-module access) and get
  `aouser`, `aotoken` and `X-Forwarded-Host` headers injected; routing happens
  in the authenticated branch of [`src/main.router.go`](src/main.router.go).
- **Marker files** (next to the binary): `.disabled` (skip at boot; toggle in
  the admin UI), `.noproxy` (run but don't proxy — compatibility mode),
  `.startscript` (launch `start.sh`/`start.bat` instead of the binary),
  `.intport` (pass the port without a leading `:`), `moduleInfo.json` (static
  info, skips the `-info` probe).
- **Admin endpoints:** `/system/subservice/{list,kill,start}` (admin only).
  Full guide: the "Subservice Logics and Configuration" section of
  [`src/README.md`](src/README.md).

## What subservices are

A **subservice** is a *separate* program — usually a small Go web server, but it
can be any binary — that ArozOS launches as a child process and stitches into the
desktop through an authenticated reverse proxy. Subservices are how you extend
ArozOS in the language/runtime of your choice, or wrap an existing third-party web
app (e.g. Syncthing), *without* touching the core binary. Contrast with AGI, which
runs JavaScript *inside* the core: a subservice runs *outside* it as its own OS
process and only talks back through the gateway.

A complete, buildable example is the "demo" service at
[aroz-online/ArozOS-Subservice-Example](https://github.com/aroz-online/ArozOS-Subservice-Example).
The canonical reference is the **"Subservice Logics and Configuration"** section of
[`src/README.md`](src/README.md).

Key points:

- **Where it lives in code:** the launcher, reverse proxy and lifecycle logic are
  in [`src/mod/subservice/`](src/mod/subservice/); the wiring (scan directory,
  admin endpoints, graceful shutdown) is in
  [`src/subservice.go`](src/subservice.go). Disable the whole subsystem with the
  `-disable_subservice` flag.
- **Where services live on disk:** one folder per service under
  `./subservice/<name>/` at the ArozOS root. The executable must be named after
  the folder with a platform suffix — `<name>_<GOOS>_<GOARCH>` (e.g.
  `demo_linux_amd64`) or `<name>.exe` on Windows. (On Linux, a system-installed
  binary found via `which <name>` is used if present.)
- **Startup handshake:** the core first reads the module's metadata — from a
  `moduleInfo.json` in the folder, or by running `<binary> -info` and parsing the
  JSON it prints — then relaunches the binary as a long-running web server with
  `-port :<port>` (the next free port from base `12810`) and
  `-rpt "http://localhost:<arozosPort>/api/ajgi/interface"` (the AGI gateway the
  subservice calls back into for filesystem/user access).
- **Routing & desktop integration:** the reverse-proxy endpoint is the *directory*
  of `StartDir`, so `StartDir: "demo/home.html"` proxies `/demo/*` to the service.
  The metadata is registered as a normal module, so the service appears on the
  desktop like a built-in app, gated by per-module permission. The endpoint must
  not collide with reserved paths (`web`, `system`, `SystemAO`, `img`, `ws`, …).
  If the proxied process stops responding, the core kills and restarts it.
- **Control files** (empty marker files dropped in the service folder):
  `.disabled` (skip at boot — an admin can re-enable it in System Settings),
  `.noproxy` (compatibility mode: just run the binary, no port/proxy injection),
  `.startscript` (run `start.sh`/`start.bat` instead of the binary, e.g. to wrap
  Syncthing), `.intport` (pass the port as `12810` instead of `:12810`).
- **Admin control at runtime:** the endpoints
  `/system/subservice/{list,kill,start}` and the UI in
  [`src/web/SystemAO/modules/subservices.html`](src/web/SystemAO/modules/subservices.html)
  let an admin start and stop services without restarting ArozOS.

Minimal example — a `./subservice/demo/` folder with a binary and its metadata:

```
subservice/demo/
├── demo_linux_amd64        # binary, named <folder>_<GOOS>_<GOARCH>
├── demo.exe                # a Windows build (optional, one per target)
└── moduleInfo.json         # metadata — OR print the same JSON on `-info`
```

```json
{
    "Name": "Demo Subservice",
    "Desc": "A simple subservice showing how subservices work in ArozOS",
    "Group": "Development",
    "IconPath": "demo/icon.png",
    "Version": "0.0.1",
    "StartDir": "demo/home.html",
    "SupportFW": true,
    "LaunchFWDir": "demo/home.html",
    "SupportEmb": true,
    "LaunchEmb": "demo/embedded.html",
    "InitFWSize": [720, 480],
    "InitEmbSize": [720, 480],
    "SupportedExt": [".txt", ".md"]
}
```

```go
// The binary answers -info (and exits), then serves its web UI on -port.
func main() {
    info := flag.Bool("info", false, "Print module info as JSON and exit")
    port := flag.String("port", ":8000", "Listen address assigned by ArozOS")
    flag.String("rpt", "", "ArozOS AGI gateway endpoint for callbacks")
    flag.Parse()

    if *info {
        // Same JSON as moduleInfo.json above; StartDir's dir ("demo") is the proxy endpoint.
        fmt.Println(`{"Name":"Demo Subservice","Group":"Development","StartDir":"demo/home.html","Version":"0.0.1"}`)
        return
    }

    http.Handle("/demo/", http.StripPrefix("/demo/", http.FileServer(http.Dir("./web"))))
    http.ListenAndServe(*port, nil) // ArozOS reverse-proxies /demo/* here
}
```

### Webapp vs. subservice

Both a **webapp** and a **subservice** register the same `ModuleInfo` and, once
loaded, look identical on the desktop. The difference is *what runs the code* and
*where it lives*:

| | Webapp | Subservice |
|---|---|---|
| **What it is** | Static front-end (HTML/CSS/JS) plus optional server-side AGI scripts | A standalone compiled binary (any language) |
| **Lives in** | `src/web/<AppName>/`, served by the core's static file server | `./subservice/<name>/`, run as its own executable |
| **Process model** | No process of its own — backend logic runs as JavaScript *inside* the core's Otto VM (one fresh VM per request) | Its own OS process on its own port, reached through a reverse proxy |
| **How it registers** | An `init.agi` startup script calls `registerModule(...)` from inside the VM | The core reads `-info` / `moduleInfo.json` when it launches the binary |
| **Talks to the host via** | AGI globals/libraries in-VM (`requirelib("filelib")`, …) | HTTP calls back to the `-rpt` AGI gateway endpoint |
| **Reach for it when** | A standard ArozOS app whose logic fits the AGI/JS sandbox | You need native code, heavy/long-running work, a non-Go runtime, or to wrap an existing third-party server |

In short: a **webapp** is front-end assets + JavaScript executed *inside* ArozOS
through AGI, while a **subservice** is an *external* program ArozOS launches,
supervises and reverse-proxies. Use a webapp by default; reach for a subservice
when the work doesn't fit the in-core JavaScript sandbox.

## Build, run and test

All Go commands run from `src/`:

```bash
cd src
go mod tidy
go build              # produces ./arozos
./arozos -port 8080   # run (sudo only needed for hardware/WiFi features)

go test ./...         # run the test suite
go vet ./...          # static checks
gofmt -l .            # list unformatted files (should be empty)
make binary           # cross-compile every supported OS/arch (see Makefile)
```

## Mandatory contribution rules

These five rules are enforced on **new and changed code** by a Claude Code
`PostToolUse` hook (during editing) and by CI (on every pull request). Both call
[`scripts/check-conventions.sh`](scripts/check-conventions.sh). Existing legacy
code is grandfathered — CI only inspects the lines a change adds — but do not add
new violations, and prefer fixing nearby ones when you touch them.

### 1. Use the managed logger, never the standard `log` package

New code must send log output through the system logger so it lands in the
managed, rotated system log instead of bare stdout.

```go
import "imuslab.com/arozos/mod/info/logger"

// Good — title, message, and the originating error (nil if none):
logger.PrintAndLog("ModuleName", "could not open config", err)

// Bad — bypasses the system log:
log.Println("could not open config", err)   // and log.Printf/Fatal/Panic
```

The package-level `logger.PrintAndLog` delegates to the system-wide logger wired
up in [`src/main.go`](src/main.go); you do not need your own `*logger.Logger`
instance. The only file allowed to wrap the standard `log` package is the logger
implementation itself ([`src/mod/info/logger/`](src/mod/info/logger/)).

*Enforced as an ERROR* (blocks CI) on added `log.Print*` / `log.Fatal*` /
`log.Panic*` calls.

### 2. New functions ship with tests

Every package under `src/mod/` is expected to carry a `*_test.go` file, and new
functions must come with table-driven Go tests (see
[`src/mod/info/logger/logger_test.go`](src/mod/info/logger/logger_test.go) for
the house style: `t.TempDir()`, `t.Fatalf`/`t.Errorf`, one `Test…` per behaviour).

```bash
cd src && go test ./mod/yourpackage/    # must pass before you push
```

*Enforced* by the CI `go test ./...` gate; the convention checker additionally
*warns* when a touched `mod/` package has no test file at all.

### 3. Dependencies must be MIT / commercial-use-OK

Any module added to [`src/go.mod`](src/go.mod) must be licensed **MIT, BSD-2/3,
Apache-2.0, MPL-2.0, or ISC** — permissive, GPL-compatible, and fine for
commercial redistribution. **Do not add GPL/AGPL/LGPL, source-available
(BSL/SSPL), or unknown-licensed modules.** When unsure, state the dependency's
license in your summary so it can be reviewed before merge.

```bash
go install github.com/google/go-licenses@latest   # optional audit helper
go-licenses report imuslab.com/arozos
```

*Enforced* by a CI reminder whenever `go.mod`/`go.sum` changes — verify the
license of each new dependency before merging.

### 4. New endpoints get the right security control

Register authenticated endpoints through the permission router, not raw
`http.HandleFunc`, so they inherit login, per-module permission and (optionally)
admin/LAN/CSRF checks:

```go
import prout "imuslab.com/arozos/mod/prouter"

router := prout.NewModuleRouter(prout.RouterOption{
    ModuleName:    "System Setting",
    AdminOnly:     true,            // gate admin-only actions
    UserHandler:   userHandler,
    DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
        utils.SendErrorResponse(w, "Permission Denied")
    },
})
router.HandleFunc("/system/yourmodule/action", yourHandler)
```

Use raw `http.HandleFunc` **only** for deliberately public endpoints (e.g. the
`/public/...` registration pages) and treat all request input as untrusted —
validate parameters with `mod/utils` helpers and never interpolate user input
into shell commands or file paths. See
[`src/main.router.go`](src/main.router.go) and
[`src/register.go`](src/register.go) for the patterns.

*Enforced* by a CI/hook *warning* on every added raw `http.HandleFunc`, prompting
a deliberate "authenticated vs. intentionally public" decision.

### 5. Stay portable — no system dependencies, cross-platform safe

ArozOS ships as one self-contained binary that must build and run across the
targets in the [`Makefile`](src/Makefile) (Linux amd64/386/arm/arm64/mipsle/
riscv64, macOS, Windows). Therefore:

- **No hardcoded OS paths.** Build paths with `filepath.Join`, and resolve
  locations via `os.TempDir()`, `os.UserHomeDir()`, or paths relative to the
  binary — never literal `"/usr/..."`, `"/etc/..."` or `"C:\\..."`.
- **No shelling out to platform tools** in shared code. Avoid making features
  depend on external binaries. When a platform-specific call (`exec.Command`,
  `syscall`) is unavoidable, isolate it in a build-tagged file — `foo_linux.go`,
  `foo_windows.go`, `foo_darwin.go`, or behind a `//go:build` constraint — and
  provide a fallback for other platforms. See
  [`src/mod/network/wifi/`](src/mod/network/wifi/) for the pattern.
- Cross-compile to sanity-check: `cd src && GOOS=windows GOARCH=amd64 go build ./...`.

*Enforced as an ERROR* on added hardcoded OS path literals, and as a *warning*
when `exec.Command`/`syscall` appears in a non-build-tagged file.

## How enforcement works

| Mechanism | When it runs | What it does |
|-----------|--------------|--------------|
| `PostToolUse` hook ([`.claude/settings.json`](.claude/settings.json)) | After Claude edits a Go file | Runs the checker on that file and feeds any finding back so Claude self-corrects |
| GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) | On every push / PR | `gofmt`, `go build`, `go test ./...`, and the diff-scoped convention checker (blocking); plus module-wide `go vet` (advisory — never fails CI on grandfathered legacy code) |
| [`scripts/check-conventions.sh`](scripts/check-conventions.sh) | Manually or from the above | Single source of truth for the rules above |

Run it yourself before pushing:

```bash
sh scripts/check-conventions.sh src/path/to/file.go     # check specific files
sh scripts/check-conventions.sh --diff origin/master     # check everything you changed
```

**Escape hatch:** in the rare, justified case where a line must keep a raw
`log`/path literal, append the marker `arozos-lint-ignore` to that line with a
short comment explaining why. Use it sparingly — it is reviewed.

## Repository layout cheatsheet

- [`src/`](src/) — Go module root; `main*.go` boot the server, `*.go` are feature handlers.
- [`src/mod/`](src/mod/) — self-contained library packages (each with its own tests).
- [`src/mod/info/logger/`](src/mod/info/logger/) — the system logger (rule 1).
- [`src/mod/prouter/`](src/mod/prouter/) — permission/auth router (rule 4).
- [`src/mod/agi/`](src/mod/agi/) — the AGI JavaScript gateway runtime (see "What AGI is"); API reference in [`src/mod/agi/README.md`](src/mod/agi/README.md).
- [`src/mod/modules/`](src/mod/modules/) — module registry and the `ModuleInfo` struct shared by WebApps and SubServices (see "What a WebApp is").
- [`src/mod/subservice/`](src/mod/subservice/) — reverse-proxied binary subservices (see "What a SubService is"); wired up in [`src/subservice.go`](src/subservice.go).
- [`src/web/`](src/web/) — front-end assets and WebApps (one folder per module; see "What a WebApp is").
- [`src/system/`](src/system/) — runtime data and config (not shipped in release).
