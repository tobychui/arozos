/*
    Iteration 4 tests: autosave/recovery, recents, copy/paste/duplicate,
    multi-select, ripple delete, markers, snap toggle, clip speed,
    blend modes, flip, JKL shuttle, loop, export frame, detach audio,
    audio track solo.
*/
"use strict";

const { ok, fail, run } = require("../lib/harness");

run("EDITING", async (page, browser) => {
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

    /* ---- seed real media ---- */
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
        const v = await makeVideo(3, 210);
        window.__vid = CS.media.register({ name: "Base.webm", blobUrl: URL.createObjectURL(v), type: "video" });
        // asymmetric test image: left red, right blue
        const ic = document.createElement("canvas");
        ic.width = 320; ic.height = 180;
        const ictx = ic.getContext("2d");
        ictx.fillStyle = "#c62828"; ictx.fillRect(0, 0, 160, 180);
        ictx.fillStyle = "#1e63c9"; ictx.fillRect(160, 0, 160, 180);
        window.__img = CS.media.register({ name: "Split.png", blobUrl: ic.toDataURL("image/png"), type: "image" });
    });
    await page.waitForFunction(() => window.__vid.probed && window.__img.probed, { timeout: 30000 });

    const px = (fx, fy) => page.evaluate(([fx, fy]) => {
        const cv = document.getElementById("preview-canvas");
        const d = cv.getContext("2d").getImageData(Math.floor(cv.width * fx), Math.floor(cv.height * fy), 1, 1).data;
        return [d[0], d[1], d[2]];
    }, [fx, fy]);

    /* ---- 1. copy / paste / duplicate / multi-select / ripple ---- */
    const editing = await page.evaluate(() => {
        const c1 = CS.addClipToTimeline(window.__vid, "V1", 0);
        const c2 = CS.addClipToTimeline(window.__vid, "V1", CS.clipDuration(c1));
        CS.commit("seed");
        window.__c1 = c1; window.__c2 = c2;

        // multi-select both
        CS.selectClip(c1.id);
        CS.toggleSelectClip(c2.id);
        const multi = CS.state.selectedClipIds.length;

        // copy + paste at playhead 10
        CS.copySelectedClips();
        CS.state.playhead = 10; //seek() clamps to timeline duration
        CS.pasteClipsAtPlayhead();
        const afterPaste = CS.project.clips.length;

        // duplicate the pasted pair
        CS.duplicateSelectedClips();
        const afterDup = CS.project.clips.length;

        // group delete the 4 new ones
        CS.deleteSelectedClip(); // deletes duplicated selection (2)
        CS.selectClip(CS.project.clips.filter(c => c.start >= 9)[0].id);
        CS.toggleSelectClip(CS.project.clips.filter(c => c.start >= 9)[1].id);
        CS.deleteSelectedClip();
        const afterCleanup = CS.project.clips.length;

        // ripple delete c1: c2 shifts to 0
        CS.selectClip(window.__c1.id);
        CS.rippleDeleteSelected();
        return {
            multi, afterPaste, afterDup, afterCleanup,
            c2start: CS.getClip(window.__c2.id).start,
            n: CS.project.clips.length
        };
    });
    if (editing.multi !== 2) fail("multi-select failed");
    if (editing.afterPaste !== 4) fail("paste failed: " + editing.afterPaste);
    if (editing.afterDup !== 6) fail("duplicate failed: " + editing.afterDup);
    if (editing.afterCleanup !== 2) fail("group delete failed: " + editing.afterCleanup);
    if (editing.n !== 1 || editing.c2start > 0.01) fail("ripple delete did not close gap: " + JSON.stringify(editing));
    ok(`multi-select/copy/paste/duplicate/group-delete/ripple all work (c2 rippled to ${editing.c2start})`);

    /* ---- 2. markers ---- */
    const markers = await page.evaluate(() => {
        CS.player.seek(1.0); CS.toggleMarkerAtPlayhead();
        CS.player.seek(2.0); CS.toggleMarkerAtPlayhead();
        CS.player.seek(0);
        CS.gotoMarker(1);
        const jumped = CS.state.playhead;
        CS.player.seek(2.0);
        CS.toggleMarkerAtPlayhead(); // remove marker at 2.0
        return { n: CS.project.markers.length, jumped };
    });
    if (Math.abs(markers.jumped - 1.0) > 0.02) fail("goto marker failed: " + markers.jumped);
    if (markers.n !== 1) fail("marker toggle-remove failed: " + markers.n);
    ok("markers: add, jump, remove");

    /* ---- 3. snap toggle ---- */
    const snap = await page.evaluate(() => {
        const clip = CS.project.clips[0];
        CS.state.snap = true;
        const snapped = CS.timeline.applySnap(CS.state.playhead + 0.05, clip, "trim");
        CS.state.snap = false;
        const unsnapped = CS.timeline.applySnap(CS.state.playhead + 0.05, clip, "trim");
        CS.state.snap = true;
        return { snapped, unsnapped, ph: CS.state.playhead };
    });
    if (Math.abs(snap.snapped - snap.ph) > 0.001) fail("snap did not snap to playhead");
    if (Math.abs(snap.unsnapped - snap.ph) < 0.001) fail("snap-off still snapped");
    ok("snapping toggle works");

    /* ---- 4. clip speed ---- */
    const speed = await page.evaluate(() => {
        const clip = CS.project.clips[0];
        window.__c = clip;
        const durBefore = CS.clipDuration(clip);
        clip.props.speed = 2;
        CS.commit("speed");
        const durAfter = CS.clipDuration(clip);
        CS.player.seek(0.5);
        const el = CS.player.pool[clip.id];
        return { durBefore, durAfter, elTime: el ? el.currentTime : -1, expect: clip.in + 0.5 * 2 };
    });
    if (Math.abs(speed.durAfter - speed.durBefore / 2) > 0.01) fail("2x speed did not halve duration");
    if (Math.abs(speed.elTime - speed.expect) > 0.1) fail("speed-aware seek wrong: " + JSON.stringify(speed));
    ok(`clip speed 2x: duration ${speed.durBefore.toFixed(2)}s -> ${speed.durAfter.toFixed(2)}s, source seek correct`);
    await page.evaluate(() => { window.__c.props.speed = 1; CS.commit("speed reset"); });

    /* ---- 5. flip horizontal (asymmetric image) ---- */
    await page.evaluate(() => {
        CS.project.clips = [];
        const c = CS.addClipToTimeline(window.__img, "V1", 0);
        c.props.crop = "fill";
        window.__ic = c;
        CS.commit("img");
        CS.player.seek(0.5);
    });
    await page.waitForTimeout(300);
    const left0 = await px(0.25, 0.5);
    await page.evaluate(() => { window.__ic.props.flipH = true; CS.player.render(); });
    const left1 = await px(0.25, 0.5);
    if (!(left0[0] > 140 && left0[2] < 90)) fail("baseline left not red: " + left0);
    if (!(left1[2] > 120 && left1[0] < 90)) fail("flipH left not blue: " + left1);
    ok(`flip horizontal verified (left rgb ${left0} -> ${left1})`);

    /* ---- 6. blend mode (additive over color boards) ---- */
    const blend = await page.evaluate(() => {
        CS.project.clips = [];
        CS.player.seek(0.5);
        CS.titles.insertElement("red");    // lands on V1 (empty)
        const red = CS.selectedClip();
        red.start = 0;
        CS.titles.insertElement("blue");   // V1 busy -> V2
        const blue = CS.selectedClip();
        blue.start = 0;
        blue.props.blend = "lighter";
        CS.commit("blend");
        CS.player.render();
        const cv = document.getElementById("preview-canvas");
        const d = cv.getContext("2d").getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
        return [d[0], d[1], d[2]];
    });
    if (!(blend[0] > 140 && blend[2] > 140)) fail("additive blend not magenta-ish: " + blend);
    ok(`blend mode Add composites (rgb ${blend})`);

    /* ---- 7. JKL + loop ---- */
    await page.evaluate(() => {
        CS.project.clips = [];
        const c = CS.addClipToTimeline(window.__vid, "V1", 0);
        c.out = Math.min(c.out, 1.2);
        CS.commit("loop seed");
        CS.player.seek(0);
    });
    await page.keyboard.press("l");
    await page.keyboard.press("l");
    const rate = await page.evaluate(() => CS.player.rate);
    if (rate !== 2) fail("LL did not reach 2x: " + rate);
    await page.keyboard.press("k");
    const paused = await page.evaluate(() => !CS.state.playing);
    if (!paused) fail("K did not pause");
    await page.evaluate(() => { CS.state.loop = true; CS.player.seek(0); });
    await page.click("#btn-play");
    await page.waitForTimeout(1900); // > clip length: must have looped
    const loopState = await page.evaluate(() => ({ playing: CS.state.playing, ph: CS.state.playhead, dur: CS.timelineDuration() }));
    if (!loopState.playing) fail("loop did not keep playing: " + JSON.stringify(loopState));
    if (loopState.ph >= loopState.dur) fail("loop did not wrap");
    await page.evaluate(() => { CS.player.pause(); CS.state.loop = false; });
    ok(`JKL shuttle + loop playback (wrapped to ${loopState.ph.toFixed(2)}s)`);

    /* ---- 8. export current frame (PNG) ---- */
    const frameSize = await page.evaluate(() => new Promise((resolve) => {
        CS._forceStandalone = true; // use the download path in the test env
        CS.fileio.downloadBlob = function (blob) { resolve(blob.size); };
        CS.player.seek(0.4);
        CS.exporter.exportFrame();
    }));
    await page.evaluate(() => { CS._forceStandalone = false; });
    if (frameSize < 2000) fail("frame PNG too small: " + frameSize);
    ok(`export current frame produced PNG of ${frameSize} bytes`);

    /* ---- 9. detach audio ---- */
    const detach = await page.evaluate(() => {
        CS.project.clips = [];
        const c = CS.addClipToTimeline(window.__vid, "V1", 0);
        CS.commit("detach seed");
        CS.detachAudio(c);
        const audioClips = CS.project.clips.filter(cl => CS.getTrack(cl.trackId).kind === "audio");
        return {
            n: CS.project.clips.length,
            audio: audioClips.length,
            origVol: c.props.volume,
            flagged: c.props.audioDetached,
            track: audioClips.length ? audioClips[0].trackId : ""
        };
    });
    if (detach.n !== 2 || detach.audio !== 1) fail("detach did not create audio clip: " + JSON.stringify(detach));
    if (detach.origVol !== 0 || !detach.flagged) fail("original clip audio not silenced");
    ok(`detach audio -> ${detach.track}, original muted`);

    /* ---- 10. track solo ---- */
    const solo = await page.evaluate(() => {
        const a1 = CS.getTrack("A1");
        a1.solo = true;
        const det = CS.project.clips.filter(cl => CS.getTrack(cl.trackId).kind === "audio")[0];
        // move detached clip to A2 so it should be muted by the solo
        det.trackId = "A2";
        CS.player.syncElements();
        const el = CS.player.pool[det.id];
        const mutedWhenSolo = el.muted;
        a1.solo = false;
        CS.player.syncElements();
        return { mutedWhenSolo, mutedAfter: el.muted };
    });
    if (!solo.mutedWhenSolo) fail("solo did not mute other audio track");
    if (solo.mutedAfter) fail("unsolo did not restore");
    ok("audio track solo mutes other audio tracks");

    /* ---- 11. autosave + recovery ---- */
    await page.evaluate(() => {
        CS.project.name = "RecoverMe";
        CS.markDirty();
        CS.session.saveSnapshot();
    });
    const hasSnap = await page.evaluate(() => !!localStorage.getItem("cinestudio_autosave"));
    if (!hasSnap) fail("autosave snapshot missing");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.CS && CS.project);
    await page.waitForSelector(".modal", { timeout: 5000 }).catch(() => fail("recovery modal did not appear"));
    const modalText = await page.evaluate(() => document.querySelector(".modal").textContent);
    if (modalText.indexOf("RecoverMe") < 0) fail("recovery modal missing project name");
    await page.click(".modal-btn.primary"); // Restore
    const restored = await page.evaluate(() => ({
        name: CS.project.name,
        clips: CS.project.clips.length
    }));
    if (restored.name !== "RecoverMe") fail("restore did not recover name: " + restored.name);
    if (restored.clips < 2) fail("restore did not recover clips: " + restored.clips);
    ok(`autosave recovery restored "${restored.name}" with ${restored.clips} clips`);

    /* ---- 12. recent projects list ---- */
    const recents = await page.evaluate(() => {
        CS.session.recordRecent("Alpha", "user:/Cine Studio/Projects/Alpha.cine");
        CS.session.recordRecent("Beta", "user:/Cine Studio/Projects/Beta.cine");
        CS.session.recordRecent("Alpha", "user:/Cine Studio/Projects/Alpha.cine"); // dedupe to front
        return CS.session.recents().map(r => r.name);
    });
    if (recents.length !== 2 || recents[0] !== "Alpha") fail("recents list wrong: " + recents);
    ok("recent projects list records and dedupes");
});
