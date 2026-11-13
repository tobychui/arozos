/*
    3D Modeler - kernel client

    Main-thread side of the kernel worker: starts it, and turns the message
    protocol of worker.js into promises.

        const kernel = createKernel({ onReady, onFailed });
        const { bodies, stats } = await kernel.call('selftest');
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
        call: function (op, args) {
            return new Promise(function (resolve, reject) {
                const id = nextId++;
                pending.set(id, { resolve: resolve, reject: reject });
                worker.postMessage({ id: id, op: op, args: args || {} });
            });
        },
        terminate: function () {
            failAll('The kernel was shut down');
            worker.terminate();
        }
    };
}
