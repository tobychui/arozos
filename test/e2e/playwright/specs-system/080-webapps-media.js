/*
    WebApp wave 3: media / creative apps.

    Smoke coverage for the media and creative WebApps served by the real
    ArozOS server with an authenticated session:

        Musicify, Movie, Manga, Paint, Pixel Studio, Audio Studio,
        Camera, Recorder, FFmpeg Factory

    (Cine Studio has its own deep static suite under specs/, so it is not
    repeated here.) Each app must load its entry page and render its key
    UI element. Camera/Recorder request getUserMedia, which is denied in
    headless Chromium - the assertion targets the shell, not the stream.
*/
"use strict";

const h = require("../lib/system-harness");

const APPS = [
    { name: "Musicify", path: "/Musicify/index.html", selector: "#musicPlayer" },
    { name: "Movie", path: "/Movie/index.html", selector: "#mode-tabs" },
    { name: "Manga", path: "/Manga/index.html", selector: "#appHeader" },
    { name: "Paint", path: "/Paint/index.html", selector: ".ptro-bar" },
    { name: "Pixel Studio", path: "/Pixel%20Studio/index.html", selector: "#toolbar-buttons" },
    { name: "Audio Studio", path: "/Audio%20Studio/index.html", selector: "#toolbar" },
    { name: "Camera", path: "/Camera/index.html", selector: "#viewfinder" },
    { name: "Recorder", path: "/Recorder/index.html", selector: "#record" },
    { name: "FFmpeg Factory", path: "/FFmpeg%20Factory/index.html", selector: "#leftPanel" }
];

h.run("WEBAPPS-MEDIA", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);
    page.on("dialog", function (d) { d.dismiss().catch(function () {}); });

    // ── 1. Every media app boots and renders its main UI ──
    for (const app of APPS) {
        await page.goto(base + app.path, { waitUntil: "domcontentloaded" });
        try {
            await page.waitForSelector(app.selector, { state: "attached", timeout: 20000 });
        } catch (e) {
            h.fail(app.name + " did not render " + app.selector + " at " + app.path);
        }
        h.ok(app.name + " boots and renders its main UI");
    }

    // ── 2. Media browsers can reach the user's storage to build libraries ──
    // Musicify / Movie / Manga all populate their library from listRoots +
    // listDir; a probe under this session guards the data path they use.
    const roots = await h.getJSON(page, base + "/system/file_system/listRoots");
    if (JSON.stringify(roots).indexOf("user") === -1) {
        h.fail("media library apps have no user root to browse");
    }
    h.ok("media library apps have the user storage root available");

    await page.close();
});
