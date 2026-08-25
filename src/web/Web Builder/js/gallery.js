/*
    gallery.js

    The template chooser shown by New Site.

    Each card previews the real thing: the template's home page is built and
    rendered into a scaled-down iframe, so what you pick is exactly what you
    get. Previews are built lazily as cards scroll into view - building twelve
    multi-page sites up front would stall the modal on a Raspberry Pi.
*/

var WBGallery = (function () {

    var filter = "";
    var category = "All";
    var selected = null;      /* template id, or "" for a blank site */
    var observer = null;

    /*
        Opens the chooser. Resolves with { templateId, name } or null when the
        user backs out. templateId is "" for a blank site.
    */
    function open(defaultName) {
        filter = "";
        category = "All";
        selected = WBTemplates.all().length ? WBTemplates.all()[0].id : "";

        var nameInput = WBUI.textInput(defaultName || "My Website", function () {}, {
            placeholder: "Site name"
        });
        nameInput.style.width = "220px";

        var body = WBUI.el("div", { class: "wb-tpl-body" });
        var toolbar = WBUI.el("div", { class: "wb-tpl-toolbar" });
        var grid = WBUI.el("div", { class: "wb-tpl-grid" });

        toolbar.appendChild(WBUI.searchBox("Search templates...", function (q) {
            filter = q;
            renderGrid(grid);
        }));

        var chips = WBUI.el("div", { class: "wb-tpl-chips" });
        toolbar.appendChild(chips);
        renderChips(chips, grid);

        body.appendChild(toolbar);
        body.appendChild(grid);
        renderGrid(grid);

        var footerLeft = WBUI.el("div", { class: "wb-tpl-namefield" }, [
            WBUI.el("label", { class: "wb-label", text: "Site name", style: "margin:0 8px 0 0" }),
            nameInput
        ]);

        return WBUI.modal({
            title: "Start a new site",
            body: body,
            size: "xl",
            footerLeft: footerLeft,
            buttons: [
                { label: "Cancel", value: null },
                { label: "Create Site", value: "create", primary: true }
            ]
        }).then(function (v) {
            teardown();
            if (v !== "create") { return null; }
            return {
                templateId: selected,
                name: nameInput.value.trim() || "My Website"
            };
        });
    }

    function teardown() {
        if (observer) { observer.disconnect(); observer = null; }
    }

    function renderChips(chips, grid) {
        WBUI.clear(chips);
        var cats = ["All"].concat(WBTemplates.categories());
        cats.forEach(function (c) {
            var b = WBUI.el("button", {
                class: "wb-chip" + (c === category ? " active" : ""),
                type: "button",
                text: c,
                onclick: function () {
                    category = c;
                    renderChips(chips, grid);
                    renderGrid(grid);
                }
            });
            chips.appendChild(b);
        });
    }

    function matches(tpl) {
        if (category !== "All" && tpl.category !== category) { return false; }
        if (!filter) { return true; }
        var hay = (tpl.name + " " + tpl.category + " " + (tpl.tagline || "")).toLowerCase();
        return hay.indexOf(filter) >= 0;
    }

    function renderGrid(grid) {
        teardown();
        WBUI.clear(grid);

        if (category === "All" && !filter) {
            grid.appendChild(blankCard(grid));
        }

        var shown = WBTemplates.all().filter(matches);
        shown.forEach(function (tpl) { grid.appendChild(card(tpl, grid)); });

        if (!shown.length && (filter || category !== "All")) {
            grid.appendChild(WBUI.el("div", {
                class: "wb-empty",
                style: "grid-column:1/-1",
                text: "No template matches that search."
            }));
        }
        observePreviews(grid);
    }

    function markSelected(grid, id) {
        selected = id;
        var cards = grid.querySelectorAll(".wb-tpl-card");
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.toggle("selected", cards[i].getAttribute("data-tpl") === id);
        }
    }

    function blankCard(grid) {
        var c = WBUI.el("div", {
            class: "wb-tpl-card" + (selected === "" ? " selected" : ""),
            "data-tpl": "",
            title: "Start from an empty page"
        });
        c.appendChild(WBUI.el("div", { class: "wb-tpl-preview blank" }, [
            WBUI.el("div", { class: "wb-tpl-blank-mark", html: WBIcon("plus", 24) })
        ]));
        c.appendChild(WBUI.el("div", { class: "wb-tpl-meta" }, [
            WBUI.el("div", { class: "wb-tpl-name", text: "Blank" }),
            WBUI.el("div", { class: "wb-tpl-cat", text: "One empty page" })
        ]));
        c.addEventListener("click", function () { markSelected(grid, ""); });
        c.addEventListener("dblclick", function () {
            markSelected(grid, "");
            WBUI.closeModal("create");
        });
        return c;
    }

    function card(tpl, grid) {
        var c = WBUI.el("div", {
            class: "wb-tpl-card" + (selected === tpl.id ? " selected" : ""),
            "data-tpl": tpl.id,
            title: tpl.tagline || tpl.name
        });

        var preview = WBUI.el("div", { class: "wb-tpl-preview" });
        preview.setAttribute("data-pending", tpl.id);
        c.appendChild(preview);

        c.appendChild(WBUI.el("div", { class: "wb-tpl-meta" }, [
            WBUI.el("div", { class: "wb-tpl-name", text: tpl.name }),
            WBUI.el("div", { class: "wb-tpl-cat", text: tpl.category + " - " + pageCount(tpl) + " pages" })
        ]));

        c.addEventListener("click", function () { markSelected(grid, tpl.id); });
        c.addEventListener("dblclick", function () {
            markSelected(grid, tpl.id);
            WBUI.closeModal("create");
        });
        return c;
    }

    function pageCount(tpl) {
        return (tpl.pages || []).length;
    }

    /* Build previews only for cards that are actually on screen. */
    function observePreviews(grid) {
        var pending = grid.querySelectorAll("[data-pending]");
        if (!window.IntersectionObserver) {
            for (var i = 0; i < pending.length; i++) { buildPreview(pending[i]); }
            return;
        }
        observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) { return; }
                observer.unobserve(e.target);
                buildPreview(e.target);
            });
        }, { root: grid.parentNode, rootMargin: "220px" });

        for (var j = 0; j < pending.length; j++) { observer.observe(pending[j]); }
    }

    var PREVIEW_WIDTH = 1280;
    var PREVIEW_HEIGHT = 1000;

    function buildPreview(holder) {
        var id = holder.getAttribute("data-pending");
        holder.removeAttribute("data-pending");
        var tpl = WBTemplates.get(id);
        if (!tpl) { return; }

        var html;
        try {
            html = WBTemplates.previewDocument(tpl);
        } catch (err) {
            console.error("[wb] template preview failed for " + id, err);
            holder.classList.add("blank");
            holder.appendChild(WBUI.el("div", { class: "wb-tpl-blank-mark", html: WBIcon("alert", 20) }));
            return;
        }

        var frame = WBUI.el("iframe", {
            class: "wb-tpl-frame",
            scrolling: "no",
            tabindex: "-1",
            title: tpl.name + " preview"
        });
        frame.setAttribute("aria-hidden", "true");
        frame.style.width = PREVIEW_WIDTH + "px";
        frame.style.height = PREVIEW_HEIGHT + "px";
        holder.appendChild(frame);
        scalePreview(holder, frame);

        /* srcdoc keeps the preview inert and same-origin without a round trip */
        frame.srcdoc = html;

        if (window.ResizeObserver) {
            var ro = new ResizeObserver(function () { scalePreview(holder, frame); });
            ro.observe(holder);
        }
    }

    function scalePreview(holder, frame) {
        var w = holder.clientWidth;
        if (!w) { return; }
        frame.style.transform = "scale(" + (w / PREVIEW_WIDTH) + ")";
    }

    return { open: open };
})();
