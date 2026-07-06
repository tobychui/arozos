/*
    Shared harness for the full-stack (real server) E2E specs.

    Each spec in specs-system/ is a standalone runnable Node script. When
    executed through run.js a shared server is already up and its address
    arrives via AROZ_BASE_URL; when a spec is run directly with no
    AROZ_BASE_URL, the harness boots its own disposable server so
    `node specs-system/010-auth.js` still works on its own.

    Env:
      AROZ_BASE_URL     base URL of an already-running test instance
      AROZ_ADMIN_USER   admin username of that instance (default "admin")
      AROZ_ADMIN_PASS   admin password of that instance
      PW_CHROMIUM_PATH  optional explicit Chromium binary
*/
"use strict";

const { chromium } = require("playwright");
const arozosServer = require("./arozos-server");

function ok(msg) { console.log("  PASS: " + msg); }

function fail(msg) {
    console.error("  FAIL: " + msg);
    process.exit(1);
}

function launch() {
    return chromium.launch({
        executablePath: process.env.PW_CHROMIUM_PATH || undefined,
        args: ["--autoplay-policy=no-user-gesture-required"]
    });
}

async function newPage(browser) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", function (e) { console.log("  [pageerror] " + e.message); });
    return page;
}

// Log in through the real login form UI. Resolves once the browser has
// been redirected away from login.html.
async function loginViaForm(page, baseURL, username, password) {
    await page.goto(baseURL + "/login.html", { waitUntil: "domcontentloaded" });
    await page.fill("#username", username);
    await page.fill("#magic", password);
    await Promise.all([
        page.waitForURL(function (url) { return url.pathname.indexOf("login.html") === -1; }, { timeout: 15000 }),
        page.click("#loginbtn")
    ]);
}

// Log in via the auth API using the page's cookie jar (fast path for
// specs that are not about the login UI itself).
async function loginViaAPI(page, baseURL, username, password) {
    const res = await page.request.post(baseURL + "/system/auth/login", {
        form: { username: username, password: password, rmbme: "false" }
    });
    const body = (await res.text()).trim();
    const authed = (await (await page.request.get(baseURL + "/system/auth/checkLogin")).text()).trim();
    if (authed !== "true") {
        throw new Error("API login failed for " + username + ": " + body);
    }
}

async function logout(page, baseURL) {
    await page.request.get(baseURL + "/system/auth/logout");
}

async function isLoggedIn(page, baseURL) {
    const res = await page.request.get(baseURL + "/system/auth/checkLogin");
    return (await res.text()).trim() === "true";
}

// GET a JSON endpoint with the page's session cookies.
async function getJSON(page, url) {
    const res = await page.request.get(url);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error("Expected JSON from " + url + " but got: " + text.slice(0, 200));
    }
}

// POST form parameters, returning the raw response text.
async function postForm(page, url, form) {
    const res = await page.request.post(url, { form: form });
    return (await res.text()).trim();
}

// Fetch a fresh CSRF token for endpoints that require one (fileOpr, newItem).
async function csrfToken(page, baseURL) {
    const token = await getJSON(page, baseURL + "/system/csrf/new");
    if (typeof token !== "string" || !token.length) {
        throw new Error("Could not obtain CSRF token");
    }
    return token;
}

/*
    Wrap a spec body. Boots a private server when AROZ_BASE_URL is not
    provided, launches the browser, and reports the pass/fail banner.
    body receives ({ browser, baseURL, admin }).
*/
function run(name, body) {
    (async function () {
        let server = null;
        let baseURL = process.env.AROZ_BASE_URL;
        let admin = {
            username: process.env.AROZ_ADMIN_USER || arozosServer.ADMIN_USER,
            password: process.env.AROZ_ADMIN_PASS || arozosServer.ADMIN_PASS
        };
        if (!baseURL) {
            console.log("  AROZ_BASE_URL not set - booting a private ArozOS test instance...");
            server = await arozosServer.start({});
            baseURL = server.baseURL;
            admin = server.admin;
        }

        const browser = await launch();
        try {
            await body({ browser: browser, baseURL: baseURL, admin: admin });
            console.log("ALL " + name + " TESTS PASSED");
        } finally {
            await browser.close();
            if (server) { await server.stop(); }
        }
    })().catch(function (e) {
        console.error(e);
        process.exit(1);
    });
}

module.exports = {
    ok,
    fail,
    launch,
    newPage,
    loginViaForm,
    loginViaAPI,
    logout,
    isLoggedIn,
    getJSON,
    postForm,
    csrfToken,
    run
};
