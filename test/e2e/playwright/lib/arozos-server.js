/*
    ArozOS test-instance launcher for the full-stack E2E specs.

    Boots a disposable, real ArozOS server (the Go binary built from src/)
    inside an isolated instance folder, so specs can exercise genuine
    authentication, desktop, file system and admin APIs without touching
    the developer's own runtime data under src/.

    Instance layout (recreated from scratch on every start):

        .instance/
        ├── web        symlink to ../../../src/web (static assets, read-only)
        ├── system     private copy of src/system (ao.db + runtime state)
        ├── files/     user home directories (created by the server)
        ├── tmp/       scratch space (created by the server)
        └── server.log combined stdout/stderr of the server process

    Because the instance is wiped each start, the server always boots in
    the zero-user state and bootstrapAdmin() creates a deterministic
    administrator account through the same public endpoint the first-boot
    wizard (user.html) posts to.

    Env:
      AROZOS_BIN   path to a prebuilt arozos binary (default: src/arozos,
                   built automatically with `go build` when missing)
*/
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const WEB_ROOT = path.join(SRC_DIR, "web");
const SYSTEM_TEMPLATE = path.join(SRC_DIR, "system");
const INSTANCE_DIR = path.resolve(__dirname, "../.instance");

const DEFAULT_PORT = 8126;
const ADMIN_USER = "admin";
const ADMIN_PASS = "e2e-Admin-Passw0rd";

function binaryName() {
    return process.platform === "win32" ? "arozos.exe" : "arozos";
}

// Locate the server binary, building it with `go build` when missing.
function resolveBinary() {
    if (process.env.AROZOS_BIN && fs.existsSync(process.env.AROZOS_BIN)) {
        return path.resolve(process.env.AROZOS_BIN);
    }
    const builtBin = path.join(SRC_DIR, binaryName());
    if (fs.existsSync(builtBin)) {
        return builtBin;
    }
    console.log("  arozos binary not found, building it (go build)...");
    const res = spawnSync("go", ["build", "-o", binaryName(), "."], {
        cwd: SRC_DIR,
        stdio: "inherit"
    });
    if (res.status !== 0 || !fs.existsSync(builtBin)) {
        throw new Error("Failed to build the arozos binary. Install Go or set AROZOS_BIN.");
    }
    return builtBin;
}

// Wipe and recreate the isolated instance directory.
function prepareInstanceDir() {
    fs.rmSync(INSTANCE_DIR, { recursive: true, force: true });
    fs.mkdirSync(INSTANCE_DIR, { recursive: true });
    fs.symlinkSync(WEB_ROOT, path.join(INSTANCE_DIR, "web"), "dir");
    fs.cpSync(SYSTEM_TEMPLATE, path.join(INSTANCE_DIR, "system"), { recursive: true });
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitUntilReady(baseURL, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(baseURL + "/system/auth/checkLogin");
            if (res.ok) { return; }
            lastError = new Error("HTTP " + res.status);
        } catch (e) {
            lastError = e;
        }
        await sleep(250);
    }
    throw new Error("ArozOS server did not become ready in time: " + (lastError ? lastError.message : "unknown"));
}

// Create the first (admin) account on a freshly wiped instance.
async function bootstrapAdmin(baseURL) {
    const res = await fetch(baseURL + "/system/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            username: ADMIN_USER,
            password: ADMIN_PASS,
            group: "administrator"
        })
    });
    const text = (await res.text()).trim().toLowerCase();
    if (text.indexOf("ok") === -1) {
        throw new Error("Admin bootstrap failed: " + text);
    }
}

/*
    Start a disposable ArozOS server.
    Returns { baseURL, admin: {username, password}, stop() }.
*/
async function start(options) {
    options = options || {};
    const port = options.port || Number(process.env.AROZ_PORT) || DEFAULT_PORT;
    const binary = resolveBinary();
    prepareInstanceDir();

    const logStream = fs.createWriteStream(path.join(INSTANCE_DIR, "server.log"));
    const args = [
        "-port", String(port),
        "-hostname", "E2E ArozOS",
        // Keep the test instance quiet and self-contained: no LAN discovery
        // broadcasts, no hardware/power hooks, no package auto-install and
        // no child subservice processes.
        "-allow_mdns=false",
        "-allow_ssdp=false",
        "-allow_upnp=false",
        "-allow_iot=false",
        "-disable_subservice",
        "-enable_hwman=false",
        "-enable_pwman=false",
        "-allow_pkg_install=false",
        "-enable_docker=false",
        "-arozcast_turn=false"
    ];
    const proc = spawn(binary, args, {
        cwd: INSTANCE_DIR,
        stdio: ["ignore", "pipe", "pipe"]
    });
    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);

    let exited = false;
    proc.on("exit", function () { exited = true; });

    const baseURL = "http://127.0.0.1:" + port;
    try {
        await waitUntilReady(baseURL, 120000);
        await bootstrapAdmin(baseURL);
    } catch (e) {
        proc.kill("SIGKILL");
        throw e;
    }

    function stop() {
        return new Promise(function (resolve) {
            if (exited) { return resolve(); }
            proc.on("exit", function () { resolve(); });
            proc.kill("SIGTERM");
            // Escalate if the server ignores SIGTERM.
            setTimeout(function () {
                if (!exited) { proc.kill("SIGKILL"); }
            }, 8000).unref();
        });
    }

    return {
        baseURL: baseURL,
        admin: { username: ADMIN_USER, password: ADMIN_PASS },
        instanceDir: INSTANCE_DIR,
        stop: stop
    };
}

module.exports = {
    start,
    ADMIN_USER,
    ADMIN_PASS,
    INSTANCE_DIR
};
