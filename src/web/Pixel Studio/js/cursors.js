/*
    Pixel Studio - canvas cursors

    Black cursors with a white outline, drawn as SVG so they read on light
    and dark artwork alike:

        PS.cursors.move             arrow pointer with a small move cross (the
                                    hot spot is the arrow tip, so the user
                                    sees exactly which pixel they point at)
        PS.cursors.moveCopy         the same with a "+" (Alt-drag duplicates)
        PS.cursors.rotate(angle)    curved double arrow bending around a
                                    corner; angle (radians, screen space) is
                                    the direction from the box centre to the
                                    pointer
        PS.cursors.resize(angle)    straight double arrow along angle

    Angles are quantised to 15 degrees and every variant is built once.
*/
"use strict";

PS.cursors = (function () {
    var cache = {};

    function url(svg, hx, hy, fallback) {
        return "url(\"data:image/svg+xml;utf8," + encodeURIComponent(svg) + "\") " + hx + " " + hy + ", " + (fallback || "default");
    }

    // a path drawn twice: a wide white halo, then the black glyph
    function haloed(d, extra) {
        return '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + "/>" +
            '<path d="' + d + '" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + "/>";
    }

    var ARROW = "M3.5 2.5v18.2l4.6-4.4 3.1 7 3-1.3-3.1-6.9h6.4z";

    function arrowPointer(badge) {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
            '<path d="' + ARROW + '" fill="#000" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>' + badge + "</svg>";
    }

    // four-way cross with arrow heads, centred on (cx, cy)
    function moveCross(cx, cy, r) {
        var h = 2.4;
        var d = "M" + cx + " " + (cy - r) + "V" + (cy + r) + "M" + (cx - r) + " " + cy + "H" + (cx + r) +
            "M" + (cx - h) + " " + (cy - r + h) + "L" + cx + " " + (cy - r) + "L" + (cx + h) + " " + (cy - r + h) +
            "M" + (cx - h) + " " + (cy + r - h) + "L" + cx + " " + (cy + r) + "L" + (cx + h) + " " + (cy + r - h) +
            "M" + (cx - r + h) + " " + (cy - h) + "L" + (cx - r) + " " + cy + "L" + (cx - r + h) + " " + (cy + h) +
            "M" + (cx + r - h) + " " + (cy - h) + "L" + (cx + r) + " " + cy + "L" + (cx + r - h) + " " + (cy + h);
        return haloed(d);
    }

    function plus(cx, cy, r) {
        return haloed("M" + (cx - r) + " " + cy + "H" + (cx + r) + "M" + cx + " " + (cy - r) + "V" + (cy + r));
    }

    var move = url(arrowPointer(moveCross(23, 23, 6)), 4, 3, "move");
    var moveCopy = url(arrowPointer(moveCross(23, 23, 6) + plus(9, 28, 2.6)), 4, 3, "copy");

    function q(angle) {
        var deg = Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360 / 15) * 15;
        return deg % 360;
    }

    // curved double arrow; at 0 degrees it bulges to the right (+x)
    function rotate(angle) {
        var deg = q(angle);
        var key = "r" + deg;
        if (cache[key]) { return cache[key]; }
        // arc on a circle centred at (5, 16), radius 12, from -48 to +48 degrees
        var a0 = -48 * Math.PI / 180, a1 = 48 * Math.PI / 180, R = 12, cx = 5, cy = 16;
        var p0 = { x: cx + R * Math.cos(a0), y: cy + R * Math.sin(a0) };
        var p1 = { x: cx + R * Math.cos(a1), y: cy + R * Math.sin(a1) };
        function head(p, a, dir) {
            // tangent of the arc at angle a, pointing away from the arc
            var tx = -Math.sin(a) * dir, ty = Math.cos(a) * dir;
            var nx = Math.cos(a), ny = Math.sin(a);
            var L = 4.6, W = 3.4;
            var bx = p.x - tx * L, by = p.y - ty * L;
            return "M" + (bx + nx * W).toFixed(2) + " " + (by + ny * W).toFixed(2) + "L" + p.x.toFixed(2) + " " + p.y.toFixed(2) +
                "L" + (bx - nx * W).toFixed(2) + " " + (by - ny * W).toFixed(2);
        }
        var d = "M" + p0.x.toFixed(2) + " " + p0.y.toFixed(2) + "A" + R + " " + R + " 0 0 1 " + p1.x.toFixed(2) + " " + p1.y.toFixed(2) +
            head(p0, a0, -1) + head(p1, a1, 1);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
            '<g transform="rotate(' + deg + " 16 16)\">" + haloed(d) + "</g></svg>";
        cache[key] = url(svg, 16, 16, "crosshair");
        return cache[key];
    }

    // straight double arrow
    function resize(angle) {
        var deg = q(angle) % 180;
        var key = "s" + deg;
        if (cache[key]) { return cache[key]; }
        var d = "M5 16H27M5 16l4.5-4.2M5 16l4.5 4.2M27 16l-4.5-4.2M27 16l-4.5 4.2";
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
            '<g transform="rotate(' + deg + " 16 16)\">" + haloed(d) + "</g></svg>";
        var native = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(deg / 45) % 4];
        cache[key] = url(svg, 16, 16, native);
        return cache[key];
    }

    return { move: move, moveCopy: moveCopy, rotate: rotate, resize: resize };
})();
