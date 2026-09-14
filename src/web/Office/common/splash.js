/*
    ArozOS Office Suite - start-up splash
    =====================================
    What an app shows while it starts and opens its document, so the wait
    has a face and says what is happening ("Opening report.docx...",
    "Laying out the pages...").

    Two looks, chosen by where the app runs:

      window    inside a web desktop float window: the window starts small
                in the middle of the desktop, a coloured card with the app
                name, moving dots and the status line in the corner - and
                grows to its working size, still centred on the desktop,
                once the document is ready
      page      a full browser tab (or the mobile desktop, whose windows
                fill the screen): a plain page with the app icon in the
                middle and the status under it

    Include it as the FIRST element of <body>, so it covers the page before
    anything else has drawn:

        <script src="../common/splash.js" data-app="Docs"
                data-icon="../img/docs.svg" data-size="1080x700"></script>

    data-size is the window's working size in window mode. The splash brings
    its own styles: it paints before any stylesheet of the app has arrived,
    so an app should load its stylesheets and scripts after this tag (in
    <body>) rather than in <head>, where they would hold the first paint
    back. The framework (office.js) feeds it status text and
    calls done() when the document is on screen, when a dialog needs the
    person, or when something failed; a start that never finishes is let go
    after a while so the app is never locked behind it.

        OfficeSplash.status("Opening report.docx...")
        OfficeSplash.done()
        OfficeSplash.active()   -> true while it is showing
*/

var OfficeSplash = (function () {
    "use strict";

    var SPLASH_W = 400, SPLASH_H = 240;   // the window while it starts
    var GIVE_UP_MS = 60000;

    var script = document.currentScript;
    var appName = (script && script.getAttribute("data-app")) || "Office";
    var icon = (script && script.getAttribute("data-icon")) || "";
    var sizeAttr = ((script && script.getAttribute("data-size")) || "1080x700").split("x");
    var workW = parseInt(sizeAttr[0], 10) || 1080, workH = parseInt(sizeAttr[1], 10) || 700;

    var root = null, statusEl = null, finished = false, giveUp = null;

    // each app's colour for the window card
    var APP_COLOURS = { docs: "#1f6fbf", sheets: "#1e8a3c", slides: "#cf6c16" };

    var CSS = [
        ".of-splash {",
        "    position: fixed;",
        "    inset: 0;",
        "    z-index: 5000;",
        "    box-sizing: border-box;",
        "    font-family: \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif;",
        "    user-select: none;",
        "    -webkit-user-select: none;",
        "    transition: opacity 0.22s ease;",
        "}",
        ".of-splash.of-splash-out { opacity: 0; pointer-events: none; }",
        ".of-splash-mark { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; }",
        ".of-splash-window {",
        "    background: var(--of-splash-bg, #1f6fbf);",
        "    color: #ffffff;",
        "}",
        ".of-splash-brand {",
        "    position: absolute;",
        "    left: 12px;",
        "    top: 9px;",
        "    display: flex;",
        "    align-items: center;",
        "    gap: 6px;",
        "    font-size: 12px;",
        "    opacity: 0.95;",
        "}",
        ".of-splash-mid {",
        "    position: absolute;",
        "    left: 0;",
        "    right: 0;",
        "    top: 50%;",
        "    transform: translateY(-58%);",
        "    text-align: center;",
        "}",
        ".of-splash-name {",
        "    font-size: 46px;",
        "    font-weight: 300;",
        "    line-height: 1.1;",
        "    letter-spacing: 0.5px;",
        "}",
        ".of-splash-window .of-splash-status {",
        "    position: absolute;",
        "    left: 12px;",
        "    right: 12px;",
        "    bottom: 9px;",
        "    font-size: 12px;",
        "    white-space: nowrap;",
        "    overflow: hidden;",
        "    text-overflow: ellipsis;",
        "    opacity: 0.95;",
        "}",
        ".of-splash-dots {",
        "    position: relative;",
        "    width: 90px;",
        "    height: 5px;",
        "    margin: 12px auto 0;",
        "}",
        ".of-splash-dots span {",
        "    position: absolute;",
        "    top: 0;",
        "    left: 0;",
        "    width: 4px;",
        "    height: 4px;",
        "    border-radius: 50%;",
        "    background: currentColor;",
        "    opacity: 0;",
        "    animation: of-splash-dot 2.4s infinite cubic-bezier(0.4, 0, 0.6, 1);",
        "}",
        ".of-splash-dots span:nth-child(2) { animation-delay: 0.14s; }",
        ".of-splash-dots span:nth-child(3) { animation-delay: 0.28s; }",
        ".of-splash-dots span:nth-child(4) { animation-delay: 0.42s; }",
        ".of-splash-dots span:nth-child(5) { animation-delay: 0.56s; }",
        "@keyframes of-splash-dot {",
        "    0% { left: 0; opacity: 0; }",
        "    15% { opacity: 1; }",
        "    35% { left: 45%; }",
        "    65% { left: 55%; }",
        "    85% { opacity: 1; }",
        "    100% { left: 100%; opacity: 0; }",
        "}",
        ".of-splash-page {",
        "    background: #ffffff;",
        "    color: #5f6368;",
        "}",
        ".of-splash-page.of-splash-dark { background: #1f2328; color: #b8bec6; }",
        ".of-splash-center {",
        "    position: absolute;",
        "    left: 0;",
        "    right: 0;",
        "    top: 50%;",
        "    transform: translateY(-60%);",
        "    text-align: center;",
        "}",
        ".of-splash-icon {",
        "    width: 88px;",
        "    height: 88px;",
        "    display: block;",
        "    margin: 0 auto 22px;",
        "}",
        ".of-splash-page .of-splash-status {",
        "    font-size: 13px;",
        "    min-height: 1.4em;",
        "    padding: 0 16px;",
        "}",
        ".of-splash-foot {",
        "    position: absolute;",
        "    left: 0;",
        "    right: 0;",
        "    bottom: 22px;",
        "    display: flex;",
        "    align-items: center;",
        "    justify-content: center;",
        "    gap: 7px;",
        "    font-size: 13px;",
        "}",
        "@media (prefers-reduced-motion: reduce) {",
        "    .of-splash-dots span { animation: none; opacity: 0.8; }",
        "    .of-splash-dots span:nth-child(1) { left: 30%; }",
        "    .of-splash-dots span:nth-child(2) { left: 40%; }",
        "    .of-splash-dots span:nth-child(3) { left: 50%; }",
        "    .of-splash-dots span:nth-child(4) { left: 60%; }",
        "    .of-splash-dots span:nth-child(5) { left: 70%; }",
        "    .of-splash { transition: none; }",
        "}",
        "@media print {",
        "    .of-splash { display: none !important; }",
        "}"
    ].join("\n");

    function injectStyle() {
        var st = document.createElement("style");
        st.setAttribute("data-of-splash", "");
        var app = document.body ? document.body.getAttribute("data-officeapp") : "";
        st.textContent = ".of-splash{--of-splash-bg:" + (APP_COLOURS[app] || "#1f6fbf") + ";}\n" + CSS;
        (document.head || document.documentElement).appendChild(st);
    }

    // the web desktop's float window this page sits in, when it can be sized
    // (the mobile desktop has float windows too, but they fill the screen)
    function floatWindow() {
        try {
            var fe = window.frameElement;
            if (!fe || typeof fe.closest !== "function") return null;
            var fw = fe.closest(".floatWindow");
            if (!fw || !/px$/.test(fw.style.width || "")) return null;
            if (!window.parent || typeof window.parent.setFloatWindowSize !== "function") return null;
            return fw;
        } catch (e) {
            return null;   // not same-origin: not a desktop window
        }
    }

    /* The window is sized through ao_module.js once it has loaded; the
       splash comes up before it, and then asks the desktop directly with
       the same calls ao_module makes. */
    function setWindowSize(fw, w, h) {
        if (typeof ao_module_setWindowSize === "function") ao_module_setWindowSize(w, h);
        else window.parent.setFloatWindowSize(fw.getAttribute("windowId"), w, h);
    }
    function setResizable(fw, on) {
        if (typeof ao_module_setFixedWindowSize === "function") {
            if (on) ao_module_setResizableWindowSize();
            else ao_module_setFixedWindowSize();
        } else if (typeof window.parent.setFloatWindowResizePolicy === "function") {
            window.parent.setFloatWindowResizePolicy(fw.getAttribute("windowId"), !!on);
        }
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text) n.textContent = text;
        return n;
    }
    // the suite mark: four rounded squares
    function mark(cls) {
        var ns = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", cls);
        svg.setAttribute("aria-hidden", "true");
        [[3.5, 3.5], [13.5, 3.5], [3.5, 13.5], [13.5, 13.5]].forEach(function (p) {
            var r = document.createElementNS(ns, "rect");
            r.setAttribute("x", p[0]);
            r.setAttribute("y", p[1]);
            r.setAttribute("width", 7);
            r.setAttribute("height", 7);
            r.setAttribute("rx", 1.5);
            svg.appendChild(r);
        });
        return svg;
    }
    function dots() {
        var d = el("div", "of-splash-dots");
        for (var i = 0; i < 5; i++) d.appendChild(el("span"));
        return d;
    }

    function build() {
        injectStyle();
        var fw = floatWindow();
        root = el("div", "of-splash of-noprint " + (fw ? "of-splash-window" : "of-splash-page"));
        root.setAttribute("role", "status");
        root.setAttribute("aria-live", "polite");
        var dark = false;
        try { dark = localStorage.getItem("office_theme") === "dark"; } catch (e) { }
        if (dark) root.classList.add("of-splash-dark");

        if (fw) {
            var brand = el("div", "of-splash-brand");
            brand.appendChild(mark("of-splash-mark"));
            brand.appendChild(el("span", "", "ArozOS Office"));
            root.appendChild(brand);
            var mid = el("div", "of-splash-mid");
            mid.appendChild(el("div", "of-splash-name", appName));
            mid.appendChild(dots());
            root.appendChild(mid);
            statusEl = el("div", "of-splash-status", "Loading...");
            root.appendChild(statusEl);
            // start small, like a splash, in the middle of the desktop;
            // grown back in done()
            try {
                setResizable(fw, false);
                placeCentred(fw, SPLASH_W, SPLASH_H);
            } catch (e) { }
        } else {
            var center = el("div", "of-splash-center");
            if (icon) {
                var img = el("img", "of-splash-icon");
                img.src = icon;
                img.alt = "";
                center.appendChild(img);
            }
            statusEl = el("div", "of-splash-status", "Loading " + appName + "...");
            center.appendChild(statusEl);
            root.appendChild(center);
            var foot = el("div", "of-splash-foot");
            foot.appendChild(mark("of-splash-mark"));
            foot.appendChild(el("span", "", "ArozOS Office"));
            root.appendChild(foot);
        }
        document.body.insertBefore(root, document.body.firstChild);
        giveUp = setTimeout(done, GIVE_UP_MS);
    }

    function status(msg) {
        if (finished || !statusEl || !msg) return;
        statusEl.textContent = msg;
    }

    // grow the window to its working size around the splash's centre, kept
    // on the desktop
    function growWindow() {
        var fw = floatWindow();
        if (!fw) return;
        // the person already made it bigger (maximized it) while it started
        if (fw.offsetWidth > SPLASH_W + 40 || fw.offsetHeight > SPLASH_H + 40) {
            setResizable(fw, true);
            return;
        }
        try {
            placeCentred(fw, workW, workH);
            setResizable(fw, true);
        } catch (e) { }
    }

    /* placeCentred sizes the window and puts its centre on the centre of the
       desktop. A window of the same app opened a moment earlier sits exactly
       there already, so like the desktop's own placement this one steps
       30px down and right until the spot is free. */
    function placeCentred(fw, width, height) {
        var pw = window.parent.innerWidth, ph = window.parent.innerHeight;
        var w = Math.min(width, pw), h = Math.min(height, ph);
        var left = Math.max(0, Math.round((pw - w) / 2));
        var top = Math.max(0, Math.round((ph - h) / 2));
        var others = [];
        try {
            var all = window.parent.document.querySelectorAll(".floatWindow");
            for (var i = 0; i < all.length; i++) {
                if (all[i] !== fw) others.push(all[i]);
            }
        } catch (e) { }
        var taken = function (x, y) {
            for (var i = 0; i < others.length; i++) {
                if (Math.abs((parseFloat(others[i].style.left) || 0) - x) < 3 &&
                        Math.abs((parseFloat(others[i].style.top) || 0) - y) < 3) return true;
            }
            return false;
        };
        for (var step = 0; step < 20 && taken(left, top); step++) {
            if (left + 30 + w > pw || top + 30 + h > ph) break;
            left += 30;
            top += 30;
        }
        fw.style.left = left + "px";
        fw.style.top = top + "px";
        setWindowSize(fw, w, h);
    }

    function done() {
        if (finished || !root) return;
        finished = true;
        clearTimeout(giveUp);
        if (root.classList.contains("of-splash-window")) growWindow();
        root.classList.add("of-splash-out");
        var r = root;
        setTimeout(function () {
            if (r.parentNode) r.parentNode.removeChild(r);
        }, 260);
        // the layout changed size under everything that measured it
        try { window.dispatchEvent(new Event("resize")); } catch (e) { }
    }

    function active() {
        return !!root && !finished;
    }

    if (document.body) build();
    else document.addEventListener("DOMContentLoaded", build);

    return { status: status, done: done, active: active };
})();
