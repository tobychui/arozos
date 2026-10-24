/*
    PDF Editor - fonts and text layout

    A text object names a font by key: "helv", "times" or "cour" (the PDF
    standard fonts, which every reader has and which cost nothing to use)
    or "lib:<family>" for a family of the ArozOS system font library
    (System Settings > System Fonts), which is drawn on screen from the
    library's web font slices and embedded in the saved PDF when its
    licence allows.

    Layout is shared by the screen and the saved file, so both break the
    lines at the same places:
        line i baseline = pad + 0.8 * size + i * size * lh
        box height      = pad + 0.8 * size + (n - 1) * size * lh + 0.25 * size + pad
    Widths of the standard fonts come from pdf-lib's own metrics (the same
    numbers the PDF uses); everything else is measured on a canvas.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var STD = {
        helv: {
            label: 'Helvetica',
            css: 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif',
            pdf: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique']
        },
        times: {
            label: 'Times',
            css: '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif',
            pdf: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic']
        },
        cour: {
            label: 'Courier',
            css: '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", monospace',
            pdf: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique']
        }
    };

    var LIB = {};           //family -> {name, faces:[{weightMin, weightMax, italic, embed, file, variable}]}
    var libBase = '';
    var libLoaded = null;

    var F = PE.fonts = {
        STD: STD,
        PAD: 2
    };

    F.isStd = function (key) {
        return Object.prototype.hasOwnProperty.call(STD, key);
    };

    F.libFamily = function (key) {
        return String(key || '').indexOf('lib:') === 0 ? key.substring(4) : '';
    };

    F.label = function (key) {
        if (F.isStd(key)) {
            return STD[key].label;
        }
        return F.libFamily(key) || key;
    };

    F.css = function (key) {
        if (F.isStd(key)) {
            return STD[key].css;
        }
        var fam = F.libFamily(key);
        if (fam) {
            return '"' + fam.replace(/"/g, '') + '", ' + STD.helv.css;
        }
        return STD.helv.css;
    };

    F.list = function () {
        var out = [];
        Object.keys(STD).forEach(function (k) {
            out.push({ key: k, label: STD[k].label });
        });
        Object.keys(LIB).sort().forEach(function (fam) {
            out.push({ key: 'lib:' + fam, label: fam, lib: true });
        });
        return out;
    };

    /* System font library: register its faces for the screen (slices) */
    F.loadLibrary = function () {
        if (libLoaded) {
            return libLoaded;
        }
        libLoaded = new Promise(function (resolve) {
            if (!PE.hasBackend) {
                resolve();
                return;
            }
            fetch(PE.root() + 'system/fonts/faces', { credentials: 'same-origin' }).then(function (r) {
                return r.ok ? r.json() : null;
            }).then(function (data) {
                if (!data || !data.families) {
                    resolve();
                    return;
                }
                libBase = PE.root() + String(data.base || '/SystemAO/locale/fonts/').replace(/^\/+/, '');
                var css = '';
                data.families.forEach(function (fam) {
                    var name = String((fam && fam.name) || '').replace(/["\\<>]/g, '').trim();
                    if (!name || STD[name.toLowerCase()]) {
                        return;
                    }
                    var faces = [];
                    (fam.faces || []).forEach(function (f) {
                        if (!f || !/^[0-9a-f]{4,64}$/.test(f.key)) {
                            return;
                        }
                        var lo = Math.max(1, Math.min(1000, parseInt(f.weightMin, 10) || 400));
                        var hi = Math.max(lo, Math.min(1000, parseInt(f.weightMax, 10) || lo));
                        var face = {
                            weightMin: lo, weightMax: hi, italic: !!f.italic, variable: !!f.variable,
                            embed: !!f.embed && !f.variable && /^file\/[0-9a-f]{4,64}\.(ttf|otf)$/.test(f.file || ''),
                            file: f.file
                        };
                        faces.push(face);
                        var weight = lo === hi ? lo : lo + ' ' + hi;
                        (f.slices || []).forEach(function (s) {
                            if (!s || !/^[a-z0-9_-]{1,140}$/.test(s.name)) {
                                return;
                            }
                            var range = String(s.range || '');
                            if (range && !/^[uU0-9a-fA-F+\-?, ]+$/.test(range)) {
                                return;
                            }
                            css += '@font-face{font-family:"' + name + '";src:url("' + libBase + 'slice/' + f.key + '/' + s.name +
                                '.woff2") format("woff2");font-weight:' + weight + ';font-style:' + (face.italic ? 'italic' : 'normal') +
                                ';font-display:swap;' + (range ? 'unicode-range:' + range + ';' : '') + '}\n';
                        });
                    });
                    if (faces.length) {
                        LIB[name] = { name: name, faces: faces };
                    }
                });
                if (css) {
                    var st = document.createElement('style');
                    st.id = 'peLibraryFaces';
                    st.textContent = css;
                    document.head.appendChild(st);
                }
                resolve();
            }).catch(function () {
                resolve();
            });
        });
        return libLoaded;
    };

    //The library face to embed for a family, or null when none may be embedded
    F.libFace = function (family, bold, italic) {
        var lib = LIB[family];
        if (!lib) {
            return null;
        }
        var want = bold ? 700 : 400;
        var best = null, bestScore = 1e9;
        lib.faces.forEach(function (f) {
            if (!f.embed) {
                return;
            }
            var w = Math.max(f.weightMin, Math.min(f.weightMax, want));
            var score = Math.abs(w - want) + (f.italic === !!italic ? 0 : 500);
            if (score < bestScore) {
                bestScore = score;
                best = f;
            }
        });
        return best;
    };

    F.libFaceUrl = function (face) {
        return libBase + face.file;
    };

    F.libFamilies = function () {
        return Object.keys(LIB);
    };

    /* ------------------------------------------------------ measuring */
    var embedders = {};
    function stdEmbedder(key, bold, italic) {
        if (typeof PDFLib === 'undefined') {
            return null;
        }
        var idx = (bold ? 1 : 0) + (italic ? 2 : 0);
        var name = STD[key].pdf[idx];
        if (!embedders[name]) {
            try {
                embedders[name] = PDFLib.StandardFontEmbedder.for(PDFLib.StandardFonts[name]);
            } catch (e) {
                embedders[name] = null;
            }
        }
        return embedders[name];
    }

    F.stdFontName = function (key, bold, italic) {
        if (!F.isStd(key)) {
            key = 'helv';
        }
        return STD[key].pdf[(bold ? 1 : 0) + (italic ? 2 : 0)];
    };

    var mctx = null;
    function canvasWidth(key, bold, italic, size, text) {
        if (!mctx) {
            mctx = document.createElement('canvas').getContext('2d');
        }
        mctx.font = (italic ? 'italic ' : '') + (bold ? 'bold ' : '') + '100px ' + F.css(key);
        return mctx.measureText(text).width * size / 100;
    }

    //True when every character of text can be written in the standard font
    F.encodable = function (key, text) {
        if (!F.isStd(key)) {
            return false;
        }
        var e = stdEmbedder(key, false, false);
        if (!e) {
            return /^[\x20-\x7e\n\r\t]*$/.test(text);
        }
        try {
            e.encodeText(String(text).replace(/[\r\n\t]/g, ' '));
            return true;
        } catch (err) {
            return false;
        }
    };

    var wcache = {};
    var wcacheN = 0;
    F.measure = function (key, bold, italic, size, text) {
        if (!text) {
            return 0;
        }
        var ck = key + (bold ? 'b' : '') + (italic ? 'i' : '') + '|' + text;
        var w1 = wcache[ck];
        if (w1 === undefined) {
            w1 = null;
            if (F.isStd(key)) {
                var e = stdEmbedder(key, bold, italic);
                if (e) {
                    try {
                        var glyphs = e.encodeTextAsGlyphs(text);
                        var tot = 0;
                        for (var i = 0; i < glyphs.length; i++) {
                            tot += e.font.getWidthOfGlyph(glyphs[i].name) || 0;
                        }
                        w1 = tot / 1000;
                    } catch (err) {
                        w1 = null;
                    }
                }
            }
            if (w1 === null) {
                w1 = canvasWidth(key, bold, italic, 1, text);
            }
            if (wcacheN > 20000) {
                wcache = {};
                wcacheN = 0;
            }
            wcache[ck] = w1;
            wcacheN++;
        }
        return w1 * size;
    };

    /* ------------------------------------------------------- layout */
    var CJK = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

    function tokens(s) {
        //words keep their trailing spaces; every CJK character breaks on its own
        var out = [];
        var re = /([\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef][\s]*)|([^\s\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]+\s*)|(\s+)/g;
        var m;
        while ((m = re.exec(s)) !== null) {
            out.push(m[0]);
        }
        return out;
    }

    F.padOf = function (o) {
        return o.pad === undefined ? F.PAD : o.pad;
    };

    /*
        Lay a text object out: {lines:[{text, width}], width, height}
        o.wrap false: one line per paragraph, the box takes the widest line;
        o.wrap true: lines break to fit o.w.
    */
    F.layout = function (o) {
        var size = o.size || 12;
        var lh = o.lh || 1.2;
        var pad = F.padOf(o);
        var key = o.font || 'helv';
        var maxW = o.wrap ? Math.max(size * 0.6, (o.w || 0) - 2 * pad) : Infinity;
        var lines = [];
        var paras = String(o.text === undefined ? '' : o.text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
        function mw(t) {
            return F.measure(key, o.bold, o.italic, size, t);
        }
        paras.forEach(function (para) {
            if (maxW === Infinity || mw(para) <= maxW) {
                lines.push(para);
                return;
            }
            var cur = '';
            tokens(para).forEach(function (tk) {
                var next = cur + tk;
                if (mw(next.replace(/\s+$/, '')) <= maxW || cur === '') {
                    if (cur === '' && mw(tk.replace(/\s+$/, '')) > maxW) {
                        //a single word wider than the box: break it by characters
                        var chars = Array.from(tk);
                        var piece = '';
                        chars.forEach(function (ch) {
                            if (piece && mw((piece + ch).replace(/\s+$/, '')) > maxW) {
                                lines.push(piece);
                                piece = ch;
                            } else {
                                piece += ch;
                            }
                        });
                        cur = piece;
                    } else {
                        cur = next;
                    }
                } else {
                    lines.push(cur.replace(/\s+$/, ''));
                    cur = tk.replace(/^\s+/, '');
                }
            });
            lines.push(cur.replace(/\s+$/, ''));
        });
        var widths = lines.map(mw);
        var maxLine = widths.reduce(function (a, b) { return Math.max(a, b); }, 0);
        var width = o.wrap ? (o.w || maxLine + 2 * pad) : Math.max(size * 0.5, maxLine) + 2 * pad;
        var n = Math.max(1, lines.length);
        var height = pad + 0.8 * size + (n - 1) * size * lh + 0.25 * size + pad;
        return {
            lines: lines.map(function (t, i) {
                return { text: t, width: widths[i] };
            }),
            width: width,
            height: height,
            size: size,
            lh: lh,
            pad: pad
        };
    };

    F.baseline = function (L, i) {
        return L.pad + 0.8 * L.size + i * L.size * L.lh;
    };

    F.lineX = function (o, L, line) {
        var inner = L.width - 2 * L.pad;
        if (o.align === 'center') {
            return L.pad + (inner - line.width) / 2;
        }
        if (o.align === 'right') {
            return L.pad + inner - line.width;
        }
        return L.pad;
    };

    F.hasCJK = function (s) {
        return CJK.test(s);
    };

    /*
        Re-fit a text object after its text or style changed: the height
        always follows the text; without wrapping the width does too, and
        the box keeps its anchor (left, centre or right edge) in place.
    */
    F.fit = function (o) {
        var L = F.layout(o);
        var oldW = o.w || L.width;
        var oldH = o.h || L.height;
        var newW = o.wrap ? o.w : L.width;
        var newH = L.height;
        //the new centre, relative to the old one in the box's own axes, that
        //keeps the anchor edge and the top edge where they were
        var a = (o.angle || 0) * Math.PI / 180;
        var ox = 0;
        if (!o.wrap && o.align !== 'center') {
            ox = o.align === 'right' ? (oldW - newW) / 2 : (newW - oldW) / 2;
        }
        var oy = (newH - oldH) / 2;
        var cx = o.x + oldW / 2, cy = o.y + oldH / 2;
        cx += ox * Math.cos(a) - oy * Math.sin(a);
        cy += ox * Math.sin(a) + oy * Math.cos(a);
        o.w = newW;
        o.h = newH;
        o.x = cx - newW / 2;
        o.y = cy - newH / 2;
        return L;
    };
})(window.PE);
