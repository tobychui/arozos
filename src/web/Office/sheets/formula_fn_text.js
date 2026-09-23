/*
    ArozOS Office Sheets - text functions
    =====================================
    Registers into the formula engine (formula.js); load after it and after
    numfmt.js (TEXT).

        CONCAT CONCATENATE LEN UPPER LOWER TRIM PROPER LEFT RIGHT MID FIND
        SEARCH SUBSTITUTE REPLACE REPT EXACT VALUE NUMBERVALUE TEXT TEXTJOIN
        JOIN TEXTBEFORE TEXTAFTER CHAR CODE UNICHAR UNICODE CLEAN T FIXED
        DOLLAR REGEXMATCH REGEXEXTRACT REGEXREPLACE ROMAN ARABIC ASC
        ENCODEURL, and the double-byte variants LENB LEFTB RIGHTB MIDB FINDB
        SEARCHB REPLACEB (characters above U+00FF count as two bytes).
*/
(function (F, NumFmt) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr, isArr = F.isArr, Arr = F.Arr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Text", elem: true };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function valueErr(msg) { return new FErr(ERR.VALUE, msg); }
    // evaluate helper args; returns the first error or the list
    function all(list) {
        for (var i = 0; i < list.length; i++) if (isErr(list[i])) return list[i];
        return list;
    }
    function chars(s) { return Array.from(s); }

    /* ---------- basics ---------- */
    function joinValues(a, E, from) {
        var out = "";
        for (var i = from; i < a.length; i++) {
            if (a[i].t === "empty") continue;
            var vals = a[i].t === "str" || a[i].t === "num" || a[i].t === "bool" ? [E.val(a[i])] : E.flat(a[i]);
            if (isErr(vals)) return vals;
            for (var k = 0; k < vals.length; k++) {
                var s = F.toStr(vals[k]);
                if (isErr(s)) return s;
                out += s;
            }
        }
        return out;
    }
    def("CONCAT", 1, -1, function (a, E) { return joinValues(a, E, 0); },
        { elem: false, syntax: "CONCAT(value1, [value2, ...])" });
    F.defineAlias("CONCATENATE", "CONCAT");
    def("LEN", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        return isErr(s) ? s : s.length;
    }, { syntax: "LEN(text)" });
    def("UPPER", 1, 1, function (a, E) { var s = E.str(a[0]); return isErr(s) ? s : s.toUpperCase(); }, { syntax: "UPPER(text)" });
    def("LOWER", 1, 1, function (a, E) { var s = E.str(a[0]); return isErr(s) ? s : s.toLowerCase(); }, { syntax: "LOWER(text)" });
    def("TRIM", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        return isErr(s) ? s : s.replace(/ +/g, " ").replace(/^ | $/g, "");
    }, { syntax: "TRIM(text)" });
    def("PROPER", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        if (isErr(s)) return s;
        var out = "", prevLetter = false;
        chars(s).forEach(function (ch) {
            var letter = /\p{L}/u.test(ch);
            out += letter ? (prevLetter ? ch.toLowerCase() : ch.toUpperCase()) : ch;
            prevLetter = letter;
        });
        return out;
    }, { syntax: "PROPER(text_to_capitalize)" });
    def("EXACT", 2, 2, function (a, E) {
        var p = all([E.str(a[0]), E.str(a[1])]);
        return isErr(p) ? p : p[0] === p[1];
    }, { syntax: "EXACT(string1, string2)" });
    def("T", 1, 1, function (a, E) {
        var v = a[0].t === "range" ? E.flat(a[0]) : [E.val(a[0])];
        if (isErr(v)) return v;
        if (isErr(v[0])) return v[0];
        return typeof v[0] === "string" ? v[0] : "";
    }, { syntax: "T(value)" });
    def("CLEAN", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        return isErr(s) ? s : s.replace(/[\x00-\x1f]/g, "");
    }, { syntax: "CLEAN(text)" });
    def("REPT", 2, 2, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1])]);
        if (isErr(p)) return p;
        if (p[1] < 0) return valueErr("REPT count cannot be negative");
        if (p[0].length * p[1] > 32767) return valueErr("REPT result is too long");
        return p[0].repeat(p[1]);
    }, { syntax: "REPT(text_to_repeat, number_of_repetitions)" });

    /* ---------- slicing ---------- */
    def("LEFT", 1, 2, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1], 1)]);
        if (isErr(p)) return p;
        if (p[1] < 0) return valueErr("LEFT length cannot be negative");
        return chars(p[0]).slice(0, p[1]).join("");
    }, { syntax: "LEFT(string, [number_of_characters])" });
    def("RIGHT", 1, 2, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1], 1)]);
        if (isErr(p)) return p;
        if (p[1] < 0) return valueErr("RIGHT length cannot be negative");
        var c = chars(p[0]);
        return p[1] === 0 ? "" : c.slice(Math.max(0, c.length - p[1])).join("");
    }, { syntax: "RIGHT(string, [number_of_characters])" });
    def("MID", 3, 3, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1]), E.int(a[2])]);
        if (isErr(p)) return p;
        if (p[1] < 1) return valueErr("MID start must be 1 or more");
        if (p[2] < 0) return valueErr("MID length cannot be negative");
        return chars(p[0]).slice(p[1] - 1, p[1] - 1 + p[2]).join("");
    }, { syntax: "MID(string, starting_at, extract_length)" });

    function searchRegex(pattern) {
        var out = "", i = 0;
        while (i < pattern.length) {
            var ch = pattern.charAt(i);
            if (ch === "~" && i + 1 < pattern.length && "*?~".indexOf(pattern.charAt(i + 1)) >= 0) {
                out += "\\" + pattern.charAt(i + 1);
                i += 2;
                continue;
            }
            if (ch === "*") out += "[\\s\\S]*?";
            else if (ch === "?") out += "[\\s\\S]";
            else out += ch.replace(/[\\^$.|+()[\]{}\/]/g, "\\$&");
            i++;
        }
        return new RegExp(out, "gi");
    }
    // 0-based index of needle in hay from start, or -1
    function locate(hay, needle, start, wildcards) {
        if (!wildcards) return hay.indexOf(needle, start);
        var re = searchRegex(needle);
        re.lastIndex = start;
        var m = re.exec(hay);
        return m ? m.index : -1;
    }
    function findFn(name, wildcards) {
        def(name, 2, 3, function (a, E) {
            var p = all([E.str(a[0]), E.str(a[1]), E.int(a[2], 1)]);
            if (isErr(p)) return p;
            var needle = p[0], hay = p[1], start = p[2];
            if (start < 1 || start > hay.length + 1) return valueErr(name + " start position is out of range");
            var at = wildcards ? locate(hay, needle, start - 1, true) :
                locate(hay, needle, start - 1, false);
            if (wildcards && at >= 0 && needle === "") at = start - 1;
            if (at < 0) return valueErr(name + " did not find '" + needle + "'");
            return at + 1;
        }, { syntax: name + "(search_for, text_to_search, [starting_at])" });
    }
    findFn("FIND", false);
    findFn("SEARCH", true);

    def("SUBSTITUTE", 3, 4, function (a, E) {
        var p = all([E.str(a[0]), E.str(a[1]), E.str(a[2])]);
        if (isErr(p)) return p;
        var text = p[0], from = p[1], to = p[2];
        if (from === "") return text;
        if (E.missing(a[3])) return text.split(from).join(to);
        var n = E.int(a[3]);
        if (isErr(n)) return n;
        if (n < 1) return valueErr("SUBSTITUTE occurrence must be 1 or more");
        var at = -1;
        for (var i = 0; i < n; i++) {
            at = text.indexOf(from, at + 1);
            if (at < 0) return text;
        }
        return text.slice(0, at) + to + text.slice(at + from.length);
    }, { syntax: "SUBSTITUTE(text_to_search, search_for, replace_with, [occurrence_number])" });
    def("REPLACE", 4, 4, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1]), E.int(a[2]), E.str(a[3])]);
        if (isErr(p)) return p;
        if (p[1] < 1 || p[2] < 0) return valueErr("REPLACE position or length is out of range");
        var c = chars(p[0]);
        return c.slice(0, p[1] - 1).join("") + p[3] + c.slice(p[1] - 1 + p[2]).join("");
    }, { syntax: "REPLACE(text, position, length, new_text)" });

    function delimited(name, before) {
        def(name, 2, 6, function (a, E) {
            var text = E.str(a[0]);
            if (isErr(text)) return text;
            var delims = E.flat(a[1]);
            if (isErr(delims)) return delims;
            delims = delims.map(F.toStr);
            var bad = delims.filter(isErr)[0];
            if (bad) return bad;
            var inst = E.int(a[2], 1), mode = E.int(a[3], 0), atEnd = E.int(a[4], 0);
            bad = [inst, mode, atEnd].filter(isErr)[0];
            if (bad) return bad;
            if (inst === 0 || Math.abs(inst) > text.length + 1) return valueErr(name + " instance is out of range");
            var hay = mode ? text.toLowerCase() : text;
            var ds = delims.map(function (d) { return mode ? d.toLowerCase() : d; });
            // every delimiter occurrence, in order
            var hits = [];
            for (var i = 0; i <= hay.length; i++) {
                for (var k = 0; k < ds.length; k++) {
                    if (ds[k] !== "" && hay.substr(i, ds[k].length) === ds[k]) { hits.push([i, ds[k].length]); i += ds[k].length - 1; break; }
                    if (ds[k] === "") { hits.push([i, 0]); break; }
                }
            }
            if (atEnd) { hits.push([text.length, 0]); hits.unshift([0, 0]); }
            var hit = inst > 0 ? hits[inst - 1] : hits[hits.length + inst];
            if (!hit) {
                if (!E.missing(a[5])) return E.val(a[5]);
                return new FErr(ERR.NA, name + " did not find the delimiter");
            }
            return before ? text.slice(0, hit[0]) : text.slice(hit[0] + hit[1]);
        }, { syntax: name + "(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])" });
    }
    delimited("TEXTBEFORE", true);
    delimited("TEXTAFTER", false);

    /* ---------- numbers <-> text ---------- */
    function parseValueText(s) {
        var t = s.trim();
        if (t === "") return 0;
        var neg = false;
        if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
        var pct = /%$/.test(t);
        if (pct) t = t.slice(0, -1).trim();
        var plain = t.replace(/^([+-]?)\s*[$£€¥]\s*/, "$1").replace(/,(?=\d{3}(\D|$))/g, "");
        var n = F.coerceNumber(plain);
        if (n === null) return null;
        if (pct) n /= 100;
        return neg ? -n : n;
    }
    def("VALUE", 1, 1, function (a, E) {
        var v = E.val(a[0]);
        if (isErr(v)) return v;
        if (typeof v === "number") return v;
        if (v === null) return 0;
        if (typeof v === "boolean") return valueErr("VALUE needs text or a number");
        var n = parseValueText(String(v));
        return n === null ? valueErr("'" + v + "' is not a number") : n;
    }, { syntax: "VALUE(text)" });
    def("NUMBERVALUE", 1, 3, function (a, E) {
        var p = all([E.str(a[0]), E.str(a[1], "."), E.str(a[2], ",")]);
        if (isErr(p)) return p;
        var t = p[0].replace(/\s+/g, ""), dec = p[1].charAt(0), grp = p[2];
        var pcts = (t.match(/%+$/) || [""])[0].length;
        t = t.replace(/%+$/, "");
        if (grp) t = t.split(grp.charAt(0)).join("");
        if (dec && dec !== ".") t = t.split(dec).join(".");
        if (t === "") return 0;
        if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return valueErr("'" + p[0] + "' is not a number");
        return parseFloat(t) / Math.pow(100, pcts);
    }, { syntax: "NUMBERVALUE(text, [decimal_separator], [group_separator])" });
    def("TEXT", 2, 2, function (a, E) {
        var v = E.val(a[0]), fmt = E.str(a[1]);
        if (isErr(v)) return v;
        if (isErr(fmt)) return fmt;
        if (v === null) v = 0;
        if (typeof v === "string") {
            var n = parseValueText(v);
            if (n !== null && v.trim() !== "") v = n;
        }
        return NumFmt.format(v, fmt);
    }, { syntax: "TEXT(number, format)" });
    function fixedText(n, decimals, commas) {
        var f = Math.pow(10, Math.abs(decimals));
        var a = +(Math.abs(n) * (decimals >= 0 ? f : 1 / f)).toPrecision(15);
        var r = Math.round(a);
        r = decimals >= 0 ? r / f : r * f;
        var s = r.toFixed(Math.max(0, decimals));
        if (commas) {
            var parts = s.split(".");
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            s = parts.join(".");
        }
        return (n < 0 && r !== 0 ? "-" : "") + s;
    }
    def("FIXED", 1, 3, function (a, E) {
        var p = all([E.num(a[0]), E.int(a[1], 2), E.bool(a[2], false)]);
        if (isErr(p)) return p;
        if (p[1] > 127) return valueErr("FIXED allows at most 127 decimals");
        return fixedText(p[0], p[1], !p[2]);
    }, { syntax: "FIXED(number, [number_of_places], [suppress_separator])" });
    def("DOLLAR", 1, 2, function (a, E) {
        var p = all([E.num(a[0]), E.int(a[1], 2)]);
        if (isErr(p)) return p;
        var s = fixedText(Math.abs(p[0]), p[1], true);
        return (p[0] < 0 && /[1-9]/.test(s) ? "-$" : "$") + s;
    }, { syntax: "DOLLAR(number, [number_of_places])" });

    /* ---------- joining ---------- */
    def("TEXTJOIN", 3, -1, function (a, E) {
        var delims = E.flat(a[0]);
        if (isErr(delims)) return delims;
        delims = delims.map(function (d) { return d === null ? "" : F.toStr(d); });
        var skip = E.bool(a[1]);
        if (isErr(skip)) return skip;
        var parts = [];
        for (var i = 2; i < a.length; i++) {
            if (a[i].t === "empty") { if (!skip) parts.push(""); continue; }
            var vals = E.isRef(a[i]) || a[i].t === "lit" || a[i].t === "call" || a[i].t === "bin" ? E.flat(a[i]) : [E.val(a[i])];
            if (isErr(vals)) return vals;
            for (var k = 0; k < vals.length; k++) {
                var s = F.toStr(vals[k]);
                if (isErr(s)) return s;
                if (skip && s === "") continue;
                parts.push(s);
            }
        }
        var out = "";
        parts.forEach(function (s, idx) {
            if (idx) out += delims.length ? delims[(idx - 1) % delims.length] : "";
            out += s;
        });
        if (out.length > 32767) return valueErr("TEXTJOIN result is too long");
        return out;
    }, { elem: false, syntax: "TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])" });
    def("JOIN", 2, -1, function (a, E) {
        var d = E.str(a[0]);
        if (isErr(d)) return d;
        var parts = [];
        for (var i = 1; i < a.length; i++) {
            var vals = E.flat(a[i]);
            if (isErr(vals)) return vals;
            for (var k = 0; k < vals.length; k++) {
                var s = F.toStr(vals[k]);
                if (isErr(s)) return s;
                parts.push(s);
            }
        }
        return parts.join(d);
    }, { elem: false, syntax: "JOIN(delimiter, value_or_array1, [value_or_array2, ...])" });

    /* ---------- character codes ---------- */
    function codeToChar(name) {
        return function (a, E) {
            var n = E.int(a[0]);
            if (isErr(n)) return n;
            if (n < 1 || n > 0x10FFFF) return valueErr(name + " code is out of range");
            return String.fromCodePoint(n);
        };
    }
    function charToCode(name) {
        return function (a, E) {
            var s = E.str(a[0]);
            if (isErr(s)) return s;
            if (s === "") return valueErr(name + " of an empty string");
            return s.codePointAt(0);
        };
    }
    def("CHAR", 1, 1, codeToChar("CHAR"), { syntax: "CHAR(table_number)" });
    def("UNICHAR", 1, 1, codeToChar("UNICHAR"), { syntax: "UNICHAR(number)" });
    def("CODE", 1, 1, charToCode("CODE"), { syntax: "CODE(string)" });
    def("UNICODE", 1, 1, charToCode("UNICODE"), { syntax: "UNICODE(text)" });
    def("ENCODEURL", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        return isErr(s) ? s : encodeURIComponent(s);
    }, { cat: "Web", syntax: "ENCODEURL(text)" });

    /* ---------- regular expressions (JavaScript syntax) ---------- */
    function regex(pattern, global) {
        var flags = global ? "g" : "";
        // RE2 style inline case-insensitive flag
        var m = /^\(\?([a-z]+)\)/.exec(pattern);
        if (m) {
            if (m[1].indexOf("i") >= 0) flags += "i";
            if (m[1].indexOf("s") >= 0) flags += "s";
            if (m[1].indexOf("m") >= 0) flags += "m";
            pattern = pattern.slice(m[0].length);
        }
        try { return new RegExp(pattern, flags + "u"); }
        catch (e) {
            try { return new RegExp(pattern, flags); }
            catch (e2) { return new FErr(ERR.REF, "'" + pattern + "' is not a valid regular expression"); }
        }
    }
    def("REGEXMATCH", 2, 2, function (a, E) {
        var p = all([E.str(a[0]), E.str(a[1])]);
        if (isErr(p)) return p;
        var re = regex(p[1]);
        return isErr(re) ? re : re.test(p[0]);
    }, { syntax: "REGEXMATCH(text, regular_expression)" });
    def("REGEXEXTRACT", 2, 2, function (a, E, arrayCtx) {
        var p = all([E.str(a[0]), E.str(a[1])]);
        if (isErr(p)) return p;
        var re = regex(p[1]);
        if (isErr(re)) return re;
        var m = re.exec(p[0]);
        if (!m) return new FErr(ERR.NA, "REGEXEXTRACT found no match");
        if (m.length <= 1) return m[0];
        // several capture groups become a row of values
        if (m.length > 2 && arrayCtx) return new Arr(1, m.length - 1, m.slice(1).map(function (g) { return g === undefined ? "" : g; }));
        return m[1] === undefined ? "" : m[1];
    }, { elem: false, array: true, syntax: "REGEXEXTRACT(text, regular_expression)" });
    def("REGEXREPLACE", 3, 3, function (a, E) {
        var p = all([E.str(a[0]), E.str(a[1]), E.str(a[2])]);
        if (isErr(p)) return p;
        var re = regex(p[1], true);
        if (isErr(re)) return re;
        return p[0].replace(re, p[2].replace(/\\(\d)/g, "$$$1"));
    }, { syntax: "REGEXREPLACE(text, regular_expression, replacement)" });

    /* ---------- roman numerals ---------- */
    // ROMAN form 0 is classic; forms 1-4 are progressively more concise
    // (form 4 = simplified), following the same rules as Excel
    var R_CHARS = ["M", "D", "C", "L", "X", "V", "I"], R_VALUES = [1000, 500, 100, 50, 10, 5, 1];
    function roman(value, mode) {
        var out = "", nVal = value, maxIndex = R_VALUES.length - 1;
        for (var i = 0; i <= maxIndex / 2; i++) {
            var index = 2 * i;
            var digit = Math.floor(nVal / R_VALUES[index]);
            if (digit % 5 === 4) {
                var index2 = digit === 4 ? index - 1 : index - 2;
                var steps = 0;
                while (steps < mode && index < maxIndex) {
                    steps++;
                    if (R_VALUES[index2] - R_VALUES[index + 1] <= nVal) index++;
                    else steps = mode;
                }
                out += R_CHARS[index] + R_CHARS[index2];
                nVal = nVal + R_VALUES[index] - R_VALUES[index2];
            } else {
                if (digit > 4) out += R_CHARS[index - 1];
                out += R_CHARS[index].repeat(digit % 5);
                nVal %= R_VALUES[index];
            }
        }
        return out;
    }
    def("ROMAN", 1, 2, function (a, E) {
        var n = E.int(a[0]);
        if (isErr(n)) return n;
        var mode = 0;
        if (!E.missing(a[1])) {
            var mv = E.val(a[1]);
            if (isErr(mv)) return mv;
            mode = typeof mv === "boolean" ? (mv ? 0 : 4) : Math.trunc(F.toNum(mv));
            if (isErr(mode)) return mode;
        }
        if (n < 0 || n > 3999 || mode < 0 || mode > 4) return valueErr("ROMAN needs 0..3999 and a form 0..4");
        return roman(n, mode);
    }, { syntax: "ROMAN(number, [rule_relaxation])" });
    def("ARABIC", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        if (isErr(s)) return s;
        s = s.trim().toUpperCase();
        var neg = s.charAt(0) === "-";
        if (neg) s = s.slice(1);
        if (s.length > 255 || !/^[MDCLXVI]*$/.test(s)) return valueErr("'" + s + "' is not a roman numeral");
        var total = 0;
        for (var i = 0; i < s.length; i++) {
            var v = R_VALUES[R_CHARS.indexOf(s.charAt(i))];
            var next = i + 1 < s.length ? R_VALUES[R_CHARS.indexOf(s.charAt(i + 1))] : 0;
            total += v < next ? -v : v;
        }
        return neg ? -total : total;
    }, { syntax: "ARABIC(roman_numeral)" });

    /* ---------- double-byte text ---------- */
    // full-width forms and katakana -> half-width
    var KANA = "ァｧアｱィｨイｲゥｩウｳェｪエｴォｫオｵカｶキｷクｸケｹコｺサｻシｼスｽセｾソｿタﾀチﾁッｯツﾂテﾃトﾄナﾅニﾆヌﾇネﾈノﾉ" +
        "ハﾊヒﾋフﾌヘﾍホﾎマﾏミﾐムﾑメﾒモﾓャｬヤﾔュｭユﾕョｮヨﾖラﾗリﾘルﾙレﾚロﾛワﾜヲｦンﾝーｰ。｡「｢」｣、､・･゛ﾞ゜ﾟ";
    var VOICED = "ガカギキグクゲケゴコザサジシズスゼセゾソダタヂチヅツデテドトバハビヒブフベヘボホヴウ";
    var SEMI = "パハピヒプフペヘポホ";
    var KANA_MAP = {};
    (function () {
        var i, c = chars(KANA);
        for (i = 0; i < c.length; i += 2) KANA_MAP[c[i]] = c[i + 1];
        var v = chars(VOICED);
        for (i = 0; i < v.length; i += 2) KANA_MAP[v[i]] = KANA_MAP[v[i + 1]] + "ﾞ";
        var s = chars(SEMI);
        for (i = 0; i < s.length; i += 2) KANA_MAP[s[i]] = KANA_MAP[s[i + 1]] + "ﾟ";
    })();
    def("ASC", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        if (isErr(s)) return s;
        return chars(s).map(function (ch) {
            var cp = ch.codePointAt(0);
            if (cp >= 0xFF01 && cp <= 0xFF5E) return String.fromCharCode(cp - 0xFEE0);
            if (cp === 0x3000) return " ";
            return KANA_MAP[ch] || ch;
        }).join("");
    }, { syntax: "ASC(text)" });

    function byteLen(ch) {
        var cp = ch.codePointAt(0);
        return cp > 0xFF && !(cp >= 0xFF61 && cp <= 0xFF9F) ? 2 : 1;
    }
    // [char index, byte offset] walk helpers
    function charAtByte(c, byteIndex) {
        var b = 0;
        for (var i = 0; i < c.length; i++) {
            if (b >= byteIndex) return i;
            b += byteLen(c[i]);
        }
        return c.length;
    }
    function takeBytes(c, from, count) {
        var out = "", b = 0;
        for (var i = from; i < c.length; i++) {
            var w = byteLen(c[i]);
            if (b + w > count) break;
            out += c[i];
            b += w;
        }
        return out;
    }
    def("LENB", 1, 1, function (a, E) {
        var s = E.str(a[0]);
        return isErr(s) ? s : chars(s).reduce(function (n, ch) { return n + byteLen(ch); }, 0);
    }, { syntax: "LENB(string)" });
    def("LEFTB", 1, 2, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1], 1)]);
        if (isErr(p)) return p;
        if (p[1] < 0) return valueErr("LEFTB length cannot be negative");
        return takeBytes(chars(p[0]), 0, p[1]);
    }, { syntax: "LEFTB(string, num_of_bytes)" });
    def("RIGHTB", 1, 2, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1], 1)]);
        if (isErr(p)) return p;
        if (p[1] < 0) return valueErr("RIGHTB length cannot be negative");
        var c = chars(p[0]).reverse();
        return chars(takeBytes(c, 0, p[1])).reverse().join("");
    }, { syntax: "RIGHTB(string, num_of_bytes)" });
    def("MIDB", 3, 3, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1]), E.int(a[2])]);
        if (isErr(p)) return p;
        if (p[1] < 1 || p[2] < 0) return valueErr("MIDB start or length is out of range");
        var c = chars(p[0]);
        return takeBytes(c, charAtByte(c, p[1] - 1), p[2]);
    }, { syntax: "MIDB(string, starting_at, extract_length_bytes)" });
    function findB(name, wildcards) {
        def(name, 2, 3, function (a, E) {
            var p = all([E.str(a[0]), E.str(a[1]), E.int(a[2], 1)]);
            if (isErr(p)) return p;
            var c = chars(p[1]);
            var startChar = charAtByte(c, p[2] - 1);
            var hay = c.join(""), units = c.slice(0, startChar).join("").length;
            var at = locate(hay, p[0], units, wildcards);
            if (p[2] < 1 || at < 0) return valueErr(name + " did not find '" + p[0] + "'");
            return chars(hay.slice(0, at)).reduce(function (n, ch) { return n + byteLen(ch); }, 0) + 1;
        }, { syntax: name + "(search_for, text_to_search, [starting_at])" });
    }
    findB("FINDB", false);
    findB("SEARCHB", true);
    def("REPLACEB", 4, 4, function (a, E) {
        var p = all([E.str(a[0]), E.int(a[1]), E.int(a[2]), E.str(a[3])]);
        if (isErr(p)) return p;
        if (p[1] < 1 || p[2] < 0) return valueErr("REPLACEB position or length is out of range");
        var c = chars(p[0]);
        var from = charAtByte(c, p[1] - 1);
        var cut = chars(takeBytes(c, from, p[2])).length;
        return c.slice(0, from).join("") + p[3] + c.slice(from + cut).join("");
    }, { syntax: "REPLACEB(text, position, num_bytes, new_text)" });
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula,
   typeof module !== "undefined" && module.exports ? require("./numfmt.js") : SheetNumFmt);
