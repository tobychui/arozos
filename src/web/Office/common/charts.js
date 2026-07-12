/*
    ArozOS Office Suite - shared SVG chart renderer
    Used by Sheets (chart insertion) and Slides (chart objects).
    No external dependencies; renders plain SVG that inherits text color
    from the container (fill="currentColor"), so it is theme-aware.

    Usage:
        var svgString = OfficeCharts.renderToString(spec, width, height);
        OfficeCharts.render(containerElement, spec);   // sizes to container

    Chart spec:
        {
            type: "bar" | "line" | "pie",
            title: "Monthly sales",              // optional
            labels: ["Jan", "Feb", "Mar"],       // category labels
            series: [                            // one or more series
                { name: "2025", values: [10, 20, 15], color: "#4c9be8" }
            ],
            options: {
                legend: true,        // default true when >1 series (bar/line), always for pie
                gridlines: true,     // default true (bar/line)
                stacked: false       // bar only
            }
        }
*/

var OfficeCharts = (function () {
    var PALETTE = [
        "#4c9be8", "#e8734c", "#4cc06a", "#b06ae8",
        "#e8b84c", "#4cc9c0", "#e84c8b", "#8a99a8"
    ];

    function esc(t) {
        return String(t === undefined || t === null ? "" : t)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function colorOf(series, i) {
        return series.color || PALETTE[i % PALETTE.length];
    }
    function niceCeil(v) {
        if (v <= 0) return 1;
        var mag = Math.pow(10, Math.floor(Math.log10(v)));
        var n = v / mag;
        var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
        return nice * mag;
    }
    function fmtNum(v) {
        if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
        if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
        if (Math.abs(v) < 1 && v !== 0) return String(Math.round(v * 100) / 100);
        return String(Math.round(v * 10) / 10);
    }

    function renderToString(spec, W, H) {
        W = W || 640; H = H || 400;
        spec = spec || {};
        var type = spec.type || "bar";
        var labels = spec.labels || [];
        var series = (spec.series || []).filter(function (s) { return s && s.values; });
        var opts = spec.options || {};
        if (series.length === 0) series = [{ name: "", values: [] }];

        var out = [];
        out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
            '" width="100%" height="100%" style="font-family:Segoe UI,Arial,sans-serif;">');

        var top = 14;
        if (spec.title) {
            out.push('<text x="' + (W / 2) + '" y="24" text-anchor="middle" font-size="17" font-weight="600" fill="currentColor">' + esc(spec.title) + "</text>");
            top = 40;
        }

        var showLegend = opts.legend !== false && (type === "pie" || series.length > 1);
        var legendH = showLegend ? 26 : 0;

        if (type === "pie") {
            out.push(renderPie(spec, labels, series, W, H, top, legendH));
        } else {
            out.push(renderXY(type, labels, series, opts, W, H, top, legendH));
        }

        if (showLegend) {
            var names = (type === "pie")
                ? labels.map(function (l, i) { return { n: l, c: PALETTE[i % PALETTE.length] }; })
                : series.map(function (s, i) { return { n: s.name || ("Series " + (i + 1)), c: colorOf(s, i) }; });
            var perW = Math.min(140, (W - 20) / Math.max(1, names.length));
            var totalW = perW * names.length;
            var lx = (W - totalW) / 2;
            var ly = H - 12;
            names.forEach(function (e, i) {
                var x = lx + i * perW;
                out.push('<rect x="' + x + '" y="' + (ly - 9) + '" width="10" height="10" rx="2" fill="' + esc(e.c) + '"/>');
                out.push('<text x="' + (x + 15) + '" y="' + ly + '" font-size="12" fill="currentColor" opacity="0.8">' + esc(String(e.n).substring(0, 18)) + "</text>");
            });
        }

        out.push("</svg>");
        return out.join("");
    }

    function renderXY(type, labels, series, opts, W, H, top, legendH) {
        var out = [];
        var padL = 46, padR = 16, padB = 30 + legendH;
        var plotW = W - padL - padR;
        var plotH = H - top - padB;
        var n = Math.max(labels.length, series.reduce(function (m, s) { return Math.max(m, s.values.length); }, 0));
        if (n === 0) n = 1;

        var stacked = !!opts.stacked && type === "bar";
        var maxV = 0, minV = 0;
        for (var i = 0; i < n; i++) {
            var stackSum = 0;
            series.forEach(function (s) {
                var v = Number(s.values[i]) || 0;
                if (stacked) { stackSum += Math.max(0, v); }
                else { if (v > maxV) maxV = v; if (v < minV) minV = v; }
            });
            if (stacked && stackSum > maxV) maxV = stackSum;
        }
        if (maxV <= 0 && minV >= 0) maxV = 1;
        maxV = niceCeil(maxV);
        minV = minV < 0 ? -niceCeil(-minV) : 0;
        var range = maxV - minV;

        function yOf(v) { return top + plotH - ((v - minV) / range) * plotH; }

        // gridlines + y labels
        var ticks = 5;
        for (var t = 0; t <= ticks; t++) {
            var val = minV + (range * t) / ticks;
            var y = yOf(val);
            if (opts.gridlines !== false) {
                out.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
                    '" stroke="currentColor" stroke-opacity="0.15" stroke-width="1"/>');
            }
            out.push('<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="currentColor" opacity="0.7">' + esc(fmtNum(val)) + "</text>");
        }

        var slotW = plotW / n;

        // x labels (skip some if crowded)
        var skip = Math.ceil(n / Math.floor(plotW / 60));
        for (var li = 0; li < n; li++) {
            if (li % skip !== 0) continue;
            var lx = padL + slotW * li + slotW / 2;
            out.push('<text x="' + lx + '" y="' + (top + plotH + 16) + '" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">' +
                esc(String(labels[li] === undefined ? li + 1 : labels[li]).substring(0, 12)) + "</text>");
        }

        if (type === "bar") {
            var groupPad = slotW * 0.18;
            var innerW = slotW - groupPad * 2;
            var barW = stacked ? innerW : innerW / series.length;
            for (var ci = 0; ci < n; ci++) {
                var acc = 0;
                series.forEach(function (s, si) {
                    var v = Number(s.values[ci]) || 0;
                    var x = padL + slotW * ci + groupPad + (stacked ? 0 : barW * si);
                    var yTop, yBottom;
                    if (stacked) {
                        v = Math.max(0, v);
                        yTop = yOf(acc + v);
                        yBottom = yOf(acc);
                        acc += v;
                    } else {
                        yTop = yOf(Math.max(0, v));
                        yBottom = yOf(Math.min(0, v));
                    }
                    var bh = yBottom - yTop;
                    if (bh < 1 && v !== 0) bh = 1;
                    if (bh <= 0) return;
                    out.push('<rect x="' + x + '" y="' + yTop + '" width="' + Math.max(1, barW - 2) +
                        '" height="' + bh + '" rx="1.5" fill="' + esc(colorOf(s, si)) + '"/>');
                });
            }
        } else { // line
            series.forEach(function (s, si) {
                var pts = [];
                for (var pi = 0; pi < n; pi++) {
                    var v = Number(s.values[pi]) || 0;
                    var x = padL + slotW * pi + slotW / 2;
                    pts.push(x + "," + yOf(v));
                }
                out.push('<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + esc(colorOf(s, si)) +
                    '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
                for (var di = 0; di < n; di++) {
                    var dv = Number(s.values[di]) || 0;
                    out.push('<circle cx="' + (padL + slotW * di + slotW / 2) + '" cy="' + yOf(dv) +
                        '" r="3" fill="' + esc(colorOf(s, si)) + '"/>');
                }
            });
        }

        // axis line
        out.push('<line x1="' + padL + '" y1="' + yOf(Math.max(0, minV)) + '" x2="' + (W - padR) + '" y2="' + yOf(Math.max(0, minV)) +
            '" stroke="currentColor" stroke-opacity="0.4" stroke-width="1"/>');
        return out.join("");
    }

    function renderPie(spec, labels, series, W, H, top, legendH) {
        var out = [];
        var values = (series[0] && series[0].values) || [];
        var total = 0;
        values.forEach(function (v) { total += Math.max(0, Number(v) || 0); });
        var cx = W / 2, cy = top + (H - top - legendH - 16) / 2;
        var r = Math.min(W / 2 - 30, (H - top - legendH - 24) / 2);
        if (r < 10) r = 10;
        if (total <= 0) {
            out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="currentColor" stroke-opacity="0.3"/>');
            out.push('<text x="' + cx + '" y="' + cy + '" text-anchor="middle" font-size="13" fill="currentColor" opacity="0.6">No data</text>');
            return out.join("");
        }
        var a0 = -Math.PI / 2;
        values.forEach(function (v, i) {
            v = Math.max(0, Number(v) || 0);
            if (v === 0) return;
            var frac = v / total;
            var a1 = a0 + frac * Math.PI * 2;
            var large = frac > 0.5 ? 1 : 0;
            var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
            var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
            var color = PALETTE[i % PALETTE.length];
            if (frac >= 0.99999) {
                out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + esc(color) + '"/>');
            } else {
                out.push('<path d="M' + cx + " " + cy + " L" + x0 + " " + y0 + " A" + r + " " + r +
                    " 0 " + large + " 1 " + x1 + " " + y1 + ' Z" fill="' + esc(color) + '" stroke="#fff" stroke-width="1" stroke-opacity="0.6"/>');
            }
            // percentage label
            if (frac > 0.04) {
                var am = (a0 + a1) / 2;
                var lx = cx + r * 0.62 * Math.cos(am);
                var ly = cy + r * 0.62 * Math.sin(am);
                out.push('<text x="' + lx + '" y="' + (ly + 4) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">' +
                    Math.round(frac * 100) + "%</text>");
            }
            a0 = a1;
        });
        return out.join("");
    }

    function render(container, spec) {
        var w = container.clientWidth || 640;
        var h = container.clientHeight || 400;
        container.innerHTML = renderToString(spec, w, h);
    }

    return {
        render: render,
        renderToString: renderToString,
        palette: PALETTE.slice()
    };
})();
