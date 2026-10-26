/*
    Shared harness for the Cine Studio E2E specs.

    Each spec is a standalone runnable Node script (so it works both via
    `node run.js` and directly, e.g. `CS_BASE_URL=... node specs/functional.js`).
    The harness centralizes browser launch, app navigation and the
    pass/fail reporting helpers.

    Env:
      CS_BASE_URL       base URL the app is served from (default :8123)
      PW_CHROMIUM_PATH  optional explicit Chromium binary; otherwise
                        Playwright resolves its own installed browser
*/
"use strict";

const { chromium } = require("playwright");

const BASE = process.env.CS_BASE_URL || "http://127.0.0.1:8123";
const APP_URL = BASE + "/Cine%20Studio/index.html";

function ok(msg) { console.log("  PASS: " + msg); }

function fail(msg) {
    console.error("  FAIL: " + msg);
    process.exit(1);
}

function launch() {
    return chromium.launch({
        // Undefined lets Playwright resolve its installed browser (CI);
        // set PW_CHROMIUM_PATH to point at a preinstalled binary locally.
        executablePath: process.env.PW_CHROMIUM_PATH || undefined,
        args: ["--autoplay-policy=no-user-gesture-required"]
    });
}

// Open the app and wait until the editor global (CS) has booted.
async function openApp(browser, viewport) {
    const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 853 } });
    page.on("pageerror", function (e) { console.log("  [pageerror] " + e.message); });
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(function () { return window.CS && CS.project; });
    return page;
}

// Wrap a spec body: run it, report a banner, exit non-zero on throw.
function run(name, body) {
    (async function () {
        const browser = await launch();
        try {
            const page = await openApp(browser);
            await body(page, browser);
            console.log("ALL " + name + " TESTS PASSED");
        } finally {
            await browser.close();
        }
    })().catch(function (e) {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { BASE, APP_URL, ok, fail, launch, openApp, run };
