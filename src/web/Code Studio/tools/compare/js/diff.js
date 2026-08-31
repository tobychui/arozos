/*
    diff.js - line and token level difference engine

    Uses the classic Myers greedy algorithm with structural sharing of the
    edit path, which keeps memory proportional to the number of differences
    rather than to the product of the two file lengths.
*/

var CmpDiff = (function () {

    function pushComponent(components, added, removed) {
        if (components && components.added === added && components.removed === removed) {
            return {
                count: components.count + 1,
                added: added,
                removed: removed,
                prev: components.prev
            };
        }
        return { count: 1, added: added, removed: removed, prev: components };
    }

    function extractCommon(basePath, oldArr, newArr, diagonalPath) {
        var newLen = newArr.length;
        var oldLen = oldArr.length;
        var newPos = basePath.newPos;
        var oldPos = newPos - diagonalPath;
        var commonCount = 0;

        while (newPos + 1 < newLen && oldPos + 1 < oldLen &&
               oldArr[oldPos + 1] === newArr[newPos + 1]) {
            newPos++;
            oldPos++;
            commonCount++;
        }

        if (commonCount) {
            basePath.components = {
                count: commonCount,
                added: false,
                removed: false,
                prev: basePath.components
            };
        }

        basePath.newPos = newPos;
        return oldPos;
    }

    function buildComponents(chain) {
        var out = [];
        var node = chain;
        while (node) {
            out.push({ count: node.count, added: node.added, removed: node.removed });
            node = node.prev;
        }
        out.reverse();
        return out;
    }

    //Returns an array of {count, added, removed} components describing how to
    //turn oldArr into newArr, or null when the edit distance limit is hit.
    function myers(oldArr, newArr, maxEditLength) {
        var newLen = newArr.length;
        var oldLen = oldArr.length;
        var maxEdit = Math.min(maxEditLength || (newLen + oldLen), newLen + oldLen);

        if (oldLen === 0 && newLen === 0) {
            return [];
        }

        var bestPath = [{ newPos: -1, components: null }];
        var oldPos = extractCommon(bestPath[0], oldArr, newArr, 0);
        if (bestPath[0].newPos + 1 >= newLen && oldPos + 1 >= oldLen) {
            return buildComponents(bestPath[0].components);
        }

        for (var editLength = 1; editLength <= maxEdit; editLength++) {
            for (var diagonalPath = -1 * editLength; diagonalPath <= editLength; diagonalPath += 2) {
                var addPath = bestPath[diagonalPath - 1];
                var removePath = bestPath[diagonalPath + 1];
                var currentOldPos = (removePath ? removePath.newPos : 0) - diagonalPath;

                if (addPath) {
                    bestPath[diagonalPath - 1] = undefined;
                }

                var canAdd = addPath && addPath.newPos + 1 < newLen;
                var canRemove = removePath && currentOldPos >= 0 && currentOldPos < oldLen;
                if (!canAdd && !canRemove) {
                    bestPath[diagonalPath] = undefined;
                    continue;
                }

                var basePath;
                if (!canAdd || (canRemove && addPath.newPos < removePath.newPos)) {
                    basePath = {
                        newPos: removePath.newPos,
                        components: pushComponent(removePath.components, false, true)
                    };
                } else {
                    basePath = {
                        newPos: addPath.newPos + 1,
                        components: pushComponent(addPath.components, true, false)
                    };
                }

                currentOldPos = extractCommon(basePath, oldArr, newArr, diagonalPath);
                if (basePath.newPos + 1 >= newLen && currentOldPos + 1 >= oldLen) {
                    return buildComponents(basePath.components);
                }
                bestPath[diagonalPath] = basePath;
            }
        }

        return null;
    }

    //Fallback used when the edit distance is beyond the Myers budget: anchor
    //on identical lines and treat everything between anchors as a change.
    function fallbackAlign(leftKeys, rightKeys) {
        var rows = [];
        var leftIdx = 0;
        var rightIdx = 0;
        var maxLen = Math.max(leftKeys.length, rightKeys.length);

        while (leftIdx < leftKeys.length || rightIdx < rightKeys.length) {
            if (leftIdx < leftKeys.length && rightIdx < rightKeys.length) {
                if (leftKeys[leftIdx] === rightKeys[rightIdx]) {
                    rows.push({ type: "same", l: leftIdx, r: rightIdx });
                } else {
                    rows.push({ type: "change", l: leftIdx, r: rightIdx });
                }
                leftIdx++;
                rightIdx++;
            } else if (leftIdx < leftKeys.length) {
                rows.push({ type: "del", l: leftIdx, r: null });
                leftIdx++;
            } else {
                rows.push({ type: "ins", l: null, r: rightIdx });
                rightIdx++;
            }
            if (rows.length > maxLen * 2 + 16) {
                break;
            }
        }
        return rows;
    }

    //Turn Myers components into paired rows, matching deletions with the
    //insertions that immediately follow them so they read as one change block.
    function componentsToRows(components, leftLen, rightLen) {
        var rows = [];
        var leftIdx = 0;
        var rightIdx = 0;
        var i = 0;

        while (i < components.length) {
            var component = components[i];

            if (!component.added && !component.removed) {
                for (var s = 0; s < component.count; s++) {
                    rows.push({ type: "same", l: leftIdx++, r: rightIdx++ });
                }
                i++;
                continue;
            }

            var removedCount = 0;
            var addedCount = 0;
            if (component.removed) {
                removedCount = component.count;
                i++;
                if (i < components.length && components[i].added) {
                    addedCount = components[i].count;
                    i++;
                }
            } else {
                addedCount = component.count;
                i++;
                if (i < components.length && components[i].removed) {
                    removedCount = components[i].count;
                    i++;
                }
            }

            var paired = Math.min(removedCount, addedCount);
            for (var p = 0; p < paired; p++) {
                rows.push({ type: "change", l: leftIdx++, r: rightIdx++ });
            }
            for (var d = paired; d < removedCount; d++) {
                rows.push({ type: "del", l: leftIdx++, r: null });
            }
            for (var a = paired; a < addedCount; a++) {
                rows.push({ type: "ins", l: null, r: rightIdx++ });
            }
        }

        //Anything the component list did not cover (only possible on a
        //malformed chain) is emitted verbatim so nothing silently disappears
        while (leftIdx < leftLen) {
            rows.push({ type: "del", l: leftIdx++, r: null });
        }
        while (rightIdx < rightLen) {
            rows.push({ type: "ins", l: null, r: rightIdx++ });
        }

        return rows;
    }

    /*
        Align two arrays of raw text lines.

        options:
          rules        - the rules object from the session settings
          unimportant  - precompiled RegExp list from CmpSettings
          maxEdits     - Myers budget, defaults to a size derived limit

        Returns {rows, stats}. Row types are same | minor | change | del | ins,
        and every non-same row carries a hunk index for section navigation.
    */
    function alignLines(leftLines, rightLines, options) {
        var opts = options || {};
        var rules = opts.rules || {};
        var unimportant = opts.unimportant || [];

        var leftKeys = new Array(leftLines.length);
        var rightKeys = new Array(rightLines.length);
        for (var i = 0; i < leftLines.length; i++) {
            leftKeys[i] = CmpSettings.normalizeLine(leftLines[i], rules, unimportant);
        }
        for (var j = 0; j < rightLines.length; j++) {
            rightKeys[j] = CmpSettings.normalizeLine(rightLines[j], rules, unimportant);
        }

        var budget = opts.maxEdits || Math.max(400, Math.floor((leftKeys.length + rightKeys.length) / 2));
        var components = myers(leftKeys, rightKeys, budget);
        var rows = components === null ?
            fallbackAlign(leftKeys, rightKeys) :
            componentsToRows(components, leftKeys.length, rightKeys.length);

        //Classify unimportant differences and group rows into hunks
        var stats = { same: 0, minor: 0, changed: 0, inserted: 0, deleted: 0, hunks: 0 };
        var hunkIndex = -1;
        var inHunk = false;

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];

            if (row.type === "same") {
                var rawLeft = leftLines[row.l];
                var rawRight = rightLines[row.r];
                if (rawLeft !== rawRight) {
                    row.type = "minor";
                }
            } else if (row.type === "change") {
                if (leftKeys[row.l] === rightKeys[row.r]) {
                    row.type = "minor";
                }
            } else if (rules.ignoreBlankLines) {
                var raw = row.type === "del" ? leftLines[row.l] : rightLines[row.r];
                if (String(raw === undefined ? "" : raw).trim() === "") {
                    row.minorOrphan = true;
                }
            }

            var isDifference = (row.type === "change" || row.type === "del" || row.type === "ins");
            var isMinorRow = (row.type === "minor" || row.minorOrphan === true);

            if (isDifference || isMinorRow) {
                if (!inHunk) {
                    hunkIndex++;
                    inHunk = true;
                }
                row.hunk = hunkIndex;
                row.important = isDifference && !row.minorOrphan;
            } else {
                inHunk = false;
                row.hunk = -1;
                row.important = false;
            }

            if (row.type === "same") {
                stats.same++;
            } else if (row.type === "minor") {
                stats.minor++;
            } else if (row.type === "change") {
                stats.changed++;
            } else if (row.type === "del") {
                stats.deleted++;
            } else if (row.type === "ins") {
                stats.inserted++;
            }
        }

        stats.hunks = hunkIndex + 1;
        return { rows: rows, stats: stats };
    }

    /* --------------------------- inline diff ---------------------------- */

    function tokenize(text) {
        var matches = String(text === undefined || text === null ? "" : text)
            .match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g);
        return matches || [];
    }

    //Word level difference between two single lines. Returns two arrays of
    //{text, changed} segments ready for rendering.
    function inlineDiff(leftText, rightText) {
        var leftTokens = tokenize(leftText);
        var rightTokens = tokenize(rightText);
        var components = myers(leftTokens, rightTokens, 600);

        if (components === null) {
            return {
                left: [{ text: String(leftText || ""), changed: true }],
                right: [{ text: String(rightText || ""), changed: true }]
            };
        }

        var leftParts = [];
        var rightParts = [];
        var leftIdx = 0;
        var rightIdx = 0;

        function append(list, text, changed) {
            if (text === "") {
                return;
            }
            var last = list[list.length - 1];
            if (last && last.changed === changed) {
                last.text += text;
            } else {
                list.push({ text: text, changed: changed });
            }
        }

        for (var i = 0; i < components.length; i++) {
            var component = components[i];
            var chunk = "";
            if (component.added) {
                chunk = rightTokens.slice(rightIdx, rightIdx + component.count).join("");
                append(rightParts, chunk, true);
                rightIdx += component.count;
            } else if (component.removed) {
                chunk = leftTokens.slice(leftIdx, leftIdx + component.count).join("");
                append(leftParts, chunk, true);
                leftIdx += component.count;
            } else {
                chunk = leftTokens.slice(leftIdx, leftIdx + component.count).join("");
                append(leftParts, chunk, false);
                append(rightParts, rightTokens.slice(rightIdx, rightIdx + component.count).join(""), false);
                leftIdx += component.count;
                rightIdx += component.count;
            }
        }

        return { left: leftParts, right: rightParts };
    }

    //Group aligned rows into contiguous difference sections
    function collectHunks(rows) {
        var hunks = [];
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row.hunk === undefined || row.hunk < 0) {
                continue;
            }
            if (!hunks[row.hunk]) {
                hunks[row.hunk] = {
                    index: row.hunk,
                    firstRow: i,
                    lastRow: i,
                    leftStart: null,
                    leftEnd: null,
                    rightStart: null,
                    rightEnd: null,
                    important: false
                };
            }
            var hunk = hunks[row.hunk];
            hunk.lastRow = i;
            hunk.important = hunk.important || !!row.important;
            if (row.l !== null && row.l !== undefined) {
                if (hunk.leftStart === null) {
                    hunk.leftStart = row.l;
                }
                hunk.leftEnd = row.l;
            }
            if (row.r !== null && row.r !== undefined) {
                if (hunk.rightStart === null) {
                    hunk.rightStart = row.r;
                }
                hunk.rightEnd = row.r;
            }
        }
        return hunks;
    }

    return {
        alignLines: alignLines,
        inlineDiff: inlineDiff,
        collectHunks: collectHunks,
        myers: myers
    };
})();
