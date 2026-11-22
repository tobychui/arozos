/*
    3D Modeler - the picture saved inside a document

    Parts, assemblies and drawings carry a small JPEG of themselves in the
    top level field "_ao_preview" (a data URL). The ArozOS File Manager
    shows it as the file's thumbnail (mod/filesystem/metadata/jsonpreview.go
    reads it). The field is written first, so the server finds it without
    reading the rest of the file, and it is dropped whenever a file is read
    (files.js parse), so it never lives in a document's data and an old
    picture is never saved again.

    The caller draws the picture on a canvas (viewport.capturePreview for
    parts and assemblies, drawing.previewCanvas for drawings). encode()
    turns that into JPEG in a worker where the browser can (OffscreenCanvas),
    else with canvas.toBlob, which is asynchronous too, and gives up after
    TIMEOUT ms: a file saved without its picture beats a save that waits.

        encode(canvas)          -> Promise of a data URL, or null
        withPreview(text, url)  -> the document text with the field first
        stripPreview(data)      -> data without the field
*/

export const PREVIEW_KEY = '_ao_preview';
export const PREVIEW_SIDE = 480;
export const PREVIEW_QUALITY = 0.85;
const TIMEOUT = 2000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

// The document's JSON text with the picture as its first field. Text that
// is not a JSON object, or no picture, leaves the text as it is.
export function withPreview(text, dataURL) {
    if (typeof text !== 'string' || typeof dataURL !== 'string' || dataURL.indexOf(JPEG_PREFIX) !== 0) {
        return text;
    }
    const open = /^\s*\{/.exec(text);
    if (!open) {
        return text;
    }
    const rest = text.slice(open[0].length);
    const empty = /^\s*\}/.test(rest);
    return '{\n "' + PREVIEW_KEY + '": ' + JSON.stringify(dataURL) + (empty ? '' : ',') + rest;
}

// A document read from a file, without its picture
export function stripPreview(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, PREVIEW_KEY)) {
        delete data[PREVIEW_KEY];
    }
    return data;
}

/* ================= encoding ================= */
let worker = null;
let workerBroken = false;
let nextJob = 1;
const jobs = new Map(); // id -> { resolve, reject }

function failAll(reason) {
    jobs.forEach(function (job) {
        job.reject(new Error(reason));
    });
    jobs.clear();
}

function getWorker() {
    if (workerBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ||
        typeof createImageBitmap !== 'function') {
        return null;
    }
    if (!worker) {
        try {
            worker = new Worker(new URL('./previewworker.js', import.meta.url));
        } catch (err) {
            workerBroken = true;
            return null;
        }
        worker.onmessage = function (e) {
            const job = jobs.get(e.data && e.data.id);
            if (!job) {
                return; // timed out long ago
            }
            jobs.delete(e.data.id);
            if (e.data.url) {
                job.resolve(e.data.url);
            } else {
                job.reject(new Error(e.data.error || 'The preview could not be encoded'));
            }
        };
        worker.onerror = function () {
            workerBroken = true;
            worker.terminate();
            worker = null;
            failAll('The preview worker stopped');
        };
    }
    return worker;
}

function viaWorker(canvas, quality) {
    const w = getWorker();
    if (!w) {
        return Promise.reject(new Error('No preview worker'));
    }
    return createImageBitmap(canvas).then(function (bitmap) {
        return new Promise(function (resolve, reject) {
            const id = nextJob++;
            jobs.set(id, { resolve: resolve, reject: reject });
            w.postMessage({ id: id, bitmap: bitmap, quality: quality }, [bitmap]);
        });
    });
}

function viaCanvas(canvas, quality) {
    return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
            if (!blob || blob.type !== 'image/jpeg') {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.onload = function () {
                resolve(typeof reader.result === 'string' ? reader.result : null);
            };
            reader.onerror = function () {
                resolve(null);
            };
            reader.readAsDataURL(blob);
        }, 'image/jpeg', quality);
    });
}

// A canvas as a JPEG data URL; null when there is no canvas, it could not
// be encoded, or it took longer than TIMEOUT
export function encode(canvas, quality) {
    if (!canvas || !canvas.width || !canvas.height) {
        return Promise.resolve(null);
    }
    const q = quality || PREVIEW_QUALITY;
    const job = viaWorker(canvas, q).catch(function () {
        return viaCanvas(canvas, q);
    }).then(function (url) {
        return typeof url === 'string' && url.indexOf(JPEG_PREFIX) === 0 ? url : null;
    });
    const late = new Promise(function (resolve) {
        setTimeout(function () {
            resolve(null);
        }, TIMEOUT);
    });
    return Promise.race([job, late]).catch(function () {
        return null;
    });
}
