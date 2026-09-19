/*
    Cine Studio: server-side export and proxies, against a real ArozOS server.

    Proves that inside ArozOS the Export dialog renders on the server (the
    ffmpeg.renderTimeline AGI job) from the original media, and does NOT
    fall back to recording the preview in the browser (MediaRecorder):

      1. boot            ArozOS mode, server ffmpeg detected, server dialog
      2. render + verify a real timeline (cut, dissolve, title, audio) is
                         exported through the dialog in every server format;
                         each output is downloaded and inspected with
                         ffprobe / ffmpeg (codec, size, duration, pixels,
                         audio level)
      3. options         half size, low quality, in/out range only
      4. effects         a footage file the browser cannot decode gets a
                         server proxy for the preview, but the render uses
                         the original file
      5. proxies         makeProxy jobs: browser-playable H.264 output, capped
                         height, audio proxy
      6. cancel          cancelling a running render stops it and leaves no
                         output behind
      7. spies           MediaRecorder was never constructed and
                         startRecorder never called on any server export
      8. control         with server export forced off, the same spies DO
                         see the browser recorder, so the checks above bite

    Needs ffmpeg + ffprobe on the machine running the spec (they generate the
    test footage and inspect the results) and on the server under test.
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

/* ---------------- local media tooling ---------------- */

function haveTool(name) {
    const r = spawnSync(name, ["-version"], { encoding: "utf8" });
    return !r.error && r.status === 0;
}

function run(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: "buffer", maxBuffer: 64 << 20 });
    if (r.status !== 0) {
        throw new Error(cmd + " " + args.join(" ") + " failed: " + String(r.stderr || "").slice(-400));
    }
    return r.stdout;
}

function probe(file) {
    return JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]).toString());
}

function stream(info, type) {
    return (info.streams || []).filter(function (s) { return s.codec_type === type; })[0] || null;
}

// Mean colour of the whole frame at time t
function meanRGB(file, t) {
    const out = run("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
        "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return [out[0], out[1], out[2]];
}

// How many near-white pixels a 160x90 rendition of the frame at t contains
function whitePixels(file, t) {
    const out = run("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
        "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    let n = 0;
    for (let i = 0; i + 2 < out.length; i += 3) {
        if (out[i] > 200 && out[i + 1] > 200 && out[i + 2] > 200) { n++; }
    }
    return n;
}

// Mean volume in dB of the first audio stream (null when silent / no audio)
function meanVolume(file) {
    const r = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr || "");
    return m ? parseFloat(m[1]) : null;
}

// libx264 writes its version banner into the H.264 stream; hardware
// encoders do not, which tells the two apart without trusting any log
function encodedBySoftwareX264(file) {
    return fs.readFileSync(file).indexOf("x264 - core") !== -1;
}

function makeFootage(dir) {
    const f = {};
    function gen(name, args) {
        f[name] = path.join(dir, name);
        run("ffmpeg", ["-y", "-v", "error"].concat(args, [f[name]]));
    }
    gen("red.mp4", ["-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:d=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
    gen("blue.mp4", ["-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=880:d=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
    gen("tone.wav", ["-f", "lavfi", "-i", "sine=frequency=660:d=6"]);
    // MPEG-2 in Matroska: no browser plays this, so it must be proxied
    gen("green.mkv", ["-f", "lavfi", "-i", "color=c=0x00c800:s=1280x720:r=25:d=3", "-c:v", "mpeg2video", "-q:v", "2"]);
    return f;
}

/* ---------------- server / page helpers ---------------- */

async function upload(page, base, file, dir) {
    const res = await page.request.post(base + "/system/file_system/upload", {
        multipart: {
            path: dir,
            file: { name: path.basename(file), mimeType: "application/octet-stream", buffer: fs.readFileSync(file) }
        }
    });
    const text = (await res.text()).trim().toLowerCase();
    if (text.indexOf("ok") === -1) { throw new Error("upload of " + file + " failed: " + text); }
}

async function download(page, base, vpath, dest) {
    const res = await page.request.get(base + "/media/?file=" + encodeURIComponent(vpath));
    if (!res.ok()) { throw new Error("download of " + vpath + " failed: HTTP " + res.status()); }
    fs.writeFileSync(dest, await res.body());
    return dest;
}

async function exists(page, base, vpath) {
    const dir = vpath.slice(0, vpath.lastIndexOf("/"));
    const name = vpath.slice(vpath.lastIndexOf("/") + 1);
    const listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: dir });
    return listing.indexOf(name) !== -1;
}

// Network-level record of everything the page asks the server to do
function attachSpies(page) {
    const log = { agi: [], uploads: [], renderSpecs: [], responses: [] };
    page.on("request", function (req) {
        const url = req.url();
        if (url.indexOf("/system/ajgi/interface") !== -1 && url.indexOf("ffmpegtools.js") !== -1) {
            const params = new URLSearchParams(req.postData() || "");
            log.agi.push({ action: params.get("action"), params: params });
            if (params.get("action") === "render") {
                try { log.renderSpecs.push(JSON.parse(params.get("spec"))); } catch (e) { /* recorded as missing */ }
            }
        }
        if (url.indexOf("/system/file_system/upload") !== -1) {
            const body = req.postData() || "";
            const m = /name="path"\r\n\r\n([^\r]*)/.exec(body);
            log.uploads.push(m ? m[1] : "?");
        }
    });
    return log;
}

function countAction(log, action) {
    return log.agi.filter(function (a) { return a.action === action; }).length;
}

/* ---------------- the spec ---------------- */

h.run("CINESTUDIO-SERVER-RENDER", async function (env) {
    if (!haveTool("ffmpeg") || !haveTool("ffprobe")) {
        console.log("  SKIP: ffmpeg / ffprobe not installed on this machine");
        return;
    }
    const base = env.baseURL;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "cs-server-render-"));
    const footage = makeFootage(work);

    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);
    page.on("dialog", function (d) { d.dismiss().catch(function () {}); });
    page.on("console", function (m) { if (m.type() === "error") { console.log("  [console.error] " + m.text().slice(0, 200)); } });
    const log = attachSpies(page);

    // MediaRecorder spy, installed before any app script runs
    await page.addInitScript(function () {
        window.__mr = { ctor: 0 };
        const Real = window.MediaRecorder;
        if (Real) {
            const Spy = function (a, b) { window.__mr.ctor++; return new Real(a, b); };
            Spy.prototype = Real.prototype;
            Spy.isTypeSupported = Real.isTypeSupported.bind(Real);
            window.MediaRecorder = Spy;
        }
    });

    /* ---- 1. boot ---- */
    await page.goto(base + APP, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () { return window.CS && CS._ffmpegChecked && CS.project; }, null, { timeout: 30000 });
    const boot = await page.evaluate(function () {
        return { aroz: CS.inArozOS(), ffmpeg: CS.serverFFmpeg, hw: CS.serverHWEncoder, useServer: CS.exporter.useServer() };
    });
    if (!boot.aroz) { h.fail("Cine Studio did not detect ArozOS mode"); }
    if (!boot.ffmpeg) { h.fail("server reports no ffmpeg - server-side export is unavailable on this instance"); }
    if (!boot.useServer) { h.fail("CS.exporter.useServer() is false even though ffmpeg is present"); }
    h.ok("ArozOS mode, server ffmpeg detected, server export selected (hardware encoder: " + (boot.hw || "none, software x264") + ")");

    await page.evaluate(function () {
        window.__toasts = [];
        const t = CS.toast;
        CS.toast = function (msg, isErr) { window.__toasts.push((isErr ? "ERR: " : "") + msg); return t.apply(this, arguments); };
        window.__recorderCalls = 0;
        const sr = CS.exporter.startRecorder;
        CS.exporter.startRecorder = function () { window.__recorderCalls++; return sr.apply(this, arguments); };
        window.__serverCalls = 0;
        const ss = CS.exporter.startServer;
        CS.exporter.startServer = function () { window.__serverCalls++; return ss.apply(this, arguments); };
    });

    // The app creates its folders on first open
    for (let i = 0; i < 20; i++) {
        const listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/Cine Studio" });
        if (listing.indexOf("Media") !== -1) { break; }
        await page.waitForTimeout(500);
    }
    for (const name of ["red.mp4", "blue.mp4", "tone.wav", "green.mkv"]) {
        await upload(page, base, footage[name], MEDIA_DIR);
    }
    h.ok("test footage uploaded to the user's Cine Studio/Media folder");

    /* ---- build the project the way a user would ---- */
    await page.evaluate(function (dir) {
        CS.newProject({ name: "ServerRender", width: 640, height: 360, fps: 30 });
        CS.player.applyProjectSize();
        window.__m = {};
        ["red.mp4", "blue.mp4", "tone.wav"].forEach(function (n) {
            window.__m[n] = CS.media.addFromVpath(dir + "/" + n, n);
        });
    }, MEDIA_DIR);
    await page.waitForFunction(function () {
        return Object.keys(__m).every(function (k) { return __m[k].probed && __m[k].proxyState !== "pending"; });
    }, null, { timeout: 60000 });
    const built = await page.evaluate(function () {
        const a = CS.addClipToTimeline(__m["red.mp4"], "V1", 0);
        const b = CS.addClipToTimeline(__m["blue.mp4"], "V1", CS.clipDuration(a));
        b.props.transition = { type: "dissolve", duration: 1 };
        CS.addClipToTimeline(__m["tone.wav"], "A1", 0);
        CS.player.seek(1);
        CS.titles.insertPreset("title");
        const t = CS.selectedClip();
        t.props.text.content = "HELLO";
        t.props.text.size = 200;
        CS.titles.invalidate(t);
        CS.commit("Server render seed");
        return { total: CS.timelineDuration(), titleKind: t.kind, titleStart: t.start, titleEnd: t.start + CS.clipDuration(t) };
    });
    h.ok("timeline built: cut + 1s dissolve + title + audio, " + built.total.toFixed(2) + "s");

    /* ---- export through the real dialog ---- */
    async function doExport(opts) {
        await page.click("#btn-export");
        await page.waitForSelector(".modal .modal-title");
        const row = function (label) { return page.locator(".modal-row", { hasText: label }); };
        await row("Filename").locator("input").fill(opts.name);
        await row("Format").locator("select").selectOption(opts.format);
        if (opts.size) { await row("Size").locator("select").selectOption(opts.size); }
        if (opts.quality) { await row("Quality").locator("select").selectOption(opts.quality); }
        if (opts.hardware) { await row("Encoder").locator("input").check(); }
        const failsBefore = await page.evaluate(function () { return __toasts.length; });
        await page.click(".modal-btn.primary");
        await page.waitForFunction(function () { return CS.exporter.job === null && !document.querySelector("#modal-holder .modal"); },
            null, { timeout: 300000 });
        const toasts = await page.evaluate(function (n) { return __toasts.slice(n); }, failsBefore);
        const failed = toasts.filter(function (t) { return /Export failed|ERR:/.test(t); });
        if (failed.length) { h.fail(opts.name + "." + opts.format + " export reported: " + failed.join(" | ")); }
        const vpath = EXPORT_DIR + "/" + opts.name + "." + opts.format;
        if (!(await exists(page, base, vpath))) { h.fail("server did not produce " + vpath); }
        return download(page, base, vpath, path.join(work, "out_" + opts.name + "." + opts.format));
    }

    // dialog content: server formats, no browser-recorder-only choice
    await page.click("#btn-export");
    await page.waitForSelector(".modal .modal-title");
    const dlg = await page.evaluate(function () {
        const sel = document.querySelector(".modal-row select");
        return {
            formats: Array.from(sel.options).map(function (o) { return o.value; }),
            text: document.querySelector(".modal-body").textContent
        };
    });
    await page.evaluate(function () { CS.closeModal(); });
    if (dlg.formats.join(",") !== "mp4,mov,mkv,webm,gif,m4a") { h.fail("unexpected server formats: " + dlg.formats.join(",")); }
    if (dlg.text.indexOf("rendered on the server") === -1) { h.fail("dialog does not say it renders on the server"); }
    if (/recorded in browser|Keep this window visible/.test(dlg.text)) { h.fail("dialog still shows the browser-recording wording"); }
    h.ok("Export dialog offers the server formats (" + dlg.formats.join(", ") + ") and says it renders on the server");

    /* ---- 2. render + verify ---- */
    const t0 = Date.now();
    const mp4 = await doExport({ name: "full", format: "mp4" });
    const info = probe(mp4);
    const v = stream(info, "video"), a = stream(info, "audio");
    if (!v || v.codec_name !== "h264") { h.fail("mp4 video is not H.264: " + (v && v.codec_name)); }
    if (v.width !== 640 || v.height !== 360) { h.fail("mp4 size " + v.width + "x" + v.height + ", want 640x360"); }
    if (!a || a.codec_name !== "aac") { h.fail("mp4 audio is not AAC: " + (a && a.codec_name)); }
    const dur = parseFloat(info.format.duration);
    if (Math.abs(dur - built.total) > 0.25) { h.fail("mp4 duration " + dur + "s, want about " + built.total + "s"); }
    const enc = (info.format.tags && info.format.tags.encoder) || "";
    if (!/Lavf/.test(enc)) { h.fail("mp4 was not muxed by ffmpeg (encoder tag: '" + enc + "')"); }
    h.ok("mp4: H.264 640x360 + AAC, " + dur.toFixed(2) + "s, muxed by " + enc + " (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");

    const red = meanRGB(mp4, 0.5), mid = meanRGB(mp4, 3.5), blue = meanRGB(mp4, 5.5);
    if (!(red[0] > 150 && red[2] < 90)) { h.fail("t=0.5s should be red, got rgb(" + red + ")"); }
    if (!(blue[2] > 150 && blue[0] < 90)) { h.fail("t=5.5s should be blue, got rgb(" + blue + ")"); }
    if (!(mid[0] > 40 && mid[2] > 40)) { h.fail("t=3.5s should be a red/blue dissolve mix, got rgb(" + mid + ")"); }
    h.ok("frames: red rgb(" + red + "), dissolve mix rgb(" + mid + "), blue rgb(" + blue + ")");

    const withTitle = whitePixels(mp4, 2.5), without = whitePixels(mp4, 5.5);
    if (withTitle < 60 || withTitle <= without + 40) { h.fail("title not rendered: " + withTitle + " white px at 2.5s vs " + without + " at 5.5s"); }
    h.ok("title composited by the server render (" + withTitle + " white px while shown, " + without + " after)");

    const vol = meanVolume(mp4);
    if (vol === null || vol < -50) { h.fail("mp4 audio is silent (mean " + vol + " dB)"); }
    h.ok("audio mixed into the render (mean volume " + vol + " dB)");

    for (const f of [
        { format: "mov", vcodec: "h264", acodec: "aac" },
        { format: "mkv", vcodec: "h264", acodec: "aac" },
        { format: "webm", vcodec: "vp9", acodec: "opus" },
        { format: "gif", vcodec: "gif", acodec: null },
        { format: "m4a", vcodec: null, acodec: "aac" }
    ]) {
        const file = await doExport({ name: "fmt_" + f.format, format: f.format, size: f.format === "gif" ? "0.25" : undefined });
        const i = probe(file), sv = stream(i, "video"), sa = stream(i, "audio");
        if (f.vcodec && (!sv || sv.codec_name !== f.vcodec)) { h.fail(f.format + " video codec " + (sv && sv.codec_name) + ", want " + f.vcodec); }
        if (!f.vcodec && sv) { h.fail(f.format + " should have no video stream"); }
        if (f.acodec && (!sa || sa.codec_name !== f.acodec)) { h.fail(f.format + " audio codec " + (sa && sa.codec_name) + ", want " + f.acodec); }
        if (!f.acodec && sa) { h.fail(f.format + " should have no audio stream"); }
        const d = parseFloat(i.format.duration);
        if (Math.abs(d - built.total) > 0.35) { h.fail(f.format + " duration " + d + "s, want about " + built.total + "s"); }
        h.ok(f.format + ": " + (sv ? sv.codec_name + " " : "") + (sa ? sa.codec_name + " " : "") + d.toFixed(2) + "s");
    }

    /* ---- 3. options ---- */
    const small = await doExport({ name: "half_low", format: "mp4", size: "0.5", quality: "low" });
    const sv = stream(probe(small), "video");
    if (sv.width !== 320 || sv.height !== 180) { h.fail("half size export is " + sv.width + "x" + sv.height + ", want 320x180"); }
    if (fs.statSync(small).size >= fs.statSync(mp4).size) { h.fail("low quality half size file is not smaller than the full export"); }
    h.ok("size 1/2 + low quality: " + sv.width + "x" + sv.height + ", " + fs.statSync(small).size + " B vs " + fs.statSync(mp4).size + " B full");

    await page.evaluate(function () { CS.setInPoint(1); CS.setOutPoint(4); });
    const ranged = await doExport({ name: "range", format: "mp4" });
    const rd = parseFloat(probe(ranged).format.duration);
    if (Math.abs(rd - 3) > 0.25) { h.fail("in/out range export lasts " + rd + "s, want 3s"); }
    const r0 = meanRGB(ranged, 0.3);
    if (!(r0[0] > 150 && r0[2] < 90)) { h.fail("range export should start on red, got rgb(" + r0 + ")"); }
    await page.evaluate(function () { CS.clearInOut("both"); });
    h.ok("in/out range 1s-4s exported as " + rd.toFixed(2) + "s starting on red");

    /* ---- 3b. hardware encoder (only when the server found one) ---- */
    if (boot.hw) {
        const soft = await doExport({ name: "enc_software", format: "mp4" });
        const hard = await doExport({ name: "enc_hardware", format: "mp4", hardware: true });
        if (!encodedBySoftwareX264(soft)) { h.fail("the software export does not carry the libx264 banner - the marker check is unreliable"); }
        if (encodedBySoftwareX264(hard)) { h.fail("hardware export was still encoded by libx264"); }
        const hv = stream(probe(hard), "video");
        if (!hv || hv.codec_name !== "h264" || hv.width !== 640 || hv.height !== 360) { h.fail("hardware export is not 640x360 H.264"); }
        const hred = meanRGB(hard, 0.5), hblue = meanRGB(hard, 5.5);
        if (!(hred[0] > 150 && hred[2] < 90 && hblue[2] > 150 && hblue[0] < 90)) { h.fail("hardware export has wrong colours: rgb(" + hred + ") / rgb(" + hblue + ")"); }
        h.ok("hardware encoder (" + boot.hw + "): H.264 " + hv.width + "x" + hv.height + ", no libx264 banner (software export has it), colours correct");
    } else {
        console.log("  SKIP: server reports no hardware encoder, so the hardware option was not tested");
    }

    /* ---- 4. footage the browser cannot decode: proxy for preview, original for render ---- */
    const proxyBefore = countAction(log, "proxy");
    await page.evaluate(function (dir) {
        CS.newProject({ name: "OddFootage", width: 640, height: 360, fps: 30 });
        CS.player.applyProjectSize();
        window.__g = CS.media.addFromVpath(dir + "/green.mkv", "green.mkv");
    }, MEDIA_DIR);
    await page.waitForFunction(function () { return (__g.proxyState === "ready" && __g.probed) || __g.proxyState === "failed"; }, null, { timeout: 120000 });
    const prox = await page.evaluate(function () { return { state: __g.proxyState, vpath: __g.proxyVpath, probed: __g.probed }; });
    if (prox.state !== "ready") { h.fail("green.mkv proxy ended as '" + prox.state + "'"); }
    if (countAction(log, "proxy") <= proxyBefore) { h.fail("no proxy request reached ffmpegtools.js"); }
    if (prox.vpath.indexOf("/Cine Studio/Cache/") === -1) { h.fail("proxy is not in the Cache folder: " + prox.vpath); }
    const pinfo = probe(await download(page, base, prox.vpath, path.join(work, "green_proxy.mp4")));
    const pv = stream(pinfo, "video");
    if (!pv || pv.codec_name !== "h264") { h.fail("proxy is not browser-playable H.264: " + (pv && pv.codec_name)); }
    if (boot.hw && encodedBySoftwareX264(path.join(work, "green_proxy.mp4"))) { h.fail("proxy was encoded by libx264 although the server has a hardware encoder"); }
    h.ok("green.mkv (MPEG-2/Matroska) proxied on the server to " + pv.codec_name + " " + pv.width + "x" + pv.height + (boot.hw ? " with the hardware encoder" : ""));

    await page.evaluate(function () {
        const c = CS.addClipToTimeline(__g, "V1", 0);
        CS.effects.applyToClip(c, "invert");
        CS.commit("invert green");
    });
    const renderBefore = log.renderSpecs.length;
    const inv = await doExport({ name: "invert_original", format: "mp4" });
    const spec = log.renderSpecs[renderBefore];
    if (!spec) { h.fail("render request did not carry a spec"); }
    const vl = (spec.layers || []).filter(function (l) { return l.kind === "video"; });
    if (!vl.length || vl.some(function (l) { return l.src !== MEDIA_DIR + "/green.mkv"; })) {
        h.fail("render used " + JSON.stringify(vl.map(function (l) { return l.src; })) + " instead of the original green.mkv");
    }
    const ig = meanRGB(inv, 1);
    if (!(ig[0] > 200 && ig[1] < 90 && ig[2] > 200)) { h.fail("inverted green should be magenta, got rgb(" + ig + ")"); }
    h.ok("render read the ORIGINAL green.mkv (not the proxy) and applied Invert: rgb(" + ig + ")");

    /* ---- 5. proxy jobs directly ---- */
    const jobs = await page.evaluate(function (dir) {
        function agi(params) {
            return new Promise(function (resolve, reject) { CS.exporter.agi(params).then(resolve, reject); });
        }
        function wait(progress, target) {
            return new Promise(function (resolve, reject) {
                let n = 0;
                (function tick() {
                    agi({ action: "progress", progress: progress, target: target }).then(function (p) {
                        if (p.stage === "failed") { reject(new Error(p.error || "failed")); }
                        else if (p.completed && p.exists) { resolve(p); }
                        else if (++n > 300) { reject(new Error("timeout")); }
                        else { setTimeout(tick, 500); }
                    }, reject);
                })();
            });
        }
        return Promise.all([
            agi({ action: "proxy", src: dir + "/green.mkv", kind: "video", height: 240 }),
            agi({ action: "proxy", src: dir + "/tone.wav", kind: "audio", height: 0 })
        ]).then(function (r) {
            return Promise.all(r.map(function (x) {
                if (!x.ok) { throw new Error(x.error || "proxy rejected"); }
                return x.ready ? x : wait(x.progress, x.vpath).then(function () { return x; });
            }));
        }).then(function (r) { return r.map(function (x) { return x.vpath; }); });
    }, MEDIA_DIR);
    const p240 = stream(probe(await download(page, base, jobs[0], path.join(work, "p240.mp4"))), "video");
    if (!p240 || p240.codec_name !== "h264" || p240.height > 240) { h.fail("240p proxy is " + JSON.stringify(p240 && [p240.codec_name, p240.height])); }
    const paud = stream(probe(await download(page, base, jobs[1], path.join(work, "paudio.m4a"))), "audio");
    if (!paud || paud.codec_name !== "aac") { h.fail("audio proxy is not AAC: " + (paud && paud.codec_name)); }
    h.ok("makeProxy: video capped to " + p240.height + "p H.264, audio proxy AAC");

    /* ---- 6. cancel ---- */
    await page.evaluate(function (dir) {
        CS.newProject({ name: "Cancel", width: 1920, height: 1080, fps: 30 });
        CS.player.applyProjectSize();
        const m = CS.media.addFromVpath(dir + "/red.mp4", "red.mp4");
        window.__long = m;
    }, MEDIA_DIR);
    await page.waitForFunction(function () { return __long.probed && __long.proxyState !== "pending"; }, null, { timeout: 60000 });
    await page.evaluate(function () {
        for (let i = 0; i < 40; i++) {
            const c = CS.addClipToTimeline(__long, "V1", i * 3);
            CS.effects.applyToClip(c, "grain");
        }
        CS.commit("long timeline");
    });
    const cancelsBefore = countAction(log, "cancel");
    await page.click("#btn-export");
    await page.waitForSelector(".modal .modal-title");
    await page.locator(".modal-row", { hasText: "Filename" }).locator("input").fill("cancelled");
    await page.click(".modal-btn.primary");
    await page.waitForFunction(function () { return CS.exporter.job && CS.exporter.job.progress; }, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.locator(".modal-btn", { hasText: "Cancel" }).click();
    await page.waitForFunction(function () { return CS.exporter.job === null; }, null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    if (countAction(log, "cancel") <= cancelsBefore) { h.fail("Cancel did not send a cancel request to the server"); }
    if (await exists(page, base, EXPORT_DIR + "/cancelled.mp4")) { h.fail("cancelled render left an output file behind"); }
    h.ok("cancel stops the server render and leaves no output file");

    /* ---- 7. spies: nothing recorded in the browser ---- */
    const spy = await page.evaluate(function () {
        return { ctor: window.__mr.ctor, recorder: window.__recorderCalls, server: window.__serverCalls };
    });
    const renders = countAction(log, "render");
    if (spy.recorder !== 0) { h.fail("CS.exporter.startRecorder ran " + spy.recorder + " time(s) during server exports"); }
    if (spy.ctor !== 0) { h.fail("MediaRecorder was constructed " + spy.ctor + " time(s) during server exports"); }
    if (spy.server !== renders) { h.fail("startServer ran " + spy.server + " times but the server saw " + renders + " render requests"); }
    const videoUploads = log.uploads.filter(function (p) { return p.indexOf("/Exports") !== -1; });
    if (videoUploads.length) { h.fail("something was uploaded into the Exports folder from the browser: " + videoUploads.join(", ")); }
    const flow = ["jobdir", "render", "progress", "cleanup"].map(function (k) { return k + " x" + countAction(log, k); }).join(", ");
    h.ok(spy.server + " exports = " + renders + " server render jobs (" + flow + "); MediaRecorder constructed " + spy.ctor + "x, startRecorder " + spy.recorder + "x");

    /* ---- 8. control: force the browser path and make sure the spies notice ---- */
    await page.evaluate(function () {
        CS._forceStandalone = true;
        CS.newProject({ name: "Control", width: 320, height: 180, fps: 30 });
        CS.player.applyProjectSize();
    });
    await page.evaluate(function () {
        CS.addClipToTimeline(CS.project.media.length ? CS.project.media[0] : __long, "V1", 0);
    }).catch(function () {});
    const ctl = await page.evaluate(function () { return CS.exporter.useServer(); });
    if (ctl) { h.fail("control: useServer() still true with standalone forced"); }
    await page.evaluate(function () {
        const m = CS.media.register({ name: "ctl.png", type: "image", blobUrl: (function () {
            const c = document.createElement("canvas"); c.width = 32; c.height = 32;
            const x = c.getContext("2d"); x.fillStyle = "#f00"; x.fillRect(0, 0, 32, 32);
            return c.toDataURL("image/png");
        })() });
        CS.addClipToTimeline(m, "V1", 0);
        CS.commit("control");
    });
    await page.click("#btn-export");
    await page.waitForSelector(".modal .modal-title");
    const ctlDlg = await page.evaluate(function () {
        return { formats: Array.from(document.querySelector(".modal-row select").options).map(function (o) { return o.value; }),
                 text: document.querySelector(".modal-body").textContent };
    });
    if (ctlDlg.formats.join(",") !== "webm" || ctlDlg.text.indexOf("Keep this window visible") === -1) {
        h.fail("control: forced-standalone dialog is not the browser-recording one: " + ctlDlg.formats.join(","));
    }
    await page.click(".modal-btn.primary");
    await page.waitForFunction(function () { return window.__mr.ctor > 0; }, null, { timeout: 15000 });
    const ctlSpy = await page.evaluate(function () { return { ctor: window.__mr.ctor, recorder: window.__recorderCalls }; });
    await page.evaluate(function () { try { CS.exporter.cancel(); } catch (e) { /* stopping is best effort */ } });
    if (ctlSpy.recorder < 1) { h.fail("control: startRecorder spy did not fire on the browser path"); }
    h.ok("control: browser path is detectable (MediaRecorder constructed " + ctlSpy.ctor + "x, startRecorder " + ctlSpy.recorder + "x)");

    fs.rmSync(work, { recursive: true, force: true });
});
