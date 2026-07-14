/*
    ArozOS Office - Sheets: charts, filter UI, import/export and print.
    Requires sheets.js (SheetsApp core API) and ../common/charts.js.

    Import/export support:
        .csv / .tsv  - parsed and produced client-side
        .xlsx        - converted server-side by the "office" AGI library
                       (Office/sheets/backend/xlsx.agi -> mod/office)
        .xls (legacy binary) is not supported - convert to .xlsx first.
*/

var SheetsIO = (function () {
    "use strict";

    var Core = SheetsApp;
    var F = SheetFormula;
    var XLSX_BACKEND = "Office/sheets/backend/xlsx.agi";

    function esc(t) { return OfficeApp.escapeHtml(t); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function genId() {
        return "ch-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    }

    /* ================= charts ================= */
    function specFromChart(chart) {
        var rg = Core.parseRange(chart.range);
        var opts = chart.opts || {};
        if (!rg) return { type: opts.type || "bar", title: opts.title || "", labels: [], series: [] };
        var headerRow = opts.headerRow !== false;
        var labelCol = opts.labelCol !== false;
        var dataC1 = labelCol ? rg.c1 + 1 : rg.c1;
        var dataR1 = headerRow ? rg.r1 + 1 : rg.r1;

        var labels = [];
        var r, c;
        for (r = dataR1; r <= rg.r2; r++) {
            labels.push(labelCol ? Core.displayText(rg.c1, r) : String(r - dataR1 + 1));
        }
        var series = [];
        for (c = dataC1; c <= rg.c2; c++) {
            var name = headerRow ? Core.displayText(c, rg.r1) : ("Series " + (c - dataC1 + 1));
            var values = [];
            for (r = dataR1; r <= rg.r2; r++) {
                var v = Core.valueAt(c, r);
                values.push(typeof v === "number" ? v : 0);
            }
            series.push({ name: name, values: values });
        }
        return {
            type: opts.type || "bar",
            title: opts.title || "",
            labels: labels,
            series: series,
            options: { stacked: !!opts.stacked }
        };
    }

    // cross-app copy: a chart as a self-contained <img> (SVG snapshot) so it
    // can be pasted into Slides / Docs
    function chartToImageHtml(chart) {
        var w = Math.max(120, (chart.w || 460) - 10);
        var h = Math.max(90, (chart.h || 300) - 10);
        var svg = OfficeCharts.renderToString(specFromChart(chart), w, h);
        // charts inherit currentColor for their text - pin it for the snapshot
        svg = svg.replace("<svg ", '<svg color="#202124" ');
        return OfficeClipboard.imageHtml(OfficeClipboard.svgImageSrc(svg), chart.w, chart.h);
    }

    function renderCharts() {
        var layer = document.getElementById("shChartLayer");
        if (!layer) return;
        var charts = Core.sheet().charts || [];
        var selId = Core.selectedChart();
        var out = [];
        charts.forEach(function (ch) {
            out.push('<div class="sh-chart' + (ch.id === selId ? " sel" : "") + '" data-chid="' + esc(ch.id) +
                '" style="left:' + ch.x + "px;top:" + ch.y + "px;width:" + ch.w + "px;height:" + ch.h + 'px;">' +
                OfficeCharts.renderToString(specFromChart(ch), Math.max(80, ch.w - 10), Math.max(60, ch.h - 10)) +
                '<div class="sh-chart-rz"></div></div>');
        });
        layer.innerHTML = out.join("");
    }
    function chartById(id) {
        var charts = Core.sheet().charts || [];
        for (var i = 0; i < charts.length; i++) if (charts[i].id === id) return charts[i];
        return null;
    }
    function deleteChart(id) {
        var s = Core.sheet();
        s.charts = (s.charts || []).filter(function (c) { return c.id !== id; });
        Core.selectChart(null);
        Core.commit();
    }

    /* drag / resize / select / edit via delegated pointer events */
    var chDrag = null;
    function initChartEvents() {
        var layer = document.getElementById("shChartLayer");
        layer.addEventListener("pointerdown", function (e) {
            var el = e.target.closest ? e.target.closest(".sh-chart") : null;
            if (!el) return;
            var id = el.getAttribute("data-chid");
            var ch = chartById(id);
            if (!ch) return;
            Core.selectChart(id);
            var isRz = e.target.classList.contains("sh-chart-rz");
            chDrag = {
                id: id, rz: isRz,
                startX: e.clientX, startY: e.clientY,
                g: { x: ch.x, y: ch.y, w: ch.w, h: ch.h },
                moved: false
            };
            try { el.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();
            e.stopPropagation();
        });
        layer.addEventListener("pointermove", function (e) {
            if (!chDrag) return;
            var ch = chartById(chDrag.id);
            if (!ch) return;
            var z = Core.zoomFactor() || 1;
            var dx = (e.clientX - chDrag.startX), dy = (e.clientY - chDrag.startY);
            if (Math.abs(dx) + Math.abs(dy) > 2) chDrag.moved = true;
            if (chDrag.rz) {
                ch.w = Math.max(140, Math.round(chDrag.g.w + dx));
                ch.h = Math.max(100, Math.round(chDrag.g.h + dy));
            } else {
                ch.x = Math.max(0, Math.round(chDrag.g.x + dx));
                ch.y = Math.max(0, Math.round(chDrag.g.y + dy));
            }
            renderCharts();
        });
        function up() {
            if (!chDrag) return;
            var moved = chDrag.moved;
            chDrag = null;
            if (moved) Core.markDirtyUndo();
        }
        layer.addEventListener("pointerup", up);
        layer.addEventListener("pointercancel", up);
        layer.addEventListener("dblclick", function (e) {
            var el = e.target.closest ? e.target.closest(".sh-chart") : null;
            if (!el) return;
            var ch = chartById(el.getAttribute("data-chid"));
            if (ch) chartDialog(ch);
        });
        layer.addEventListener("contextmenu", function (e) {
            var el = e.target.closest ? e.target.closest(".sh-chart") : null;
            if (!el) return;
            e.preventDefault();
            e.stopPropagation();
            var ch = chartById(el.getAttribute("data-chid"));
            if (!ch) return;
            Core.selectChart(ch.id);
            OfficeApp.showContextMenu(e.clientX, e.clientY, [
                { label: "Edit chart...", icon: "chart bar", action: function () { chartDialog(ch); } },
                { label: "Copy chart", icon: "copy", key: "Ctrl+C", action: function () { Core.copySelectedChart(false, null); } },
                { label: "Cut chart", icon: "cut", key: "Ctrl+X", action: function () { Core.copySelectedChart(true, null); } },
                { label: "Delete chart", icon: "trash alternate outline", key: "Del", action: function () { deleteChart(ch.id); } }
            ]);
        });
    }

    function chartDialog(existing) {
        var rg = existing ? existing.range : Core.rangeStr(Core.selRange());
        var opts = existing ? (existing.opts || {}) : {};
        var $b = $(
            '<div class="sh-dialog-row">' +
            '<div><label>Data range</label><div style="display:flex;gap:6px;">' +
            '<input type="text" id="shChRange" style="flex:1;min-width:0;">' +
            '<button type="button" class="of-tbtn" id="shChPick" title="Select the range on the grid"' +
            ' style="flex:0 0 auto;border:1px solid var(--of-border);"><i class="crosshairs icon"></i></button>' +
            "</div></div>" +
            '<div style="flex:0 0 110px;"><label>Type</label><select id="shChType">' +
            '<option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option>' +
            "</select></div></div>" +
            '<label>Title</label><input type="text" id="shChTitle">' +
            '<div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;">' +
            '<label style="display:inline-flex;align-items:center;gap:6px;margin:0;"><input type="checkbox" id="shChHead" style="width:auto;">First row is headers</label>' +
            '<label style="display:inline-flex;align-items:center;gap:6px;margin:0;"><input type="checkbox" id="shChLab" style="width:auto;">First column is labels</label>' +
            '<label style="display:inline-flex;align-items:center;gap:6px;margin:0;"><input type="checkbox" id="shChStack" style="width:auto;">Stacked</label>' +
            "</div>"
        );
        $b.find("#shChRange").val(rg);
        // crosshair: hide the dialog, drag the range on the grid, come back
        $b.find("#shChPick").on("click", function () {
            Core.pickRangeFromGrid(function (rgStr) {
                if (rgStr) $b.find("#shChRange").val(rgStr);
            });
        });
        $b.find("#shChType").val(opts.type || "bar");
        $b.find("#shChTitle").val(opts.title || "");
        $b.find("#shChHead").prop("checked", opts.headerRow !== false);
        $b.find("#shChLab").prop("checked", opts.labelCol !== false);
        $b.find("#shChStack").prop("checked", !!opts.stacked);

        OfficeApp.dialog({
            title: existing ? "Edit chart" : "Insert chart",
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: existing ? "Update" : "Insert", primary: true,
                    action: function (close, $bd) {
                        var rangeStr = $bd.find("#shChRange").val().trim();
                        if (!Core.parseRange(rangeStr)) {
                            OfficeApp.toast("Invalid range: " + rangeStr, "error");
                            return;
                        }
                        var newOpts = {
                            type: $bd.find("#shChType").val(),
                            title: $bd.find("#shChTitle").val(),
                            headerRow: $bd.find("#shChHead").prop("checked"),
                            labelCol: $bd.find("#shChLab").prop("checked"),
                            stacked: $bd.find("#shChStack").prop("checked")
                        };
                        close();
                        if (existing) {
                            existing.range = rangeStr;
                            existing.opts = newOpts;
                        } else {
                            var grid = Core.gridEl();
                            var s = Core.sheet();
                            if (!s.charts) s.charts = [];
                            var ch = {
                                id: genId(),
                                x: grid.scrollLeft + 60, y: grid.scrollTop + 40,
                                w: 460, h: 300,
                                range: rangeStr, opts: newOpts
                            };
                            s.charts.push(ch);
                            Core.selectChart(ch.id);
                        }
                        Core.commit();
                    }
                }
            ]
        });
    }

    /* ================= filter ================= */
    function toggleFilter() {
        var s = Core.sheet();
        if (s.filter) {
            s.filter = null;
        } else {
            var rg = Core.selRange();
            if (rg.c1 === rg.c2 && rg.r1 === rg.r2) rg = Core.usedRange();
            s.filter = { range: Core.rangeStr(rg), excl: {} };
        }
        Core.commit();
        Core.renderAll();
    }
    function filterDialog(col) {
        var s = Core.sheet();
        if (!s.filter) return;
        var rg = Core.parseRange(s.filter.range);
        if (!rg) return;
        var excl = (s.filter.excl && s.filter.excl[String(col)]) || {};
        // unique display values below the header row
        var uniq = {}, order = [];
        for (var r = rg.r1 + 1; r <= rg.r2; r++) {
            var t = Core.displayText(col, r);
            if (!(t in uniq)) { uniq[t] = true; order.push(t); }
        }
        order.sort(function (a, b) {
            var na = parseFloat(a), nb = parseFloat(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a < b ? -1 : (a > b ? 1 : 0);
        });
        var $b = $('<div><div style="display:flex;gap:8px;">' +
            '<button type="button" class="of-btn" id="shFilAll">Select all</button>' +
            '<button type="button" class="of-btn" id="shFilNone">Clear</button>' +
            '</div><div class="sh-filter-list"></div></div>');
        var $list = $b.find(".sh-filter-list");
        order.forEach(function (t) {
            var $l = $('<label></label>');
            var $cb = $('<input type="checkbox">').prop("checked", !excl[t]).attr("data-val", t);
            $l.append($cb).append($("<span></span>").text(t === "" ? "(empty)" : t));
            $list.append($l);
        });
        $b.find("#shFilAll").on("click", function () { $list.find("input").prop("checked", true); });
        $b.find("#shFilNone").on("click", function () { $list.find("input").prop("checked", false); });

        OfficeApp.dialog({
            title: "Filter column " + F.colToName(col),
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: "Apply", primary: true,
                    action: function (close, $bd) {
                        var ex = {};
                        $bd.find(".sh-filter-list input").each(function () {
                            if (!$(this).prop("checked")) ex[$(this).attr("data-val")] = 1;
                        });
                        if (!s.filter.excl) s.filter.excl = {};
                        if (Object.keys(ex).length) s.filter.excl[String(col)] = ex;
                        else delete s.filter.excl[String(col)];
                        close();
                        Core.commit();
                        Core.renderAll();
                    }
                }
            ]
        });
    }

    /* ================= CSV / TSV ================= */
    /* State-machine parser: quoted fields, embedded delimiters/newlines,
       doubled quotes, CRLF and a UTF-8 BOM. */
    function parseDelimited(text, delim) {
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        var rows = [], row = [], field = "", inQ = false;
        var i = 0, n = text.length;
        while (i < n) {
            var ch = text.charAt(i);
            if (inQ) {
                if (ch === '"') {
                    if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
                    inQ = false; i++; continue;
                }
                field += ch; i++; continue;
            }
            if (ch === '"' && field === "") { inQ = true; i++; continue; }
            if (ch === delim) { row.push(field); field = ""; i++; continue; }
            if (ch === "\r") { i++; continue; }
            if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
            field += ch; i++;
        }
        if (field !== "" || row.length) { row.push(field); rows.push(row); }
        return rows;
    }
    function importDelimited(text, filename, delim) {
        var rows = parseDelimited(text, delim);
        var s = Core.newSheetData(OfficeApp.stripExt(filename || "Imported").substring(0, 30) || "Sheet1");
        var maxC = 0;
        rows.forEach(function (row, r) {
            row.forEach(function (val, c) {
                if (val === "") return;
                // preserve leading zeros / big IDs as text; keep everything raw
                s.cells[F.cellName(c, r)] = { v: val };
                if (c > maxC) maxC = c;
            });
        });
        s.cols = clamp(maxC + 5, 26, 512);
        s.rows = clamp(rows.length + 20, 200, 10000);
        Core.setBody({ sheets: [s], active: 0 });
        OfficeApp.markDirty();
        OfficeApp.setStatus("Imported " + rows.length + " rows from " + filename);
    }
    function csvField(t, delim) {
        if (t.indexOf('"') >= 0) return '"' + t.replace(/"/g, '""') + '"';
        if (t.indexOf(delim) >= 0 || t.indexOf("\n") >= 0 || t.indexOf("\r") >= 0) return '"' + t + '"';
        return t;
    }
    function exportDelimited(delim) {
        var ur = Core.usedRange();
        var lines = [];
        for (var r = ur.r1; r <= ur.r2; r++) {
            var row = [];
            for (var c = ur.c1; c <= ur.c2; c++) {
                var v = Core.valueAt(c, r);
                var t;
                if (v === null || v === undefined) t = "";
                else if (F.isErr(v)) t = v.code;
                else if (typeof v === "number") t = F.numToText(v);   // no thousands separators
                else t = String(v);
                row.push(csvField(t, delim));
            }
            lines.push(row.join(delim));
        }
        var ext = delim === "\t" ? ".tsv" : ".csv";
        var name = OfficeApp.stripExt(OfficeApp.getFileName() || "spreadsheet") + ext;
        var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
        OfficeApp.setStatus("Exported " + name);
    }

    /* ================= XLSX (server-side via the office AGI lib) ================= */
    function importXlsx(fp, fn) {
        OfficeApp.showBusy("Importing " + fn + "...");
        ao_module_agirun(XLSX_BACKEND, { action: "import", src: fp }, function (data) {
            OfficeApp.hideBusy();
            if (!data || data.error) {
                OfficeApp.toast("Import failed: " + ((data && data.error) || "no response"), "error");
                return;
            }
            var b = data.body;
            if (typeof b === "string") {
                try { b = JSON.parse(b); } catch (e) { b = null; }
            }
            if (!b || !b.sheets) {
                OfficeApp.toast("Import failed: unexpected response", "error");
                return;
            }
            Core.setBody(b);
            OfficeApp.markDirty();
            OfficeApp.setStatus("Imported " + fn + " - use Save to store it as .xlsa");
        }, function () {
            OfficeApp.hideBusy();
            OfficeApp.toast("Import failed: cannot reach the ArozOS backend", "error");
        }, 120000);
    }
    function importXlsxDialog() {
        try {
            ao_module_openFileSelector(function (files) {
                if (files && files.length > 0) importXlsx(files[0].filepath, files[0].filename);
            }, "user:/Desktop", "file", false, { filter: ["xlsx"] });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }
    function exportXlsx() {
        var defName = OfficeApp.stripExt(OfficeApp.getFileName() || "New Spreadsheet.xlsa") + ".xlsx";
        try {
            ao_module_openFileSelector(function (files) {
                if (!files || !files.length) return;
                var fp = files[0].filepath;
                if (!/\.xlsx$/i.test(fp)) fp += ".xlsx";
                OfficeApp.showBusy("Exporting Excel file...");
                ao_module_agirun(XLSX_BACKEND, {
                    action: "export",
                    dest: fp,
                    data: JSON.stringify(Core.getBody())
                }, function (data) {
                    OfficeApp.hideBusy();
                    if (data && data.error) {
                        OfficeApp.toast("Export failed: " + data.error, "error");
                    } else {
                        OfficeApp.setStatus("Exported " + OfficeApp.basename(fp));
                        OfficeApp.toast("Exported " + OfficeApp.basename(fp));
                    }
                }, function () {
                    OfficeApp.hideBusy();
                    OfficeApp.toast("Export failed: cannot reach the ArozOS backend", "error");
                }, 180000);
            }, "user:/Desktop", "new", false, { defaultName: defName });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }

    /* ================= print ================= */
    /* ================= pivot tables ================= */
    /* A pivot lives on its own generated sheet. The config is stored on
       that sheet as `pivot: {srcSheet, range, rowField, colField, valField,
       agg}` (field values are 0-based column offsets inside the range,
       colField -1 = none), so "Refresh pivot table" can recompute after
       the source data changes. Output cells are plain values - a static
       snapshot, like "paste values" of a pivot. */
    var PIVOT_AGGS = [
        ["sum", "Sum"], ["count", "Count"], ["avg", "Average"],
        ["min", "Min"], ["max", "Max"]
    ];
    function pivotHeaders(vals) {
        if (!vals || !vals.length) return [];
        return vals[0].map(function (h, i) {
            var t = (h === null || h === undefined) ? "" : String(h);
            return t === "" ? "Column " + (i + 1) : t;
        });
    }
    function aggResult(b, agg) {
        if (!b) return "";
        switch (agg) {
            case "count": return b.n;
            case "avg": return b.cnt ? b.sum / b.cnt : "";
            case "min": return b.min === null ? "" : b.min;
            case "max": return b.max === null ? "" : b.max;
            default: return b.sum;
        }
    }
    // -> { headers: [col labels], rows: [[rowLabel, v1, v2, ..., total]] , colLabels }
    function computePivot(cfg) {
        var vals = Core.readRangeValues(cfg.srcSheet, cfg.range);
        if (!vals || vals.length < 2) return null;
        var headers = pivotHeaders(vals);
        var dataRows = vals.slice(1);
        var hasCols = cfg.colField >= 0;
        var rKeys = [], cKeys = [], buckets = {};
        var K = function (rk, ck) { return rk + "\u0000" + ck; };
        dataRows.forEach(function (row) {
            var rv = row[cfg.rowField];
            var rk = (rv === null || rv === undefined) ? "" : String(rv);
            var cv = hasCols ? row[cfg.colField] : "__all__";
            var ck = (cv === null || cv === undefined) ? "" : String(cv);
            if (rKeys.indexOf(rk) < 0) rKeys.push(rk);
            if (hasCols && cKeys.indexOf(ck) < 0) cKeys.push(ck);
            // one bucket per cell plus per-row/-column/grand totals
            [K(rk, ck), K(rk, "__total__"), K("__total__", ck), K("__total__", "__total__")]
                .forEach(function (bk) {
                    var b = buckets[bk] ||
                        (buckets[bk] = { sum: 0, cnt: 0, n: 0, min: null, max: null });
                    b.n++;
                    var v = row[cfg.valField];
                    var num = typeof v === "number" ? v : parseFloat(v);
                    if (!isNaN(num) && isFinite(num)) {
                        b.sum += num;
                        b.cnt++;
                        b.min = b.min === null ? num : Math.min(b.min, num);
                        b.max = b.max === null ? num : Math.max(b.max, num);
                    }
                });
        });
        rKeys.sort();
        cKeys.sort();
        var aggLabel = "";
        PIVOT_AGGS.forEach(function (a) { if (a[0] === cfg.agg) aggLabel = a[1]; });
        var colLabels = hasCols ? cKeys.concat(["Grand Total"]) :
            [aggLabel + " of " + headers[cfg.valField]];
        var out = [];
        rKeys.concat(["Grand Total"]).forEach(function (rk) {
            var bk = rk === "Grand Total" ? "__total__" : rk;
            var row = [rk];
            if (hasCols) {
                cKeys.forEach(function (ck) { row.push(aggResult(buckets[K(bk, ck)], cfg.agg)); });
                row.push(aggResult(buckets[K(bk, "__total__")], cfg.agg));
            } else {
                row.push(aggResult(buckets[K(bk, "__all__")], cfg.agg));
            }
            out.push(row);
        });
        return { cornerLabel: headers[cfg.rowField], colLabels: colLabels, rows: out };
    }
    // write the computed pivot into a sheet's cell map (replacing it)
    function writePivotCells(s, pv) {
        s.cells = {};
        var bold = { b: true };
        var put = function (c, r, v, styled) {
            if (v === "" || v === null || v === undefined) return;
            var cell = { v: String(v) };
            if (styled) cell.s = $.extend({}, bold);
            s.cells[F.cellName(c, r)] = cell;
        };
        put(0, 0, pv.cornerLabel, true);
        pv.colLabels.forEach(function (cl, i) { put(i + 1, 0, cl, true); });
        pv.rows.forEach(function (row, r) {
            row.forEach(function (v, c) {
                put(c, r + 1, v, c === 0 || r === pv.rows.length - 1);
            });
        });
        s.cols = Math.max(26, pv.colLabels.length + 4);
        s.rows = Math.max(200, pv.rows.length + 20);
    }
    function pivotDialog() {
        var rg = Core.selRange();
        if (rg.c1 === rg.c2 && rg.r1 === rg.r2) rg = Core.usedRange();
        var srcSheet = Core.activeSheetIndex();
        var $b = $(
            '<label>Source data range (first row = headers)</label>' +
            '<div style="display:flex;gap:6px;">' +
            '<input type="text" id="shPvRange" style="flex:1;min-width:0;">' +
            '<button type="button" class="of-tbtn" id="shPvPick" title="Select the range on the grid"' +
            ' style="flex:0 0 auto;border:1px solid var(--of-border);"><i class="crosshairs icon"></i></button>' +
            "</div>" +
            '<div class="sh-dialog-row" style="margin-top:8px;">' +
            '<div><label>Rows</label><select id="shPvRow"></select></div>' +
            '<div><label>Columns</label><select id="shPvCol"></select></div>' +
            "</div>" +
            '<div class="sh-dialog-row">' +
            '<div><label>Values</label><select id="shPvVal"></select></div>' +
            '<div><label>Aggregate by</label><select id="shPvAgg"></select></div>' +
            "</div>"
        );
        PIVOT_AGGS.forEach(function (a) {
            $b.find("#shPvAgg").append($("<option></option>").attr("value", a[0]).text(a[1]));
        });
        function fillFields() {
            var vals = Core.readRangeValues(srcSheet, $b.find("#shPvRange").val().trim());
            var headers = pivotHeaders(vals);
            var $row = $b.find("#shPvRow").empty();
            var $col = $b.find("#shPvCol").empty().append('<option value="-1">(none)</option>');
            var $val = $b.find("#shPvVal").empty();
            headers.forEach(function (h, i) {
                var $o = $("<option></option>").attr("value", i).text(h);
                $row.append($o);
                $col.append($o.clone());
                $val.append($o.clone());
            });
            if (headers.length > 1) $val.val(String(headers.length - 1));
        }
        $b.find("#shPvRange").val(Core.rangeStr(rg)).on("change", fillFields);
        $b.find("#shPvPick").on("click", function () {
            Core.pickRangeFromGrid(function (rgStr) {
                if (rgStr) {
                    $b.find("#shPvRange").val(rgStr);
                    fillFields();
                }
            });
        });
        fillFields();
        OfficeApp.dialog({
            title: "Create pivot table",
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: "Create", primary: true,
                    action: function (close, $bd) {
                        var cfg = {
                            srcSheet: srcSheet,
                            range: $bd.find("#shPvRange").val().trim(),
                            rowField: parseInt($bd.find("#shPvRow").val(), 10) || 0,
                            colField: parseInt($bd.find("#shPvCol").val(), 10),
                            valField: parseInt($bd.find("#shPvVal").val(), 10) || 0,
                            agg: $bd.find("#shPvAgg").val()
                        };
                        if (isNaN(cfg.colField)) cfg.colField = -1;
                        if (!Core.parseRange(cfg.range)) {
                            OfficeApp.toast("Invalid range: " + cfg.range, "error");
                            return;
                        }
                        var pv = computePivot(cfg);
                        if (!pv) {
                            OfficeApp.toast("The source range needs a header row plus data rows", "error");
                            return;
                        }
                        close();
                        var data = Core.newSheetData("Pivot");
                        data.pivot = cfg;
                        writePivotCells(data, pv);
                        Core.addSheetNamed("Pivot", data);
                        OfficeApp.setStatus("Pivot table created - Data > Refresh pivot table recomputes it");
                    }
                }
            ]
        });
    }
    function refreshPivot() {
        var s = Core.sheet();
        var cfg = s.pivot;
        if (!cfg) {
            OfficeApp.toast("The active sheet is not a pivot table", "error");
            return;
        }
        if (cfg.srcSheet >= 0 && Core.getBody().sheets[cfg.srcSheet]) {
            var pv = computePivot(cfg);
            if (!pv) {
                OfficeApp.toast("Pivot source range no longer has data", "error");
                return;
            }
            writePivotCells(s, pv);
            Core.rebuildCalc();
            Core.commit();
            Core.renderAll();
            OfficeApp.setStatus("Pivot table refreshed");
        } else {
            OfficeApp.toast("Pivot source sheet no longer exists", "error");
        }
    }

    function fillPrintArea() {
        var $pa = $("#shPrintArea").empty();
        var ur = Core.usedRange();
        var out = ['<table>'];
        for (var r = ur.r1; r <= ur.r2; r++) {
            out.push("<tr>");
            for (var c = ur.c1; c <= ur.c2; c++) {
                out.push("<td>" + esc(Core.displayText(c, r)) + "</td>");
            }
            out.push("</tr>");
        }
        out.push("</table>");
        $pa.html(out.join(""));
    }

    $(document).ready(initChartEvents);

    return {
        renderCharts: renderCharts,
        chartDialog: chartDialog,
        deleteChart: deleteChart,
        toggleFilter: toggleFilter,
        filterDialog: filterDialog,
        parseDelimited: parseDelimited,
        importDelimited: importDelimited,
        exportDelimited: exportDelimited,
        importXlsx: importXlsx,
        importXlsxDialog: importXlsxDialog,
        exportXlsx: exportXlsx,
        pivotDialog: pivotDialog,
        refreshPivot: refreshPivot,
        chartToImageHtml: chartToImageHtml,
        fillPrintArea: fillPrintArea
    };
})();
