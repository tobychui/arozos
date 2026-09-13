/*
    ArozOS Office - PDF worker
    ==========================
    Assembles a PDF from a display list off the page's thread (see
    pdfdraw.js), so a large export does not freeze the editor.

    Messages in:   { job }
    Messages out:  { type: "progress", done, total, stage }
                   { type: "done", bytes }       (bytes transferred)
                   { type: "error", message }
*/
/* global importScripts, OfficePdfDraw, fontkit */
importScripts("lib/pdf-lib.min.js", "lib/fontkit.umd.min.js", "pdfdraw.js");

self.onmessage = function (e) {
    var job = e.data && e.data.job;
    if (!job) return;
    OfficePdfDraw.render(job, {
        fontkit: self.fontkit,
        onProgress: function (done, total, stage) {
            self.postMessage({ type: "progress", done: done, total: total, stage: stage });
        }
    }).then(function (bytes) {
        self.postMessage({ type: "done", bytes: bytes }, [bytes.buffer]);
    }).catch(function (err) {
        self.postMessage({ type: "error", message: (err && err.message) || String(err) });
    });
};
