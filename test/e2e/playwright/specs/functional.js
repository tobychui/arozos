/*
    Functional test: generate real webm/wav media in the browser, import
    them into Cine Studio, then exercise playback, editing (split/undo/
    drag), project serialization round-trip and the WebM export pipeline.
*/
"use strict";

const { ok, fail, run } = require("../lib/harness");

run("FUNCTIONAL", async (page, browser) => {

    /* ---- 1. generate + import real media ---- */
    await page.evaluate(async () => {
        function makeVideo(name, seconds, hue) {
            return new Promise((resolve) => {
                const cv = document.createElement("canvas");
                cv.width = 320; cv.height = 180;
                const ctx = cv.getContext("2d");
                const stream = cv.captureStream(15);
                const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
                const chunks = [];
                rec.ondataavailable = e => e.data.size && chunks.push(e.data);
                rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
                const t0 = performance.now();
                (function draw() {
                    const t = (performance.now() - t0) / 1000;
                    ctx.fillStyle = `hsl(${hue}, 60%, 40%)`;
                    ctx.fillRect(0, 0, 320, 180);
                    ctx.fillStyle = "#fff";
                    ctx.fillRect((t * 60) % 320, 60, 40, 60);
                    if (t < seconds) { requestAnimationFrame(draw); } else { rec.stop(); }
                })();
                rec.start(200);
            });
        }
        function makeWav(seconds) {
            const sr = 22050, n = sr * seconds;
            const buf = new ArrayBuffer(44 + n * 2);
            const dv = new DataView(buf);
            function ws(o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
            ws(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ws(8, "WAVEfmt ");
            dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
            dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
            dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
            ws(36, "data"); dv.setUint32(40, n * 2, true);
            for (let i = 0; i < n; i++) {
                dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 330 * i / sr) * 12000, true);
            }
            return new Blob([buf], { type: "audio/wav" });
        }

        const v1 = await makeVideo("ClipA.webm", 3, 200);
        const v2 = await makeVideo("ClipB.webm", 2.5, 30);
        window.__testMedia = {
            v1: CS.media.register({ name: "ClipA.webm", blobUrl: URL.createObjectURL(v1), type: "video" }),
            v2: CS.media.register({ name: "ClipB.webm", blobUrl: URL.createObjectURL(v2), type: "video" }),
            a1: CS.media.register({ name: "Tone.wav", blobUrl: URL.createObjectURL(makeWav(4)), type: "audio" })
        };
    });

    await page.waitForFunction(() => {
        const m = window.__testMedia;
        return m.v1.probed && m.v2.probed && m.a1.probed;
    }, { timeout: 30000 });

    const probe = await page.evaluate(() => {
        const m = window.__testMedia;
        return {
            d1: m.v1.duration, d2: m.v2.duration, da: m.a1.duration,
            thumbs: m.v1.thumbs.length, peaks: (m.a1.peaks || []).length,
            offline: m.v1.offline || m.v2.offline || m.a1.offline,
            binItems: document.querySelectorAll("#bin-grid .bin-item").length
        };
    });
    if (probe.offline) fail("media marked offline");
    if (!(probe.d1 > 2 && probe.d1 < 4.5)) fail("ClipA duration wrong: " + probe.d1);
    if (!(probe.da > 3.5 && probe.da < 4.5)) fail("wav duration wrong: " + probe.da);
    if (probe.thumbs < 1) fail("no video thumbnails");
    if (probe.peaks < 100) fail("no audio peaks");
    if (probe.binItems !== 3) fail("bin should show 3 items");
    ok(`probe: video ${probe.d1.toFixed(2)}s + ${probe.d2.toFixed(2)}s, wav ${probe.da.toFixed(2)}s, ${probe.thumbs} thumbs, ${probe.peaks} peaks`);

    /* ---- 2. build a timeline ---- */
    await page.evaluate(() => {
        const m = window.__testMedia;
        const c1 = CS.addClipToTimeline(m.v1, "V1", 0);
        CS.addClipToTimeline(m.v2, "V1", CS.clipDuration(c1));
        CS.addClipToTimeline(m.a1, "A1", 0);
        CS.commit("Test Build");
    });
    const clipCount = await page.evaluate(() => CS.project.clips.length);
    if (clipCount !== 3) fail("expected 3 clips, got " + clipCount);
    ok("3 clips placed on timeline");

    /* ---- 3. playback ---- */
    await page.click("#btn-play");
    await page.waitForTimeout(1600);
    const playState = await page.evaluate(() => {
        const cv = document.getElementById("preview-canvas");
        const ctx = cv.getContext("2d");
        const px = ctx.getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
        return { playhead: CS.state.playhead, playing: CS.state.playing, px: Array.from(px) };
    });
    if (!playState.playing) fail("player is not playing");
    if (playState.playhead < 1.0) fail("playhead did not advance: " + playState.playhead);
    if (playState.px[0] + playState.px[1] + playState.px[2] < 20) fail("preview canvas looks black during playback");
    ok(`playback: playhead=${playState.playhead.toFixed(2)}s, center pixel rgb(${playState.px.slice(0, 3)})`);
    await page.click("#btn-play"); // pause

    /* ---- 4. split / undo / redo ---- */
    const split = await page.evaluate(() => {
        CS.player.seek(1.2);
        CS.selectClip(CS.project.clips[0].id);
        const before = CS.project.clips.length;
        CS.splitAtPlayhead();
        const after = CS.project.clips.length;
        CS.undo();
        const undone = CS.project.clips.length;
        CS.redo();
        const redone = CS.project.clips.length;
        return { before, after, undone, redone };
    });
    if (split.after !== split.before + 1) fail("split did not add a clip");
    if (split.undone !== split.before) fail("undo did not restore");
    if (split.redone !== split.before + 1) fail("redo did not reapply");
    ok(`split/undo/redo: ${split.before} -> ${split.after} -> ${split.undone} -> ${split.redone}`);

    /* ---- 5. drag a clip with the mouse ---- */
    const dragged = await page.evaluate(() => {
        window.__dragTarget = CS.project.clips.find(c => c.trackId === "A1");
        return { id: window.__dragTarget.id, start: window.__dragTarget.start };
    });
    const box = await page.locator(`.tl-clip[data-clip-id="${dragged.id}"]`).boundingBox();
    if (!box) fail("audio clip element not found");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const newStart = await page.evaluate(() => CS.getClip(window.__dragTarget.id).start);
    if (Math.abs(newStart - dragged.start) < 0.5) fail("mouse drag did not move the clip: " + newStart);
    ok(`mouse drag moved audio clip ${dragged.start.toFixed(2)}s -> ${newStart.toFixed(2)}s`);

    /* ---- 6. project serialization round trip ---- */
    const roundTrip = await page.evaluate(() => {
        const json = CS.fileio.serializeProject();
        const beforeClips = CS.project.clips.length;
        const beforeTracks = CS.project.tracks.length;
        CS.fileio.loadProject(JSON.parse(json), "", "roundtrip.cine");
        return {
            beforeClips, beforeTracks,
            afterClips: CS.project.clips.length,
            afterTracks: CS.project.tracks.length,
            name: CS.project.name,
            parses: !!json.length
        };
    });
    if (roundTrip.afterClips !== roundTrip.beforeClips) fail("clips lost in round trip");
    if (roundTrip.afterTracks !== roundTrip.beforeTracks) fail("tracks lost in round trip");
    ok(`project round trip: ${roundTrip.afterClips} clips, ${roundTrip.afterTracks} tracks preserved`);

    /* ---- 7. export to WebM (fresh short timeline) ---- */
    await page.evaluate(() => {
        const m = window.__testMedia;
        CS.newProject({ name: "ExportTest", width: 640, height: 360, fps: 30 });
        CS.player.applyProjectSize();
        // media pool was cleared by newProject: re-register the blobs
        const v = CS.media.register({ name: m.v1.name, blobUrl: m.v1.blobUrl, type: "video" });
        const a = CS.media.register({ name: m.a1.name, blobUrl: m.a1.blobUrl, type: "audio" });
        window.__exportSeed = { v, a };
    });
    await page.waitForFunction(() => window.__exportSeed.v.probed && window.__exportSeed.a.probed, { timeout: 20000 });
    await page.evaluate(() => {
        const s = window.__exportSeed;
        const c = CS.addClipToTimeline(s.v, "V1", 0);
        c.out = Math.min(c.out, 2.5);
        const ca = CS.addClipToTimeline(s.a, "A1", 0);
        ca.out = Math.min(ca.out, 2.5);
        CS.commit("Export Seed");
        window.__exportSize = -1;
        CS.fileio.downloadBlob = function (blob) { window.__exportSize = blob.size; };
        CS.exporter.start({ base: "test_export", format: "webm", destDir: "", toDevice: true });
    });
    await page.waitForFunction(() => window.__exportSize >= 0, { timeout: 30000 });
    const exportSize = await page.evaluate(() => window.__exportSize);
    if (exportSize < 5000) fail("export produced a suspiciously small file: " + exportSize);
    ok(`export produced WebM of ${exportSize} bytes`);
});
