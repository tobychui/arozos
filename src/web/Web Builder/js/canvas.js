/*
    canvas.js

    The editing stage.

    The page under construction is rendered into a same-origin <iframe> so that
    its CSS is fully isolated from the builder chrome and what you see matches
    what gets published. Everything interactive - selection box, hover outline,
    element badges, resize handles, drop indicator - is drawn in the parent
    document on an overlay laid over the frame, using rectangles measured inside
    the frame and multiplied by the current zoom.

    Layout inside #wb-stage:

        #wb-stage-inner
          #wb-frame-holder    width = deviceWidth * zoom   (centred)
            #wb-frame-wrap    width = deviceWidth, transform: scale(zoom)
              #wb-frame-shell > iframe
            #wb-overlay       absolute, unscaled, hosts all handles

    Public surface is WBCanvas.*; the builder calls back through the handlers
    assigned in js/app.js (onSelect / onChange / onEditStart ...).
*/

var WBCanvas = (function () {

    var frame = null;         /* the <iframe> element               */
    var doc = null;           /* its document                       */
    var holder, wrap, shell, overlay, stage, stageInner;
    var selectBox, hoverBox, hoverBadge, dropLine, sizeTip, badge;

    var zoom = 1;
    var device = "base";
    var selectedId = null;
    var hoverId = null;
    var editingId = null;
    var suppressHover = false;
    var previewMode = false;

    var dragCtx = null;       /* palette / move drag state          */
    var resizeCtx = null;     /* resize drag state                  */
    var rafPending = false;

    var handlers = {
        onSelect: function () {},
        onHover: function () {},
        onChange: function () {},
        onEditStateChange: function () {},
        onRequestMenu: function () {}
    };

    /* ---------------------------------------------------------- setup -- */

    function init(opts) {
        for (var k in opts) { handlers[k] = opts[k]; }

        stage = document.getElementById("wb-stage");
        stageInner = document.getElementById("wb-stage-inner");
        holder = document.getElementById("wb-frame-holder");
        wrap = document.getElementById("wb-frame-wrap");
        shell = document.getElementById("wb-frame-shell");
        frame = document.getElementById("wb-canvas-frame");
        overlay = document.getElementById("wb-overlay");
        selectBox = document.getElementById("wb-select-box");
        hoverBox = document.getElementById("wb-hover-box");
        hoverBadge = document.getElementById("wb-hover-badge");
        dropLine = document.getElementById("wb-drop-line");
        sizeTip = document.getElementById("wb-size-tip");
        badge = document.getElementById("wb-badge");

        stage.addEventListener("scroll", function () { positionTextToolbar(); });
        window.addEventListener("resize", scheduleOverlayUpdate);

        bindBadge();
        bindHandles();
        bindStageDrop();
    }

    /* ---------------------------------------------------- frame render -- */

    /*
        Full rebuild of the frame document. Used on load, page switch and any
        structural change. Style-only edits go through refreshStyles().
    */
    function render() {
        var project = WBModel.get();
        var page = WBModel.activePage();
        var html = WBRender.canvasDocument(project, page);

        var d = frame.contentDocument || frame.contentWindow.document;
        d.open();
        d.write(html);
        d.close();
        doc = d;

        bindFrame();
        /* Fonts/images settle after layout; re-measure a couple of times. */
        syncFrameHeight();
        setTimeout(function () { syncFrameHeight(); updateOverlay(); }, 60);
        setTimeout(function () { syncFrameHeight(); updateOverlay(); }, 320);
        updateOverlay();
    }

    /* Cheap update: swap only the generated stylesheet. */
    function refreshStyles() {
        if (!doc) { return; }
        var tag = doc.getElementById("wb-page-style");
        if (!tag) { return render(); }
        tag.textContent = WBRender.pageCss(WBModel.activePage());
        syncFrameHeight();
        scheduleOverlayUpdate();
    }

    /* Re-render one subtree in place (content edits that are not structural). */
    function refreshNode(id) {
        if (!doc) { return; }
        var el = doc.querySelector('[data-wb-id="' + id + '"]');
        var node = WBModel.findNode(id);
        if (!el || !node) { return render(); }
        var holderEl = doc.createElement("div");
        holderEl.innerHTML = WBRender.nodeHtml(node, { mode: "editor" });
        var fresh = holderEl.firstElementChild;
        if (!fresh) { return render(); }
        el.parentNode.replaceChild(fresh, el);
        refreshStyles();
        syncFrameHeight();
        scheduleOverlayUpdate();
    }

    function syncFrameHeight() {
        if (!doc || !doc.body) { return; }
        var h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 400);
        frame.style.height = h + "px";
        holder.style.height = Math.round(h * zoom) + "px";
    }

    /* --------------------------------------------------- frame events -- */

    function bindFrame() {
        if (!doc) { return; }
        var win = frame.contentWindow;

        doc.addEventListener("mousemove", onFrameMouseMove, true);
        doc.addEventListener("mouseleave", clearHover, true);
        doc.addEventListener("mousedown", onFrameMouseDown, true);
        doc.addEventListener("click", onFrameClick, true);
        doc.addEventListener("dblclick", onFrameDblClick, true);
        doc.addEventListener("contextmenu", onFrameContextMenu, true);
        doc.addEventListener("dragover", onFrameDragOver, false);
        doc.addEventListener("drop", onFrameDrop, false);
        doc.addEventListener("dragleave", function () { hideDropLine(); }, false);
        doc.addEventListener("keydown", onFrameKeyDown, true);
        doc.addEventListener("input", onFrameInput, true);
        win.addEventListener("scroll", scheduleOverlayUpdate);

        if (win.ResizeObserver) {
            var ro = new win.ResizeObserver(function () {
                syncFrameHeight();
                scheduleOverlayUpdate();
            });
            ro.observe(doc.body);
        }
    }

    /* Nearest selectable element for a raw event target. */
    function nodeElFrom(target) {
        var el = target;
        while (el && el !== doc.documentElement) {
            if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute("data-wb-id")) {
                if (el.getAttribute("data-wb-locked") === "1") {
                    el = el.parentNode;                    /* locked: pick the parent */
                    continue;
                }
                return el;
            }
            el = el.parentNode;
        }
        return doc.body;
    }

    function idOfEl(el) {
        return el && el.getAttribute ? el.getAttribute("data-wb-id") : null;
    }

    function onFrameMouseMove(e) {
        if (previewMode || dragCtx || resizeCtx || suppressHover) { return; }
        var el = nodeElFrom(e.target);
        var id = idOfEl(el);
        if (id === hoverId) { return; }
        hoverId = id;
        drawHover();
        handlers.onHover(id);
    }

    function clearHover() {
        hoverId = null;
        hoverBox.style.display = "none";
        hoverBadge.style.display = "none";
        handlers.onHover(null);
    }

    function onFrameMouseDown(e) {
        if (previewMode) { return; }
        if (editingId && nodeElFrom(e.target) === doc.querySelector('[data-wb-id="' + editingId + '"]')) {
            return;                                        /* caret placement */
        }
        if (e.button !== 0) { return; }
        var el = nodeElFrom(e.target);
        var id = idOfEl(el);
        if (id !== editingId) { stopTextEdit(); }
        if (id) { select(id); }
    }

    function onFrameClick(e) {
        if (previewMode) { return; }
        /* never navigate away from the canvas */
        var a = e.target.closest ? e.target.closest("a") : null;
        if (a) { e.preventDefault(); }
        if (editingId) { return; }
        e.stopPropagation();
    }

    function onFrameDblClick(e) {
        if (previewMode) { return; }
        var el = nodeElFrom(e.target);
        var id = idOfEl(el);
        if (!id) { return; }
        var node = WBModel.findNode(id);
        if (node && wbIsTextEditable(node.type)) {
            startTextEdit(id);
        }
    }

    function onFrameContextMenu(e) {
        if (previewMode) { return; }
        e.preventDefault();
        var el = nodeElFrom(e.target);
        var id = idOfEl(el);
        if (!id) { return; }
        select(id);
        /*
            e.clientX/Y are in the frame's own coordinate space. The menu is
            drawn in the parent document, so they have to be scaled by the zoom
            and offset by where the frame sits in the viewport.
        */
        var fr = frame.getBoundingClientRect();
        handlers.onRequestMenu(id, {
            x: fr.left + e.clientX * zoom,
            y: fr.top + e.clientY * zoom
        });
    }

    function onFrameKeyDown(e) {
        if (editingId) {
            if (e.key === "Escape") { e.preventDefault(); stopTextEdit(); }
            return;
        }
        /* forward canvas shortcuts to the app-level handler */
        var evt = new KeyboardEvent("keydown", {
            key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
            shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true
        });
        document.dispatchEvent(evt);
        if (evt.defaultPrevented) { e.preventDefault(); }
    }

    /* Live text typing - keep the frame height and overlay honest. */
    function onFrameInput() {
        if (!editingId) { return; }
        syncFrameHeight();
        scheduleOverlayUpdate();
        positionTextToolbar();
    }

    /* ------------------------------------------------------ selection -- */

    function select(id, opts) {
        opts = opts || {};
        if (selectedId === id && !opts.force) {
            updateOverlay();
            return;
        }
        if (editingId && editingId !== id) { stopTextEdit(); }
        selectedId = id;
        updateOverlay();
        if (!opts.silent) { handlers.onSelect(id); }
    }

    function getSelection() { return selectedId; }

    function selectedEl() {
        if (!doc || !selectedId) { return null; }
        return doc.querySelector('[data-wb-id="' + selectedId + '"]');
    }

    function scrollToNode(id) {
        if (!doc) { return; }
        var el = doc.querySelector('[data-wb-id="' + id + '"]');
        if (!el) { return; }
        var r = el.getBoundingClientRect();
        var top = holder.offsetTop + r.top * zoom;
        var want = top - stage.clientHeight / 2 + (r.height * zoom) / 2;
        stage.scrollTo({ top: Math.max(0, want), behavior: "smooth" });
    }

    /* ------------------------------------------------------- overlays -- */

    /* Convert a rect measured inside the frame into overlay coordinates. */
    function frameToScreen(r) {
        return {
            left: r.left * zoom,
            top: r.top * zoom,
            width: r.width * zoom,
            height: r.height * zoom
        };
    }

    function scheduleOverlayUpdate() {
        if (rafPending) { return; }
        rafPending = true;
        requestAnimationFrame(function () {
            rafPending = false;
            updateOverlay();
        });
    }

    function updateOverlay() {
        if (!doc) { return; }
        drawSelection();
        drawHover();
        positionTextToolbar();
    }

    function drawSelection() {
        var el = selectedEl();
        if (!el || previewMode) {
            selectBox.style.display = "none";
            return;
        }
        var r = frameToScreen(el.getBoundingClientRect());
        selectBox.style.display = "block";
        selectBox.style.left = r.left + "px";
        selectBox.style.top = r.top + "px";
        selectBox.style.width = r.width + "px";
        selectBox.style.height = r.height + "px";
        selectBox.classList.toggle("textediting", editingId === selectedId);

        var node = WBModel.findNode(selectedId);
        var label = badge.querySelector(".wb-badge-label");
        if (node && label) { label.textContent = WBModel.displayName(node); }
        /* flip the badge below the box when the element sits at the very top */
        badge.classList.toggle("below", r.top < 22);

        var isBody = node && node.type === "body";
        badge.style.display = isBody ? "none" : "flex";
        var handles = selectBox.querySelectorAll(".wb-handle");
        for (var i = 0; i < handles.length; i++) {
            handles[i].style.display = (isBody || editingId) ? "none" : "block";
        }
    }

    function drawHover() {
        if (!doc || previewMode || !hoverId || hoverId === selectedId || dragCtx) {
            hoverBox.style.display = "none";
            hoverBadge.style.display = "none";
            return;
        }
        var el = doc.querySelector('[data-wb-id="' + hoverId + '"]');
        if (!el) {
            hoverBox.style.display = "none";
            hoverBadge.style.display = "none";
            return;
        }
        var r = frameToScreen(el.getBoundingClientRect());
        hoverBox.style.display = "block";
        hoverBox.style.left = r.left + "px";
        hoverBox.style.top = r.top + "px";
        hoverBox.style.width = r.width + "px";
        hoverBox.style.height = r.height + "px";

        var node = WBModel.findNode(hoverId);
        if (node && node.type !== "body") {
            hoverBadge.textContent = WBModel.displayName(node);
            hoverBadge.style.display = "flex";
            hoverBadge.style.left = r.left + "px";
            hoverBadge.style.top = Math.max(0, r.top - 18) + "px";
        } else {
            hoverBadge.style.display = "none";
        }
    }

    /* --------------------------------------------------------- badge -- */

    function bindBadge() {
        badge.querySelector(".wb-badge-btn.edit").addEventListener("click", function (e) {
            e.stopPropagation();
            var node = WBModel.findNode(selectedId);
            if (node && wbIsTextEditable(node.type)) { startTextEdit(selectedId); }
            else { handlers.onSelect(selectedId); }
        });
        badge.querySelector(".wb-badge-btn.remove").addEventListener("click", function (e) {
            e.stopPropagation();
            handlers.onChange({ action: "delete", id: selectedId });
        });
        badge.querySelector(".wb-badge-btn.drag").addEventListener("mousedown", function (e) {
            e.preventDefault();
            e.stopPropagation();
            startMoveDrag(selectedId, e);
        });
    }

    /* -------------------------------------------------- text editing -- */

    function startTextEdit(id) {
        var node = WBModel.findNode(id);
        if (!node || !wbIsTextEditable(node.type)) { return; }
        if (editingId === id) { return; }
        stopTextEdit();

        var el = doc.querySelector('[data-wb-id="' + id + '"]');
        if (!el) { return; }
        editingId = id;
        el.setAttribute("contenteditable", "true");
        el.setAttribute("data-wb-editing", "1");
        el.focus();
        try {
            var range = doc.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            var sel = frame.contentWindow.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (err) { /* selection API unavailable - caret defaults to start */ }

        updateOverlay();
        handlers.onEditStateChange(true, id);
    }

    function stopTextEdit() {
        if (!editingId || !doc) { return; }
        var id = editingId;
        var el = doc.querySelector('[data-wb-id="' + id + '"]');
        editingId = null;
        if (el) {
            el.removeAttribute("contenteditable");
            el.removeAttribute("data-wb-editing");
            var node = WBModel.findNode(id);
            var html = el.innerHTML;
            if (node && node.props.html !== html) {
                node.props.html = html;
                WBModel.commit("Edit text", "text:" + id);
                handlers.onChange({ action: "text", id: id, silent: true });
            }
        }
        updateOverlay();
        handlers.onEditStateChange(false, id);
    }

    function isEditingText() { return !!editingId; }

    /* Rich-text command inside the editing element (bold / italic / link ...). */
    function execTextCommand(cmd, value) {
        if (!editingId || !doc) { return false; }
        frame.contentWindow.focus();
        try {
            doc.execCommand(cmd, false, value === undefined ? null : value);
        } catch (e) {
            return false;
        }
        var el = doc.querySelector('[data-wb-id="' + editingId + '"]');
        var node = WBModel.findNode(editingId);
        if (el && node) { node.props.html = el.innerHTML; }
        WBModel.commit("Format text", "fmt:" + editingId);
        scheduleOverlayUpdate();
        return true;
    }

    function queryTextState(cmd) {
        if (!editingId || !doc) { return false; }
        try { return doc.queryCommandState(cmd); } catch (e) { return false; }
    }

    function positionTextToolbar() {
        var bar = document.getElementById("wb-text-toolbar");
        if (!bar) { return; }
        var targetId = editingId || selectedId;
        var node = targetId ? WBModel.findNode(targetId) : null;
        if (previewMode || !node || !wbIsTextEditable(node.type)) {
            bar.classList.remove("show");
            return;
        }
        var el = doc && doc.querySelector('[data-wb-id="' + targetId + '"]');
        if (!el) { bar.classList.remove("show"); return; }

        bar.classList.add("show");
        var fr = frame.getBoundingClientRect();
        var r = el.getBoundingClientRect();
        var bw = bar.offsetWidth || 300;
        var left = fr.left + (r.left + r.width / 2) * zoom - bw / 2;
        var top = fr.top + r.top * zoom - bar.offsetHeight - 12;
        var stageRect = stage.getBoundingClientRect();
        if (top < stageRect.top + 6) { top = fr.top + (r.top + r.height) * zoom + 12; }
        left = Math.max(stageRect.left + 6, Math.min(left, stageRect.right - bw - 6));
        bar.style.left = Math.round(left) + "px";
        bar.style.top = Math.round(top) + "px";
    }

    /* --------------------------------------------------- drop targets -- */

    /*
        Work out where a dropped element would land.
        Returns { parentId, index, rect, horizontal } or null.
    */
    function computeDropTarget(clientX, clientY, movingId) {
        if (!doc) { return null; }
        var el = doc.elementFromPoint(clientX, clientY);
        if (!el) { return { parentId: WBModel.activePage().root.id, index: null, rect: null }; }

        /* find the closest container that can accept a child */
        var container = el;
        while (container && container !== doc.documentElement) {
            if (container.nodeType === 1 && container.hasAttribute && container.hasAttribute("data-wb-id")) {
                var cid = container.getAttribute("data-wb-id");
                var cnode = WBModel.findNode(cid);
                if (cnode && (wbIsContainer(cnode.type) || cnode.type === "body") &&
                    !(movingId && (cid === movingId || WBModel.isDescendant(movingId, cid)))) {
                    break;
                }
            }
            container = container.parentNode;
        }
        if (!container || container === doc.documentElement) { container = doc.body; }
        var parentId = container.getAttribute("data-wb-id");
        var parentNode = WBModel.findNode(parentId);
        if (!parentNode) { return null; }

        /* children that are real elements of the model */
        var kids = [];
        for (var i = 0; i < container.children.length; i++) {
            var k = container.children[i];
            if (k.hasAttribute && k.hasAttribute("data-wb-id")) {
                if (movingId && k.getAttribute("data-wb-id") === movingId) { continue; }
                kids.push(k);
            }
        }

        var cs = frame.contentWindow.getComputedStyle(container);
        var horizontal = (cs.display === "flex" && cs.flexDirection.indexOf("row") === 0) ||
                         (cs.display === "grid" && kids.length > 1 &&
                          kids[0].getBoundingClientRect().top === kids[1].getBoundingClientRect().top);

        if (!kids.length) {
            var cr = container.getBoundingClientRect();
            return {
                parentId: parentId, index: 0,
                zone: { left: cr.left, top: cr.top, width: cr.width, height: cr.height },
                horizontal: horizontal
            };
        }

        var index = kids.length;
        var rect = null;
        for (var j = 0; j < kids.length; j++) {
            var kr = kids[j].getBoundingClientRect();
            var mid = horizontal ? kr.left + kr.width / 2 : kr.top + kr.height / 2;
            var pos = horizontal ? clientX : clientY;
            if (pos < mid) {
                index = j;
                rect = { before: true, r: kr };
                break;
            }
        }
        if (!rect) { rect = { before: false, r: kids[kids.length - 1].getBoundingClientRect() }; }

        /* map the visual index back to the model index (skips the moved node) */
        var modelIndex = index;
        if (movingId) {
            var siblings = parentNode.children;
            var visual = 0;
            modelIndex = siblings.length;
            for (var s = 0; s < siblings.length; s++) {
                if (siblings[s].id === movingId) { continue; }
                if (visual === index) { modelIndex = s; break; }
                visual++;
            }
        }

        return { parentId: parentId, index: modelIndex, line: rect, horizontal: horizontal };
    }

    function showDropTarget(t) {
        if (!t) { return hideDropLine(); }
        var zoneEl = document.getElementById("wb-drop-zone");
        if (t.zone) {
            var z = frameToScreen(t.zone);
            zoneEl.style.display = "block";
            zoneEl.style.left = z.left + "px";
            zoneEl.style.top = z.top + "px";
            zoneEl.style.width = z.width + "px";
            zoneEl.style.height = z.height + "px";
            dropLine.style.display = "none";
            return;
        }
        zoneEl.style.display = "none";
        var r = frameToScreen(t.line.r);
        dropLine.style.display = "block";
        dropLine.classList.toggle("horizontal", !t.horizontal);
        dropLine.classList.toggle("vertical", !!t.horizontal);
        if (t.horizontal) {
            dropLine.style.width = "3px";
            dropLine.style.height = r.height + "px";
            dropLine.style.top = r.top + "px";
            dropLine.style.left = (t.line.before ? r.left - 2 : r.left + r.width - 1) + "px";
        } else {
            dropLine.style.height = "3px";
            dropLine.style.width = r.width + "px";
            dropLine.style.left = r.left + "px";
            dropLine.style.top = (t.line.before ? r.top - 2 : r.top + r.height - 1) + "px";
        }
    }

    function hideDropLine() {
        dropLine.style.display = "none";
        document.getElementById("wb-drop-zone").style.display = "none";
    }

    /* ------------------------------------------- palette drag (HTML5) -- */

    var pendingPaletteType = null;

    function beginPaletteDrag(type) {
        pendingPaletteType = type;
        stage.classList.add("dragging");
    }

    function endPaletteDrag() {
        pendingPaletteType = null;
        stage.classList.remove("dragging");
        hideDropLine();
    }

    function onFrameDragOver(e) {
        if (!pendingPaletteType) { return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        showDropTarget(computeDropTarget(e.clientX, e.clientY, null));
    }

    function onFrameDrop(e) {
        if (!pendingPaletteType) { return; }
        e.preventDefault();
        var t = computeDropTarget(e.clientX, e.clientY, null);
        var type = pendingPaletteType;
        endPaletteDrag();
        if (!t) { return; }
        handlers.onChange({ action: "insert", type: type, parentId: t.parentId, index: t.index });
    }

    /* Dropping onto the stage but outside the frame appends to the body. */
    function bindStageDrop() {
        stage.addEventListener("dragover", function (e) {
            if (!pendingPaletteType) { return; }
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });
        stage.addEventListener("drop", function (e) {
            if (!pendingPaletteType) { return; }
            e.preventDefault();
            var type = pendingPaletteType;
            endPaletteDrag();
            handlers.onChange({ action: "insert", type: type, parentId: null, index: null });
        });
    }

    /* ----------------------------------------- moving an existing node -- */

    function startMoveDrag(id, e) {
        if (!id) { return; }
        var node = WBModel.findNode(id);
        if (!node || node.type === "body") { return; }
        stopTextEdit();

        dragCtx = { id: id, moved: false, startX: e.clientX, startY: e.clientY, target: null };
        stage.classList.add("dragging");
        document.body.style.cursor = "grabbing";

        document.addEventListener("mousemove", onMoveDragMove, true);
        document.addEventListener("mouseup", onMoveDragUp, true);
        if (doc) {
            doc.addEventListener("mousemove", onMoveDragMoveInFrame, true);
            doc.addEventListener("mouseup", onMoveDragUp, true);
        }
    }

    function onMoveDragMoveInFrame(e) {
        if (!dragCtx) { return; }
        dragCtx.moved = true;
        dragCtx.target = computeDropTarget(e.clientX, e.clientY, dragCtx.id);
        showDropTarget(dragCtx.target);
    }

    function onMoveDragMove(e) {
        if (!dragCtx) { return; }
        /* translate parent coordinates into frame coordinates */
        var fr = frame.getBoundingClientRect();
        var x = (e.clientX - fr.left) / zoom;
        var y = (e.clientY - fr.top) / zoom;
        if (x < 0 || y < 0 || x > frame.clientWidth || y > frame.clientHeight) {
            hideDropLine();
            dragCtx.target = null;
            return;
        }
        dragCtx.moved = true;
        dragCtx.target = computeDropTarget(x, y, dragCtx.id);
        showDropTarget(dragCtx.target);
    }

    function onMoveDragUp() {
        if (!dragCtx) { return; }
        var ctx = dragCtx;
        dragCtx = null;
        stage.classList.remove("dragging");
        document.body.style.cursor = "";
        hideDropLine();
        document.removeEventListener("mousemove", onMoveDragMove, true);
        document.removeEventListener("mouseup", onMoveDragUp, true);
        if (doc) {
            doc.removeEventListener("mousemove", onMoveDragMoveInFrame, true);
            doc.removeEventListener("mouseup", onMoveDragUp, true);
        }
        if (ctx.moved && ctx.target) {
            handlers.onChange({
                action: "move", id: ctx.id,
                parentId: ctx.target.parentId, index: ctx.target.index
            });
        }
    }

    /* ---------------------------------------------------------- resize -- */

    function bindHandles() {
        var handles = selectBox.querySelectorAll(".wb-handle");
        for (var i = 0; i < handles.length; i++) {
            handles[i].addEventListener("mousedown", function (e) {
                e.preventDefault();
                e.stopPropagation();
                startResize(this.getAttribute("data-dir"), e);
            });
        }
    }

    function startResize(dir, e) {
        var el = selectedEl();
        if (!el) { return; }
        var r = el.getBoundingClientRect();
        resizeCtx = {
            dir: dir, id: selectedId,
            startX: e.clientX, startY: e.clientY,
            startW: r.width, startH: r.height
        };
        suppressHover = true;
        document.body.style.cursor = getComputedStyle(e.target).cursor;
        document.addEventListener("mousemove", onResizeMove, true);
        document.addEventListener("mouseup", onResizeUp, true);
    }

    function onResizeMove(e) {
        if (!resizeCtx) { return; }
        var dx = (e.clientX - resizeCtx.startX) / zoom;
        var dy = (e.clientY - resizeCtx.startY) / zoom;
        var d = resizeCtx.dir;
        var w = resizeCtx.startW, h = resizeCtx.startH;

        if (d.indexOf("e") >= 0) { w = resizeCtx.startW + dx; }
        if (d.indexOf("w") >= 0) { w = resizeCtx.startW - dx; }
        if (d.indexOf("s") >= 0) { h = resizeCtx.startH + dy; }
        if (d.indexOf("n") >= 0) { h = resizeCtx.startH - dy; }
        w = Math.max(8, Math.round(w));
        h = Math.max(8, Math.round(h));

        var changed = {};
        if (d.indexOf("e") >= 0 || d.indexOf("w") >= 0) { changed.width = w + "px"; }
        if (d.indexOf("n") >= 0 || d.indexOf("s") >= 0) { changed.height = h + "px"; }
        WBModel.setStyles(resizeCtx.id, changed, device);
        refreshStyles();

        sizeTip.style.display = "block";
        sizeTip.textContent = Math.round(w) + " x " + Math.round(h);
        var sr = frameToScreen(selectedEl().getBoundingClientRect());
        sizeTip.style.left = (sr.left + sr.width / 2 - 28) + "px";
        sizeTip.style.top = (sr.top + sr.height + 8) + "px";
    }

    function onResizeUp() {
        if (!resizeCtx) { return; }
        var id = resizeCtx.id;
        resizeCtx = null;
        suppressHover = false;
        document.body.style.cursor = "";
        sizeTip.style.display = "none";
        document.removeEventListener("mousemove", onResizeMove, true);
        document.removeEventListener("mouseup", onResizeUp, true);
        WBModel.commit("Resize element");
        handlers.onChange({ action: "resize", id: id, silent: true });
    }

    /* ------------------------------------------------- device & zoom -- */

    function setDevice(key) {
        device = key;
        var bp = WBBreakpoints[0];
        for (var i = 0; i < WBBreakpoints.length; i++) {
            if (WBBreakpoints[i].key === key) { bp = WBBreakpoints[i]; }
        }
        shell.classList.remove("device-base", "device-tablet", "device-mobile");
        shell.classList.add("device-" + key);
        wrap.style.width = bp.frame + "px";
        applyZoom();
        setTimeout(function () { syncFrameHeight(); updateOverlay(); }, 220);
    }

    function getDevice() { return device; }

    function setZoom(z) {
        zoom = Math.max(0.25, Math.min(2, z));
        applyZoom();
        return zoom;
    }

    function getZoom() { return zoom; }

    function applyZoom() {
        var w = parseFloat(wrap.style.width) || 1280;
        wrap.style.transform = "scale(" + zoom + ")";
        wrap.style.transformOrigin = "top left";
        holder.style.width = Math.round(w * zoom) + "px";
        syncFrameHeight();
        scheduleOverlayUpdate();
    }

    /* Fit the current device width to the available stage width. */
    function zoomToFit() {
        var avail = stage.clientWidth - 60;
        var w = parseFloat(wrap.style.width) || 1280;
        setZoom(Math.min(1, avail / w));
        return zoom;
    }

    function setPreview(on) {
        previewMode = on;
        stopTextEdit();
        document.body.classList.toggle("wb-preview", on);
        if (on) {
            selectBox.style.display = "none";
            hoverBox.style.display = "none";
            hoverBadge.style.display = "none";
        } else {
            updateOverlay();
        }
        /* re-render so links behave (or stop behaving) accordingly */
    }

    function getDocument() { return doc; }

    return {
        init: init,
        render: render,
        refreshStyles: refreshStyles,
        refreshNode: refreshNode,
        select: select,
        getSelection: getSelection,
        scrollToNode: scrollToNode,
        updateOverlay: updateOverlay,
        scheduleOverlayUpdate: scheduleOverlayUpdate,
        syncFrameHeight: syncFrameHeight,
        startTextEdit: startTextEdit,
        stopTextEdit: stopTextEdit,
        isEditingText: isEditingText,
        execTextCommand: execTextCommand,
        queryTextState: queryTextState,
        positionTextToolbar: positionTextToolbar,
        beginPaletteDrag: beginPaletteDrag,
        endPaletteDrag: endPaletteDrag,
        startMoveDrag: startMoveDrag,
        setDevice: setDevice,
        getDevice: getDevice,
        setZoom: setZoom,
        getZoom: getZoom,
        zoomToFit: zoomToFit,
        setPreview: setPreview,
        getDocument: getDocument
    };
})();
