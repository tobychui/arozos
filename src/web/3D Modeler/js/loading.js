/*
    3D Modeler - the loading overlay

    Covers the view while something long is under way: the modelling
    kernel starting (a 22 MB WASM file), a document being opened (its file
    read, its features built, the parts of an assembly or the views of a
    drawing made). It shows a spinner, what is being done, a progress bar
    when the amount is known, and the picture saved in the file
    (io/preview.js) while the model itself is not there yet.

        const loading = createLoading(element);
        const task = loading.start({ title, text, fraction, preview, delay, blocking });
        task.update({ text, fraction, preview, title, error });
        task.done();

    Several tasks may run at once; the latest one is shown. A task started
    with `blocking` (the kernel's start) is what every other task waits for,
    so while it runs its text and bar are shown under the other task's title
    and picture. `delay` (ms) keeps quick tasks from flashing the overlay; a
    task started while the overlay is up is shown at once, so one task can
    hand over to the next without the overlay blinking.
*/

const HIDE_AFTER = 120; // ms without a task before the overlay goes

function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) {
        e.className = cls;
    }
    return e;
}

export function createLoading(root) {
    root.textContent = '';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const box = el('div', 'splash-box');
    const picture = el('img', 'splash-preview');
    picture.alt = '';
    picture.hidden = true;
    const head = el('div', 'splash-head');
    const spinner = el('div', 'spinner');
    const title = el('div', 'splash-title');
    head.appendChild(spinner);
    head.appendChild(title);
    const text = el('div', 'splash-text');
    const bar = el('div', 'splash-bar');
    const fill = el('i');
    bar.appendChild(fill);
    box.appendChild(picture);
    box.appendChild(head);
    box.appendChild(text);
    box.appendChild(bar);
    root.appendChild(box);

    const tasks = [];
    let hideTimer = 0;

    function visible() {
        return !root.hidden;
    }

    function render() {
        const shown = tasks.filter(function (t) {
            return t.visible;
        });
        const main = shown.filter(function (t) {
            return !t.blocking;
        }).pop() || shown[shown.length - 1] || null;
        if (!main) {
            if (visible() && !hideTimer) {
                hideTimer = setTimeout(function () {
                    hideTimer = 0;
                    if (!tasks.some(function (t) {
                        return t.visible;
                    })) {
                        root.hidden = true;
                    }
                }, HIDE_AFTER);
            }
            return;
        }
        clearTimeout(hideTimer);
        hideTimer = 0;
        root.hidden = false;
        // What the shown task waits for, if anything
        const blocker = shown.filter(function (t) {
            return t.blocking && t !== main;
        }).pop() || null;
        const from = blocker || main;
        title.textContent = main.title || '';
        text.textContent = from.text || '';
        const error = !!(main.error || (blocker && blocker.error));
        spinner.hidden = error;
        box.classList.toggle('failed', error);
        const fraction = from.fraction;
        const known = typeof fraction === 'number' && isFinite(fraction);
        bar.hidden = error;
        bar.classList.toggle('busy', !known);
        fill.style.width = known ? Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%' : '';
        const url = main.preview || '';
        if (url) {
            if (picture.getAttribute('src') !== url) {
                picture.src = url;
            }
            picture.hidden = false;
        } else {
            picture.hidden = true;
            picture.removeAttribute('src');
        }
    }

    function start(options) {
        const o = options || {};
        const task = {
            title: o.title || '',
            text: o.text || '',
            fraction: typeof o.fraction === 'number' ? o.fraction : null,
            preview: o.preview || '',
            blocking: !!o.blocking,
            error: false,
            visible: false,
            ended: false,
            timer: 0
        };
        const delay = typeof o.delay === 'number' ? o.delay : 200;
        tasks.push(task);
        if (delay <= 0 || visible()) {
            task.visible = true;
            render();
        } else {
            task.timer = setTimeout(function () {
                task.timer = 0;
                if (!task.ended) {
                    task.visible = true;
                    render();
                }
            }, delay);
        }
        return {
            update: function (changes) {
                if (task.ended || !changes) {
                    return;
                }
                ['title', 'text', 'preview'].forEach(function (k) {
                    if (typeof changes[k] === 'string') {
                        task[k] = changes[k];
                    }
                });
                if ('fraction' in changes) {
                    task.fraction = typeof changes.fraction === 'number' ? changes.fraction : null;
                }
                if ('error' in changes) {
                    task.error = !!changes.error;
                    task.visible = true; // a failure is always said
                }
                if (task.visible) {
                    render();
                }
            },
            done: function () {
                if (task.ended) {
                    return;
                }
                task.ended = true;
                clearTimeout(task.timer);
                const i = tasks.indexOf(task);
                if (i >= 0) {
                    tasks.splice(i, 1);
                }
                render();
            },
            isDone: function () {
                return task.ended;
            }
        };
    }

    root.hidden = true;
    return {
        start: start,
        // Is anything being loaded (shown or still waiting for its delay)?
        busy: function () {
            return tasks.length > 0;
        }
    };
}

// A part's build as a task update, from the kernel's progress
// (kernel/rebuild.js): the feature being built and how far the list is
export function buildText(info) {
    if (info && info.step === 'feature') {
        return {
            text: 'Building ' + info.name + ' (' + (info.index + 1) + ' of ' + info.total + ')',
            fraction: info.total ? 0.9 * info.index / info.total : null
        };
    }
    if (info && info.step === 'mesh') {
        return { text: 'Meshing the solids', fraction: 0.9 };
    }
    return { text: 'Building', fraction: null };
}

// "12.3 of 22.9 MB", or "12.3 MB" when the size is not known
export function megabytes(loaded, total) {
    const mb = function (n) {
        return (n / 1048576).toFixed(1);
    };
    return total > 0 ? mb(loaded) + ' of ' + mb(total) + ' MB' : mb(loaded) + ' MB';
}
