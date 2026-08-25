/*
    design.js

    The "Design" panel - site-wide styling rather than one element:
    theme colours, the two default fonts, page background and the web-font
    switch. Changing the accent colour recolours every element that currently
    uses the old accent, which is what makes a palette swap actually useful.
*/

var WBDesign = (function () {

    var bodyEl;

    var PRESETS = [
        { name: "Sunset",  accent: "#f97316", text: "#16181d", bg: "#ffffff" },
        { name: "Ember",   accent: "#ea580c", text: "#1c1917", bg: "#fffbf7" },
        { name: "Ocean",   accent: "#0ea5e9", text: "#0f172a", bg: "#ffffff" },
        { name: "Forest",  accent: "#16a34a", text: "#14201a", bg: "#ffffff" },
        { name: "Grape",   accent: "#7c3aed", text: "#1b1523", bg: "#ffffff" },
        { name: "Carbon",  accent: "#f97316", text: "#f5f5f5", bg: "#111214" }
    ];

    function init() {
        bodyEl = document.querySelector("#wb-panel-design .wb-panel-bd");
        render();
    }

    function theme() {
        var t = WBModel.get().settings.theme;
        if (!t.accent) { t.accent = "#f97316"; }
        return t;
    }

    function render() {
        if (!bodyEl) { return; }
        WBUI.clear(bodyEl);
        var t = theme();

        /* ---- presets ---- */
        var sec = section("Theme");
        var grid = WBUI.el("div", { class: "wb-swatch-grid" });
        PRESETS.forEach(function (p) {
            var sw = WBUI.el("button", {
                class: "wb-swatch" + (p.accent === t.accent && p.bg === t.background ? " active" : ""),
                type: "button",
                title: p.name,
                style: "background:linear-gradient(135deg," + p.accent + " 0 55%," + p.bg + " 55% 100%)"
            });
            sw.addEventListener("click", function () { applyPreset(p); });
            grid.appendChild(sw);
        });
        sec.appendChild(grid);
        bodyEl.appendChild(sec);

        /* ---- colours ---- */
        var colours = section("Colors");
        colours.appendChild(WBUI.field("Accent", WBUI.colorRow(t.accent, function (v) {
            recolorAccent(t.accent, v);
            t.accent = v;
            WBModel.commit("Change accent", "accent");
            WBApp.rerenderCanvas();
        })));
        colours.appendChild(WBUI.field("Page Background", WBUI.colorRow(t.background || "#ffffff", function (v) {
            t.background = v;
            applyToBody("backgroundColor", v);
        })));
        colours.appendChild(WBUI.field("Body Text", WBUI.colorRow(t.text || "#16181d", function (v) {
            t.text = v;
            applyToBody("color", v);
        })));
        bodyEl.appendChild(colours);

        /* ---- fonts ---- */
        var fonts = section("Typography");
        fonts.appendChild(WBUI.field("Body Font", fontSelect(t.bodyFont, function (v) {
            t.bodyFont = v;
            applyToBody("fontFamily", v);
        })));
        fonts.appendChild(WBUI.field("Heading Font", fontSelect(t.headingFont, function (v) {
            t.headingFont = v;
            applyToHeadings(v);
        })));
        fonts.appendChild(WBUI.el("div", { class: "wb-row" }, [
            WBUI.el("div", { class: "wb-row-text" }, [
                WBUI.el("div", { class: "wb-row-label", text: "Load web fonts" }),
                WBUI.el("div", { class: "wb-row-desc",
                    text: "Adds a Google Fonts stylesheet to the published pages for the fonts you used. Turn off to stay fully offline." })
            ]),
            WBUI.switchControl(WBModel.get().settings.webFonts, function (v) {
                WBModel.get().settings.webFonts = v;
                WBModel.commit("Toggle web fonts");
                WBApp.rerenderCanvas();
            })
        ]));
        bodyEl.appendChild(fonts);

        /* ---- page background ---- */
        var pageSec = section("This Page");
        var page = WBModel.activePage();
        pageSec.appendChild(WBUI.field("Background",
            WBUI.colorRow(page.root.styles.base.backgroundColor || "", function (v) {
                WBModel.setStyle(page.root.id, "backgroundColor", v, "base");
                WBModel.commit("Page background", "pagebg");
                WBCanvas.refreshStyles();
            })));
        pageSec.appendChild(WBUI.el("button", {
            class: "wb-btn wb-btn-block wb-btn-sm",
            type: "button",
            html: WBIcon("box", 13) + "<span>Select page body</span>",
            onclick: function () { WBApp.selectNode(WBModel.activePage().root.id); }
        }));
        bodyEl.appendChild(pageSec);

        bodyEl.appendChild(WBUI.el("div", {
            class: "wb-note",
            text: "Theme changes rewrite the styles already on your elements - they are undoable like any other edit."
        }));
    }

    function section(title) {
        return WBUI.el("div", { class: "wb-section" }, [
            WBUI.el("div", { class: "wb-section-title", text: title })
        ]);
    }

    function fontSelect(current, onChange) {
        var opts = WBFonts.map(function (f) { return { value: f.stack, label: f.name }; });
        var known = opts.some(function (o) { return o.value === current; });
        if (current && !known) { opts.unshift({ value: current, label: "Custom" }); }
        return WBUI.selectControl(opts, current, onChange);
    }

    function applyPreset(p) {
        var t = theme();
        recolorAccent(t.accent, p.accent);
        t.accent = p.accent;
        t.background = p.bg;
        t.text = p.text;
        for (var i = 0; i < WBModel.get().pages.length; i++) {
            var root = WBModel.get().pages[i].root;
            root.styles.base.backgroundColor = p.bg;
            root.styles.base.color = p.text;
        }
        WBModel.commit("Apply theme");
        WBApp.rerenderCanvas();
        render();
    }

    function applyToBody(key, value) {
        var pages = WBModel.get().pages;
        for (var i = 0; i < pages.length; i++) {
            pages[i].root.styles.base[key] = value;
        }
        WBModel.commit("Site " + key, "sitebody:" + key);
        WBCanvas.refreshStyles();
    }

    function applyToHeadings(value) {
        var pages = WBModel.get().pages;
        function walk(n) {
            if (n.type === "heading") { n.styles.base.fontFamily = value; }
            for (var i = 0; i < n.children.length; i++) { walk(n.children[i]); }
        }
        for (var p = 0; p < pages.length; p++) { walk(pages[p].root); }
        WBModel.commit("Heading font", "headingfont");
        WBApp.rerenderCanvas();
    }

    /* Swap one colour for another everywhere it is used as a style value. */
    function recolorAccent(from, to) {
        if (!from || !to || from.toLowerCase() === to.toLowerCase()) { return; }
        var keys = ["color", "backgroundColor", "borderColor", "borderTopColor",
                    "borderBottomColor", "outlineColor", "fill", "stroke", "border"];
        var pages = WBModel.get().pages;

        function fix(styleObj) {
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (typeof styleObj[k] === "string" &&
                    styleObj[k].toLowerCase().indexOf(from.toLowerCase()) >= 0) {
                    styleObj[k] = styleObj[k].replace(new RegExp(from, "ig"), to);
                }
            }
        }
        function walk(n) {
            fix(n.styles.base); fix(n.styles.tablet); fix(n.styles.mobile);
            for (var i = 0; i < n.children.length; i++) { walk(n.children[i]); }
        }
        for (var p = 0; p < pages.length; p++) { walk(pages[p].root); }
    }

    return { init: init, render: render };
})();
