/*
    rawdecoder.js — client side camera RAW decoder for the ArozOS Raw Editor

    Responsibilities:
      - Detect the container type from the extension / magic bytes.
      - For ordinary images (jpg/png/webp/tiff) draw them onto a work canvas.
      - For camera RAW (ARW/DNG/NEF/CR2/ORF/RW2 ... — all TIFF/IFD based)
        parse the TIFF structure, locate the CFA (Bayer) plane and demosaic it
        into an RGB image, applying black/white levels and camera / gray-world
        white balance.
      - When the raw payload uses a compression we cannot decode, gracefully
        fall back to the full size JPEG preview that virtually every RAW file
        embeds, so the user always sees their photo.

    The decoder always resolves to a common structure consumed by the editor:

      {
        width, height,                // working resolution (long edge capped)
        data: Float32Array,           // RGBA, scene linear, range ~[0,1]
        meta: { camera, iso, shutter, aperture, focal, temp, tint, wb:[r,g,b] },
        source: 'raw-demosaic' | 'embedded-preview' | 'image'
      }

    Everything downstream (WebGL develop pipeline) treats "data" as linear RGBA.
*/

const RawDecoder = (function () {

    // Longest edge (px) of the working buffer used for interactive editing and
    // export. Keeps memory / GPU upload bounded on multi-megapixel sensors.
    const MAX_WORK_EDGE = 2560;

    const RAW_EXTS = ["arw", "dng", "nef", "cr2", "cr3", "orf", "raf", "rw2", "pef", "srw"];

    function extOf(name) {
        const i = (name || "").lastIndexOf(".");
        return i < 0 ? "" : name.substring(i + 1).toLowerCase();
    }

    // ---- sRGB <-> linear helpers ------------------------------------------
    function srgbToLinear(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    // Convert an 8bit RGBA ImageData (sRGB) into a linear Float32 RGBA buffer.
    function imageDataToLinear(imgData) {
        const src = imgData.data;
        const out = new Float32Array(src.length);
        // Small lookup table for the 256 possible 8bit values.
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
        for (let i = 0; i < src.length; i += 4) {
            out[i] = lut[src[i]];
            out[i + 1] = lut[src[i + 1]];
            out[i + 2] = lut[src[i + 2]];
            out[i + 3] = 1.0;
        }
        return out;
    }

    // Draw an ImageBitmap/Image onto a work canvas (capped) and return linear RGBA.
    function bitmapToWork(bitmap) {
        let w = bitmap.width, h = bitmap.height;
        const scale = Math.min(1, MAX_WORK_EDGE / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        return { width: w, height: h, data: imageDataToLinear(img) };
    }

    function decodeBlobAsImage(blob) {
        return new Promise((resolve, reject) => {
            if (window.createImageBitmap) {
                createImageBitmap(blob).then((bmp) => {
                    resolve(bitmapToWork(bmp));
                }).catch(reject);
            } else {
                const url = URL.createObjectURL(blob);
                const im = new Image();
                im.onload = () => { URL.revokeObjectURL(url); resolve(bitmapToWork(im)); };
                im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
                im.src = url;
            }
        });
    }

    // ======================================================================
    //  TIFF / IFD parsing
    // ======================================================================

    const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

    function parseTIFF(buf) {
        const dv = new DataView(buf);
        if (dv.byteLength < 8) throw new Error("not a tiff");
        const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
        let little;
        if (b0 === 0x49 && b1 === 0x49) little = true;        // II
        else if (b0 === 0x4D && b1 === 0x4D) little = false;  // MM
        else throw new Error("not a tiff (byte order)");
        const magic = dv.getUint16(2, little);
        if (magic !== 42 && magic !== 0x4F52 /*ORF 'RO'*/ && magic !== 0x5352) {
            // ORF (Olympus) and some others use a non-42 magic; be lenient.
        }
        const ifds = [];
        const visited = {};

        function readValues(dv, type, count, valOffset, entryOffset) {
            const size = TYPE_SIZE[type] || 1;
            const total = size * count;
            let base;
            if (total <= 4) base = entryOffset; // inline
            else base = valOffset;
            if (base + total > dv.byteLength) return null;
            const vals = [];
            for (let i = 0; i < count; i++) {
                const o = base + i * size;
                switch (type) {
                    case 1: case 6: case 7: vals.push(dv.getUint8(o)); break;
                    case 2: vals.push(dv.getUint8(o)); break; // ascii byte
                    case 3: case 8: vals.push(dv.getUint16(o, little)); break;
                    case 4: case 9: vals.push(dv.getUint32(o, little)); break;
                    case 5: vals.push(dv.getUint32(o, little) / (dv.getUint32(o + 4, little) || 1)); break;
                    case 10: vals.push(dv.getInt32(o, little) / (dv.getInt32(o + 4, little) || 1)); break;
                    case 11: vals.push(dv.getFloat32(o, little)); break;
                    case 12: vals.push(dv.getFloat64(o, little)); break;
                    default: vals.push(dv.getUint8(o));
                }
            }
            return vals;
        }

        function readIFD(offset) {
            if (!offset || offset <= 0 || offset + 2 > dv.byteLength) return null;
            if (visited[offset]) return null;
            visited[offset] = true;
            const count = dv.getUint16(offset, little);
            if (count > 4096) return null; // not a real IFD — bogus offset
            const tags = {};
            const subOffsets = [];
            let p = offset + 2;
            for (let i = 0; i < count; i++, p += 12) {
                if (p + 12 > dv.byteLength) break;
                const tag = dv.getUint16(p, little);
                const type = dv.getUint16(p + 2, little);
                const cnt = dv.getUint32(p + 4, little);
                const valOff = dv.getUint32(p + 8, little);
                tags[tag] = { type: type, count: cnt, valueOffset: valOff, entryOffset: p + 8 };
                // Follow SubIFD (0x014A) and the ExifIFD (0x8769) pointers. Do NOT
                // recurse the MakerNote (0x927C): its bytes are not IFD offsets and
                // treating them as such can be pathologically slow on real files.
                if (tag === 0x014A || tag === 0x8769) {
                    const v = readValues(dv, type, cnt, valOff, p + 8);
                    if (v) v.forEach((o) => subOffsets.push(o));
                }
            }
            const nextOff = (p + 4 <= dv.byteLength) ? dv.getUint32(p, little) : 0;
            const ifd = {
                tags: tags,
                get: function (tag) {
                    const t = tags[tag];
                    if (!t) return null;
                    return readValues(dv, t.type, t.count, t.valueOffset, t.entryOffset);
                },
                raw: tags
            };
            ifds.push(ifd);
            subOffsets.forEach((so) => readIFD(so));
            return nextOff;
        }

        let ifdOff = dv.getUint32(4, little);
        let guard = 0;
        while (ifdOff && guard++ < 64) {
            ifdOff = readIFD(ifdOff);
        }
        return { dv: dv, little: little, ifds: ifds };
    }

    // Common TIFF/EXIF/DNG tag ids we care about.
    const T = {
        ImageWidth: 0x0100, ImageLength: 0x0101, BitsPerSample: 0x0102,
        Compression: 0x0103, Photometric: 0x0106, StripOffsets: 0x0111,
        RowsPerStrip: 0x0116, StripByteCounts: 0x0117, TileWidth: 0x0142,
        TileLength: 0x0143, TileOffsets: 0x0144, TileByteCounts: 0x0145,
        JPEGOffset: 0x0201, JPEGLength: 0x0202, Make: 0x010F, Model: 0x0110,
        CFAPattern: 0x828E, CFAPatternExif: 0xA302, SubfileType: 0x00FE,
        // EXIF
        ExposureTime: 0x829A, FNumber: 0x829D, ISO: 0x8827, FocalLength: 0x920A,
        // DNG
        BlackLevel: 0xC61A, WhiteLevel: 0xC61D, AsShotNeutral: 0xC628,
        DNGVersion: 0xC612, CFALayout: 0xC61E, LinearizationTable: 0xC618
    };

    function asciiOf(vals) {
        if (!vals) return "";
        let s = "";
        for (let i = 0; i < vals.length; i++) {
            if (vals[i] === 0) break;
            s += String.fromCharCode(vals[i]);
        }
        return s.trim();
    }

    // ======================================================================
    //  Embedded JPEG preview extraction (robust fallback)
    // ======================================================================

    // Locate the largest embedded JPEG, using IFD pointers first then a brute
    // force SOI/EOI scan. Returns { off, len } into the source bytes or null.
    function findEmbeddedJpegRange(u8, tiff) {
        let best = null;

        if (tiff) {
            tiff.ifds.forEach((ifd) => {
                const off = ifd.get(T.JPEGOffset);
                const len = ifd.get(T.JPEGLength);
                if (off && len && off[0] > 0 && len[0] > 0 && off[0] + len[0] <= u8.length) {
                    if (u8[off[0]] === 0xFF && u8[off[0] + 1] === 0xD8) {
                        if (!best || len[0] > best.len) best = { off: off[0], len: len[0] };
                    }
                }
                // Some previews are stored as a full strip with Compression 6/7.
                const comp = ifd.get(T.Compression);
                if (comp && (comp[0] === 6 || comp[0] === 7 || comp[0] === 99)) {
                    const so = ifd.get(T.StripOffsets);
                    const sc = ifd.get(T.StripByteCounts);
                    if (so && sc && so.length === 1 && sc[0] > 1000 && so[0] + sc[0] <= u8.length) {
                        if (u8[so[0]] === 0xFF && u8[so[0] + 1] === 0xD8) {
                            if (!best || sc[0] > best.len) best = { off: so[0], len: sc[0] };
                        }
                    }
                }
            });
        }
        if (best) return best;

        // Brute force: find the largest FFD8..FFD9 span.
        let bestStart = -1, bestEnd = -1;
        for (let i = 0; i + 1 < u8.length; i++) {
            if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) {
                for (let j = i + 2; j + 1 < u8.length; j++) {
                    if (u8[j] === 0xFF && u8[j + 1] === 0xD9) {
                        if (j - i > bestEnd - bestStart) { bestStart = i; bestEnd = j + 1; }
                        i = j + 1;
                        break;
                    }
                }
            }
        }
        if (bestStart >= 0 && bestEnd - bestStart > 2000) {
            return { off: bestStart, len: bestEnd - bestStart + 1 };
        }
        return null;
    }

    function extractEmbeddedJpeg(buf, tiff) {
        const u8 = new Uint8Array(buf);
        const r = findEmbeddedJpegRange(u8, tiff);
        return r ? new Blob([u8.subarray(r.off, r.off + r.len)], { type: "image/jpeg" }) : null;
    }

    // ======================================================================
    //  EXIF from a JPEG APP1 segment (covers plain JPEGs, embedded previews,
    //  and RAWs whose main TIFF structure we could not parse).
    // ======================================================================

    // jbytes: a Uint8Array starting at a JPEG SOI (0xFFD8). Returns meta or null.
    function parseJpegExif(jbytes) {
        if (!jbytes || jbytes.length < 4 || jbytes[0] !== 0xFF || jbytes[1] !== 0xD8) return null;
        let i = 2;
        while (i + 4 < jbytes.length) {
            if (jbytes[i] !== 0xFF) { i++; continue; }
            const marker = jbytes[i + 1];
            if (marker === 0xD9 || marker === 0xDA) break; // EOI / start of scan
            const len = (jbytes[i + 2] << 8) | jbytes[i + 3];
            if (len < 2) break;
            if (marker === 0xE1) {
                const o = i + 4;
                // "Exif\0\0"
                if (jbytes[o] === 0x45 && jbytes[o + 1] === 0x78 && jbytes[o + 2] === 0x69 &&
                    jbytes[o + 3] === 0x66 && jbytes[o + 4] === 0 && jbytes[o + 5] === 0) {
                    const tiffStart = o + 6;
                    const tiffLen = (len - 2) - 6;
                    if (tiffLen > 8 && tiffStart + tiffLen <= jbytes.length) {
                        try {
                            const sub = jbytes.slice(tiffStart, tiffStart + tiffLen).buffer;
                            return readMeta(parseTIFF(sub));
                        } catch (e) { return null; }
                    }
                }
            }
            i += 2 + len;
        }
        return null;
    }

    function metaHasExif(m) {
        return m && (m.iso || m.aperture || m.shutter || m.focal || m.camera);
    }

    function mergeMeta(primary, secondary) {
        if (!secondary) return primary;
        if (!primary) return secondary;
        const out = Object.assign({}, primary);
        ["camera", "iso", "shutter", "aperture", "focal"].forEach((k) => {
            if ((out[k] === "" || out[k] === 0 || out[k] == null) && secondary[k]) out[k] = secondary[k];
        });
        if (!out.wb && secondary.wb) out.wb = secondary.wb;
        if ((!out.temp || out.temp === 5500) && secondary.temp) out.temp = secondary.temp;
        return out;
    }

    // Collect every embedded JPEG (IFD-pointed + brute-force SOI/EOI scan).
    // Sony ARW keeps EXIF in the small thumbnail, not the large preview, so we
    // must be able to inspect all of them — not just the biggest.
    function collectJpegRanges(u8, tiff) {
        const ranges = [];
        const seen = {};
        const add = (off, len) => {
            if (off >= 0 && len > 100 && off + len <= u8.length &&
                u8[off] === 0xFF && u8[off + 1] === 0xD8 && !seen[off]) {
                seen[off] = true; ranges.push({ off: off, len: len });
            }
        };
        if (tiff) {
            tiff.ifds.forEach((ifd) => {
                const off = ifd.get(T.JPEGOffset), len = ifd.get(T.JPEGLength);
                if (off && len) add(off[0], len[0]);
                const so = ifd.get(T.StripOffsets), sc = ifd.get(T.StripByteCounts);
                if (so && sc && so.length === 1) add(so[0], sc[0]);
            });
        }
        for (let i = 0; i + 2 < u8.length; i++) {
            if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) {
                for (let j = i + 2; j + 1 < u8.length; j++) {
                    if (u8[j] === 0xFF && u8[j + 1] === 0xD9) { add(i, j - i + 1); i = j + 1; break; }
                }
            }
        }
        return ranges;
    }

    // Fill gaps in "meta" from EXIF found in any embedded / whole-file JPEG.
    function enrichMetaFromJpeg(buf, tiff, meta) {
        if (metaHasExif(meta) && meta.iso && meta.aperture && meta.shutter) return meta;
        try {
            const u8 = new Uint8Array(buf);
            if (u8[0] === 0xFF && u8[1] === 0xD8) {
                const em0 = parseJpegExif(u8);
                if (em0) meta = mergeMeta(meta, em0);
            }
            const ranges = collectJpegRanges(u8, tiff);
            for (let k = 0; k < ranges.length; k++) {
                if (meta.iso && meta.aperture && meta.shutter) break;
                const em = parseJpegExif(u8.subarray(ranges[k].off, ranges[k].off + ranges[k].len));
                if (em) meta = mergeMeta(meta, em);
            }
            return meta;
        } catch (e) { return meta; }
    }

    // ======================================================================
    //  CFA (Bayer) extraction + demosaic
    // ======================================================================

    // Read raw CFA samples into a Float32 single-channel plane (values kept in
    // sensor code range). Supports uncompressed 16/14/12-bit (packed or not)
    // and Sony ARW2 lossy compression. Returns null when unsupported.
    function readCFAPlane(buf, tiff, ifd) {
        const dv = tiff.dv, little = tiff.little;
        const w = (ifd.get(T.ImageWidth) || [0])[0];
        const h = (ifd.get(T.ImageLength) || [0])[0];
        const bps = (ifd.get(T.BitsPerSample) || [16])[0];
        const comp = (ifd.get(T.Compression) || [1])[0];
        if (!w || !h || w * h > 80e6) return null;

        const plane = new Float32Array(w * h);
        const strips = ifd.get(T.StripOffsets);
        const counts = ifd.get(T.StripByteCounts);
        const rowsPerStrip = (ifd.get(T.RowsPerStrip) || [h])[0];

        if (comp === 1) {
            // Uncompressed. Concatenate strips then unpack bit-by-bit.
            if (!strips) return null;
            let dstPix = 0;
            for (let s = 0; s < strips.length; s++) {
                const off = strips[s];
                const nRows = Math.min(rowsPerStrip, h - s * rowsPerStrip);
                const pixInStrip = nRows * w;
                if (bps === 16) {
                    for (let i = 0; i < pixInStrip; i++) {
                        const o = off + i * 2;
                        if (o + 1 >= dv.byteLength) break;
                        plane[dstPix++] = dv.getUint16(o, little);
                    }
                } else {
                    // Packed bitstream (12 or 14 bit), MSB first per TIFF spec.
                    let bitPos = off * 8;
                    for (let i = 0; i < pixInStrip; i++) {
                        let v = 0;
                        for (let b = 0; b < bps; b++) {
                            const bytePos = bitPos >> 3;
                            if (bytePos >= dv.byteLength) { v = 0; break; }
                            const bit = 7 - (bitPos & 7);
                            v = (v << 1) | ((dv.getUint8(bytePos) >> bit) & 1);
                            bitPos++;
                        }
                        plane[dstPix++] = v;
                    }
                }
            }
            return { plane: plane, width: w, height: h, maxVal: (1 << bps) - 1 };
        }

        if (comp === 32767) {
            // Sony ARW2 lossy compression: 16 pixel blocks, each 128 bits.
            if (!strips || !counts) return null;
            if (decodeSonyARW2(dv, strips, counts, w, h, plane)) {
                return { plane: plane, width: w, height: h, maxVal: 16383 };
            }
            return null;
        }

        return null; // unsupported compression (lossless JPEG etc.)
    }

    // Sony ARW2 block decoder. Each row is stored in 16 pixel groups; a group
    // is 16 bytes = 2x max/min (11bit each) + 4bit shift + 14x 7bit deltas.
    // Reference: dcraw sony_arw2_load_raw. Values are interleaved per Bayer
    // colour (even/odd columns) but we lay them out linearly which is fine for
    // a subsequent generic demosaic.
    function decodeSonyARW2(dv, strips, counts, w, h, plane) {
        try {
            // Build a per-row byte offset table from strips.
            // ARW2 typically uses one strip; bytes-per-row = stripBytes / rows.
            const totalBytes = counts.reduce((a, b) => a + b, 0);
            const bytesPerRow = Math.floor(totalBytes / h);
            if (bytesPerRow < w) return false;

            function bits(bytePos, bitOff, n) {
                let v = 0;
                for (let i = 0; i < n; i++) {
                    const bp = bytePos + ((bitOff + i) >> 3);
                    if (bp >= dv.byteLength) return v;
                    const b = 7 - ((bitOff + i) & 7);
                    v = (v << 1) | ((dv.getUint8(bp) >> b) & 1);
                }
                return v;
            }

            let rowBase = strips[0];
            for (let row = 0; row < h; row++) {
                let colByte = rowBase;
                for (let col = 0; col < w; col += 16) {
                    // Two interleaved colours -> two passes of 8 pixels.
                    for (let phase = 0; phase < 2; phase++) {
                        let bitOff = 0;
                        const max = bits(colByte, bitOff, 11); bitOff += 11;
                        const min = bits(colByte, bitOff, 11); bitOff += 11;
                        const imax = bits(colByte, bitOff, 4); bitOff += 4;
                        const imin = bits(colByte, bitOff, 4); bitOff += 4;
                        let sh = 0;
                        for (let s = max; s < 0x800; s <<= 1) sh++;
                        for (let i = 0; i < 8; i++) {
                            let p;
                            if (i === imax) p = max;
                            else if (i === imin) p = min;
                            else {
                                const d = bits(colByte, bitOff, 7); bitOff += 7;
                                p = (d << sh) + min;
                                if (p > 0x7ff) p = 0x7ff;
                            }
                            const c = col + i * 2 + phase;
                            if (c < w) plane[row * w + c] = p << 1;
                        }
                        colByte += 16;
                    }
                }
                rowBase += bytesPerRow;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // Bilinear demosaic of a single CFA plane into linear RGBA float, applying
    // black/white level normalisation and camera / gray-world white balance.
    function demosaic(cfa, pattern, black, white, wbMul) {
        const w = cfa.width, h = cfa.height, p = cfa.plane;
        const out = new Float32Array(w * h * 4);
        const range = Math.max(1, (white - black));

        // pattern: 2x2 colour ids, 0=R 1=G 2=B for (row%2,col%2).
        function colorAt(y, x) { return pattern[(y & 1) * 2 + (x & 1)]; }
        function samp(y, x) {
            if (x < 0) x = 1; if (x >= w) x = w - 2;
            if (y < 0) y = 1; if (y >= h) y = h - 2;
            return p[y * w + x];
        }

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const c = colorAt(y, x);
                let r, g, b;
                const v = samp(y, x);
                if (c === 0) { // red site
                    r = v;
                    g = (samp(y, x - 1) + samp(y, x + 1) + samp(y - 1, x) + samp(y + 1, x)) * 0.25;
                    b = (samp(y - 1, x - 1) + samp(y - 1, x + 1) + samp(y + 1, x - 1) + samp(y + 1, x + 1)) * 0.25;
                } else if (c === 2) { // blue site
                    b = v;
                    g = (samp(y, x - 1) + samp(y, x + 1) + samp(y - 1, x) + samp(y + 1, x)) * 0.25;
                    r = (samp(y - 1, x - 1) + samp(y - 1, x + 1) + samp(y + 1, x - 1) + samp(y + 1, x + 1)) * 0.25;
                } else { // green site
                    g = v;
                    // Neighbours: horizontal & vertical carry the two other colours.
                    const h1 = samp(y, x - 1), h2 = samp(y, x + 1);
                    const v1 = samp(y - 1, x), v2 = samp(y + 1, x);
                    if (colorAt(y, x - 1) === 0) { r = (h1 + h2) * 0.5; b = (v1 + v2) * 0.5; }
                    else { b = (h1 + h2) * 0.5; r = (v1 + v2) * 0.5; }
                }
                const o = (y * w + x) * 4;
                out[o] = Math.max(0, (r - black) / range) * wbMul[0];
                out[o + 1] = Math.max(0, (g - black) / range) * wbMul[1];
                out[o + 2] = Math.max(0, (b - black) / range) * wbMul[2];
                out[o + 3] = 1.0;
            }
        }
        return { data: out, width: w, height: h };
    }

    // Downscale a full-res linear RGBA buffer to the working edge cap (box filter).
    function downscaleLinear(src, w, h) {
        const scale = Math.min(1, MAX_WORK_EDGE / Math.max(w, h));
        if (scale >= 1) return { data: src, width: w, height: h };
        const nw = Math.max(1, Math.round(w * scale));
        const nh = Math.max(1, Math.round(h * scale));
        const out = new Float32Array(nw * nh * 4);
        const sx = w / nw, sy = h / nh;
        for (let y = 0; y < nh; y++) {
            const y0 = Math.floor(y * sy), y1 = Math.min(h, Math.floor((y + 1) * sy));
            for (let x = 0; x < nw; x++) {
                const x0 = Math.floor(x * sx), x1 = Math.min(w, Math.floor((x + 1) * sx));
                let r = 0, g = 0, b = 0, n = 0;
                for (let yy = y0; yy < y1; yy++) {
                    for (let xx = x0; xx < x1; xx++) {
                        const o = (yy * w + xx) * 4;
                        r += src[o]; g += src[o + 1]; b += src[o + 2]; n++;
                    }
                }
                const o = (y * nw + x) * 4;
                if (n === 0) n = 1;
                out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 1;
            }
        }
        return { data: out, width: nw, height: nh };
    }

    // Estimate a gray-world white balance from the demosaiced plane, used when
    // the file carries no AsShotNeutral (typical for Sony ARW without makernote).
    function grayWorldMul(cfa, pattern, black) {
        const w = cfa.width, h = cfa.height, p = cfa.plane;
        let sr = 0, sg = 0, sb = 0, nr = 0, ng = 0, nb = 0;
        const step = Math.max(1, Math.floor(Math.min(w, h) / 300));
        for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
                const v = Math.max(0, p[y * w + x] - black);
                const c = pattern[(y & 1) * 2 + (x & 1)];
                if (c === 0) { sr += v; nr++; }
                else if (c === 2) { sb += v; nb++; }
                else { sg += v; ng++; }
            }
        }
        const ar = sr / Math.max(1, nr), ag = sg / Math.max(1, ng), ab = sb / Math.max(1, nb);
        const g = ag || 1;
        let mr = g / (ar || g), mb = g / (ab || g);
        // clamp to sane range
        mr = Math.min(4, Math.max(0.25, mr));
        mb = Math.min(4, Math.max(0.25, mb));
        return [mr, 1.0, mb];
    }

    // Map a DNG CFAPattern (or default) into our 2x2 colour id layout.
    function resolvePattern(ifd) {
        const raw = ifd.get(T.CFAPattern) || ifd.get(T.CFAPatternExif);
        // CFAPattern values: 0=R 1=G 2=B (Exif) preceded by a 2x2 dim header in
        // some encodings; be defensive and fall back to RGGB.
        if (raw && raw.length >= 4) {
            const last4 = raw.slice(raw.length - 4);
            const ok = last4.every((v) => v >= 0 && v <= 2);
            if (ok) return last4;
        }
        return [0, 1, 1, 2]; // RGGB
    }

    function readMeta(tiff) {
        const meta = { camera: "", iso: 0, shutter: 0, aperture: 0, focal: 0, temp: 5500, tint: 0, wb: null };
        tiff.ifds.forEach((ifd) => {
            const make = asciiOf(ifd.get(T.Make));
            const model = asciiOf(ifd.get(T.Model));
            if (model && !meta.camera) meta.camera = (make ? make + " " : "") + model;
            const iso = ifd.get(T.ISO); if (iso && !meta.iso) meta.iso = iso[0];
            const et = ifd.get(T.ExposureTime); if (et && !meta.shutter) meta.shutter = et[0];
            const fn = ifd.get(T.FNumber); if (fn && !meta.aperture) meta.aperture = fn[0];
            const fl = ifd.get(T.FocalLength); if (fl && !meta.focal) meta.focal = fl[0];
            const asn = ifd.get(T.AsShotNeutral);
            if (asn && asn.length >= 3 && !meta.wb) {
                // AsShotNeutral is the neutral in camera-native space; multiplier is 1/n.
                meta.wb = [1 / (asn[0] || 1), 1 / (asn[1] || 1), 1 / (asn[2] || 1)];
                const g = meta.wb[1] || 1;
                meta.wb = [meta.wb[0] / g, 1, meta.wb[2] / g];
            }
        });
        return meta;
    }

    // Attempt a full CFA demosaic. Returns work-sized linear RGBA or null.
    function tryDemosaic(buf, tiff, meta) {
        // Find the CFA IFD: Photometric 32803, or the largest raw-looking plane.
        let cfaIfd = null, bestPix = 0;
        tiff.ifds.forEach((ifd) => {
            const photo = ifd.get(T.Photometric);
            const w = (ifd.get(T.ImageWidth) || [0])[0];
            const h = (ifd.get(T.ImageLength) || [0])[0];
            const comp = (ifd.get(T.Compression) || [0])[0];
            const isCFA = photo && photo[0] === 32803;
            if ((isCFA || comp === 32767) && w * h > bestPix) { cfaIfd = ifd; bestPix = w * h; }
        });
        if (!cfaIfd) return null;

        const cfa = readCFAPlane(buf, tiff, cfaIfd);
        if (!cfa) return null;

        const pattern = resolvePattern(cfaIfd);
        let black = (cfaIfd.get(T.BlackLevel) || [0])[0] || 0;
        let white = (cfaIfd.get(T.WhiteLevel) || [cfa.maxVal])[0] || cfa.maxVal;
        if (white <= black) white = cfa.maxVal;

        const wb = meta.wb || grayWorldMul(cfa, pattern, black);
        const dem = demosaic(cfa, pattern, black, white, wb);
        // A mild highlight normalise so mid-tones land in a sensible range.
        return downscaleLinear(dem.data, dem.width, dem.height);
    }

    // ======================================================================
    //  Public entry point
    // ======================================================================

    function decode(buf, filename) {
        return new Promise((resolve, reject) => {
            const ext = extOf(filename);
            const blob = new Blob([buf]);

            // Plain images: hand straight to the browser, but still read EXIF
            // from the JPEG APP1 segment so shooting info is shown.
            if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].indexOf(ext) >= 0) {
                let imgMeta = emptyMeta();
                try { imgMeta = enrichMetaFromJpeg(buf, null, imgMeta); } catch (e) { imgMeta = emptyMeta(); }
                decodeBlobAsImage(blob).then((work) => {
                    resolve({ width: work.width, height: work.height, data: work.data, meta: imgMeta, source: "image" });
                }).catch(reject);
                return;
            }

            let tiff = null;
            try { tiff = parseTIFF(buf); } catch (e) { tiff = null; }
            let meta = tiff ? readMeta(tiff) : emptyMeta();
            // Fill any missing EXIF from the embedded JPEG preview — this rescues
            // shooting info when the RAW's TIFF structure could not be parsed.
            try { meta = enrichMetaFromJpeg(buf, tiff, meta); } catch (e) { /* keep meta */ }

            // For RAW containers, try to demosaic; otherwise fall back to preview.
            const isRaw = RAW_EXTS.indexOf(ext) >= 0 || (tiff && ext !== "tif" && ext !== "tiff");

            function finishWithPreview() {
                const jpeg = tiff ? extractEmbeddedJpeg(buf, tiff) : null;
                if (jpeg) {
                    decodeBlobAsImage(jpeg).then((work) => {
                        resolve({ width: work.width, height: work.height, data: work.data, meta: meta, source: "embedded-preview" });
                    }).catch(() => tryTiffAsImage());
                } else {
                    tryTiffAsImage();
                }
            }

            function tryTiffAsImage() {
                // Last resort: maybe the browser can render it (baseline TIFF/DNG w/ preview).
                decodeBlobAsImage(blob).then((work) => {
                    resolve({ width: work.width, height: work.height, data: work.data, meta: meta, source: "image" });
                }).catch(() => reject(new Error("Unable to decode this file. The RAW format or its compression is not supported and no embedded preview was found.")));
            }

            if (isRaw && tiff) {
                let dem = null;
                try { dem = tryDemosaic(buf, tiff, meta); } catch (e) { dem = null; }
                if (dem) {
                    resolve({ width: dem.width, height: dem.height, data: dem.data, meta: meta, source: "raw-demosaic" });
                    return;
                }
                finishWithPreview();
                return;
            }

            // tif/tiff or anything else: try as image, then preview.
            decodeBlobAsImage(blob).then((work) => {
                resolve({ width: work.width, height: work.height, data: work.data, meta: meta, source: "image" });
            }).catch(finishWithPreview);
        });
    }

    function emptyMeta() {
        return { camera: "", iso: 0, shutter: 0, aperture: 0, focal: 0, temp: 5500, tint: 0, wb: null };
    }

    return { decode: decode, MAX_WORK_EDGE: MAX_WORK_EDGE };
})();
