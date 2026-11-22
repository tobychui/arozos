/*
    Photo viewer (embedded.html)

    Shows the opened photo and the other photos of its folder: swipe, the
    arrow keys, the side arrows or the thumbnail strip move between them;
    pinch, the wheel or a double tap zoom; a tap hides the bars. Edit opens
    PhotoEditor; its result is saved as a copy, over the original (same
    format only) or downloaded, at the full size or smaller.
*/
(function () {
    "use strict";

    var I = window.PhotoIcons;
    var app = document.getElementById("app");
    var stage = document.getElementById("stage");
    var img = document.getElementById("viewImg");
    var spinner = document.getElementById("spinner");

    var V = {
        list: [],          //[{filepath, filename, size, modtime}]
        index: 0,
        version: {},       //filepath -> cache buster after a save
        loaded: false,
        x: 0, y: 0, s: 1,  //image placement in CSS pixels
        fit: 1,
        exifCache: {}
    };

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function extOf(name) {
        var i = name.lastIndexOf(".");
        return i < 0 ? "" : name.substring(i + 1).toLowerCase();
    }
    function dirOf(path) {
        path = path.split("\\").join("/");
        return path.substring(0, path.lastIndexOf("/") + 1);
    }
    function baseName(path) {
        path = path.split("\\").join("/");
        return path.substring(path.lastIndexOf("/") + 1);
    }
    function mediaURL(path) {
        var v = V.version[path];
        return "../media?file=" + encodeURIComponent(path) + (v ? "&v=" + v : "");
    }
    function humanSize(b) {
        if (!(b >= 0)) {
            return "";
        }
        var u = ["B", "KB", "MB", "GB"];
        var i = 0;
        while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
        return (i === 0 ? b : b.toFixed(1)) + " " + u[i];
    }

    /* ---------- spinner, toast, sheets ---------- */

    document.querySelectorAll(".spinner").forEach(function (sp) {
        var html = "";
        for (var i = 0; i < 12; i++) {
            html += '<i style="transform:rotate(' + (i * 30) + 'deg);animation-delay:' + (-(12 - i) / 12).toFixed(3) + 's"></i>';
        }
        sp.innerHTML = html;
    });

    var toastTimer = null;
    function toast(msg) {
        var t = $("toast");
        t.textContent = msg;
        t.classList.add("on");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
    }

    /*
        Sheets (phone) and dialogs (desktop). The info panel is a sheet on a
        phone and a docked side panel on the desktop, where it stays open
        while moving between photos.
    */
    function showSheet(id) {
        hideSheets();
        $("sheetBackdrop").classList.add("on");
        $(id).classList.add("on");
    }
    function showDialog(html) {
        hideSheets();
        var d = $("dialog");
        d.innerHTML = html;
        $("sheetBackdrop").classList.add("on");
        d.classList.add("on");
        var first = d.querySelector("[autofocus]") || d.querySelector(".dbtn.primary") || d.querySelector("button");
        if (first) {
            setTimeout(function () { first.focus(); }, 30);
        }
    }
    function hideSheets() {
        $("sheetBackdrop").classList.remove("on");
        document.querySelectorAll(".sheet, .dlg").forEach(function (s) { s.classList.remove("on"); });
        if (app.classList.contains("infoOpen")) {
            app.classList.remove("infoOpen");
            $("btnInfo").classList.remove("on");
        }
    }
    //A modal sheet or dialog (not the docked info panel)
    function sheetOpen() {
        return !!document.querySelector(".dlg.on, .sheet.on:not(.side)");
    }
    function isDesktop() {
        return app.classList.contains("desktop");
    }
    $("sheetBackdrop").addEventListener("click", hideSheets);

    function progress(on, text) {
        $("progress").classList.toggle("on", on);
        if (text) {
            $("progressText").textContent = text;
        }
    }

    /* ---------- layout ---------- */

    /*
        desktop    a mouse and a window at least 560 px wide: controls in the
                   corners, tools under the picture, side info panel, dialogs
        landscape  a wide touch screen: the phone's landscape editor
        portrait   everything else
    */
    var finePointer = window.matchMedia ? window.matchMedia("(pointer: fine)") : null;
    function updateLayout() {
        var w = window.innerWidth, h = window.innerHeight;
        var desk = !!(finePointer && finePointer.matches) && w >= 560;
        var land = !desk && w >= 600 && w > h * 1.1;
        var wasDesk = app.classList.contains("desktop");
        app.classList.toggle("desktop", desk);
        app.classList.toggle("landscape", land);
        app.classList.toggle("portrait", !land && !desk);
        if (desk !== wasDesk || !V.placed) {
            V.placed = true;
            placeControls(desk);
        }
    }

    //Move the shared buttons between the phone bars and the desktop corners
    function placeControls(desk) {
        var tabs = document.querySelector(".eTabs");
        if (desk) {
            $("slotCancel").appendChild($("btnCancel"));
            $("slotTabs").appendChild(tabs);
            $("slotPill").appendChild($("ePill"));
            $("slotDone").appendChild($("btnDone"));
            $("slotActions").appendChild($("vBar"));
        } else {
            var bar = $("eBar");
            bar.appendChild($("btnCancel"));
            bar.appendChild(tabs);
            bar.appendChild($("btnDone"));
            $("eTop").insertBefore($("ePill"), $("eTop").querySelector(".eCorner.right"));
            $("vBottom").appendChild($("vBar"));
        }
        //the info panel docks on the desktop and slides up on a phone
        var info = $("infoSheet");
        var wasOpen = info.classList.contains("on");
        info.classList.toggle("side", desk);
        if (wasOpen) {
            hideSheets();
        }
    }

    var resizeObs = new ResizeObserver(function () {
        if (PhotoEditor.isOpen) {
            PhotoEditor.refitView(false);
        } else {
            fitImage(false);
        }
    });
    resizeObs.observe(stage);
    function relayout() {
        var was = app.className;
        updateLayout();
        if (PhotoEditor.isOpen && was !== app.className) {
            PhotoEditor.layoutChanged();
        }
    }
    window.addEventListener("resize", relayout);
    if (finePointer && finePointer.addEventListener) {
        finePointer.addEventListener("change", relayout);
    }

    /* ---------- icons ---------- */

    $("btnShare").querySelector(".ic").innerHTML = I.download;
    $("btnInfo").querySelector(".ic").innerHTML = I.info;
    $("btnEdit").querySelector(".ic").innerHTML = I.edit;
    $("navPrev").innerHTML = I.chevronLeft;
    $("navNext").innerHTML = I.chevronRight;
    updateLayout();

    /* ---------- loading photos ---------- */

    function current() {
        return V.list[V.index];
    }

    //The list is reloaded with new objects, so compare paths
    function isCurrent(f) {
        var c = current();
        return !!c && c.filepath === f.filepath;
    }

    function show(index, direction) {
        if (index < 0 || index >= V.list.length) {
            return;
        }
        V.index = index;
        var f = current();
        V.loaded = false;
        ao_module_setWindowTitle("Photo - " + f.filename);
        updateBars();
        openInfo(true);
        markStrip(true);

        spinner.classList.add("on");
        img.style.opacity = "0";
        var url = mediaURL(f.filepath);
        var loader = new Image();
        loader.onload = function () {
            if (!isCurrent(f)) {
                return;
            }
            //the <img> decodes on its own schedule, so its naturalWidth may
            //still be 0 here: size everything from the loader instead
            V.nat = { w: loader.naturalWidth || 1, h: loader.naturalHeight || 1 };
            img.src = url;
            img.style.width = loader.naturalWidth + "px";
            img.style.height = loader.naturalHeight + "px";
            V.loaded = true;
            spinner.classList.remove("on");
            img.classList.remove("animate");
            fitImage(false);
            if (direction) {
                //slide in from the side we are moving towards
                V.x += direction * 60;
                place();
                requestAnimationFrame(function () {
                    img.classList.add("animate");
                    img.style.opacity = "1";
                    fitImage(true);
                });
            } else {
                img.style.opacity = "1";
            }
            preload(index + 1);
            preload(index - 1);
        };
        loader.onerror = function () {
            if (!isCurrent(f)) {
                return;
            }
            spinner.classList.remove("on");
            toast("This photo could not be opened");
        };
        loader.src = url;
    }

    var preloaded = {};
    function preload(i) {
        if (i < 0 || i >= V.list.length) {
            return;
        }
        var url = mediaURL(V.list[i].filepath);
        if (!preloaded[url]) {
            preloaded[url] = new Image();
            preloaded[url].src = url;
        }
    }

    //Title, date, counter and arrows of the current photo
    function updateBars() {
        var f = current();
        if (!f) {
            return;
        }
        $("vName").textContent = f.filename;
        $("vDate").textContent = f.modtime ? formatDate(new Date(f.modtime * 1000), true) : "";
        $("vCount").textContent = V.list.length > 1 ? (V.index + 1) + " of " + V.list.length : "";
        $("navPrev").classList.toggle("can", V.index > 0);
        $("navNext").classList.toggle("can", V.index < V.list.length - 1);
    }

    function go(delta) {
        var n = V.index + delta;
        if (n < 0 || n >= V.list.length || PhotoEditor.isOpen) {
            fitImage(true);
            return;
        }
        show(n, delta);
    }

    function loadList(first) {
        ao_module_agirun("Photo/embedded/listNearbyImage.js", { path: first.filepath, detail: true }, function (data) {
            if (!Array.isArray(data) || data.length === 0) {
                return;
            }
            var want = first.filepath.split("\\").join("/");
            var idx = -1;
            for (var i = 0; i < data.length; i++) {
                if (data[i].filepath === want) {
                    idx = i;
                }
            }
            if (idx < 0) {
                //a JPEG hidden behind its RAW twin: keep it in the list
                data.push({ filepath: want, filename: first.filename });
                idx = data.length - 1;
            }
            V.list = data;
            V.index = idx;
            updateBars();
            buildStrip();
            preload(idx + 1);
            preload(idx - 1);
        });
    }

    function formatDate(d, withTime) {
        var day = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        if (!withTime) {
            return day;
        }
        return day + " \u00b7 " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }

    /* ---------- thumbnail strip ---------- */

    var stripObserver = null;
    var stripUserScroll = false;

    function buildStrip() {
        var strip = $("vStrip");
        strip.innerHTML = "";
        strip.classList.toggle("hidden", V.list.length < 2);
        //on the desktop the buttons live at the top, so a single photo
        //leaves the bottom bar empty
        $("vBottom").classList.toggle("noStrip", V.list.length < 2);
        if (V.list.length < 2) {
            return;
        }
        if (stripObserver) {
            stripObserver.disconnect();
        }
        stripObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) {
                    loadThumb(en.target);
                    stripObserver.unobserve(en.target);
                }
            });
        }, { root: strip, rootMargin: "0px 200px" });
        V.list.forEach(function (f, i) {
            var d = document.createElement("div");
            d.className = "vThumb";
            d.dataset.index = i;
            d.title = f.filename;
            d.addEventListener("click", function () {
                if (i !== V.index) {
                    show(i, i > V.index ? 1 : -1);
                }
            });
            strip.appendChild(d);
            stripObserver.observe(d);
        });
        markStrip(false);
    }

    function loadThumb(el) {
        var f = V.list[parseInt(el.dataset.index, 10)];
        if (!f) {
            return;
        }
        fetch("../system/file_system/loadThumbnail?vpath=" + encodeURIComponent(f.filepath))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof data === "string" && data.trim() !== "") {
                    el.style.backgroundImage = "url(data:image/jpg;base64," + data + ")";
                }
            })
            .catch(function () {});
    }

    function markStrip(smooth) {
        var strip = $("vStrip");
        var cur = null;
        Array.prototype.forEach.call(strip.children, function (el) {
            var on = parseInt(el.dataset.index, 10) === V.index;
            el.classList.toggle("current", on);
            if (on) { cur = el; }
        });
        if (cur) {
            stripUserScroll = false;
            clearTimeout(V.stripFlag);
            //the thumbs change width over 0.2 s: centre once they are done
            V.stripFlag = setTimeout(function () {
                var er = cur.getBoundingClientRect(), sr = strip.getBoundingClientRect();
                strip.scrollBy({ left: (er.left + er.width / 2) - (sr.left + sr.width / 2), behavior: smooth ? "smooth" : "auto" });
                V.stripFlag = setTimeout(function () { stripUserScroll = true; }, smooth ? 450 : 50);
            }, 220);
        }
    }

    (function () {
        var strip = $("vStrip");
        var t = null;
        strip.addEventListener("scroll", function () {
            if (!stripUserScroll) {
                return;
            }
            clearTimeout(t);
            t = setTimeout(function () {
                //scrubbing the strip shows the photo under its middle
                var sr = strip.getBoundingClientRect();
                var mid = sr.left + sr.width / 2;
                var best = -1, bestD = Infinity;
                Array.prototype.forEach.call(strip.children, function (el) {
                    var er = el.getBoundingClientRect();
                    var d = Math.abs(er.left + er.width / 2 - mid);
                    if (d < bestD) { bestD = d; best = parseInt(el.dataset.index, 10); }
                });
                if (best >= 0 && best !== V.index) {
                    show(best, 0);
                }
            }, 160);
        }, { passive: true });
    })();

    /* ---------- zoom and pan ---------- */

    function natural() {
        return V.nat || { w: 1, h: 1 };
    }

    function place() {
        img.style.transform = "translate(" + V.x + "px," + V.y + "px) scale(" + V.s + ")";
    }

    function clampPan() {
        var n = natural();
        var sw = stage.clientWidth, sh = stage.clientHeight;
        var w = n.w * V.s, h = n.h * V.s;
        V.x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, V.x));
        V.y = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, V.y));
    }

    function fitImage(animate) {
        if (!V.loaded) {
            return;
        }
        var n = natural();
        var sw = stage.clientWidth, sh = stage.clientHeight;
        V.fit = Math.min(sw / n.w, sh / n.h, 1);
        V.s = V.fit;
        clampPan();
        img.classList.toggle("animate", !!animate);
        place();
    }

    function zoomAt(ns, px, py, animate) {
        var max = Math.max(V.fit * 6, 2);
        ns = Math.max(V.fit, Math.min(max, ns));
        V.x = px - (px - V.x) * (ns / V.s);
        V.y = py - (py - V.y) * (ns / V.s);
        V.s = ns;
        clampPan();
        img.classList.toggle("animate", !!animate);
        place();
    }

    function zoomed() {
        return V.s > V.fit * 1.01;
    }

    var pointers = {};
    var gesture = null;
    var lastTap = { t: 0, x: 0, y: 0 };
    var tapTimer = null;

    function stagePoint(e) {
        var r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    stage.addEventListener("pointerdown", function (e) {
        if (PhotoEditor.isOpen || !V.loaded || e.target.closest("button")) {
            return;
        }
        stage.setPointerCapture(e.pointerId);
        var p = stagePoint(e);
        pointers[e.pointerId] = p;
        var ids = Object.keys(pointers);
        img.classList.remove("animate");
        if (ids.length === 2) {
            var a = pointers[ids[0]], b = pointers[ids[1]];
            gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, moved: true };
        } else if (ids.length === 1) {
            gesture = { kind: zoomed() ? "pan" : "swipe", sx: p.x, sy: p.y, x: V.x, y: V.y, t: performance.now(), moved: false };
        }
    });

    stage.addEventListener("pointermove", function (e) {
        if (!gesture || !pointers[e.pointerId]) {
            return;
        }
        var p = stagePoint(e);
        pointers[e.pointerId] = p;
        if (gesture.kind === "pinch") {
            var ids = Object.keys(pointers);
            if (ids.length < 2) {
                return;
            }
            var a = pointers[ids[0]], b = pointers[ids[1]];
            var d = Math.hypot(a.x - b.x, a.y - b.y);
            var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            zoomAt(gesture.s * d / gesture.dist, mid.x, mid.y, false);
            return;
        }
        var dx = p.x - gesture.sx, dy = p.y - gesture.sy;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            gesture.moved = true;
        }
        if (gesture.kind === "pan") {
            V.x = gesture.x + dx;
            V.y = gesture.y + dy;
            clampPan();
            place();
        } else if (gesture.moved) {
            //swipe: the photo follows the finger, stiffly past the ends
            var edge = (dx > 0 && V.index === 0) || (dx < 0 && V.index === V.list.length - 1);
            V.x = gesture.x + (edge ? dx * 0.3 : dx);
            place();
        }
    });

    function pointerEnd(e) {
        if (!pointers[e.pointerId]) {
            return;
        }
        var p = stagePoint(e);
        delete pointers[e.pointerId];
        if (!gesture) {
            return;
        }
        if (gesture.kind === "pinch") {
            if (Object.keys(pointers).length === 0) {
                gesture = null;
            } else {
                //one finger left: continue as a pan
                var rest = pointers[Object.keys(pointers)[0]];
                gesture = { kind: "pan", sx: rest.x, sy: rest.y, x: V.x, y: V.y, t: performance.now(), moved: true };
            }
            if (!zoomed()) {
                fitImage(true);
            }
            return;
        }
        var g = gesture;
        gesture = null;
        var dt = performance.now() - g.t;
        if (!g.moved) {
            if (e.type === "pointerup" && dt < 350) {
                onTap(p);
            }
            return;
        }
        if (g.kind === "swipe") {
            var dx = p.x - g.sx;
            var v = dx / Math.max(dt, 1);
            if (dx < -70 || v < -0.5) {
                go(1);
            } else if (dx > 70 || v > 0.5) {
                go(-1);
            } else {
                fitImage(true);
            }
        }
    }
    stage.addEventListener("pointerup", pointerEnd);
    stage.addEventListener("pointercancel", pointerEnd);

    function onTap(p) {
        var now = performance.now();
        if (now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
            clearTimeout(tapTimer);
            lastTap.t = 0;
            if (zoomed()) {
                fitImage(true);
            } else {
                zoomAt(Math.max(V.fit * 2.5, Math.min(1, V.fit * 6)), p.x, p.y, true);
            }
            return;
        }
        lastTap = { t: now, x: p.x, y: p.y };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(function () {
            app.classList.toggle("immersive");
        }, 280);
    }

    stage.addEventListener("wheel", function (e) {
        if (PhotoEditor.isOpen || !V.loaded) {
            return;
        }
        e.preventDefault();
        var p = stagePoint(e);
        var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomAt(V.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y, false);
    }, { passive: false });

    $("navPrev").addEventListener("click", function () { go(-1); });
    $("navNext").addEventListener("click", function () { go(1); });

    /* ---------- info ---------- */

    function exifValue(raw) {
        if (raw === undefined || raw === null) {
            return "";
        }
        var s = String(raw).trim().replace(/^\[|\]$/g, "").replace(/^"|"$/g, "").trim();
        return s.split(",")[0].replace(/^"|"$/g, "");
    }
    function exifNumber(raw) {
        var s = exifValue(raw);
        if (s.indexOf("/") > 0) {
            var p = s.split("/");
            var d = parseFloat(p[1]);
            return d ? parseFloat(p[0]) / d : NaN;
        }
        return parseFloat(s);
    }
    function exifShutter(raw) {
        var t = exifNumber(raw);
        if (!(t > 0)) {
            return "";
        }
        if (t >= 1) {
            return (Math.round(t * 10) / 10) + " s";
        }
        return "1/" + Math.round(1 / t) + " s";
    }

    //refresh: only redraw a panel that is already open (after moving to
    //another photo)
    function openInfo(refresh) {
        var f = current();
        if (!f) {
            return;
        }
        var docked = app.classList.contains("infoOpen");
        if (refresh && !docked) {
            return;
        }
        if (!refresh && docked) {
            hideSheets();
            return;
        }
        renderInfo(f, V.exifCache[f.filepath]);
        if (isDesktop()) {
            $("infoSheet").classList.add("on");
            app.classList.add("infoOpen");
            $("btnInfo").classList.add("on");
        } else {
            showSheet("infoSheet");
        }
        if (V.exifCache[f.filepath] === undefined) {
            ao_module_agirun("Photo/backend/getExif.js", { filepath: f.filepath }, function (data) {
                V.exifCache[f.filepath] = (data && typeof data === "object" && !data.error) ? data : {};
                if (isCurrent(f)) {
                    renderInfo(f, V.exifCache[f.filepath]);
                }
            }, function () {
                V.exifCache[f.filepath] = {};
            });
        }
    }

    function renderInfo(f, exif) {
        exif = exif || {};
        var taken = null;
        var dto = exifValue(exif.DateTimeOriginal || exif.DateTime);
        var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(dto);
        if (m) {
            taken = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        } else if (f.modtime) {
            taken = new Date(f.modtime * 1000);
        }
        var make = exifValue(exif.Make), model = exifValue(exif.Model);
        var camera = model ? (model.indexOf(make) === 0 || !make ? model : make + " " + model) : "";
        var lens = exifValue(exif.LensModel);
        var iso = exifValue(exif.ISOSpeedRatings);
        var focal = exifNumber(exif.FocalLengthIn35mmFilm) || exifNumber(exif.FocalLength);
        var ev = exifNumber(exif.ExposureBiasValue);
        var fnum = exifNumber(exif.FNumber);
        var shutter = exifShutter(exif.ExposureTime);
        var w = V.nat ? V.nat.w : 0, h = V.nat ? V.nat.h : 0;
        var mp = w && h ? (Math.round(w * h / 1e5) / 10) + " MP" : "";
        var ext = extOf(f.filename).toUpperCase();
        if (ext === "JPG") { ext = "JPEG"; }
        if (ext === "HEIC" || ext === "HEIF") { ext = "HEIF"; }

        var cells = [
            iso ? "ISO " + esc(iso) : "",
            focal ? Math.round(focal) + " mm" : "",
            isNaN(ev) ? "" : (Math.round(ev * 10) / 10) + " ev",
            fnum ? "\u0192" + (Math.round(fnum * 100) / 100) : "",
            esc(shutter)
        ];
        var hasExif = cells.some(function (c) { return c !== ""; });

        var html = '<div class="sgroup">' +
            '<button type="button" class="iClose" title="Close">' + I.close + '</button>' +
            '<div class="iHead"><div class="date">' + (taken ? esc(formatDate(taken, false)) : "&nbsp;") + '</div>' +
            '<div class="file">' + esc(f.filename) + (taken ? " \u00b7 " + esc(taken.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })) : "") + '</div></div>' +
            '<div class="iCard">' +
            '<div class="iRow"><span class="camera">' + esc(camera || "No camera information") + '</span><span class="iBadge">' + esc(ext) + '</span></div>' +
            (lens ? '<div class="iRow"><span class="muted">' + esc(lens) + '</span></div>' : '') +
            '<div class="iRow"><span class="muted">' + [mp, w && h ? w + " \u00d7 " + h : "", humanSize(f.size)].filter(Boolean).map(esc).join(" \u00b7 ") + '</span></div>' +
            (hasExif ? '<div class="iExif">' + cells.map(function (c) { return "<div>" + (c || "&ndash;") + "</div>"; }).join("") + '</div>' : '') +
            '</div>' +
            '<div class="iRow"><span class="muted">' + esc(dirOf(f.filepath)) + '</span></div>' +
            '</div>';
        $("infoSheet").innerHTML = html;
        $("infoSheet").querySelector(".iClose").addEventListener("click", hideSheets);
    }

    /* ---------- download ---------- */

    function downloadURL(url, name) {
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    $("btnShare").addEventListener("click", function () {
        var f = current();
        if (f) {
            downloadURL("../media/download/?file=" + encodeURIComponent(f.filepath), f.filename);
        }
    });
    $("btnInfo").addEventListener("click", function () { openInfo(false); });

    /* ---------- editing ---------- */

    function startEdit() {
        var f = current();
        if (!f || !V.loaded || PhotoEditor.isOpen) {
            return;
        }
        hideSheets();
        app.classList.remove("immersive");
        app.classList.remove("viewing");
        app.classList.add("editing");
        updateLayout();
        //the editor reads the pixels of the <img>, which must be decoded
        (img.decode ? img.decode() : Promise.resolve()).catch(function () {}).then(function () {
            return PhotoEditor.open(img, { name: f.filename });
        }).catch(function (err) {
            endEdit();
            toast("Editing needs WebGL, which this browser does not offer");
            console.error(err);
        });
    }

    function endEdit() {
        PhotoEditor.close();
        app.classList.remove("editing", "cropping");
        app.classList.add("viewing");
        hideSheets();
        requestAnimationFrame(function () { fitImage(false); });
    }

    $("btnEdit").addEventListener("click", startEdit);

    $("btnCancel").addEventListener("click", function () {
        if (!PhotoEditor.hasChanges()) {
            endEdit();
            return;
        }
        if (isDesktop()) {
            showDialog('<div class="dhead">Discard your changes?</div>' +
                '<div class="dtext">The edits to ' + esc(current().filename) + ' have not been saved and will be lost.</div>' +
                '<div class="dfoot"><span class="grow"></span>' +
                '<button type="button" class="dbtn" id="discardNo">Keep Editing</button>' +
                '<button type="button" class="dbtn danger" id="discardYes">Discard</button></div>');
        } else {
            $("actionSheet").innerHTML =
                '<div class="sgroup"><button type="button" class="sbtn red" id="discardYes">Discard Changes</button></div>' +
                '<div class="sgroup"><button type="button" class="sbtn bold" id="discardNo">Keep Editing</button></div>';
            showSheet("actionSheet");
        }
        $("discardYes").onclick = endEdit;
        $("discardNo").onclick = hideSheets;
    });

    $("btnDone").addEventListener("click", function () {
        if (!PhotoEditor.hasChanges()) {
            endEdit();
            return;
        }
        openSaveSheet();
    });

    //Output format for a source file name: same format when the browser can
    //write it, JPEG otherwise (HEIC, RAW, GIF)
    function outputFormat(name) {
        var ext = extOf(name);
        if (ext === "jpg" || ext === "jpeg") {
            return { mime: "image/jpeg", ext: ext, label: "JPEG", replace: true };
        }
        if (ext === "png") {
            return { mime: "image/png", ext: "png", label: "PNG", replace: true };
        }
        if (ext === "webp") {
            return { mime: "image/webp", ext: "webp", label: "WebP", replace: true };
        }
        return { mime: "image/jpeg", ext: "jpg", label: "JPEG", replace: false };
    }

    //name with its extension set to ext
    function withExt(name, ext) {
        var dot = name.lastIndexOf(".");
        var base = dot > 0 ? name.substring(0, dot) : name;
        return base + "." + ext;
    }

    function nameTaken(name) {
        var low = name.toLowerCase();
        return V.list.some(function (x) { return x.filename.toLowerCase() === low; });
    }

    function copyName(f, ext) {
        var name = f.filename;
        var dot = name.lastIndexOf(".");
        var base = dot > 0 ? name.substring(0, dot) : name;
        var taken = {};
        V.list.forEach(function (x) { taken[x.filename.toLowerCase()] = true; });
        var n = 1;
        var cand = base + " (Edited)." + ext;
        while (taken[cand.toLowerCase()]) {
            n++;
            cand = base + " (Edited " + n + ")." + ext;
        }
        return cand;
    }

    function openSaveSheet() {
        var f = current();
        var fmt = outputFormat(f.filename);
        var full = PhotoEditor.outputSize();
        var longSide = Math.max(full.width, full.height);
        var presets = [
            { id: "actual", name: "Actual", long: longSide },
            { id: "large", name: "Large", long: 2048 },
            { id: "medium", name: "Medium", long: 1280 },
            { id: "small", name: "Small", long: 640 },
            { id: "custom", name: "Custom" }
        ];
        var size = { id: "actual", w: full.width, h: full.height, lock: true };

        var desk = isDesktop();
        var seg = '<div class="seg" id="sizeSeg">' + presets.map(function (p) {
            var dis = p.long !== undefined && p.id !== "actual" && p.long >= longSide;
            return '<button type="button" data-id="' + p.id + '"' + (dis ? " disabled" : "") + '>' + p.name + '</button>';
        }).join("") + '</div>';
        var custom = '<div class="customSize" id="customSize">' +
            '<input type="number" id="cw" min="1" max="16384" inputmode="numeric" aria-label="Width"> \u00d7 ' +
            '<input type="number" id="chh" min="1" max="16384" inputmode="numeric" aria-label="Height">' +
            '<button type="button" class="lock on" id="clock" title="Keep proportions">' + I.link + '</button></div>';
        var html;
        if (desk) {
            html = '<div class="dhead">Save edited photo</div>' +
                '<div class="drow"><label>Size</label><div class="dfield">' + seg + custom +
                '<div class="sizeInfo" id="sizeInfo"></div></div></div>' +
                '<div class="drow"><label for="copyName">Copy name</label><div class="dfield">' +
                '<input type="text" id="copyName" class="dinput" spellcheck="false" value="' + esc(copyName(f, fmt.ext)) + '">' +
                '<div class="dhint">Saved in ' + esc(dirOf(f.filepath)) + '</div></div></div>' +
                '<div class="dfoot">' +
                '<button type="button" class="dbtn" id="saveDownload">' + I.download + ' Download</button>' +
                '<span class="grow"></span>' +
                '<button type="button" class="dbtn" id="saveCancel">Cancel</button>' +
                (fmt.replace ? '<button type="button" class="dbtn danger" id="saveReplace" title="Overwrite ' + esc(f.filename) + '">Replace Original</button>' : '') +
                '<button type="button" class="dbtn primary" id="saveCopy">Save as Copy</button>' +
                '</div>';
        } else {
            html = '<div class="sgroup">' +
                '<div class="stitle">Save the edited photo</div>' + seg + custom +
                '<div class="sizeInfo" id="sizeInfo"></div>' +
                '<button type="button" class="sbtn" id="saveCopy">Save as Copy<span class="sub">' + esc(copyName(f, fmt.ext)) + '</span></button>' +
                (fmt.replace ? '<button type="button" class="sbtn red" id="saveReplace">Replace Original<span class="sub">' + esc(f.filename) + '</span></button>' : '') +
                '<button type="button" class="sbtn" id="saveDownload">Download</button>' +
                '</div>' +
                '<div class="sgroup"><button type="button" class="sbtn bold" id="saveCancel">Cancel</button></div>';
        }
        var sheet = desk ? $("dialog") : $("actionSheet");
        if (desk) {
            showDialog(html);
        } else {
            sheet.innerHTML = html;
        }

        function refresh() {
            sheet.querySelectorAll("#sizeSeg button").forEach(function (b) {
                b.classList.toggle("sel", b.dataset.id === size.id);
            });
            $("customSize").classList.toggle("on", size.id === "custom");
            $("cw").value = size.w;
            $("chh").value = size.h;
            $("clock").classList.toggle("on", size.lock);
            $("sizeInfo").textContent = size.w + " \u00d7 " + size.h + " \u00b7 " + fmt.label +
                (fmt.replace ? "" : " (" + extOf(f.filename).toUpperCase() + " is saved as JPEG)");
        }
        sheet.querySelectorAll("#sizeSeg button").forEach(function (b) {
            b.addEventListener("click", function () {
                var p = presets.filter(function (x) { return x.id === b.dataset.id; })[0];
                size.id = p.id;
                if (p.long !== undefined) {
                    var s = Math.min(1, p.long / longSide);
                    size.w = Math.max(1, Math.round(full.width * s));
                    size.h = Math.max(1, Math.round(full.height * s));
                }
                refresh();
            });
        });
        function onCustom(which) {
            var w = parseInt($("cw").value, 10), h = parseInt($("chh").value, 10);
            if (which === "w" && w > 0) {
                size.w = Math.min(16384, w);
                if (size.lock) { size.h = Math.max(1, Math.round(size.w * full.height / full.width)); }
            } else if (which === "h" && h > 0) {
                size.h = Math.min(16384, h);
                if (size.lock) { size.w = Math.max(1, Math.round(size.h * full.width / full.height)); }
            }
            $("sizeInfo").textContent = size.w + " \u00d7 " + size.h + " \u00b7 " + fmt.label;
            if (which === "w") { $("chh").value = size.h; } else { $("cw").value = size.w; }
        }
        $("cw").addEventListener("input", function () { onCustom("w"); });
        $("chh").addEventListener("input", function () { onCustom("h"); });
        $("clock").addEventListener("click", function () {
            size.lock = !size.lock;
            if (size.lock) { onCustom("w"); }
            refresh();
        });
        //the copy name typed on the desktop; characters no drive allows
        //in a name are replaced
        function chosenName() {
            var el = $("copyName");
            var n = el ? el.value.trim().replace(BAD_NAME_CHARS, "_") : "";
            return n === "" ? null : n;
        }
        $("saveCancel").onclick = hideSheets;
        $("saveCopy").onclick = function () {
            var n = chosenName();
            if (n && nameTaken(withExt(n, fmt.ext))) {
                $("copyName").classList.add("bad");
                $("copyName").nextElementSibling.textContent = "A photo named " + withExt(n, fmt.ext) + " is already in this folder";
                $("copyName").focus();
                return;
            }
            save("copy", fmt, size, n);
        };
        $("saveDownload").onclick = function () { save("download", fmt, size, chosenName()); };
        if ($("saveReplace")) {
            $("saveReplace").onclick = function () { save("replace", fmt, size); };
        }
        if ($("copyName")) {
            $("copyName").addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    $("saveCopy").click();
                }
            });
        }
        refresh();
        if (!desk) {
            showSheet("actionSheet");
        }
    }

    var BAD_NAME_CHARS = new RegExp("[" + String.fromCharCode(92) + String.fromCharCode(92) + "/:*?\"<>|]", "g");

    //name: the copy name typed on the desktop, or null for the default
    function save(mode, fmt, size, name) {
        var f = current();
        hideSheets();
        progress(true, mode === "download" ? "Preparing" : "Saving");
        //let the progress box paint before the GPU work blocks the page
        setTimeout(function () {
            PhotoEditor.exportImage({ width: size.w, height: size.h, mime: fmt.mime }).then(function (blob) {
                var ext = fmt.ext;
                if (blob.type && blob.type !== fmt.mime) {
                    //this browser cannot write the format (WebP on some)
                    if (mode === "replace") {
                        progress(false);
                        toast("This browser cannot write " + fmt.label + " files. Save a copy instead.");
                        return;
                    }
                    ext = blob.type === "image/png" ? "png" : "jpg";
                }
                if (mode === "download") {
                    var url = URL.createObjectURL(blob);
                    downloadURL(url, name ? withExt(name, ext) : copyName(f, ext));
                    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
                    progress(false);
                    return;
                }
                name = mode === "replace" ? f.filename : (name ? withExt(name, ext) : copyName(f, ext));
                var dir = dirOf(f.filepath);
                var file = new File([blob], name, { type: blob.type || fmt.mime });
                ao_module_uploadFile(file, dir, function (resp) {
                    var data = null;
                    try { data = JSON.parse(resp); } catch (e) { data = null; }
                    if (data && data.error) {
                        progress(false);
                        toast("Not saved: " + data.error);
                        return;
                    }
                    progress(false);
                    endEdit();
                    if (mode === "replace") {
                        V.version[f.filepath] = Date.now();
                        f.modtime = Math.floor(Date.now() / 1000);
                        f.size = blob.size;
                        V.exifCache[f.filepath] = undefined;
                        toast("Saved");
                        show(V.index, 0);
                        var th = $("vStrip").children[V.index];
                        if (th) { loadThumb(th); }
                    } else {
                        toast("Saved as " + name);
                        var path = dir + name;
                        V.list.push({ filepath: path, filename: name, size: blob.size, modtime: Math.floor(Date.now() / 1000) });
                        show(V.list.length - 1, 0);
                        loadList({ filepath: path, filename: name });
                    }
                }, undefined, function (status) {
                    progress(false);
                    toast("Not saved (error " + status + ")");
                });
            }).catch(function (err) {
                progress(false);
                toast("Not saved: " + (err && err.message ? err.message : err));
            });
        }, 30);
    }

    /* ---------- keyboard ---------- */

    document.addEventListener("keydown", function (e) {
        if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
            return;
        }
        if (e.key === "Escape") {
            if (sheetOpen()) {
                hideSheets();
            } else if (PhotoEditor.isOpen) {
                $("btnCancel").click();
            } else if (zoomed()) {
                fitImage(true);
            } else {
                app.classList.remove("immersive");
            }
            return;
        }
        if (sheetOpen()) {
            return;
        }
        if (PhotoEditor.isOpen) {
            if (PhotoEditor.onKey(e)) {
                e.preventDefault();
            } else if (e.key === "Enter" && !(e.target && e.target.tagName === "BUTTON")) {
                $("btnDone").click();
            }
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (e.key === "ArrowLeft") { go(-1); }
        else if (e.key === "ArrowRight") { go(1); }
        else if (e.key === "e" || e.key === "E") { startEdit(); }
        else if (e.key === "i" || e.key === "I") { openInfo(false); }
        else if (e.key === "+" || e.key === "=") { zoomAt(V.s * 1.5, stage.clientWidth / 2, stage.clientHeight / 2, true); }
        else if (e.key === "-") { zoomAt(V.s / 1.5, stage.clientWidth / 2, stage.clientHeight / 2, true); }
        else if (e.key === "0") { fitImage(true); }
    });

    /* ---------- start ---------- */

    var input = ao_module_loadInputFiles();
    if (!input || input.length === 0) {
        stage.insertAdjacentHTML("beforeend", '<div class="empty">' + I.photo + '<div>No photo opened</div></div>');
        $("vBottom").style.display = "none";
        return;
    }
    var first = input[0];
    first.filepath = first.filepath.split("\\").join("/");
    V.list = [{ filepath: first.filepath, filename: first.filename || baseName(first.filepath) }];
    show(0, 0);
    loadList(first);
})();
