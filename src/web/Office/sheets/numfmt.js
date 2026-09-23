/*
    ArozOS Office Sheets - number format codes
    ==========================================
    DOM-free formatter for spreadsheet format codes, used by TEXT() and
    usable by the grid. Browser global SheetNumFmt, Node module.exports.

        SheetNumFmt.format(value, code) -> string

    Supported: sections (positive;negative;zero;text) and [>100]-style
    conditions, General, 0 # ? placeholders, thousands separators and
    trailing-comma scaling, %, E+/E- scientific, "literal" \x _x *x, @,
    fractions (# ?/?, ?/8), [Red]-style colours and [$-409] locales
    (ignored), [$sym-409] currency symbols, and dates/times: yyyy yy mmmm
    mmm mm m dddd ddd dd d hh h mm (minutes after h / before s) ss .00 AM/PM
    A/P [h] [m] [s].
*/
var SheetNumFmt = (function () {
    "use strict";

    var EPOCH = Date.UTC(1899, 11, 30), DAY_MS = 86400000;
    var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December"];
    var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // split on ; outside quotes, brackets and escapes
    function sections(code) {
        var out = [], cur = "", q = false, br = false;
        for (var i = 0; i < code.length; i++) {
            var ch = code.charAt(i);
            if (ch === "\\" && !q && i + 1 < code.length) { cur += ch + code.charAt(++i); continue; }
            if (ch === '"') q = !q;
            else if (!q && ch === "[") br = true;
            else if (!q && ch === "]") br = false;
            if (ch === ";" && !q && !br) { out.push(cur); cur = ""; continue; }
            cur += ch;
        }
        out.push(cur);
        return out;
    }

    /* tokens: {t:"lit", s} | {t:"ph", c:"0|#|?"} | {t:"dot"} | {t:"comma"} |
       {t:"pct"} | {t:"exp", sign} | {t:"slash"} | {t:"at"} | {t:"date", s} |
       {t:"ampm", s} | {t:"elapsed", s} */
    function tokenize(sec) {
        var toks = [], i = 0, cond = null, m;
        while (i < sec.length) {
            var ch = sec.charAt(i);
            if (ch === '"') {
                var j = sec.indexOf('"', i + 1);
                if (j < 0) j = sec.length;
                toks.push({ t: "lit", s: sec.slice(i + 1, j) });
                i = j + 1;
                continue;
            }
            if (ch === "\\") { toks.push({ t: "lit", s: sec.charAt(i + 1) }); i += 2; continue; }
            if (ch === "_") { toks.push({ t: "lit", s: " " }); i += 2; continue; }
            if (ch === "*") { i += 2; continue; }
            if (ch === "[") {
                var end = sec.indexOf("]", i);
                if (end < 0) end = sec.length;
                var inner = sec.slice(i + 1, end);
                if ((m = /^(<=|>=|<>|<|>|=)(-?\d+(\.\d+)?)$/.exec(inner))) cond = { op: m[1], v: parseFloat(m[2]) };
                else if (/^(h+|m+|s+)$/i.test(inner)) toks.push({ t: "elapsed", s: inner.toLowerCase() });
                else if ((m = /^\$([^-]*)/.exec(inner)) && m[1]) toks.push({ t: "lit", s: m[1] });
                i = end + 1;
                continue;
            }
            var rest = sec.slice(i);
            if ((m = /^(AM\/PM|A\/P)/i.exec(rest))) { toks.push({ t: "ampm", s: m[1] }); i += m[1].length; continue; }
            if ((m = /^(y+|m+|d+|h+|s+)/i.exec(rest))) { toks.push({ t: "date", s: m[1].toLowerCase() }); i += m[1].length; continue; }
            if ((m = /^[eE]([+-])/.exec(rest))) { toks.push({ t: "exp", sign: m[1] }); i += 2; continue; }
            if (/^general/i.test(rest)) { toks.push({ t: "general" }); i += 7; continue; }
            if (ch === "0" || ch === "#" || ch === "?") { toks.push({ t: "ph", c: ch }); i++; continue; }
            if (ch === ".") { toks.push({ t: "dot" }); i++; continue; }
            if (ch === ",") { toks.push({ t: "comma" }); i++; continue; }
            if (ch === "%") { toks.push({ t: "pct" }); i++; continue; }
            if (ch === "/") { toks.push({ t: "slash" }); i++; continue; }
            if (ch === "@") { toks.push({ t: "at" }); i++; continue; }
            toks.push({ t: "lit", s: ch });
            i++;
        }
        toks.cond = cond;
        return toks;
    }

    function general(v) {
        if (!isFinite(v)) return "#NUM!";
        var a = Math.abs(v);
        if (a !== 0 && (a >= 1e11 || a < 1e-9)) return v.toExponential(5).replace(/\.?0+e/, "E").replace("e", "E").replace(/E(\d)/, "E+$1");
        var s = String(+v.toPrecision(11));
        return s;
    }

    function isDateFormat(toks) {
        return toks.some(function (t) { return t.t === "date" || t.t === "ampm" || t.t === "elapsed"; });
    }

    function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

    function formatDate(v, toks) {
        var ampm = toks.some(function (t) { return t.t === "ampm"; });
        // fractional-second precision = zeros after a "." that follows s
        var fracDigits = 0;
        for (var i = 0; i < toks.length; i++) {
            if (toks[i].t === "date" && toks[i].s.charAt(0) === "s" && toks[i + 1] && toks[i + 1].t === "dot") {
                for (var k = i + 2; k < toks.length && toks[k].t === "ph" && toks[k].c === "0"; k++) fracDigits++;
            }
        }
        var totalMs = Math.round(v * DAY_MS / Math.pow(10, 3 - Math.min(3, fracDigits))) * Math.pow(10, 3 - Math.min(3, fracDigits));
        var d = new Date(EPOCH + totalMs);
        var hours = d.getUTCHours(), mins = d.getUTCMinutes(), secs = d.getUTCSeconds(), ms = d.getUTCMilliseconds();
        var out = "";
        for (i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (t.t === "date") {
                var s = t.s, c = s.charAt(0);
                if (c === "m") {
                    // minutes when next to hours / seconds
                    var prev = null, next = null, p;
                    for (p = i - 1; p >= 0; p--) if (toks[p].t === "date" || toks[p].t === "elapsed") { prev = toks[p]; break; }
                    for (p = i + 1; p < toks.length; p++) if (toks[p].t === "date" || toks[p].t === "elapsed") { next = toks[p]; break; }
                    var isMin = s.length <= 2 && ((prev && /^h|^\[?h/.test(prev.s)) || (next && next.s.charAt(0) === "s"));
                    if (isMin) out += s.length === 2 ? pad(mins, 2) : mins;
                    else if (s.length === 1) out += d.getUTCMonth() + 1;
                    else if (s.length === 2) out += pad(d.getUTCMonth() + 1, 2);
                    else if (s.length === 3) out += MONTHS[d.getUTCMonth()].slice(0, 3);
                    else if (s.length === 5) out += MONTHS[d.getUTCMonth()].charAt(0);
                    else out += MONTHS[d.getUTCMonth()];
                } else if (c === "y") {
                    out += s.length <= 2 ? pad(d.getUTCFullYear() % 100, 2) : d.getUTCFullYear();
                } else if (c === "d") {
                    if (s.length === 1) out += d.getUTCDate();
                    else if (s.length === 2) out += pad(d.getUTCDate(), 2);
                    else if (s.length === 3) out += DAYS[d.getUTCDay()].slice(0, 3);
                    else out += DAYS[d.getUTCDay()];
                } else if (c === "h") {
                    var h = ampm ? (hours % 12 || 12) : hours;
                    out += s.length >= 2 ? pad(h, 2) : h;
                } else if (c === "s") {
                    out += s.length >= 2 ? pad(secs, 2) : secs;
                }
            } else if (t.t === "elapsed") {
                var unit = t.s.charAt(0), total = totalMs / 1000;
                var val = unit === "h" ? Math.floor(total / 3600) : unit === "m" ? Math.floor(total / 60) : Math.floor(total);
                out += pad(val, t.s.length);
            } else if (t.t === "ampm") {
                var pm = hours >= 12;
                if (t.s.length === 3) out += pm ? (t.s.charAt(2) === "p" ? "p" : "P") : (t.s.charAt(0) === "a" ? "a" : "A");
                else out += pm ? "PM" : "AM";
            } else if (t.t === "dot" && fracDigits && toks[i - 1] && toks[i - 1].t === "date" && toks[i - 1].s.charAt(0) === "s") {
                out += "." + pad(ms, 3).slice(0, fracDigits);
                i += fracDigits;
            } else if (t.t === "lit") out += t.s;
            else if (t.t === "dot") out += ".";
            else if (t.t === "comma") out += ",";
            else if (t.t === "slash") out += "/";
            else if (t.t === "ph") out += t.c === "?" ? " " : t.c === "0" ? "0" : "";
            else if (t.t === "pct") out += "%";
        }
        return out;
    }

    function group(digits) {
        return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    function gcd(a, b) { while (b) { var t = b; b = a % b; a = t; } return a; }
    // best fraction with a denominator of at most maxDen digits (or exactly den)
    function fraction(x, digits, fixedDen) {
        if (fixedDen) return [Math.round(x * fixedDen), fixedDen];
        var maxDen = Math.pow(10, digits) - 1, best = [0, 1], bestErr = Infinity;
        for (var den = 1; den <= maxDen; den++) {
            var nu = Math.round(x * den), err = Math.abs(x - nu / den);
            if (err < bestErr - 1e-12) { best = [nu, den]; bestErr = err; if (err === 0) break; }
        }
        var g = gcd(best[0], best[1]) || 1;
        return [best[0] / g, best[1] / g];
    }

    function formatNumber(v, toks) {
        if (toks.some(function (t) { return t.t === "general"; }) && !toks.some(function (t) { return t.t === "ph"; })) {
            return toks.map(function (t) { return t.t === "general" ? general(v) : t.t === "lit" ? t.s : ""; }).join("");
        }
        var slashAt = -1, i;
        for (i = 0; i < toks.length; i++) if (toks[i].t === "slash") { slashAt = i; break; }
        var pct = toks.filter(function (t) { return t.t === "pct"; }).length;
        v = v * Math.pow(100, pct);

        // fraction: [int part] num/den
        if (slashAt > 0) return formatFraction(v, toks, slashAt);

        var dotAt = -1, expAt = -1;
        for (i = 0; i < toks.length; i++) {
            if (toks[i].t === "dot" && dotAt < 0 && expAt < 0) dotAt = i;
            if (toks[i].t === "exp" && expAt < 0) expAt = i;
        }
        var intEnd = dotAt >= 0 ? dotAt : (expAt >= 0 ? expAt : toks.length);
        var fracEnd = expAt >= 0 ? expAt : toks.length;
        var intPh = [], fracPh = [], lastIntPh = -1;
        for (i = 0; i < intEnd; i++) if (toks[i].t === "ph") { intPh.push(i); lastIntPh = i; }
        if (dotAt >= 0) for (i = dotAt + 1; i < fracEnd; i++) if (toks[i].t === "ph") fracPh.push(i);
        // commas: between integer placeholders = grouping; right after the
        // last digit placeholder = divide by 1000 each
        var grouping = false, scale = 0;
        for (i = 0; i < intEnd; i++) {
            if (toks[i].t !== "comma") continue;
            if (intPh.length && i > intPh[0] && i < lastIntPh) grouping = true;
            else if (i > lastIntPh && lastIntPh >= 0) scale++;
        }
        if (dotAt < 0 && expAt < 0) {
            // trailing commas at the very end also scale
            for (i = toks.length - 1; i >= 0 && toks[i].t === "comma"; i--) { /* counted above */ }
        }
        v = v / Math.pow(1000, scale);

        var exponent = 0, expPh = [];
        if (expAt >= 0) {
            for (i = expAt + 1; i < toks.length; i++) if (toks[i].t === "ph") expPh.push(i);
            if (v !== 0) {
                var intDigits = Math.max(1, intPh.length);
                exponent = Math.floor(Math.log10(Math.abs(v))) - (intDigits - 1);
                v = v / Math.pow(10, exponent);
                // rounding may push the mantissa to the next power
                var rounded = +Math.abs(v).toFixed(fracPh.length);
                if (rounded >= Math.pow(10, intDigits)) { exponent++; v = v / 10; }
            }
        }

        var neg = v < 0;
        var fixed = Math.abs(v).toFixed(fracPh.length);
        var parts = fixed.split(".");
        var intStr = parts[0] === "0" ? "" : parts[0];
        var fracStr = parts[1] || "";

        // integer placeholders filled from the right, one digit each (padding
        // per placeholder kind); the leftmost one takes any extra digits
        var intOut = {};
        var digits = intStr.split(""), p;
        for (p = intPh.length - 1; p >= 0; p--) {
            var tk = toks[intPh[p]];
            var d = digits.length ? digits.pop() : (tk.c === "0" ? "0" : tk.c === "?" ? " " : "");
            if (p === 0 && digits.length) d = digits.join("") + d;
            intOut[intPh[p]] = d;
        }
        if (grouping && intPh.length) {
            // thousands separators run across the whole integer (padding
            // zeros included, as in "000,000"): gather it into the first slot
            var whole = intPh.map(function (ix) { return intOut[ix]; }).join("");
            var lead = whole.match(/^\s*/)[0];
            intOut[intPh[0]] = lead + group(whole.slice(lead.length));
            for (p = 1; p < intPh.length; p++) intOut[intPh[p]] = "";
        }
        var fracOut = {};
        var lastSig = fracStr.replace(/0+$/, "").length;
        for (p = 0; p < fracPh.length; p++) {
            var fc = fracStr.charAt(p), ftk = toks[fracPh[p]];
            if (p < lastSig || ftk.c === "0") fracOut[fracPh[p]] = fc || "0";
            else fracOut[fracPh[p]] = ftk.c === "?" ? " " : "";
        }
        var expOut = {};
        if (expAt >= 0) {
            var es = String(Math.abs(exponent));
            var need = expPh.length;
            while (es.length < need) es = "0" + es;
            for (p = 0; p < expPh.length; p++) expOut[expPh[p]] = p === 0 ? es.slice(0, es.length - expPh.length + 1) : es.charAt(es.length - expPh.length + p);
        }

        var out = "";
        for (i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (t.t === "ph") {
                if (Object.prototype.hasOwnProperty.call(intOut, i)) out += intOut[i];
                else if (Object.prototype.hasOwnProperty.call(fracOut, i)) out += fracOut[i];
                else if (Object.prototype.hasOwnProperty.call(expOut, i)) out += expOut[i];
            } else if (t.t === "dot") {
                if (i === dotAt) out += ".";
                else out += ".";
            } else if (t.t === "comma") {
                // grouping / scaling commas are consumed
            } else if (t.t === "pct") out += "%";
            else if (t.t === "exp") out += "E" + (exponent < 0 ? "-" : (t.sign === "+" ? "+" : ""));
            else if (t.t === "lit") out += t.s;
            else if (t.t === "slash") out += "/";
        }
        if (neg && /[1-9]/.test(out)) out = "-" + out;
        return out;
    }

    function formatFraction(v, toks, slashAt) {
        var neg = v < 0;
        v = Math.abs(v);
        // placeholders before the slash: the last run is the numerator; any
        // run before it (separated by a literal / space) is the whole part
        var numPh = [], wholePh = [], i = slashAt - 1;
        while (i >= 0 && toks[i].t !== "ph") i--;
        while (i >= 0 && toks[i].t === "ph") { numPh.unshift(i); i--; }
        for (var k = i; k >= 0; k--) if (toks[k].t === "ph") wholePh.unshift(k);
        var denPh = [], fixedDen = 0, j = slashAt + 1, denDigits = "";
        while (j < toks.length && (toks[j].t === "ph" || (toks[j].t === "lit" && /^\d$/.test(toks[j].s)))) {
            if (toks[j].t === "ph") denPh.push(j); else denDigits += toks[j].s;
            j++;
        }
        if (denDigits) fixedDen = parseInt(denDigits, 10);
        var whole = wholePh.length ? Math.floor(v) : 0;
        var frac = fraction(v - whole, Math.max(1, denPh.length), fixedDen);
        if (frac[0] === frac[1] && frac[1] !== 0 && wholePh.length) { whole++; frac[0] = 0; }
        var out = "";
        for (i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (t.t === "ph") {
                if (i === wholePh[wholePh.length - 1]) out += whole || (frac[0] ? "" : "0");
                else if (i === numPh[numPh.length - 1]) out += frac[0] || (whole ? "" : "0");
                else if (i === denPh[denPh.length - 1]) out += frac[0] || !whole ? frac[1] : "";
            } else if (t.t === "slash") out += (frac[0] || !whole) ? "/" : "";
            else if (t.t === "lit") {
                if (fixedDen && i > slashAt && /^\d$/.test(t.s)) {
                    if (i === slashAt + 1) out += (frac[0] || !whole) ? String(fixedDen) : "";
                } else out += t.s;
            }
        }
        out = out.replace(/\s+$/, "");
        return (neg ? "-" : "") + out;
    }

    function passes(cond, v) {
        switch (cond.op) {
            case "<": return v < cond.v;
            case ">": return v > cond.v;
            case "<=": return v <= cond.v;
            case ">=": return v >= cond.v;
            case "=": return v === cond.v;
            case "<>": return v !== cond.v;
        }
        return true;
    }

    function format(value, code) {
        code = String(code === undefined || code === null ? "General" : code);
        var secs = sections(code).map(tokenize);
        if (typeof value === "string") {
            var ts = secs.length >= 4 ? secs[3] : secs.filter(function (s) { return s.some(function (t) { return t.t === "at"; }); })[0];
            if (!ts) return value;
            return ts.map(function (t) { return t.t === "at" ? value : t.t === "lit" ? t.s : ""; }).join("");
        }
        if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
        var v = Number(value), toks, abs = false;
        if (secs.some(function (s) { return s.cond; })) {
            toks = null;
            for (var i = 0; i < Math.min(secs.length, 2); i++) {
                if (secs[i].cond && passes(secs[i].cond, v)) { toks = secs[i]; break; }
            }
            if (!toks) toks = secs[secs[1] && secs[1].cond ? 2 : 1] || secs[0];
            abs = toks !== secs[0] && v < 0;
        } else if (v > 0 || secs.length === 1) toks = secs[0];
        else if (v < 0) { toks = secs[1] || secs[0]; abs = !!secs[1]; }
        else toks = secs.length >= 3 ? secs[2] : secs[0];
        if (!toks.length) return "";
        if (abs) v = Math.abs(v);
        if (isDateFormat(toks)) {
            if (v < 0) return "#".repeat(8);
            return formatDate(v, toks);
        }
        return formatNumber(v, toks);
    }

    return { format: format };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SheetNumFmt;
}
