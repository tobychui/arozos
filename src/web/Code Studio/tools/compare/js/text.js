/*
    text.js - side by side text comparison with in place editing

    Both sides are backed by a plain array of lines. The rendered grid is a
    projection of the current alignment, so an edit updates the array, the
    alignment is recomputed and the grid is redrawn with the caret restored.
*/

var CmpText = (function () {

    var LINE_HEIGHT = 16;
    var RENDER_ALL_LIMIT = 6000;
    var WINDOW_PADDING = 120;
    var CONTEXT_LINES = 3;

    //Everything belonging to one open comparison lives in here, so a tab can be
    //suspended and resumed by swapping the whole object out. Anything that
    //describes the pane chrome rather than the comparison stays outside it.
    function blankState(carryFilters) {
        return {
            settings: null,
            left: null,
            right: null,
            rows: [],
            hunks: [],
            stats: null,
            visible: [],
            currentHunk: -1,
            cursor: { side: null, line: -1, offset: 0 },
            filters: carryFilters || { show: "all", minor: true }
        };
    }

    var state = blankState();
    var panesBound = false;

    var hooks = {
        onLog: function () {},
        onStatus: function () {},
        onBusy: function () {},
        onDirtyChange: function () {}
    };

    function setHooks(newHooks) {
        for (var key in newHooks) {
            if (Object.prototype.hasOwnProperty.call(newHooks, key)) {
                hooks[key] = newHooks[key];
            }
        }
    }

    function emptySide(path) {
        return {
            path: path || "",
            name: path ? CmpUtil.baseName(path) : "",
            lines: [""],
            lineEnding: "\n",
            dirty: false,
            missing: !path,
            readOnly: false,
            binary: false,
            size: 0,
            mtime: 0
        };
    }

    /* ------------------------------ loading ----------------------------- */

    function loadSide(path, readOnly) {
        if (!path) {
            var blank = emptySide("");
            blank.readOnly = true;
            return Promise.resolve(blank);
        }

        return CmpAPI.readText(path).then(function (reply) {
            var side = emptySide(path);
            side.readOnly = !!readOnly;
            side.missing = false;

            if (reply.oversized) {
                side.lines = ["[ File is larger than 4 MB and was not opened as text ]"];
                side.readOnly = true;
                side.binary = true;
                side.size = reply.size;
                return side;
            }
            if (reply.binary) {
                side.lines = ["[ Binary file, use the Hex compare session to inspect it ]"];
                side.readOnly = true;
                side.binary = true;
                side.size = reply.size;
                return side;
            }

            side.lineEnding = CmpUtil.detectLineEnding(reply.content);
            side.lines = CmpUtil.splitLines(reply.content);
            side.size = reply.size;
            side.mtime = reply.mtime;
            return side;
        }).catch(function (err) {
            var missing = emptySide(path);
            missing.missing = true;
            missing.lines = [""];
            hooks.onLog("Could not open " + path + ": " + err.message, "err");
            return missing;
        });
    }

    function open(leftPath, rightPath, settings) {
        //A previously stashed tab still points at the old object, so never
        //reuse it; carry the view filters over as a user preference though
        state = blankState({ show: state.filters.show, minor: state.filters.minor });
        state.settings = settings;

        hooks.onBusy(true, "Opening files", 20);
        return Promise.all([
            loadSide(leftPath, settings.specs.leftReadOnly),
            loadSide(rightPath, settings.specs.rightReadOnly)
        ]).then(function (sides) {
            state.left = sides[0];
            state.right = sides[1];
            hooks.onBusy(false);
            recompare();
            scrollToTop();
            hooks.onLog("Text compare: " + (leftPath || "(none)") + " <-> " + (rightPath || "(none)"));
        });
    }

    function scrollToTop() {
        ["left", "right"].forEach(function (side) {
            var pane = paneOf(side);
            if (pane) {
                pane.scrollTop = 0;
                pane.scrollLeft = 0;
            }
        });
    }

    /* ---------------------------- comparison ---------------------------- */

    function recompare(preserveCaret) {
        var caret = preserveCaret ? captureCaret() : null;

        var unimportant = CmpSettings.compileUnimportant(state.settings.rules);
        var result = CmpDiff.alignLines(state.left.lines, state.right.lines, {
            rules: state.settings.rules,
            unimportant: unimportant
        });

        state.rows = result.rows;
        state.stats = result.stats;
        state.hunks = CmpDiff.collectHunks(result.rows);
        computeInsertPoints();
        render();

        if (caret) {
            restoreCaret(caret);
        }
        reportStatus();
    }

    //Where a section copy should splice when the target side of a hunk is empty
    function computeInsertPoints() {
        for (var h = 0; h < state.hunks.length; h++) {
            var hunk = state.hunks[h];
            if (!hunk) {
                continue;
            }
            hunk.leftInsertAt = 0;
            hunk.rightInsertAt = 0;
            for (var i = hunk.firstRow - 1; i >= 0; i--) {
                var row = state.rows[i];
                if (hunk.leftInsertAt === 0 && row.l !== null && row.l !== undefined) {
                    hunk.leftInsertAt = row.l + 1;
                }
                if (hunk.rightInsertAt === 0 && row.r !== null && row.r !== undefined) {
                    hunk.rightInsertAt = row.r + 1;
                }
                if (hunk.leftInsertAt !== 0 && hunk.rightInsertAt !== 0) {
                    break;
                }
            }
        }
    }

    //With the Minor button off, differences the rules call unimportant are
    //presented as matches rather than being hidden, because every line of the
    //file still has to be shown in its place.
    function effectiveType(row) {
        if (!state.filters.minor && (row.type === "minor" || row.minorOrphan)) {
            return row.type === "minor" ? "same" : row.type;
        }
        return row.type;
    }

    function isDifferenceRow(row) {
        var type = effectiveType(row);
        if (type === "same") {
            return false;
        }
        if (type === "minor" || row.minorOrphan) {
            return state.filters.minor;
        }
        return true;
    }

    function rowIsVisible(row) {
        if (state.filters.show === "all") {
            return true;
        }
        var isDiff = isDifferenceRow(row);
        if (state.filters.show === "diffs") {
            return isDiff;
        }
        //Context mode keeps a few unchanged lines around every difference
        return isDiff || row.nearDiff === true;
    }

    function markContext() {
        for (var i = 0; i < state.rows.length; i++) {
            state.rows[i].nearDiff = false;
        }
        for (var j = 0; j < state.rows.length; j++) {
            if (!isDifferenceRow(state.rows[j])) {
                continue;
            }
            for (var k = Math.max(0, j - CONTEXT_LINES); k <= Math.min(state.rows.length - 1, j + CONTEXT_LINES); k++) {
                state.rows[k].nearDiff = true;
            }
        }
    }

    /* ----------------------------- rendering ---------------------------- */

    function renderInline(row) {
        var type = effectiveType(row);
        if (type !== "change" && type !== "minor") {
            return null;
        }
        if (row.l === null || row.r === null || row.l === undefined || row.r === undefined) {
            return null;
        }
        var leftText = state.left.lines[row.l];
        var rightText = state.right.lines[row.r];
        if (leftText === rightText) {
            return null;
        }
        if (leftText.length > 2000 || rightText.length > 2000) {
            return null;
        }
        return CmpDiff.inlineDiff(leftText, rightText);
    }

    function partsToHTML(parts, fallbackText) {
        if (!parts) {
            return CmpUtil.escapeHtml(fallbackText);
        }
        var html = "";
        for (var i = 0; i < parts.length; i++) {
            var chunk = CmpUtil.escapeHtml(parts[i].text);
            html += parts[i].changed ? '<span class="inlinediff">' + chunk + "</span>" : chunk;
        }
        return html;
    }

    //One row of one pane. Both panes emit the same number of rows at the same
    //height, which is what keeps the two sides visually aligned.
    function renderRowSide(row, rowIndex, side, inline) {
        var model = side === "left" ? state.left : state.right;
        var index = side === "left" ? row.l : row.r;
        var classes = "trow " + rowClass(row);

        if (row.hunk >= 0 && row.hunk === state.currentHunk) {
            classes += " currentsection";
        }

        if (index === null || index === undefined) {
            return '<div class="' + classes + ' gap" data-row="' + rowIndex + '"' +
                (row.hunk >= 0 ? ' data-hunk="' + row.hunk + '"' : "") + '>' +
                '<div class="tmark"></div><div class="tnum"></div><div class="ttext"></div></div>';
        }

        if (state.cursor.side === side && state.cursor.line === index) {
            classes += " cursorline";
        }

        var text = model.lines[index];
        var parts = inline ? (side === "left" ? inline.left : inline.right) : null;
        var editable = (model.readOnly || model.binary) ?
            "" : ' contenteditable="plaintext-only" spellcheck="false"';

        return '<div class="' + classes + '" data-row="' + rowIndex + '"' +
            (row.hunk >= 0 ? ' data-hunk="' + row.hunk + '"' : "") + '>' +
            '<div class="tmark"></div>' +
            '<div class="tnum">' + (index + 1) + '</div>' +
            '<div class="ttext"' + editable + ' data-side="' + side + '" data-line="' + index + '">' +
                partsToHTML(parts, text) +
            '</div>' +
        '</div>';
    }

    function rowClass(row) {
        var type = effectiveType(row);
        if (type === "same") {
            return "r-same";
        }
        if (type === "minor" || (row.minorOrphan && state.filters.minor)) {
            return "r-minor";
        }
        if (row.minorOrphan && !state.filters.minor) {
            return "r-same";
        }
        if (type === "change") {
            return "r-change";
        }
        return "r-add";
    }

    function paneOf(side) {
        return document.getElementById(side === "left" ? "textLeftPane" : "textRightPane");
    }

    function rowsOf(side) {
        return document.getElementById(side === "left" ? "textLeftRows" : "textRightRows");
    }

    //The right pane owns the visible vertical scrollbar, so it is the one all
    //the scroll positioning helpers measure against
    function primaryScroller() {
        return paneOf("right");
    }

    function buildVisible() {
        if (state.filters.show === "context") {
            markContext();
        }
        var visible = [];
        for (var i = 0; i < state.rows.length; i++) {
            if (rowIsVisible(state.rows[i])) {
                visible.push(i);
            }
        }
        state.visible = visible;
    }

    function render() {
        buildVisible();

        if (!paneOf("left") || !paneOf("right")) {
            return;
        }

        bindPanes();
        renderWindow();
        drawDiffMap();
    }

    //Keep the two panes scrolled to the same line without letting the two
    //scroll handlers chase each other
    var syncingScroll = false;

    function bindPanes() {
        if (panesBound) {
            return;
        }

        ["left", "right"].forEach(function (side) {
            var pane = paneOf(side);
            var other = paneOf(side === "left" ? "right" : "left");

            pane.addEventListener("scroll", function () {
                if (!syncingScroll && other.scrollTop !== pane.scrollTop) {
                    syncingScroll = true;
                    other.scrollTop = pane.scrollTop;
                    syncingScroll = false;
                }
                if (state.visible.length > RENDER_ALL_LIMIT) {
                    renderWindow();
                }
                drawMapViewport();
            });
        });

        bindSplitter();
        panesBound = true;
    }

    function renderWindow() {
        var container = { left: rowsOf("left"), right: rowsOf("right") };
        var scroller = primaryScroller();
        if (!container.left || !container.right || !scroller) {
            return;
        }

        var total = state.visible.length;
        var firstIndex = 0;
        var lastIndex = total;

        if (total > RENDER_ALL_LIMIT) {
            firstIndex = Math.max(0, Math.floor(scroller.scrollTop / LINE_HEIGHT) - WINDOW_PADDING);
            lastIndex = Math.min(total,
                Math.ceil((scroller.scrollTop + scroller.clientHeight) / LINE_HEIGHT) + WINDOW_PADDING);
        }

        var spacerTop = firstIndex > 0 ?
            '<div style="height:' + (firstIndex * LINE_HEIGHT) + 'px;"></div>' : "";
        var spacerBottom = lastIndex < total ?
            '<div style="height:' + ((total - lastIndex) * LINE_HEIGHT) + 'px;"></div>' : "";

        var leftHTML = spacerTop;
        var rightHTML = spacerTop;

        for (var i = firstIndex; i < lastIndex; i++) {
            var rowIndex = state.visible[i];
            var row = state.rows[rowIndex];
            var inline = renderInline(row);
            leftHTML += renderRowSide(row, rowIndex, "left", inline);
            rightHTML += renderRowSide(row, rowIndex, "right", inline);
        }

        container.left.innerHTML = leftHTML + spacerBottom;
        container.right.innerHTML = rightHTML + spacerBottom;
    }

    /* ------------------------------ splitter ---------------------------- */

    //Remembered as a fraction so the divider keeps its place when the window
    //is resized or the comparison is redrawn
    var splitRatio = 0.5;

    //Sized from the space the two panes actually share, so that a ratio of a
    //half puts the divider dead centre rather than a scrollbar width off it
    function applySplit() {
        var body = document.getElementById("textBody");
        var left = paneOf("left");
        var splitter = document.getElementById("textSplitter");
        var map = document.getElementById("textMap");
        if (!body || !left || !splitter) {
            return;
        }

        var available = body.clientWidth - (map ? map.offsetWidth : 0) - splitter.offsetWidth;
        if (available <= 0) {
            return;
        }
        left.style.flex = "0 0 " + Math.round(available * splitRatio) + "px";
    }

    function bindSplitter() {
        var splitter = document.getElementById("textSplitter");
        var body = document.getElementById("textBody");
        if (!splitter || !body) {
            return;
        }

        applySplit();

        var dragging = false;

        function positionFromEvent(event) {
            var bodyRect = body.getBoundingClientRect();
            var map = document.getElementById("textMap");
            var mapWidth = map ? map.offsetWidth : 0;
            var available = bodyRect.width - mapWidth - splitter.offsetWidth;
            if (available <= 0) {
                return splitRatio;
            }
            var offset = event.clientX - bodyRect.left - mapWidth - splitter.offsetWidth / 2;
            //Leave enough of each pane on screen to stay usable
            return Math.max(0.1, Math.min(0.9, offset / available));
        }

        splitter.addEventListener("mousedown", function (event) {
            event.preventDefault();
            dragging = true;
            splitter.classList.add("dragging");
            document.body.style.cursor = "col-resize";
        });

        document.addEventListener("mousemove", function (event) {
            if (!dragging) {
                return;
            }
            event.preventDefault();
            splitRatio = positionFromEvent(event);
            applySplit();
        });

        document.addEventListener("mouseup", function () {
            if (!dragging) {
                return;
            }
            dragging = false;
            splitter.classList.remove("dragging");
            document.body.style.cursor = "";
            drawMapViewport();
        });

        splitter.addEventListener("dblclick", function () {
            splitRatio = 0.5;
            applySplit();
        });

        //The ratio is what is remembered, so a window resize keeps the split
        window.addEventListener("resize", function () {
            applySplit();
            drawDiffMap();
        });
    }

    function centreSplit() {
        splitRatio = 0.5;
        applySplit();
    }

    /* ----------------------------- diff map ----------------------------- */

    function drawDiffMap() {
        var map = document.getElementById("textMap");
        if (!map) {
            return;
        }

        var total = state.rows.length || 1;
        var height = map.clientHeight || 1;
        var html = "";

        for (var i = 0; i < state.rows.length; i++) {
            var row = state.rows[i];
            if (!isDifferenceRow(row)) {
                continue;
            }
            var color = "var(--cmp-diff)";
            if (row.type === "minor" || row.minorOrphan) {
                color = "var(--cmp-minor)";
            } else if (row.type === "ins" || row.type === "del") {
                color = "var(--cmp-newer)";
            }
            var top = Math.floor((i / total) * height);
            html += '<div class="mapmark" style="top:' + top + 'px;height:2px;background:' + color + ';"></div>';
        }

        html += '<div class="mapview" id="textMapView"></div>';
        map.innerHTML = html;
        drawMapViewport();
    }

    function drawMapViewport() {
        var map = document.getElementById("textMap");
        var view = document.getElementById("textMapView");
        var scroller = primaryScroller();
        if (!map || !view || !scroller) {
            return;
        }
        var total = Math.max(1, state.visible.length) * LINE_HEIGHT;
        var height = map.clientHeight || 1;
        view.style.top = Math.floor((scroller.scrollTop / total) * height) + "px";
        view.style.height = Math.max(6, Math.floor((scroller.clientHeight / total) * height)) + "px";
    }

    function mapClick(event) {
        var map = document.getElementById("textMap");
        var scroller = primaryScroller();
        if (!map || !scroller) {
            return;
        }
        var rect = map.getBoundingClientRect();
        var ratio = (event.clientY - rect.top) / rect.height;
        scroller.scrollTop = Math.max(0, ratio * state.visible.length * LINE_HEIGHT - scroller.clientHeight / 2);
    }

    /* ------------------------------ editing ----------------------------- */

    function captureCaret() {
        var selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return null;
        }
        var node = selection.anchorNode;
        while (node && node.nodeType !== 1) {
            node = node.parentNode;
        }
        if (!node || !node.classList || !node.classList.contains("ttext")) {
            return null;
        }
        return {
            side: node.getAttribute("data-side"),
            line: parseInt(node.getAttribute("data-line"), 10),
            offset: caretOffsetWithin(node)
        };
    }

    function caretOffsetWithin(element) {
        var selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return 0;
        }
        var range = selection.getRangeAt(0).cloneRange();
        range.selectNodeContents(element);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length;
    }

    function restoreCaret(caret) {
        if (!caret || caret.line < 0) {
            return;
        }
        var selector = '.ttext[data-side="' + caret.side + '"][data-line="' + caret.line + '"]';
        var element = rowsOf(caret.side) ? rowsOf(caret.side).querySelector(selector) : null;
        if (!element) {
            return;
        }
        placeCaret(element, caret.offset);
    }

    function placeCaret(element, offset) {
        element.focus();
        var selection = window.getSelection();
        var range = document.createRange();
        var remaining = offset;
        var placed = false;

        function walk(node) {
            if (placed) {
                return;
            }
            if (node.nodeType === 3) {
                var length = node.nodeValue.length;
                if (remaining <= length) {
                    range.setStart(node, remaining);
                    placed = true;
                    return;
                }
                remaining -= length;
                return;
            }
            for (var i = 0; i < node.childNodes.length; i++) {
                walk(node.childNodes[i]);
            }
        }

        walk(element);
        if (!placed) {
            range.selectNodeContents(element);
            range.collapse(false);
        } else {
            range.collapse(true);
        }
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function sideModel(side) {
        return side === "left" ? state.left : state.right;
    }

    function markDirty(side) {
        var model = sideModel(side);
        if (!model.dirty) {
            model.dirty = true;
            hooks.onDirtyChange();
        }
    }

    var deferredRecompare = CmpUtil.debounce(function () {
        recompare(true);
    }, 700);

    function handleInput(element) {
        var side = element.getAttribute("data-side");
        var lineIndex = parseInt(element.getAttribute("data-line"), 10);
        var model = sideModel(side);
        if (!model || model.readOnly || isNaN(lineIndex)) {
            return;
        }
        model.lines[lineIndex] = element.textContent;
        markDirty(side);
        reportStatus();
        deferredRecompare();
    }

    function splitLineAtCaret(element) {
        var side = element.getAttribute("data-side");
        var lineIndex = parseInt(element.getAttribute("data-line"), 10);
        var model = sideModel(side);
        if (!model || model.readOnly) {
            return;
        }
        var offset = caretOffsetWithin(element);
        var text = element.textContent;
        model.lines[lineIndex] = text.substring(0, offset);
        model.lines.splice(lineIndex + 1, 0, text.substring(offset));
        markDirty(side);
        recompare(false);
        focusLine(side, lineIndex + 1, 0);
    }

    function mergeWithPrevious(element) {
        var side = element.getAttribute("data-side");
        var lineIndex = parseInt(element.getAttribute("data-line"), 10);
        var model = sideModel(side);
        if (!model || model.readOnly || lineIndex <= 0) {
            return false;
        }
        var previousLength = model.lines[lineIndex - 1].length;
        model.lines[lineIndex - 1] += model.lines[lineIndex];
        model.lines.splice(lineIndex, 1);
        markDirty(side);
        recompare(false);
        focusLine(side, lineIndex - 1, previousLength);
        return true;
    }

    function mergeWithNext(element) {
        var side = element.getAttribute("data-side");
        var lineIndex = parseInt(element.getAttribute("data-line"), 10);
        var model = sideModel(side);
        if (!model || model.readOnly || lineIndex >= model.lines.length - 1) {
            return false;
        }
        var currentLength = model.lines[lineIndex].length;
        model.lines[lineIndex] += model.lines[lineIndex + 1];
        model.lines.splice(lineIndex + 1, 1);
        markDirty(side);
        recompare(false);
        focusLine(side, lineIndex, currentLength);
        return true;
    }

    function insertTextAtCaret(element, text) {
        var side = element.getAttribute("data-side");
        var lineIndex = parseInt(element.getAttribute("data-line"), 10);
        var model = sideModel(side);
        if (!model || model.readOnly) {
            return;
        }
        var offset = caretOffsetWithin(element);
        var current = element.textContent;
        var head = current.substring(0, offset);
        var tail = current.substring(offset);
        var inserted = CmpUtil.splitLines(text);

        if (inserted.length === 1) {
            model.lines[lineIndex] = head + inserted[0] + tail;
            markDirty(side);
            recompare(false);
            focusLine(side, lineIndex, head.length + inserted[0].length);
            return;
        }

        var block = inserted.slice();
        block[0] = head + block[0];
        var lastLength = block[block.length - 1].length;
        block[block.length - 1] = block[block.length - 1] + tail;
        var args = [lineIndex, 1].concat(block);
        Array.prototype.splice.apply(model.lines, args);
        markDirty(side);
        recompare(false);
        focusLine(side, lineIndex + block.length - 1, lastLength);
    }

    function focusLine(side, lineIndex, offset) {
        scrollLineIntoView(side, lineIndex);
        var host = rowsOf(side);
        var element = host ? host.querySelector('.ttext[data-line="' + lineIndex + '"]') : null;
        if (element) {
            placeCaret(element, offset || 0);
            state.cursor = { side: side, line: lineIndex, offset: offset || 0 };
        }
    }

    function scrollLineIntoView(side, lineIndex) {
        var scroller = primaryScroller();
        if (!scroller) {
            return;
        }
        for (var i = 0; i < state.visible.length; i++) {
            var row = state.rows[state.visible[i]];
            if (row[side === "left" ? "l" : "r"] === lineIndex) {
                var top = i * LINE_HEIGHT;
                if (top < scroller.scrollTop || top > scroller.scrollTop + scroller.clientHeight - LINE_HEIGHT * 2) {
                    scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2);
                    if (state.visible.length > RENDER_ALL_LIMIT) {
                        renderWindow();
                    }
                }
                return;
            }
        }
    }

    /* --------------------------- section copy --------------------------- */

    function activeHunk() {
        if (state.currentHunk >= 0 && state.hunks[state.currentHunk]) {
            return state.hunks[state.currentHunk];
        }
        //Fall back to the hunk under the caret, then to the first one
        if (state.cursor.line >= 0 && state.cursor.side) {
            var field = state.cursor.side === "left" ? "l" : "r";
            for (var i = 0; i < state.rows.length; i++) {
                if (state.rows[i][field] === state.cursor.line && state.rows[i].hunk >= 0) {
                    return state.hunks[state.rows[i].hunk];
                }
            }
        }
        for (var h = 0; h < state.hunks.length; h++) {
            if (state.hunks[h]) {
                return state.hunks[h];
            }
        }
        return null;
    }

    //Replace the target side of the active difference section with the source
    //side, exactly like the "copy section to the other side" command.
    function copySection(direction) {
        var hunk = activeHunk();
        if (!hunk) {
            hooks.onLog("No difference section is selected", "err");
            return;
        }

        var sourceSide = direction === "toRight" ? "left" : "right";
        var targetSide = direction === "toRight" ? "right" : "left";
        var sourceModel = sideModel(sourceSide);
        var targetModel = sideModel(targetSide);

        if (targetModel.readOnly) {
            hooks.onLog("The " + targetSide + " side is read only", "err");
            return;
        }

        var sourceStart = sourceSide === "left" ? hunk.leftStart : hunk.rightStart;
        var sourceEnd = sourceSide === "left" ? hunk.leftEnd : hunk.rightEnd;
        var targetStart = targetSide === "left" ? hunk.leftStart : hunk.rightStart;
        var targetEnd = targetSide === "left" ? hunk.leftEnd : hunk.rightEnd;
        var insertAt = targetSide === "left" ? hunk.leftInsertAt : hunk.rightInsertAt;

        var block = (sourceStart === null || sourceStart === undefined) ?
            [] : sourceModel.lines.slice(sourceStart, sourceEnd + 1);

        if (targetStart === null || targetStart === undefined) {
            //The target has no lines in this section, so this is an insertion
            var insertArgs = [insertAt, 0].concat(block);
            Array.prototype.splice.apply(targetModel.lines, insertArgs);
        } else {
            var replaceArgs = [targetStart, targetEnd - targetStart + 1].concat(block);
            Array.prototype.splice.apply(targetModel.lines, replaceArgs);
        }

        markDirty(targetSide);
        var keepHunk = state.currentHunk;
        recompare(false);
        hooks.onLog("Copied section " + (hunk.index + 1) + " to the " + targetSide + " side", "ok");

        //Stay on roughly the same place in the file after the merge
        state.currentHunk = Math.min(keepHunk, state.hunks.length - 1);
        if (state.currentHunk >= 0) {
            scrollToHunk(state.currentHunk);
        }
    }

    function copyAllSections(direction) {
        var targetSide = direction === "toRight" ? "right" : "left";
        var sourceModel = direction === "toRight" ? state.left : state.right;
        var targetModel = sideModel(targetSide);

        if (targetModel.readOnly) {
            hooks.onLog("The " + targetSide + " side is read only", "err");
            return;
        }
        if (!window.confirm("Replace the entire " + targetSide + " side with the other side?")) {
            return;
        }

        targetModel.lines = sourceModel.lines.slice();
        markDirty(targetSide);
        recompare(false);
        hooks.onLog("Replaced the " + targetSide + " side with the other side", "ok");
    }

    /* ---------------------------- navigation ---------------------------- */

    function hunkList() {
        var list = [];
        for (var i = 0; i < state.hunks.length; i++) {
            if (state.hunks[i] && (state.filters.minor || state.hunks[i].important)) {
                list.push(i);
            }
        }
        return list;
    }

    function nextSection() {
        var list = hunkList();
        if (list.length === 0) {
            return;
        }
        var position = list.indexOf(state.currentHunk);
        state.currentHunk = list[(position + 1) % list.length];
        scrollToHunk(state.currentHunk);
    }

    function previousSection() {
        var list = hunkList();
        if (list.length === 0) {
            return;
        }
        var position = list.indexOf(state.currentHunk);
        if (position <= 0) {
            position = list.length;
        }
        state.currentHunk = list[position - 1];
        scrollToHunk(state.currentHunk);
    }

    function scrollToHunk(hunkIndex) {
        var hunk = state.hunks[hunkIndex];
        var scroller = primaryScroller();
        if (!hunk || !scroller) {
            return;
        }
        for (var i = 0; i < state.visible.length; i++) {
            if (state.visible[i] >= hunk.firstRow) {
                scroller.scrollTop = Math.max(0, i * LINE_HEIGHT - scroller.clientHeight / 3);
                if (state.visible.length > RENDER_ALL_LIMIT) {
                    renderWindow();
                }
                break;
            }
        }
        highlightHunk(hunkIndex);
        reportStatus();
    }

    function highlightHunk(hunkIndex) {
        var rows = document.querySelectorAll("#textLeftRows .trow, #textRightRows .trow");
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.toggle("cursorline",
                rows[i].getAttribute("data-hunk") === String(hunkIndex));
        }
    }

    /* ------------------------------ saving ------------------------------ */

    function saveSide(side) {
        var model = sideModel(side);
        if (!model || !model.path || model.readOnly || model.binary) {
            return Promise.resolve(false);
        }
        if (!model.dirty) {
            return Promise.resolve(false);
        }

        var content = CmpUtil.joinLines(model.lines, model.lineEnding);
        return CmpAPI.writeText(model.path, content).then(function (reply) {
            model.dirty = false;
            model.size = reply.size;
            model.mtime = reply.mtime;
            hooks.onDirtyChange();
            hooks.onLog("Saved " + model.path, "ok");
            return true;
        }).catch(function (err) {
            hooks.onLog("Save failed for " + model.path + ": " + err.message, "err");
            throw err;
        });
    }

    function saveAll() {
        return saveSide("left").then(function () {
            return saveSide("right");
        }).then(function () {
            reportStatus();
        });
    }

    function reload() {
        if (isDirty() && !window.confirm("Discard unsaved changes and reload both files?")) {
            return Promise.resolve();
        }
        return open(state.left.path, state.right.path, state.settings);
    }

    function isDirty() {
        return (state.left && state.left.dirty) || (state.right && state.right.dirty);
    }

    function swap() {
        var oldLeft = state.left;
        state.left = state.right;
        state.right = oldLeft;
        recompare(false);
    }

    function setFilter(name, value) {
        state.filters[name] = value;
        render();
        reportStatus();
    }

    function getFilters() {
        return state.filters;
    }

    function setSettings(settings) {
        state.settings = settings;
        if (state.left && state.right) {
            recompare(false);
        }
    }

    function reportStatus() {
        if (!state.stats) {
            return;
        }
        var important = state.stats.changed + state.stats.inserted + state.stats.deleted;
        hooks.onStatus({
            sections: state.stats.hunks,
            important: important,
            minor: state.stats.minor,
            leftLines: state.left ? state.left.lines.length : 0,
            rightLines: state.right ? state.right.lines.length : 0,
            leftDirty: state.left ? state.left.dirty : false,
            rightDirty: state.right ? state.right.dirty : false,
            currentSection: state.currentHunk >= 0 ? state.currentHunk + 1 : 0,
            leftName: state.left ? state.left.name : "",
            rightName: state.right ? state.right.name : ""
        });
    }

    function getState() {
        return state;
    }

    /* --------------------------- tab suspension ------------------------- */

    //Hand the whole comparison back so a tab can hold on to it, unsaved edits
    //and scroll position included
    function captureSession() {
        var panes = { left: paneOf("left"), right: paneOf("right") };
        state.scrollTop = panes.right ? panes.right.scrollTop : 0;
        state.scrollLeft = {
            left: panes.left ? panes.left.scrollLeft : 0,
            right: panes.right ? panes.right.scrollLeft : 0
        };
        return state;
    }

    function restoreSession(saved) {
        state = saved;
        render();
        reportStatus();

        //Put the panes back exactly where the user left them
        var panes = { left: paneOf("left"), right: paneOf("right") };
        if (panes.left && panes.right) {
            panes.left.scrollTop = state.scrollTop || 0;
            panes.right.scrollTop = state.scrollTop || 0;
            if (state.scrollLeft) {
                panes.left.scrollLeft = state.scrollLeft.left || 0;
                panes.right.scrollLeft = state.scrollLeft.right || 0;
            }
            if (state.visible.length > RENDER_ALL_LIMIT) {
                renderWindow();
            }
            drawMapViewport();
        }
    }

    //Does a suspended session hold unsaved work?
    function sessionIsDirty(saved) {
        if (!saved) {
            return false;
        }
        return (saved.left && saved.left.dirty) || (saved.right && saved.right.dirty);
    }

    return {
        setHooks: setHooks,
        open: open,
        recompare: recompare,
        render: render,
        handleInput: handleInput,
        splitLineAtCaret: splitLineAtCaret,
        mergeWithPrevious: mergeWithPrevious,
        mergeWithNext: mergeWithNext,
        insertTextAtCaret: insertTextAtCaret,
        caretOffsetWithin: caretOffsetWithin,
        copySection: copySection,
        copyAllSections: copyAllSections,
        nextSection: nextSection,
        previousSection: previousSection,
        scrollToHunk: scrollToHunk,
        mapClick: mapClick,
        centreSplit: centreSplit,
        saveAll: saveAll,
        saveSide: saveSide,
        reload: reload,
        isDirty: isDirty,
        swap: swap,
        setFilter: setFilter,
        getFilters: getFilters,
        setSettings: setSettings,
        getState: getState,
        captureSession: captureSession,
        restoreSession: restoreSession,
        sessionIsDirty: sessionIsDirty
    };
})();
