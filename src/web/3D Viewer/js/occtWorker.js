/*
    occtWorker.js

    Runs the occt-import-js (OpenCascade) WASM kernel off the main thread so
    that tessellating a large STEP assembly does not lock up the viewer UI.

    Protocol
        in : { id, kind: "step" | "iges" | "brep", buffer: ArrayBuffer }
        out: { id, type: "status", text }
             { id, type: "ok", result }
             { id, type: "error", error }
*/

/* eslint-env worker */

var occtReady = null;

function getOcct(notify) {
    if (occtReady === null) {
        notify('Loading CAD kernel...');
        importScripts(new URL('../lib/occt/occt-import-js.js', self.location.href).href);
        occtReady = occtimportjs({
            locateFile: function (path) {
                return new URL('../lib/occt/' + path, self.location.href).href;
            }
        });
    }
    return occtReady;
}

self.onmessage = function (ev) {
    var msg = ev.data;
    var id = msg.id;

    function notify(text) {
        self.postMessage({ id: id, type: 'status', text: text });
    }

    Promise.resolve()
        .then(function () { return getOcct(notify); })
        .then(function (occt) {
            notify('Tessellating CAD geometry...');
            var bytes = new Uint8Array(msg.buffer);
            var result;
            if (msg.kind === 'step') {
                result = occt.ReadStepFile(bytes, null);
            } else if (msg.kind === 'iges') {
                result = occt.ReadIgesFile(bytes, null);
            } else {
                result = occt.ReadBrepFile(bytes, null);
            }
            if (!result || !result.success) {
                throw new Error('The CAD kernel could not read this file');
            }
            self.postMessage({ id: id, type: 'ok', result: result });
        })
        .catch(function (err) {
            self.postMessage({ id: id, type: 'error', error: (err && err.message) || String(err) });
        });
};
