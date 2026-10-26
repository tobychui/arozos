/*
    Feature test for the second iteration: effects, titles, transitions,
    elements, filters, list view - verified end to end with real
    in-browser generated media and pixel sampling.
*/
"use strict";

const { ok, fail, run } = require("../lib/harness");

run("FEATURE", async (page, browser) => {

    // traffic lights must be gone
    const hasTL = await page.evaluate(() => !!document.getElementById("traffic-lights"));
    if (hasTL) fail("traffic lights still present");
    ok("macOS traffic lights removed");

    /* ---- media: one real video clip ---- */
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
        const blob = await makeVideo(3, 210);
        window.__m = CS.media.register({ name: "Base.webm", blobUrl: URL.createObjectURL(blob), type: "video" });
    });
    await page.waitForFunction(() => window.__m.probed, { timeout: 30000 });

    const samplePx = () => page.evaluate(() => {
        const cv = document.getElementById("preview-canvas");
        const d = cv.getContext("2d").getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
        return [d[0], d[1], d[2]];
    });

    /* ---- effects ---- */
    await page.evaluate(() => {
        const c = CS.addClipToTimeline(window.__m, "V1", 0);
        window.__clip = c;
        CS.commit("seed");
        CS.selectClip(c.id);
        CS.player.seek(1.0);
    });
    await page.waitForTimeout(700);
    const base = await samplePx();
    if (base[0] + base[1] + base[2] < 20) fail("baseline frame is black");

    await page.evaluate(() => CS.effects.applyToClip(window.__clip, "bw"));
    await page.waitForTimeout(250);
    const bw = await samplePx();
    if (Math.abs(bw[0] - bw[1]) > 6 || Math.abs(bw[1] - bw[2]) > 6) fail("B&W effect not applied: " + bw);
    ok(`B&W effect desaturates (rgb ${bw})`);

    await page.evaluate(() => {
        CS.effects.removeFromClip(window.__clip, "bw");
        CS.effects.applyToClip(window.__clip, "invert");
    });
    await page.waitForTimeout(250);
    const inv = await samplePx();
    if (Math.abs(inv[0] - base[0]) < 30 && Math.abs(inv[2] - base[2]) < 30) fail("invert changed nothing: " + inv + " vs " + base);
    ok(`invert flips colors (rgb ${base} -> ${inv})`);

    await page.evaluate(() => {
        CS.effects.removeFromClip(window.__clip, "invert");
        CS.effects.applyToClip(window.__clip, "fadein"); // 1s default
        CS.player.seek(0.06);
    });
    await page.waitForTimeout(500);
    const faded = await samplePx();
    if (faded[0] + faded[1] + faded[2] > base[0] + base[1] + base[2] * 0.5) fail("fade-in start not dark: " + faded);
    await page.evaluate(() => CS.player.seek(2.0));
    await page.waitForTimeout(400);
    const unfaded = await samplePx();
    if (unfaded[0] + unfaded[1] + unfaded[2] < 20) fail("frame after fade window is dark");
    ok(`fade-in ramps alpha (start rgb ${faded}, later rgb ${unfaded})`);

    await page.evaluate(() => {
        CS.effects.applyToClip(window.__clip, "pixelate");
        CS.effects.applyToClip(window.__clip, "vignette");
        CS.effects.applyToClip(window.__clip, "grain");
        CS.player.seek(1.5);
    });
    await page.waitForTimeout(300);
    const fxCount = await page.evaluate(() => window.__clip.props.effects.length);
    if (fxCount !== 4) fail("expected 4 effects on clip, got " + fxCount);
    const fxBadge = await page.evaluate(() => !!document.querySelector(".tl-clip .clip-fx"));
    if (!fxBadge) fail("fx badge missing on timeline clip");
    ok("pixelate + vignette + grain stack renders, fx badge shown");

    /* ---- undo restores effect stack ---- */
    const undoCount = await page.evaluate(() => { CS.undo(); return window.__clip ? CS.getClip(window.__clip.id).props.effects.length : -1; });
    if (undoCount !== 3) fail("undo did not pop effect stack: " + undoCount);
    await page.evaluate(() => CS.redo());
    ok("undo/redo covers effects");

    /* ---- titles ---- */
    await page.evaluate(() => {
        CS.player.seek(1.5);
        CS.titles.insertPreset("title");
        const t = CS.selectedClip();
        t.props.text.content = "BIG";
        t.props.text.size = 400;
        CS.titles.invalidate(t);
        window.__title = t;
        CS.player.render();
    });
    await page.waitForTimeout(300);
    const titleInfo = await page.evaluate(() => ({
        kind: window.__title.kind,
        track: window.__title.trackId,
        tracks: CS.project.tracks.filter(t => t.kind === "video").length
    }));
    if (titleInfo.kind !== "title") fail("title clip not created");
    if (titleInfo.track === "V1") fail("title landed on the busy V1 track");
    const titlePx = await samplePx();
    if (titlePx[0] < 180 || titlePx[1] < 180 || titlePx[2] < 180) fail("title text not visible at center: " + titlePx);
    ok(`title clip renders on ${titleInfo.track} (center rgb ${titlePx})`);

    /* ---- elements (color board) ---- */
    await page.evaluate(() => {
        CS.deleteSelectedClip(); // remove title again
        CS.player.seek(10);
        CS.titles.insertElement("red");
        CS.player.render();
    });
    await page.waitForTimeout(200);
    const redPx = await samplePx();
    if (!(redPx[0] > 130 && redPx[1] < 90)) fail("color element not red: " + redPx);
    await page.evaluate(() => { CS.deleteSelectedClip(); });
    ok(`color element renders (rgb ${redPx})`);

    /* ---- transitions ---- */
    await page.evaluate(() => {
        // second clip right after the first, dissolve into it
        const c2 = CS.addClipToTimeline(window.__m, "V1", CS.clipEnd(window.__clip));
        window.__clip2 = c2;
        CS.selectClip(c2.id);
        CS.transitions.applyToSelected("dissolve");
        window.__clip2 = CS.getClip(c2.id);
    });
    const trInfo = await page.evaluate(() => ({
        type: window.__clip2.props.transition && window.__clip2.props.transition.type,
        frozen: Object.keys(CS.transitions.frozenTargets(window.__clip2.start + 0.3)).length,
        marker: !!document.querySelector(".tl-clip .clip-tr")
    }));
    if (trInfo.type !== "dissolve") fail("transition not stored");
    if (trInfo.frozen !== 1) fail("frozen predecessor not detected");
    if (!trInfo.marker) fail("transition marker missing on clip");
    await page.evaluate(() => CS.player.seek(window.__clip2.start + 0.3));
    await page.waitForTimeout(600);
    const trPx = await samplePx();
    if (trPx[0] + trPx[1] + trPx[2] < 20) fail("transition window renders black: " + trPx);
    ok(`dissolve transition renders mid-window (rgb ${trPx})`);

    /* ---- filters panel + galleries render ---- */
    const galleries = await page.evaluate(() => {
        CS.panels.show("fx");
        const fx = document.querySelectorAll("#fx-grid .fx-card").length;
        CS.panels.show("titles");
        const ti = document.querySelectorAll("#titles-grid .fx-card").length;
        CS.panels.show("transitions");
        const tr = document.querySelectorAll("#transitions-grid .fx-card").length;
        CS.panels.show("elements");
        const el = document.querySelectorAll("#elements-grid .fx-card").length;
        CS.panels.show("filters");
        const fi = document.querySelectorAll("#filters-grid .fx-card").length;
        CS.panels.show("media");
        return { fx, ti, tr, el, fi };
    });
    if (galleries.fx < 10) fail("effects gallery incomplete: " + galleries.fx);
    if (galleries.ti < 4 || galleries.tr < 3 || galleries.el < 8 || galleries.fi < 5) {
        fail("gallery counts wrong: " + JSON.stringify(galleries));
    }
    ok(`galleries render (${galleries.fx} effects, ${galleries.ti} titles, ${galleries.tr} transitions, ${galleries.el} elements, ${galleries.fi} filters)`);

    /* ---- filter look via inspector.applyPreset ---- */
    await page.evaluate(() => {
        CS.selectClip(window.__clip.id);
        CS.inspector.applyPreset(CS.getClip(window.__clip.id), "mono");
    });
    const preset = await page.evaluate(() => CS.getClip(window.__clip.id).props.preset);
    if (preset !== "mono") fail("filter preset not applied");
    ok("filter look applies color preset");

    /* ---- list view toggle ---- */
    await page.click("#btn-bin-view");
    const listMode = await page.evaluate(() => document.getElementById("bin-grid").classList.contains("list-mode"));
    if (!listMode) fail("list view did not activate");
    await page.click("#btn-bin-view");
    ok("media bin list view toggles");

    /* ---- serialization round trip with generated clips ---- */
    const rt = await page.evaluate(() => {
        CS.player.seek(1.5);
        CS.titles.insertPreset("lowerthird");
        const before = CS.project.clips.length;
        const beforeTitles = CS.project.clips.filter(c => c.kind === "title").length;
        const json = CS.fileio.serializeProject();
        CS.fileio.loadProject(JSON.parse(json), "", "rt.cine");
        return {
            before, beforeTitles,
            after: CS.project.clips.length,
            afterTitles: CS.project.clips.filter(c => c.kind === "title").length,
            transition: CS.project.clips.some(c => c.props.transition && c.props.transition.type === "dissolve"),
            effects: CS.project.clips.some(c => (c.props.effects || []).length > 0)
        };
    });
    if (rt.after !== rt.before) fail("clips lost in round trip: " + JSON.stringify(rt));
    if (rt.afterTitles !== rt.beforeTitles) fail("title clips lost in round trip");
    if (!rt.transition) fail("transition lost in round trip");
    if (!rt.effects) fail("effects lost in round trip");
    ok("round trip preserves titles, transitions and effect stacks");
});
