/*
    Shared support for the Cine Studio Cypress suite.

    Commands:
      cy.openStudio()          open the app in standalone mode, wait for boot
      cy.seedMedia(opts)       generate real media in the page (WebM video,
                               WAV audio, PNG still) and register it in the
                               media pool; yields the media objects by key
      cy.cs(fn, ...args)       run fn(CS, win, ...args) with the app's CS
                               global and window, yield its return value
                               (win.__media holds what seedMedia made)
      cy.centerPixel()         yield the RGBA of the preview centre pixel
      cy.pixelAt(fx, fy)       yield the RGBA of the preview at a fraction of
                               the frame (0..1)
*/

// The app must not fail a spec because of an incidental error in a media
// element; those are asserted on explicitly where they matter
Cypress.on("uncaught:exception", function (err) {
    cy.task("log", "[uncaught:exception] " + err.message, { log: false });
    return false;
});

Cypress.Commands.add("openStudio", function () {
    cy.visit("/Cine%20Studio/index.html", {
        onBeforeLoad: function (win) {
            // main.js keeps an existing window.CS, so this flag makes
            // CS.inArozOS() false: no AGI calls, local media, downloads
            win.CS = { _forceStandalone: true };
            try { win.localStorage.clear(); } catch (e) { /* ignore */ }
        }
    });
    cy.window().its("CS.project").should("exist");
    cy.get("#preview-canvas").should("exist");
});

Cypress.Commands.add("cs", function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return cy.window({ log: false }).then(function (win) {
        return fn.apply(null, [win.CS, win].concat(args));
    });
});

// Generates media inside the page. opts: { video: [{key, name, seconds,
// hue}], audio: [{key, name, seconds}], image: [{key, name, color}] }
Cypress.Commands.add("seedMedia", function (opts) {
    opts = opts || {};
    var video = opts.video === undefined ? [{ key: "v1", name: "ClipA.webm", seconds: 3, hue: 200 }] : opts.video;
    var audio = opts.audio === undefined ? [{ key: "a1", name: "Tone.wav", seconds: 4 }] : opts.audio;
    var image = opts.image === undefined ? [] : opts.image;

    return cy.window({ log: false }).then({ timeout: 60000 }, function (win) {
        var CS = win.CS;
        var doc = win.document;

        function makeVideo(seconds, hue) {
            return new Promise(function (resolve) {
                var cv = doc.createElement("canvas");
                cv.width = 320;
                cv.height = 180;
                var ctx = cv.getContext("2d");
                var stream = cv.captureStream(15);
                var rec = new win.MediaRecorder(stream, { mimeType: "video/webm" });
                var chunks = [];
                rec.ondataavailable = function (e) { if (e.data.size) { chunks.push(e.data); } };
                rec.onstop = function () { resolve(new win.Blob(chunks, { type: "video/webm" })); };
                var t0 = win.performance.now();
                (function draw() {
                    var t = (win.performance.now() - t0) / 1000;
                    ctx.fillStyle = "hsl(" + hue + ", 60%, 40%)";
                    ctx.fillRect(0, 0, 320, 180);
                    ctx.fillStyle = "#fff";
                    ctx.fillRect((t * 60) % 320, 60, 40, 60);
                    if (t < seconds) { win.requestAnimationFrame(draw); } else { rec.stop(); }
                })();
                rec.start(200);
            });
        }

        function makeWav(seconds) {
            var sr = 22050, n = sr * seconds;
            var buf = new ArrayBuffer(44 + n * 2);
            var dv = new DataView(buf);
            function ws(o, s) { for (var i = 0; i < s.length; i++) { dv.setUint8(o + i, s.charCodeAt(i)); } }
            ws(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ws(8, "WAVEfmt ");
            dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
            dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
            dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
            ws(36, "data"); dv.setUint32(40, n * 2, true);
            for (var i = 0; i < n; i++) {
                dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 330 * i / sr) * 12000, true);
            }
            return new win.Blob([buf], { type: "audio/wav" });
        }

        function makePng(color) {
            return new Promise(function (resolve) {
                var cv = doc.createElement("canvas");
                cv.width = 200;
                cv.height = 120;
                var ctx = cv.getContext("2d");
                ctx.fillStyle = color || "#ff0000";
                ctx.fillRect(0, 0, 200, 120);
                cv.toBlob(resolve, "image/png");
            });
        }

        var out = {};
        var chain = Promise.resolve();
        video.forEach(function (v) {
            chain = chain.then(function () { return makeVideo(v.seconds || 3, v.hue || 200); }).then(function (blob) {
                out[v.key] = CS.media.register({ name: v.name, blobUrl: win.URL.createObjectURL(blob), type: "video" });
            });
        });
        audio.forEach(function (a) {
            chain = chain.then(function () {
                out[a.key] = CS.media.register({ name: a.name, blobUrl: win.URL.createObjectURL(makeWav(a.seconds || 4)), type: "audio" });
            });
        });
        image.forEach(function (im) {
            chain = chain.then(function () { return makePng(im.color); }).then(function (blob) {
                out[im.key] = CS.media.register({ name: im.name, blobUrl: win.URL.createObjectURL(blob), type: "image" });
            });
        });
        return chain.then(function () {
            win.__media = out;
            return new Promise(function (resolve) {
                (function wait() {
                    var all = Object.keys(out).every(function (k) { return out[k].probed; });
                    if (all) { resolve(out); } else { win.setTimeout(wait, 100); }
                })();
            });
        });
    });
});

Cypress.Commands.add("pixelAt", function (fx, fy) {
    return cy.window({ log: false }).then(function (win) {
        var cv = win.document.getElementById("preview-canvas");
        var ctx = cv.getContext("2d");
        var x = Math.max(0, Math.min(cv.width - 1, Math.floor(cv.width * fx)));
        var y = Math.max(0, Math.min(cv.height - 1, Math.floor(cv.height * fy)));
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
    });
});

Cypress.Commands.add("centerPixel", function () {
    return cy.pixelAt(0.5, 0.5);
});

// Drag an element by (dx, dy) pixels with pointer events, the way the
// timeline listens for them (pointerdown on the element, moves and the
// pointerup on the window)
Cypress.Commands.add("dragBy", function (selector, dx, dy, steps) {
    steps = steps || 6;
    cy.get(selector).first().then(function ($el) {
        var r = $el[0].getBoundingClientRect();
        var x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        cy.wrap($el).trigger("pointerdown", { button: 0, clientX: x0, clientY: y0, pointerId: 1, force: true });
        for (var i = 1; i <= steps; i++) {
            cy.get("body").trigger("pointermove", {
                clientX: x0 + dx * i / steps, clientY: y0 + (dy || 0) * i / steps, pointerId: 1, force: true
            });
        }
        cy.get("body").trigger("pointerup", { clientX: x0 + dx, clientY: y0 + (dy || 0), pointerId: 1, force: true });
    });
});

// Two adjacent video clips A (0..3s) and B (3..6s) from the same generated
// footage, plus an audio clip; yields the clip ids
Cypress.Commands.add("seedSequence", function () {
    cy.seedMedia({ video: [{ key: "v1", name: "ClipA.webm", seconds: 3, hue: 200 }, { key: "v2", name: "ClipB.webm", seconds: 3, hue: 30 }] });
    return cy.cs(function (CS, win) {
        var m = win.__media;
        var a = CS.addClipToTimeline(m.v1, "V1", 0);
        var b = CS.addClipToTimeline(m.v2, "V1", CS.clipDuration(a));
        var au = CS.addClipToTimeline(m.a1, "A1", 0);
        CS.commit("seed");
        return { a: a.id, b: b.id, au: au.id, aDur: CS.clipDuration(a), bDur: CS.clipDuration(b) };
    });
});
