/*
    folder.js - folder compare engine and grid view

    Scans both base folders, aligns their entries into a single tree, applies
    the session's quick tests and content tests, then renders the classic two
    pane aligned grid. The grid is windowed so that a scan of tens of thousands
    of entries still scrolls smoothly.
*/

var CmpFolder = (function () {

    var ROW_HEIGHT = 17;
    var WINDOW_PADDING = 24;

    var state = {
        leftRoot: "",
        rightRoot: "",
        settings: null,
        nodes: {},
        rootKeys: [],
        expanded: {},
        selection: {},
        lastClickedKey: null,
        visibleRows: [],
        filters: {
            show: "all",          // all | diffs | same
            structure: true,      // show folders that contain no differences
            minor: true,          // show minor (rules based) differences
            files: true,          // show files, not just the folder structure
            nameFilter: ""
        },
        syncMode: false,
        running: false,
        abortRequested: false,
        stats: { compared: 0, differences: 0, orphans: 0, sameCount: 0, leftBytes: 0, rightBytes: 0 }
    };

    var hooks = {
        onLog: function () {},
        onStatus: function () {},
        onBusy: function () {},
        onOpenPair: function () {}
    };

    function setHooks(newHooks) {
        for (var key in newHooks) {
            if (Object.prototype.hasOwnProperty.call(newHooks, key)) {
                hooks[key] = newHooks[key];
            }
        }
    }

    /* --------------------------- key building --------------------------- */

    function comparisonKey(relPath, settings) {
        var key = relPath;
        if (settings.alignUnicodeForms && String.prototype.normalize) {
            key = key.normalize("NFC");
        }
        if (settings.alignDifferentExtensions) {
            var slash = key.lastIndexOf("/");
            var head = slash < 0 ? "" : key.substring(0, slash + 1);
            var tail = slash < 0 ? key : key.substring(slash + 1);
            var dot = tail.lastIndexOf(".");
            if (dot > 0) {
                tail = tail.substring(0, dot);
            }
            key = head + tail;
        }
        if (!settings.compareFilenameCase) {
            key = key.toLowerCase();
        }
        return key;
    }

    function parentKeyOf(key) {
        var idx = key.lastIndexOf("/");
        return idx < 0 ? "" : key.substring(0, idx);
    }

    /* ------------------------------ filters ----------------------------- */

    function buildFilters(settings) {
        return {
            include: CmpUtil.maskListToRegExp(settings.nameFilters.includeFiles, settings.compareFilenameCase),
            exclude: CmpUtil.maskListToRegExp(settings.nameFilters.excludeFiles, settings.compareFilenameCase),
            excludeFolders: CmpUtil.maskListToRegExp(settings.nameFilters.excludeFolders, settings.compareFilenameCase)
        };
    }

    //Returns true when an entry survives the name, size and age filters
    function entryPasses(entry, filters, settings) {
        var name = CmpUtil.baseName(entry.p);

        if (entry.d) {
            return !(filters.excludeFolders && filters.excludeFolders.test(name));
        }

        if (filters.include && !filters.include.test(name)) {
            return false;
        }
        if (filters.exclude && filters.exclude.test(name)) {
            return false;
        }

        var other = settings.otherFilters;
        if (other.minSize > 0 && entry.s < other.minSize * 1024) {
            return false;
        }
        if (other.maxSize > 0 && entry.s > other.maxSize * 1024) {
            return false;
        }
        if (other.changedWithinDays > 0) {
            var cutoff = CmpUtil.unixNow() - other.changedWithinDays * 86400;
            if (entry.m < cutoff) {
                return false;
            }
        }
        return true;
    }

    //Drop everything living underneath an excluded folder
    function pruneExcluded(items, filters) {
        if (!filters.excludeFolders) {
            return items;
        }
        var prunedPrefixes = [];
        var kept = [];

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var underPruned = false;
            for (var p = 0; p < prunedPrefixes.length; p++) {
                if (item.p.indexOf(prunedPrefixes[p]) === 0) {
                    underPruned = true;
                    break;
                }
            }
            if (underPruned) {
                continue;
            }
            if (item.d && filters.excludeFolders.test(CmpUtil.baseName(item.p))) {
                prunedPrefixes.push(item.p + "/");
                continue;
            }
            kept.push(item);
        }
        return kept;
    }

    /* --------------------------- quick tests ---------------------------- */

    function timestampsMatch(leftTime, rightTime, settings) {
        var delta = Math.abs(Number(leftTime) - Number(rightTime));
        var tolerance = Math.max(0, Number(settings.timestampTolerance) || 0);
        if (delta <= tolerance) {
            return true;
        }
        if (settings.ignoreDST && Math.abs(delta - 3600) <= tolerance) {
            return true;
        }
        if (settings.ignoreTimezone) {
            //Any whole (or half) hour offset is treated as a timezone artefact
            var halfHours = delta / 1800;
            if (Math.abs(halfHours - Math.round(halfHours)) * 1800 <= tolerance) {
                return true;
            }
        }
        return false;
    }

    function quickTest(node, settings) {
        var sizeEqual = true;
        var timeEqual = true;

        if (settings.compareSize) {
            sizeEqual = node.left.size === node.right.size;
        }
        if (settings.compareTimestamp) {
            timeEqual = timestampsMatch(node.left.mtime, node.right.mtime, settings);
        }
        return sizeEqual && timeEqual;
    }

    /* ------------------------------ scanning ---------------------------- */

    function buildTree(leftItems, rightItems, settings) {
        var nodes = {};
        var rootKeys = [];

        function ensureNode(key, relPath, isDir) {
            if (!nodes[key]) {
                nodes[key] = {
                    key: key,
                    rel: relPath,
                    name: CmpUtil.baseName(relPath),
                    parentKey: parentKeyOf(key),
                    isDir: isDir,
                    depth: relPath === "" ? 0 : relPath.split("/").length - 1,
                    left: null,
                    right: null,
                    children: [],
                    state: "same",
                    newer: null,
                    minor: false,
                    needsHash: false,
                    note: ""
                };
            }
            return nodes[key];
        }

        function absorb(items, side) {
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var key = comparisonKey(item.p, settings);
                var node = ensureNode(key, item.p, item.d);
                //A folder on one side and a file on the other is reported as a
                //type conflict rather than being silently merged
                if (node.isDir !== item.d) {
                    node.typeConflict = true;
                }
                node[side] = {
                    rel: item.p,
                    size: item.s,
                    mtime: item.m,
                    isDir: item.d
                };
            }
        }

        absorb(leftItems, "left");
        absorb(rightItems, "right");

        //Wire up the parent/child links. A placeholder folder is created for
        //any entry whose parent is missing, and the worklist keeps growing so
        //that a placeholder's own ancestors get linked up too.
        var pending = Object.keys(nodes);
        var linked = {};

        while (pending.length > 0) {
            var key = pending.shift();
            if (linked[key]) {
                continue;
            }
            linked[key] = true;

            var node = nodes[key];
            if (node.parentKey === "") {
                rootKeys.push(node.key);
                continue;
            }

            var parent = nodes[node.parentKey];
            if (!parent) {
                parent = ensureNode(node.parentKey, CmpUtil.dirName(node.rel), true);
                pending.push(parent.key);
            }
            parent.children.push(node.key);
        }

        return { nodes: nodes, rootKeys: rootKeys };
    }

    function sortChildren(nodes, keys) {
        keys.sort(function (a, b) {
            var na = nodes[a];
            var nb = nodes[b];
            if (na.isDir !== nb.isDir) {
                return na.isDir ? -1 : 1;
            }
            var la = na.name.toLowerCase();
            var lb = nb.name.toLowerCase();
            if (la < lb) { return -1; }
            if (la > lb) { return 1; }
            return 0;
        });
        for (var i = 0; i < keys.length; i++) {
            sortChildren(nodes, nodes[keys[i]].children);
        }
    }

    /* ------------------------- content comparison ----------------------- */

    //`only` optionally restricts the pass to part of the tree, which is what a
    //subtree rescan uses so untouched branches keep their existing verdicts.
    function classifyPairs(nodes, settings, only) {
        var needHash = [];

        for (var key in nodes) {
            if (!Object.prototype.hasOwnProperty.call(nodes, key)) {
                continue;
            }
            if (only && !only(nodes[key])) {
                continue;
            }
            var node = nodes[key];

            if (node.isDir) {
                //Folder state is derived from its children later on
                if (!node.left && node.right) {
                    node.state = "rightOnly";
                } else if (node.left && !node.right) {
                    node.state = "leftOnly";
                } else {
                    node.state = "same";
                }
                continue;
            }

            if (node.typeConflict) {
                node.state = "diff";
                node.note = "folder on one side, file on the other";
                continue;
            }
            if (!node.left) {
                node.state = "rightOnly";
                continue;
            }
            if (!node.right) {
                node.state = "leftOnly";
                continue;
            }

            node.newer = node.left.mtime > node.right.mtime ? "left" :
                (node.right.mtime > node.left.mtime ? "right" : null);

            var quickSame = quickTest(node, settings);
            node.quickSame = quickSame;

            var wantContent = settings.compareContents &&
                !settings.otherFilters.foldersOnlyStructure &&
                !(settings.skipIfQuickSame && quickSame);

            if (wantContent) {
                node.needsHash = true;
                needHash.push(node);
                node.state = "pending";
            } else {
                node.state = quickSame ? "same" : "diff";
            }
        }

        return needHash;
    }

    function applyHashResults(pendingNodes, hashes, settings) {
        for (var i = 0; i < pendingNodes.length; i++) {
            var node = pendingNodes[i];
            var leftHash = hashes[CmpUtil.joinPath(state.leftRoot, node.left.rel)];
            var rightHash = hashes[CmpUtil.joinPath(state.rightRoot, node.right.rel)];

            if (leftHash === undefined || rightHash === undefined ||
                leftHash === "" || rightHash === "") {
                //Could not digest one of the sides, fall back to the quick test
                node.state = node.quickSame ? "same" : "diff";
                node.note = "content could not be read, quick test result used";
                continue;
            }

            var contentSame = (leftHash === rightHash);
            if (settings.contentMode === "binary" && contentSame) {
                contentSame = (node.left.size === node.right.size);
            }

            if (settings.overrideQuickTests) {
                node.state = contentSame ? "same" : "diff";
            } else {
                node.state = (contentSame && node.quickSame) ? "same" : "diff";
            }
        }
    }

    //Rules based comparison: text files that differ byte for byte are re-read
    //and compared line by line so that whitespace or comment only changes can
    //be demoted to minor differences.
    function applyRulesComparison(nodes, settings, onProgress) {
        var candidates = [];
        for (var key in nodes) {
            if (!Object.prototype.hasOwnProperty.call(nodes, key)) {
                continue;
            }
            var node = nodes[key];
            if (node.isDir || node.state !== "diff" || !node.left || !node.right) {
                continue;
            }
            if (!CmpUtil.isTextFile(node.name)) {
                continue;
            }
            if (node.left.size > 1048576 || node.right.size > 1048576) {
                continue;
            }
            candidates.push(node);
        }

        if (candidates.length === 0) {
            return Promise.resolve();
        }

        var unimportant = CmpSettings.compileUnimportant(settings.rules);
        var done = 0;

        return candidates.reduce(function (chain, node) {
            return chain.then(function () {
                if (state.abortRequested) {
                    return null;
                }
                return Promise.all([
                    CmpAPI.readText(CmpUtil.joinPath(state.leftRoot, node.left.rel)),
                    CmpAPI.readText(CmpUtil.joinPath(state.rightRoot, node.right.rel))
                ]).then(function (pair) {
                    done++;
                    if (onProgress) {
                        onProgress(done, candidates.length);
                    }
                    if (pair[0].oversized || pair[1].oversized || pair[0].binary || pair[1].binary) {
                        return;
                    }
                    var result = CmpDiff.alignLines(
                        CmpUtil.splitLines(pair[0].content),
                        CmpUtil.splitLines(pair[1].content),
                        { rules: settings.rules, unimportant: unimportant }
                    );
                    var important = result.stats.changed + result.stats.inserted + result.stats.deleted;
                    if (important === 0) {
                        node.state = "same";
                        node.minor = result.stats.minor > 0;
                        node.note = "only unimportant differences";
                    }
                }).catch(function () {
                    done++;
                    //Unreadable file keeps its digest based verdict
                });
            });
        }, Promise.resolve());
    }

    /* -------------------------- folder rollup --------------------------- */

    function rollupFolders(nodes, rootKeys) {
        function walk(key) {
            var node = nodes[key];
            var hasDiff = false;
            var hasMinor = false;
            var childCount = 0;
            var childOnLeft = false;
            var childOnRight = false;

            for (var i = 0; i < node.children.length; i++) {
                var child = walk(node.children[i]);
                childCount++;
                if (child.state !== "same") {
                    hasDiff = true;
                }
                if (child.minor) {
                    hasMinor = true;
                }
                if (child.hasDifference) {
                    hasDiff = true;
                }
                if (child.left) {
                    childOnLeft = true;
                }
                if (child.right) {
                    childOnRight = true;
                }
            }

            if (node.isDir) {
                //A placeholder folder was never listed by the scan itself, so
                //it takes its identity from the descendants that do exist
                if (!node.left && childOnLeft) {
                    node.left = { rel: node.rel, size: 0, mtime: 0, isDir: true };
                }
                if (!node.right && childOnRight) {
                    node.right = { rel: node.rel, size: 0, mtime: 0, isDir: true };
                }

                node.childCount = childCount;
                node.minor = hasMinor;
                if (!node.left && node.right) {
                    node.state = "rightOnly";
                } else if (node.left && !node.right) {
                    node.state = "leftOnly";
                } else if (node.state !== "leftOnly" && node.state !== "rightOnly") {
                    node.state = hasDiff ? "diff" : "same";
                }
            }
            node.hasDifference = (node.state !== "same") || hasDiff;
            return node;
        }

        for (var i = 0; i < rootKeys.length; i++) {
            walk(rootKeys[i]);
        }
    }

    /* ------------------------------- run -------------------------------- */

    function applyItemFilters(items, filters, settings) {
        return pruneExcluded(items, filters).filter(function (item) {
            return entryPasses(item, filters, settings);
        });
    }

    //Scan one side. `relPrefix` scopes the scan to a subfolder and rewrites the
    //returned paths so they stay relative to the session's base folder. A side
    //that does not exist yields an empty list rather than an error.
    function scanSide(rootPath, relPrefix, recursive, maxDepth) {
        var target = relPrefix === "" ? rootPath : CmpUtil.joinPath(rootPath, relPrefix);

        return CmpAPI.scan(target, recursive, maxDepth).then(function (reply) {
            if (relPrefix !== "") {
                for (var i = 0; i < reply.items.length; i++) {
                    reply.items[i].p = relPrefix + "/" + reply.items[i].p;
                }
            }
            return reply;
        }).catch(function () {
            return { root: target, truncated: false, items: [] };
        });
    }

    //Digest every pending pair and fold the answers back into the tree
    function hashPendingNodes(pending, settings, progressFrom, progressSpan) {
        if (pending.length === 0) {
            return Promise.resolve();
        }

        var hashTargets = [];
        for (var i = 0; i < pending.length; i++) {
            hashTargets.push(CmpUtil.joinPath(state.leftRoot, pending[i].left.rel));
            hashTargets.push(CmpUtil.joinPath(state.rightRoot, pending[i].right.rel));
        }

        hooks.onBusy(true, "Comparing contents", progressFrom);
        return CmpAPI.hashAll(hashTargets, 60, function (done, total) {
            hooks.onBusy(true, "Comparing contents (" + done + " of " + total + ")",
                progressFrom + Math.floor((done / total) * progressSpan));
        }).then(function (hashes) {
            applyHashResults(pending, hashes, settings);
        });
    }

    function run(leftRoot, rightRoot, settings) {
        state.leftRoot = CmpUtil.trimSlash(leftRoot);
        state.rightRoot = CmpUtil.trimSlash(rightRoot);
        state.settings = settings;
        state.running = true;
        state.abortRequested = false;
        state.selection = {};
        state.nodes = {};
        state.rootKeys = [];

        var filters = buildFilters(settings);
        var recursive = settings.otherFilters.recursive;
        var maxDepth = settings.otherFilters.maxDepth;

        hooks.onBusy(true, "Scanning folders", 0);
        hooks.onLog("Load comparison: " + state.leftRoot + " <-> " + state.rightRoot);

        return Promise.all([
            CmpAPI.scan(state.leftRoot, recursive, maxDepth),
            CmpAPI.scan(state.rightRoot, recursive, maxDepth)
        ]).then(function (results) {
            if (results[0].truncated || results[1].truncated) {
                hooks.onLog("Scan hit the 20000 entry limit, results are partial", "err");
            }

            var leftItems = applyItemFilters(results[0].items, filters, settings);
            var rightItems = applyItemFilters(results[1].items, filters, settings);

            hooks.onLog("Scanned " + leftItems.length + " left and " + rightItems.length + " right entries");
            hooks.onBusy(true, "Aligning entries", 25);

            var tree = buildTree(leftItems, rightItems, settings);
            state.nodes = tree.nodes;
            state.rootKeys = tree.rootKeys;
            sortChildren(state.nodes, state.rootKeys);

            return hashPendingNodes(classifyPairs(state.nodes, settings), settings, 30, 55);
        }).then(function () {
            if (state.settings.compareContents && state.settings.contentMode === "rules") {
                hooks.onBusy(true, "Applying comparison rules", 88);
                return applyRulesComparison(state.nodes, state.settings, function (done, total) {
                    hooks.onBusy(true, "Applying comparison rules (" + done + " of " + total + ")",
                        88 + Math.floor((done / total) * 10));
                });
            }
            return null;
        }).then(function () {
            rollupFolders(state.nodes, state.rootKeys);
            autoExpandDifferences();
            computeStats();
            state.running = false;
            hooks.onBusy(false);
            render();
            hooks.onLog("Comparison finished: " + state.stats.differences + " difference(s), " +
                state.stats.orphans + " orphan(s)", "ok");
        }).catch(function (err) {
            state.running = false;
            hooks.onBusy(false);
            hooks.onLog("Comparison failed: " + err.message, "err");
            throw err;
        });
    }

    function abort() {
        state.abortRequested = true;
    }

    //Open every folder that leads to a difference, the way the original does
    function autoExpandDifferences() {
        state.expanded = {};

        function walk(key) {
            var node = state.nodes[key];
            if (!node.isDir) {
                return;
            }
            if (node.hasDifference) {
                state.expanded[key] = true;
            }
            for (var i = 0; i < node.children.length; i++) {
                walk(node.children[i]);
            }
        }

        for (var i = 0; i < state.rootKeys.length; i++) {
            walk(state.rootKeys[i]);
        }
    }

    function computeStats() {
        var stats = { compared: 0, differences: 0, orphans: 0, sameCount: 0, leftBytes: 0, rightBytes: 0, files: 0 };

        for (var key in state.nodes) {
            if (!Object.prototype.hasOwnProperty.call(state.nodes, key)) {
                continue;
            }
            var node = state.nodes[key];
            if (node.left) {
                stats.leftBytes += node.left.isDir ? 0 : node.left.size;
            }
            if (node.right) {
                stats.rightBytes += node.right.isDir ? 0 : node.right.size;
            }
            if (node.isDir) {
                continue;
            }
            stats.files++;
            if (node.state === "same") {
                stats.sameCount++;
            } else if (node.state === "leftOnly" || node.state === "rightOnly") {
                stats.orphans++;
            } else if (node.state === "diff") {
                stats.differences++;
            }
            stats.compared++;
        }

        state.stats = stats;
    }

    /* ------------------------------ filtering --------------------------- */

    function nodeMatchesFilter(node) {
        var filters = state.filters;

        if (!filters.files && !node.isDir) {
            return false;
        }
        if (filters.nameFilter) {
            var mask = CmpUtil.maskListToRegExp(filters.nameFilter, false);
            if (mask && !mask.test(node.name)) {
                return false;
            }
        }
        if (filters.show === "diffs") {
            return node.isDir ? node.hasDifference : node.state !== "same";
        }
        if (filters.show === "same") {
            return node.isDir ? true : node.state === "same";
        }
        return true;
    }

    function shouldShowFolder(node) {
        if (state.filters.structure) {
            return true;
        }
        return node.hasDifference;
    }

    function buildVisibleRows() {
        var rows = [];

        function walk(key) {
            var node = state.nodes[key];

            if (node.isDir) {
                //A folder the structure filter rejects contains no differences
                //at all, so its whole subtree is skipped with it
                if (!shouldShowFolder(node)) {
                    return;
                }
                if (!nodeMatchesFilter(node)) {
                    //The folder row itself is filtered out by the name mask or
                    //the Files toggle, but its children may still qualify
                    for (var h = 0; h < node.children.length; h++) {
                        walk(node.children[h]);
                    }
                    return;
                }
                rows.push(node);
                if (state.expanded[key]) {
                    for (var i = 0; i < node.children.length; i++) {
                        walk(node.children[i]);
                    }
                }
                return;
            }

            if (nodeMatchesFilter(node)) {
                rows.push(node);
            }
        }

        for (var r = 0; r < state.rootKeys.length; r++) {
            walk(state.rootKeys[r]);
        }

        state.visibleRows = rows;
        return rows;
    }

    /* ------------------------------ rendering --------------------------- */

    function sideClass(node, side) {
        var info = node[side];
        if (!info) {
            return "st-blank";
        }
        if (node.state === "leftOnly" || node.state === "rightOnly") {
            return "st-orphan";
        }
        if (node.state === "diff") {
            if (node.newer === side) {
                return "st-newer";
            }
            return "st-diff";
        }
        //With the Minor button off, entries whose only differences are
        //unimportant are presented exactly like identical ones
        if (node.minor && state.filters.minor) {
            return "st-minor";
        }
        return "st-same";
    }

    function markerClass(node, side) {
        if (!node[side]) {
            return "";
        }
        if (node.state === "leftOnly" || node.state === "rightOnly") {
            return "m-orphan";
        }
        if (node.state === "diff") {
            return node.newer === side ? "m-newer" : "m-diff";
        }
        if (node.minor && state.filters.minor) {
            return "m-minor";
        }
        return "m-same";
    }

    function renderSide(node, side) {
        var info = node[side];
        var classes = "side " + sideClass(node, side);

        if (!info) {
            return '<div class="' + classes + '">' +
                '<div class="cell name"></div><div class="cell size"></div><div class="cell mtime"></div></div>';
        }

        var indent = 4 + node.depth * 13;
        var twisty = "";
        if (node.isDir) {
            var open = !!state.expanded[node.key];
            twisty = '<span class="twisty" data-twisty="' + CmpUtil.escapeHtml(node.key) + '">' +
                '<i class="caret ' + (open ? "down" : "right") + ' icon"></i></span>';
        } else {
            twisty = '<span class="twisty"></span>';
        }

        var icon = node.isDir ?
            '<span class="ficon"><i class="folder icon" style="color:var(--cmp-folder);"></i></span>' :
            '<span class="ficon"><i class="file outline icon"></i></span>';

        var marker = '<span class="marker ' + markerClass(node, side) + '"></span>';
        var sizeText = info.isDir ? "" : CmpUtil.formatSize(info.size);
        var timeText = CmpUtil.formatTime(info.mtime);

        return '<div class="' + classes + '">' +
            '<div class="cell name" style="padding-left:' + indent + 'px;">' +
                twisty + marker + icon + '<span class="fname">' + CmpUtil.escapeHtml(info.rel === "" ? "." : CmpUtil.baseName(info.rel)) + '</span>' +
            '</div>' +
            '<div class="cell size">' + sizeText + '</div>' +
            '<div class="cell mtime">' + timeText + '</div>' +
        '</div>';
    }

    function renderRow(node) {
        var selected = state.selection[node.key] ? " selected" : "";
        return '<div class="grow' + selected + '" data-key="' + CmpUtil.escapeHtml(node.key) + '" ' +
            'title="' + CmpUtil.escapeHtml(node.rel + (node.note ? "  (" + node.note + ")" : "")) + '">' +
            renderSide(node, "left") + renderSide(node, "right") + '</div>';
    }

    var scrollHandlerBound = false;

    function render() {
        buildVisibleRows();

        var body = document.getElementById("folderBody");
        if (!body) {
            return;
        }

        if (!scrollHandlerBound) {
            body.addEventListener("scroll", renderWindow);
            scrollHandlerBound = true;
        }

        renderWindow();
        updateStatus();
    }

    //Only the rows inside the viewport are turned into DOM nodes; spacer divs
    //above and below keep the scrollbar honest.
    function renderWindow() {
        var body = document.getElementById("folderBody");
        if (!body) {
            return;
        }

        var rows = state.visibleRows;
        var viewportHeight = body.clientHeight || 400;
        var firstIndex = Math.max(0, Math.floor(body.scrollTop / ROW_HEIGHT) - WINDOW_PADDING);
        var lastIndex = Math.min(rows.length,
            Math.ceil((body.scrollTop + viewportHeight) / ROW_HEIGHT) + WINDOW_PADDING);

        var html = '<div style="height:' + (firstIndex * ROW_HEIGHT) + 'px;"></div>';
        for (var i = firstIndex; i < lastIndex; i++) {
            html += renderRow(rows[i]);
        }
        html += '<div style="height:' + ((rows.length - lastIndex) * ROW_HEIGHT) + 'px;"></div>';

        body.innerHTML = html;
    }

    function updateStatus() {
        hooks.onStatus({
            leftFiles: countSide("left"),
            rightFiles: countSide("right"),
            leftBytes: state.stats.leftBytes,
            rightBytes: state.stats.rightBytes,
            differences: state.stats.differences,
            orphans: state.stats.orphans,
            same: state.stats.sameCount,
            shown: state.visibleRows.length,
            selected: Object.keys(state.selection).length
        });
    }

    function countSide(side) {
        var count = 0;
        for (var key in state.nodes) {
            if (Object.prototype.hasOwnProperty.call(state.nodes, key)) {
                var node = state.nodes[key];
                if (node[side] && !node.isDir) {
                    count++;
                }
            }
        }
        return count;
    }

    /* ----------------------------- interaction -------------------------- */

    function toggleExpand(key) {
        state.expanded[key] = !state.expanded[key];
        render();
    }

    function expandAll() {
        for (var key in state.nodes) {
            if (Object.prototype.hasOwnProperty.call(state.nodes, key) && state.nodes[key].isDir) {
                state.expanded[key] = true;
            }
        }
        render();
    }

    function collapseAll() {
        state.expanded = {};
        render();
    }

    function selectKey(key, additive, range) {
        if (!additive && !range) {
            state.selection = {};
        }
        if (range && state.lastClickedKey) {
            var rows = state.visibleRows;
            var from = -1;
            var to = -1;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].key === state.lastClickedKey) { from = i; }
                if (rows[i].key === key) { to = i; }
            }
            if (from >= 0 && to >= 0) {
                var start = Math.min(from, to);
                var end = Math.max(from, to);
                for (var r = start; r <= end; r++) {
                    state.selection[rows[r].key] = true;
                }
            }
        } else {
            if (additive && state.selection[key]) {
                delete state.selection[key];
            } else {
                state.selection[key] = true;
            }
            state.lastClickedKey = key;
        }
        renderWindow();
        updateStatus();
    }

    function selectPreset(preset) {
        state.selection = {};
        var rows = buildVisibleRows();
        for (var i = 0; i < rows.length; i++) {
            var node = rows[i];
            if (preset === "none") {
                break;
            }
            if (preset === "all") {
                state.selection[node.key] = true;
            } else if (preset === "diffs" && node.state === "diff") {
                state.selection[node.key] = true;
            } else if (preset === "orphans" && (node.state === "leftOnly" || node.state === "rightOnly")) {
                state.selection[node.key] = true;
            } else if (preset === "leftnewer" && node.state === "diff" && node.newer === "left") {
                state.selection[node.key] = true;
            } else if (preset === "rightnewer" && node.state === "diff" && node.newer === "right") {
                state.selection[node.key] = true;
            }
        }
        renderWindow();
        updateStatus();
    }

    function selectedNodes() {
        var out = [];
        for (var key in state.selection) {
            if (Object.prototype.hasOwnProperty.call(state.selection, key) && state.nodes[key]) {
                out.push(state.nodes[key]);
            }
        }
        //Shallowest first so parent folders are created before their contents
        out.sort(function (a, b) {
            return a.depth - b.depth || a.rel.localeCompare(b.rel);
        });
        return out;
    }

    function getNode(key) {
        return state.nodes[key];
    }

    /* --------------------------- copy and delete ------------------------ */

    //Copy the selected entries from one side to the other. Folders are copied
    //whole by the server side file system, files land next to their sibling.
    function copySelection(direction) {
        return copyNodes(selectedNodes(), direction);
    }

    //Copy an explicit set of entries from one side to the other. Used by both
    //the toolbar (acting on the selection) and the row context menu.
    function copyNodes(nodeList, direction, refreshKey) {
        var settings = state.settings;
        var fromSide = direction === "toRight" ? "left" : "right";
        var toSide = direction === "toRight" ? "right" : "left";
        var fromRoot = direction === "toRight" ? state.leftRoot : state.rightRoot;
        var toRoot = direction === "toRight" ? state.rightRoot : state.leftRoot;

        if ((toSide === "left" && settings.specs.leftReadOnly) ||
            (toSide === "right" && settings.specs.rightReadOnly)) {
            hooks.onLog("The " + toSide + " side is marked read only in the session settings", "err");
            return Promise.resolve();
        }

        var nodes = nodeList.filter(function (node) {
            return !!node[fromSide];
        });

        if (nodes.length === 0) {
            hooks.onLog("Nothing on the " + fromSide + " side to copy", "err");
            return Promise.resolve();
        }

        //A selected folder already carries its whole subtree across, so drop
        //any descendant that would just be copied twice
        var folderPrefixes = nodes.filter(function (node) {
            return node.isDir;
        }).map(function (node) {
            return node.rel + "/";
        });
        nodes = nodes.filter(function (node) {
            for (var i = 0; i < folderPrefixes.length; i++) {
                if (node.rel !== folderPrefixes[i].slice(0, -1) && node.rel.indexOf(folderPrefixes[i]) === 0) {
                    return false;
                }
            }
            return true;
        });

        if (settings.handling.confirmDestructive) {
            var arrow = direction === "toRight" ? "right" : "left";
            if (!window.confirm("Copy " + nodes.length + " item(s) to the " + arrow + " side?\n\n" +
                "Existing files will be " + (settings.handling.overwriteExisting ? "overwritten" : "skipped") + ".")) {
                return Promise.resolve();
            }
        }

        hooks.onBusy(true, "Copying " + nodes.length + " item(s)", 0);
        var copied = 0;
        var failed = 0;

        return nodes.reduce(function (chain, node, index) {
            return chain.then(function () {
                var sourcePath = CmpUtil.joinPath(fromRoot, node[fromSide].rel);
                var targetDirRel = CmpUtil.dirName(node.rel);
                if (targetDirRel === node.rel) {
                    targetDirRel = "";
                }
                var targetDir = targetDirRel === "" ? toRoot : CmpUtil.joinPath(toRoot, targetDirRel);

                hooks.onBusy(true, "Copying " + node.rel,
                    Math.floor((index / nodes.length) * 100));

                var prepare = settings.handling.createMissingFolders ?
                    CmpAPI.mkdirp(targetDir) : Promise.resolve();

                return prepare.then(function () {
                    if (node.isDir && !node[toSide]) {
                        //An orphan folder is recreated then filled by the copy
                        return CmpAPI.mkdirp(CmpUtil.joinPath(toRoot, node.rel)).then(function () {
                            return CmpAPI.copyInto(sourcePath, targetDir, settings.handling.overwriteExisting);
                        });
                    }
                    return CmpAPI.copyInto(sourcePath, targetDir, settings.handling.overwriteExisting);
                }).then(function () {
                    copied++;
                }).catch(function (err) {
                    failed++;
                    hooks.onLog("Copy failed for " + node.rel + ": " + err.message, "err");
                });
            });
        }, Promise.resolve()).then(function () {
            hooks.onBusy(false);
            hooks.onLog("Copied " + copied + " item(s)" + (failed ? ", " + failed + " failed" : ""),
                failed ? "err" : "ok");
            if (refreshKey === "none") {
                //The caller chains several operations and rescans once at the end
                return null;
            }
            return refreshKey ? refreshSubtree(refreshKey) : refresh();
        });
    }

    function deleteSelection(side) {
        return deleteNodes(selectedNodes(), side);
    }

    function deleteNodes(nodeList, side, refreshKey) {
        var settings = state.settings;
        if ((side === "left" && settings.specs.leftReadOnly) ||
            (side === "right" && settings.specs.rightReadOnly)) {
            hooks.onLog("The " + side + " side is marked read only in the session settings", "err");
            return Promise.resolve();
        }

        var root = side === "left" ? state.leftRoot : state.rightRoot;
        var targets = nodeList.filter(function (node) {
            return !!node[side];
        }).map(function (node) {
            return CmpUtil.joinPath(root, node[side].rel);
        });

        if (targets.length === 0) {
            hooks.onLog("Nothing on the " + side + " side to delete", "err");
            return Promise.resolve();
        }

        if (settings.handling.confirmDestructive) {
            if (!window.confirm("Delete " + targets.length + " item(s) from the " + side + " side?\n\n" +
                (settings.handling.deleteToRecycleBin ?
                    "They will be moved to the recycle bin." :
                    "They will be removed permanently."))) {
                return Promise.resolve();
            }
        }

        hooks.onBusy(true, "Deleting " + targets.length + " item(s)", 30);
        var operation = settings.handling.deleteToRecycleBin ?
            CmpAPI.recycle(targets) : CmpAPI.removePaths(targets);

        return operation.then(function () {
            hooks.onBusy(false);
            hooks.onLog("Deleted " + targets.length + " item(s) from the " + side + " side", "ok");
            if (refreshKey === "none") {
                //The caller chains several operations and rescans once at the end
                return null;
            }
            return refreshKey ? refreshSubtree(refreshKey) : refresh();
        }).catch(function (err) {
            hooks.onBusy(false);
            hooks.onLog("Delete failed: " + err.message, "err");
        });
    }

    //Copy each entry from whichever side holds the newer version. This is the
    //quickest way to reconcile a branch that was edited on both sides.
    function copyNewerOf(nodeList) {
        var toRight = [];
        var toLeft = [];

        for (var i = 0; i < nodeList.length; i++) {
            var node = nodeList[i];
            if (node.isDir) {
                continue;
            }
            if (node.state === "leftOnly") {
                toRight.push(node);
            } else if (node.state === "rightOnly") {
                toLeft.push(node);
            } else if (node.state === "diff") {
                if (node.newer === "right") {
                    toLeft.push(node);
                } else {
                    toRight.push(node);
                }
            }
        }

        if (toRight.length === 0 && toLeft.length === 0) {
            hooks.onLog("Nothing to copy, the selected entries already match", "ok");
            return Promise.resolve();
        }

        if (state.settings.handling.confirmDestructive &&
            !window.confirm("Copy the newer side over the older one?\n\n" +
                toRight.length + " file(s) to the right, " + toLeft.length + " to the left.")) {
            return Promise.resolve();
        }

        //Suppress the per-call confirmation, the combined one above covers it
        var settings = state.settings;
        var confirmWas = settings.handling.confirmDestructive;
        settings.handling.confirmDestructive = false;

        return copyNodes(toRight, "toRight", "none").then(function () {
            return copyNodes(toLeft, "toLeft", "none");
        }).then(function () {
            settings.handling.confirmDestructive = confirmWas;
            return refresh();
        }).catch(function (err) {
            settings.handling.confirmDestructive = confirmWas;
            throw err;
        });
    }

    /* ---------------------------- subtree helpers ----------------------- */

    function descendantsOf(key, includeSelf) {
        var out = [];
        var node = state.nodes[key];
        if (!node) {
            return out;
        }
        if (includeSelf) {
            out.push(node);
        }

        function walk(current) {
            for (var i = 0; i < current.children.length; i++) {
                var child = state.nodes[current.children[i]];
                if (!child) {
                    continue;
                }
                out.push(child);
                walk(child);
            }
        }

        walk(node);
        return out;
    }

    function expandSubtree(key, open) {
        var branch = descendantsOf(key, true);
        for (var i = 0; i < branch.length; i++) {
            if (branch[i].isDir) {
                state.expanded[branch[i].key] = !!open;
            }
        }
        //Keeping the clicked folder open makes a collapse feel less abrupt
        if (!open) {
            state.expanded[key] = true;
        }
        render();
    }

    function selectDifferencesBelow(key) {
        state.selection = {};
        var branch = descendantsOf(key, false);
        for (var i = 0; i < branch.length; i++) {
            if (!branch[i].isDir && branch[i].state !== "same") {
                state.selection[branch[i].key] = true;
            }
        }
        renderWindow();
        updateStatus();
        hooks.onLog(Object.keys(state.selection).length + " differing file(s) selected below " +
            (state.nodes[key] ? state.nodes[key].rel : key));
    }

    /* ------------------------------- sync ------------------------------- */

    //Build the list of operations a folder sync would perform, so the user can
    //see exactly what is about to happen before committing to it.
    //`scopeKey` limits the plan to one branch, which is what the context menu
    //uses to synchronise a single folder instead of the whole session.
    function planSync(direction, scopeKey) {
        var plan = [];
        var branchPrefix = scopeKey ? scopeKey + "/" : null;

        for (var key in state.nodes) {
            if (!Object.prototype.hasOwnProperty.call(state.nodes, key)) {
                continue;
            }
            if (branchPrefix && key.indexOf(branchPrefix) !== 0) {
                continue;
            }
            var node = state.nodes[key];
            if (node.isDir || node.state === "same") {
                continue;
            }

            if (direction === "toRight") {
                if (node.state === "leftOnly" || node.state === "diff") {
                    plan.push({ node: node, action: "copy", from: "left" });
                }
            } else if (direction === "toLeft") {
                if (node.state === "rightOnly" || node.state === "diff") {
                    plan.push({ node: node, action: "copy", from: "right" });
                }
            } else {
                //Update both sides, newest file wins
                if (node.state === "leftOnly") {
                    plan.push({ node: node, action: "copy", from: "left" });
                } else if (node.state === "rightOnly") {
                    plan.push({ node: node, action: "copy", from: "right" });
                } else if (node.state === "diff") {
                    plan.push({ node: node, action: "copy", from: node.newer === "right" ? "right" : "left" });
                }
            }
        }
        return plan;
    }

    function runSync(direction, scopeKey) {
        var plan = planSync(direction, scopeKey);
        var scopeName = scopeKey && state.nodes[scopeKey] ? state.nodes[scopeKey].rel : "";

        if (plan.length === 0) {
            hooks.onLog("Both sides already match" + (scopeName ? " under " + scopeName : "") +
                ", nothing to synchronise", "ok");
            return Promise.resolve();
        }

        var label = direction === "toRight" ? "left to right" :
            (direction === "toLeft" ? "right to left" : "both directions");

        if (state.settings.handling.confirmDestructive &&
            !window.confirm("Synchronise " + label + (scopeName ? " under " + scopeName : "") + "?\n\n" +
                plan.length + " file(s) will be copied.")) {
            return Promise.resolve();
        }

        hooks.onBusy(true, "Synchronising " + plan.length + " file(s)", 0);
        var done = 0;
        var failed = 0;

        return plan.reduce(function (chain, step, index) {
            return chain.then(function () {
                if (state.abortRequested) {
                    return null;
                }
                var fromRoot = step.from === "left" ? state.leftRoot : state.rightRoot;
                var toRoot = step.from === "left" ? state.rightRoot : state.leftRoot;
                var toSide = step.from === "left" ? "right" : "left";

                if ((toSide === "left" && state.settings.specs.leftReadOnly) ||
                    (toSide === "right" && state.settings.specs.rightReadOnly)) {
                    return null;
                }

                var sourcePath = CmpUtil.joinPath(fromRoot, step.node[step.from].rel);
                var targetDirRel = CmpUtil.dirName(step.node.rel);
                if (targetDirRel === step.node.rel) {
                    targetDirRel = "";
                }
                var targetDir = targetDirRel === "" ? toRoot : CmpUtil.joinPath(toRoot, targetDirRel);

                hooks.onBusy(true, "Copying " + step.node.rel, Math.floor((index / plan.length) * 100));

                return CmpAPI.mkdirp(targetDir).then(function () {
                    return CmpAPI.copyInto(sourcePath, targetDir, true);
                }).then(function () {
                    done++;
                }).catch(function (err) {
                    failed++;
                    hooks.onLog("Sync failed for " + step.node.rel + ": " + err.message, "err");
                });
            });
        }, Promise.resolve()).then(function () {
            hooks.onBusy(false);
            hooks.onLog("Synchronised " + done + " file(s)" + (failed ? ", " + failed + " failed" : ""),
                failed ? "err" : "ok");
            return scopeKey ? refreshSubtree(scopeKey) : refresh();
        });
    }

    /*
        Rescan just one branch of the tree and splice the result back in.

        Everything outside the branch keeps its existing verdict, so this is
        the cheap way to pick up changes made outside the tool, or to confirm
        what a copy actually produced, without re-digesting the whole session.
    */
    function refreshSubtree(key) {
        var target = state.nodes[key];
        if (!target) {
            return Promise.resolve();
        }

        //A file is refreshed by rescanning the folder that holds it
        if (!target.isDir) {
            if (target.parentKey === "" || !state.nodes[target.parentKey]) {
                return refresh();
            }
            key = target.parentKey;
            target = state.nodes[key];
        }

        var settings = state.settings;
        var filters = buildFilters(settings);
        var rel = target.rel;
        var branchPrefix = key + "/";

        hooks.onBusy(true, "Rescanning " + rel, 10);
        hooks.onLog("Rescanning subtree: " + rel);

        return Promise.all([
            scanSide(state.leftRoot, rel, settings.otherFilters.recursive, settings.otherFilters.maxDepth),
            scanSide(state.rightRoot, rel, settings.otherFilters.recursive, settings.otherFilters.maxDepth)
        ]).then(function (results) {
            var leftItems = applyItemFilters(results[0].items, filters, settings);
            var rightItems = applyItemFilters(results[1].items, filters, settings);
            var tree = buildTree(leftItems, rightItems, settings);

            //Drop the stale branch, then graft the freshly scanned one on
            var existing = Object.keys(state.nodes);
            for (var i = 0; i < existing.length; i++) {
                if (existing[i].indexOf(branchPrefix) === 0) {
                    delete state.nodes[existing[i]];
                    delete state.selection[existing[i]];
                }
            }

            var fresh = Object.keys(tree.nodes);
            for (var f = 0; f < fresh.length; f++) {
                if (fresh[f] !== key) {
                    state.nodes[fresh[f]] = tree.nodes[fresh[f]];
                }
            }

            target.children = tree.nodes[key] ? tree.nodes[key].children : [];
            sortChildren(state.nodes, target.children);

            var pending = classifyPairs(state.nodes, settings, function (node) {
                return node.key.indexOf(branchPrefix) === 0;
            });
            return hashPendingNodes(pending, settings, 40, 50);
        }).then(function () {
            rollupFolders(state.nodes, state.rootKeys);
            computeStats();
            hooks.onBusy(false);
            render();
            hooks.onLog("Rescanned " + rel, "ok");
        }).catch(function (err) {
            hooks.onBusy(false);
            hooks.onLog("Rescan failed for " + rel + ": " + err.message, "err");
        });
    }

    function refresh() {
        if (!state.leftRoot || !state.rightRoot) {
            return Promise.resolve();
        }
        var keepExpanded = state.expanded;
        return run(state.leftRoot, state.rightRoot, state.settings).then(function () {
            //Restore whatever the user had opened before the rescan
            for (var key in keepExpanded) {
                if (Object.prototype.hasOwnProperty.call(keepExpanded, key) && state.nodes[key]) {
                    state.expanded[key] = keepExpanded[key];
                }
            }
            render();
        });
    }

    function swap() {
        var oldLeft = state.leftRoot;
        state.leftRoot = state.rightRoot;
        state.rightRoot = oldLeft;
        return refresh();
    }

    function setFilter(name, value) {
        state.filters[name] = value;
        render();
    }

    function getFilters() {
        return state.filters;
    }

    function getState() {
        return state;
    }

    function pathsOf(node) {
        return {
            left: node.left ? CmpUtil.joinPath(state.leftRoot, node.left.rel) : null,
            right: node.right ? CmpUtil.joinPath(state.rightRoot, node.right.rel) : null
        };
    }

    return {
        setHooks: setHooks,
        run: run,
        refresh: refresh,
        abort: abort,
        swap: swap,
        render: render,
        renderWindow: renderWindow,
        toggleExpand: toggleExpand,
        expandAll: expandAll,
        collapseAll: collapseAll,
        selectKey: selectKey,
        selectPreset: selectPreset,
        selectedNodes: selectedNodes,
        getNode: getNode,
        copySelection: copySelection,
        copyNodes: copyNodes,
        copyNewerOf: copyNewerOf,
        deleteSelection: deleteSelection,
        deleteNodes: deleteNodes,
        refreshSubtree: refreshSubtree,
        expandSubtree: expandSubtree,
        descendantsOf: descendantsOf,
        selectDifferencesBelow: selectDifferencesBelow,
        planSync: planSync,
        runSync: runSync,
        setFilter: setFilter,
        getFilters: getFilters,
        getState: getState,
        pathsOf: pathsOf
    };
})();
