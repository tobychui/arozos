/*
    ArozOS Office - Slides: present mode + export helpers
    Requires slides.js (SlidesApp), html2canvas, pdf-lib (PDFLib).

    SlidesPresent - fullscreen presentation with keyboard/click navigation,
                    slide counter and a presenter timer.
    SlidesExport  - PDF (html2canvas -> pdf-lib) and PNG export.
*/

var SlidesPresent = (function () {
    var active = false;
    var idx = 0;
    var $ov = null;
    var stageEl = null;
    var startTime = 0;
    var timerInterval = null;

    function slideCount() { return SlidesApp.slideCount(); }

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
    }

    function renderCurrent() {
        if (!active) return;
        var body = SlidesApp.getBody();
        if (!body || !body.slides.length) { stop(); return; }
        idx = Math.max(0, Math.min(idx, body.slides.length - 1));
        SlidesApp.renderSlideContent(stageEl, body.slides[idx]);
        $ov.find(".slp-counter").text((idx + 1) + " / " + body.slides.length);
    }

    function next() {
        if (idx >= slideCount() - 1) { stop(); return; }
        idx++;
        renderCurrent();
    }
    function prev() {
        if (idx <= 0) return;
        idx--;
        renderCurrent();
    }

    function onKey(e) {
        if (!active) return;
        switch (e.key) {
            case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Enter":
                e.preventDefault(); e.stopPropagation(); next(); break;
            case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace":
                e.preventDefault(); e.stopPropagation(); prev(); break;
            case "Home":
                e.preventDefault(); e.stopPropagation(); idx = 0; renderCurrent(); break;
            case "End":
                e.preventDefault(); e.stopPropagation(); idx = slideCount() - 1; renderCurrent(); break;
            case "Escape":
                e.preventDefault(); e.stopPropagation(); stop(); break;
        }
    }

    function onFullscreenChange() {
        // leaving browser fullscreen ends the show
        if (active && !document.fullscreenElement) stop();
    }

    function start(fromIndex) {
        if (active) return;
        if (!slideCount()) return;
        active = true;
        idx = Math.max(0, Math.min(fromIndex || 0, slideCount() - 1));

        $ov = $(
            '<div class="slp-overlay">' +
            '<div class="slp-stage sl-slidebase"></div>' +
            '<span class="slp-hud slp-timer" title="Presenter timer">0:00</span>' +
            '<span class="slp-hud slp-counter"></span>' +
            '<span class="slp-hud slp-nav">' +
            '<button type="button" class="slp-btn slp-prev" title="Previous"><i class="chevron left icon"></i></button>' +
            '<button type="button" class="slp-btn slp-next" title="Next"><i class="chevron right icon"></i></button>' +
            '<button type="button" class="slp-btn slp-close" title="End presentation (Esc)"><i class="close icon"></i></button>' +
            "</span></div>"
        );
        $("body").append($ov);
        stageEl = $ov.find(".slp-stage")[0];

        // navigation: click advances, right side buttons
        $ov.on("click", function (e) {
            if ($(e.target).closest(".slp-hud").length) return;
            next();
        });
        $ov.on("contextmenu", function (e) { e.preventDefault(); prev(); });
        $ov.find(".slp-prev").on("click", function (e) { e.stopPropagation(); prev(); });
        $ov.find(".slp-next").on("click", function (e) { e.stopPropagation(); next(); });
        $ov.find(".slp-close").on("click", function (e) { e.stopPropagation(); stop(); });

        window.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", layout);
        document.addEventListener("fullscreenchange", onFullscreenChange);

        // presenter timer
        startTime = Date.now();
        timerInterval = setInterval(function () {
            $ov.find(".slp-timer").text(fmtTime(Date.now() - startTime));
        }, 1000);

        // try fullscreen (may be rejected outside user gesture - fine)
        try {
            if ($ov[0].requestFullscreen) $ov[0].requestFullscreen().catch(function () { });
        } catch (e) { }

        renderCurrent();
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
        if ($ov) { $ov.remove(); $ov = null; }
        stageEl = null;
    }

    return { start: start, stop: stop, isActive: function () { return active; } };
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
