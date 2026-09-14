/*
    ArozOS Office Suite - start-up splash
    =====================================
    What an app shows while it starts and opens its document, so the wait
    has a face and says what is happening ("Opening report.docx...",
    "Laying out the pages...").

    One look - a soft tinted card with the app's icon, "ArozOS <App>", a
    tagline, moving dots and the status line in the bottom-left corner -
    in two places:

      window    inside a web desktop float window: the window starts small
                in the middle of the desktop and grows to its working size,
                still centred on the desktop, once the document is ready
      page      a full browser tab (or the mobile desktop, whose windows
                fill the screen): the same card fills the page

    The card scales with the space it has. Docs, Sheets and Slides get their
    own colours and tagline; any other app (or none) gets the suite card:
    the ArozOS mark, "Create · Edit · Collaborate" and a progress bar.

    Include it as the FIRST element of <body>, so it covers the page before
    anything else has drawn:

        <script src="../common/splash.js" data-app="Docs" data-size="1080x700"></script>

    Its artwork is in img/splash/ next to this folder (the app icons, the
    ArozOS mark and the two corner shapes, which are masks painted in the
    app's colour); data-icon overrides the icon. data-size is the window's
    working size in window mode. The splash brings its own styles: it
    paints before any stylesheet of the app has arrived, so an app should
    load its stylesheets and scripts after this tag (in <body>) rather than
    in <head>, where they would hold the first paint back. The framework
    (office.js) feeds it status text and calls done() when the document is
    on screen, when a dialog needs the person, or when something failed; a
    start that never finishes is let go after a while so the app is never
    locked behind it.

        OfficeSplash.status("Opening report.docx...")
        OfficeSplash.done()
        OfficeSplash.active()   -> true while it is showing
*/

var OfficeSplash = (function () {
    "use strict";

    var SPLASH_W = 480, SPLASH_H = 320;   // the window while it starts
    var GIVE_UP_MS = 60000;

    var script = document.currentScript;
    var appName = (script && script.getAttribute("data-app")) || "Office";
    var sizeAttr = ((script && script.getAttribute("data-size")) || "1080x700").split("x");
    var workW = parseInt(sizeAttr[0], 10) || 1080, workH = parseInt(sizeAttr[1], 10) || 700;

    // img/splash/, resolved against this script so it works at any depth
    var ART = "../img/splash/";
    try { if (script && script.src) ART = new URL("../img/splash/", script.src).href; } catch (e) { }
    var icon = (script && script.getAttribute("data-icon")) || "";

    var root = null, statusEl = null, finished = false, giveUp = null;

    var APPS = {
        docs: ["Write, edit and collaborate", "with ease."],
        sheets: ["Create powerful spreadsheets, analyse data,", "and turn your ideas into insights."],
        slides: ["Design beautiful presentations,", "share your ideas, make an impact."]
    };

    /* Sizes are in em against a 600x375 reference card with 16px type; the
       root font size scales that reference to the space available. */
    var CSS = [
        ".of-splash {",
        "    --sp-bg: linear-gradient(160deg, #f6f8fe 0%, #eef2fb 100%);",
        "    --sp-top: linear-gradient(225deg, #8d9af3 0%, #b9c3fa 45%, #e4e8fd 100%);",
        "    --sp-bottom: linear-gradient(180deg, #d6e2fb 0%, #c9d9fa 100%);",
        "    --sp-accent: #2f74e0;",
        "    --sp-accent-soft: rgba(47, 116, 224, 0.3);",
        "    --sp-ink: #20252c;",
        "    --sp-sub: #6b7079;",
        "    --sp-status: #858a93;",
        "    --sp-track: #dce3f0;",
        "    --sp-shape-alpha: 1;",
        "    position: fixed;",
        "    inset: 0;",
        "    z-index: 5000;",
        "    box-sizing: border-box;",
        "    overflow: hidden;",
        "    background: var(--sp-bg);",
        "    color: var(--sp-ink);",
        "    font-family: \"Segoe UI Variable Display\", \"Segoe UI\", -apple-system, BlinkMacSystemFont, \"Helvetica Neue\", Roboto, Arial, sans-serif;",
        "    font-size: clamp(10px, min(2.667vw, 4.267vh), 17px);",
        "    user-select: none;",
        "    -webkit-user-select: none;",
        "    transition: opacity 0.22s ease;",
        "}",
        ".of-splash *, .of-splash *::before { box-sizing: border-box; }",
        ".of-splash.of-splash-out { opacity: 0; pointer-events: none; }",
        ".of-splash-docs {",
        "    --sp-bg: linear-gradient(160deg, #f5f8fe 0%, #edf3fd 55%, #e6effc 100%);",
        "    --sp-top: linear-gradient(225deg, #b5d0fa 0%, #cfe0fc 60%, #e2ecfd 100%);",
        "    --sp-bottom: linear-gradient(180deg, #d3e3fc 0%, #c6dbfa 100%);",
        "    --sp-accent: #2f7be6;",
        "    --sp-accent-soft: rgba(47, 123, 230, 0.3);",
        "}",
        ".of-splash-sheets {",
        "    --sp-bg: linear-gradient(160deg, #f8fcf8 0%, #f1f9f2 55%, #e8f5ea 100%);",
        "    --sp-top: linear-gradient(225deg, #b9e5bf 0%, #cdeed1 60%, #e1f4e3 100%);",
        "    --sp-bottom: linear-gradient(180deg, #d2eed5 0%, #c3e8c8 100%);",
        "    --sp-accent: #2e9d45;",
        "    --sp-accent-soft: rgba(46, 157, 69, 0.32);",
        "}",
        ".of-splash-slides {",
        "    --sp-bg: linear-gradient(160deg, #fffcf7 0%, #fef7ec 55%, #fdf1e0 100%);",
        "    --sp-top: linear-gradient(225deg, #fcd9ab 0%, #fde6c8 60%, #fef1df 100%);",
        "    --sp-bottom: linear-gradient(180deg, #fde3c2 0%, #fbd9b0 100%);",
        "    --sp-accent: #f28a1c;",
        "    --sp-accent-soft: rgba(242, 138, 28, 0.32);",
        "}",
        ".of-splash.of-splash-dark {",
        "    --sp-bg: linear-gradient(160deg, #1f232a 0%, #1a1e24 100%);",
        "    --sp-ink: #e6e9ee;",
        "    --sp-sub: #a4abb5;",
        "    --sp-status: #8a919b;",
        "    --sp-track: #353b45;",
        "    --sp-shape-alpha: 0.16;",
        "}",
        ".of-splash-shape {",
        "    position: absolute;",
        "    pointer-events: none;",
        "    opacity: var(--sp-shape-alpha);",
        "    -webkit-mask-repeat: no-repeat;",
        "    mask-repeat: no-repeat;",
        "    -webkit-mask-size: 100% 100%;",
        "    mask-size: 100% 100%;",
        "}",
        ".of-splash-shape-top {",
        "    top: 0;",
        "    right: 0;",
        "    width: min(29.07vw, 46.51vh);",
        "    height: min(29.07vw, 46.51vh);",
        "    background: var(--sp-top);",
        "}",
        ".of-splash-shape-bottom {",
        "    left: 0;",
        "    bottom: 0;",
        "    width: min(43.6vw, 69.77vh);",
        "    height: min(23.26vw, 37.21vh);",
        "    background: var(--sp-bottom);",
        "}",
        ".of-splash-dark .of-splash-shape { background: var(--sp-accent); }",
        ".of-splash-center {",
        "    position: absolute;",
        "    left: 0;",
        "    right: 0;",
        "    top: 50%;",
        "    transform: translateY(-50%);",
        "    padding: 0 1.2em;",
        "    text-align: center;",
        "}",
        ".of-splash-icon {",
        "    display: block;",
        "    width: 4.6em;",
        "    height: 5.56em;",
        "    margin: 0 auto 0.75em;",
        "    filter: drop-shadow(0 0.35em 0.6em var(--sp-accent-soft));",
        "}",
        ".of-splash-title {",
        "    font-size: 1.75em;",
        "    font-weight: 400;",
        "    line-height: 1.15;",
        "    letter-spacing: -0.01em;",
        "    white-space: nowrap;",
        "}",
        ".of-splash-title b { font-weight: 400; color: var(--sp-accent); }",
        ".of-splash-tagline {",
        "    margin-top: 0.4em;",
        "    font-size: 0.88em;",
        "    line-height: 1.45;",
        "    color: var(--sp-sub);",
        "}",
        ".of-splash-tagline span { display: block; }",
        ".of-splash-dots {",
        "    display: flex;",
        "    justify-content: center;",
        "    gap: 0.55em;",
        "    margin-top: 1em;",
        "}",
        ".of-splash-dots span {",
        "    width: 0.46em;",
        "    height: 0.46em;",
        "    border-radius: 50%;",
        "    background: var(--sp-accent);",
        "    opacity: 0.3;",
        "    animation: of-splash-dot 1.35s infinite ease-in-out;",
        "}",
        ".of-splash-dots span:nth-child(2) { animation-delay: 0.18s; }",
        ".of-splash-dots span:nth-child(3) { animation-delay: 0.36s; }",
        "@keyframes of-splash-dot {",
        "    0%, 70%, 100% { opacity: 0.3; transform: scale(0.9); }",
        "    30% { opacity: 1; transform: scale(1); }",
        "}",
        ".of-splash-brand {",
        "    display: flex;",
        "    align-items: center;",
        "    justify-content: center;",
        "    gap: 0.85em;",
        "}",
        ".of-splash-logo { width: 3.5em; height: 3.5em; display: block; border-radius: 22%; }",
        ".of-splash-dark .of-splash-logo { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14); }",
        ".of-splash-wordmark {",
        "    font-size: 2.6em;",
        "    font-weight: 500;",
        "    line-height: 1;",
        "    letter-spacing: -0.015em;",
        "}",
        ".of-splash-motto {",
        "    margin-top: 0.55em;",
        "    font-size: 1em;",
        "    color: #8a93a3;",
        "    word-spacing: 0.2em;",
        "}",
        ".of-splash-dark .of-splash-motto { color: var(--sp-sub); }",
        ".of-splash-bar {",
        "    position: relative;",
        "    width: 9.75em;",
        "    height: 0.3em;",
        "    margin: 1.9em auto 0;",
        "    border-radius: 1em;",
        "    background: var(--sp-track);",
        "    overflow: hidden;",
        "}",
        ".of-splash-bar::before {",
        "    content: \"\";",
        "    position: absolute;",
        "    top: 0;",
        "    bottom: 0;",
        "    left: 0;",
        "    width: 64%;",
        "    border-radius: inherit;",
        "    background: var(--sp-accent);",
        "    animation: of-splash-bar 2s infinite ease-in-out;",
        "}",
        "@keyframes of-splash-bar {",
        "    0% { left: 0; width: 0; }",
        "    55% { left: 0; width: 64%; }",
        "    100% { left: 100%; width: 10%; }",
        "}",
        ".of-splash-status {",
        "    position: absolute;",
        "    left: 1.3em;",
        "    right: 1.3em;",
        "    bottom: 1.1em;",
        "    font-size: max(10px, 0.7em);",
        "    color: var(--sp-status);",
        "    white-space: nowrap;",
        "    overflow: hidden;",
        "    text-overflow: ellipsis;",
        "}",
        "@media (prefers-reduced-motion: reduce) {",
        "    .of-splash-dots span { animation: none; opacity: 0.8; }",
        "    .of-splash-bar::before { animation: none; }",
        "    .of-splash { transition: none; }",
        "}",
        "@media print {",
        "    .of-splash { display: none !important; }",
        "}"
    ].join("\n");

    function injectStyle() {
        var st = document.createElement("style");
        st.setAttribute("data-of-splash", "");
        var masks = ".of-splash-shape-top{-webkit-mask-image:url(\"" + ART + "shape_top.svg\");mask-image:url(\"" + ART + "shape_top.svg\");}\n" +
            ".of-splash-shape-bottom{-webkit-mask-image:url(\"" + ART + "shape_bottom.svg\");mask-image:url(\"" + ART + "shape_bottom.svg\");}\n";
        st.textContent = CSS + "\n" + masks;
        (document.head || document.documentElement).appendChild(st);
    }

    // which app this is: the page's data-officeapp, else the data-app name
    function appKey() {
        var key = (document.body && document.body.getAttribute("data-officeapp")) || appName;
        key = String(key || "").toLowerCase();
        return APPS[key] ? key : "";
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
    function img(cls, src) {
        var n = el("img", cls);
        n.src = src;
        n.alt = "";
        n.draggable = false;
        return n;
    }

    // Docs / Sheets / Slides: icon, "ArozOS <App>", tagline, dots
    function appCard(key) {
        var center = el("div", "of-splash-center");
        center.appendChild(img("of-splash-icon", icon || (ART + key + ".svg")));
        var title = el("div", "of-splash-title", "ArozOS ");
        title.appendChild(el("b", "", appName));
        center.appendChild(title);
        var tagline = el("div", "of-splash-tagline");
        APPS[key].forEach(function (line) { tagline.appendChild(el("span", "", line)); });
        center.appendChild(tagline);
        var d = el("div", "of-splash-dots");
        for (var i = 0; i < 3; i++) d.appendChild(el("span"));
        center.appendChild(d);
        return center;
    }

    // any other app: the ArozOS mark, the motto and a progress bar
    function suiteCard() {
        var center = el("div", "of-splash-center");
        var brand = el("div", "of-splash-brand");
        brand.appendChild(img("of-splash-logo", icon || (ART + "arozos.svg")));
        brand.appendChild(el("div", "of-splash-wordmark", "ArozOS"));
        center.appendChild(brand);
        center.appendChild(el("div", "of-splash-motto", "Create · Edit · Collaborate"));
        center.appendChild(el("div", "of-splash-bar"));
        return center;
    }

    function build() {
        injectStyle();
        var fw = floatWindow();
        var key = appKey();
        root = el("div", "of-splash of-noprint " + (fw ? "of-splash-window" : "of-splash-page") +
            (key ? " of-splash-" + key : ""));
        root.setAttribute("role", "status");
        root.setAttribute("aria-live", "polite");
        var dark = false;
        try { dark = localStorage.getItem("office_theme") === "dark"; } catch (e) { }
        if (dark) root.classList.add("of-splash-dark");

        root.appendChild(el("div", "of-splash-shape of-splash-shape-top"));
        root.appendChild(el("div", "of-splash-shape of-splash-shape-bottom"));
        root.appendChild(key ? appCard(key) : suiteCard());
        statusEl = el("div", "of-splash-status", "Loading your workspace...");
        root.appendChild(statusEl);

        if (fw) {
            // start small, like a splash, in the middle of the desktop;
            // grown back in done()
            try {
                setResizable(fw, false);
                placeCentred(fw, SPLASH_W, SPLASH_H);
            } catch (e) { }
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
