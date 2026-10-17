/*
    listing.js

    The file list itself: sorting, paging, list and grid markup, selection
    (click, Ctrl / Shift click, rubber band, keyboard, touch long press),
    drag and drop (moving items onto folders, the sidebar and the path, and
    files dropped in from the computer) and lazily loaded thumbnails.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    var thumbObserver = null;
    var DRAG_TYPE = "application/x-arozos-drive";

    function S() {
        return Drive.state;
    }

    /* ------------------------------------------------------------------ */
    /*  Labels                                                             */
    /* ------------------------------------------------------------------ */
    var TYPE_LABEL = {
        folder: ["type/folder", "Folder"], image: ["type/image", "Image"], video: ["type/video", "Video"],
        audio: ["type/audio", "Audio"], pdf: ["type/pdf", "PDF"], doc: ["type/doc", "Document"],
        sheet: ["type/sheet", "Spreadsheet"], slide: ["type/slide", "Presentation"], text: ["type/text", "Text"],
        code: ["type/code", "Code"], archive: ["type/archive", "Archive"], design: ["type/design", "Design"],
        font: ["type/font", "Font"], ebook: ["type/ebook", "E-book"], exe: ["type/exe", "Application"],
        model: ["type/model", "3D model"], disk: ["type/disk", "Disk image"], data: ["type/data", "Database"],
        shortcut: ["type/shortcut", "Shortcut"]
    };

    function typeLabel(item) {
        var cat = DriveIcons.category(item.name, item.isDir);
        if (TYPE_LABEL[cat]) {
            return T(TYPE_LABEL[cat][0], TYPE_LABEL[cat][1]);
        }
        var ext = DriveIcons.getExt(item.name);
        return ext ? T("type/extFile", "{ext} file", { ext: ext.toUpperCase() }) : T("type/file", "File");
    }

    function audienceText(share) {
        if (!share) {
            return "-";
        }
        var p = String(share.Permission || "");
        if (p.indexOf("anyone") == 0) {
            return share.HasPassword ? T("audience/anyonePw", "Anyone with the link and password") : T("audience/anyone", "Anyone with the link");
        }
        if (p.indexOf("signedin") == 0) {
            return T("audience/signedin", "Signed-in users");
        }
        if (p.indexOf("samegroup") == 0) {
            return T("audience/samegroup", "People in the same group");
        }
        var m = /\((.*)\)/.exec(p);
        var names = m ? m[1] : (share.Accessibles || []).join(", ");
        if (p.indexOf("groups") == 0) {
            return T("audience/groups", "Groups: {names}", { names: names });
        }
        if (p.indexOf("users") == 0) {
            return names;
        }
        return p;
    }

    function columnText(item, key) {
        switch (key) {
            case "mtime":
                return item.mtime ? DriveUI.fmtDate(item.mtime) : "-";
            case "size":
                return item.isDir ? "-" : DriveUI.fmtSize(item.size);
            case "type":
                return typeLabel(item);
            case "location":
                return Drive.locationLabel(item.path);
            case "origin":
                return item.origin ? Drive.pathParts(Drive.normDir(item.origin)).map(function (p) { return p.label; }).join(" / ") : "-";
            case "owner":
                return item.owner == S().user.name ? T("owner/me", "me") : (item.owner || "-");
            case "access":
                return audienceText(item.share);
            case "expire":
                if (!item.share) {
                    return "-";
                }
                if (item.share.IsExpired) {
                    return T("share/expired", "Expired");
                }
                return item.share.ExpireAt > 0 ? DriveUI.fmtDay(item.share.ExpireAt) : T("share/never", "Never");
            case "activity":
                return DriveUI.fmtRelative(item.activity) + " · " + (item.openedLast ? T("recent/opened", "Opened") : T("recent/modified", "Modified"));
        }
        return "";
    }

    function sortValue(item, key) {
        switch (key) {
            case "name": return item.name.toLowerCase();
            case "mtime": return item.mtime || 0;
            case "size": return item.isDir ? -1 : (item.size || 0);
            case "activity": return item.activity || 0;
            case "expire": return item.share && item.share.ExpireAt > 0 ? item.share.ExpireAt : Number.MAX_SAFE_INTEGER;
            default: return columnText(item, key).toLowerCase();
        }
    }

    var collator = (typeof Intl !== "undefined" && Intl.Collator) ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }) : null;

    function sortItems(items) {
        var s = Drive.sortState();
        var dir = s.dir == "desc" ? -1 : 1;
        var foldersFirst = S().settings.foldersFirst && s.key != "activity";
        var out = items.slice();
        out.sort(function (a, b) {
            if (foldersFirst && a.isDir != b.isDir) {
                return a.isDir ? -1 : 1;
            }
            var va = sortValue(a, s.key), vb = sortValue(b, s.key);
            var r;
            if (typeof va === "number" && typeof vb === "number") {
                r = va - vb;
            } else {
                r = collator ? collator.compare(String(va), String(vb)) : String(va).localeCompare(String(vb));
            }
            if (r == 0 && s.key != "name") {
                r = collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name);
            }
            return r * dir;
        });
        return out;
    }

    function pageSize() {
        var n = parseInt(S().settings.pageSize, 10);
        return n > 0 ? n : 0;
    }

    function pageCount() {
        var n = pageSize();
        if (!n) {
            return 1;
        }
        return Math.max(1, Math.ceil(S().items.length / n));
    }

    function visibleItems() {
        var n = pageSize();
        if (!n) {
            return S().sorted;
        }
        var start = (S().page - 1) * n;
        return S().sorted.slice(start, start + n);
    }

    /* ------------------------------------------------------------------ */
    /*  Markup                                                             */
    /* ------------------------------------------------------------------ */
    function iconHTML(item) {
        return DriveIcons.file(item.name, item.isDir, { shared: item.isDir && item.shared && false });
    }

    function nameExtras(item) {
        var html = "";
        if (item.shared || (item.share && S().view.kind != "shared")) {
            html += '<span title="' + esc(T("badge/shared", "Shared")) + '">' + I("users") + '</span>';
        }
        if (item.shareOnly) {
            html += '<span title="' + esc(T("badge/linkOnly", "Opens through the share link")) + '">' + I("link") + '</span>';
        }
        return html;
    }

    function subLines(item, view) {
        var desktop = "";
        if (view.showLocation) {
            desktop = Drive.locationLabel(item.path);
        } else if (view.kind == "trash" && item.origin) {
            desktop = "";
        } else if (view.kind == "shared" && item.share) {
            desktop = view.key == "shared:byme" ? Drive.locationLabel(item.path) : T("shared/by", "Shared by {name}", { name: item.owner });
        }
        var mobileBits = [];
        var cols = view.columns || [];
        if (cols[0]) {
            mobileBits.push(columnText(item, cols[0].key));
        }
        if (!item.isDir && !view.noSize) {
            mobileBits.push(DriveUI.fmtSize(item.size));
        }
        return (desktop ? '<div class="sub sub-desktop" title="' + esc(desktop) + '">' + esc(desktop) + '</div>' : "") +
            '<div class="sub sub-mobile">' + esc(mobileBits.filter(Boolean).join(" · ")) + '</div>';
    }

    function rowHTML(item, view) {
        var sel = S().selection.has(item.path);
        var starred = S().starred.has(item.path);
        var cut = S().clipboard && S().clipboard.mode == "cut" && S().clipboard.paths.indexOf(item.path) >= 0;
        var cols = view.columns || [];
        var html = '<div class="row' + (sel ? " selected" : "") + (cut ? " cut" : "") + (S().focus == item.path ? " focused" : "") +
            '" data-path="' + esc(item.path) + '" draggable="' + (view.kind == "trash" || view.kind == "shared" ? "false" : "true") + '" role="row">' +
            '<div><input type="checkbox" class="check" tabindex="-1"' + (sel ? " checked" : "") + ' aria-label="' + esc(T("sel/select", "Select")) + '"></div>' +
            '<div class="name-cell"><div class="thumb">' + iconHTML(item) +
            (starred ? I("starFill", { cls: "star-mark" }) : "") + '</div>' +
            '<div class="name-text"><div class="name"><span title="' + esc(item.name) + '">' + esc(item.name) + '</span>' + nameExtras(item) + '</div>' +
            subLines(item, view) + '</div></div>';
        cols.forEach(function (c) {
            var text = columnText(item, c.key);
            html += '<div class="cell ' + c.cls + '" title="' + esc(text) + '">' + esc(text) + '</div>';
        });
        html += '<div><button class="icon-btn small more-btn" tabindex="-1" aria-label="' + esc(T("menu/actions", "Actions")) + '">' + I("moreV") + '</button></div></div>';
        return html;
    }

    function tileHTML(item, view) {
        var sel = S().selection.has(item.path);
        var starred = S().starred.has(item.path);
        var cut = S().clipboard && S().clipboard.mode == "cut" && S().clipboard.paths.indexOf(item.path) >= 0;
        var meta = item.isDir ? (view.showLocation ? Drive.locationLabel(item.path) : T("type/folder", "Folder")) :
            DriveUI.fmtSize(item.size) + (item.mtime ? " · " + DriveUI.fmtDay(item.mtime) : "");
        return '<div class="tile' + (sel ? " selected" : "") + (cut ? " cut" : "") + (S().focus == item.path ? " focused" : "") +
            '" data-path="' + esc(item.path) + '" draggable="' + (view.kind == "trash" || view.kind == "shared" ? "false" : "true") + '">' +
            '<input type="checkbox" class="check tile-check" tabindex="-1"' + (sel ? " checked" : "") + ' aria-label="' + esc(T("sel/select", "Select")) + '">' +
            (starred ? I("starFill", { cls: "tile-star" }) : "") +
            '<div class="tile-preview"><div class="tile-icon thumb-holder">' + iconHTML(item) + '</div></div>' +
            '<div class="tile-body"><div class="mini">' + iconHTML(item) + '</div><div class="name-text"><div class="name"><span title="' + esc(item.name) + '">' +
            esc(item.name) + '</span>' + nameExtras(item) + '</div><div class="sub">' + esc(meta) + '</div></div>' +
            '<button class="icon-btn small more-btn" tabindex="-1" aria-label="' + esc(T("menu/actions", "Actions")) + '">' + I("moreV") + '</button></div></div>';
    }

    var EMPTY_ART = '<svg class="art" viewBox="0 0 140 110" aria-hidden="true">' +
        '<ellipse cx="70" cy="100" rx="52" ry="6" fill="currentColor" opacity=".08"/>' +
        '<path d="M22 30a8 8 0 0 1 8-8h22l8 8h50a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8z" fill="#5c9cf8" opacity=".25"/>' +
        '<path d="M22 42a8 8 0 0 1 8-8h80a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8z" fill="#5c9cf8" opacity=".45"/>' +
        '</svg>';

    function emptyHTML(view) {
        var e = view.empty || {};
        return '<div class="state">' + EMPTY_ART + '<h3>' + esc(e.title || "") + '</h3><p>' + esc(e.text || "") + '</p>' +
            (e.action ? '<button class="btn primary" id="emptyAction">' + I(e.action.icon || "plus") + esc(e.action.label) + '</button>' : "") + '</div>';
    }

    function render() {
        var st = S();
        var view = st.view;
        var wrap = document.getElementById("listWrap");
        if (!view || view.page) {
            return;
        }
        st.sorted = sortItems(st.items);
        var pages = pageCount();
        if (st.page > pages) {
            st.page = pages;
        }
        if (st.page < 1) {
            st.page = 1;
        }
        var items = visibleItems();
        var scroll = wrap.scrollTop;

        if (st.items.length == 0) {
            wrap.innerHTML = emptyHTML(view);
            var act = document.getElementById("emptyAction");
            if (act) {
                act.addEventListener("click", view.empty.action.fn);
            }
        } else if (Drive.currentViewMode() == "grid") {
            wrap.innerHTML = '<div class="grid' + (st.selection.size ? " has-selection" : "") + '" role="grid">' +
                items.map(function (i) { return tileHTML(i, view); }).join("") + '</div>';
        } else {
            var s = Drive.sortState();
            var headCol = function (key, label, cls) {
                var sorted = s.key == key;
                return '<div class="' + (cls || "") + '"><span class="col' + (sorted ? " sorted" : "") + '" data-sort="' + key + '">' + esc(label) +
                    I(sorted && s.dir == "desc" ? "arrowDown" : "arrowUp") + '</span></div>';
            };
            var allSel = items.length > 0 && items.every(function (i) { return st.selection.has(i.path); });
            var someSel = !allSel && items.some(function (i) { return st.selection.has(i.path); });
            var head = '<div class="list-head" role="row"><div><input type="checkbox" class="check" id="selAll" tabindex="-1"' + (allSel ? " checked" : "") +
                ' aria-label="' + esc(T("sel/all", "Select all")) + '"></div>' + headCol("name", T("col/name", "Name"));
            (view.columns || []).forEach(function (c) {
                head += headCol(c.key, c.label, c.cls);
            });
            head += '<div></div></div>';
            wrap.innerHTML = head + '<div class="rows" role="rowgroup">' + items.map(function (i) { return rowHTML(i, view); }).join("") + '</div>';
            var selAll = document.getElementById("selAll");
            selAll.indeterminate = someSel;
            selAll.addEventListener("click", function (e) {
                e.stopPropagation();
                if (allSel) {
                    Drive.setSelection([]);
                } else {
                    selectAll();
                }
            });
            wrap.querySelectorAll("[data-sort]").forEach(function (h) {
                h.addEventListener("click", function () {
                    Drive.toggleSortColumn(h.getAttribute("data-sort"));
                });
            });
        }
        wrap.scrollTop = scroll;
        loadThumbs();
        Drive.renderFoot();
        Drive.renderToolbar();
    }

    /* ------------------------------------------------------------------ */
    /*  Thumbnails                                                         */
    /* ------------------------------------------------------------------ */
    var THUMB_CATS = { image: true, video: true, audio: true, design: true, model: true };
    var failedThumbs = {};

    function wantsThumb(item) {
        if (item.isDir || item.trashed || item.shareOnly) {
            return false;
        }
        var cat = DriveIcons.category(item.name, false);
        if (!THUMB_CATS[cat]) {
            return false;
        }
        //Audio and models only have a preview when the server can extract one
        if (cat == "design" && DriveIcons.getExt(item.name) != "psd") {
            return false;
        }
        return !failedThumbs[item.path];
    }

    function applyThumb(node, src) {
        var holder = node.querySelector(".tile-preview") || node.querySelector(".thumb");
        if (!holder || holder.querySelector("img.thumb-img")) {
            return;
        }
        var img = new Image();
        img.className = "thumb-img";
        img.alt = "";
        img.decoding = "async";
        img.onload = function () {
            if (!node.isConnected) {
                return;
            }
            holder.appendChild(img);
            var icon = holder.querySelector(".tile-icon") || holder.querySelector("svg.ft");
            if (icon) {
                icon.style.display = "none";
            }
        };
        img.onerror = function () {
            failedThumbs[node.getAttribute("data-path")] = true;
        };
        img.src = src;
    }

    function loadThumbFor(node) {
        var item = Drive.itemByPath(node.getAttribute("data-path"));
        if (!item || !wantsThumb(item)) {
            return;
        }
        if (DriveAPI.caps.fm) {
            applyThumb(node, DriveAPI.thumbURL(item.path) + "&t=" + (item.mtime || 0));
        } else {
            DriveAPI.thumbFallback(item.path).then(function (data) {
                if (data) {
                    applyThumb(node, data);
                } else {
                    failedThumbs[item.path] = true;
                }
            }).catch(function () {
                failedThumbs[item.path] = true;
            });
        }
    }

    function loadThumbs() {
        if (thumbObserver) {
            thumbObserver.disconnect();
        }
        if (!S().settings.thumbnails) {
            return;
        }
        var nodes = document.querySelectorAll("#listWrap .row, #listWrap .tile");
        if (!("IntersectionObserver" in window)) {
            nodes.forEach(loadThumbFor);
            return;
        }
        thumbObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) {
                    thumbObserver.unobserve(en.target);
                    loadThumbFor(en.target);
                }
            });
        }, { root: document.getElementById("listWrap"), rootMargin: "200px" });
        nodes.forEach(function (n) { thumbObserver.observe(n); });
    }

    /* ------------------------------------------------------------------ */
    /*  Selection                                                          */
    /* ------------------------------------------------------------------ */
    function nodes() {
        return Array.prototype.slice.call(document.querySelectorAll("#listWrap .row, #listWrap .tile"));
    }

    function nodeFor(path) {
        var list = nodes();
        for (var i = 0; i < list.length; i++) {
            if (list[i].getAttribute("data-path") == path) {
                return list[i];
            }
        }
        return null;
    }

    function updateSelection() {
        var st = S();
        nodes().forEach(function (n) {
            var p = n.getAttribute("data-path");
            var on = st.selection.has(p);
            n.classList.toggle("selected", on);
            n.classList.toggle("focused", st.focus == p);
            var cb = n.querySelector(".check");
            if (cb) {
                cb.checked = on;
            }
        });
        var grid = document.querySelector("#listWrap .grid");
        if (grid) {
            grid.classList.toggle("has-selection", st.selection.size > 0);
        }
        var selAll = document.getElementById("selAll");
        if (selAll) {
            var items = visibleItems();
            var all = items.length > 0 && items.every(function (i) { return st.selection.has(i.path); });
            selAll.checked = all;
            selAll.indeterminate = !all && items.some(function (i) { return st.selection.has(i.path); });
        }
    }

    function selectAll() {
        var paths = visibleItems().map(function (i) { return i.path; });
        Drive.setSelection(paths, { anchor: paths[0] || null });
    }

    function rangeSelect(toPath, additive) {
        var list = visibleItems().map(function (i) { return i.path; });
        var a = list.indexOf(S().anchor);
        var b = list.indexOf(toPath);
        if (a < 0) {
            a = b;
        }
        var lo = Math.min(a, b), hi = Math.max(a, b);
        var set = additive ? Array.from(S().selection) : [];
        for (var i = lo; i <= hi; i++) {
            if (set.indexOf(list[i]) < 0) {
                set.push(list[i]);
            }
        }
        Drive.setSelection(set, { focus: toPath });
    }

    function toggle(path) {
        var set = new Set(S().selection);
        if (set.has(path)) {
            set.delete(path);
        } else {
            set.add(path);
        }
        Drive.setSelection(Array.from(set), { anchor: path, focus: path });
    }

    function gridColumns() {
        var grid = document.querySelector("#listWrap .grid");
        if (!grid) {
            return 1;
        }
        var tiles = grid.children;
        if (tiles.length < 2) {
            return 1;
        }
        var top = tiles[0].offsetTop;
        var cols = 0;
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].offsetTop != top) {
                break;
            }
            cols++;
        }
        return cols || 1;
    }

    function moveFocus(key, extend) {
        var list = visibleItems();
        if (list.length == 0) {
            return false;
        }
        var paths = list.map(function (i) { return i.path; });
        var idx = paths.indexOf(S().focus);
        var grid = Drive.currentViewMode() == "grid";
        var step = grid ? gridColumns() : 1;
        var next = idx;
        if (idx < 0) {
            next = 0;
        } else if (key == "ArrowDown") {
            next = Math.min(paths.length - 1, idx + step);
        } else if (key == "ArrowUp") {
            next = Math.max(0, idx - step);
        } else if (key == "ArrowRight" && grid) {
            next = Math.min(paths.length - 1, idx + 1);
        } else if (key == "ArrowLeft" && grid) {
            next = Math.max(0, idx - 1);
        } else if (key == "Home") {
            next = 0;
        } else if (key == "End") {
            next = paths.length - 1;
        } else {
            return false;
        }
        var target = paths[next];
        if (extend) {
            if (!S().anchor) {
                S().anchor = paths[Math.max(0, idx)];
            }
            rangeSelect(target, false);
        } else {
            Drive.setSelection([target], { anchor: target, focus: target });
        }
        var n = nodeFor(target);
        if (n) {
            n.scrollIntoView({ block: "nearest" });
        }
        return true;
    }

    /* ------------------------------------------------------------------ */
    /*  Container events                                                   */
    /* ------------------------------------------------------------------ */
    var longPress = null;

    function itemFromNode(n) {
        return n ? Drive.itemByPath(n.getAttribute("data-path")) : null;
    }

    function bindContainer() {
        var wrap = document.getElementById("listWrap");

        wrap.addEventListener("click", function (e) {
            if (S().view && S().view.page) {
                return;
            }
            var n = e.target.closest(".row, .tile");
            if (!n) {
                if (!e.target.closest(".list-head, .state, button, input") && !marqueeMoved) {
                    if (S().selection.size) {
                        Drive.setSelection([]);
                    }
                }
                return;
            }
            var path = n.getAttribute("data-path");
            var item = itemFromNode(n);
            if (e.target.closest(".more-btn")) {
                e.stopPropagation();
                if (!S().selection.has(path)) {
                    Drive.setSelection([path], { anchor: path, focus: path });
                }
                DriveActions.contextMenu({ anchor: e.target.closest(".more-btn"), align: "end" }, item);
                return;
            }
            if (e.target.closest(".check")) {
                e.stopPropagation();
                toggle(path);
                return;
            }
            if (e.target.closest(".rename-input")) {
                return;
            }
            if (e.shiftKey) {
                rangeSelect(path, e.ctrlKey || e.metaKey);
            } else if (e.ctrlKey || e.metaKey) {
                toggle(path);
            } else if (coarse) {
                //Touch: a tap opens, unless the user is picking items
                if (S().selection.size > 0) {
                    toggle(path);
                } else {
                    DriveActions.open(item);
                }
            } else {
                Drive.setSelection([path], { anchor: path, focus: path });
            }
        });

        wrap.addEventListener("dblclick", function (e) {
            var n = e.target.closest(".row, .tile");
            if (!n || coarse || e.target.closest(".check, .more-btn, .rename-input")) {
                return;
            }
            DriveActions.open(itemFromNode(n));
        });

        wrap.addEventListener("contextmenu", function (e) {
            if (S().view && S().view.page) {
                return;
            }
            if (e.target.closest(".rename-input")) {
                return;
            }
            e.preventDefault();
            var n = e.target.closest(".row, .tile");
            if (!n) {
                if (S().selection.size) {
                    Drive.setSelection([]);
                }
                DriveActions.backgroundMenu({ x: e.clientX, y: e.clientY });
                return;
            }
            var path = n.getAttribute("data-path");
            if (!S().selection.has(path)) {
                Drive.setSelection([path], { anchor: path, focus: path });
            }
            DriveActions.contextMenu({ x: e.clientX, y: e.clientY }, itemFromNode(n));
        });

        //Touch long press selects
        wrap.addEventListener("touchstart", function (e) {
            var n = e.target.closest(".row, .tile");
            if (!n || e.touches.length > 1) {
                return;
            }
            var startX = e.touches[0].clientX, startY = e.touches[0].clientY;
            longPress = {
                x: startX, y: startY, timer: setTimeout(function () {
                    longPress.fired = true;
                    var path = n.getAttribute("data-path");
                    if (!S().selection.has(path)) {
                        toggle(path);
                    }
                    if (navigator.vibrate) {
                        navigator.vibrate(15);
                    }
                }, 480)
            };
        }, { passive: true });
        wrap.addEventListener("touchmove", function (e) {
            if (longPress && (Math.abs(e.touches[0].clientX - longPress.x) > 8 || Math.abs(e.touches[0].clientY - longPress.y) > 8)) {
                clearTimeout(longPress.timer);
                longPress = null;
            }
        }, { passive: true });
        wrap.addEventListener("touchend", function (e) {
            if (longPress) {
                clearTimeout(longPress.timer);
                if (longPress.fired) {
                    e.preventDefault();
                }
                longPress = null;
            }
        });

        bindMarquee(wrap);
        bindDrag(wrap);
        bindExternalDrop();
    }

    /* Rubber band ------------------------------------------------------ */
    var marqueeMoved = false;

    function bindMarquee(wrap) {
        wrap.addEventListener("mousedown", function (e) {
            if (e.button != 0 || coarse || !S().view || S().view.page) {
                return;
            }
            if (e.target.closest(".row, .tile, button, input, a, .list-head, .state")) {
                return;
            }
            //Ignore presses on the scrollbar
            if (e.offsetX > wrap.clientWidth) {
                return;
            }
            var rect = wrap.getBoundingClientRect();
            var startX = e.clientX - rect.left + wrap.scrollLeft;
            var startY = e.clientY - rect.top + wrap.scrollTop;
            var base = (e.ctrlKey || e.metaKey) ? Array.from(S().selection) : [];
            var box = null;
            marqueeMoved = false;
            var last = null;

            function move(ev) {
                var r = wrap.getBoundingClientRect();
                var x = ev.clientX - r.left + wrap.scrollLeft;
                var y = ev.clientY - r.top + wrap.scrollTop;
                if (!marqueeMoved && Math.abs(x - startX) < 5 && Math.abs(y - startY) < 5) {
                    return;
                }
                marqueeMoved = true;
                if (!box) {
                    box = document.createElement("div");
                    box.className = "marquee";
                    wrap.appendChild(box);
                }
                var left = Math.min(x, startX), top = Math.min(y, startY);
                var w = Math.abs(x - startX), h = Math.abs(y - startY);
                box.style.left = left + "px";
                box.style.top = top + "px";
                box.style.width = w + "px";
                box.style.height = h + "px";
                var sel = base.slice();
                nodes().forEach(function (n) {
                    var nr = n.getBoundingClientRect();
                    var nl = nr.left - r.left + wrap.scrollLeft, nt = nr.top - r.top + wrap.scrollTop;
                    if (nl < left + w && nl + nr.width > left && nt < top + h && nt + nr.height > top) {
                        var p = n.getAttribute("data-path");
                        if (sel.indexOf(p) < 0) {
                            sel.push(p);
                        }
                    }
                });
                var key = sel.join("\n");
                if (key != last) {
                    last = key;
                    Drive.setSelection(sel, { anchor: sel[0] || null });
                }
                //Scroll while dragging near the edges
                if (ev.clientY > r.bottom - 20) {
                    wrap.scrollTop += 12;
                } else if (ev.clientY < r.top + 20) {
                    wrap.scrollTop -= 12;
                }
            }

            function up() {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", up);
                if (box) {
                    box.remove();
                }
                setTimeout(function () { marqueeMoved = false; }, 0);
            }
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        });
    }

    /* Internal drag and drop ----------------------------------------------- */
    var dragPaths = null;

    function bindDrag(wrap) {
        wrap.addEventListener("dragstart", function (e) {
            var n = e.target.closest(".row, .tile");
            if (!n || n.getAttribute("draggable") != "true") {
                return;
            }
            var path = n.getAttribute("data-path");
            if (!S().selection.has(path)) {
                Drive.setSelection([path], { anchor: path, focus: path });
            }
            var items = Drive.selectedItems();
            dragPaths = items.map(function (i) { return i.path; });
            e.dataTransfer.effectAllowed = "copyMove";
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragPaths));
            //Same shape the desktop and the File Manager use, for drops into other apps
            e.dataTransfer.setData("filedata", JSON.stringify(items.map(function (i) {
                return { filename: i.name, filepath: i.path };
            })));
            var ghost = document.getElementById("dragGhost");
            ghost.innerHTML = I(items.length == 1 && items[0].isDir ? "folder" : "file") + '<span>' +
                esc(items.length == 1 ? items[0].name : T("drag/items", "{n} items", { n: items.length })) + '</span>';
            if (e.dataTransfer.setDragImage) {
                e.dataTransfer.setDragImage(ghost, 14, 14);
            }
        });
        wrap.addEventListener("dragend", function () {
            dragPaths = null;
            clearDropTargets();
        });
        bindDropTargets(wrap);
    }

    function clearDropTargets() {
        document.querySelectorAll(".drop-target").forEach(function (n) { n.classList.remove("drop-target"); });
    }

    function isInternal(e) {
        return dragPaths != null || (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], DRAG_TYPE) >= 0);
    }

    function hasFiles(e) {
        return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0;
    }

    //Folder rows, tiles and anything carrying data-drop accept drops
    function dropTargetOf(e) {
        var t = e.target.closest("[data-drop], .row, .tile");
        if (!t) {
            return null;
        }
        if (t.hasAttribute("data-drop")) {
            var d = t.getAttribute("data-drop");
            return d ? { node: t, path: Drive.normDir(d) } : null;
        }
        var item = itemFromNode(t);
        if (item && item.isDir && !item.trashed && !item.shareOnly && S().view.kind != "trash") {
            return { node: t, path: Drive.normDir(item.path) };
        }
        return null;
    }

    function bindDropTargets(root) {
        if (root.__driveDrop) {
            return;
        }
        root.__driveDrop = true;
        root.addEventListener("dragover", function (e) {
            var internal = isInternal(e);
            if (!internal && !hasFiles(e)) {
                return;
            }
            var target = dropTargetOf(e);
            if (!target || !Drive.isWritable(target.path)) {
                return;
            }
            if (internal && dragPaths && dragPaths.some(function (p) { return (target.path).indexOf(Drive.normDir(p)) == 0; })) {
                //A folder cannot be dropped into itself
                e.dataTransfer.dropEffect = "none";
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = internal ? ((e.ctrlKey || e.altKey) ? "copy" : "move") : "copy";
            if (!target.node.classList.contains("drop-target")) {
                clearDropTargets();
                target.node.classList.add("drop-target");
            }
            hideDropOverlay();
        });
        root.addEventListener("dragleave", function (e) {
            var t = e.target.closest("[data-drop], .row, .tile");
            if (t && !t.contains(e.relatedTarget)) {
                t.classList.remove("drop-target");
            }
        });
        root.addEventListener("drop", function (e) {
            var target = dropTargetOf(e);
            if (!target) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            clearDropTargets();
            hideDropOverlay();
            if (isInternal(e)) {
                var paths = dragPaths;
                if (!paths) {
                    try {
                        paths = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
                    } catch (ex) {
                        paths = [];
                    }
                }
                dragPaths = null;
                var items = paths.map(function (p) { return Drive.itemByPath(p) || { name: DriveAPI.baseName(p), path: p }; });
                DriveActions.transfer(items, target.path, (e.ctrlKey || e.altKey) ? "copy" : "move");
            } else if (hasFiles(e)) {
                DriveTransfers.fromDataTransfer(e.dataTransfer, target.path);
            }
        });
    }

    /* Files dragged in from the computer ----------------------------------- */
    var overlay = null;
    var dragDepth = 0;

    function showDropOverlay() {
        var view = S().view;
        if (!view || view.kind != "drive" || !view.writable) {
            return;
        }
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "drop-overlay";
            document.getElementById("card").appendChild(overlay);
        }
        var label = Drive.pathParts(view.path);
        overlay.innerHTML = '<div>' + I("upload") + '<span>' + esc(T("drop/upload", "Drop to upload to {name}", { name: label[label.length - 1].label })) + '</span></div>';
        overlay.hidden = false;
    }

    function hideDropOverlay() {
        if (overlay) {
            overlay.hidden = true;
        }
    }

    function bindExternalDrop() {
        var card = document.getElementById("card");
        card.addEventListener("dragenter", function (e) {
            if (hasFiles(e) && !isInternal(e)) {
                dragDepth++;
                showDropOverlay();
            }
        });
        card.addEventListener("dragleave", function (e) {
            if (hasFiles(e) && !isInternal(e)) {
                dragDepth = Math.max(0, dragDepth - 1);
                if (dragDepth == 0) {
                    hideDropOverlay();
                }
            }
        });
        card.addEventListener("dragover", function (e) {
            var view = S().view;
            if (hasFiles(e) && !isInternal(e) && view && view.kind == "drive" && view.writable) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (!e.target.closest(".row, .tile") || !dropTargetOf(e)) {
                    clearDropTargets();
                    showDropOverlay();
                }
            }
        });
        card.addEventListener("drop", function (e) {
            dragDepth = 0;
            hideDropOverlay();
            var view = S().view;
            if (hasFiles(e) && !isInternal(e) && view && view.kind == "drive" && view.writable) {
                e.preventDefault();
                DriveTransfers.fromDataTransfer(e.dataTransfer, view.path);
            }
        });
        //Never let a stray drop navigate the page away
        window.addEventListener("dragover", function (e) {
            if (hasFiles(e)) {
                e.preventDefault();
            }
        });
        window.addEventListener("drop", function (e) {
            if (hasFiles(e)) {
                e.preventDefault();
                dragDepth = 0;
                hideDropOverlay();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Inline rename                                                      */
    /* ------------------------------------------------------------------ */
    function startRename(item, onCommit) {
        var n = nodeFor(item.path);
        if (!n) {
            return false;
        }
        var nameEl = n.querySelector(".name > span");
        if (!nameEl) {
            return false;
        }
        var input = document.createElement("input");
        input.className = "rename-input";
        input.value = item.name;
        input.spellcheck = false;
        nameEl.replaceWith(input);
        n.setAttribute("draggable", "false");
        input.focus();
        var dot = item.isDir ? -1 : item.name.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : item.name.length);
        var done = false;
        function finish(commit) {
            if (done) {
                return;
            }
            done = true;
            var value = input.value.trim();
            if (commit && value && value != item.name) {
                onCommit(value);
            } else {
                render();
            }
        }
        input.addEventListener("keydown", function (e) {
            e.stopPropagation();
            if (e.key == "Enter") {
                finish(true);
            } else if (e.key == "Escape") {
                finish(false);
            }
        });
        input.addEventListener("blur", function () { finish(true); });
        input.addEventListener("click", function (e) { e.stopPropagation(); });
        input.addEventListener("dblclick", function (e) { e.stopPropagation(); });
        return true;
    }

    global.DriveList = {
        render: render,
        updateSelection: updateSelection,
        selectAll: selectAll,
        moveFocus: moveFocus,
        pageCount: pageCount,
        visibleItems: visibleItems,
        bindContainer: bindContainer,
        bindDropTargets: bindDropTargets,
        startRename: startRename,
        typeLabel: typeLabel,
        audienceText: audienceText,
        nodeFor: nodeFor,
        wantsThumb: wantsThumb
    };
})(window);
