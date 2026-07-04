/*
    Cine Studio E2E runner.

    Starts a static server for the ArozOS web root, then runs each spec
    in its own Node process against it. Exits non-zero if any spec fails,
    so CI turns red on the first regression. The banner from each spec's
    final assertion is printed inline.
*/
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const staticServer = require("./lib/static-server");

const WEB_ROOT = path.resolve(__dirname, "../../../src/web");
const SPECS_DIR = path.join(__dirname, "specs");

function runSpec(specPath, baseURL) {
    return new Promise(function (resolve) {
        const child = spawn(process.execPath, [specPath], {
            stdio: "inherit",
            env: Object.assign({}, process.env, { CS_BASE_URL: baseURL })
        });
        child.on("exit", function (code) { resolve(code || 0); });
    });
}

(async function () {
    if (!fs.existsSync(path.join(WEB_ROOT, "Cine Studio", "index.html"))) {
        console.error("Cannot find Cine Studio web app under " + WEB_ROOT);
        process.exit(1);
    }

    const specs = fs.readdirSync(SPECS_DIR)
        .filter(function (f) { return f.endsWith(".js"); })
        .sort();
    if (!specs.length) {
        console.error("No specs found in " + SPECS_DIR);
        process.exit(1);
    }

    const { server, baseURL } = await staticServer.start(WEB_ROOT, Number(process.env.WEB_PORT) || 8123);
    console.log("Serving " + WEB_ROOT + " at " + baseURL + "\n");

    let failures = 0;
    for (const spec of specs) {
        console.log("── " + spec + " ──────────────────────────────────");
        const code = await runSpec(path.join(SPECS_DIR, spec), baseURL);
        if (code !== 0) { failures++; console.log("  spec exited with code " + code); }
        console.log("");
    }

    server.close();

    if (failures) {
        console.error(failures + " of " + specs.length + " spec file(s) failed.");
        process.exit(1);
    }
    console.log("All " + specs.length + " spec file(s) passed.");
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
