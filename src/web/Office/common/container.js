/*
    OfficeContainer - client-side reader / writer for the suite's native
    packed file format (.doca / .xlsa / .ppta)
    =====================================================================

    In ArozOS mode these containers are packed and unpacked server side by
    mod/office/packed.go. The standalone (static hosting) build has no
    server, so this file re-implements the same format in the browser with
    no dependencies:

        document.json    the JSON envelope; every media value replaced by
                         an "asset://<name>" reference
        assets/<name>    the binary media

    Symmetry with Go:
      - unpack() mirrors office.UnpackEnvelope: assets come back as data
        URLs, so the document is self-contained in memory and survives a
        localStorage draft round trip. Legacy plain-JSON documents (written
        before the container existed) pass through untouched.
      - pack() mirrors office.PackEnvelope's data-URL branch: every data URL
        in the body becomes a deduplicated asset entry. It cannot resolve
        "media?file=" links - those are ArozOS storage references and there
        is no storage here - so they are left as they are.

    Asset names are <crc32>-<length>.<ext> rather than Go's sha1 prefix.
    Nothing reads meaning out of the name; it only has to be stable per
    content so identical media is stored once, and Go's unpacker matches
    "asset://<name>" against the zip entry name whatever that name is.

    Every entry this writes is STORED (no compression) - archive/zip and
    every other reader handle that fine, and it keeps the writer down to a
    CRC table. Reading still has to inflate, because Go deflates
    document.json.
*/
var OfficeContainer = (function () {
    "use strict";

    var DOC_NAME = "document.json";

    /* ================= text codecs ================= */
    function utf8Encode(str) {
        if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
        var esc = unescape(encodeURIComponent(str));
        var out = new Uint8Array(esc.length);
        for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
        return out;
    }
    function utf8Decode(bytes) {
        if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
        return decodeURIComponent(escape(binaryString(bytes)));
    }
    // String.fromCharCode.apply blows the argument stack on big arrays
    function binaryString(bytes) {
        var CHUNK = 0x8000, parts = [];
        for (var i = 0; i < bytes.length; i += CHUNK) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
        }
        return parts.join("");
    }
    function base64Encode(bytes) { return btoa(binaryString(bytes)); }
    function base64Decode(b64) {
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    /* ================= CRC32 ================= */
    var CRC_TABLE = (function () {
        var t = new Int32Array(256), c, n, k;
        for (n = 0; n < 256; n++) {
            c = n;
            for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c;
        }
        return t;
    })();
    function crc32(buf) {
        var c = -1;
        for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ -1) >>> 0;
    }

    /* ================= raw DEFLATE decoder =================
       A direct transcription of the canonical "puff" algorithm: decode a
       symbol by walking code lengths 1..15 and comparing against the count
       of codes at each length, which needs only a (count, symbol) pair
       rather than a built lookup table. Slower than a table decoder and far
       shorter - document.json is a few hundred KB at most and media rides
       along STORED, so this is never on a hot path.
       DecompressionStream("deflate-raw") could do this natively but it is
       async, which would push a promise through every document load path. */
    var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51,
        59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4,
        4, 5, 5, 5, 5, 0];
    var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385,
        513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9,
        10, 10, 11, 11, 12, 12, 13, 13];
    var CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function buildHuff(lengths, n) {
        var count = new Int32Array(16), i;
        for (i = 0; i < n; i++) count[lengths[i]]++;
        count[0] = 0;
        var offs = new Int32Array(16), sum = 0;
        for (i = 1; i < 16; i++) { offs[i] = sum; sum += count[i]; }
        var symbols = new Int32Array(n);
        for (i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
        return { count: count, symbols: symbols };
    }
    var fixedLit = null, fixedDist = null;
    function buildFixed() {
        if (fixedLit) return;
        var l = new Uint8Array(288), i;
        for (i = 0; i < 144; i++) l[i] = 8;
        for (; i < 256; i++) l[i] = 9;
        for (; i < 280; i++) l[i] = 7;
        for (; i < 288; i++) l[i] = 8;
        fixedLit = buildHuff(l, 288);
        var d = new Uint8Array(30);
        for (i = 0; i < 30; i++) d[i] = 5;
        fixedDist = buildHuff(d, 30);
    }

    function inflateRaw(src, expectedSize) {
        var pos = 0, bitbuf = 0, bitcnt = 0;
        var out = new Uint8Array(Math.max(1024, expectedSize || src.length * 4));
        var olen = 0;

        function grow(n) {
            if (olen + n <= out.length) return;
            var cap = out.length;
            while (cap < olen + n) cap *= 2;
            var nb = new Uint8Array(cap);
            nb.set(out.subarray(0, olen));
            out = nb;
        }
        function bits(need) {
            var val = bitbuf;
            while (bitcnt < need) {
                if (pos >= src.length) throw new Error("truncated deflate stream");
                val |= src[pos++] << bitcnt;
                bitcnt += 8;
            }
            bitbuf = val >>> need;
            bitcnt -= need;
            return val & ((1 << need) - 1);
        }
        function decode(h) {
            var code = 0, first = 0, index = 0, len, cnt;
            for (len = 1; len <= 15; len++) {
                code |= bits(1);
                cnt = h.count[len];
                if (code - first < cnt) return h.symbols[index + (code - first)];
                index += cnt;
                first = (first + cnt) << 1;
                code <<= 1;
            }
            throw new Error("invalid deflate code");
        }

        var last, type, i;
        do {
            last = bits(1);
            type = bits(2);
            if (type === 0) {
                // stored block: drop the partial byte, then LEN / NLEN
                bitbuf = 0; bitcnt = 0;
                if (pos + 4 > src.length) throw new Error("truncated stored block");
                var len = src[pos] | (src[pos + 1] << 8);
                pos += 4;
                if (pos + len > src.length) throw new Error("bad stored block length");
                grow(len);
                out.set(src.subarray(pos, pos + len), olen);
                olen += len;
                pos += len;
            } else if (type === 1 || type === 2) {
                var lit, dist;
                if (type === 1) {
                    buildFixed();
                    lit = fixedLit; dist = fixedDist;
                } else {
                    var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
                    var clens = new Uint8Array(19);
                    for (i = 0; i < ncode; i++) clens[CLC_ORDER[i]] = bits(3);
                    var clh = buildHuff(clens, 19);
                    var lengths = new Uint8Array(nlen + ndist);
                    i = 0;
                    while (i < nlen + ndist) {
                        var sym = decode(clh), rep, prev;
                        if (sym < 16) {
                            lengths[i++] = sym;
                        } else if (sym === 16) {
                            if (i === 0) throw new Error("deflate repeat with no previous length");
                            prev = lengths[i - 1];
                            rep = 3 + bits(2);
                            while (rep-- && i < lengths.length) lengths[i++] = prev;
                        } else if (sym === 17) {
                            rep = 3 + bits(3);
                            while (rep-- && i < lengths.length) lengths[i++] = 0;
                        } else {
                            rep = 11 + bits(7);
                            while (rep-- && i < lengths.length) lengths[i++] = 0;
                        }
                    }
                    lit = buildHuff(lengths.subarray(0, nlen), nlen);
                    dist = buildHuff(lengths.subarray(nlen), ndist);
                }
                for (;;) {
                    var s = decode(lit);
                    if (s < 256) {
                        grow(1);
                        out[olen++] = s;
                    } else if (s === 256) {
                        break;
                    } else {
                        s -= 257;
                        if (s >= 29) throw new Error("invalid deflate length code");
                        var length = LEN_BASE[s] + bits(LEN_EXTRA[s]);
                        var dsym = decode(dist);
                        if (dsym >= 30) throw new Error("invalid deflate distance code");
                        var back = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
                        if (back > olen) throw new Error("deflate distance beyond output");
                        grow(length);
                        var from = olen - back;
                        for (var k = 0; k < length; k++) out[olen++] = out[from + k];
                    }
                }
            } else {
                throw new Error("invalid deflate block type");
            }
        } while (!last);
        return out.subarray(0, olen);
    }

    /* ================= zip ================= */
    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

    /*
        Entries are located through the central directory, never by walking
        local headers: Go's zip.Writer streams sizes into a trailing data
        descriptor, so a local header's compressed size is often zero.
    */
    function readZip(bytes) {
        var eocd = -1;
        var min = Math.max(0, bytes.length - 66000);   // 22 + max comment length
        for (var i = bytes.length - 22; i >= min; i--) {
            if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B &&
                bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error("not a document container (no zip directory)");
        var count = u16(bytes, eocd + 10);
        var cdOff = u32(bytes, eocd + 16);
        var files = {};
        var p = cdOff;
        for (var n = 0; n < count; n++) {
            if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014B50) {
                throw new Error("corrupted document container");
            }
            var method = u16(bytes, p + 10);
            var compSize = u32(bytes, p + 20);
            var rawSize = u32(bytes, p + 24);
            var fnLen = u16(bytes, p + 28);
            var exLen = u16(bytes, p + 30);
            var cmLen = u16(bytes, p + 32);
            var lhOff = u32(bytes, p + 42);
            var name = utf8Decode(bytes.subarray(p + 46, p + 46 + fnLen));
            p += 46 + fnLen + exLen + cmLen;

            if (u32(bytes, lhOff) !== 0x04034B50) throw new Error("corrupted document container");
            var dataAt = lhOff + 30 + u16(bytes, lhOff + 26) + u16(bytes, lhOff + 28);
            var raw = bytes.subarray(dataAt, dataAt + compSize);
            if (method === 0) {
                files[name] = raw;
            } else if (method === 8) {
                files[name] = inflateRaw(raw, rawSize);
            } else {
                throw new Error("unsupported compression in document container");
            }
        }
        return files;
    }

    function dosTime(d) {
        return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) |
            (Math.floor(d.getSeconds() / 2) & 0x1F);
    }
    function dosDate(d) {
        return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) |
            (d.getDate() & 0x1F);
    }

    // entries: [{name, data:Uint8Array}] - all written STORED
    function writeZip(entries) {
        var now = new Date(), t = dosTime(now), dt = dosDate(now);
        var parts = [], offset = 0, central = [], i;
        for (i = 0; i < entries.length; i++) {
            var name = utf8Encode(entries[i].name);
            var data = entries[i].data;
            var crc = crc32(data);
            var lh = new Uint8Array(30 + name.length);
            var v = new DataView(lh.buffer);
            v.setUint32(0, 0x04034B50, true);
            v.setUint16(4, 20, true);          // version needed
            v.setUint16(6, 0, true);           // flags (entry names are ASCII)
            v.setUint16(8, 0, true);           // method: store
            v.setUint16(10, t, true);
            v.setUint16(12, dt, true);
            v.setUint32(14, crc, true);
            v.setUint32(18, data.length, true);
            v.setUint32(22, data.length, true);
            v.setUint16(26, name.length, true);
            v.setUint16(28, 0, true);
            lh.set(name, 30);
            parts.push(lh, data);
            central.push({ name: name, crc: crc, size: data.length, offset: offset });
            offset += lh.length + data.length;
        }
        var cdStart = offset, cdParts = [];
        for (i = 0; i < central.length; i++) {
            var c = central[i];
            var ch = new Uint8Array(46 + c.name.length);
            var cv = new DataView(ch.buffer);
            cv.setUint32(0, 0x02014B50, true);
            cv.setUint16(4, 20, true);         // version made by
            cv.setUint16(6, 20, true);         // version needed
            cv.setUint16(8, 0, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, t, true);
            cv.setUint16(14, dt, true);
            cv.setUint32(16, c.crc, true);
            cv.setUint32(20, c.size, true);
            cv.setUint32(24, c.size, true);
            cv.setUint16(28, c.name.length, true);
            cv.setUint16(30, 0, true);         // extra
            cv.setUint16(32, 0, true);         // comment
            cv.setUint16(34, 0, true);         // disk number
            cv.setUint16(36, 0, true);         // internal attrs
            cv.setUint32(38, 0, true);         // external attrs
            cv.setUint32(42, c.offset, true);
            ch.set(c.name, 46);
            cdParts.push(ch);
            offset += ch.length;
        }
        var eocd = new Uint8Array(22);
        var ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054B50, true);
        ev.setUint16(8, central.length, true);
        ev.setUint16(10, central.length, true);
        ev.setUint32(12, offset - cdStart, true);
        ev.setUint32(16, cdStart, true);

        var all = parts.concat(cdParts);
        all.push(eocd);
        var total = 0;
        all.forEach(function (b) { total += b.length; });
        var out = new Uint8Array(total), at = 0;
        all.forEach(function (b) { out.set(b, at); at += b.length; });
        return out;
    }

    /* ================= media <-> data URL (mirrors packed.go) ================= */
    var MIME_TO_EXT = {
        "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg",
        "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp",
        "image/svg+xml": "svg", "image/x-icon": "ico",
        "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
        "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
        "audio/ogg": "ogg", "audio/flac": "flac", "audio/aac": "aac"
    };
    var EXT_TO_MIME = (function () {
        var m = {};
        Object.keys(MIME_TO_EXT).forEach(function (mime) {
            var e = MIME_TO_EXT[mime];
            if (!m[e]) m[e] = mime;
        });
        m.jpg = "image/jpeg";
        m.bin = "application/octet-stream";
        return m;
    })();

    function parseDataURL(s) {
        if (s.length < 6 || s.substring(0, 5) !== "data:") return null;
        var comma = s.indexOf(",");
        if (comma < 0 || comma > 256) return null;
        var header = s.substring(5, comma);
        if (header.indexOf(";base64") < 0) return null;
        var mime = header.split(";")[0].toLowerCase();
        var ext = MIME_TO_EXT[mime] || "bin";
        try {
            return { bytes: base64Decode(s.substring(comma + 1)), ext: ext };
        } catch (e) {
            return null;   // malformed base64: leave the string alone
        }
    }
    function dataURLOf(bytes, ext) {
        var mime = EXT_TO_MIME[String(ext).toLowerCase()] || "application/octet-stream";
        return "data:" + mime + ";base64," + base64Encode(bytes);
    }
    function extOfName(name) {
        var i = name.lastIndexOf(".");
        return i < 0 ? "bin" : name.substring(i + 1).toLowerCase();
    }

    // walk every string value of decoded JSON (mirrors transformStrings in Go)
    function transformStrings(v, fn) {
        if (v === null || v === undefined) return v;
        if (typeof v === "string") return fn(v);
        if (Object.prototype.toString.call(v) === "[object Array]") {
            for (var i = 0; i < v.length; i++) v[i] = transformStrings(v[i], fn);
            return v;
        }
        if (typeof v === "object") {
            Object.keys(v).forEach(function (k) { v[k] = transformStrings(v[k], fn); });
            return v;
        }
        return v;
    }

    /* ================= public API ================= */
    /* container bytes -> envelope JSON string with media inlined as data
       URLs. A plain-JSON (pre-container) document passes straight through. */
    function unpack(bytes) {
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
            return utf8Decode(bytes);
        }
        var files = readZip(bytes);
        var doc = files[DOC_NAME];
        if (!doc) throw new Error("document container is missing " + DOC_NAME);
        var root = JSON.parse(utf8Decode(doc));
        root = transformStrings(root, function (s) {
            if (s.substring(0, 8) !== "asset://") return s;
            var name = s.substring(8);
            var data = files["assets/" + name];
            return data ? dataURLOf(data, extOfName(name)) : s;
        });
        return JSON.stringify(root);
    }

    /* envelope JSON string -> container bytes */
    function pack(envelopeJson) {
        var root = JSON.parse(envelopeJson);
        var assets = {}, byKey = {};
        var add = function (bytes, ext) {
            var key = crc32(bytes).toString(16) + "-" + bytes.length.toString(16);
            if (byKey[key]) return byKey[key];
            var name = key + "." + ext;
            byKey[key] = name;
            assets[name] = bytes;
            return name;
        };
        root = transformStrings(root, function (s) {
            var d = parseDataURL(s);
            return d ? ("asset://" + add(d.bytes, d.ext)) : s;
        });
        var entries = [{ name: DOC_NAME, data: utf8Encode(JSON.stringify(root)) }];
        Object.keys(assets).forEach(function (n) {
            entries.push({ name: "assets/" + n, data: assets[n] });
        });
        return writeZip(entries);
    }

    return {
        pack: pack,
        unpack: unpack,
        // exposed for reuse and testing
        crc32: crc32,
        inflateRaw: inflateRaw,
        readZip: readZip,
        writeZip: writeZip,
        utf8Encode: utf8Encode,
        utf8Decode: utf8Decode
    };
})();

/* Node (CommonJS) export for unit tests; harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
    module.exports = OfficeContainer;
}
