/*
    ArozOS Office - Slides: present mode + export helpers
    Requires slides.js (SlidesApp), html2canvas, pdf-lib (PDFLib).

    SlidesPresent - fullscreen presentation with keyboard/click navigation,
                    slide transitions, click-to-reveal entrance animations,
                    interactive object links, a laser pointer (L key),
                    slide counter, presenter timer and a presenter view
                    popup (current + next slide + speaker notes).
    SlidesExport  - PDF (html2canvas -> pdf-lib) and PNG export.
*/

var SlidesPresent = (function () {
    var active = false;
    var idx = 0;
    var revealed = 0;          // how many animated objects are shown
    var $ov = null;
    var stageEl = null;
    var startTime = 0;
    var timerInterval = null;
    var laserOn = false;
    var pw = null;             // presenter view popup window

    function slideCount() { return SlidesApp.slideCount(); }
    function slideAt(i) { return SlidesApp.getBody().slides[i]; }

    // objects with an entrance animation, in stacking order
    function animQueue(slide) {
        return (slide.objects || []).filter(function (o) {
            return o.props && o.props.anim;
        });
    }

    function fmtTime(ms) {
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        s = s % 60;
        var h = Math.floor(m / 60);
        m = m % 60;
        var pad = function (n) { return (n < 10 ? "0" : "") + n; };
        return (h > 0 ? h + ":" + pad(m) : m + "") + ":" + pad(s);
    }

    function layout() {
        if (!active || !stageEl) return;
        var vw = window.innerWidth, vh = window.innerHeight;
        var sc = Math.min(vw / 960, vh / 540);
        stageEl.style.transform = "translate(-50%, -50%) scale(" + sc + ")";
        // transitions animate the transform, so they need the scale too
        stageEl.style.setProperty("--slp-sc", sc);
    }

    /* render the current slide; withTransition plays the slide's entry
       animation, reveal count hides not-yet-revealed animated objects */
    function renderCurrent(withTransition) {
        if (!active) return;
        var body = SlidesApp.getBody();
        if (!body || !body.slides.length) { stop(); return; }
        idx = Math.max(0, Math.min(idx, body.slides.length - 1));
        var slide = slideAt(idx);
        SlidesApp.renderSlideContent(stageEl, slide);

        // hide animated objects that have not been revealed yet
        var queue = animQueue(slide);
        for (var i = revealed; i < queue.length; i++) {
            var el = stageEl.querySelector('[data-id="' + queue[i].id + '"]');
            if (el) el.style.visibility = "hidden";
        }

        if (withTransition) {
            var tr = slide.transition || "none";
            if (tr !== "none") {
                stageEl.classList.remove("slp-tr-fade", "slp-tr-slide", "slp-tr-zoom");
                void stageEl.offsetWidth;   // restart the CSS animation
                stageEl.classList.add("slp-tr-" + tr);
            }
        }
        $ov.find(".slp-counter").text((idx + 1) + " / " + body.slides.length);
        updatePresenterView();
    }

    /* reveal the next animated object; returns false when none are left */
    function revealNext() {
        var queue = animQueue(slideAt(idx));
        if (revealed >= queue.length) return false;
        var o = queue[revealed];
        revealed++;
        var el = stageEl.querySelector('[data-id="' + o.id + '"]');
        if (el) {
            el.style.visibility = "";
            el.classList.add("slp-anim-" + (o.props.anim || "fade"));
        }
        updatePresenterView();
        return true;
    }

    function next() {
        if (revealNext()) return;
        if (idx >= slideCount() - 1) { stop(); return; }
        idx++;
        revealed = 0;
        renderCurrent(true);
    }
    function prev() {
        if (idx <= 0) return;
        idx--;
        // going back shows the previous slide fully revealed
        revealed = animQueue(slideAt(idx)).length;
        renderCurrent(false);
    }
    function goTo(i) {
        idx = Math.max(0, Math.min(i, slideCount() - 1));
        revealed = 0;
        renderCurrent(true);
    }

    /* ---------- laser pointer ---------- */
    function setLaser(on) {
        laserOn = on;
        var dot = $ov.find(".slp-laser")[0];
        dot.style.display = on ? "block" : "none";
        $ov[0].style.cursor = on ? "none" : "";
    }
    function onLaserMove(e) {
        if (!laserOn) return;
        var dot = $ov.find(".slp-laser")[0];
        dot.style.left = e.clientX + "px";
        dot.style.top = e.clientY + "px";
    }

    /* ---------- interactive links ---------- */
    // returns true when the click was consumed by a link / media control
    function handleStageClick(e) {
        // let embedded media controls work without advancing the show
        if (e.target.closest && e.target.closest("video, audio")) return true;
        // inline text links (<a href> made with the format bar)
        var a = e.target.closest ? e.target.closest("a[href]") : null;
        if (a && stageEl.contains(a)) {
            e.preventDefault();
            var href = a.getAttribute("href") || "";
            if (/^#\d+$/.test(href)) {
                goTo(parseInt(href.substring(1), 10) - 1);
            } else if (/^https?:\/\//i.test(href)) {
                window.open(href, "_blank", "noopener");
            }
            return true;
        }
        var objEl = e.target.closest ? e.target.closest("[data-id]") : null;
        if (!objEl) return false;
        var id = objEl.getAttribute("data-id");
        var slide = slideAt(idx);
        for (var i = 0; i < slide.objects.length; i++) {
            var o = slide.objects[i];
            if (o.id === id && o.props && o.props.link) {
                var link = o.props.link;
                if (/^#\d+$/.test(link)) {
                    goTo(parseInt(link.substring(1), 10) - 1);
                } else {
                    window.open(link, "_blank", "noopener");
                }
                return true;
            }
        }
        return false;
    }

    function onKey(e) {
        if (!active) return;
        switch (e.key) {
            case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Enter":
                e.preventDefault(); e.stopPropagation(); next(); break;
            case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace":
                e.preventDefault(); e.stopPropagation(); prev(); break;
            case "Home":
                e.preventDefault(); e.stopPropagation(); goTo(0); break;
            case "End":
                e.preventDefault(); e.stopPropagation(); goTo(slideCount() - 1); break;
            case "l": case "L":
                e.preventDefault(); e.stopPropagation(); setLaser(!laserOn); break;
            case "Escape":
                e.preventDefault(); e.stopPropagation(); stop(); break;
        }
    }

    function onFullscreenChange() {
        // leaving browser fullscreen ends the show - unless we exited on
        // purpose to open the presenter popup
        if (ignoreFsExit) {
            if (!document.fullscreenElement) ignoreFsExit = false;
            return;
        }
        if (active && !document.fullscreenElement) stop();
    }

    /* ---------- presenter view (popup window) ---------- */
    var ignoreFsExit = false;   // set while we exit fullscreen on purpose
    function openPresenterView() {
        if (!active) return;
        if (pw && !pw.closed) {
            try { pw.focus(); } catch (e) { }
            return;
        }
        // browsers close popups opened while their opener is fullscreen -
        // leave fullscreen first (without ending the show), then open
        if (document.fullscreenElement) {
            ignoreFsExit = true;
            var reopen = function () {
                document.removeEventListener("fullscreenchange", reopen);
                setTimeout(openPresenterView, 60);
            };
            document.addEventListener("fullscreenchange", reopen);
            try { document.exitFullscreen().catch(function () { }); } catch (e) { }
            return;
        }
        try {
            pw = window.open("", "slidesPresenter",
                "width=960,height=640,menubar=no,toolbar=no,location=no");
        } catch (e) { pw = null; }
        if (!pw) {
            OfficeApp.toast("Popup blocked - allow popups to use presenter view", "error");
            return;
        }
        var doc = pw.document;
        // base href so relative media links (media?file=...) keep working
        var cssLinks = '<base href="' + document.baseURI + '">';
        var sheets = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < sheets.length; i++) {
            cssLinks += '<link rel="stylesheet" href="' + sheets[i].href + '">';
        }
        doc.open();
        doc.write("<!DOCTYPE html><html><head><title>Presenter view</title>" + cssLinks +
            "<style>" +
            "body{background:#16181c;color:#e8eaed;font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:14px;overflow:hidden;}" +
            ".pv-row{display:flex;gap:14px;}" +
            ".pv-cur,.pv-next{position:relative;overflow:hidden;background:#000;border-radius:6px;}" +
            ".pv-cur{width:576px;height:324px;}" +
            ".pv-next{width:288px;height:162px;opacity:.85;}" +
            ".pv-cap{font-size:12px;color:#9aa0a6;margin:6px 0 4px;}" +
            ".pv-stage{width:960px;height:540px;position:absolute;left:0;top:0;transform-origin:0 0;}" +
            ".pv-cur .pv-stage{transform:scale(.6);}" +
            ".pv-next .pv-stage{transform:scale(.3);}" +
            ".pv-notes{margin-top:12px;font-size:16px;line-height:1.5;white-space:pre-wrap;" +
            "max-height:170px;overflow-y:auto;background:#22252b;border-radius:6px;padding:10px 14px;}" +
            ".pv-bar{display:flex;align-items:center;gap:12px;margin-top:12px;}" +
            ".pv-bar button{background:#2f3339;border:none;color:#e8eaed;border-radius:4px;" +
            "padding:8px 22px;font-size:15px;cursor:pointer;}" +
            ".pv-bar button:hover{background:#3d4450;}" +
            ".pv-time{font-size:20px;font-variant-numeric:tabular-nums;margin-left:auto;}" +
            "</style></head><body>" +
            '<div class="pv-row"><div><div class="pv-cap">Current slide <span class="pv-count"></span></div>' +
            '<div class="pv-cur"><div class="pv-stage sl-slidebase pv-cur-stage"></div></div></div>' +
            '<div><div class="pv-cap">Next slide</div>' +
            '<div class="pv-next"><div class="pv-stage sl-slidebase pv-next-stage"></div></div></div></div>' +
            '<div class="pv-cap" style="margin-top:12px;">Speaker notes</div><div class="pv-notes"></div>' +
            '<div class="pv-bar"><button type="button" class="pv-prev">Previous</button>' +
            '<button type="button" class="pv-nextbtn">Next</button><span class="pv-time">0:00</span></div>' +
            "</body></html>");
        doc.close();
        doc.querySelector(".pv-prev").addEventListener("click", prev);
        doc.querySelector(".pv-nextbtn").addEventListener("click", next);
        updatePresenterView();
    }
    function updatePresenterView() {
        if (!pw || pw.closed) return;
        try {
            var doc = pw.document;
            var body = SlidesApp.getBody();
            var curStage = doc.querySelector(".pv-cur-stage");
            var nextStage = doc.querySelector(".pv-next-stage");
            if (!curStage) return;
            // clone the live stage so reveal state matches the audience view
            curStage.innerHTML = stageEl.innerHTML;
            curStage.style.background = stageEl.style.background;
            curStage.style.color = stageEl.style.color;
            if (idx + 1 < body.slides.length) {
                SlidesApp.renderSlideContent(nextStage, body.slides[idx + 1]);
            } else {
                nextStage.innerHTML = "";
                nextStage.style.background = "#111";
            }
            doc.querySelector(".pv-count").textContent = "(" + (idx + 1) + " / " + body.slides.length + ")";
            doc.querySelector(".pv-notes").textContent = slideAt(idx).notes || "(no notes for this slide)";
        } catch (e) { /* popup navigated away or closed */ }
    }

    function start(fromIndex, opts) {
        if (active) return;
        if (!slideCount()) return;
        active = true;
        idx = Math.max(0, Math.min(fromIndex || 0, slideCount() - 1));
        revealed = 0;
        laserOn = false;
        ignoreFsExit = false;

        $ov = $(
            '<div class="slp-overlay">' +
            '<div class="slp-stage sl-slidebase"></div>' +
            '<div class="slp-laser"></div>' +
            '<span class="slp-hud slp-timer" title="Presenter timer">0:00</span>' +
            '<span class="slp-hud slp-counter"></span>' +
            '<span class="slp-hud slp-nav">' +
            '<button type="button" class="slp-btn slp-prev" title="Previous"><i class="chevron left icon"></i></button>' +
            '<button type="button" class="slp-btn slp-next" title="Next"><i class="chevron right icon"></i></button>' +
            '<button type="button" class="slp-btn slp-laserbtn" title="Laser pointer (L)"><i class="dot circle outline icon"></i></button>' +
            '<button type="button" class="slp-btn slp-pv" title="Presenter view"><i class="desktop icon"></i></button>' +
            '<button type="button" class="slp-btn slp-close" title="End presentation (Esc)"><i class="close icon"></i></button>' +
            "</span></div>"
        );
        $("body").append($ov);
        stageEl = $ov.find(".slp-stage")[0];

        // navigation: click advances (links and media controls consume first)
        $ov.on("click", function (e) {
            if ($(e.target).closest(".slp-hud").length) return;
            if (handleStageClick(e)) return;
            next();
        });
        $ov.on("contextmenu", function (e) { e.preventDefault(); prev(); });
        $ov.on("pointermove", onLaserMove);
        $ov.find(".slp-prev").on("click", function (e) { e.stopPropagation(); prev(); });
        $ov.find(".slp-next").on("click", function (e) { e.stopPropagation(); next(); });
        $ov.find(".slp-laserbtn").on("click", function (e) { e.stopPropagation(); setLaser(!laserOn); });
        $ov.find(".slp-pv").on("click", function (e) { e.stopPropagation(); openPresenterView(); });
        $ov.find(".slp-close").on("click", function (e) { e.stopPropagation(); stop(); });

        window.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", layout);
        document.addEventListener("fullscreenchange", onFullscreenChange);

        // presenter timer
        startTime = Date.now();
        timerInterval = setInterval(function () {
            var t = fmtTime(Date.now() - startTime);
            $ov.find(".slp-timer").text(t);
            if (pw && !pw.closed) {
                try { pw.document.querySelector(".pv-time").textContent = t; } catch (e) { }
            }
        }, 1000);

        // presenter view must open BEFORE fullscreen and within the same
        // user gesture - browsers auto-close popups opened from fullscreen
        if (opts && opts.presenter) openPresenterView();

        // try fullscreen (may be rejected outside user gesture - fine)
        try {
            if ($ov[0].requestFullscreen) $ov[0].requestFullscreen().catch(function () { });
        } catch (e) { }

        renderCurrent(true);
        layout();
    }

    function stop() {
        if (!active) return;
        active = false;
        clearInterval(timerInterval);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", layout);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        try {
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(function () { });
            }
        } catch (e) { }
        if (pw && !pw.closed) {
            try { pw.close(); } catch (e) { }
        }
        pw = null;
        if ($ov) { $ov.remove(); $ov = null; }
        stageEl = null;
    }

    return {
        start: start,
        stop: stop,
        isActive: function () { return active; },
        openPresenterView: openPresenterView
    };
})();

/* ================= export ================= */
var SlidesExport = (function () {

    /* Render one slide into an offscreen 960x540 element and rasterize it. */
    function rasterizeSlide(slide, scale) {
        return new Promise(function (resolve, reject) {
            var holder = document.createElement("div");
            holder.style.cssText = "position:fixed;left:-10000px;top:0;width:960px;height:540px;overflow:hidden;";
            var stage = document.createElement("div");
            stage.className = "sl-slidebase";
            stage.style.cssText = "width:960px;height:540px;position:relative;overflow:hidden;";
            holder.appendChild(stage);
            document.body.appendChild(holder);
            SlidesApp.renderSlideContent(stage, slide);
            // let images/fonts settle
            setTimeout(function () {
                html2canvas(stage, {
                    scale: scale || 2,
                    useCORS: true,
                    backgroundColor: null,
                    logging: false
                }).then(function (canvas) {
                    holder.remove();
                    resolve(canvas);
                }).catch(function (err) {
                    holder.remove();
                    reject(err);
                });
            }, 120);
        });
    }

    function downloadBlob(blob, name) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 800);
    }

    function docName() {
        var n = OfficeApp.getFileName() || "presentation.ppta";
        return OfficeApp.stripExt(n);
    }

    function exportPDF() {
        var body = SlidesApp.getBody();
        if (!body || !body.slides.length) return;
        if (typeof PDFLib === "undefined" || typeof html2canvas === "undefined") {
            OfficeApp.toast("Export libraries failed to load", "error");
            return;
        }
        OfficeApp.showBusy("Exporting PDF...");
        PDFLib.PDFDocument.create().then(function (pdf) {
            var chain = Promise.resolve();
            body.slides.forEach(function (slide, i) {
                chain = chain.then(function () {
                    OfficeApp.showBusy("Exporting PDF... slide " + (i + 1) + " of " + body.slides.length);
                    return rasterizeSlide(slide, 2).then(function (canvas) {
                        var dataUrl = canvas.toDataURL("image/png");
                        return pdf.embedPng(dataUrl).then(function (img) {
                            var page = pdf.addPage([960, 540]);
                            page.drawImage(img, { x: 0, y: 0, width: 960, height: 540 });
                        });
                    });
                });
            });
            return chain.then(function () { return pdf.save(); });
        }).then(function (bytes) {
            OfficeApp.hideBusy();
            downloadBlob(new Blob([bytes], { type: "application/pdf" }), docName() + ".pdf");
            OfficeApp.setStatus("Exported " + docName() + ".pdf");
        }).catch(function (err) {
            OfficeApp.hideBusy();
            OfficeApp.toast("PDF export failed: " + (err && err.message ? err.message : "unknown error"), "error");
        });
    }

    function canvasToBlob(canvas) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (b) {
                if (b) resolve(b); else reject(new Error("PNG encode failed"));
            }, "image/png");
        });
    }

    function exportPNG(allSlides) {
        var body = SlidesApp.getBody();
        if (!body || !body.slides.length) return;
        if (typeof html2canvas === "undefined") {
            OfficeApp.toast("Export libraries failed to load", "error");
            return;
        }
        var indices = allSlides
            ? body.slides.map(function (s, i) { return i; })
            : [SlidesApp.getCurrentIndex()];
        OfficeApp.showBusy("Exporting PNG...");
        var chain = Promise.resolve();
        indices.forEach(function (i, n) {
            chain = chain.then(function () {
                OfficeApp.showBusy("Exporting PNG " + (n + 1) + " of " + indices.length + "...");
                return rasterizeSlide(body.slides[i], 2).then(canvasToBlob).then(function (blob) {
                    var suffix = allSlides ? "-" + (i + 1 < 10 ? "0" : "") + (i + 1) : "";
                    downloadBlob(blob, docName() + suffix + ".png");
                });
            });
        });
        chain.then(function () {
            OfficeApp.hideBusy();
            OfficeApp.setStatus("Exported " + indices.length + " PNG file" + (indices.length > 1 ? "s" : ""));
        }).catch(function (err) {
            OfficeApp.hideBusy();
            OfficeApp.toast("PNG export failed: " + (err && err.message ? err.message : "unknown error"), "error");
        });
    }

    /* Rasterize slides for external use (kept for future features). */
    return { exportPDF: exportPDF, exportPNG: exportPNG, rasterizeSlide: rasterizeSlide };
})();
