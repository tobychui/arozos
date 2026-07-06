# Cine Studio — end-to-end tests

Browser-driven Playwright tests for the **Cine Studio** WebApp
(`src/web/Cine Studio`). They drive the real app in headless Chromium,
generating their own media in-page (canvas → MediaRecorder WebM, synthesized
WAV) and asserting on actual rendered pixels, so they exercise the full
compositor/playback/export pipeline rather than mocking it.

These tests are front-end only. They do **not** build or run any Go code and
live outside `src/` so they never interfere with the Go module.

## Layout

```
test/e2e/playwright/
├── package.json          Playwright dependency + `npm test`
├── run.js                orchestrator: serves src/web, runs each spec
├── lib/
│   ├── static-server.js  minimal static server for the ArozOS web root
│   └── harness.js        browser launch, app navigation, ok()/fail()
└── specs/
    ├── functional.js     media probe, playback, edit, round-trip, WebM export
    ├── features.js       effects, titles, transitions, elements, filters
    ├── interaction.js    preview drag/resize, auto tracks, .pxs/.asproj import
    └── editing.js        multi-select, copy/paste, speed, JKL, markers, autosave…
```

## Running locally

```bash
cd test/e2e/playwright
npm install
npx playwright install chromium
npm test
```

`run.js` starts a static server for `src/web` (default port 8123) and runs
every spec in `specs/` in its own process, exiting non-zero if any fails.

### Useful env vars

| Var | Purpose |
| --- | --- |
| `CS_BASE_URL` | Point a spec at an already-running server instead of starting one |
| `WEB_PORT` | Port for the built-in static server (default `8123`) |
| `PW_CHROMIUM_PATH` | Use a preinstalled Chromium binary instead of Playwright's own |

Run a single spec against the running server:

```bash
CS_BASE_URL=http://127.0.0.1:8123 node specs/functional.js
```

## CI

`.github/workflows/e2e-playwright.yml` runs the suite on pushes and pull
requests that touch the app or this harness.
