/*
    Iteration 3 tests: preview drag/resize overlay, auto track creation,
    Pixel Studio (.pxs) and Audio Studio (.asproj) imports.
*/
"use strict";

const { ok, fail, run } = require("../lib/harness");

run("INTERACTION", async (page, browser) => {

    /* ---- seed one real video + audio ---- */
    await page.evaluate(async () => {
        function makeVideo(seconds, hue) {
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
                    ctx.fillStyle = `hsl(${hue}, 65%, 45%)`;
                    ctx.fillRect(0, 0, 320, 180);
                    if ((performance.now() - t0) / 1000 < seconds) { requestAnimationFrame(draw); } else { rec.stop(); }
                })();
                rec.start(200);
            });
        }
        window.makeWavDataUrl = function (seconds, freq) {
            const sr = 22050, n = Math.floor(sr * seconds);
            const buf = new ArrayBuffer(44 + n * 2);
            const dv = new DataView(buf);
            function ws(o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
            ws(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ws(8, "WAVEfmt ");
            dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
            dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
            dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
            ws(36, "data"); dv.setUint32(40, n * 2, true);
            for (let i = 0; i < n; i++) {
                dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / sr) * 12000, true);
            }
            let bin = "";
            const u8 = new Uint8Array(buf);
            for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            return "data:audio/wav;base64," + btoa(bin);
        };
        const v = await makeVideo(3, 210);
        window.__vid = CS.media.register({ name: "Base.webm", blobUrl: URL.createObjectURL(v), type: "video" });
        const wavResp = await fetch(window.makeWavDataUrl(3, 220));
        window.__aud = CS.media.register({ name: "Tone.wav", blobUrl: URL.createObjectURL(await wavResp.blob()), type: "audio" });
    });
    await page.waitForFunction(() => window.__vid.probed && window.__aud.probed, { timeout: 30000 });

    await page.evaluate(() => {
        window.__vclip = CS.addClipToTimeline(window.__vid, "V1", 0);
        window.__aclip = CS.addClipToTimeline(window.__aud, "A1", 0);
        CS.commit("seed");
        CS.selectClip(window.__vclip.id);
        CS.player.seek(1.0);
    });
    await page.waitForTimeout(600);

    /* ---- 1. preview overlay shows for selected clip ---- */
    const overlayBox = await page.evaluate(() => {
        const box = CS.previewctl.clipBox(window.__vclip);
        const ov = document.getElementById("preview-overlay");
        return { box: !!box, w: ov.clientWidth, h: ov.clientHeight };
    });
    if (!overlayBox.box || overlayBox.w < 100) fail("overlay not sized/positioned: " + JSON.stringify(overlayBox));
    ok("preview overlay active over canvas");

    /* ---- 2. drag clip in preview moves it ---- */
    const ovEl = page.locator("#preview-overlay");
    const ovRect = await ovEl.boundingBox();
    const cx = ovRect.x + ovRect.width / 2;
    const cy = ovRect.y + ovRect.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate(() => ({ x: window.__vclip.props.x, y: window.__vclip.props.y }));
    if (moved.x < 30 || moved.y < 15) fail("preview drag did not move clip: " + JSON.stringify(moved));
    ok(`preview drag moved clip to x=${moved.x}, y=${moved.y}`);

    /* ---- 3. corner handle resize changes scale ---- */
    await page.evaluate(() => {
        // bring the clip back fully on-screen so its handles are grabbable
        window.__vclip.props.x = 0;
        window.__vclip.props.y = 0;
        window.__vclip.props.scale = 60;
        CS.player.render();
    });
    const corner = await page.evaluate(() => {
        const box = CS.previewctl.clipBox(window.__vclip);
        const pts = CS.previewctl.corners(box);
        const rect = CS.player.canvas.getBoundingClientRect();
        const s = rect.width / CS.project.settings.width;
        return { x: rect.left + pts[2].x * s, y: rect.top + pts[2].y * s };
    });
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x - 80, corner.y - 45, { steps: 6 });
    await page.mouse.up();
    const scaled = await page.evaluate(() => window.__vclip.props.scale);
    if (scaled >= 60) fail("corner drag did not shrink clip: scale=" + scaled);
    ok(`corner resize scaled clip to ${scaled}%`);

    /* ---- 4. click other clip in preview selects it, empty deselects ---- */
    await page.evaluate(() => {
        window.__vclip.props.x = 0; window.__vclip.props.y = 0; window.__vclip.props.scale = 40;
        CS.player.render();
    });
    await page.mouse.click(ovRect.x + 20, ovRect.y + 20); // outside 40% box
    const sel = await page.evaluate(() => CS.state.selectedClipId);
    if (sel !== null) fail("click on empty preview did not deselect: " + sel);
    await page.mouse.click(cx, cy); // inside box again
    const sel2 = await page.evaluate(() => CS.state.selectedClipId);
    if (sel2 !== (await page.evaluate(() => window.__vclip.id))) fail("click on clip did not select it");
    ok("preview click selects / deselects clips");

    /* ---- 5. dragging audio clip below lanes creates a new audio track ---- */
    const beforeTracks = await page.evaluate(() => CS.project.tracks.length);
    const aBox = await page.locator(`.tl-clip[data-clip-id="${await page.evaluate(() => window.__aclip.id)}"]`).boundingBox();
    const tlRect = await page.locator("#tl-tracks").boundingBox();
    await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(aBox.x + aBox.width / 2 + 10, tlRect.y + tlRect.height + 30, { steps: 6 });
    await page.mouse.up();
    const trackInfo = await page.evaluate(() => ({
        n: CS.project.tracks.length,
        clipTrack: CS.getClip(window.__aclip.id).trackId,
        audioTracks: CS.project.tracks.filter(t => t.kind === "audio").length
    }));
    if (trackInfo.n !== beforeTracks + 1) fail("no new track created: " + JSON.stringify(trackInfo));
    if (trackInfo.clipTrack !== "A3") fail("clip not moved to new track: " + trackInfo.clipTrack);
    ok(`drag below lanes created ${trackInfo.clipTrack} (${trackInfo.audioTracks} audio tracks now)`);

    /* ---- 6. .pxs import (raster + text layers, blend/opacity) ---- */
    await page.evaluate(() => {
        const lc = document.createElement("canvas");
        lc.width = 400; lc.height = 300;
        const lctx = lc.getContext("2d");
        lctx.fillStyle = "#c62828";
        lctx.fillRect(0, 0, 400, 300);
        const pxs = {
            app: "PixelStudio", version: 1, width: 400, height: 300, active: 0,
            layers: [
                { name: "bg", visible: true, opacity: 1, blend: "source-over", type: "raster", data: lc.toDataURL("image/png") },
                { name: "txt", visible: true, opacity: 1, blend: "source-over", type: "text",
                  text: { content: "Hi", x: 20, y: 20, size: 60, color: "#ffffff", font: "Arial", bold: true, italic: false } },
                { name: "hidden", visible: false, opacity: 1, blend: "source-over", type: "raster", data: lc.toDataURL("image/png") }
            ]
        };
        const blob = new Blob([JSON.stringify(pxs)], { type: "application/json" });
        window.__pxs = CS.media.register({
            name: "Poster.pxs", blobUrl: URL.createObjectURL(blob), type: "image", srcKind: "pxs"
        });
    });
    await page.waitForFunction(() => window.__pxs.probed, { timeout: 15000 });
    const pxsInfo = await page.evaluate(() => ({
        offline: window.__pxs.offline, w: window.__pxs.width, h: window.__pxs.height,
        thumbs: window.__pxs.thumbs.length, composite: !!window.__pxs.compositeUrl
    }));
    if (pxsInfo.offline) fail(".pxs marked offline");
    if (pxsInfo.w !== 400 || pxsInfo.h !== 300) fail(".pxs dimensions wrong: " + JSON.stringify(pxsInfo));
    if (!pxsInfo.thumbs || !pxsInfo.composite) fail(".pxs not composited");
    // place on timeline and verify the red pixel shows
    await page.evaluate(() => {
        CS.project.clips = CS.project.clips.filter(c => c.trackId !== "V1");
        const c = CS.addClipToTimeline(window.__pxs, "V1", 0);
        c.props.crop = "fill";
        CS.commit("pxs clip");
        CS.player.seek(0.5);
    });
    await page.waitForTimeout(400);
    const pxsPx = await page.evaluate(() => {
        const cv = document.getElementById("preview-canvas");
        const d = cv.getContext("2d").getImageData(Math.floor(cv.width * 0.7), Math.floor(cv.height * 0.7), 1, 1).data;
        return [d[0], d[1], d[2]];
    });
    if (!(pxsPx[0] > 140 && pxsPx[1] < 90)) fail(".pxs frame not red: " + pxsPx);
    ok(`.pxs imported, composited 400x300, renders red (rgb ${pxsPx})`);

    /* ---- 7. .asproj with rendered mixdown ---- */
    await page.evaluate(() => {
        const asproj = { app: "AudioStudio", version: 1, name: "Mix", mixdown: window.makeWavDataUrl(2, 440) };
        const blob = new Blob([JSON.stringify(asproj)], { type: "application/json" });
        window.__as1 = CS.media.register({
            name: "Song.asproj", blobUrl: URL.createObjectURL(blob), type: "audio", srcKind: "asproj"
        });
    });
    await page.waitForFunction(() => window.__as1.probed, { timeout: 15000 });
    const as1 = await page.evaluate(() => ({
        offline: window.__as1.offline, dur: window.__as1.duration, peaks: (window.__as1.peaks || []).length
    }));
    if (as1.offline) fail("mixdown .asproj offline");
    if (!(as1.dur > 1.8 && as1.dur < 2.2)) fail("mixdown duration wrong: " + as1.dur);
    ok(`.asproj mixdown imported (${as1.dur.toFixed(2)}s, ${as1.peaks} peaks)`);

    /* ---- 8. .asproj with tracks/clips mixed offline ---- */
    await page.evaluate(() => {
        const asproj = {
            app: "AudioStudio", version: 1,
            tracks: [
                { name: "T1", volume: 1, clips: [{ src: window.makeWavDataUrl(1.5, 330), start: 0 }] },
                { name: "T2", volume: 0.6, clips: [{ src: window.makeWavDataUrl(1.5, 550), start: 1.0 }] }
            ]
        };
        const blob = new Blob([JSON.stringify(asproj)], { type: "application/json" });
        window.__as2 = CS.media.register({
            name: "Session.asproj", blobUrl: URL.createObjectURL(blob), type: "audio", srcKind: "asproj"
        });
    });
    await page.waitForFunction(() => window.__as2.probed, { timeout: 20000 });
    const as2 = await page.evaluate(() => ({
        offline: window.__as2.offline, dur: window.__as2.duration, peaks: (window.__as2.peaks || []).length
    }));
    if (as2.offline) fail("track-mix .asproj offline");
    if (!(as2.dur > 2.3 && as2.dur < 2.7)) fail("mixed duration wrong (want ~2.5): " + as2.dur);
    ok(`.asproj track mix rendered offline (${as2.dur.toFixed(2)}s, ${as2.peaks} peaks)`);

    /* ---- 9. audio playback of imported asproj on the timeline ---- */
    await page.evaluate(() => {
        CS.addClipToTimeline(window.__as1, "A1", 0);
        CS.commit("asproj clip");
    });
    await page.click("#btn-play");
    await page.waitForTimeout(900);
    const playing = await page.evaluate(() => CS.state.playing && CS.state.playhead > 0.4);
    if (!playing) fail("timeline with imported media does not play");
    await page.click("#btn-play");
    ok("imported project media plays on the timeline");
});
