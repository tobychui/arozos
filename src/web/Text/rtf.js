/*
    rtf.js — self-contained RTF reader / writer for the Text editor.

    TextRTF.toHTML(src)
        src is the RTF source as a "binary string" (one char per byte, as read
        from the file); characters above U+00FF are accepted as already-decoded
        text. Returns { html, baseSize, baseFont } where baseSize is the
        document's dominant font size in half-points and baseFont its dominant
        font name. Runs at the base size / font carry no inline style, so they
        follow the editor's own typography.

    TextRTF.fromHTML(root, opts)
        Serialises the editor DOM (a detached clone) back to RTF. opts may give
        { baseSize, baseFont } so a document keeps the defaults it was loaded
        with. Images must be data: URLs (run inlineImages() first).

    TextRTF.inlineImages(root)
        Promise. Turns every <img> under root into a PNG/JPEG data: URL and
        records its natural size, so fromHTML() can embed it as \pict.

    Supported: paragraphs, alignment, indents, headings (\outlinelevel), bold,
    italic, underline, strikethrough, super/subscript, fonts, sizes, colours,
    highlight, hyperlinks, bullet / numbered lists, tables, horizontal rules,
    PNG/JPEG pictures, \u unicode and code-page (\'hh) text incl. DBCS (Big5,
    GBK, Shift_JIS, EUC-KR).
*/
(function(){
"use strict";

// ── Code pages ───────────────────────────────────────────────────────────
var CHARSET_CP = {
    0:1252, 77:10000, 128:932, 129:949, 130:949, 134:936, 136:950, 161:1253,
    162:1254, 163:1258, 177:1255, 178:1256, 186:1257, 204:1251, 222:874, 238:1250
};
var CP_LABEL = {
    874:"windows-874", 932:"shift_jis", 936:"gbk", 949:"euc-kr", 950:"big5",
    1250:"windows-1250", 1251:"windows-1251", 1252:"windows-1252", 1253:"windows-1253",
    1254:"windows-1254", 1255:"windows-1255", 1256:"windows-1256", 1257:"windows-1257",
    1258:"windows-1258", 10000:"macintosh", 65001:"utf-8"
};
var decoders = {};
function decoderFor(cp){
    if (decoders[cp]) return decoders[cp];
    var d = null;
    try { d = new TextDecoder(CP_LABEL[cp] || "windows-1252"); } catch(e){}
    if (!d) d = new TextDecoder("windows-1252");
    decoders[cp] = d;
    return d;
}

// destinations whose whole group is dropped
var SKIP_DEST = {
    stylesheet:1, info:1, header:1, headerl:1, headerr:1, headerf:1, footer:1, footerl:1,
    footerr:1, footerf:1, footnote:1, nonshppict:1, listtable:1, listoverridetable:1,
    revtbl:1, rsidtbl:1, xe:1, tc:1, txe:1, themedata:1, colorschememapping:1,
    latentstyles:1, datastore:1, xmlnstbl:1, mmathPr:1, pnseclvl:1, filetbl:1,
    pgdsctbl:1, author:1, operator:1, title:1, comment:1, company:1, doccomm:1,
    keywords:1, subject:1, upr:1, "private":1, annotation:1, atnid:1, atnauthor:1,
    objdata:1, objclass:1, bkmkstart:1, bkmkend:1, template:1, docvar:1, userprops:1
};
// "\*"-marked destinations we understand (every other one is skipped)
var KNOWN_STAR = { fldinst:1, shppict:1, pn:1, listtext:1 };

var SYMBOLS = {
    emdash:"\u2014", endash:"\u2013", bullet:"\u2022", lquote:"\u2018", rquote:"\u2019",
    ldblquote:"\u201C", rdblquote:"\u201D", emspace:"\u2003", enspace:"\u2002",
    qmspace:"\u2005", zwj:"\u200D", zwnj:"\u200C", ltrmark:"", rtlmark:""
};

function defaultChar(){
    return { b:false, i:false, u:false, s:false, sup:false, sub:false, v:false,
             fs:24, f:-1, cf:0, bg:0, link:null };
}
function defaultPara(){
    return { align:"", li:0, fi:0, intbl:false, outline:-1, ilvl:-1, ls:0, brdrb:false };
}
function copy(o){ var r = {}; for (var k in o) r[k] = o[k]; return r; }

// ════════════════════════════════════════════════════════════════════════
// Reader
// ════════════════════════════════════════════════════════════════════════
function parse(src){
    var fonts = {}, colors = [], deff = 0, ansicp = 1252;
    var blocks = [];                    // finished paragraphs / tables
    var table = null, row = null, cell = null;
    var para = newPara();

    var st = { dest:"main", chr:defaultChar(), par:defaultPara(), uc:1, field:null,
               font:null, pict:null };
    var stack = [];
    var bytes = [], bytesCP = 1252;     // pending code-page bytes
    var skipChars = 0;                  // \u fallback characters still to skip
    var star = false;                   // saw "\*" for the next control word
    var color = null;                   // colortbl entry being built

    function newPara(){ return { runs:[], marker:"", listType:"" }; }

    function fontCP(fi){ return cpOf(fonts[fi]); }
    function cpOf(f){
        if (!f) return ansicp;
        if (f.cpg) return f.cpg;
        if (f.charset === 1 || f.charset === undefined) return ansicp;
        if (f.charset === 2) return 1252;
        return CHARSET_CP[f.charset] || ansicp;
    }
    function curCP(){ return fontCP(st.chr.f < 0 ? deff : st.chr.f); }

    function flush(){
        if (!bytes.length) return;
        var txt = decoderFor(bytesCP).decode(new Uint8Array(bytes));
        bytes = [];
        emitText(txt);
    }
    function emitByte(b){
        if (skipChars > 0){ skipChars--; return; }
        var cp = st.dest === "fonttbl" ? cpOf(st.font) : curCP();
        if (bytes.length && cp !== bytesCP) flush();
        bytesCP = cp;
        bytes.push(b);
    }
    function emitText(txt){
        if (!txt) return;
        switch (st.dest){
        case "main":
            if (st.chr.v) return;                       // hidden text
            var runs = para.runs, last = runs[runs.length - 1];
            if (last && last.type === "text" && sameChr(last.chr, st.chr)) last.text += txt;
            else runs.push({ type:"text", text:txt, chr:copy(st.chr) });
            return;
        case "fonttbl":
            if (st.font) st.font.raw += txt;
            return;
        case "fldinst":
            if (st.field) st.field.inst += txt;
            return;
        case "listtext":
            para.marker += txt;
            return;
        }
    }
    function sameChr(a, b){
        for (var k in a) if (a[k] !== b[k]) return false;
        return true;
    }
    function emitObj(o){
        if (st.dest !== "main" || st.chr.v) return;
        o.chr = copy(st.chr);
        para.runs.push(o);
    }

    function endPara(){
        flush();
        var p = para;
        p.pp = copy(st.par);
        para = newPara();
        if (p.pp.intbl){
            if (!cell) cell = [];
            cell.push(p);
        } else {
            closeTable();
            blocks.push(p);
        }
    }
    function endCell(){
        flush();
        if (para.runs.length || !cell || !cell.length){
            para.pp = copy(st.par);
            if (!cell) cell = [];
            cell.push(para);
        }
        para = newPara();
        if (!row) row = [];
        row.push(cell);
        cell = null;
    }
    function endRow(){
        flush();
        if (cell) endCell();
        if (!table) table = { type:"table", rows:[] };
        if (row) table.rows.push(row);
        row = null;
    }
    function closeTable(){
        if (cell || row) endRow();
        if (table){ blocks.push(table); table = null; }
    }

    function endGroup(){
        flush();
        var child = st;
        st = stack.pop() || st;
        if (child.dest === "pict" && child.pict && st.dest !== "skip") finishPict(child);
        if (child.dest === "fonttbl" && child.font && child.font !== st.font) finishFont(child.font);
        skipChars = 0;
    }
    function finishFont(f){
        if (f.done) return;
        f.done = true;
        var name = f.raw.replace(/;.*$/, "").trim();
        fonts[f.idx] = { name:name, charset:f.charset, cpg:f.cpg, family:f.family };
    }
    function finishPict(s){
        var p = s.pict, mime = null;
        if (p.type === "png") mime = "image/png";
        else if (p.type === "jpeg") mime = "image/jpeg";
        if (!mime) return;                              // metafiles / bitmaps can't be shown
        var bin = p.bin;
        if (!bin){
            var hex = p.hex.replace(/[^0-9a-fA-F]/g, "");
            var out = [];
            for (var i = 0; i + 1 < hex.length; i += 2) out.push(String.fromCharCode(parseInt(hex.substr(i, 2), 16)));
            bin = out.join("");
        }
        if (!bin) return;
        var w = p.wgoal ? p.wgoal * (p.scalex || 100) / 100 / 15 : 0;
        var h = p.hgoal ? p.hgoal * (p.scaley || 100) / 100 / 15 : 0;
        if (st.dest === "main"){                        // st is the enclosing group again
            para.runs.push({ type:"img", src:"data:" + mime + ";base64," + btoa(bin),
                             w:Math.round(w), h:Math.round(h), chr:copy(st.chr) });
        }
    }

    function control(word, param, hasParam){
        // "\*" handling: unknown ignorable destinations are skipped wholesale
        if (star){
            star = false;
            if (!KNOWN_STAR[word]){ st.dest = "skip"; return; }
        }
        if (st.dest === "skip") return;
        if (skipChars > 0 && word !== "u"){ skipChars--; return; }

        if (SKIP_DEST[word]){ st.dest = "skip"; return; }

        // unicode text is valid in every text-bearing destination (incl. font names)
        if (word === "u"){
            flush();
            emitText(String.fromCharCode(param < 0 ? param + 65536 : param));
            skipChars = st.uc;
            return;
        }
        if (word === "uc"){ st.uc = param; return; }

        // ── destinations ──
        switch (word){
        case "fonttbl":  st.dest = "fonttbl"; st.font = null; return;
        case "colortbl": st.dest = "colortbl"; color = null; return;
        case "pict":     st.dest = "pict"; st.pict = { type:"", hex:"", bin:"", wgoal:0, hgoal:0, scalex:100, scaley:100 }; return;
        case "field":    st.field = { inst:"" }; return;
        case "fldinst":  st.dest = "fldinst"; return;
        case "fldrslt":
            st.dest = "main";
            if (st.field){
                var m = st.field.inst.match(/HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/i) ||
                        st.field.inst.match(/HYPERLINK\s+(\S+)/i);
                if (m){
                    var url = m[1];
                    if (/\\l\s/.test(st.field.inst) && url.charAt(0) !== "#") url = "#" + url;
                    st.chr.link = url;
                }
            }
            return;
        case "listtext": case "pntext":
            st.dest = "listtext"; return;
        case "pn":       st.dest = "pn"; return;
        case "shppict":  return;                        // its \pict is the real picture
        }

        if (st.dest === "fonttbl"){
            if (word === "f"){
                if (st.font && !st.font.done && stack.length && stack[stack.length-1].font !== st.font) finishFont(st.font);
                st.font = { idx:param, raw:"", charset:undefined, cpg:0, family:"" };
            } else if (st.font){
                if (word === "fcharset") st.font.charset = param;
                else if (word === "cpg") st.font.cpg = param;
                else if (/^f(roman|swiss|modern|script|decor|tech|bidi|nil)$/.test(word)) st.font.family = word.substr(1);
            }
            return;
        }
        if (st.dest === "colortbl"){
            if (!color) color = { r:0, g:0, b:0 };
            if (word === "red") color.r = param;
            else if (word === "green") color.g = param;
            else if (word === "blue") color.b = param;
            return;
        }
        if (st.dest === "pict"){
            var p = st.pict;
            if (word === "pngblip") p.type = "png";
            else if (word === "jpegblip") p.type = "jpeg";
            else if (word === "emfblip" || word === "wmetafile" || word === "macpict" || word === "dibitmap" || word === "wbitmap") p.type = p.type || word;
            else if (word === "picwgoal") p.wgoal = param;
            else if (word === "pichgoal") p.hgoal = param;
            else if (word === "picscalex") p.scalex = param;
            else if (word === "picscaley") p.scaley = param;
            return;
        }
        if (st.dest === "pn"){
            if (word === "pnlvlblt") para.listType = "ul";
            else if (/^pn(lvlbody|dec|ucltr|lcltr|ucrm|lcrm)$/.test(word)) para.listType = para.listType || "ol";
            return;
        }

        var c = st.chr, pp = st.par;
        switch (word){
        // header
        case "ansicpg": ansicp = param || 1252; return;
        case "deff":    deff = param; return;
        // breaks
        case "par": case "sect": case "page":
            endPara(); return;
        case "line":
            flush(); emitObj({ type:"br" }); return;
        case "tab":
            flush(); emitText("\t"); return;
        case "cell": case "nestcell":
            endCell(); return;
        case "row": case "nestrow":
            endRow(); return;
        // paragraph formatting
        case "pard":  st.par = defaultPara(); return;
        case "ql":    pp.align = ""; return;
        case "qc":    pp.align = "center"; return;
        case "qr":    pp.align = "right"; return;
        case "qj":    pp.align = "justify"; return;
        case "li":    pp.li = param; return;
        case "fi":    pp.fi = param; return;
        case "intbl": pp.intbl = true; return;
        case "outlinelevel": pp.outline = param; return;
        case "ilvl":  pp.ilvl = param; return;
        case "ls":    pp.ls = param; return;
        case "brdrb": pp.brdrb = true; return;
        // character formatting
        case "plain":
            var link = c.link;
            st.chr = defaultChar(); st.chr.link = link; return;
        case "b":      c.b = !hasParam || param !== 0; return;
        case "i":      c.i = !hasParam || param !== 0; return;
        case "strike": case "striked":
                       c.s = !hasParam || param !== 0; return;
        case "ulnone": c.u = false; return;
        case "super":  c.sup = true; c.sub = false; return;
        case "sub":    c.sub = true; c.sup = false; return;
        case "nosupersub": c.sup = c.sub = false; return;
        case "v":      c.v = !hasParam || param !== 0; return;
        case "fs":     c.fs = hasParam ? param : 24; return;
        case "f":      c.f = param; return;
        case "cf":     c.cf = param; return;
        case "cb": case "highlight": case "chcbpat":
                       c.bg = param; return;
        }
        if (/^ul(d|dash|dashd|dashdd|db|hwave|ldash|th|thd|thdash|thdashd|thdashdd|thldash|w|wave)?$/.test(word)){
            c.u = !hasParam || param !== 0;
            return;
        }
        if (SYMBOLS.hasOwnProperty(word)){ flush(); emitText(SYMBOLS[word]); }
    }

    // ── tokenizer ──
    var i = 0, n = src.length;
    while (i < n){
        var ch = src.charAt(i), code = src.charCodeAt(i);
        if (ch === "{"){
            flush();
            stack.push(st);
            st = { dest:st.dest, chr:copy(st.chr), par:copy(st.par), uc:st.uc, field:st.field,
                   font:st.font, pict:st.pict };
            i++;
            continue;
        }
        if (ch === "}"){
            endGroup(); star = false; i++;
            continue;
        }
        if (ch === "\\"){
            var nx = src.charAt(i + 1);
            if (/[a-zA-Z]/.test(nx)){
                var j = i + 1;
                while (j < n && /[a-zA-Z]/.test(src.charAt(j))) j++;
                var word = src.substring(i + 1, j);
                var k = j;
                if (src.charAt(k) === "-" && /[0-9]/.test(src.charAt(k + 1))) k++;
                while (k < n && /[0-9]/.test(src.charAt(k))) k++;
                var hasParam = k > j;
                var param = hasParam ? parseInt(src.substring(j, k), 10) : 0;
                if (src.charAt(k) === " ") k++;
                i = k;
                if (word !== "u") flush();
                if (word === "bin"){                     // raw binary data follows
                    var data = src.substr(i, param);
                    if (st.dest === "pict" && st.pict) st.pict.bin = data;
                    i += param;
                    continue;
                }
                control(word, param, hasParam);
                continue;
            }
            i += 2;
            switch (nx){
            case "'":
                var hb = parseInt(src.substr(i, 2), 16);
                i += 2;
                if (st.dest === "skip" || st.dest === "pn" || st.dest === "pict" || isNaN(hb)) break;
                if (st.dest === "colortbl") break;
                emitByte(hb);
                break;
            case "*": star = true; break;
            case "~": flush(); if (skipChars > 0) skipChars--; else emitText("\u00A0"); break;
            case "_": flush(); if (skipChars > 0) skipChars--; else emitText("\u2011"); break;
            case "-": break;                             // optional hyphen
            case "\n": case "\r": flush(); if (st.dest === "main") endPara(); break;
            case "\\": case "{": case "}":
                if (st.dest === "skip" || st.dest === "pn") break;
                emitByte(nx.charCodeAt(0)); break;
            }
            continue;
        }
        i++;
        if (ch === "\r" || ch === "\n") continue;
        if (st.dest === "skip" || st.dest === "pn") continue;
        if (st.dest === "pict"){ st.pict.hex += ch; continue; }
        if (st.dest === "colortbl"){
            if (ch === ";"){ colors.push(color); color = null; }
            continue;
        }
        if (st.dest === "fonttbl" && ch === ";"){
            flush();
            if (st.font){ st.font.raw += ";"; finishFont(st.font); }
            continue;
        }
        if (code > 0xFF){ flush(); if (skipChars > 0) skipChars--; else emitText(ch); continue; }
        emitByte(code);
    }
    flush();
    if (para.runs.length) endPara();
    closeTable();
    return { blocks:blocks, fonts:fonts, colors:colors, deff:deff };
}

// ── model → HTML ─────────────────────────────────────────────────────────
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function escAttr(s){ return esc(s).replace(/"/g, "&quot;"); }
function colorCss(c){
    if (!c) return "";
    function h(v){ return ("0" + (v & 255).toString(16)).slice(-2); }
    return "#" + h(c.r) + h(c.g) + h(c.b);
}
var GENERIC = { roman:"serif", swiss:"sans-serif", modern:"monospace", script:"cursive", decor:"fantasy" };

function toHTML(src){
    src = src || "";
    if (!/^\s*\{\\rtf/.test(src)){
        // not RTF (e.g. a brand-new empty file) — show it as plain paragraphs
        var lines = src.replace(/\r\n?/g, "\n").split("\n");
        return { html: lines.map(function(l){ return "<p>" + (l ? esc(l) : "<br>") + "</p>"; }).join(""),
                 baseSize:24, baseFont:"" };
    }
    var doc = parse(src);

    // dominant size / font become the document base (no inline style)
    var sizeW = {}, fontW = {};
    doc.blocks.forEach(function scan(b){
        if (b.type === "table"){ b.rows.forEach(function(r){ r.forEach(function(c){ c.forEach(scan); }); }); return; }
        if (b.pp && b.pp.outline >= 0 && b.pp.outline <= 5) return;
        b.runs.forEach(function(r){
            if (r.type !== "text") return;
            var len = r.text.length, f = r.chr.f < 0 ? doc.deff : r.chr.f;
            sizeW[r.chr.fs] = (sizeW[r.chr.fs] || 0) + len;
            fontW[f] = (fontW[f] || 0) + len;
        });
    });
    function top(w, d){ var best = d, bw = -1; for (var k in w) if (w[k] > bw){ bw = w[k]; best = +k; } return best; }
    var baseSize = top(sizeW, 24), baseFontIdx = top(fontW, doc.deff);
    var baseFont = doc.fonts[baseFontIdx] ? doc.fonts[baseFontIdx].name : "";

    function fontCss(idx){
        var f = doc.fonts[idx];
        if (!f || !f.name) return "";
        var gen = GENERIC[f.family];
        return "'" + f.name.replace(/'/g, "") + "'" + (gen ? ", " + gen : "");
    }

    function runsHTML(runs, heading){
        var html = "", openLink = null, buf = "";
        function closeLink(){
            if (openLink !== null){ html += '<a href="' + escAttr(openLink) + '">' + buf + "</a>"; buf = ""; openLink = null; }
        }
        runs.forEach(function(r){
            var c = r.chr, piece;
            if (r.type === "br") piece = "<br>";
            else if (r.type === "img"){
                piece = '<img src="' + r.src + '" alt=""' + (r.w ? ' width="' + r.w + '"' : "") + ">";
            } else {
                piece = esc(r.text);
                var style = [];
                var fi = c.f < 0 ? doc.deff : c.f;
                if (!heading && c.fs !== baseSize) style.push("font-size:" + (c.fs / 2) + "pt");
                if (fi !== baseFontIdx){ var fc = fontCss(fi); if (fc) style.push("font-family:" + fc); }
                if (c.cf > 0 && doc.colors[c.cf]) style.push("color:" + colorCss(doc.colors[c.cf]));
                if (c.bg > 0 && doc.colors[c.bg]) style.push("background-color:" + colorCss(doc.colors[c.bg]));
                if (style.length) piece = '<span style="' + escAttr(style.join(";")) + '">' + piece + "</span>";
                if (c.sup) piece = "<sup>" + piece + "</sup>";
                if (c.sub) piece = "<sub>" + piece + "</sub>";
                if (c.s)   piece = "<s>" + piece + "</s>";
                if (c.u && !c.link) piece = "<u>" + piece + "</u>";
                if (c.i)   piece = "<i>" + piece + "</i>";
                if (c.b && !heading) piece = "<b>" + piece + "</b>";
            }
            if (c.link !== openLink){ closeLink(); if (c.link) openLink = c.link; }
            if (openLink !== null) buf += piece; else html += piece;
        });
        closeLink();
        return html;
    }
    function blockStyle(pp, list){
        var s = [];
        if (pp.align) s.push("text-align:" + pp.align);
        if (!list){
            if (pp.li > 0) s.push("margin-left:" + Math.round(pp.li / 15) + "px");
            if (pp.fi) s.push("text-indent:" + Math.round(pp.fi / 15) + "px");
        }
        return s.length ? ' style="' + s.join(";") + '"' : "";
    }
    function isBlank(p){
        return !p.runs.some(function(r){ return r.type !== "text" || /\S/.test(r.text.replace(/\u00A0/g, "x")); });
    }
    function paraHTML(p){
        var pp = p.pp || defaultPara();
        if (pp.brdrb && isBlank(p)) return "<hr>";
        var tag = (pp.outline >= 0 && pp.outline <= 5) ? "h" + (pp.outline + 1) : "p";
        var inner = runsHTML(p.runs, tag !== "p");
        return "<" + tag + blockStyle(pp) + ">" + (inner || "<br>") + "</" + tag + ">";
    }
    function isList(p){ return p.type !== "table" && (p.marker || p.listType || (p.pp && p.pp.ls > 0)); }
    function listLevel(p){
        if (p.pp.ilvl >= 0) return p.pp.ilvl;
        return Math.max(0, Math.round(p.pp.li / 720) - 1);
    }
    function listKind(p){
        if (p.listType) return p.listType;
        return /^\s*([0-9]+|[a-zA-Z]|[ivxlcIVXLC]+)[.)]/.test(p.marker) ? "ol" : "ul";
    }
    function tableHTML(t){
        var html = "<table><tbody>";
        t.rows.forEach(function(r){
            html += "<tr>";
            r.forEach(function(c){
                var cellHTML = c.map(function(p){ return runsHTML(p.runs, false); }).join("<br>");
                html += "<td>" + (cellHTML || "<br>") + "</td>";
            });
            html += "</tr>";
        });
        return html + "</tbody></table>";
    }

    var out = "", bl = doc.blocks;
    for (var i = 0; i < bl.length; i++){
        var b = bl[i];
        if (b.type === "table"){ out += tableHTML(b); continue; }
        if (!isList(b)){ out += paraHTML(b); continue; }
        // a run of list paragraphs → nested <ul>/<ol>
        var stackL = [];                 // open list tags
        var j = i;
        for (; j < bl.length && isList(bl[j]); j++){
            var p = bl[j], lvl = Math.min(listLevel(p), 8), kind = listKind(p);
            while (stackL.length > lvl + 1){ out += "</li></" + stackL.pop() + ">"; }
            if (stackL.length === lvl + 1 && stackL[lvl] !== kind){ out += "</li></" + stackL.pop() + ">"; }
            if (stackL.length === lvl + 1) out += "</li>";
            while (stackL.length < lvl + 1){ out += "<" + kind + ">"; stackL.push(kind); }
            out += "<li" + blockStyle(p.pp, true) + ">" + (runsHTML(p.runs, false) || "<br>");
        }
        while (stackL.length) out += "</li></" + stackL.pop() + ">";
        i = j - 1;
    }
    return { html: out || "<p><br></p>", baseSize: baseSize, baseFont: baseFont };
}

// ════════════════════════════════════════════════════════════════════════
// Writer
// ════════════════════════════════════════════════════════════════════════
var HEAD_SCALE = { H1:2, H2:1.6, H3:1.3, H4:1.1, H5:1, H6:0.9 };
var FONT_SIZE_ATTR = { 1:8, 2:10, 3:12, 4:14, 5:18, 6:24, 7:36 };
var BLOCK_TAGS = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|HR|SECTION|ARTICLE|FIGURE|HEADER|FOOTER|ASIDE|NAV|ADDRESS|DL|DT|DD)$/;
var MONO = "Courier New";

function parseColor(v){
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    if (v === "transparent" || v === "inherit" || v === "initial" || v === "currentcolor") return null;
    var m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m){
        var h = m[1];
        if (h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
        return { r:parseInt(h.substr(0,2),16), g:parseInt(h.substr(2,2),16), b:parseInt(h.substr(4,2),16) };
    }
    m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m){
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
        return { r:+m[1], g:+m[2], b:+m[3] };
    }
    // named colours: let the browser resolve them
    try {
        var cv = document.createElement("canvas").getContext("2d");
        cv.fillStyle = "#000001"; cv.fillStyle = v;
        if (cv.fillStyle !== "#000001") return parseColor(cv.fillStyle);
    } catch(e){}
    return null;
}
function firstFamily(v){
    if (!v) return "";
    var f = String(v).split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    var g = f.toLowerCase();
    if (g === "monospace") return MONO;
    if (g === "serif") return "Times New Roman";
    if (g === "sans-serif" || g === "system-ui" || g === "-apple-system" || g === "inherit") return "";
    return f;
}
// CSS font-size → half-points (relative sizes resolve against the current size)
function sizeHalfPts(v, cur){
    if (!v) return 0;
    var m = String(v).trim().match(/^([\d.]+)(pt|px|em|rem|%)?$/i);
    if (!m) return 0;
    var n = parseFloat(m[1]), unit = (m[2] || "px").toLowerCase();
    var pt = unit === "pt" ? n : unit === "px" ? n * 0.75 : unit === "%" ? cur / 2 * n / 100 : cur / 2 * n;
    return Math.max(2, Math.round(pt * 2));
}

function fromHTML(root, opts){
    opts = opts || {};
    var base = opts.baseSize || 24;
    var fonts = [opts.baseFont || "Calibri"], fontIdx = {};
    fontIdx[fonts[0].toLowerCase()] = 0;
    var colors = [], colorIdx = {};
    var out = [];

    function fontNo(name){
        if (!name) return 0;
        var k = name.toLowerCase();
        if (fontIdx[k] === undefined){ fontIdx[k] = fonts.length; fonts.push(name); }
        return fontIdx[k];
    }
    function colorNo(c){
        if (!c) return 0;
        var k = c.r + "," + c.g + "," + c.b;
        if (colorIdx[k] === undefined){ colors.push(c); colorIdx[k] = colors.length; }
        return colorIdx[k];
    }
    function escText(s){
        var r = "";
        for (var i = 0; i < s.length; i++){
            var c = s.charCodeAt(i), ch = s.charAt(i);
            if (ch === "\\" || ch === "{" || ch === "}") r += "\\" + ch;
            else if (ch === "\t") r += "\\tab ";
            else if (ch === "\n") r += "\\line ";
            else if (c === 0xA0) r += "\\~";
            else if (c === 0x200B || c === 0xFEFF || c === 0x0D) continue;
            else if (c < 0x20) continue;
            else if (c < 0x80) r += ch;
            else r += "\\u" + (c > 32767 ? c - 65536 : c) + "?";
        }
        return r;
    }

    // ── inline content → list of items ──
    function fmtOf(el, f){
        var n = copy(f), tag = el.tagName;
        if (tag === "B" || tag === "STRONG") n.b = true;
        else if (tag === "I" || tag === "EM" || tag === "CITE") n.i = true;
        else if (tag === "U" || tag === "INS") n.u = true;
        else if (tag === "S" || tag === "STRIKE" || tag === "DEL") n.s = true;
        else if (tag === "SUP"){ n.sup = true; n.sub = false; }
        else if (tag === "SUB"){ n.sub = true; n.sup = false; }
        else if (tag === "CODE" || tag === "KBD" || tag === "TT" || tag === "SAMP") n.font = MONO;
        else if (tag === "MARK") n.bg = n.bg || { r:255, g:255, b:0 };
        if (tag === "FONT"){
            var fc = parseColor(el.getAttribute("color")); if (fc) n.color = fc;
            var ff = firstFamily(el.getAttribute("face")); if (ff) n.font = ff;
            var fz = FONT_SIZE_ATTR[el.getAttribute("size")]; if (fz) n.size = fz * 2;
        }
        var s = el.style;
        if (s){
            if (s.fontWeight){ n.b = s.fontWeight === "bold" || s.fontWeight === "bolder" || parseInt(s.fontWeight, 10) >= 600; }
            if (s.fontStyle){ n.i = s.fontStyle === "italic" || s.fontStyle === "oblique"; }
            var td = s.textDecorationLine || s.textDecoration || "";
            if (td.indexOf("underline") >= 0) n.u = true;
            if (td.indexOf("line-through") >= 0) n.s = true;
            if (td === "none"){ n.u = false; n.s = false; }
            if (s.verticalAlign === "super"){ n.sup = true; n.sub = false; }
            if (s.verticalAlign === "sub"){ n.sub = true; n.sup = false; }
            if (s.fontSize){ var hp = sizeHalfPts(s.fontSize, n.size || base); if (hp) n.size = hp; }
            if (s.fontFamily){ var fam = firstFamily(s.fontFamily); if (fam) n.font = fam; }
            if (s.color){ var col = parseColor(s.color); if (col) n.color = col; }
            if (s.backgroundColor){
                var bg = parseColor(s.backgroundColor);
                n.bg = bg;                                  // transparent clears it
            }
        }
        return n;
    }
    function collect(nodes, f, items){
        for (var i = 0; i < nodes.length; i++){
            var nd = nodes[i];
            if (nd.nodeType === 3){
                var t = nd.nodeValue.replace(/\u200B/g, "");
                if (t) items.push({ t:"text", text:t, f:f });
                continue;
            }
            if (nd.nodeType !== 1) continue;
            var tag = nd.tagName;
            if (tag === "BR"){ items.push({ t:"br" }); continue; }
            if (tag === "IMG"){ items.push({ t:"img", el:nd, f:f }); continue; }
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "SELECT") continue;
            if (tag === "A" && nd.getAttribute("href")){
                var sub = [];
                collect(nd.childNodes, fmtOf(nd, f), sub);
                items.push({ t:"link", url:nd.getAttribute("href"), items:sub });
                continue;
            }
            if (BLOCK_TAGS.test(tag)){                      // stray block inside inline flow
                collect(nd.childNodes, f, items);
                items.push({ t:"br" });
                continue;
            }
            collect(nd.childNodes, fmtOf(nd, f), items);
        }
    }
    function fmtCodes(f, extra){
        var c = "";
        if (f.b) c += "\\b";
        if (f.i) c += "\\i";
        if (f.u) c += "\\ul";
        if (f.s) c += "\\strike";
        if (f.sup) c += "\\super";
        if (f.sub) c += "\\sub";
        if (f.font) c += "\\f" + fontNo(f.font);
        if (f.size && f.size !== base) c += "\\fs" + f.size;
        if (f.color) c += "\\cf" + colorNo(f.color);
        if (f.bg) c += "\\highlight" + colorNo(f.bg);
        return c + (extra || "");
    }
    function itemsRTF(items){
        // drop the trailing placeholder <br> contenteditable leaves in a line
        while (items.length && items[items.length - 1].t === "br") items.pop();
        var r = "", i = 0;
        while (i < items.length){
            var it = items[i];
            if (it.t === "br"){ r += "\\line "; i++; continue; }
            if (it.t === "img"){ r += pictRTF(it.el); i++; continue; }
            if (it.t === "link"){
                r += "{\\field{\\*\\fldinst{HYPERLINK \"" + escText(it.url).replace(/"/g, "%22") + "\"}}{\\fldrslt{\\ul\\cf" +
                     colorNo({ r:5, g:99, b:193 }) + " " + itemsRTF(it.items.slice()) + "}}}";
                i++; continue;
            }
            // merge consecutive text items with the same formatting
            var codes = fmtCodes(it.f), text = it.text;
            i++;
            while (i < items.length && items[i].t === "text" && fmtCodes(items[i].f) === codes){ text += items[i].text; i++; }
            r += codes ? "{" + codes + " " + escText(text) + "}" : escText(text);
        }
        return r;
    }
    function pictRTF(img){
        var src = img.getAttribute("src") || "";
        var m = src.match(/^data:image\/(png|jpe?g);base64,(.*)$/i);
        if (!m) return "";
        var bin;
        try { bin = atob(m[2]); } catch(e){ return ""; }
        var hex = [];
        for (var i = 0; i < bin.length; i++){
            hex.push(("0" + bin.charCodeAt(i).toString(16)).slice(-2));
            if (i % 64 === 63) hex.push("\r\n");
        }
        var natW = +img.getAttribute("data-natw") || +img.getAttribute("width") || 300;
        var natH = +img.getAttribute("data-nath") || +img.getAttribute("height") || 150;
        var dispW = +img.getAttribute("width") || parseFloat(img.style.width) || natW;
        var dispH = +img.getAttribute("height") || parseFloat(img.style.height) || Math.round(natH * dispW / natW);
        if (dispW > 624){ dispH = Math.round(dispH * 624 / dispW); dispW = 624; }
        var type = /png/i.test(m[1]) ? "\\pngblip" : "\\jpegblip";
        return "{\\pict" + type + "\\picw" + natW + "\\pich" + natH + "\\picwgoal" + Math.round(dispW * 15) +
               "\\pichgoal" + Math.round(dispH * 15) + "\r\n" + hex.join("") + "}";
    }

    // ── blocks ──
    function alignOf(el, inherited){
        var a = (el.style && el.style.textAlign) || el.getAttribute("align") || "";
        a = a.toLowerCase();
        if (a === "center") return "\\qc";
        if (a === "right" || a === "end") return "\\qr";
        if (a === "justify") return "\\qj";
        if (a === "left" || a === "start") return "";
        return inherited || "";
    }
    function indentOf(el){
        var ml = el.style ? el.style.marginLeft : "";
        var m = ml && ml.match(/^([\d.]+)(px|pt)?$/);
        return m ? Math.round(parseFloat(m[1]) * (m[2] === "pt" ? 20 : 15)) : 0;
    }
    function textIndentOf(el){
        var ti = el.style ? el.style.textIndent : "";
        var m = ti && ti.match(/^(-?[\d.]+)(px|pt)?$/);
        return m ? Math.round(parseFloat(m[1]) * (m[2] === "pt" ? 20 : 15)) : 0;
    }
    function para(nodes, ctx, opt){
        opt = opt || {};
        var f = { b:false, i:false, u:false, s:false, sup:false, sub:false };
        if (opt.font) f.font = opt.font;
        if (ctx.bold) f.b = true;
        if (opt.heading){ f.b = true; f.size = Math.round(base * HEAD_SCALE[opt.heading] / 2) * 2; }
        var items = [];
        collect(nodes, f, items);
        var head = "\\pard" + (ctx.intbl ? "\\intbl" : "") + (opt.align || "");
        var li = (ctx.indent || 0) + (opt.li || 0);
        if (li) head += "\\li" + li;
        if (opt.fi) head += "\\fi" + opt.fi;
        if (opt.heading) head += "\\outlinelevel" + (parseInt(opt.heading.charAt(1), 10) - 1) + "\\sb240";
        head += "\\sa" + (opt.sa === undefined ? 120 : opt.sa) + "\\plain\\f0\\fs" + base + " ";
        out.push(head + (opt.prefix || "") + itemsRTF(items) + (opt.end || "\\par") + "\r\n");
    }
    function hasContent(nodes){
        for (var i = 0; i < nodes.length; i++){
            var n = nodes[i];
            if (n.nodeType === 3 && n.nodeValue.replace(/[\u200B\s]/g, "") !== "") return true;
            if (n.nodeType === 1) return true;
        }
        return false;
    }
    function container(el, ctx){
        var buf = [];
        function flushInline(){
            if (buf.length && hasContent(buf)) para(buf, ctx, { align:ctx.align });
            buf = [];
        }
        for (var i = 0; i < el.childNodes.length; i++){
            var c = el.childNodes[i];
            if (c.nodeType === 1 && BLOCK_TAGS.test(c.tagName)){ flushInline(); block(c, ctx); }
            else buf.push(c);
        }
        flushInline();
    }
    function hasBlockChild(el){
        for (var i = 0; i < el.children.length; i++) if (BLOCK_TAGS.test(el.children[i].tagName)) return true;
        return false;
    }
    function block(el, ctx){
        var tag = el.tagName, align = alignOf(el, ctx.align);
        if (/^H[1-6]$/.test(tag)){ para(el.childNodes, ctx, { align:align, heading:tag }); return; }
        if (tag === "HR"){ out.push("\\pard" + (ctx.intbl ? "\\intbl" : "") + "\\brdrb\\brdrs\\brdrw10\\brsp20\\sa120\\plain\\f0\\fs" + base + " \\par\r\n"); return; }
        if (tag === "PRE"){
            var lines = (el.textContent || "").replace(/\u200B/g, "").replace(/\n$/, "").split("\n");
            lines.forEach(function(ln, k){
                var tn = document.createTextNode(ln);
                para([tn], ctx, { font:MONO, sa:(k === lines.length - 1 ? 120 : 0) });
            });
            return;
        }
        if (tag === "UL" || tag === "OL"){ list(el, ctx); return; }
        if (tag === "BLOCKQUOTE"){
            container(el, { indent:(ctx.indent || 0) + 720, align:align, intbl:ctx.intbl, level:ctx.level });
            return;
        }
        if (tag === "TABLE"){ table(el, ctx); return; }
        if (tag === "P" || tag === "DT" || tag === "DD" || !hasBlockChild(el)){
            para(el.childNodes, ctx, { align:align, li:indentOf(el), fi:textIndentOf(el) });
            return;
        }
        container(el, { indent:(ctx.indent || 0) + indentOf(el), align:align, intbl:ctx.intbl, level:ctx.level });
    }
    function list(el, ctx){
        var ordered = el.tagName === "OL";
        var level = (ctx.level === undefined ? -1 : ctx.level) + 1;
        var num = parseInt(el.getAttribute("start"), 10) || 1;
        var li = 720 * (level + 1);
        for (var i = 0; i < el.children.length; i++){
            var item = el.children[i];
            if (item.tagName !== "LI"){ block(item, ctx); continue; }
            var marker = ordered ? (num++) + "." : "\\u8226?";
            var pn = ordered
                ? "{\\*\\pn\\pnlvlbody\\pndec\\pnstart1\\pnindent360{\\pntxta.}}"
                : "{\\*\\pn\\pnlvlblt\\pnf" + fontNo("Symbol") + "\\pnindent360{\\pntxtb\\'B7}}";
            var prefix = "{\\listtext\\pard\\plain\\f0\\fs" + base + " " + marker + "\\tab}" + pn;
            var sub = { indent:ctx.indent, align:ctx.align, intbl:ctx.intbl, level:level };
            // the item's own text runs up to its first block child
            var inline = [], rest = [];
            for (var k = 0; k < item.childNodes.length; k++){
                var c = item.childNodes[k];
                if (rest.length || (c.nodeType === 1 && BLOCK_TAGS.test(c.tagName))) rest.push(c);
                else inline.push(c);
            }
            if (!hasContent(inline) && rest.length && /^(P|DIV)$/.test(rest[0].tagName)){
                inline = Array.prototype.slice.call(rest.shift().childNodes);
            }
            para(inline, ctx, { align:alignOf(item, ctx.align), li:li, fi:-360, sa:40, prefix:prefix });
            rest.forEach(function(c){
                if (c.tagName === "UL" || c.tagName === "OL") list(c, sub);
                else block(c, { indent:(ctx.indent || 0) + li, align:ctx.align, intbl:ctx.intbl, level:level });
            });
        }
    }
    function table(el, ctx){
        var rows = el.querySelectorAll("tr");
        for (var r = 0; r < rows.length; r++){
            var cells = [];
            for (var c = 0; c < rows[r].children.length; c++){
                if (/^T[DH]$/.test(rows[r].children[c].tagName)) cells.push(rows[r].children[c]);
            }
            if (!cells.length) continue;
            var w = Math.floor(9000 / cells.length), def = "\\trowd\\trgaph108\\trleft0";
            for (var k = 0; k < cells.length; k++){
                def += "\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx" + (w * (k + 1));
            }
            out.push(def + "\r\n");
            for (var k2 = 0; k2 < cells.length; k2++){
                var cell = cells[k2], isHead = cell.tagName === "TH";
                var start = out.length;
                var cctx = { intbl:true, align:alignOf(cell, ""), bold:isHead };
                if (hasBlockChild(cell)) container(cell, cctx);
                else para(cell.childNodes, cctx, { align:cctx.align, sa:0 });
                if (out.length === start) para([], cctx, { sa:0 });
                // the cell's last paragraph ends with \cell instead of \par
                out[out.length - 1] = out[out.length - 1].replace(/\\par\r\n$/, "\\cell\r\n");
            }
            out.push(def + "\\row\r\n");
        }
    }

    container(root, { indent:0, align:"" });

    var ft = "{\\fonttbl";
    fonts.forEach(function(name, i){
        var fam = name === MONO ? "\\fmodern" : name === "Symbol" ? "\\ftech" : "\\fnil";
        var cs = name === "Symbol" ? 2 : (/[^\x00-\x7f]/.test(name) ? 1 : 0);
        ft += "{\\f" + i + fam + "\\fcharset" + cs + " " + escText(name) + ";}";
    });
    ft += "}";
    var ct = "{\\colortbl ;";
    colors.forEach(function(c){ ct += "\\red" + c.r + "\\green" + c.g + "\\blue" + c.b + ";"; });
    ct += "}";
    return "{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat" + ft + "\r\n" + ct + "\r\n" +
           "{\\*\\generator ArozOS Text;}\\viewkind4\\uc1\r\n" + out.join("") + "}\r\n";
}

// ════════════════════════════════════════════════════════════════════════
// Image preparation (async)
// ════════════════════════════════════════════════════════════════════════
function blobToDataURL(blob){
    return new Promise(function(res, rej){
        var fr = new FileReader();
        fr.onload = function(){ res(fr.result); };
        fr.onerror = rej;
        fr.readAsDataURL(blob);
    });
}
function loadImage(src){
    return new Promise(function(res, rej){
        var im = new Image();
        im.onload = function(){ res(im); };
        im.onerror = function(){ rej(new Error("image load failed")); };
        im.src = src;
    });
}
function inlineOne(img){
    var src = img.getAttribute("src") || "";
    var p = /^data:image\/(png|jpe?g);/i.test(src)
        ? Promise.resolve(src)
        : fetch(src, { credentials:"same-origin" }).then(function(r){
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.blob();
          }).then(function(b){
              if (/^image\/(png|jpe?g)$/i.test(b.type)) return blobToDataURL(b);
              // other formats (gif/webp/svg/bmp) are re-encoded as PNG
              var url = URL.createObjectURL(b);
              return loadImage(url).then(function(im){
                  URL.revokeObjectURL(url);
                  var cv = document.createElement("canvas");
                  cv.width = im.naturalWidth || 300; cv.height = im.naturalHeight || 150;
                  cv.getContext("2d").drawImage(im, 0, 0);
                  return cv.toDataURL("image/png");
              });
          }).then(function(d){
              // sniff the real format: a mislabelled blob still needs png/jpeg bytes
              return d.replace(/^data:[^;,]*;/, function(){
                  var head = atob(d.split(",")[1].substr(0, 8));
                  return head.charCodeAt(0) === 0xFF ? "data:image/jpeg;" : "data:image/png;";
              });
          });
    return p.then(function(d){
        img.setAttribute("src", d);
        return loadImage(d).then(function(im){
            img.setAttribute("data-natw", im.naturalWidth);
            img.setAttribute("data-nath", im.naturalHeight);
        });
    }).catch(function(){
        img.parentNode && img.parentNode.removeChild(img);   // unreachable image: leave it out
    });
}
function inlineImages(root){
    var imgs = Array.prototype.slice.call(root.querySelectorAll("img"));
    return Promise.all(imgs.map(inlineOne)).then(function(){ return root; });
}

window.TextRTF = { toHTML:toHTML, fromHTML:fromHTML, inlineImages:inlineImages, parse:parse };
})();
