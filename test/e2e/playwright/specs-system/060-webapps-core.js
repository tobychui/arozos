/*
    WebApp wave 1: core daily-driver apps.

    Smoke coverage for the highest-importance WebApps - the default
    openers for everyday file types - served by the real ArozOS server
    with a real authenticated session:

        NotepadA, Text, Photo, Music, Video, PDF Viewer, Zip File Manager

    Each app must load its entry page and render its key UI element.
    NotepadA additionally opens a real file through the same
    hash-parameter convention the desktop uses (ao_module_loadInputFiles).
*/
"use strict";

const h = require("../lib/system-harness");

// App entry pages and the element that proves the app booted.
const APPS = [
    { name: "NotepadA", path: "/NotepadA/index.html", selector: "#codeArea" },
    { name: "Text", path: "/Text/index.html", selector: "#toolbar" },
    { name: "Photo", path: "/Photo/index.html", selector: "#content-area" },
    { name: "Music", path: "/Music/index.html", selector: "#mainMenu" },
    { name: "Video", path: "/Video/index.html", selector: "#playList" },
    { name: "PDF Viewer", path: "/PDF%20Viewer/viewer.html", selector: "#outerContainer" },
    { name: "Zip File Manager", path: "/Zip%20File%20Manager/index.html", selector: "#listContainer" }
];

h.run("WEBAPPS-CORE", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // ── 1. Every core app boots and renders its main UI ──
    for (const app of APPS) {
        await page.goto(base + app.path, { waitUntil: "domcontentloaded" });
        try {
            await page.waitForSelector(app.selector, { state: "attached", timeout: 20000 });
        } catch (e) {
            h.fail(app.name + " did not render " + app.selector + " at " + app.path);
        }
        h.ok(app.name + " boots and renders its main UI");
    }

    // ── 2. NotepadA opens a real file through the desktop convention ──
    const csrft = await h.csrfToken(page, base);
    const resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "file", src: "user:/", filename: "e2e-open.txt", csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not create test file: " + resp);

    const fileRef = encodeURIComponent(JSON.stringify([
        { filename: "e2e-open.txt", filepath: "user:/e2e-open.txt" }
    ]));
    await page.goto(base + "/NotepadA/index.html#" + fileRef, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#codeArea", { state: "attached", timeout: 20000 });
    try {
        // Each opened file becomes a .fileTab carrying its filepath in the
        // "filename" attribute (the visible label loads asynchronously).
        await page.waitForFunction(function () {
            var tabs = document.querySelectorAll(".fileTab");
            for (var i = 0; i < tabs.length; i++) {
                var fn = tabs[i].getAttribute("filename") || "";
                if (fn.indexOf("e2e-open.txt") !== -1) { return true; }
            }
            return false;
        }, { timeout: 20000 });
    } catch (e) {
        h.fail("NotepadA did not open e2e-open.txt in a tab");
    }
    h.ok("NotepadA opens a file passed via the desktop hash convention");

    // ── 3. Music app can see the user's storage roots ──
    // (Music builds its library from the same listRoots/listDir APIs; a
    // quick API probe under this session guards the data path the app uses.)
    const roots = await h.getJSON(page, base + "/system/file_system/listRoots");
    if (JSON.stringify(roots).indexOf("user") === -1) {
        h.fail("media apps have no user root to browse");
    }
    h.ok("media apps have the user storage root available");

    // Cleanup
    const csrft2 = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete", src: JSON.stringify(["user:/e2e-open.txt"]), csrft: csrft2
    });

    await page.close();
});
