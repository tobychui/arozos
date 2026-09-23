/*
    inspector.js

    The right dock. Three tabs:

      Content   element-specific fields from the schema, plus the alignment and
                typography controls that are used most often
      Design    layout, size, background, border, shadow
      Advanced  id / classes / attributes / custom CSS / per-breakpoint reset

    Style edits are written to the breakpoint currently selected in the top bar
    (base / tablet / mobile). Values shown are the *effective* value for that
    breakpoint - i.e. with the desktop value inherited - while the small dot on
    a group header marks that the group carries an override of its own here.
*/

var WBInspector = (function () {

    var pathEl, nameEl, idEl, bodyEl, emptyEl, actionsEl, hintEl;
    var activeTab = "content";
    var currentId = null;

    function init() {
        pathEl = document.getElementById("wb-insp-path");
        nameEl = document.getElementById("wb-insp-name");
        idEl = document.getElementById("wb-insp-id");
        bodyEl = document.getElementById("wb-insp-body");
        emptyEl = document.getElementById("wb-insp-empty");
        actionsEl = document.getElementById("wb-insp-actions");
        hintEl = document.getElementById("wb-bp-hint");

        var tabs = document.querySelectorAll("#wb-insp-tabs .wb-tab");
        for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
                tab.addEventListener("click", function () {
                    activeTab = tab.getAttribute("data-tab");
                    render();
                });
            })(tabs[i]);
        }

        actionsEl.appendChild(WBUI.iconBtn("duplicate", "Duplicate (Ctrl+D)", function () {
            if (currentId) { WBApp.duplicateNode(currentId); }
        }, "wb-icon-btn", 15));
        actionsEl.appendChild(WBUI.iconBtn("copy", "Copy styles", function () {
            if (currentId) { WBApp.copyStyles(currentId); }
        }, "wb-icon-btn", 15));
        actionsEl.appendChild(WBUI.iconBtn("trash", "Delete (Del)", function () {
            if (currentId) { WBApp.deleteNode(currentId); }
        }, "wb-icon-btn", 15));
    }

    /* ------------------------------------------------------- plumbing -- */

    function bp() { return WBCanvas.getDevice(); }

    function node() { return currentId ? WBModel.findNode(currentId) : null; }

    function styleVal(key, fallback) {
        var n = node();
        var v = WBModel.effectiveStyle(n, key, bp());
        return v === undefined ? (fallback === undefined ? "" : fallback) : v;
    }

    function setStyle(key, value, coalesceKey) {
        if (!currentId) { return; }
        WBModel.setStyle(currentId, key, value, bp());
        WBModel.commit("Style: " + key, coalesceKey || ("style:" + currentId + ":" + key + ":" + bp()));
        WBCanvas.refreshStyles();
        markGroups();
    }

    function setStyles(obj) {
        if (!currentId) { return; }
        WBModel.setStyles(currentId, obj, bp());
        WBModel.commit("Style change");
        WBCanvas.refreshStyles();
        markGroups();
    }

    function setProp(key, value, opts) {
        if (!currentId) { return; }
        opts = opts || {};
        WBModel.setProp(currentId, key, value);
        WBModel.commit("Set " + key, opts.coalesce === false ? null : ("prop:" + currentId + ":" + key));
        if (opts.structural) { WBApp.rerenderCanvas(); }
        else { WBCanvas.refreshNode(currentId); }
    }

    function ownsAny(keys) {
        var n = node();
        if (!n) { return false; }
        for (var i = 0; i < keys.length; i++) {
            if (WBModel.hasOwnStyle(n, keys[i], bp())) { return true; }
        }
        return false;
    }

    var groupKeyMap = [];

    function markGroups() {
        for (var i = 0; i < groupKeyMap.length; i++) {
            var g = groupKeyMap[i];
            if (g.el && g.el.parentNode) {
                g.el.classList.toggle("modified", ownsAny(g.keys));
            }
        }
    }

    /* ---------------------------------------------------------- render -- */

    function setTarget(id) {
        currentId = id;
        render();
    }

    function render() {
        var n = node();
        groupKeyMap = [];

        if (!n) {
            emptyEl.classList.remove("wb-hidden");
            bodyEl.classList.add("wb-hidden");
            document.getElementById("wb-insp-head").classList.add("wb-hidden");
            document.getElementById("wb-insp-tabs").classList.add("wb-hidden");
            WBUI.clear(pathEl);
            return;
        }
        emptyEl.classList.add("wb-hidden");
        bodyEl.classList.remove("wb-hidden");
        document.getElementById("wb-insp-head").classList.remove("wb-hidden");
        document.getElementById("wb-insp-tabs").classList.remove("wb-hidden");

        renderPath(n);
        nameEl.textContent = WBModel.displayName(n);
        idEl.textContent = n.domId ? "#" + n.domId : "." + "wb-" + n.id;

        var tabs = document.querySelectorAll("#wb-insp-tabs .wb-tab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === activeTab);
        }

        renderHint();
        WBUI.clear(bodyEl);
        var page = WBUI.el("div", { class: "wb-insp-tabpage active" });
        if (activeTab === "content") { renderContent(page, n); }
        else if (activeTab === "design") { renderDesign(page, n); }
        else { renderAdvanced(page, n); }
        bodyEl.appendChild(page);
        markGroups();
    }

    function renderPath(n) {
        WBUI.clear(pathEl);
        var chain = WBModel.pathTo(n.id) || [];
        chain.forEach(function (item, i) {
            if (i) { pathEl.appendChild(WBUI.el("span", { class: "wb-crumb-sep", html: WBIcon("caret-right", 9) })); }
            pathEl.appendChild(WBUI.el("button", {
                class: "wb-crumb" + (i === chain.length - 1 ? " current" : ""),
                type: "button",
                text: WBModel.displayName(item),
                onclick: function () { WBApp.selectNode(item.id); }
            }));
        });
    }

    function renderHint() {
        var device = bp();
        if (device === "base") {
            hintEl.classList.remove("show");
            return;
        }
        var name = device === "tablet" ? "Tablet" : "Mobile";
        WBUI.clear(hintEl);
        hintEl.innerHTML = WBIcon("info", 14);
        hintEl.appendChild(WBUI.el("span", {
            text: "Editing the " + name + " breakpoint. Changes apply to " + name +
                  " and narrower only; Desktop stays as it is."
        }));
        hintEl.classList.add("show");
    }

    /* --------------------------------------------------- content tab -- */

    function renderContent(page, n) {
        page.appendChild(hintClone());

        var def = wbDef(n.type);

        /* element specific fields straight from the schema */
        (def.fields || []).forEach(function (f) {
            var control = buildField(f, n);
            if (control) { page.appendChild(WBUI.field(f.label, control)); }
        });
        if (def.help) {
            page.appendChild(WBUI.el("div", { class: "wb-note", text: def.help }));
        }
        if (n.type === "body") {
            page.appendChild(WBUI.el("div", {
                class: "wb-note",
                text: "This is the page root. Its background and default font are inherited by everything on the page."
            }));
        }

        /* alignment */
        page.appendChild(block("Alignment", [
            WBUI.segment([
                { value: "left", icon: "align-left", title: "Left" },
                { value: "center", icon: "align-center", title: "Center" },
                { value: "right", icon: "align-right", title: "Right" },
                { value: "justify", icon: "align-just", title: "Justify" }
            ], styleVal("textAlign", "left"), function (v) { setStyle("textAlign", v); })
        ], true));

        /* typography */
        page.appendChild(block("Typography", [
            WBUI.field("Font", fontSelect()),
            WBUI.field("Weight", WBUI.selectControl(
                [{ value: "", label: "Inherit" }].concat(WBFontWeights),
                styleVal("fontWeight"),
                function (v) { setStyle("fontWeight", v); }
            )),
            WBUI.field("Size", WBUI.sliderRow(styleVal("fontSize", "16px"), function (v) {
                setStyle("fontSize", v);
            }, { min: 8, max: 140 })),
            WBUI.field("Line Height", WBUI.textInput(styleVal("lineHeight", ""), function (v) {
                setStyle("lineHeight", v);
            }, { placeholder: "1.5" })),
            WBUI.field("Color", WBUI.colorRow(styleVal("color", ""), function (v) {
                setStyle("color", v);
            }))
        ]));

        /* collapsible groups, matching the mockup order */
        page.appendChild(makeGroup("Spacing", spacingBody(), ["margin", "marginTop", "marginRight",
            "marginBottom", "marginLeft", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]));
        page.appendChild(makeGroup("Responsive", responsiveBody(n), []));
        page.appendChild(makeGroup("Effects", effectsBody(), ["opacity", "boxShadow", "borderRadius",
            "transform", "transition", "filter"]));
    }

    function hintClone() {
        /* the hint element itself lives outside the tab pages; this keeps the
           spacing right when it is visible */
        return WBUI.el("div", { style: "height:0" });
    }

    function fontSelect() {
        var current = styleVal("fontFamily", "");
        var opts = [{ value: "", label: "Inherit" }];
        WBFonts.forEach(function (f) { opts.push({ value: f.stack, label: f.name }); });
        var found = false;
        for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === current) { found = true; }
        }
        if (current && !found) { opts.push({ value: current, label: "Custom" }); }
        return WBUI.selectControl(opts, current, function (v) {
            setStyle("fontFamily", v);
            if (v) { WBApp.rerenderCanvas({ soft: true }); }
        });
    }

    function block(title, children, tight) {
        var b = WBUI.el("div", { class: "wb-insp-block" });
        b.appendChild(WBUI.el("div", { class: "wb-insp-block-title", text: title }));
        children.forEach(function (c) { b.appendChild(c); });
        if (tight) { b.style.paddingBottom = "12px"; }
        return b;
    }

    function makeGroup(title, contentNode, keys) {
        var g = WBUI.group(title, contentNode, false, ownsAny(keys));
        groupKeyMap.push({ el: g, keys: keys });
        return g;
    }

    /* four-box margin / padding editor */
    function boxEditor(prefix) {
        var sides = [
            { key: prefix + "Top", label: "Top" },
            { key: prefix + "Right", label: "Right" },
            { key: prefix + "Bottom", label: "Bottom" },
            { key: prefix + "Left", label: "Left" }
        ];
        var grid = WBUI.el("div", { class: "wb-grid-4" });
        sides.forEach(function (s) {
            var input = WBUI.el("input", {
                class: "wb-box-input",
                type: "text",
                value: styleVal(s.key, ""),
                placeholder: "-"
            });
            input.addEventListener("input", function () {
                var v = input.value.trim();
                if (v !== "" && /^-?[\d.]+$/.test(v)) { v = v + "px"; }
                setStyle(s.key, v);
            });
            grid.appendChild(WBUI.el("div", { class: "wb-field" }, [
                input,
                WBUI.el("div", { class: "wb-mini-label", text: s.label })
            ]));
        });
        return grid;
    }

    function spacingBody() {
        var wrap = WBUI.el("div");
        var m = WBUI.el("div", { class: "wb-spacing-box" }, [
            WBUI.el("div", { class: "wb-spacing-tag", text: "Margin (outside)" }),
            boxEditor("margin")
        ]);
        var p = WBUI.el("div", { class: "wb-spacing-box" }, [
            WBUI.el("div", { class: "wb-spacing-tag", text: "Padding (inside)" }),
            boxEditor("padding")
        ]);
        wrap.appendChild(m);
        wrap.appendChild(p);
        return wrap;
    }

    function responsiveBody(n) {
        var wrap = WBUI.el("div");

        var vis = WBUI.el("div", { class: "wb-segment" });
        WBBreakpoints.forEach(function (b) {
            var on = n.visible[b.key] !== false;
            var btn = WBUI.el("button", {
                type: "button",
                class: on ? "active" : "",
                title: (on ? "Visible on " : "Hidden on ") + b.name,
                html: WBIcon(b.icon, 14)
            });
            btn.addEventListener("click", function () {
                n.visible[b.key] = !(n.visible[b.key] !== false);
                WBModel.commit("Change visibility");
                WBCanvas.refreshStyles();
                btn.classList.toggle("active", n.visible[b.key] !== false);
                WBLayers.render();
            });
            vis.appendChild(btn);
        });
        wrap.appendChild(WBUI.field("Visible On", vis));

        var counts = WBBreakpoints.map(function (b) {
            return b.name + ": " + Object.keys(n.styles[b.key] || {}).length;
        }).join("   ");
        wrap.appendChild(WBUI.el("div", { class: "wb-note", text: "Style overrides   " + counts }));

        if (bp() !== "base") {
            wrap.appendChild(WBUI.el("button", {
                class: "wb-btn wb-btn-block wb-btn-sm",
                type: "button",
                style: "margin-top:10px",
                html: WBIcon("undo", 13) + "<span>Clear " +
                      (bp() === "tablet" ? "Tablet" : "Mobile") + " overrides</span>",
                onclick: function () {
                    n.styles[bp()] = {};
                    WBModel.commit("Clear breakpoint overrides");
                    WBCanvas.refreshStyles();
                    render();
                }
            }));
        }
        return wrap;
    }

    function effectsBody() {
        var wrap = WBUI.el("div");

        wrap.appendChild(WBUI.field("Opacity", WBUI.sliderRow(styleVal("opacity", "1"), function (v) {
            setStyle("opacity", WBUI.parseLength(v).num);
        }, { min: 0, max: 1, step: 0.05, units: [""] })));

        wrap.appendChild(WBUI.field("Corner Radius", WBUI.sliderRow(styleVal("borderRadius", "0px"), function (v) {
            setStyle("borderRadius", v);
        }, { min: 0, max: 80 })));

        var shadows = [
            { value: "", label: "None" },
            { value: "0 1px 2px rgba(16,24,40,0.06)", label: "Subtle" },
            { value: "0 4px 12px rgba(16,24,40,0.10)", label: "Soft" },
            { value: "0 10px 28px rgba(16,24,40,0.14)", label: "Medium" },
            { value: "0 20px 48px rgba(16,24,40,0.20)", label: "Large" }
        ];
        var current = styleVal("boxShadow", "");
        var known = shadows.some(function (s) { return s.value === current; });
        if (current && !known) { shadows.push({ value: current, label: "Custom" }); }
        wrap.appendChild(WBUI.field("Shadow", WBUI.selectControl(shadows, current, function (v) {
            setStyle("boxShadow", v);
        })));

        wrap.appendChild(WBUI.field("Transform", WBUI.textInput(styleVal("transform", ""), function (v) {
            setStyle("transform", v);
        }, { mono: true, placeholder: "rotate(-2deg) scale(1.02)" })));

        wrap.appendChild(WBUI.field("Transition", WBUI.textInput(styleVal("transition", ""), function (v) {
            setStyle("transition", v);
        }, { mono: true, placeholder: "all .2s ease" })));

        return wrap;
    }

    /* ---------------------------------------------------- design tab -- */

    function renderDesign(page, n) {
        page.appendChild(makeGroupOpen("Layout", layoutBody(),
            ["display", "flexDirection", "justifyContent", "alignItems", "gap",
             "gridTemplateColumns", "position", "top", "left", "zIndex"]));
        page.appendChild(makeGroupOpen("Size", sizeBody(),
            ["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "objectFit", "overflow"]));
        page.appendChild(makeGroup("Background", backgroundBody(),
            ["backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat"]));
        page.appendChild(makeGroup("Border", borderBody(),
            ["border", "borderWidth", "borderStyle", "borderColor", "borderRadius",
             "borderTop", "borderBottom"]));
        page.appendChild(makeGroup("Spacing", spacingBody(),
            ["margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
             "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]));
    }

    function makeGroupOpen(title, contentNode, keys) {
        var g = WBUI.group(title, contentNode, true, ownsAny(keys));
        groupKeyMap.push({ el: g, keys: keys });
        return g;
    }

    function layoutBody() {
        var wrap = WBUI.el("div");
        var display = styleVal("display", "block");

        wrap.appendChild(WBUI.field("Display", WBUI.selectControl([
            { value: "block", label: "Block" },
            { value: "flex", label: "Flex" },
            { value: "grid", label: "Grid" },
            { value: "inline-block", label: "Inline block" },
            { value: "inline-flex", label: "Inline flex" },
            { value: "inline", label: "Inline" },
            { value: "none", label: "None (hidden)" }
        ], display, function (v) { setStyle("display", v); render(); })));

        if (display === "flex" || display === "inline-flex") {
            wrap.appendChild(WBUI.field("Direction", WBUI.segment([
                { value: "row", label: "Row" },
                { value: "column", label: "Column" }
            ], styleVal("flexDirection", "row"), function (v) { setStyle("flexDirection", v); })));

            wrap.appendChild(WBUI.field("Justify", WBUI.selectControl([
                { value: "flex-start", label: "Start" },
                { value: "center", label: "Center" },
                { value: "flex-end", label: "End" },
                { value: "space-between", label: "Space between" },
                { value: "space-around", label: "Space around" }
            ], styleVal("justifyContent", "flex-start"), function (v) { setStyle("justifyContent", v); })));

            wrap.appendChild(WBUI.field("Align", WBUI.selectControl([
                { value: "stretch", label: "Stretch" },
                { value: "flex-start", label: "Start" },
                { value: "center", label: "Center" },
                { value: "flex-end", label: "End" },
                { value: "baseline", label: "Baseline" }
            ], styleVal("alignItems", "stretch"), function (v) { setStyle("alignItems", v); })));

            wrap.appendChild(WBUI.field("Wrap", WBUI.segment([
                { value: "nowrap", label: "No wrap" },
                { value: "wrap", label: "Wrap" }
            ], styleVal("flexWrap", "nowrap"), function (v) { setStyle("flexWrap", v); })));
        }

        if (display === "grid") {
            wrap.appendChild(WBUI.field("Columns", WBUI.textInput(
                styleVal("gridTemplateColumns", ""), function (v) {
                    setStyle("gridTemplateColumns", v);
                }, { mono: true, placeholder: "repeat(3, 1fr)" })));
        }

        if (display === "flex" || display === "inline-flex" || display === "grid") {
            wrap.appendChild(WBUI.field("Gap", WBUI.sliderRow(styleVal("gap", "0px"), function (v) {
                setStyle("gap", v);
            }, { min: 0, max: 120 })));
        }

        wrap.appendChild(WBUI.field("Position", WBUI.selectControl([
            { value: "static", label: "Static" },
            { value: "relative", label: "Relative" },
            { value: "absolute", label: "Absolute" },
            { value: "fixed", label: "Fixed" },
            { value: "sticky", label: "Sticky" }
        ], styleVal("position", "static"), function (v) { setStyle("position", v); render(); })));

        if (styleVal("position", "static") !== "static") {
            var g = WBUI.el("div", { class: "wb-grid-2" });
            ["top", "left", "bottom", "right"].forEach(function (k) {
                g.appendChild(WBUI.field(k.charAt(0).toUpperCase() + k.slice(1),
                    WBUI.textInput(styleVal(k, ""), function (v) { setStyle(k, v); }, { placeholder: "auto" })));
            });
            wrap.appendChild(g);
            wrap.appendChild(WBUI.field("Z-Index", WBUI.textInput(styleVal("zIndex", ""), function (v) {
                setStyle("zIndex", v);
            }, { type: "number" })));
        }
        return wrap;
    }

    function sizeBody() {
        var wrap = WBUI.el("div");
        var grid = WBUI.el("div", { class: "wb-grid-2" });
        [
            ["width", "Width"], ["height", "Height"],
            ["minWidth", "Min W"], ["minHeight", "Min H"],
            ["maxWidth", "Max W"], ["maxHeight", "Max H"]
        ].forEach(function (pair) {
            grid.appendChild(WBUI.field(pair[1], WBUI.unitInput(styleVal(pair[0], ""), function (v) {
                setStyle(pair[0], v);
            })));
        });
        wrap.appendChild(grid);

        wrap.appendChild(WBUI.el("div", { style: "height:12px" }));
        wrap.appendChild(WBUI.field("Overflow", WBUI.selectControl([
            { value: "visible", label: "Visible" },
            { value: "hidden", label: "Hidden" },
            { value: "auto", label: "Auto (scroll)" }
        ], styleVal("overflow", "visible"), function (v) { setStyle("overflow", v); })));

        if (node().type === "image" || node().type === "video") {
            wrap.appendChild(WBUI.field("Fit", WBUI.selectControl([
                { value: "", label: "Default" },
                { value: "cover", label: "Cover" },
                { value: "contain", label: "Contain" },
                { value: "fill", label: "Fill" }
            ], styleVal("objectFit", ""), function (v) { setStyle("objectFit", v); })));
        }
        return wrap;
    }

    function backgroundBody() {
        var wrap = WBUI.el("div");
        wrap.appendChild(WBUI.field("Background Color",
            WBUI.colorRow(styleVal("backgroundColor", ""), function (v) { setStyle("backgroundColor", v); })));

        var bgImage = styleVal("backgroundImage", "");
        var currentPath = "";
        var m = String(bgImage).match(/url\(["']?(.*?)["']?\)/);
        if (m) { currentPath = m[1]; }

        wrap.appendChild(WBUI.field("Background Image", imagePicker(currentPath, function (vpath) {
            if (!vpath) { setStyle("backgroundImage", ""); return; }
            /* publishing finds this asset by scanning style values for the
               media reference, so no extra bookkeeping is needed here */
            setStyle("backgroundImage", 'url("' + WBRender.mediaUrl(vpath, { mode: "editor" }) + '")');
            setStyles({ backgroundSize: styleVal("backgroundSize", "cover"),
                        backgroundPosition: styleVal("backgroundPosition", "center") });
        })));

        wrap.appendChild(WBUI.field("Size", WBUI.selectControl([
            { value: "", label: "Auto" },
            { value: "cover", label: "Cover" },
            { value: "contain", label: "Contain" }
        ], styleVal("backgroundSize", ""), function (v) { setStyle("backgroundSize", v); })));

        wrap.appendChild(WBUI.field("Position", WBUI.textInput(styleVal("backgroundPosition", ""), function (v) {
            setStyle("backgroundPosition", v);
        }, { placeholder: "center" })));

        wrap.appendChild(WBUI.field("Repeat", WBUI.selectControl([
            { value: "", label: "Default" },
            { value: "no-repeat", label: "No repeat" },
            { value: "repeat", label: "Repeat" },
            { value: "repeat-x", label: "Repeat X" },
            { value: "repeat-y", label: "Repeat Y" }
        ], styleVal("backgroundRepeat", ""), function (v) { setStyle("backgroundRepeat", v); })));

        return wrap;
    }

    function borderBody() {
        var wrap = WBUI.el("div");
        var grid = WBUI.el("div", { class: "wb-grid-2" });
        grid.appendChild(WBUI.field("Width", WBUI.unitInput(styleVal("borderWidth", ""), function (v) {
            setStyle("borderWidth", v);
            if (v && !styleVal("borderStyle")) { setStyle("borderStyle", "solid"); }
        })));
        grid.appendChild(WBUI.field("Style", WBUI.selectControl([
            { value: "", label: "None" },
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
            { value: "dotted", label: "Dotted" }
        ], styleVal("borderStyle", ""), function (v) { setStyle("borderStyle", v); })));
        wrap.appendChild(grid);

        wrap.appendChild(WBUI.el("div", { style: "height:12px" }));
        wrap.appendChild(WBUI.field("Color",
            WBUI.colorRow(styleVal("borderColor", ""), function (v) { setStyle("borderColor", v); })));
        wrap.appendChild(WBUI.field("Corner Radius",
            WBUI.sliderRow(styleVal("borderRadius", "0px"), function (v) {
                setStyle("borderRadius", v);
            }, { min: 0, max: 80 })));
        wrap.appendChild(WBUI.field("Shorthand",
            WBUI.textInput(styleVal("border", ""), function (v) { setStyle("border", v); },
                { mono: true, placeholder: "1px solid #e5e7eb" })));
        return wrap;
    }

    /* -------------------------------------------------- advanced tab -- */

    function renderAdvanced(page, n) {
        page.appendChild(WBUI.field("Layer Name", WBUI.textInput(n.name || "", function (v) {
            n.name = v.trim();
            WBModel.commit("Rename layer", "lname:" + n.id);
            nameEl.textContent = WBModel.displayName(n);
            WBLayers.render();
        }, { placeholder: wbDef(n.type).name })));

        page.appendChild(WBUI.field("Element ID", WBUI.textInput(n.domId || "", function (v) {
            n.domId = v.trim().replace(/\s+/g, "-");
            WBModel.commit("Set element id", "domid:" + n.id);
            idEl.textContent = n.domId ? "#" + n.domId : ".wb-" + n.id;
            WBCanvas.refreshNode(n.id);
        }, { mono: true, placeholder: "hero-title" })));

        page.appendChild(WBUI.field("CSS Classes", WBUI.textInput(n.classes || "", function (v) {
            n.classes = v;
            WBModel.commit("Set classes", "cls:" + n.id);
            WBCanvas.refreshNode(n.id);
        }, { mono: true, placeholder: "hero-title feature" })));

        if (n.type !== "body") {
            page.appendChild(WBUI.field("HTML Tag", WBUI.textInput(n.tag || "", function (v) {
                WBModel.setTag(n.id, v.trim().toLowerCase() || wbDef(n.type).tag);
                WBModel.commit("Change tag", "tag:" + n.id);
                WBApp.rerenderCanvas();
            }, { mono: true })));
        }

        page.appendChild(makeGroupOpen("Attributes", attributesBody(n), []));
        page.appendChild(makeGroup("Custom CSS", customCssBody(n), []));
        page.appendChild(makeGroup("Lock & Visibility", lockBody(n), []));
    }

    function attributesBody(n) {
        var wrap = WBUI.el("div", { class: "wb-list-editor" });

        function redraw() {
            WBUI.clear(wrap);
            Object.keys(n.attrs).forEach(function (key) {
                var row = WBUI.el("div", { class: "wb-attr-row" });
                var kEl = WBUI.textInput(key, function () {}, { mono: true });
                var vEl = WBUI.textInput(n.attrs[key], function (v) {
                    n.attrs[key] = v;
                    WBModel.commit("Set attribute", "attr:" + n.id + ":" + key);
                    WBCanvas.refreshNode(n.id);
                }, { mono: true });
                kEl.addEventListener("change", function () {
                    var nk = kEl.value.trim();
                    if (!nk || nk === key) { return; }
                    n.attrs[nk] = n.attrs[key];
                    delete n.attrs[key];
                    WBModel.commit("Rename attribute");
                    WBCanvas.refreshNode(n.id);
                    redraw();
                });
                row.appendChild(kEl);
                row.appendChild(vEl);
                row.appendChild(WBUI.iconBtn("close", "Remove", function () {
                    delete n.attrs[key];
                    WBModel.commit("Remove attribute");
                    WBCanvas.refreshNode(n.id);
                    redraw();
                }));
                wrap.appendChild(row);
            });
            wrap.appendChild(WBUI.el("button", {
                class: "wb-btn wb-btn-sm wb-btn-block",
                type: "button",
                html: WBIcon("plus", 13) + "<span>Add attribute</span>",
                onclick: function () {
                    var i = 1;
                    while (n.attrs["data-attr" + i] !== undefined) { i++; }
                    n.attrs["data-attr" + i] = "";
                    WBModel.commit("Add attribute");
                    redraw();
                }
            }));
        }
        redraw();
        return wrap;
    }

    function customCssBody(n) {
        var wrap = WBUI.el("div");
        wrap.appendChild(WBUI.textArea(n.customCss || "", function (v) {
            n.customCss = v;
            WBModel.commit("Custom CSS", "css:" + n.id);
            WBCanvas.refreshStyles();
        }, { mono: true, rows: 6, placeholder: "&:hover {\n  opacity: .85;\n}" }));
        wrap.appendChild(WBUI.el("div", {
            class: "wb-note",
            html: "<code>&amp;</code> stands for this element. Rules are written into the published stylesheet as they are."
        }));
        return wrap;
    }

    function lockBody(n) {
        var wrap = WBUI.el("div");
        wrap.appendChild(WBUI.el("div", { class: "wb-row" }, [
            WBUI.el("div", { class: "wb-row-text" }, [
                WBUI.el("div", { class: "wb-row-label", text: "Lock element" }),
                WBUI.el("div", { class: "wb-row-desc", text: "Clicks on the canvas select its parent instead." })
            ]),
            WBUI.switchControl(n.locked, function (v) {
                n.locked = v;
                WBModel.commit("Toggle lock");
                WBApp.rerenderCanvas();
            })
        ]));

        WBBreakpoints.forEach(function (b) {
            wrap.appendChild(WBUI.el("div", { class: "wb-row" }, [
                WBUI.el("div", { class: "wb-row-text" }, [
                    WBUI.el("div", { class: "wb-row-label", text: "Visible on " + b.name })
                ]),
                WBUI.switchControl(n.visible[b.key] !== false, function (v) {
                    n.visible[b.key] = v;
                    WBModel.commit("Change visibility");
                    WBCanvas.refreshStyles();
                    WBLayers.render();
                })
            ]));
        });
        return wrap;
    }

    /* ----------------------------------------------------- field kit -- */

    function buildField(f, n) {
        var value = f.key.charAt(0) === "_" ? null : n.props[f.key];

        switch (f.type) {

        case "richtext":
            return richTextField(f, n);

        case "text":
            return WBUI.textInput(value, function (v) { setProp(f.key, v); },
                { placeholder: f.placeholder });

        case "url":
            return urlField(f, value);

        case "textarea":
            return WBUI.textArea(value, function (v) { setProp(f.key, v); },
                { placeholder: f.placeholder });

        case "code":
            return WBUI.textArea(value, function (v) { setProp(f.key, v); },
                { mono: true, rows: 7, placeholder: f.placeholder });

        case "select":
            return WBUI.selectControl(f.options, value, function (v) {
                if (f.key === "tag") {
                    WBModel.setTag(n.id, v);
                    WBModel.commit("Change tag");
                    WBApp.rerenderCanvas();
                    /* the tag can carry a new default size - redraw the panel
                       so Typography shows what the element actually is now */
                    render();
                } else {
                    setProp(f.key, v, { structural: true });
                }
            });

        case "number":
            return WBUI.textInput(value, function (v) {
                var num = parseFloat(v);
                setProp(f.key, isNaN(num) ? v : num, { structural: f.key === "count" });
            }, { type: "number", min: f.min, max: f.max, step: f.step });

        case "switch":
            return WBUI.el("div", { style: "display:flex;align-items:center;gap:10px" }, [
                WBUI.switchControl(!!value, function (v) { setProp(f.key, v, { structural: true }); })
            ]);

        case "image":
            return imagePicker(value, function (vpath) { setProp(f.key, vpath, { structural: true }); });

        case "file":
            return filePicker(value, f.accept, function (vpath) { setProp(f.key, vpath, { structural: true }); });

        case "icon":
            return iconPicker(value, function (name) { setProp(f.key, name, { structural: true }); });

        case "list":
            return listField(f, n);

        case "style-length":
            return WBUI.sliderRow(styleVal(f.styleKey, ""), function (v) {
                setStyle(f.styleKey, v);
            }, { min: f.min, max: f.max });

        case "form-submit":
            return formSubmitField(n);

        default:
            return WBUI.textInput(value, function (v) { setProp(f.key, v); });
        }
    }

    /*
        Where a form sends its submissions.

        The default - saving to a CSV in the owner's own storage - exists so
        that publishing a working contact form needs no endpoint, no service and
        no code. The collector script is written by js/formgen.js at publish
        time; everything shown here is just what feeds it.
    */
    function formSubmitField(n) {
        var wrap = WBUI.el("div");
        var mode = n.props.mode || "csv";

        wrap.appendChild(WBUI.segment([
            { value: "csv", label: "Save to a file" },
            { value: "url", label: "Send to a URL" }
        ], mode, function (v) {
            setProp("mode", v, { coalesce: false, structural: true });
            render();
        }));
        wrap.appendChild(WBUI.el("div", { style: "height:14px" }));

        if (mode !== "csv") {
            wrap.appendChild(WBUI.field("Submit To (URL)",
                WBUI.textInput(n.props.action, function (v) { setProp("action", v); },
                    { mono: true, placeholder: "https://... or an .agi endpoint" })));
            wrap.appendChild(WBUI.field("Method", WBUI.selectControl([
                { value: "post", label: "POST" },
                { value: "get", label: "GET" }
            ], n.props.method || "post", function (v) { setProp("method", v, { structural: true }); })));
            wrap.appendChild(WBUI.el("div", {
                class: "wb-note",
                text: "The form posts straight to this address. Whatever is there has to " +
                      "handle the submission itself."
            }));
            return wrap;
        }

        /* ---- save to a CSV file ---- */

        wrap.appendChild(WBUI.field("Form name",
            WBUI.textInput(n.props.formName, function (v) {
                setProp("formName", v, { structural: true });
                if (!n.props.csvPath) { redrawPath(); }
            }, { placeholder: "Contact form" })));

        var pathRow = WBUI.el("div", { class: "wb-path-row" });
        var pathInput = WBUI.textInput(WBFormGen.targetPath(n), function () {});
        pathInput.readOnly = true;
        pathInput.classList.add("mono");
        pathRow.appendChild(pathInput);
        pathRow.appendChild(WBUI.el("button", {
            class: "wb-btn wb-btn-sm",
            type: "button",
            title: "Choose where submissions are saved",
            html: WBIcon("folder", 13),
            onclick: function () {
                var suggested = WBRender.baseName(WBFormGen.defaultPath(n));
                WBFileIO.pickNewFile(suggested, function (vpath) {
                    if (!/\.csv$/i.test(vpath)) { vpath = vpath.replace(/\.[^./]*$/, "") + ".csv"; }
                    setProp("csvPath", vpath, { coalesce: false, structural: true });
                    render();
                });
            }
        }));
        if (n.props.csvPath) {
            pathRow.appendChild(WBUI.el("button", {
                class: "wb-btn wb-btn-sm",
                type: "button",
                title: "Back to the default location",
                html: WBIcon("undo", 13),
                onclick: function () {
                    setProp("csvPath", "", { coalesce: false, structural: true });
                    render();
                }
            }));
        }
        wrap.appendChild(WBUI.field("Save submissions to", pathRow));

        function redrawPath() { pathInput.value = WBFormGen.targetPath(n); }

        /* what the spreadsheet will actually contain */
        var fields = WBRender.collectFormFields(n);
        var columns = ["Submitted at"].concat(fields.map(function (f) {
            return WBRender.formFieldLabel(f);
        }));
        wrap.appendChild(WBUI.el("div", {
            class: "wb-note",
            text: fields.length
                ? "Columns: " + columns.join(", ")
                : "This form has no fields yet - add an Input or Textarea inside it."
        }));

        /* the CSV must not sit inside the published site, or visitors can read it */
        var webroot = (WBPublish.state && WBPublish.state().webroot) || "";
        var target = WBFormGen.targetPath(n);
        if (webroot && target.indexOf(webroot.replace(/\/+$/, "") + "/") === 0) {
            wrap.appendChild(WBUI.el("div", {
                class: "wb-note warn",
                text: "This file is inside your public web root, so anyone who visits your " +
                      "site could download every submission. Pick a location outside it."
            }));
        }

        wrap.appendChild(WBUI.el("div", {
            class: "wb-note",
            html: "On publish the builder writes a small handler next to your pages " +
                  "(<code>" + WBRender.esc(WBRender.formEndpoint(n)) + "</code>) that appends each " +
                  "submission to the file above. Open it any time with Sheets."
        }));

        wrap.appendChild(WBUI.el("div", { style: "height:6px" }));
        wrap.appendChild(WBUI.group("Thank you page", thankYouPageEditor(n), false, false));

        return wrap;
    }

    /*
        The page a visitor lands on after submitting. It only exists on the
        published site, so the editor carries a live miniature of it - otherwise
        these settings would be adjusted blind.
    */
    function thankYouPageEditor(n) {
        var wrap = WBUI.el("div");
        var theme = (WBModel.get().settings.theme) || {};

        var preview = WBUI.el("div", { class: "wb-reply-preview" });
        function paint() {
            var accent = n.props.replyAccent || theme.accent || "#f97316";
            var bg = n.props.replyBg || theme.background || "#ffffff";
            var text = n.props.replyText || theme.text || "#16181d";
            WBUI.clear(preview);
            preview.style.background = bg;
            preview.style.color = text;
            preview.appendChild(WBUI.el("div", {
                class: "wb-reply-mark",
                style: "background:" + accent,
                html: WBIcon("check", 15)
            }));
            preview.appendChild(WBUI.el("div", {
                class: "wb-reply-title",
                text: n.props.successTitle || "Thank you"
            }));
            preview.appendChild(WBUI.el("div", {
                class: "wb-reply-body",
                text: n.props.successMessage || ""
            }));
            preview.appendChild(WBUI.el("div", {
                class: "wb-reply-btn",
                style: "background:" + accent,
                text: n.props.backLabel || "Back to the site"
            }));
        }
        paint();
        wrap.appendChild(preview);

        wrap.appendChild(WBUI.field("Heading",
            WBUI.textInput(n.props.successTitle, function (v) {
                setProp("successTitle", v);
                paint();
            }, { placeholder: "Thank you" })));

        wrap.appendChild(WBUI.field("Small text",
            WBUI.textArea(n.props.successMessage, function (v) {
                setProp("successMessage", v);
                paint();
            }, { rows: 2, placeholder: "Thank you. Your message has been received." })));

        wrap.appendChild(WBUI.field("Return button",
            WBUI.textInput(n.props.backLabel, function (v) {
                setProp("backLabel", v);
                paint();
            }, { placeholder: "Back to the site" })));

        [
            { key: "replyAccent", label: "Accent color", fallback: theme.accent || "#f97316" },
            { key: "replyBg", label: "Background", fallback: theme.background || "#ffffff" },
            { key: "replyText", label: "Text color", fallback: theme.text || "#16181d" }
        ].forEach(function (c) {
            var row = WBUI.colorRow(n.props[c.key] || "", function (v) {
                setProp(c.key, v);
                showInherited();
                paint();
            });
            var chip = row.querySelector(".wb-color-swatch i");
            var textField = row.querySelector('input[type="text"]');

            /* an empty field means "inherit", so show what is being inherited
               rather than an empty swatch that reads as "no colour" */
            function showInherited() {
                var inherited = !n.props[c.key];
                textField.placeholder = inherited ? c.fallback + " (site theme)" : "";
                if (inherited) {
                    chip.style.background = c.fallback;
                    chip.style.opacity = "0.45";
                } else {
                    chip.style.opacity = "1";
                }
            }
            showInherited();

            var holder = WBUI.el("div", { class: "wb-path-row" }, [row]);
            row.style.flex = "1";
            holder.appendChild(WBUI.el("button", {
                class: "wb-btn wb-btn-sm",
                type: "button",
                title: "Follow the site theme",
                html: WBIcon("undo", 13),
                onclick: function () {
                    setProp(c.key, "");
                    row.setValue("");
                    showInherited();
                    paint();
                }
            }));
            wrap.appendChild(WBUI.field(c.label, holder));
        });

        wrap.appendChild(WBUI.el("div", {
            class: "wb-note",
            text: "Leave a colour empty to follow the site theme. The heading, text and " +
                  "button only appear on the published site, after a visitor submits."
        }));
        return wrap;
    }

    /* Text body plus a shortcut into on-canvas editing. */
    function richTextField(f, n) {
        var wrap = WBUI.el("div");
        var ta = WBUI.textArea(stripHtml(n.props[f.key]), function (v) {
            n.props[f.key] = v.replace(/\n/g, "<br>");
            WBModel.commit("Edit text", "text:" + n.id);
            WBCanvas.refreshNode(n.id);
        }, { rows: 3 });
        wrap.appendChild(ta);
        wrap.appendChild(WBUI.el("button", {
            class: "wb-btn wb-btn-sm wb-btn-block",
            type: "button",
            style: "margin-top:8px",
            html: WBIcon("pencil", 13) + "<span>Edit on canvas</span>",
            onclick: function () { WBCanvas.startTextEdit(n.id); }
        }));
        return wrap;
    }

    function stripHtml(html) {
        return String(html || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|h[1-6])>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .trim();
    }

    /* URL field with a "link to a page in this site" helper. */
    function urlField(f, value) {
        var input = WBUI.textInput(value, function (v) { setProp(f.key, v); },
            { placeholder: f.placeholder, mono: true });
        var btn = WBUI.el("button", {
            class: "wb-btn wb-btn-sm",
            type: "button",
            title: "Link to a page in this site",
            html: WBIcon("pages", 13),
            onclick: function (e) {
                var items = WBModel.get().pages.map(function (p) {
                    return {
                        label: p.name, icon: "file",
                        action: function () {
                            input.value = WBModel.pageFileName(p);
                            setProp(f.key, input.value);
                        }
                    };
                });
                items.unshift({ header: "Link to page" });
                WBUI.menu(e.currentTarget, items, { alignRight: true });
            }
        });
        return WBUI.el("div", { class: "wb-path-row" }, [input, btn]);
    }

    function imagePicker(value, onPick) {
        return filePicker(value, "image", onPick);
    }

    function filePicker(value, accept, onPick) {
        var wrap = WBUI.el("div");
        var preview = WBUI.el("div", {
            style: "display:flex;align-items:center;gap:9px;margin-bottom:7px;min-height:34px"
        });

        function draw() {
            WBUI.clear(preview);
            if (value) {
                if (accept === "image" || accept === undefined) {
                    preview.appendChild(WBUI.el("img", {
                        src: WBRender.mediaUrl(value, { mode: "editor" }),
                        style: "width:44px;height:34px;object-fit:cover;border-radius:6px;" +
                               "border:1px solid var(--wb-border);flex-shrink:0;background:var(--wb-surface-3)"
                    }));
                } else {
                    preview.appendChild(WBUI.el("span", {
                        style: "color:var(--wb-text-dim);flex-shrink:0", html: WBIcon("video", 18)
                    }));
                }
                preview.appendChild(WBUI.el("span", {
                    style: "font-size:11px;color:var(--wb-text-dim);word-break:break-all;line-height:1.35",
                    text: WBRender.baseName(value)
                }));
                preview.appendChild(WBUI.iconBtn("close", "Remove", function () {
                    value = "";
                    onPick("");
                    draw();
                }));
            } else {
                preview.appendChild(WBUI.el("span", {
                    style: "font-size:11.5px;color:var(--wb-text-mute)",
                    text: "Nothing selected"
                }));
            }
        }
        draw();

        var row = WBUI.el("div", { class: "wb-path-row" }, [
            WBUI.el("button", {
                class: "wb-btn wb-btn-sm",
                style: "flex:1",
                type: "button",
                html: WBIcon("open", 13) + "<span>Choose from files</span>",
                onclick: function () {
                    WBFileIO.pickMedia(accept, function (vpath) {
                        value = vpath;
                        onPick(vpath);
                        draw();
                    });
                }
            }),
            WBUI.el("button", {
                class: "wb-btn wb-btn-sm",
                type: "button",
                title: "Use an external URL",
                html: WBIcon("link", 13),
                onclick: function () {
                    WBUI.prompt("External URL", "Address of the file", value || "", "https://...")
                        .then(function (v) {
                            if (v === null) { return; }
                            value = v;
                            onPick(v);
                            draw();
                        });
                }
            })
        ]);

        wrap.appendChild(preview);
        wrap.appendChild(row);
        return wrap;
    }

    function iconPicker(value, onPick) {
        var wrap = WBUI.el("div", {
            style: "display:grid;grid-template-columns:repeat(6,1fr);gap:5px;max-height:170px;overflow:auto;" +
                   "border:1px solid var(--wb-border);border-radius:8px;padding:7px"
        });
        WBIconChoices.forEach(function (name) {
            var b = WBUI.el("button", {
                type: "button",
                title: name,
                class: "wb-swatch" + (name === value ? " active" : ""),
                style: "display:flex;align-items:center;justify-content:center;background:transparent;" +
                       "color:var(--wb-text-dim);border:1px solid transparent",
                html: WBIcon(name, 17)
            });
            b.addEventListener("click", function () {
                var all = wrap.querySelectorAll("button");
                for (var i = 0; i < all.length; i++) { all[i].classList.remove("active"); }
                b.classList.add("active");
                onPick(name);
            });
            wrap.appendChild(b);
        });
        return wrap;
    }

    /* Repeating list of images or plain strings. */
    function listField(f, n) {
        var wrap = WBUI.el("div", { class: "wb-list-editor" });
        var items = n.props[f.key] || [];

        function commit() {
            n.props[f.key] = items;
            WBModel.commit("Edit " + f.label);
            WBApp.rerenderCanvas();
        }

        function redraw() {
            WBUI.clear(wrap);
            items.forEach(function (item, i) {
                var row = WBUI.el("div", { class: "wb-list-row" });
                row.appendChild(WBUI.el("span", { class: "wb-drag", html: WBIcon("grip", 13) }));

                if (f.itemType === "image") {
                    row.appendChild(WBUI.el("img", {
                        src: WBRender.mediaUrl(item.src || item, { mode: "editor" }),
                        style: "width:34px;height:26px;object-fit:cover;border-radius:5px;" +
                               "border:1px solid var(--wb-border)"
                    }));
                    row.appendChild(WBUI.el("span", {
                        style: "flex:1;font-size:11px;color:var(--wb-text-dim);overflow:hidden;" +
                               "text-overflow:ellipsis;white-space:nowrap",
                        text: WBRender.baseName(item.src || item)
                    }));
                } else {
                    row.appendChild(WBUI.textInput(item, function (v) {
                        items[i] = v;
                        n.props[f.key] = items;
                        WBModel.commit("Edit " + f.label, "list:" + n.id + ":" + i);
                        WBCanvas.refreshNode(n.id);
                    }));
                }

                row.appendChild(WBUI.iconBtn("caret-up", "Move up", function () {
                    if (i === 0) { return; }
                    var t = items[i - 1]; items[i - 1] = items[i]; items[i] = t;
                    commit(); redraw();
                }));
                row.appendChild(WBUI.iconBtn("close", "Remove", function () {
                    items.splice(i, 1);
                    commit(); redraw();
                }));
                wrap.appendChild(row);
            });

            wrap.appendChild(WBUI.el("button", {
                class: "wb-btn wb-btn-sm wb-btn-block",
                type: "button",
                html: WBIcon("plus", 13) + "<span>Add " + (f.itemType === "image" ? "image" : "item") + "</span>",
                onclick: function () {
                    if (f.itemType === "image") {
                        WBFileIO.pickMedia("image", function (vpath, all) {
                            (all || [vpath]).forEach(function (p) { items.push({ src: p, alt: "" }); });
                            commit(); redraw();
                        }, true);
                    } else {
                        items.push("New option");
                        commit(); redraw();
                    }
                }
            }));
        }
        redraw();
        return wrap;
    }

    return {
        init: init,
        setTarget: setTarget,
        render: render,
        getTarget: function () { return currentId; }
    };
})();
