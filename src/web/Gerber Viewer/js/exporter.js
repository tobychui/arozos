/*
    Gerber Viewer - exports

    SVG of the visible layers (vector, millimetre sized), saving blobs or text
    to the device or to ArozOS (through backend/export.agi), printing at
    actual size, and the drill table as CSV.
*/
(function (GV) {
    'use strict';

    var G = GV.geom;

    function n(v) {
        var s = (Math.round(v * 10000) / 10000).toString();
        return s === '-0' ? '0' : s;
    }

    function pathData(items, stroke) {
        var p = new G.SvgPath(4);
        items.forEach(function (it) {
            if (stroke) {
                G.emitStroke(p, it);
            } else {
                G.emitFill(p, it);
            }
        });
        return p.toString();
    }

    //One polarity group as SVG elements in the given colour
    function groupSVG(g, color, defs, uid) {
        var fills = [], strokes = new Map(), out = '';
        g.items.forEach(function (it) {
            if (it.t === 'l' || it.t === 'a') {
                if (!strokes.has(it.w)) {
                    strokes.set(it.w, []);
                }
                strokes.get(it.w).push(it);
            } else if (it.t === 'p' && it.clip) {
                var id = 'c' + uid.next++;
                var clip = new G.SvgPath(4);
                it.clip.forEach(function (c) { G.emitContour(clip, c); });
                defs.push('<clipPath id="' + id + '" clipPathUnits="userSpaceOnUse"><path d="' + clip + '"/></clipPath>');
                out += '<path clip-path="url(#' + id + ')" fill="' + color + '" d="' + pathData([it], false) + '"/>';
            } else {
                fills.push(it);
            }
        });
        if (fills.length) {
            out += '<path fill="' + color + '" d="' + pathData(fills, false) + '"/>';
        }
        strokes.forEach(function (list, w) {
            out += '<path fill="none" stroke="' + color + '" stroke-width="' + n(Math.max(w, 0.01)) + '" d="' + pathData(list, true) + '"/>';
        });
        return out;
    }

    /*
        layers: draw order, bottom first (only visible ones are written)
        bounds: [minX, minY, maxX, maxY] in mm
        o: {background, flip, title}
    */
    function svg(layers, bounds, o) {
        o = o || {};
        var b = bounds;
        var w = b[2] - b[0], h = b[3] - b[1];
        var defs = [];
        var body = [];
        var uid = { next: 1 };
        layers.forEach(function (layer, li) {
            if (!layer.visible || !layer.image || !layer.image.groups.length) {
                return;
            }
            var lb = layer.image.bounds;
            var parts = '';
            if (!layer.image.hasClear) {
                layer.image.groups.forEach(function (g) {
                    parts += groupSVG(g, layer.color, defs, uid);
                });
            } else {
                //Clear polarity: build a luminance mask, dark = white, clear = black
                var mid = 'm' + li + '_' + uid.next++;
                var mask = '';
                layer.image.groups.forEach(function (g) {
                    mask += groupSVG(g, g.dark ? '#fff' : '#000', defs, uid);
                });
                defs.push('<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="' + n(lb[0] - 1) + '" y="' + n(lb[1] - 1) + '" width="' +
                    n(lb[2] - lb[0] + 2) + '" height="' + n(lb[3] - lb[1] + 2) + '">' + mask + '</mask>');
                parts = '<rect mask="url(#' + mid + ')" fill="' + layer.color + '" x="' + n(lb[0] - 1) + '" y="' + n(lb[1] - 1) +
                    '" width="' + n(lb[2] - lb[0] + 2) + '" height="' + n(lb[3] - lb[1] + 2) + '"/>';
            }
            body.push('<g id="' + xmlId(layer.label) + '" opacity="' + n(layer.opacity) + '" stroke-linecap="round" stroke-linejoin="round">' + parts + '</g>');
        });
        var vbX = o.flip ? -b[2] : b[0];
        var transform = o.flip ? 'scale(-1,-1)' : 'scale(1,-1)';
        var out = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + n(w) + 'mm" height="' + n(h) + 'mm" viewBox="' +
            n(vbX) + ' ' + n(-b[3]) + ' ' + n(w) + ' ' + n(h) + '">\n' +
            (o.title ? '<title>' + escXml(o.title) + '</title>\n' : '') +
            (defs.length ? '<defs>' + defs.join('') + '</defs>\n' : '') +
            (o.background ? '<rect x="' + n(vbX) + '" y="' + n(-b[3]) + '" width="' + n(w) + '" height="' + n(h) + '" fill="' + o.background + '"/>\n' : '') +
            '<g transform="' + transform + '">\n' + body.join('\n') + '\n</g>\n</svg>\n';
        return out;
    }

    function escXml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function xmlId(s) {
        return String(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^([^A-Za-z_])/, '_$1');
    }

    function download(data, filename, mime) {
        var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    var HEX = [];
    for (var i = 0; i < 256; i++) {
        HEX.push((i < 16 ? '0' : '') + i.toString(16));
    }

    function toHex(bytes) {
        var parts = [];
        var CH = 32768;
        for (var o = 0; o < bytes.length; o += CH) {
            var end = Math.min(bytes.length, o + CH);
            var s = new Array(end - o);
            for (var j = o; j < end; j++) {
                s[j - o] = HEX[bytes[j]];
            }
            parts.push(s.join(''));
        }
        return parts.join('');
    }

    //Save text or binary data to an ArozOS virtual path through AGI
    function saveToAroz(path, data) {
        if (typeof data === 'string') {
            return GV.store.agiJSON('export.agi', { opr: 'writeText', path: path, content: data });
        }
        var p = data instanceof Blob ? data.arrayBuffer() : Promise.resolve(data.buffer ? data : new Uint8Array(data));
        return p.then(function (buf) {
            var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
            return GV.store.agiJSON('export.agi', { opr: 'writeBinary', path: path, hex: toHex(bytes) });
        });
    }

    function canvasBlob(canvas, type, quality) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (b) {
                if (b) {
                    resolve(b);
                } else {
                    reject(new Error(GV.ui.t('error/encode', 'The image is too large to encode.')));
                }
            }, type || 'image/png', quality);
        });
    }

    //Print an image at a physical size (mm) or fitted to the page
    function print(dataURL, widthMM, heightMM, title, fit) {
        var frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
        document.body.appendChild(frame);
        var landscape = widthMM > heightMM;
        var size = fit ? 'max-width:100%;max-height:100vh;object-fit:contain' :
            'width:' + widthMM.toFixed(3) + 'mm;height:' + heightMM.toFixed(3) + 'mm';
        var doc = frame.contentWindow.document;
        doc.open();
        doc.write('<!DOCTYPE html><html><head><title>' + escXml(title || 'Gerber Viewer') + '</title><style>' +
            '@page{size:' + (landscape ? 'landscape' : 'portrait') + ';margin:10mm}' +
            'html,body{margin:0;padding:0;background:#fff}img{display:block;' + size + '}' +
            '</style></head><body><img id="im"></body></html>');
        doc.close();
        var img = doc.getElementById('im');
        img.onload = function () {
            setTimeout(function () {
                frame.contentWindow.focus();
                frame.contentWindow.print();
                setTimeout(function () { frame.remove(); }, 2000);
            }, 60);
        };
        img.src = dataURL;
    }

    function csvCell(v) {
        var s = String(v === undefined || v === null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function drillCSV(layers) {
        var rows = [['File', 'Layer', 'Tool', 'Diameter (mm)', 'Diameter (in)', 'Plated', 'Holes', 'Slots']];
        layers.forEach(function (l) {
            if (l.type !== 'drill' || !l.image || !l.image.tools) {
                return;
            }
            l.image.tools.forEach(function (t) {
                rows.push([l.name, l.label, t.name, t.dia.toFixed(3), (t.dia / 25.4).toFixed(4),
                    t.plated === null ? 'unknown' : (t.plated ? 'yes' : 'no'), t.hits, t.slots]);
            });
        });
        return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
    }

    GV.exporter = {
        svg: svg,
        download: download,
        saveToAroz: saveToAroz,
        canvasBlob: canvasBlob,
        toHex: toHex,
        print: print,
        drillCSV: drillCSV
    };
})(window.GV = window.GV || {});
