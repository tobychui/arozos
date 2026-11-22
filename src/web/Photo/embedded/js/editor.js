/*
    Photo editor (the Edit mode of embedded.html)

    Non-destructive: the picture is only changed when the viewer saves the
    result of exportImage(). Three tabs, as on the phone:
      Adjust   light and colour dials
      Filters  looks with an intensity dial
      Crop     straighten / keystone dials, free or fixed ratio crop box,
               flip and quarter turns

    PhotoEditor.open(img, {name, onDone(editor), onClose()})
    PhotoEditor.exportImage({width, height, mime}) -> Promise<Blob>
*/
(function (root) {
    "use strict";

    var I = root.PhotoIcons;
    var G = root.PhotoGeo;

    var ADJUST_TOOLS = [
        { id: "auto", name: "Auto", min: 0, max: 100 },
        { id: "exposure", name: "Exposure" },
        { id: "brilliance", name: "Brilliance" },
        { id: "highlights", name: "Highlights" },
        { id: "shadows", name: "Shadows" },
        { id: "contrast", name: "Contrast" },
        { id: "brightness", name: "Brightness" },
        { id: "black", name: "Black Point" },
        { id: "saturation", name: "Saturation" },
        { id: "vibrance", name: "Vibrance" },
        { id: "warmth", name: "Warmth" },
        { id: "tint", name: "Tint" },
        { id: "sharpness", name: "Sharpness", min: 0, max: 100 },
        { id: "definition", name: "Definition" },
        { id: "noise", name: "Noise Reduction", min: 0, max: 100 },
        { id: "vignette", name: "Vignette" }
    ];

    var CROP_TOOLS = [
        { id: "angle", icon: "straighten", name: "Straighten" },
        { id: "vertical", icon: "vertical", name: "Vertical" },
        { id: "horizontal", icon: "horizontal", name: "Horizontal" }
    ];

    var RATIOS = [
        { id: "original", name: "ORIGINAL" },
        { id: "freeform", name: "FREEFORM" },
        { id: "square", name: "SQUARE", r: 1 },
        { id: "16:9", name: "16:9", r: 16 / 9 },
        { id: "10:8", name: "10:8", r: 10 / 8 },
        { id: "7:5", name: "7:5", r: 7 / 5 },
        { id: "4:3", name: "4:3", r: 4 / 3 },
        { id: "5:3", name: "5:3", r: 5 / 3 },
        { id: "3:2", name: "3:2", r: 3 / 2 }
    ];

    var PREVIEW_MAX = 2560;     //long side of the editing texture
    var MAX_EXPORT_AREA = 16777216; //canvas area limit of mobile Safari

    function $(id) { return document.getElementById(id); }
    function dpr() { return Math.min(window.devicePixelRatio || 1, 3); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function ringSVG(r) {
        var c = 2 * Math.PI * r;
        return '<svg class="ring" viewBox="0 0 48 48"><circle class="bg" cx="24" cy="24" r="' + r + '"/>' +
            '<circle class="val" cx="24" cy="24" r="' + r + '" stroke-dasharray="0 ' + c + '"/></svg>';
    }

    function setRing(btn, frac) {
        var circle = btn.querySelector(".ring .val");
        if (!circle) {
            return;
        }
        var r = parseFloat(circle.getAttribute("r"));
        var c = 2 * Math.PI * r;
        var len = Math.min(1, Math.abs(frac)) * c;
        circle.setAttribute("stroke-dasharray", len + " " + c);
        //negative values run anticlockwise
        circle.style.transformOrigin = "24px 24px";
        circle.style.transform = frac < 0 ? "scaleY(-1)" : "";
    }

    var E = {
        isOpen: false,
        img: null,
        st: null,
        tab: "adjust",
        adjTool: "exposure",
        cropTool: "angle",
        aspectOpen: false,
        aspect: { id: "freeform", portrait: false },
        view: null,
        comparing: false,
        history: [],
        hIndex: -1,
        initialSnap: ""
    };

    /* ---------- open / close ---------- */

    E.open = function (img, opts) {
        this.opts = opts || {};
        this.img = img;
        var W = img.naturalWidth, H = img.naturalHeight;
        this.st = {
            geo: G.newGeometry(W, H),
            adj: {},
            filter: "original",
            filterIntensity: 100,
            autoParams: {}
        };
        this.tab = "adjust";
        this.adjTool = "exposure";
        this.cropTool = "angle";
        this.aspectOpen = false;
        this.aspect = { id: "freeform", portrait: H > W };
        this.prevVals = {};
        this.comparing = false;

        var canvas = $("editCanvas");
        try {
            if (!this.renderer) {
                this.renderer = new PhotoRenderer(canvas);
            }
        } catch (e) {
            return Promise.reject(e);
        }
        //editing texture: the picture scaled to fit the GPU and PREVIEW_MAX
        var maxSide = Math.min(PREVIEW_MAX, this.renderer.maxTexture);
        var s = Math.min(1, maxSide / Math.max(W, H));
        var pc = document.createElement("canvas");
        pc.width = Math.max(1, Math.round(W * s));
        pc.height = Math.max(1, Math.round(H * s));
        var pctx = pc.getContext("2d");
        pctx.imageSmoothingQuality = "high";
        pctx.drawImage(img, 0, 0, pc.width, pc.height);
        this.renderer.setSource(pc);

        //auto enhance is measured once on a small copy
        var mc = document.createElement("canvas");
        var ms = Math.min(1, 256 / Math.max(W, H));
        mc.width = Math.max(1, Math.round(W * ms));
        mc.height = Math.max(1, Math.round(H * ms));
        mc.getContext("2d").drawImage(pc, 0, 0, mc.width, mc.height);
        try {
            this.st.autoParams = PhotoRendererUtil.measureAuto(mc.getContext("2d").getImageData(0, 0, mc.width, mc.height).data);
        } catch (e) {
            this.st.autoParams = {};
        }
        //small source for the filter thumbnails
        this.thumbSource = mc;

        this.isOpen = true;
        this.history = [];
        this.hIndex = -1;
        this.initialSnap = this.snapshot();
        this.pushHistory();
        this.buildStatic();
        this.setTab("adjust");
        this.layoutChanged();
        return Promise.resolve();
    };

    E.close = function () {
        this.isOpen = false;
        $("cropFrame").classList.remove("busy", "fine");
        document.getElementById("app").classList.remove("cropping");
        if (this.thumbRenderer) {
            this.thumbRenderer.destroy();
            this.thumbRenderer = null;
        }
        if (this.renderer) {
            //keep the context, but free the picture
            this.renderer.setSource(document.createElement("canvas"));
        }
        this.img = null;
    };

    E.hasChanges = function () {
        return this.isOpen && this.snapshot() !== this.initialSnap;
    };

    /* ---------- history ---------- */

    E.snapshot = function () {
        var st = this.st;
        return JSON.stringify({ geo: st.geo, adj: st.adj, filter: st.filter, fi: st.filterIntensity, aspect: this.aspect });
    };

    E.restore = function (snap) {
        var s = JSON.parse(snap);
        this.st.geo = s.geo;
        this.st.adj = s.adj;
        this.st.filter = s.filter;
        this.st.filterIntensity = s.fi;
        this.aspect = s.aspect;
        this.refreshPanel();
        this.refitView(true);
    };

    E.pushHistory = function () {
        var snap = this.snapshot();
        if (this.hIndex >= 0 && this.history[this.hIndex] === snap) {
            return;
        }
        this.history = this.history.slice(0, this.hIndex + 1);
        this.history.push(snap);
        if (this.history.length > 80) {
            this.history.shift();
        }
        this.hIndex = this.history.length - 1;
        this.updateTop();
    };

    E.undo = function () {
        if (this.hIndex > 0) {
            this.hIndex--;
            this.restore(this.history[this.hIndex]);
        }
    };

    E.redo = function () {
        if (this.hIndex < this.history.length - 1) {
            this.hIndex++;
            this.restore(this.history[this.hIndex]);
        }
    };

    /* ---------- static chrome ---------- */

    E.buildStatic = function () {
        if (this.staticBuilt) {
            return;
        }
        this.staticBuilt = true;
        var self = this;
        document.querySelectorAll(".eTab").forEach(function (b) {
            b.querySelector(".ic").innerHTML = I["tab" + b.dataset.tab.charAt(0).toUpperCase() + b.dataset.tab.slice(1)];
            b.addEventListener("click", function () { self.setTab(b.dataset.tab); });
        });

        this.ruler = new PhotoRuler($("eRuler"), { min: -100, max: 100, value: 0 });
        this.ruler.onInput = function (v) { self.onRuler(v, false); };
        this.ruler.onCommit = function (v) { self.onRuler(v, true); };

        $("ePill").addEventListener("click", function () { self.onPill(); });

        var car = $("eCarousel");
        var scrollTimer = null;
        car.addEventListener("scroll", function () {
            clearTimeout(scrollTimer);
            if (self.programmaticScroll) {
                return;
            }
            scrollTimer = setTimeout(function () { self.selectCentred(); }, 160);
        }, { passive: true });
        //a mouse wheel scrolls the row of tools sideways
        car.addEventListener("wheel", function (e) {
            if (document.getElementById("app").classList.contains("landscape") || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                return;
            }
            e.preventDefault();
            car.scrollLeft += (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
        }, { passive: false });
        //our own smooth scrolls end here (the timer covers browsers without it)
        car.addEventListener("scrollend", function () {
            if (self.programmaticScroll) {
                clearTimeout(self.scrollFlagTimer);
                setTimeout(function () { self.programmaticScroll = false; }, 50);
            }
        });

        this.bindStage();
        this.bindCrop();
    };

    E.updateTop = function () {
        var left = $("eTopLeft"), right = $("eTopRight"), pill = $("ePill");
        var self = this;
        if (!this.isOpen) {
            return;
        }
        if (this.tab === "crop") {
            if (left.dataset.mode !== "crop") {
                left.dataset.mode = "crop";
                left.innerHTML = '<button class="eIcon" id="eFlip" type="button" title="Flip">' + I.flip + '</button>' +
                    '<button class="eIcon" id="eRotate" type="button" title="Rotate">' + I.rotate + '</button>';
                right.innerHTML = '<button class="eIcon" id="eAspect" type="button" title="Aspect ratio">' + I.aspect + '</button>';
                $("eFlip").onclick = function () { self.flip(); };
                $("eRotate").onclick = function () { self.rotate(); };
                $("eAspect").onclick = function () { self.toggleAspect(); };
            }
            $("eAspect").classList.toggle("on", this.aspectOpen || this.aspect.id !== "freeform");
            var changed = !G.isIdentity(this.st.geo);
            pill.textContent = "RESET";
            pill.className = "ePill" + (changed ? " on accent" : "");
        } else {
            if (left.dataset.mode !== "edit") {
                left.dataset.mode = "edit";
                left.innerHTML = '<button class="eIcon" id="eUndo" type="button" title="Undo">' + I.undo + '</button>' +
                    '<button class="eIcon" id="eRedo" type="button" title="Redo">' + I.redo + '</button>';
                right.innerHTML = "";
                $("eUndo").onclick = function () { self.undo(); };
                $("eRedo").onclick = function () { self.redo(); };
            }
            pill.textContent = this.comparing ? "ORIGINAL" : "";
            pill.className = "ePill" + (this.comparing ? " on" : "");
        }
        var undo = $("eUndo"), redo = $("eRedo");
        if (undo) {
            undo.disabled = this.hIndex <= 0;
            redo.disabled = this.hIndex >= this.history.length - 1;
        }
    };

    E.onPill = function () {
        if (this.tab === "crop" && !G.isIdentity(this.st.geo)) {
            var g = this.st.geo;
            this.st.geo = G.newGeometry(g.W, g.H);
            this.aspect = { id: "freeform", portrait: g.H > g.W };
            this.pushHistory();
            this.refreshPanel();
            this.refitView(true);
        }
    };

    /* ---------- tabs and panel ---------- */

    E.setTab = function (tab) {
        this.tab = tab;
        this.aspectOpen = false;
        document.querySelectorAll(".eTab").forEach(function (b) {
            b.classList.toggle("sel", b.dataset.tab === tab);
        });
        document.getElementById("app").classList.toggle("cropping", tab === "crop");
        this.refreshPanel();
        this.refitView(true);
    };

    E.refreshPanel = function () {
        var car = $("eCarousel");
        var label = $("eLabel");
        var panel = $("ePanel");
        var self = this;
        var orient = panel.querySelector(".orientRow");
        if (orient) {
            orient.remove();
        }
        panel.classList.remove("withOrient");
        car.className = "";
        $("eRulerWrap").style.display = "";
        $("eRulerWrap").style.visibility = "";
        this.programmaticScroll = true;
        car.innerHTML = "";

        if (this.tab === "adjust") {
            ADJUST_TOOLS.forEach(function (t) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "tool";
                b.dataset.id = t.id;
                b.title = t.name;
                b.innerHTML = ringSVG(22) + '<span class="glyph">' + I[t.id] + '</span><span class="num"></span>';
                b.addEventListener("click", function () { self.selectAdjust(t.id, true); });
                car.appendChild(b);
            });
            this.selectAdjust(this.adjTool, false);
        } else if (this.tab === "filters") {
            PhotoFilters.forEach(function (f) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "fthumb";
                b.dataset.id = f.id;
                b.title = f.name;
                b.innerHTML = "<canvas></canvas>";
                b.addEventListener("click", function () { self.selectFilter(f.id, true); });
                car.appendChild(b);
            });
            this.selectFilter(this.st.filter, false);
            this.renderThumbs();
        } else if (this.aspectOpen) {
            car.className = "texts";
            label.textContent = "";
            label.className = "";
            $("eRulerWrap").style.display = "none";
            var row = document.createElement("div");
            row.className = "orientRow";
            row.innerHTML = '<button type="button" data-o="p" title="Portrait">' + I.portrait + '</button>' +
                '<button type="button" data-o="l" title="Landscape">' + I.landscape + '</button>';
            panel.insertBefore(row, car);
            panel.classList.add("withOrient");
            row.querySelectorAll("button").forEach(function (b) {
                b.addEventListener("click", function () { self.setOrientation(b.dataset.o === "p"); });
            });
            RATIOS.forEach(function (r) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "topt";
                b.dataset.id = r.id;
                b.textContent = r.name;
                b.addEventListener("click", function () { self.setAspect(r.id); });
                car.appendChild(b);
            });
            this.markAspect();
        } else {
            CROP_TOOLS.forEach(function (t) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "tool small";
                b.dataset.id = t.id;
                b.title = t.name;
                b.innerHTML = ringSVG(18) + '<span class="glyph">' + I[t.icon] + '</span><span class="num"></span>';
                b.addEventListener("click", function () { self.selectCrop(t.id, true); });
                car.appendChild(b);
            });
            this.selectCrop(this.cropTool, false);
        }
        this.updateTop();
        setTimeout(function () { self.programmaticScroll = false; }, 400);
    };

    E.scrollToItem = function (el, smooth) {
        var car = $("eCarousel");
        if (!el) {
            return;
        }
        this.programmaticScroll = true;
        var self = this;
        var land = document.getElementById("app").classList.contains("landscape");
        var er = el.getBoundingClientRect(), cr = car.getBoundingClientRect();
        if (land) {
            car.scrollBy({ top: (er.top + er.height / 2) - (cr.top + cr.height / 2), behavior: smooth ? "smooth" : "auto" });
        } else {
            car.scrollBy({ left: (er.left + er.width / 2) - (cr.left + cr.width / 2), behavior: smooth ? "smooth" : "auto" });
        }
        clearTimeout(this.scrollFlagTimer);
        this.scrollFlagTimer = setTimeout(function () { self.programmaticScroll = false; }, smooth ? 900 : 120);
    };

    //After a flick of the carousel, the item under the middle is selected
    //The value beside the tool name (only shown on the desktop, where the
    //dials do not turn into numbers under the finger)
    E.updateLabelValue = function () {
        var label = $("eLabel");
        var lv = label.querySelector(".lv");
        if (!lv) {
            lv = document.createElement("span");
            lv.className = "lv";
            label.appendChild(lv);
        }
        var text = "";
        if (this.tab === "adjust") {
            var v = Math.round(this.st.adj[this.adjTool] || 0);
            text = v > 0 ? "+" + v : String(v);
        } else if (this.tab === "filters") {
            text = this.st.filter === "original" ? "" : Math.round(this.st.filterIntensity) + "%";
        } else if (this.tab === "crop" && !this.aspectOpen) {
            var a = this.st.geo[this.cropTool] || 0;
            text = (a > 0 ? "+" : "") + (Math.round(a * 10) / 10) + "\u00b0";
        }
        lv.textContent = text;
    };

    E.selectCentred = function () {
        if (!this.isOpen || (this.tab === "crop" && this.aspectOpen) ||
            document.getElementById("app").classList.contains("desktop")) {
            return;
        }
        var car = $("eCarousel");
        var land = document.getElementById("app").classList.contains("landscape");
        var cr = car.getBoundingClientRect();
        var mid = land ? cr.top + cr.height / 2 : cr.left + cr.width / 2;
        var best = null, bestD = Infinity;
        Array.prototype.forEach.call(car.children, function (el) {
            var er = el.getBoundingClientRect();
            var c = land ? er.top + er.height / 2 : er.left + er.width / 2;
            var d = Math.abs(c - mid);
            if (d < bestD) { bestD = d; best = el; }
        });
        if (!best) {
            return;
        }
        var id = best.dataset.id;
        if (this.tab === "adjust" && id !== this.adjTool) {
            this.selectAdjust(id, false, true);
        } else if (this.tab === "filters" && id !== this.st.filter) {
            this.selectFilter(id, false, true);
        } else if (this.tab === "crop" && id !== this.cropTool) {
            this.selectCrop(id, false, true);
        }
    };

    function toolDef(id) {
        for (var i = 0; i < ADJUST_TOOLS.length; i++) {
            if (ADJUST_TOOLS[i].id === id) {
                return ADJUST_TOOLS[i];
            }
        }
        return ADJUST_TOOLS[1];
    }

    E.selectAdjust = function (id, fromTap, fromScroll) {
        var t = toolDef(id);
        var car = $("eCarousel");
        //tapping the selected dial turns its adjustment off and on again
        if (fromTap && id === this.adjTool) {
            var cur = this.st.adj[id] || 0;
            if (cur !== 0) {
                this.prevVals[id] = cur;
                this.st.adj[id] = 0;
            } else if (this.prevVals[id]) {
                this.st.adj[id] = this.prevVals[id];
            } else if (id === "auto") {
                this.st.adj.auto = 100;
            }
            this.pushHistory();
            this.requestRender();
        }
        this.adjTool = id;
        var sel = null;
        Array.prototype.forEach.call(car.children, function (b) {
            b.classList.toggle("sel", b.dataset.id === id);
            if (b.dataset.id === id) { sel = b; }
        });
        this.updateRings();
        var label = $("eLabel");
        label.textContent = t.name;
        label.className = (this.st.adj[id] || 0) !== 0 ? "accent" : "";
        this.updateLabelValue();
        this.ruler.setRange({ min: t.min === undefined ? -100 : t.min, max: t.max === undefined ? 100 : t.max,
            def: 0, step: 1, pxPerUnit: 1.7, tickEvery: 5, majorEvery: 25, value: this.st.adj[id] || 0 });
        if (!fromScroll) {
            this.scrollToItem(sel, fromTap);
        }
    };

    E.updateRings = function () {
        var self = this;
        var car = $("eCarousel");
        Array.prototype.forEach.call(car.children, function (b) {
            var id = b.dataset.id;
            if (self.tab === "adjust") {
                var t = toolDef(id);
                var v = self.st.adj[id] || 0;
                var span = (t.max === undefined ? 100 : t.max);
                setRing(b, v / span);
                b.classList.toggle("changed", v !== 0);
                b.querySelector(".num").textContent = Math.round(v);
            } else if (self.tab === "crop" && !self.aspectOpen) {
                var g = self.st.geo;
                var cv = g[id] || 0;
                setRing(b, cv / 45);
                b.classList.toggle("changed", cv !== 0);
                b.querySelector(".num").textContent = Math.round(cv);
            }
        });
    };

    E.selectFilter = function (id, fromTap, fromScroll) {
        var car = $("eCarousel");
        var sel = null;
        if (id !== this.st.filter) {
            this.st.filter = id;
            this.st.filterIntensity = 100;
            this.pushHistory();
            this.requestRender();
        }
        Array.prototype.forEach.call(car.children, function (b) {
            b.classList.toggle("sel", b.dataset.id === id);
            if (b.dataset.id === id) { sel = b; }
        });
        var f = PhotoFilters.filter(function (x) { return x.id === id; })[0] || PhotoFilters[0];
        var label = $("eLabel");
        label.textContent = f.name;
        label.className = id !== "original" ? "accent" : "";
        this.updateLabelValue();
        $("eRulerWrap").style.visibility = id === "original" ? "hidden" : "";
        this.ruler.setRange({ min: 0, max: 100, def: 100, step: 1, pxPerUnit: 2.4, tickEvery: 5, majorEvery: 25,
            value: this.st.filterIntensity });
        if (!fromScroll) {
            this.scrollToItem(sel, fromTap);
        }
    };

    E.selectCrop = function (id, fromTap, fromScroll) {
        var car = $("eCarousel");
        var sel = null;
        this.cropTool = id;
        Array.prototype.forEach.call(car.children, function (b) {
            b.classList.toggle("sel", b.dataset.id === id);
            if (b.dataset.id === id) { sel = b; }
        });
        var t = CROP_TOOLS.filter(function (x) { return x.id === id; })[0];
        var label = $("eLabel");
        label.textContent = t.name;
        label.className = (this.st.geo[id] || 0) !== 0 ? "accent" : "";
        this.updateLabelValue();
        $("eRulerWrap").style.visibility = "";
        this.ruler.setRange({ min: -45, max: 45, def: 0, step: 0.5, pxPerUnit: 7, tickEvery: 1, majorEvery: 5,
            value: this.st.geo[id] || 0 });
        this.updateRings();
        if (!fromScroll) {
            this.scrollToItem(sel, fromTap);
        }
    };

    E.onRuler = function (v, commit) {
        var car = $("eCarousel");
        var sel = car.querySelector(".sel");
        if (this.tab === "adjust") {
            this.st.adj[this.adjTool] = v;
            this.updateRings();
            $("eLabel").className = v !== 0 ? "accent" : "";
            this.updateLabelValue();
            if (sel) {
                sel.classList.add("showNum");
                clearTimeout(this.numTimer);
                if (commit) {
                    this.numTimer = setTimeout(function () { sel.classList.remove("showNum"); }, 1200);
                }
            }
            this.requestRender();
        } else if (this.tab === "filters") {
            this.st.filterIntensity = v;
            this.updateLabelValue();
            this.requestRender();
        } else if (this.tab === "crop") {
            var g = this.st.geo;
            if (!this.dialBase) {
                this.dialBase = { cx: g.crop.cx, cy: g.crop.cy, w: g.crop.w, h: g.crop.h };
            }
            g[this.cropTool] = v;
            g.crop = G.shrinkToFit(g, this.dialBase);
            $("cropFrame").classList.add("fine");
            this.updateRings();
            $("eLabel").className = v !== 0 ? "accent" : "";
            this.updateLabelValue();
            if (sel) {
                sel.classList.add("showNum");
            }
            this.refitView(false);
            if (commit) {
                this.dialBase = null;
                $("cropFrame").classList.remove("fine");
                var s2 = sel;
                clearTimeout(this.numTimer);
                this.numTimer = setTimeout(function () { if (s2) { s2.classList.remove("showNum"); } }, 1200);
            }
        }
        if (commit) {
            this.pushHistory();
        }
    };

    /* ---------- crop: aspect, flip, rotate ---------- */

    E.toggleAspect = function () {
        this.aspectOpen = !this.aspectOpen;
        this.refreshPanel();
    };

    E.ratioValue = function () {
        var a = this.aspect;
        var o = G.orientedSize(this.st.geo);
        var r;
        if (a.id === "freeform") {
            return null;
        } else if (a.id === "original") {
            r = Math.max(o.w, o.h) / Math.min(o.w, o.h);
        } else {
            r = RATIOS.filter(function (x) { return x.id === a.id; })[0].r;
        }
        if (r === 1) {
            return 1;
        }
        return a.portrait ? 1 / r : r;
    };

    E.markAspect = function () {
        var a = this.aspect;
        var car = $("eCarousel");
        var sel = null;
        Array.prototype.forEach.call(car.children, function (b) {
            b.classList.toggle("sel", b.dataset.id === a.id);
            if (b.dataset.id === a.id) { sel = b; }
        });
        var row = document.querySelector(".orientRow");
        if (row) {
            var fixed = a.id === "freeform" || a.id === "square";
            row.querySelectorAll("button").forEach(function (b) {
                b.disabled = fixed;
                b.classList.toggle("sel", !fixed && ((b.dataset.o === "p") === a.portrait));
            });
        }
        this.scrollToItem(sel, true);
        this.updateTop();
    };

    E.applyRatio = function () {
        var r = this.ratioValue();
        if (r !== null) {
            this.st.geo.crop = G.cropForRatio(this.st.geo, this.st.geo.crop, r);
        }
        this.pushHistory();
        this.refitView(true);
    };

    E.setAspect = function (id) {
        this.aspect.id = id;
        if (id === "original") {
            var o = G.orientedSize(this.st.geo);
            this.aspect.portrait = o.h > o.w;
        }
        this.markAspect();
        this.applyRatio();
    };

    E.setOrientation = function (portrait) {
        this.aspect.portrait = portrait;
        this.markAspect();
        this.applyRatio();
    };

    E.flip = function () {
        G.flipHorizontal(this.st.geo);
        this.pushHistory();
        this.updateRings();
        this.refitView(true);
    };

    E.rotate = function () {
        G.rotateLeft(this.st.geo);
        this.aspect.portrait = !this.aspect.portrait;
        if (this.aspectOpen) {
            this.markAspect();
        }
        this.pushHistory();
        this.updateRings();
        this.refitView(true);
    };

    /* ---------- view and drawing ---------- */

    E.layoutChanged = function () {
        if (!this.isOpen) {
            return;
        }
        var land = document.getElementById("app").classList.contains("landscape");
        this.ruler.setVertical(land);
        this.refitView(false);
        var sel = $("eCarousel").querySelector(".sel");
        this.scrollToItem(sel, false);
    };

    E.targetView = function () {
        var stage = $("stage");
        var r = dpr();
        var w = stage.clientWidth * r, h = stage.clientHeight * r;
        var pad = (this.tab === "crop" ? 30 : 10) * r;
        return G.fitView(this.st.geo.crop, w, h, pad);
    };

    E.refitView = function (animate) {
        if (!this.isOpen) {
            return;
        }
        var stage = $("stage");
        var r = dpr();
        this.renderer.resize(stage.clientWidth * r, stage.clientHeight * r);
        var to = this.targetView();
        cancelAnimationFrame(this.viewAnim);
        if (!animate || !this.view) {
            this.view = to;
            this.requestRender();
            return;
        }
        var from = this.view;
        var start = performance.now();
        var self = this;
        function step(now) {
            var t = Math.min(1, (now - start) / 260);
            var e = 1 - Math.pow(1 - t, 3);
            self.view = {
                scale: from.scale + (to.scale - from.scale) * e,
                tx: from.tx + (to.tx - from.tx) * e,
                ty: from.ty + (to.ty - from.ty) * e
            };
            self.draw();
            if (t < 1) {
                self.viewAnim = requestAnimationFrame(step);
            }
        }
        this.viewAnim = requestAnimationFrame(step);
    };

    E.requestRender = function () {
        if (this.renderPending || !this.isOpen) {
            return;
        }
        this.renderPending = true;
        var self = this;
        requestAnimationFrame(function () {
            self.renderPending = false;
            self.draw();
        });
    };

    E.draw = function () {
        if (!this.isOpen || !this.view) {
            return;
        }
        this.renderer.render(this.st, this.view, { clip: this.tab !== "crop", original: this.comparing });
        this.placeCropFrame();
    };

    E.placeCropFrame = function () {
        if (this.tab !== "crop") {
            return;
        }
        var c = this.st.geo.crop, v = this.view, r = dpr();
        var f = $("cropFrame");
        f.style.left = ((c.cx - c.w / 2) * v.scale + v.tx) / r + "px";
        f.style.top = ((c.cy - c.h / 2) * v.scale + v.ty) / r + "px";
        f.style.width = c.w * v.scale / r + "px";
        f.style.height = c.h * v.scale / r + "px";
    };

    /* ---------- filter thumbnails ---------- */

    E.renderThumbs = function () {
        var size = Math.round(62 * dpr());
        if (!this.thumbRenderer) {
            var tc = document.createElement("canvas");
            try {
                this.thumbRenderer = new PhotoRenderer(tc, { preserve: true });
            } catch (e) {
                return;
            }
            this.thumbRenderer.setSource(this.thumbSource);
        }
        var tr = this.thumbRenderer;
        tr.resize(size, size);
        var c = this.st.geo.crop;
        var scale = Math.max(size / c.w, size / c.h);
        var view = { scale: scale, tx: size / 2 - c.cx * scale, ty: size / 2 - c.cy * scale };
        var self = this;
        $("eCarousel").querySelectorAll(".fthumb").forEach(function (b) {
            var st = { geo: self.st.geo, adj: self.st.adj, autoParams: self.st.autoParams, filter: b.dataset.id, filterIntensity: 100 };
            tr.render(st, view, {});
            var cv = b.querySelector("canvas");
            cv.width = size;
            cv.height = size;
            cv.getContext("2d").drawImage(tr.canvas, 0, 0);
        });
    };

    /* ---------- stage: compare and crop gestures ---------- */

    E.bindStage = function () {
        var self = this;
        var stage = $("stage");
        var holdTimer = null;
        stage.addEventListener("pointerdown", function (e) {
            if (!self.isOpen || self.tab === "crop") {
                return;
            }
            //press and hold shows the original
            holdTimer = setTimeout(function () {
                self.comparing = true;
                self.updateTop();
                self.requestRender();
            }, 180);
        });
        function release() {
            clearTimeout(holdTimer);
            if (self.comparing) {
                self.comparing = false;
                self.updateTop();
                self.requestRender();
            }
        }
        stage.addEventListener("pointerup", release);
        stage.addEventListener("pointercancel", release);
        stage.addEventListener("pointerleave", release);

        //crop zoom with the wheel or a pinch
        stage.addEventListener("wheel", function (e) {
            if (!self.isOpen || self.tab !== "crop") {
                return;
            }
            e.preventDefault();
            var f = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0015);
            self.zoomCrop(f);
            clearTimeout(self.wheelCommit);
            self.wheelCommit = setTimeout(function () {
                self.pushHistory();
                self.refitView(true);
                $("cropFrame").classList.remove("busy");
            }, 350);
        }, { passive: false });
    };

    //f > 1 zooms in: the crop gets smaller in picture pixels
    E.zoomCrop = function (f) {
        var g = this.st.geo;
        var c = g.crop;
        var minSide = 48 * dpr() / this.view.scale;
        var s = 1 / f;
        if (Math.min(c.w, c.h) * s < minSide) {
            s = minSide / Math.min(c.w, c.h);
        }
        var want = { cx: c.cx, cy: c.cy, w: c.w * s, h: c.h * s };
        g.crop = G.towards(g, c, want);
        $("cropFrame").classList.add("busy");
        this.refitView(false);
    };

    E.bindCrop = function () {
        var self = this;
        var frame = $("cropFrame");
        var drag = null;
        var pointers = {};

        frame.addEventListener("pointerdown", function (e) {
            if (!self.isOpen || self.tab !== "crop") {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            frame.setPointerCapture(e.pointerId);
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(pointers);
            var handle = e.target.dataset.h || "move";
            if (ids.length === 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                drag = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) };
                return;
            }
            drag = {
                kind: handle,
                x: e.clientX,
                y: e.clientY,
                start: JSON.parse(JSON.stringify(self.st.geo.crop)),
                last: JSON.parse(JSON.stringify(self.st.geo.crop))
            };
            frame.classList.add("busy");
        });

        frame.addEventListener("pointermove", function (e) {
            if (!drag || !pointers[e.pointerId]) {
                return;
            }
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            var g = self.st.geo;
            if (drag.kind === "pinch") {
                var ids = Object.keys(pointers);
                if (ids.length < 2) {
                    return;
                }
                var a = pointers[ids[0]], b = pointers[ids[1]];
                var d = Math.hypot(a.x - b.x, a.y - b.y);
                if (drag.dist > 0) {
                    self.zoomCrop(d / drag.dist);
                }
                drag.dist = d;
                return;
            }
            var k = dpr() / self.view.scale;
            var dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
            if (drag.kind === "move") {
                //the picture follows the finger, so the crop moves the other way
                g.crop = G.pan(g, drag.start, -dx, -dy);
            } else {
                var want = self.resizedCrop(drag.start, drag.kind, dx, dy, k);
                g.crop = G.towards(g, drag.last, want);
                drag.last = JSON.parse(JSON.stringify(g.crop));
            }
            self.draw();
        });

        function end(e) {
            delete pointers[e.pointerId];
            if (!drag) {
                return;
            }
            if (Object.keys(pointers).length > 0 && drag.kind !== "pinch") {
                return;
            }
            drag = null;
            pointers = {};
            frame.classList.remove("busy");
            self.pushHistory();
            self.refitView(true);
        }
        frame.addEventListener("pointerup", end);
        frame.addEventListener("pointercancel", end);
    };

    //The crop after dragging a corner or edge by (dx, dy) picture pixels
    E.resizedCrop = function (c, h, dx, dy, k) {
        var x0 = c.cx - c.w / 2, x1 = c.cx + c.w / 2, y0 = c.cy - c.h / 2, y1 = c.cy + c.h / 2;
        var min = 56 * k;
        if (h.indexOf("l") >= 0) { x0 = Math.min(x0 + dx, x1 - min); }
        if (h.indexOf("r") >= 0) { x1 = Math.max(x1 + dx, x0 + min); }
        if (h.indexOf("t") >= 0) { y0 = Math.min(y0 + dy, y1 - min); }
        if (h.indexOf("b") >= 0) { y1 = Math.max(y1 + dy, y0 + min); }
        var r = this.ratioValue();
        if (r !== null) {
            var w = x1 - x0, hh = y1 - y0;
            if (h.length === 2) {
                //corner: the larger move wins, the opposite corner stays
                if (Math.abs(dx) * 1 >= Math.abs(dy) * r) { hh = w / r; } else { w = hh * r; }
                if (h.indexOf("l") >= 0) { x0 = x1 - w; } else { x1 = x0 + w; }
                if (h.indexOf("t") >= 0) { y0 = y1 - hh; } else { y1 = y0 + hh; }
            } else if (h === "l" || h === "r") {
                hh = w / r;
                var cy = (y0 + y1) / 2;
                y0 = cy - hh / 2; y1 = cy + hh / 2;
            } else {
                w = hh * r;
                var cx = (x0 + x1) / 2;
                x0 = cx - w / 2; x1 = cx + w / 2;
            }
        }
        return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    };

    /* ---------- export ---------- */

    //Size of the edited picture at full resolution
    E.outputSize = function () {
        var c = this.st.geo.crop;
        var w = c.w, h = c.h;
        var s = Math.min(1, Math.sqrt(MAX_EXPORT_AREA / (w * h)));
        return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
    };

    /*
        Render the edit at full resolution, then scale it to opts.width x
        opts.height. Resolves with a Blob of opts.mime.
    */
    E.exportImage = function (opts) {
        var self = this;
        return new Promise(function (resolve, reject) {
            var img = self.img;
            var W = img.naturalWidth, H = img.naturalHeight;
            var rc = document.createElement("canvas");
            var renderer;
            try {
                renderer = new PhotoRenderer(rc, { preserve: true });
            } catch (e) {
                reject(e);
                return;
            }
            var s = Math.min(1, renderer.maxTexture / Math.max(W, H));
            var src = document.createElement("canvas");
            src.width = Math.max(1, Math.round(W * s));
            src.height = Math.max(1, Math.round(H * s));
            src.getContext("2d").drawImage(img, 0, 0, src.width, src.height);
            renderer.setSource(src);

            var full = self.outputSize();
            full.width = Math.min(full.width, renderer.maxTexture);
            full.height = Math.min(full.height, renderer.maxTexture);
            renderer.resize(full.width, full.height);
            var c = self.st.geo.crop;
            var scale = full.width / c.w;
            var view = { scale: scale, tx: -(c.cx - c.w / 2) * scale, ty: -(c.cy - c.h / 2) * scale };
            renderer.render(self.st, view, { clip: false });

            //copy out of WebGL, then step down by halves for a clean resize
            var out = document.createElement("canvas");
            out.width = full.width;
            out.height = full.height;
            var octx = out.getContext("2d");
            if (opts.mime === "image/jpeg") {
                octx.fillStyle = "#fff";
                octx.fillRect(0, 0, out.width, out.height);
            }
            octx.drawImage(rc, 0, 0);
            renderer.destroy();
            src.width = src.height = 0;

            var tw = Math.max(1, Math.round(opts.width || full.width));
            var th = Math.max(1, Math.round(opts.height || full.height));
            var cur = out;
            while (cur.width / 2 >= tw && cur.height / 2 >= th) {
                var half = document.createElement("canvas");
                half.width = Math.round(cur.width / 2);
                half.height = Math.round(cur.height / 2);
                var hctx = half.getContext("2d");
                hctx.imageSmoothingQuality = "high";
                hctx.drawImage(cur, 0, 0, half.width, half.height);
                cur = half;
            }
            if (cur.width !== tw || cur.height !== th) {
                var fin = document.createElement("canvas");
                fin.width = tw;
                fin.height = th;
                var fctx = fin.getContext("2d");
                fctx.imageSmoothingQuality = "high";
                if (opts.mime === "image/jpeg") {
                    fctx.fillStyle = "#fff";
                    fctx.fillRect(0, 0, tw, th);
                }
                fctx.drawImage(cur, 0, 0, tw, th);
                cur = fin;
            }
            cur.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error("The picture could not be encoded"));
                    return;
                }
                resolve(blob);
            }, opts.mime, opts.mime === "image/png" ? undefined : 0.92);
        });
    };

    /* ---------- keyboard ---------- */

    E.onKey = function (e) {
        if (!this.isOpen) {
            return false;
        }
        var mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === "z" || e.key === "Z")) {
            if (e.shiftKey) { this.redo(); } else { this.undo(); }
            return true;
        }
        if (mod && (e.key === "y" || e.key === "Y")) {
            this.redo();
            return true;
        }
        return false;
    };

    root.PhotoEditor = E;
})(this);
