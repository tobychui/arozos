/*
    3D Modeler - kernel client

    Main-thread side of the kernel worker: starts it, and turns the message
    protocol of worker.js into promises.

        const kernel = createKernel({ onReady, onFailed, onProgress });
        const { bodies, stats } = await kernel.call('selftest');

    onProgress(info) hears how far the start-up is ({ step: "download",
    loaded, total } then { step: "compile" }); call(op, args, onProgress)
    hears how far that call is (rebuild.js progress).
*/

export function createKernel(handlers) {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const pending = new Map();
    let nextId = 1;

    function failAll(text) {
        pending.forEach(function (p) {
            p.reject(new Error(text));
        });
        pending.clear();
    }

    worker.onmessage = function (event) {
        const msg = event.data || {};
        if (msg.event === 'ready') {
            if (handlers && handlers.onReady) {
                handlers.onReady(msg.ms);
            }
            return;
        }
        if (msg.event === 'progress') {
            if (!msg.id) {
                if (handlers && handlers.onProgress) {
                    handlers.onProgress(msg.info || {});
                }
                return;
            }
            const running = pending.get(msg.id);
            if (running && running.onProgress) {
                try {
                    running.onProgress(msg.info || {});
                } catch (err) {
                    // a progress display must never fail the call
                }
            }
            return;
        }
        if (msg.event === 'failed') {
            failAll(msg.error);
            if (handlers && handlers.onFailed) {
                handlers.onFailed(msg.error);
            }
            return;
        }
        const p = pending.get(msg.id);
        if (!p) {
            return;
        }
        pending.delete(msg.id);
        if (msg.ok) {
            p.resolve(msg.result);
        } else {
            p.reject(new Error(msg.error));
        }
    };

    // Fires when the worker script itself cannot be loaded or throws at top level
    worker.onerror = function (event) {
        const text = event && event.message ? event.message : 'The kernel worker could not be started';
        failAll(text);
        if (handlers && handlers.onFailed) {
            handlers.onFailed(text);
        }
    };

    return {
        call: function (op, args, onProgress) {
            return new Promise(function (resolve, reject) {
                const id = nextId++;
                pending.set(id, { resolve: resolve, reject: reject, onProgress: onProgress || null });
                worker.postMessage({ id: id, op: op, args: args || {} });
            });
        },
        terminate: function () {
            failAll('The kernel was shut down');
            worker.terminate();
        }
    };
}
