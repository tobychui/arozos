/*
    Gerber Viewer - minimal zip reader / writer

    Used for archives picked from the local device (archives stored on ArozOS
    are unpacked by the AGI backend instead) and for "Save Project as ZIP".
    Inflate / deflate use the browser's built-in (De)CompressionStream with
    the "deflate-raw" format, so no third party library is needed.
*/
(function (GV) {
    'use strict';

    function u16(dv, o) { return dv.getUint16(o, true); }

    //Errors carry a code (and values) so the UI can show them translated
    function zipError(code, msg, vars) {
        var e = new Error(msg);
        e.code = code;
        e.vars = vars || {};
        return e;
    }
    function u32(dv, o) { return dv.getUint32(o, true); }

    async function streamThrough(bytes, stream) {
        var blob = new Blob([bytes]);
        var out = blob.stream().pipeThrough(stream);
        return new Uint8Array(await new Response(out).arrayBuffer());
    }

    function inflateRaw(bytes) {
        if (typeof DecompressionStream === 'undefined') {
            throw zipError('zipNoInflate', 'This browser cannot decompress zip files.');
        }
        return streamThrough(bytes, new DecompressionStream('deflate-raw'));
    }

    function deflateRaw(bytes) {
        return streamThrough(bytes, new CompressionStream('deflate-raw'));
    }

    //Names are UTF-8 when flagged; otherwise try UTF-8 and fall back to Latin-1
    function decodeName(bytes, utf8) {
        try {
            return new TextDecoder('utf-8', { fatal: !utf8 }).decode(bytes);
        } catch (e) {
            var s = '';
            for (var i = 0; i < bytes.length; i++) {
                s += String.fromCharCode(bytes[i]);
            }
            return s;
        }
    }

    //List the entries of a zip held in an ArrayBuffer / Uint8Array
    function list(buffer) {
        var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var eocd = -1;
        for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (u32(dv, i) === 0x06054b50) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) {
            throw zipError('zipInvalid', 'Not a zip archive.');
        }
        var count = u16(dv, eocd + 10);
        var cdOffset = u32(dv, eocd + 16);
        if (cdOffset === 0xffffffff || count === 0xffff) {
            throw zipError('zip64', 'ZIP64 archives are not supported.');
        }
        var entries = [];
        var p = cdOffset;
        for (var n = 0; n < count; n++) {
            if (p + 46 > bytes.length || u32(dv, p) !== 0x02014b50) {
                break;
            }
            var flags = u16(dv, p + 8);
            var method = u16(dv, p + 10);
            var csize = u32(dv, p + 20);
            var usize = u32(dv, p + 24);
            var nameLen = u16(dv, p + 28);
            var extraLen = u16(dv, p + 30);
            var commentLen = u16(dv, p + 32);
            var local = u32(dv, p + 42);
            var name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
            entries.push({
                name: name,
                dir: /\/$/.test(name),
                method: method,
                encrypted: (flags & 1) !== 0,
                compressedSize: csize,
                size: usize,
                localOffset: local
            });
            p += 46 + nameLen + extraLen + commentLen;
        }
        return { bytes: bytes, dv: dv, entries: entries };
    }

    async function extract(zip, entry) {
        var dv = zip.dv;
        var o = entry.localOffset;
        if (u32(dv, o) !== 0x04034b50) {
            throw zipError('zipCorrupt', 'Corrupt zip entry: ' + entry.name, { name: entry.name });
        }
        var start = o + 30 + u16(dv, o + 26) + u16(dv, o + 28);
        var data = zip.bytes.subarray(start, start + entry.compressedSize);
        if (entry.encrypted) {
            throw zipError('zipEncrypted', 'Encrypted zip entries are not supported: ' + entry.name, { name: entry.name });
        }
        if (entry.method === 0) {
            return data;
        }
        if (entry.method === 8) {
            return inflateRaw(data);
        }
        throw zipError('zipMethod', 'Unsupported zip compression method ' + entry.method + ' for ' + entry.name, { method: entry.method, name: entry.name });
    }

    var CRC_TABLE = null;
    function crc32(bytes) {
        if (!CRC_TABLE) {
            CRC_TABLE = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) {
                    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                }
                CRC_TABLE[n] = c >>> 0;
            }
        }
        var crc = 0xffffffff;
        for (var i = 0; i < bytes.length; i++) {
            crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    //files: [{name, text | bytes}] -> Uint8Array of a zip archive
    async function create(files) {
        var enc = new TextEncoder();
        var chunks = [];
        var central = [];
        var offset = 0;
        var now = new Date();
        var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
        var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var data = f.bytes || enc.encode(f.text || '');
            var name = enc.encode(f.name);
            var crc = crc32(data);
            var comp = await deflateRaw(data);
            var method = 8;
            if (comp.length >= data.length) {
                comp = data;
                method = 0;
            }
            var lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true);
            lh.setUint16(4, 20, true);
            lh.setUint16(6, 0x800, true);
            lh.setUint16(8, method, true);
            lh.setUint16(10, dosTime, true);
            lh.setUint16(12, dosDate, true);
            lh.setUint32(14, crc, true);
            lh.setUint32(18, comp.length, true);
            lh.setUint32(22, data.length, true);
            lh.setUint16(26, name.length, true);
            lh.setUint16(28, 0, true);
            chunks.push(new Uint8Array(lh.buffer), name, comp);

            var ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true);
            ch.setUint16(4, 20, true);
            ch.setUint16(6, 20, true);
            ch.setUint16(8, 0x800, true);
            ch.setUint16(10, method, true);
            ch.setUint16(12, dosTime, true);
            ch.setUint16(14, dosDate, true);
            ch.setUint32(16, crc, true);
            ch.setUint32(20, comp.length, true);
            ch.setUint32(24, data.length, true);
            ch.setUint16(28, name.length, true);
            ch.setUint32(42, offset, true);
            central.push(new Uint8Array(ch.buffer), name);
            offset += 30 + name.length + comp.length;
        }
        var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true);
        end.setUint32(16, offset, true);
        var all = chunks.concat(central, [new Uint8Array(end.buffer)]);
        var total = all.reduce(function (s, c) { return s + c.length; }, 0);
        var out = new Uint8Array(total);
        var pos = 0;
        all.forEach(function (c) {
            out.set(c, pos);
            pos += c.length;
        });
        return out;
    }

    function isZip(bytes) {
        return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
    }

    GV.zip = {
        list: list,
        extract: extract,
        create: create,
        isZip: isZip,
        crc32: crc32
    };
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
