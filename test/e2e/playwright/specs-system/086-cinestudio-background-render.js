/*
    Cine Studio: a server-side export must not need the browser once it runs.

    Against a real ArozOS server, this spec starts real exports and then takes
    the tab away:

      1. close the tab      the render keeps going with no page open, finishes,
                            writes the file, removes its own scratch folder and
                            sends the user a notification
      2. reopen the app     the finished export is reported once and its job
                            record is dropped
      3. reopen mid-render  a render that is still running gets its progress
                            dialog back and completes
      4. cancel             a cancelled render leaves no output, no scratch
                            folder, no job record and sends no notification
      5. leaving early      closing the tab while the export is still being
                            prepared (before the server has it) is guarded

    Needs ffmpeg + ffprobe on this machine and on the server under test.
*/
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const h = require("../lib/system-harness");

const APP = "/Cine Studio/index.html";
const MEDIA_DIR = "user:/Cine Studio/Media";
const EXPORT_DIR = "user:/Cine Studio/Exports";
const CACHE_DIR = "user:/Cine Studio/Cache";
const BACKEND = "Cine Studio/backend/ffmpegtools.js";

function haveTool(name) {
    const r = spawnSync(name, ["-version"], { encoding: "utf8" });
    return !r.error && r.status === 0;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function until(what, fn, timeoutMs, everyMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = await fn();
        if (v) { return v; }
        if (Date.now() > deadline) { h.fail("timed out waiting for " + what); }
        await sleep(everyMs || 1000);
    }
}

h.run("CINESTUDIO-BACKGROUND-RENDER", async function (env) {
    if (!haveTool("ffmpeg") || !haveTool("ffprobe")) {
        console.log("  SKIP: ffmpeg / ffprobe not installed on this machine");
        return;
    }
    const base = env.baseURL;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "cs-background-"));
    const ctx = await env.browser.newContext({ viewport: { width: 1366, height: 900 } });
    const first = await ctx.newPage();
    await h.loginViaAPI(first, base, env.admin.username, env.admin.password);
    const api = ctx.request;   // shares the login, needs no page

    async function agi(params) {
        const res = await api.post(base + "/system/ajgi/interface?script=" + encodeURIComponent(BACKEND), { form: params });
        return JSON.parse(await res.text());
    }
    async function listDir(dir) {
        return h.postForm(first, base + "/system/file_system/listDir", { dir: dir });
    }
    async function scratchDirs() {
        const listing = JSON.parse(await listDir(CACHE_DIR));
        return listing.filter(function (f) { return /render_/.test(f.Filename || f.filename || ""); })
            .map(function (f) { return f.Filename || f.filename; });
    }
    async function desktopNotifications() {
        const res = await api.get(base + "/system/notification/desktop/list");
        try { return JSON.parse(await res.text()); } catch (e) { return []; }
    }
    function notificationsAbout(list, name) {
        return (Array.isArray(list) ? list : []).filter(function (n) { return JSON.stringify(n).indexOf(name) !== -1; });
    }

    // footage
    const red = path.join(work, "red.mp4");
    const gen = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=1280x720:r=30:d=3",
        "-f", "lavfi", "-i", "sine=frequency=440:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", red]);
    if (gen.status !== 0) { h.fail("could not generate footage"); }
    await first.goto(base + APP, { waitUntil: "domcontentloaded" });
    await first.waitForFunction(function () { return window.CS && CS._ffmpegChecked; }, null, { timeout: 30000 });
    for (let i = 0; i < 20; i++) {
        if ((await listDir("user:/Cine Studio")).indexOf("Media") !== -1) { break; }
        await sleep(500);
    }
    const up = await first.request.post(base + "/system/file_system/upload", {
        multipart: { path: MEDIA_DIR, file: { name: "red.mp4", mimeType: "video/mp4", buffer: fs.readFileSync(red) } }
    });
    if ((await up.text()).toLowerCase().indexOf("ok") === -1) { h.fail("footage upload failed"); }
    await first.close();

    async function openStudio() {
        const page = await ctx.newPage();
        page.on("pageerror", function (e) { console.log("  [pageerror] " + e.message); });
        await page.addInitScript(function () {
            window.__toasts = [];
            window.CS = window.CS || {};
            let real;
            Object.defineProperty(window.CS, "toast", {
                configurable: true,
                get: function () { return real; },
                set: function (fn) {
                    real = function (msg, isErr) { window.__toasts.push((isErr ? "ERR: " : "") + msg); return fn.apply(this, arguments); };
                }
            });
        });
        await page.goto(base + APP, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(function () { return window.CS && CS._ffmpegChecked && CS.project; }, null, { timeout: 30000 });
        return page;
    }

    // 6 clips of 3 s with film grain at 720p: long enough to close a tab in the middle
    async function buildTimeline(page) {
        await page.evaluate(function (dir) {
            CS.newProject({ name: "Background", width: 1280, height: 720, fps: 30 });
            CS.player.applyProjectSize();
            window.__m = CS.media.addFromVpath(dir + "/red.mp4", "red.mp4");
        }, MEDIA_DIR);
        await page.waitForFunction(function () { return __m.probed && __m.proxyState !== "pending"; }, null, { timeout: 60000 });
        return page.evaluate(function () {
            for (let i = 0; i < 6; i++) {
                const c = CS.addClipToTimeline(__m, "V1", i * 3);
                CS.effects.applyToClip(c, "grain");
            }
            CS.player.seek(1);
            CS.titles.insertPreset("title");
            CS.selectedClip().props.text.content = "BACKGROUND";
            CS.titles.invalidate(CS.selectedClip());
            CS.commit("seed");
            return CS.timelineDuration();
        });
    }

    // Click through the dialog; resolves once the server has accepted the render
    async function startExport(page, name) {
        await page.click("#btn-export");
        await page.waitForSelector(".modal .modal-title");
        await page.locator(".modal-row", { hasText: "Filename" }).locator("input").fill(name);
        await page.click(".modal-btn.primary");
        await page.waitForFunction(function () { return CS.exporter.job && CS.exporter.job.progress; }, null, { timeout: 120000 });
        return page.evaluate(function () { return { progress: CS.exporter.job.progress, dir: CS.exporter.job.dir }; });
    }

    async function jobRecord(name) {
        const data = await agi({ action: "jobs" });
        return (data.jobs || []).filter(function (j) { return j.name === name; })[0] || null;
    }

    const scratchBefore = await scratchDirs();
    const notesBefore = await desktopNotifications();

    /* ---- 1. close the tab mid-render ---- */
    const p1 = await openStudio();
    const total = await buildTimeline(p1);
    const job1 = await startExport(p1, "bg_close");
    const scratch1 = job1.dir.slice(job1.dir.lastIndexOf("/") + 1);
    if ((await scratchDirs()).indexOf(scratch1) === -1) { h.fail("expected the job's scratch folder to exist while it renders"); }
    await p1.close();
    console.log("  tab closed at the moment the server accepted the render");

    const running = await until("the job record of the render started by the closed tab", function () { return jobRecord("bg_close.mp4"); }, 30000, 500);
    if (running.completed) { h.fail("the render finished before it could be observed running - make the timeline longer"); }
    h.ok("with no tab open the server is rendering it (stage '" + running.stage + "', " + Math.round(running.percentage) + "%)");

    const done = await until("the render to finish with no tab open", async function () {
        const j = await jobRecord("bg_close.mp4");
        if (j && j.stage === "failed") { h.fail("the render failed with the tab closed: " + j.error); }
        return j && j.completed && j.exists ? j : null;
    }, 400000, 2000);
    const out1 = path.join(work, "bg_close.mp4");
    const dl = await api.get(base + "/media/?file=" + encodeURIComponent(EXPORT_DIR + "/bg_close.mp4"));
    fs.writeFileSync(out1, await dl.body());
    const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", out1], { encoding: "utf8" }).stdout);
    const v1 = probe.streams.filter(function (s) { return s.codec_type === "video"; })[0];
    const dur1 = parseFloat(probe.format.duration);
    if (!v1 || v1.codec_name !== "h264" || v1.width !== 1280 || v1.height !== 720) { h.fail("output is not 1280x720 H.264"); }
    if (Math.abs(dur1 - total) > 0.3) { h.fail("output lasts " + dur1 + "s, want about " + total + "s"); }
    h.ok("the file was written to " + EXPORT_DIR + " with no tab open: H.264 " + v1.width + "x" + v1.height + ", " + dur1.toFixed(2) + "s");

    if ((await scratchDirs()).indexOf(scratch1) !== -1) { h.fail("the scratch folder " + scratch1 + " was left behind"); }
    h.ok("the server removed the job's scratch folder itself (the browser never got to)");

    const note = await until("the finished-export notification", async function () {
        return notificationsAbout(await desktopNotifications(), "Export finished: bg_close.mp4")[0];
    }, 20000, 1000);
    h.ok("the user was notified: " + JSON.stringify(note).slice(0, 120));

    /* ---- 2. reopen: the finished export is reported once ---- */
    const p2 = await openStudio();
    await p2.waitForFunction(function () { return __toasts.some(function (t) { return t.indexOf("Exported bg_close.mp4") !== -1; }); }, null, { timeout: 20000 });
    await until("the job record to be acknowledged", async function () { return !(await jobRecord("bg_close.mp4")); }, 15000, 500);
    h.ok("reopening the app reports the finished export and then forgets the job record");
    await p2.close();
    const p2b = await openStudio();
    await sleep(3000);
    const again = await p2b.evaluate(function () { return __toasts.filter(function (t) { return t.indexOf("bg_close") !== -1; }).length; });
    if (again !== 0) { h.fail("the same finished export was reported again on the next open"); }
    await p2b.close();

    /* ---- 3. reopen mid-render: the progress dialog comes back ---- */
    const p3 = await openStudio();
    await buildTimeline(p3);
    const job3 = await startExport(p3, "bg_resume");
    await p3.close();
    const p3b = await openStudio();
    await p3b.waitForFunction(function () { return CS.exporter.job && CS.exporter.job.progress; }, null, { timeout: 20000 });
    const back = await p3b.evaluate(function () {
        const title = document.querySelector("#modal-holder .modal-title");
        return { dialog: title ? title.textContent : "", same: CS.exporter.job.progress, toasts: __toasts.slice() };
    });
    if (back.same !== job3.progress) { h.fail("the reopened tab attached to a different job"); }
    if (back.dialog.indexOf("Exporting") === -1) { h.fail("no progress dialog after reopening mid-render: '" + back.dialog + "'"); }
    if (!back.toasts.some(function (t) { return t.indexOf("still rendering on the server") !== -1; })) { h.fail("no 'still rendering' message: " + back.toasts.join(" | ")); }
    h.ok("reopening mid-render brings the progress dialog back for the same server job");
    await p3b.waitForFunction(function () { return CS.exporter.job === null; }, null, { timeout: 400000 });
    await p3b.waitForFunction(function () { return __toasts.some(function (t) { return t.indexOf("Exported bg_resume.mp4") !== -1; }); }, null, { timeout: 20000 });
    if ((await listDir(EXPORT_DIR)).indexOf("bg_resume.mp4") === -1) { h.fail("the resumed render produced no file"); }
    h.ok("the resumed render completes and reports the finished file");
    await p3b.close();

    /* ---- 4. cancel: nothing left behind, nobody notified ---- */
    const p4 = await openStudio();
    await buildTimeline(p4);
    const job4 = await startExport(p4, "bg_cancel");
    const scratch4 = job4.dir.slice(job4.dir.lastIndexOf("/") + 1);
    await sleep(3000);
    await p4.locator(".modal-btn", { hasText: "Cancel" }).click();
    await p4.waitForFunction(function () { return CS.exporter.job === null; }, null, { timeout: 30000 });
    await sleep(5000);
    if ((await listDir(EXPORT_DIR)).indexOf("bg_cancel.mp4") !== -1) { h.fail("a cancelled render left an output file"); }
    if ((await scratchDirs()).indexOf(scratch4) !== -1) { h.fail("a cancelled render left its scratch folder"); }
    if (await jobRecord("bg_cancel.mp4")) { h.fail("a cancelled render left a job record"); }
    if (notificationsAbout(await desktopNotifications(), "bg_cancel").length) { h.fail("a cancelled render sent a notification"); }
    h.ok("a cancelled render leaves no output, no scratch folder, no job record and sends no notification");

    /* ---- 5. leaving while still preparing is guarded ---- */
    const guard = await p4.evaluate(function () {
        function tryLeave() {
            const ev = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(ev);
            return ev.defaultPrevented;
        }
        const out = {};
        CS.exporter.job = null;
        out.idle = tryLeave();
        CS.exporter.job = { progress: "", cancelled: false };
        out.preparing = tryLeave();
        CS.exporter.job = { progress: "tmp:/cinestudio_render_x.progress.json", cancelled: false };
        out.serverHasIt = tryLeave();
        CS.exporter.job = null;
        return out;
    });
    if (guard.idle || guard.serverHasIt) { h.fail("leaving must be free when nothing is being prepared: " + JSON.stringify(guard)); }
    if (!guard.preparing) { h.fail("leaving while the export is still being prepared is not guarded"); }
    h.ok("closing the tab is guarded only while the export is still being prepared, not once the server has it");
    await p4.close();

    const leftovers = (await scratchDirs()).filter(function (d) { return scratchBefore.indexOf(d) === -1; });
    if (leftovers.length) { h.fail("scratch folders left after the whole run: " + leftovers.join(", ")); }
    void notesBefore;
    fs.rmSync(work, { recursive: true, force: true });
    await ctx.close();
});
