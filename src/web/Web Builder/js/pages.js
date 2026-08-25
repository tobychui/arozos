/*
    pages.js

    The "Pages" panel: the site map plus the settings of the selected page.

    Pages form a shallow tree (a page may name another page as its parent) which
    is used purely for organisation in this list - every page still publishes to
    a flat <slug>.html next to index.html, so links between them never break
    when a page is re-parented.
*/

var WBPages = (function () {

    var listEl, settingsEl, filter = "";
    var expanded = {};

    function init() {
        var panel = document.getElementById("wb-panel-pages");
        var head = panel.querySelector(".wb-panel-hd");

        head.appendChild(WBUI.searchBox("Search pages...", function (q) {
            filter = q;
            render();
        }));

        var actions = WBUI.el("div", { class: "wb-panel-actions" }, [
            WBUI.el("button", {
                class: "wb-btn wb-btn-primary",
                type: "button",
                html: WBIcon("plus", 14) + "<span>Add Page</span>",
                onclick: addPage
            }),
            WBUI.el("button", {
                class: "wb-btn wb-btn-icon-only",
                type: "button",
                title: "Group pages under a parent",
                html: WBIcon("folder-plus", 15),
                onclick: groupUnderParent
            })
        ]);
        head.appendChild(actions);

        listEl = panel.querySelector(".wb-panel-bd");
        settingsEl = panel.querySelector(".wb-subpanel");
        render();
    }

    /* ---------------------------------------------------------- list -- */

    function render() {
        if (!listEl) { return; }
        WBUI.clear(listEl);
        var project = WBModel.get();
        var roots = WBModel.childPages(null);

        if (filter) {
            /* flat filtered view - hierarchy is meaningless while searching */
            var hits = project.pages.filter(function (p) {
                return p.name.toLowerCase().indexOf(filter) >= 0 ||
                       String(p.slug).toLowerCase().indexOf(filter) >= 0;
            });
            if (!hits.length) {
                listEl.appendChild(WBUI.el("div", { class: "wb-empty", text: "No page matches your search" }));
            }
            hits.forEach(function (p) { listEl.appendChild(row(p, false, false)); });
        } else {
            roots.forEach(function (p) { renderBranch(p, 0); });
        }
        renderSettings();
    }

    function renderBranch(page, depth) {
        var kids = WBModel.childPages(page.id);
        var isOpen = expanded[page.id] !== false;
        listEl.appendChild(row(page, depth > 0, kids.length > 0, isOpen));
        if (kids.length && isOpen) {
            kids.forEach(function (k) { renderBranch(k, depth + 1); });
        }
    }

    function pageIcon(page) {
        if (WBModel.pageFileName(page) === "index.html") { return "home"; }
        if (page.visibility === "hidden") { return "eye-off"; }
        return "file";
    }

    function row(page, isChild, hasKids, isOpen) {
        var active = WBModel.get().activePageId === page.id;
        var item = WBUI.el("div", {
            class: "wb-page-item" + (active ? " active" : "") + (isChild ? " child" : ""),
            draggable: "true",
            title: "/" + WBModel.pageFileName(page)
        });

        var tw = WBUI.el("button", {
            class: "wb-twisty" + (hasKids ? "" : " leaf") + (isOpen ? " open" : ""),
            type: "button",
            html: WBIcon("caret-right", 12),
            onclick: function (e) {
                e.stopPropagation();
                expanded[page.id] = !(expanded[page.id] !== false);
                render();
            }
        });
        item.appendChild(tw);
        item.appendChild(WBUI.el("span", { class: "wb-page-icon", html: WBIcon(pageIcon(page), 14) }));
        item.appendChild(WBUI.el("span", { class: "wb-page-name", text: page.name }));
        if (page.visibility === "hidden") {
            item.appendChild(WBUI.el("span", { class: "wb-page-badge", text: "hidden" }));
        }
        item.appendChild(WBUI.iconBtn("more-v", "Page options", function (e) {
            e.stopPropagation();
            pageMenu(page, e.currentTarget);
        }));

        item.addEventListener("click", function () {
            WBApp.switchPage(page.id);
        });
        item.addEventListener("dblclick", function () { renamePage(page); });

        bindPageDrag(item, page);
        return item;
    }

    /* Reordering by drag inside the page list. */
    function bindPageDrag(item, page) {
        item.addEventListener("dragstart", function (e) {
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", page.id); } catch (err) { /* ignore */ }
            item.dataset.dragging = "1";
            WBPages._dragId = page.id;
        });
        item.addEventListener("dragend", function () {
            delete item.dataset.dragging;
            WBPages._dragId = null;
            clearDropMarks();
        });
        item.addEventListener("dragover", function (e) {
            if (!WBPages._dragId || WBPages._dragId === page.id) { return; }
            e.preventDefault();
            var r = item.getBoundingClientRect();
            var before = (e.clientY - r.top) < r.height / 2;
            clearDropMarks();
            item.classList.add(before ? "drop-before" : "drop-after");
        });
        item.addEventListener("drop", function (e) {
            if (!WBPages._dragId || WBPages._dragId === page.id) { return; }
            e.preventDefault();
            var before = item.classList.contains("drop-before");
            clearDropMarks();
            WBModel.movePage(WBPages._dragId, before ? page.id : nextPageIdAfter(page.id));
            WBModel.commit("Reorder pages");
            render();
        });
    }

    function nextPageIdAfter(id) {
        var pages = WBModel.get().pages;
        for (var i = 0; i < pages.length; i++) {
            if (pages[i].id === id) { return pages[i + 1] ? pages[i + 1].id : null; }
        }
        return null;
    }

    function clearDropMarks() {
        var all = listEl.querySelectorAll(".wb-page-item");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.remove("drop-before", "drop-after");
        }
    }

    /* --------------------------------------------------------- menus -- */

    function pageMenu(page, anchor) {
        var isHome = WBModel.pageFileName(page) === "index.html";
        var parents = WBModel.get().pages.filter(function (p) {
            return p.id !== page.id && p.parentId !== page.id;
        });

        WBUI.menu(anchor, [
            { label: "Rename", icon: "pencil", action: function () { renamePage(page); } },
            { label: "Duplicate", icon: "duplicate", action: function () {
                var copy = WBModel.duplicatePage(page.id);
                WBModel.commit("Duplicate page");
                render();
                if (copy) { WBApp.switchPage(copy.id); }
            } },
            { label: "Set As Home Page", icon: "home", disabled: isHome, action: function () {
                var home = WBModel.homePage();
                if (home && home !== page) { home.slug = WBModel.slugify(home.name); }
                page.slug = "";
                WBModel.commit("Set home page");
                render();
            } },
            { separator: true },
            { label: page.visibility === "hidden" ? "Make Public" : "Hide From Site",
              icon: page.visibility === "hidden" ? "eye" : "eye-off",
              action: function () {
                  page.visibility = page.visibility === "hidden" ? "public" : "hidden";
                  WBModel.commit("Change page visibility");
                  render();
              } },
            { label: "Move Under...", icon: "folder", disabled: !parents.length, action: function () {
                chooseParent(page, parents);
            } },
            { label: "Detach From Parent", icon: "external", disabled: !page.parentId, action: function () {
                page.parentId = null;
                WBModel.commit("Detach page");
                render();
            } },
            { separator: true },
            { label: "Delete Page", icon: "trash", danger: true,
              disabled: WBModel.get().pages.length <= 1,
              action: function () { deletePage(page); } }
        ], { alignRight: true });
    }

    function chooseParent(page, parents) {
        var sel = WBUI.selectControl(
            [{ value: "", label: "(top level)" }].concat(parents.map(function (p) {
                return { value: p.id, label: p.name };
            })),
            page.parentId || "",
            function () {}
        );
        WBUI.modal({
            title: "Move “" + page.name + "” Under",
            body: WBUI.field("Parent page", sel),
            buttons: [
                { label: "Cancel", value: null },
                { label: "Move", value: "ok", primary: true }
            ]
        }).then(function (v) {
            if (v !== "ok") { return; }
            page.parentId = sel.value || null;
            expanded[page.parentId] = true;
            WBModel.commit("Move page");
            render();
        });
    }

    function groupUnderParent() {
        WBUI.toast("Drag a page onto another page's menu, or use Page options > Move Under");
    }

    function renamePage(page) {
        WBUI.prompt("Rename Page", "Page name", page.name).then(function (name) {
            if (!name) { return; }
            var slugWasAuto = page.slug === WBModel.slugify(page.name);
            page.name = name;
            if (page.title === "" || slugWasAuto) { page.title = name; }
            if (slugWasAuto && WBModel.pageFileName(page) !== "index.html") {
                page.slug = WBModel.slugify(name);
            }
            WBModel.commit("Rename page");
            render();
            WBApp.refreshTitles();
        });
    }

    function addPage() {
        var nameInput = WBUI.textInput("", function () {}, { placeholder: "About" });
        var blank = WBUI.switchControl(false, function () {});
        var body = WBUI.el("div", {}, [
            WBUI.field("Page name", nameInput),
            WBUI.el("div", { class: "wb-row" }, [
                WBUI.el("div", { class: "wb-row-text" }, [
                    WBUI.el("div", { class: "wb-row-label", text: "Start blank" }),
                    WBUI.el("div", { class: "wb-row-desc", text: "Otherwise the page starts from the same starter layout as the home page." })
                ]),
                blank
            ])
        ]);
        WBUI.modal({
            title: "Add Page",
            body: body,
            buttons: [
                { label: "Cancel", value: null },
                { label: "Add Page", value: "ok", primary: true }
            ]
        }).then(function (v) {
            if (v !== "ok") { return; }
            var name = nameInput.value.trim() || "Untitled";
            var pg = WBModel.addPage(name, { blank: blank.querySelector("input").checked });
            WBModel.commit("Add page");
            render();
            WBApp.switchPage(pg.id);
        });
    }

    function deletePage(page) {
        WBUI.confirm(
            "Delete Page",
            "Delete “" + page.name + "” and everything on it? This cannot be undone from the file, only with Undo.",
            "Delete", true
        ).then(function (ok) {
            if (!ok) { return; }
            WBModel.removePage(page.id);
            WBModel.commit("Delete page");
            render();
            WBApp.switchPage(WBModel.get().activePageId);
        });
    }

    /* ------------------------------------------------- page settings -- */

    function renderSettings() {
        if (!settingsEl) { return; }
        WBUI.clear(settingsEl);
        var page = WBModel.activePage();
        if (!page) { return; }
        var isHome = WBModel.pageFileName(page) === "index.html";

        settingsEl.appendChild(WBUI.el("div", { class: "wb-subpanel-title" }, [
            WBUI.el("span", { class: "wb-subpanel-icon", html: WBIcon(pageIcon(page), 14) }),
            WBUI.el("span", { text: page.name })
        ]));

        settingsEl.appendChild(WBUI.field("Page Title",
            WBUI.textInput(page.title || page.name, function (v) {
                page.title = v;
                WBModel.commit("Page title", "ptitle:" + page.id);
            }, { placeholder: "Shown in the browser tab" })
        ));

        var slugInput = WBUI.textInput(isHome ? "/" : "/" + WBModel.pageFileName(page), function (v) {
            var clean = v.replace(/^\/+/, "").replace(/\.html?$/i, "");
            page.slug = clean === "" || clean === "index" ? "" : WBModel.slugify(clean);
            WBModel.commit("Page slug", "pslug:" + page.id);
            render();
        }, { mono: true });
        settingsEl.appendChild(WBUI.field("URL Slug", slugInput));

        settingsEl.appendChild(WBUI.field("Visibility",
            WBUI.selectControl([
                { value: "public", label: "Public" },
                { value: "hidden", label: "Hidden (not published)" }
            ], page.visibility, function (v) {
                page.visibility = v;
                WBModel.commit("Page visibility");
                render();
            })
        ));

        settingsEl.appendChild(WBUI.field("Description",
            WBUI.textArea(page.description || "", function (v) {
                page.description = v;
                WBModel.commit("Page description", "pdesc:" + page.id);
            }, { rows: 2, placeholder: "Used as the page meta description" })
        ));
    }

    return {
        init: init,
        render: render,
        renderSettings: renderSettings,
        _dragId: null
    };
})();
