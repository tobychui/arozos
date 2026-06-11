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
JavaScript VM, one fresh VM per request, with permission-checked access to
ArozOS functions (file system, database, sharing, IoT, image/zip/ffmpeg helpers,
WebSockets, an LLM-chat library, and more).

Key points:

- **Where it lives:** [`src/mod/agi/`](src/mod/agi/) (`agi*.go`); the runtime
  version is the `AgiVersion` constant in [`src/mod/agi/agi.go`](src/mod/agi/agi.go).
- **What it runs:** a web app's `init.agi` (startup/registration), backend
  scripts called from the front end, nightly tasks, and user-approved scheduled
  (cron) tasks — each scoped to the permissions of the invoking user.
- **How scripts talk to the host:** core globals (`USERNAME`, `HTTP_RESP`, …)
  and built-in functions (`sendJSONResp`, `requirelib`, `includes`, `execd`, …);
  libraries are pulled in on demand with `requirelib("filelib")` and friends.
- **Full API reference:** [`src/mod/agi/README.md`](src/mod/agi/README.md). When
  you change AGI functions or signatures, also update the in-app help data file
  [`src/web/Terminal/docs/api.json`](src/web/Terminal/docs/api.json) to match.

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
- [`src/web/`](src/web/) — front-end assets and web apps.
- [`src/system/`](src/system/) — runtime data and config (not shipped in release).
