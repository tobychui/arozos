/*
    palette.js

    The "Add" panel: a searchable, grouped grid of element cards.

    Cards are HTML5 drag sources. The dragged type is stashed on WBCanvas
    (beginPaletteDrag) rather than read from dataTransfer, because dataTransfer
    payloads are not readable during dragover - which is exactly when the drop
    indicator has to be computed. Clicking a card inserts it into the current
    selection instead, for keyboard/touch friendly use.
*/

var WBPalette = (function () {

    var listEl = null;
    var filter = "";

    function init() {
        var panel = document.getElementById("wb-panel-add");
        var head = panel.querySelector(".wb-panel-hd");
        head.appendChild(WBUI.searchBox("Search elements...", function (q) {
            filter = q;
            render();
        }));
        listEl = panel.querySelector(".wb-panel-bd");
        render();
    }

    function matches(def) {
        if (!filter) { return true; }
        return def.name.toLowerCase().indexOf(filter) >= 0 ||
               def.type.toLowerCase().indexOf(filter) >= 0 ||
               def.group.toLowerCase().indexOf(filter) >= 0;
    }

    function render() {
        WBUI.clear(listEl);
        var any = false;

        WBPaletteGroups.forEach(function (groupName) {
            var defs = [];
            for (var type in WBElements) {
                var def = WBElements[type];
                if (def.hidden || def.group !== groupName) { continue; }
                if (!matches(def)) { continue; }
                defs.push(def);
            }
            if (!defs.length) { return; }
            any = true;

            listEl.appendChild(WBUI.el("div", { class: "wb-group-title", text: groupName }));
            var grid = WBUI.el("div", { class: "wb-element-grid" });
            defs.forEach(function (def) { grid.appendChild(card(def)); });
            listEl.appendChild(grid);
        });

        if (!any) {
            listEl.appendChild(WBUI.el("div", {
                class: "wb-empty",
                text: "No element matches “" + filter + "”"
            }));
        }
    }

    function card(def) {
        var c = WBUI.el("div", {
            class: "wb-element-card",
            draggable: "true",
            title: def.name + (def.help ? " - " + def.help : "")
        }, [
            WBUI.el("span", { class: "wb-el-icon", html: WBIcon(def.icon, 21, 1.5) }),
            WBUI.el("span", { class: "wb-el-name", text: def.name })
        ]);

        c.addEventListener("dragstart", function (e) {
            c.classList.add("dragging");
            e.dataTransfer.effectAllowed = "copy";
            /* some browsers require data to be set for the drag to start */
            try { e.dataTransfer.setData("text/plain", def.type); } catch (err) { /* ignore */ }
            WBCanvas.beginPaletteDrag(def.type);
        });
        c.addEventListener("dragend", function () {
            c.classList.remove("dragging");
            WBCanvas.endPaletteDrag();
        });
        c.addEventListener("click", function () {
            WBApp.insertElement(def.type);
        });
        return c;
    }

    return { init: init, render: render };
})();
