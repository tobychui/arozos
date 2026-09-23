/*
    hex.js - byte level comparison for binary files

    Both files are fetched through the media endpoint and laid out 16 bytes per
    row. Bytes that differ at the same offset are highlighted on both sides.
*/

var CmpHex = (function () {

    var BYTES_PER_ROW = 16;
    var ROW_HEIGHT = 16;
    var WINDOW_PADDING = 40;
    var SIZE_LIMIT = 16 * 1024 * 1024;

    //Swappable per tab, see CmpText.captureSession for the reasoning
    function blankState(carryFilters) {
        return {
            left: null,
            right: null,
            leftPath: "",
            rightPath: "",
            rowCount: 0,
            diffRows: [],
            diffBytes: 0,
            filters: carryFilters || { show: "all" }
        };
    }

    var state = blankState();
    var scrollBound = false;

    var hooks = {
        onLog: function () {},
        onStatus: function () {},
        onBusy: function () {}
    };

    function setHooks(newHooks) {
        for (var key in newHooks) {
            if (Object.prototype.hasOwnProperty.call(newHooks, key)) {
                hooks[key] = newHooks[key];
            }
        }
    }

    function loadSide(path) {
        if (!path) {
            return Promise.resolve(new Uint8Array(0));
        }
        return CmpAPI.readBytes(path).then(function (buffer) {
            if (buffer.byteLength > SIZE_LIMIT) {
                hooks.onLog(CmpUtil.baseName(path) + " is larger than 16 MB, only the first 16 MB is shown", "err");
                return new Uint8Array(buffer, 0, SIZE_LIMIT);
            }
            return new Uint8Array(buffer);
        }).catch(function (err) {
            hooks.onLog("Could not read " + path + ": " + err.message, "err");
            return new Uint8Array(0);
        });
    }

    function open(leftPath, rightPath) {
        state = blankState({ show: state.filters.show });
        state.leftPath = leftPath || "";
        state.rightPath = rightPath || "";
        hooks.onBusy(true, "Reading files", 20);

        return Promise.all([loadSide(leftPath), loadSide(rightPath)]).then(function (buffers) {
            state.left = buffers[0];
            state.right = buffers[1];
            analyse();
            hooks.onBusy(false);
            render();
            hooks.onLog("Hex compare: " + state.diffBytes + " differing byte(s) across " +
                state.diffRows.length + " row(s)", state.diffBytes ? "err" : "ok");
        });
    }

    function analyse() {
        var maxLength = Math.max(state.left.length, state.right.length);
        state.rowCount = Math.ceil(maxLength / BYTES_PER_ROW) || 1;
        state.diffRows = [];
        state.diffBytes = 0;

        for (var row = 0; row < state.rowCount; row++) {
            var base = row * BYTES_PER_ROW;
            var rowDiffers = false;
            for (var i = 0; i < BYTES_PER_ROW; i++) {
                var offset = base + i;
                var leftByte = offset < state.left.length ? state.left[offset] : -1;
                var rightByte = offset < state.right.length ? state.right[offset] : -1;
                if (leftByte !== rightByte) {
                    state.diffBytes++;
                    rowDiffers = true;
                }
            }
            if (rowDiffers) {
                state.diffRows.push(row);
            }
        }
    }

    function hex2(value) {
        return value < 16 ? "0" + value.toString(16) : value.toString(16);
    }

    function hex8(value) {
        var text = value.toString(16);
        while (text.length < 8) {
            text = "0" + text;
        }
        return text;
    }

    function renderSide(bytes, other, rowIndex) {
        var base = rowIndex * BYTES_PER_ROW;
        var hexHTML = "";
        var asciiHTML = "";

        for (var i = 0; i < BYTES_PER_ROW; i++) {
            var offset = base + i;
            var value = offset < bytes.length ? bytes[offset] : -1;
            var otherValue = offset < other.length ? other[offset] : -1;
            var differs = value !== otherValue;

            var cell = value < 0 ? "  " : hex2(value);
            var glyph = value < 0 ? " " : (value >= 32 && value < 127 ? String.fromCharCode(value) : ".");
            var openTag = differs ? '<span class="bdiff">' : "";
            var closeTag = differs ? "</span>" : "";

            hexHTML += openTag + cell + closeTag + (i === 7 ? "  " : " ");
            asciiHTML += openTag + CmpUtil.escapeHtml(glyph) + closeTag;
        }

        return '<div class="hexside">' +
            '<div class="hexoff">' + hex8(base) + '</div>' +
            '<div class="hexbytes">' + hexHTML + '</div>' +
            '<div class="hexascii">' + asciiHTML + '</div>' +
        '</div>';
    }

    function visibleRows() {
        if (state.filters.show === "diffs") {
            return state.diffRows;
        }
        if (state.filters.show === "same") {
            var same = [];
            var diffSet = {};
            for (var d = 0; d < state.diffRows.length; d++) {
                diffSet[state.diffRows[d]] = true;
            }
            for (var r = 0; r < state.rowCount; r++) {
                if (!diffSet[r]) {
                    same.push(r);
                }
            }
            return same;
        }
        var all = [];
        for (var i = 0; i < state.rowCount; i++) {
            all.push(i);
        }
        return all;
    }

    function render() {
        var scroller = document.getElementById("hexScroller");
        if (!scroller) {
            return;
        }
        if (!scrollBound) {
            scroller.addEventListener("scroll", renderWindow);
            scrollBound = true;
        }
        state.rowsShown = visibleRows();
        renderWindow();
        hooks.onStatus({
            leftSize: state.left ? state.left.length : 0,
            rightSize: state.right ? state.right.length : 0,
            diffBytes: state.diffBytes,
            diffRows: state.diffRows.length,
            shown: state.rowsShown.length
        });
    }

    function renderWindow() {
        var scroller = document.getElementById("hexScroller");
        var container = document.getElementById("hexRows");
        if (!scroller || !container || !state.rowsShown) {
            return;
        }

        var total = state.rowsShown.length;
        var firstIndex = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT) - WINDOW_PADDING);
        var lastIndex = Math.min(total,
            Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW_HEIGHT) + WINDOW_PADDING);

        var html = '<div style="height:' + (firstIndex * ROW_HEIGHT) + 'px;"></div>';
        for (var i = firstIndex; i < lastIndex; i++) {
            var rowIndex = state.rowsShown[i];
            html += '<div class="hexrow">' +
                renderSide(state.left, state.right, rowIndex) +
                renderSide(state.right, state.left, rowIndex) +
            '</div>';
        }
        html += '<div style="height:' + ((total - lastIndex) * ROW_HEIGHT) + 'px;"></div>';
        container.innerHTML = html;
    }

    function setFilter(name, value) {
        state.filters[name] = value;
        render();
    }

    function getFilters() {
        return state.filters;
    }

    function nextDifference() {
        var scroller = document.getElementById("hexScroller");
        if (!scroller || !state.rowsShown || state.diffRows.length === 0) {
            return;
        }
        var currentRow = Math.floor(scroller.scrollTop / ROW_HEIGHT);
        for (var i = 0; i < state.rowsShown.length; i++) {
            if (i > currentRow && state.diffRows.indexOf(state.rowsShown[i]) >= 0) {
                scroller.scrollTop = Math.max(0, i * ROW_HEIGHT - scroller.clientHeight / 3);
                renderWindow();
                return;
            }
        }
        scroller.scrollTop = 0;
        renderWindow();
    }

    function swap() {
        var oldLeft = state.left;
        var oldLeftPath = state.leftPath;
        state.left = state.right;
        state.right = oldLeft;
        state.leftPath = state.rightPath;
        state.rightPath = oldLeftPath;
        analyse();
        render();
    }

    function getState() {
        return state;
    }

    function captureSession() {
        var scroller = document.getElementById("hexScroller");
        state.scrollTop = scroller ? scroller.scrollTop : 0;
        return state;
    }

    function restoreSession(saved) {
        state = saved;
        render();
        var scroller = document.getElementById("hexScroller");
        if (scroller) {
            scroller.scrollTop = state.scrollTop || 0;
            renderWindow();
        }
    }

    return {
        setHooks: setHooks,
        open: open,
        render: render,
        setFilter: setFilter,
        getFilters: getFilters,
        nextDifference: nextDifference,
        swap: swap,
        getState: getState,
        captureSession: captureSession,
        restoreSession: restoreSession
    };
})();
