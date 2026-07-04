# ArozOS — end-to-end tests

Browser-driven Playwright tests for ArozOS, organized into two suites:

- **static** (`specs/`) — front-end-only specs for the **Cine Studio**
  WebApp, served by a tiny static file server. No Go involved.
- **system** (`specs-system/`) — full-stack critical-path specs driven
  against a **real ArozOS server** (the Go binary built from `src/`),
  covering sign in / sign out, the desktop shell, the file explorer,
  system settings, and user management / permission control.

Everything lives outside `src/` so it never interferes with the Go module.

## Layout

```
test/e2e/playwright/
├── package.json          Playwright dependency + npm test scripts
├── run.js                orchestrator: runs the static and system suites
├── lib/
│   ├── static-server.js  minimal static server for the ArozOS web root
│   ├── harness.js        Cine Studio helpers (browser launch, ok/fail)
│   ├── arozos-server.js  boots a disposable real ArozOS instance
│   └── system-harness.js login/API helpers for the system suite
├── specs/                Cine Studio specs (static suite)
│   ├── functional.js     media probe, playback, edit, round-trip, export
│   ├── features.js       effects, titles, transitions, elements, filters
│   ├── interaction.js    preview drag/resize, auto tracks, project import
│   └── editing.js        multi-select, copy/paste, speed, JKL, markers…
└── specs-system/         full-stack critical-path specs (system suite)
    ├── 010-auth.js       login page, bad credentials, form login,
    │                     session persistence, logout, gated redirects
    ├── 020-desktop.js    desktop shell, start menu, module list,
    │                     quick access panel, desktop sign-out
    ├── 030-file-explorer.js  File Manager UI + full file lifecycle:
    │                     create/rename/copy/move/properties/trash, CSRF
    ├── 040-system-settings.js  System Setting UI + settings catalogue
    └── 050-users-permissions.js  group + user CRUD, module visibility,
                          admin-only endpoint enforcement
```

## How the system suite works

`lib/arozos-server.js` boots the real server in an isolated throwaway
folder (`.instance/`, gitignored): `web/` is a symlink to `src/web`,
`system/` is a private copy of the `src/system` template, and the user
files / database are created fresh by the server itself. Because every
run starts at the zero-user state, the harness registers a
deterministic `admin` account through the same endpoint the first-boot
wizard uses, then hands specs a base URL plus those credentials.

The server binary is `src/arozos` (or `AROZOS_BIN`); when missing it is
built automatically with `go build`.

## Running locally

```bash
cd test/e2e/playwright
npm install
npx playwright install chromium
npm test              # both suites
npm run test:static   # Cine Studio only (no Go needed)
npm run test:system   # full-stack critical paths only
```

Run a single system spec (it boots its own private server):

```bash
node specs-system/010-auth.js
```

Or point specs at an already-running test instance:

```bash
AROZ_BASE_URL=http://127.0.0.1:8126 \
AROZ_ADMIN_USER=admin AROZ_ADMIN_PASS=... node specs-system/020-desktop.js
```

### Useful env vars

| Var | Purpose |
| --- | --- |
| `E2E_SUITE` | `static`, `system` or `all` (default `all`) |
| `CS_BASE_URL` | Point a Cine Studio spec at an already-running static server |
| `WEB_PORT` | Port for the built-in static server (default `8123`) |
| `AROZ_PORT` | Port for the disposable ArozOS instance (default `8126`) |
| `AROZ_BASE_URL` | Reuse an already-running ArozOS test instance |
| `AROZOS_BIN` | Prebuilt arozos binary (default `src/arozos`, auto-built) |
| `PW_CHROMIUM_PATH` | Use a preinstalled Chromium binary |

When a system spec fails, check `.instance/server.log` for the server
side of the story.

## CI

`.github/workflows/e2e-playwright.yml` builds the Go binary and runs
both suites on any push or pull request touching `src/` or this
harness, and uploads `.instance/server.log` as an artifact on failure.
