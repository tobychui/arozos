# Cine Studio — Cypress end-to-end tests

Browser-driven Cypress tests for the **Cine Studio** WebApp
(`src/web/Cine Studio`). They drive the real app in Electron / Chromium,
generate their own media in-page (canvas → MediaRecorder WebM, synthesised
WAV, canvas PNG) and assert on rendered pixels and project state, so they
exercise the compositor, the editing model and the playback pipeline rather
than mocks. The app runs in **standalone mode** (no ArozOS backend); the
server-side render and proxy paths are covered by the Go tests in
`src/mod/media/render` and `src/mod/agi`.

## Running locally

```bash
cd test/e2e/cypress
npm install
node serve.js &            # serves src/web on http://127.0.0.1:8123
npm test                   # headless Electron
npm run cy:open            # interactive runner
```

Point the suite at another server with `CS_BASE_URL=http://host:port npm test`.

## Layout

```
cypress/support/e2e.js     commands: openStudio, seedMedia, cs, pixelAt, centerPixel
cypress/e2e/00_smoke       boot, import, playback, split / undo / redo
cypress/e2e/10_tools       Premiere toolset: ripple / rolling / slip / slide /
                           rate stretch / track select, lock, lift / extract
cypress/e2e/20_keyframes   keyframed motion, opacity and volume
cypress/e2e/30_transitions video + audio transitions, adjustment layers, chroma key
cypress/e2e/40_titles      text styling, captions import / export
cypress/e2e/50_source      source monitor, in / out, insert / overwrite
```
