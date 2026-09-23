/*
    layers.js

    The "Layers" panel - the element tree of the current page.

    Per the design brief this lives in the LEFT dock (the same slot as Pages),
    not on the right: the right dock is permanently the element inspector. The
    "Layer Properties" block from the mockup is kept, pinned to the bottom of
    this panel.

    The tree supports drag reordering with three drop modes: before, after and
    inside (when hovering the middle of a container row).
*/

var WBLayers = (function () {

    var listEl, propsEl, filter = "";
    var collapsed = {};
    var dragState = null;

    function init() {
        var panel = document.getElementById("wb-panel-layers");
        var head = panel.querySelector(".wb-panel-hd");
        var tools = panel.querySelector(".wb-panel-tools");

        tools.appendChild(WBUI.iconBtn("eye", "Show every layer", function () {
            walk(WBModel.activePage().root, function (n) {
                n.visible = { base: true, tablet: true, mobile: true };
            });
            WBModel.commit("Show all layers");
            WBApp.rerenderCanvas();
        }, "wb-icon-btn", 15));

        tools.appendChild(WBUI.iconBtn("unlock", "Unlock every layer", function () {
            walk(WBModel.activePage().root, function (n) { n.locked = false; });
            WBModel.commit("Unlock all layers");
            WBApp.rerenderCanvas();
        }, "wb-icon-btn", 15));

        head.appendChild(WBUI.searchBox("Search layers...", function (q) {
            filter = q;
            render();
        }));

        listEl = panel.querySelector(".wb-panel-bd");
        propsEl = panel.querySelector(".wb-subpanel");
        render();
    }

    function walk(node, fn) {
        fn(node);
        for (var i = 0; i < node.children.length; i++) { walk(node.children[i], fn); }
    }

    /* --------------------------------------------------------- render -- */

    function render() {
        if (!listEl) { return; }
        WBUI.clear(listEl);
        var root = WBModel.activePage().root;
        var tree = WBUI.el("div", { class: "wb-layer-list" });
        renderNode(root, tree, 0);
        listEl.appendChild(tree);
        renderProps();
    }

    function nodeMatches(node) {
        if (!filter) { return true; }
        var label = WBModel.displayName(node).toLowerCase();
        if (label.indexOf(filter) >= 0) { return true; }
        for (var i = 0; i < node.children.length; i++) {
            if (nodeMatches(node.children[i])) { return true; }
        }
        return false;
    }

    function renderNode(node, container, depth) {
        if (!nodeMatches(node)) { return; }
        container.appendChild(row(node, depth));
        var open = filter ? true : collapsed[node.id] !== true;
        if (!open) { return; }
        for (var i = 0; i < node.children.length; i++) {
            renderNode(node.children[i], container, depth + 1);
        }
    }

    function layerIcon(node) {
        return wbDef(node.type).icon || "box";
    }

    function isHiddenAnywhere(node) {
        return node.visible && (!node.visible.base || !node.visible.tablet || !node.visible.mobile);
    }

    function row(node, depth) {
        var selected = WBCanvas.getSelection() === node.id;
        var item = WBUI.el("div", {
            class: "wb-layer-item" +
                   (selected ? " selected" : "") +
                   (isHiddenAnywhere(node) ? " hidden-layer" : "") +
                   (node.locked ? " locked-layer" : ""),
            draggable: node.type === "body" ? "false" : "true",
            "data-id": node.id,
            title: wbDef(node.type).name
        });
        item.style.paddingLeft = (2 + depth * 13) + "px";

        var hasKids = node.children.length > 0;
        item.appendChild(WBUI.el("button", {
            class: "wb-twisty" + (hasKids ? "" : " leaf") + (collapsed[node.id] !== true ? " open" : ""),
            type: "button",
            html: WBIcon("caret-right", 11),
            onclick: function (e) {
                e.stopPropagation();
                collapsed[node.id] = collapsed[node.id] !== true;
                render();
            }
        }));

        item.appendChild(WBUI.el("span", { class: "wb-layer-icon", html: WBIcon(layerIcon(node), 14) }));

        var nameEl = WBUI.el("span", { class: "wb-layer-name", text: WBModel.displayName(node) });
        nameEl.addEventListener("dblclick", function (e) {
            e.stopPropagation();
            startRename(node, nameEl);
        });
        item.appendChild(nameEl);

        if (node.locked) {
            item.appendChild(WBUI.iconBtn("lock", "Unlock", function (e) {
                e.stopPropagation();
                node.locked = false;
                WBModel.commit("Unlock layer");
                WBApp.rerenderCanvas();
            }, "wb-row-btn pinned", 13));
        }

        if (node.type !== "body") {
            var hidden = isHiddenAnywhere(node);
            item.appendChild(WBUI.iconBtn(hidden ? "eye-off" : "eye",
                hidden ? "Show layer" : "Hide layer",
                function (e) {
                    e.stopPropagation();
                    var show = hidden;
                    node.visible = { base: show, tablet: show, mobile: show };
                    WBModel.commit("Toggle layer visibility");
                    WBApp.rerenderCanvas();
                },
                "wb-row-btn" + (hidden ? " pinned off" : ""), 14));

            item.appendChild(WBUI.iconBtn("more-v", "Layer options", function (e) {
                e.stopPropagation();
                layerMenu(node, e.currentTarget);
            }, "wb-row-btn", 14));
        }

        item.addEventListener("click", function () {
            WBApp.selectNode(node.id, { fromLayers: true });
        });
        item.addEventListener("mouseenter", function () { WBApp.highlightNode(node.id); });
        item.addEventListener("mouseleave", function () { WBApp.highlightNode(null); });

        bindDrag(item, node);
        return item;
    }

    function startRename(node, nameEl) {
        nameEl.setAttribute("contenteditable", "true");
        nameEl.focus();
        var range = document.createRange();
        range.selectNodeContents(nameEl);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        function finish(save) {
            nameEl.removeAttribute("contenteditable");
            if (save) {
                var v = nameEl.textContent.trim();
                node.name = (v === wbDef(node.type).name) ? "" : v;
                WBModel.commit("Rename layer");
            }
            render();
            WBApp.refreshInspector();
        }
        nameEl.addEventListener("blur", function () { finish(true); }, { once: true });
        nameEl.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); }
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
    }

    /* ----------------------------------------------------------- menu -- */

    function layerMenu(node, anchor) {
        var parent = WBModel.findParent(node.id);
        var isContainer = wbIsContainer(node.type);

        WBUI.menu(anchor, [
            { label: "Rename", icon: "pencil", action: function () {
                var el = listEl.querySelector('[data-id="' + node.id + '"] .wb-layer-name');
                if (el) { startRename(node, el); }
            } },
            { label: "Duplicate", icon: "duplicate", key: "Ctrl+D", action: function () {
                WBApp.duplicateNode(node.id);
            } },
            { label: "Select Parent", icon: "caret-up", disabled: !parent || parent.type === "body",
              action: function () { WBApp.selectNode(parent.id); } },
            { separator: true },
            { label: node.locked ? "Unlock" : "Lock", icon: node.locked ? "unlock" : "lock",
              action: function () {
                  node.locked = !node.locked;
                  WBModel.commit("Toggle lock");
                  WBApp.rerenderCanvas();
              } },
            { label: isHiddenAnywhere(node) ? "Show" : "Hide", icon: isHiddenAnywhere(node) ? "eye" : "eye-off",
              action: function () {
                  var show = isHiddenAnywhere(node);
                  node.visible = { base: show, tablet: show, mobile: show };
                  WBModel.commit("Toggle visibility");
                  WBApp.rerenderCanvas();
              } },
            { separator: true },
            { label: "Wrap In Container", icon: "container", disabled: node.type === "body",
              action: function () { WBApp.wrapInContainer(node.id); } },
            { label: isContainer ? "Unwrap (keep children)" : "Unwrap",
              icon: "external", disabled: !isContainer || node.type === "body",
              action: function () { WBApp.unwrapNode(node.id); } },
            { separator: true },
            { label: "Delete", icon: "trash", danger: true, key: "Del",
              disabled: node.type === "body",
              action: function () { WBApp.deleteNode(node.id); } }
        ], { alignRight: true });
    }

    /* ----------------------------------------------------------- drag -- */

    function bindDrag(item, node) {
        item.addEventListener("dragstart", function (e) {
            if (node.type === "body") { e.preventDefault(); return; }
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", node.id); } catch (err) { /* ignore */ }
            dragState = { id: node.id };
        });

        item.addEventListener("dragend", function () {
            dragState = null;
            clearMarks();
        });

        item.addEventListener("dragover", function (e) {
            if (!dragState || dragState.id === node.id) { return; }
            if (WBModel.isDescendant(dragState.id, node.id)) { return; }
            e.preventDefault();
            e.stopPropagation();

            var r = item.getBoundingClientRect();
            var rel = (e.clientY - r.top) / r.height;
            var canHold = wbIsContainer(node.type) || node.type === "body";
            clearMarks();
            if (canHold && rel > 0.3 && rel < 0.7) {
                item.classList.add("drop-inside");
                dragState.mode = "inside";
            } else if (rel < 0.5) {
                item.classList.add("drop-before");
                dragState.mode = "before";
            } else {
                item.classList.add("drop-after");
                dragState.mode = "after";
            }
            dragState.overId = node.id;
        });

        item.addEventListener("drop", function (e) {
            if (!dragState || !dragState.overId) { return; }
            e.preventDefault();
            e.stopPropagation();
            var moved = applyDrop();
            clearMarks();
            dragState = null;
            if (moved) { WBApp.rerenderCanvas(); }
        });
    }

    function applyDrop() {
        var target = WBModel.findNode(dragState.overId);
        if (!target) { return false; }
        var ok;
        if (dragState.mode === "inside") {
            ok = WBModel.moveNode(dragState.id, target.id, target.children.length);
        } else {
            var parent = WBModel.findParent(target.id);
            if (!parent) { return false; }
            var idx = WBModel.indexOfNode(target.id);
            ok = WBModel.moveNode(dragState.id, parent.id, dragState.mode === "before" ? idx : idx + 1);
        }
        if (ok) { WBModel.commit("Reorder layers"); }
        return ok;
    }

    function clearMarks() {
        var all = listEl.querySelectorAll(".wb-layer-item");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.remove("drop-before", "drop-after", "drop-inside");
        }
    }

    /* ----------------------------------------------- layer properties -- */

    function renderProps() {
        if (!propsEl) { return; }
        WBUI.clear(propsEl);
        var id = WBCanvas.getSelection();
        var node = id ? WBModel.findNode(id) : null;

        propsEl.appendChild(WBUI.el("div", { class: "wb-subpanel-title" }, [
            WBUI.el("span", { class: "wb-subpanel-icon", html: WBIcon("gear", 14) }),
            WBUI.el("span", { text: "Layer Properties" })
        ]));

        if (!node) {
            propsEl.appendChild(WBUI.el("div", {
                class: "wb-empty",
                text: "Select a layer to see its properties"
            }));
            return;
        }

        var def = wbDef(node.type);
        var elementLabel = def.name + (node.tag ? " (" + node.tag + ")" : "");
        var elInput = WBUI.textInput(elementLabel, function () {});
        elInput.readOnly = true;
        propsEl.appendChild(WBUI.field("Element", elInput));

        propsEl.appendChild(WBUI.field("ID",
            WBUI.textInput(node.domId || "", function (v) {
                node.domId = v.trim().replace(/\s+/g, "-");
                WBModel.commit("Set element id", "domid:" + node.id);
                WBApp.rerenderCanvas({ soft: true });
            }, { mono: true, placeholder: "hero-title" })
        ));

        propsEl.appendChild(WBUI.field("Classes",
            WBUI.textInput(node.classes || "", function (v) {
                node.classes = v;
                WBModel.commit("Set classes", "cls:" + node.id);
                WBApp.rerenderCanvas({ soft: true });
            }, { mono: true, placeholder: "hero-title feature" })
        ));

        var vis = WBUI.el("div", { class: "wb-segment" });
        WBBreakpoints.forEach(function (bp) {
            var on = node.visible[bp.key] !== false;
            var b = WBUI.el("button", {
                type: "button",
                class: on ? "active" : "",
                title: (on ? "Visible on " : "Hidden on ") + bp.name,
                html: WBIcon(bp.icon, 14)
            });
            b.addEventListener("click", function () {
                node.visible[bp.key] = !(node.visible[bp.key] !== false);
                WBModel.commit("Change layer visibility");
                WBApp.rerenderCanvas();
            });
            vis.appendChild(b);
        });
        propsEl.appendChild(WBUI.field("Visibility", vis));
    }

    /* Scroll the selected row into view when selection came from the canvas. */
    function revealSelected() {
        if (!listEl) { return; }
        var id = WBCanvas.getSelection();
        if (!id) { return; }
        var row = listEl.querySelector('[data-id="' + id + '"]');
        if (row && row.scrollIntoView) {
            row.scrollIntoView({ block: "nearest" });
        }
    }

    function setHover(id) {
        if (!listEl) { return; }
        var all = listEl.querySelectorAll(".wb-layer-item");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.toggle("hovered", id && all[i].getAttribute("data-id") === id);
        }
    }

    return {
        init: init,
        render: render,
        renderProps: renderProps,
        revealSelected: revealSelected,
        setHover: setHover
    };
})();
