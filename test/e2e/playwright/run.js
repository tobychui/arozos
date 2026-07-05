/*
    ArozOS E2E runner.

    Orchestrates two Playwright suites:

      static  specs/          Cine Studio front-end specs, served by a
                              plain static file server (no Go involved).
      system  specs-system/   Full-stack critical-path specs (auth,
                              desktop, file explorer, system settings,
                              user management) driven against a real
                              ArozOS server booted from the Go binary.

    Each spec runs in its own Node process; the runner exits non-zero if
    any spec fails, so CI turns red on the first regression.

    Env:
      E2E_SUITE   which suite(s) to run: "static", "system" or "all"
                  (default "all")
      WEB_PORT    port for the static server        (default 8123)
      AROZ_PORT   port for the ArozOS test instance (default 8126)
      AROZOS_BIN  prebuilt arozos binary (default src/arozos, built with
                  `go build` when missing)
*/
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const staticServer = require("./lib/static-server");
const arozosServer = require("./lib/arozos-server");

const WEB_ROOT = path.resolve(__dirname, "../../../src/web");
const STATIC_SPECS_DIR = path.join(__dirname, "specs");
const SYSTEM_SPECS_DIR = path.join(__dirname, "specs-system");

function runSpec(specPath, extraEnv) {
    return new Promise(function (resolve) {
        const child = spawn(process.execPath, [specPath], {
            stdio: "inherit",
            env: Object.assign({}, process.env, extraEnv)
        });
        child.on("exit", function (code) { resolve(code || 0); });
    });
}

function listSpecs(dir) {
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir)
        .filter(function (f) { return f.endsWith(".js"); })
        .sort()
        .map(function (f) { return path.join(dir, f); });
}

async function runSuite(title, specs, extraEnv) {
    let failures = 0;
    for (const spec of specs) {
        console.log("── [" + title + "] " + path.basename(spec) + " ──────────────────────────");
        const code = await runSpec(spec, extraEnv);
        if (code !== 0) { failures++; console.log("  spec exited with code " + code); }
        console.log("");
    }
    return failures;
}

(async function () {
    const suite = (process.env.E2E_SUITE || "all").toLowerCase();
    let totalSpecs = 0;
    let totalFailures = 0;

    // ── Static suite (Cine Studio) ──
    if (suite === "all" || suite === "static") {
        if (!fs.existsSync(path.join(WEB_ROOT, "Cine Studio", "index.html"))) {
            console.error("Cannot find Cine Studio web app under " + WEB_ROOT);
            process.exit(1);
        }
        const specs = listSpecs(STATIC_SPECS_DIR);
        totalSpecs += specs.length;
        const { server, baseURL } = await staticServer.start(WEB_ROOT, Number(process.env.WEB_PORT) || 8123);
        console.log("Serving " + WEB_ROOT + " at " + baseURL + " (static suite)\n");
        totalFailures += await runSuite("static", specs, { CS_BASE_URL: baseURL });
        server.close();
    }

    // ── System suite (real ArozOS server) ──
    if (suite === "all" || suite === "system") {
        const specs = listSpecs(SYSTEM_SPECS_DIR);
        totalSpecs += specs.length;
        if (specs.length) {
            console.log("Booting ArozOS test instance (system suite)...");
            const srv = await arozosServer.start({});
            console.log("ArozOS test instance ready at " + srv.baseURL + "\n");
            try {
                totalFailures += await runSuite("system", specs, {
                    AROZ_BASE_URL: srv.baseURL,
                    AROZ_ADMIN_USER: srv.admin.username,
                    AROZ_ADMIN_PASS: srv.admin.password
                });
            } finally {
                await srv.stop();
            }
        }
    }

    if (totalFailures) {
        console.error(totalFailures + " of " + totalSpecs + " spec file(s) failed.");
        process.exit(1);
    }
    console.log("All " + totalSpecs + " spec file(s) passed.");
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
