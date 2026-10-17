/*
    viewer.image.js

    Photo viewer: zoom around the pointer (wheel, pinch, double click), pan,
    rotate, fit / actual size, a filmstrip of the other pictures in the
    folder, a slideshow, an information panel with EXIF data (read through
    backend/media.agi) and printing.

    The image is placed by its centre: offset (ox, oy) from the stage centre,
    scale and rotation, so zooming around a point stays a simple formula.
*/

(function () {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;
    var U = DriveViewer.util;

    var MIN_SCALE = 0.05, MAX_SCALE = 16;

    function thumbFor(item) {
        if (API.caps.fm) {
            return Promise.resolve(API.thumbURL(item.path) + "&t=" + (item.mtime || 0));
        }
        return API.thumbFallback(item.path).catch(function () { return ""; });
    }

    function cleanExif(v) {
        return String(v == null ? "" : v).replace(/^"+|"+$/g, "").trim();
    }

    function ratio(v) {
        var s = cleanExif(v);
        var m = /^(-?\d+)\/(\d+)$/.exec(s);
        if (m) {
            var d = parseInt(m[2], 10);
            return d ? parseInt(m[1], 10) / d : 0;
        }
        return parseFloat(s);
    }

    function mount(ctx) {
        var item = ctx.item;
        var mem = ctx.memory;
        if (mem.strip === undefined) {
            mem.strip = true;
        }
        var state = { scale: 1, ox: 0, oy: 0, rot: 0, natW: 0, natH: 0, fitted: true };
        var slideshow = null;
        var destroyed = false;

        ctx.body.innerHTML = '<div class="iv-stage" tabindex="-1"><div class="vw-state"><div class="vw-spin"></div></div></div>' +
            '<aside class="vw-panel iv-info vw-scroll' + (mem.info ? " open" : "") + '"' + (mem.info ? "" : " hidden") + '></aside>';
        var stage = ctx.body.querySelector(".iv-stage");
        var info = ctx.body.querySelector(".iv-info");

        ctx.tools.innerHTML =
            '<div class="vw-pill"><button class="vw-ic" data-t="out" title="' + esc(T("pv/zoomOut", "Zoom out")) + '">' + I("minimize") + '</button>' +
            '<button class="vw-pill-label" data-t="zoom" title="' + esc(T("vw/zoomOptions", "Zoom options")) + '">100%</button>' +
            '<button class="vw-ic" data-t="in" title="' + esc(T("pv/zoomIn", "Zoom in")) + '">' + I("plus") + '</button></div>' +
            '<button class="vw-ic vw-hide-sm" data-t="rotl" title="' + esc(T("vw/rotateLeft", "Rotate left")) + '" style="transform:scaleX(-1)">' + I("rotate") + '</button>' +
            '<button class="vw-ic" data-t="rotr" title="' + esc(T("pv/rotate", "Rotate")) + '">' + I("rotate") + '</button>' +
            '<button class="vw-ic vw-hide-sm' + (ctx.list.length > 1 ? "" : " ") + '" data-t="play" title="' + esc(T("vw/slideshow", "Slideshow")) + '"' + (ctx.list.length > 1 ? "" : " hidden") + '>' + I("play") + '</button>' +
            '<button class="vw-ic vw-hide-sm' + (mem.strip ? " on" : "") + '" data-t="strip" title="' + esc(T("vw/filmstrip", "Filmstrip")) + '"' + (ctx.list.length > 1 ? "" : " hidden") + '>' + I("grid") + '</button>' +
            '<button class="vw-ic' + (mem.info ? " on" : "") + '" data-t="info" title="' + esc(T("vw/info", "Information")) + '">' + I("info") + '</button>' +
            '<button class="vw-ic vw-hide-sm" data-t="fs" title="' + esc(T("vw/fullscreen", "Full screen")) + '">' + I("external") + '</button><span class="vw-sep vw-hide-sm"></span>';
        var zoomLabel = ctx.tools.querySelector('[data-t="zoom"]');

        var img = new Image();
        img.className = "iv-img";
        img.alt = item.name;
        img.decoding = "async";
        img.draggable = false;

        /* Geometry ------------------------------------------------------- */
        function stageSize() {
            return { w: stage.clientWidth, h: stage.clientHeight };
        }

        function rotatedSize() {
            var q = ((state.rot % 360) + 360) % 360;
            return (q == 90 || q == 270) ? { w: state.natH, h: state.natW } : { w: state.natW, h: state.natH };
        }

        function fitScale() {
            var s = stageSize(), r = rotatedSize();
            var bottom = mem.strip && ctx.list.length > 1 ? 92 : 0;
            if (!r.w || !r.h) {
                return 1;
            }
            return Math.min((s.w - 40) / r.w, (s.h - 40 - bottom) / r.h, 1);
        }

        function apply() {
            img.style.transform = "translate(" + (stage.clientWidth / 2 + state.ox - state.natW / 2) + "px," + (stage.clientHeight / 2 + state.oy - state.natH / 2) + "px) " +
                "translate(" + (state.natW / 2) + "px," + (state.natH / 2) + "px) rotate(" + state.rot + "deg) scale(" + state.scale + ") translate(" + (-state.natW / 2) + "px," + (-state.natH / 2) + "px)";
            img.classList.toggle("pixelated", state.scale > 3);
            zoomLabel.textContent = Math.round(state.scale * 100) + "%";
        }

        function fit() {
            state.scale = fitScale();
            state.ox = 0;
            var bottom = mem.strip && ctx.list.length > 1 ? 92 : 0;
            state.oy = -bottom / 2;
            state.fitted = true;
            apply();
        }

        //Zoom to a scale, keeping the stage point (px, py) still
        function zoomTo(scale, px, py, announce) {
            scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
            var s = stageSize();
            if (px === undefined) {
                px = s.w / 2;
                py = s.h / 2;
            }
            var cx = px - s.w / 2, cy = py - s.h / 2;
            var k = scale / state.scale;
            state.ox = cx - (cx - state.ox) * k;
            state.oy = cy - (cy - state.oy) * k;
            state.scale = scale;
            state.fitted = false;
            apply();
            if (announce) {
                ctx.osd(Math.round(scale * 100) + "%", "zoomIn");
            }
        }

        function rotate(delta) {
            state.rot += delta;
            img.style.transition = "transform .2s";
            fit();
            setTimeout(function () { img.style.transition = ""; }, 220);
        }

        /* Loading -------------------------------------------------------- */
        function showError() {
            stage.innerHTML = U.stateHTML(item, T("pv/cannotShow", "This image cannot be shown in the browser."),
                T("vw/formatHint", "Download it to open it with another program."),
                [{ id: "dl", icon: "download", label: T("toolbar/download", "Download"), primary: true }]);
            U.bindState(stage, { dl: function () { DriveActions.download([item]); } });
        }

        var triedThumb = false;
        img.onload = function () {
            if (destroyed) {
                return;
            }
            state.natW = img.naturalWidth || 800;
            state.natH = img.naturalHeight || 600;
            stage.innerHTML = "";
            stage.appendChild(img);
            buildNav();
            buildStrip();
            fit();
            renderInfo();
            ctx.setPrintable(true);
            if (triedThumb) {
                DriveUI.toast(T("vw/previewOnly", "Showing a reduced preview. Download the file for full quality."));
            }
        };
        img.onerror = function () {
            if (destroyed) {
                return;
            }
            if (!triedThumb) {
                triedThumb = true;
                thumbFor(item).then(function (src) {
                    if (src) {
                        img.src = src;
                    } else {
                        showError();
                    }
                });
                return;
            }
            showError();
        };
        img.src = ctx.url;

        /* Side navigation and filmstrip ------------------------------------ */
        function buildNav() {
            if (ctx.hasPrev) {
                var p = DriveUI.el('<button class="vw-side-nav prev" aria-label="' + esc(T("pv/prev", "Previous")) + '">' + I("chevronLeft") + '</button>');
                p.addEventListener("click", function (e) { e.stopPropagation(); ctx.go(-1); });
                stage.appendChild(p);
            }
            if (ctx.hasNext) {
                var n = DriveUI.el('<button class="vw-side-nav next" aria-label="' + esc(T("pv/next", "Next")) + '">' + I("chevronRight") + '</button>');
                n.addEventListener("click", function (e) { e.stopPropagation(); ctx.go(1); });
                stage.appendChild(n);
            }
        }

        function buildStrip() {
            if (ctx.list.length < 2) {
                return;
            }
            var strip = DriveUI.el('<div class="iv-strip' + (mem.strip ? "" : " hide") + '"></div>');
            ctx.list.forEach(function (it, n) {
                var b = DriveUI.el('<button class="iv-th' + (n == ctx.index ? " active" : "") + '" title="' + esc(it.name) + '">' + DriveIcons.file(it.name, false) + '</button>');
                b.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (n != ctx.index) {
                        ctx.goTo(it);
                    }
                });
                b.__item = it;
                strip.appendChild(b);
            });
            stage.appendChild(strip);
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (!en.isIntersecting) {
                        return;
                    }
                    io.unobserve(en.target);
                    var btn = en.target;
                    thumbFor(btn.__item).then(function (src) {
                        if (!src) {
                            return;
                        }
                        var t = new Image();
                        t.onload = function () {
                            btn.innerHTML = "";
                            btn.appendChild(t);
                        };
                        t.src = src;
                    });
                });
            }, { root: strip, rootMargin: "200px" });
            strip.querySelectorAll(".iv-th").forEach(function (b) { io.observe(b); });
            var active = strip.querySelector(".iv-th.active");
            if (active) {
                strip.scrollLeft = active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2;
            }
        }

        /* Information panel --------------------------------------------- */
        function renderInfo() {
            if (!mem.info) {
                return;
            }
            var rows = [
                [T("col/name", "Name"), item.name],
                [T("vw/dimensions", "Dimensions"), state.natW + " x " + state.natH + " px"],
                [T("col/size", "Size"), item.size >= 0 ? DriveUI.fmtSize(item.size) : "-"],
                [T("col/type", "Type"), DriveList.typeLabel(item)],
                [T("col/modified", "Modified"), item.mtime ? DriveUI.fmtDate(item.mtime) : "-"],
                [T("col/location", "Location"), item.trashed ? T("nav/trash", "Trash") : Drive.locationLabel(item.path)]
            ];
            info.innerHTML = '<h4>' + I("image") + esc(T("vw/info", "Information")) + '</h4><dl class="vw-kv">' + rows.map(function (r) {
                return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
            }).join("") + '</dl><div data-exif><div class="vw-spin" style="width:20px;height:20px;border-width:2px"></div></div>';
            API.agi("media.agi", { opr: "exif", path: item.path }).then(function (r) {
                if (destroyed || !mem.info) {
                    return;
                }
                var box = info.querySelector("[data-exif]");
                var x = (r && r.exif) || {};
                var camera = [cleanExif(x.Make), cleanExif(x.Model)].filter(Boolean).join(" ");
                var exposure = [];
                if (x.ExposureTime) {
                    exposure.push(cleanExif(x.ExposureTime) + " s");
                }
                if (x.FNumber) {
                    exposure.push("f/" + (Math.round(ratio(x.FNumber) * 10) / 10));
                }
                if (x.ISOSpeedRatings) {
                    exposure.push("ISO " + cleanExif(x.ISOSpeedRatings));
                }
                var rows2 = [];
                if (camera) {
                    rows2.push([T("vw/camera", "Camera"), camera]);
                }
                if (x.LensModel) {
                    rows2.push([T("vw/lens", "Lens"), cleanExif(x.LensModel)]);
                }
                if (exposure.length) {
                    rows2.push([T("vw/exposure", "Exposure"), exposure.join("  ·  ")]);
                }
                if (x.FocalLength) {
                    rows2.push([T("vw/focal", "Focal length"), Math.round(ratio(x.FocalLength)) + " mm"]);
                }
                if (x.DateTimeOriginal) {
                    rows2.push([T("vw/taken", "Taken"), cleanExif(x.DateTimeOriginal).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1/$2/$3")]);
                }
                if (x.Flash) {
                    rows2.push([T("vw/flash", "Flash"), cleanExif(x.Flash)]);
                }
                if (x.Software) {
                    rows2.push([T("vw/software", "Software"), cleanExif(x.Software)]);
                }
                box.innerHTML = rows2.length ? '<h4>' + I("sliders") + esc(T("vw/cameraInfo", "Camera details")) + '</h4><dl class="vw-kv">' + rows2.map(function (r2) {
                    return '<dt>' + esc(r2[0]) + '</dt><dd>' + esc(r2[1]) + '</dd>';
                }).join("") + '</dl>' : '<p style="color:var(--vw-text-3);font-size:12.5px;margin:0">' + esc(T("vw/noExif", "No camera details in this file.")) + '</p>';
            }).catch(function () {
                var box = info.querySelector("[data-exif]");
                if (box) {
                    box.innerHTML = "";
                }
            });
        }

        function toggleInfo() {
            mem.info = !mem.info;
            info.hidden = !mem.info;
            info.classList.toggle("open", mem.info);
            ctx.tools.querySelector('[data-t="info"]').classList.toggle("on", mem.info);
            renderInfo();
            setTimeout(function () {
                if (state.fitted) {
                    fit();
                } else {
                    apply();
                }
            }, 0);
        }

        function toggleStrip() {
            mem.strip = !mem.strip;
            var s = stage.querySelector(".iv-strip");
            if (s) {
                s.classList.toggle("hide", !mem.strip);
            }
            ctx.tools.querySelector('[data-t="strip"]').classList.toggle("on", mem.strip);
            if (state.fitted) {
                fit();
            }
        }

        function toggleSlideshow() {
            var btn = ctx.tools.querySelector('[data-t="play"]');
            if (slideshow) {
                clearInterval(slideshow);
                slideshow = null;
                mem.slideshow = false;
                btn.innerHTML = I("play");
                ctx.osd(T("vw/slideshowOff", "Slideshow stopped"), "pause");
                return;
            }
            mem.slideshow = true;
            btn.innerHTML = I("pause");
            ctx.osd(T("vw/slideshowOn", "Slideshow"), "play");
            slideshow = setInterval(function () {
                if (ctx.hasNext) {
                    ctx.go(1);
                } else if (ctx.list.length > 1) {
                    ctx.goTo(ctx.list[0]);
                }
            }, 4000);
        }

        /* Pointer interaction --------------------------------------------- */
        var pointers = {};
        var pan = null;
        var pinch = null;

        function stagePoint(e) {
            var r = stage.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }

        stage.addEventListener("wheel", function (e) {
            if (!state.natW) {
                return;
            }
            e.preventDefault();
            var p = stagePoint(e);
            var factor = Math.pow(1.0018, -e.deltaY * (e.deltaMode == 1 ? 30 : 1));
            zoomTo(state.scale * factor, p.x, p.y);
        }, { passive: false });

        stage.addEventListener("pointerdown", function (e) {
            if (!state.natW || e.target.closest("button")) {
                return;
            }
            stage.setPointerCapture(e.pointerId);
            pointers[e.pointerId] = stagePoint(e);
            var ids = Object.keys(pointers);
            if (ids.length == 1) {
                pan = { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy, moved: false };
                stage.classList.add("panning");
            } else if (ids.length == 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: state.scale };
                pan = null;
            }
        });
        stage.addEventListener("pointermove", function (e) {
            if (!(e.pointerId in pointers)) {
                return;
            }
            pointers[e.pointerId] = stagePoint(e);
            var ids = Object.keys(pointers);
            if (pinch && ids.length >= 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                var d = Math.hypot(a.x - b.x, a.y - b.y);
                zoomTo(pinch.scale * d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
            } else if (pan) {
                var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) {
                    pan.moved = true;
                }
                state.ox = pan.ox + dx;
                state.oy = pan.oy + dy;
                state.fitted = false;
                apply();
            }
        });
        var release = function (e) {
            if (!(e.pointerId in pointers)) {
                return;
            }
            delete pointers[e.pointerId];
            stage.classList.remove("panning");
            if (Object.keys(pointers).length < 2) {
                pinch = null;
            }
            //A horizontal swipe at the fitted size moves to the next picture
            if (pan && e.pointerType == "touch" && state.fitted) {
                var dx = e.clientX - pan.x;
                if (Math.abs(dx) > 70) {
                    ctx.go(dx < 0 ? 1 : -1);
                    return;
                }
                fit();
            }
            pan = null;
        };
        stage.addEventListener("pointerup", release);
        stage.addEventListener("pointercancel", release);
        stage.addEventListener("dblclick", function (e) {
            if (!state.natW || e.target.closest("button")) {
                return;
            }
            var p = stagePoint(e);
            if (state.fitted || state.scale < 1) {
                zoomTo(Math.max(1, fitScale() * 2.5), p.x, p.y, true);
            } else {
                fit();
            }
        });

        /* Tools ------------------------------------------------------------ */
        ctx.tools.querySelectorAll("[data-t]").forEach(function (b) {
            b.addEventListener("click", function () {
                var t = b.getAttribute("data-t");
                if (t == "in") {
                    zoomTo(state.scale * 1.25, undefined, undefined, true);
                } else if (t == "out") {
                    zoomTo(state.scale / 1.25, undefined, undefined, true);
                } else if (t == "zoom") {
                    DriveUI.menu({ anchor: b }, [
                        { checkable: true, checked: state.fitted, label: T("vw/fit", "Fit to screen"), hint: "0", action: fit },
                        { checkable: true, checked: !state.fitted && Math.abs(state.scale - 1) < 0.001, label: T("vw/actual", "Actual size"), hint: "1", action: function () { zoomTo(1); } },
                        "-",
                        { label: "50%", action: function () { zoomTo(0.5); } },
                        { label: "200%", action: function () { zoomTo(2); } },
                        { label: "400%", action: function () { zoomTo(4); } }
                    ]);
                } else if (t == "rotr") {
                    rotate(90);
                } else if (t == "rotl") {
                    rotate(-90);
                } else if (t == "info") {
                    toggleInfo();
                } else if (t == "strip") {
                    toggleStrip();
                } else if (t == "play") {
                    toggleSlideshow();
                } else if (t == "fs") {
                    ctx.fullscreen(ctx.body);
                }
            });
        });

        if (mem.slideshow && ctx.list.length > 1) {
            mem.slideshow = false;
            toggleSlideshow();
        }

        return {
            shortcuts: [
                [T("vw/keyPrevNext", "Previous / next"), "Left / Right"],
                [T("pv/zoomIn", "Zoom in"), "+"], [T("pv/zoomOut", "Zoom out"), "-"],
                [T("vw/fit", "Fit to screen"), "0"], [T("vw/actual", "Actual size"), "1"],
                [T("pv/rotate", "Rotate"), "R"], [T("vw/slideshow", "Slideshow"), "Space"],
                [T("vw/info", "Information"), "I"], [T("vw/filmstrip", "Filmstrip"), "T"], [T("vw/fullscreen", "Full screen"), "F"]
            ],
            key: function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey) {
                    return false;
                }
                var k = e.key;
                if (k == "ArrowRight" || k == "PageDown") {
                    ctx.go(1);
                } else if (k == "ArrowLeft" || k == "PageUp") {
                    ctx.go(-1);
                } else if (k == "+" || k == "=") {
                    zoomTo(state.scale * 1.25, undefined, undefined, true);
                } else if (k == "-" || k == "_") {
                    zoomTo(state.scale / 1.25, undefined, undefined, true);
                } else if (k == "0") {
                    fit();
                } else if (k == "1") {
                    zoomTo(1, undefined, undefined, true);
                } else if (k == "r") {
                    rotate(90);
                } else if (k == "R") {
                    rotate(-90);
                } else if (k == "i" || k == "I") {
                    toggleInfo();
                } else if (k == "t" || k == "T") {
                    toggleStrip();
                } else if (k == "f" || k == "F") {
                    ctx.fullscreen(ctx.body);
                } else if (k == " ") {
                    e.preventDefault();
                    toggleSlideshow();
                } else if (k == "Home" && ctx.list.length) {
                    ctx.goTo(ctx.list[0]);
                } else if (k == "End" && ctx.list.length) {
                    ctx.goTo(ctx.list[ctx.list.length - 1]);
                } else {
                    return false;
                }
                return true;
            },
            print: function () {
                U.printContent('<div class="page"><img src="' + esc(img.src) + '" alt=""></div>');
            },
            onResize: function () {
                if (state.fitted) {
                    fit();
                } else {
                    apply();
                }
            },
            destroy: function () {
                destroyed = true;
                if (slideshow) {
                    clearInterval(slideshow);
                    mem.slideshow = true;
                }
                img.onload = img.onerror = null;
            }
        };
    }

    DriveViewer.register(["image"], { mount: mount });
})();
