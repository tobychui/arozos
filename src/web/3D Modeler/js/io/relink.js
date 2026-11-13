/*
    3D Modeler - the Missing Files dialog

    Shown when an assembly is opened and some of its part files cannot be
    read (they were moved or renamed), and for a drawing whose models are
    missing: one row per missing file, with Select File to point it at its
    new place. Once one is found, the others are looked for in the same
    folder under their old names, so a moved folder takes one pick.

    showRelink(items, options) -> Promise, settled when the dialog closes
        items: [{ id, name, path, message }]
        options:
            title, text         the heading and the explanation
            pick()              let the user choose a file: { data, name, path } or null
            read(path)          read a file by path (rejects when it is not there)
            accepts(file)       true when a chosen file can stand for the missing one
            apply(id, file)     relink item id to the file
*/

import { icon } from '../ui.js';
import { folderOf, fileNameOf } from './paths.js';

export function showRelink(items, options) {
    return new Promise(function (resolve) {
        const veil = document.createElement('div');
        veil.className = 'veil';
        const box = document.createElement('div');
        box.className = 'dialog relink';
        box.setAttribute('role', 'dialog');
        const title = document.createElement('div');
        title.className = 'dialog-title';
        title.textContent = options.title;
        const text = document.createElement('div');
        text.className = 'dialog-text';
        text.textContent = options.text;
        const list = document.createElement('div');
        list.className = 'relink-list';
        const buttons = document.createElement('div');
        buttons.className = 'dialog-buttons';
        const close = document.createElement('button');
        close.className = 'dialog-btn';
        buttons.appendChild(close);
        box.appendChild(title);
        box.appendChild(text);
        box.appendChild(list);
        box.appendChild(buttons);
        veil.appendChild(box);

        const rows = items.map(function (item) {
            return { item: item, done: false, note: item.message || 'Not found', busy: false };
        });

        function finish() {
            document.removeEventListener('keydown', onKey, true);
            veil.remove();
            resolve();
        }

        function onKey(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish();
            }
        }

        function render() {
            list.innerHTML = '';
            rows.forEach(function (row) {
                const el = document.createElement('div');
                el.className = 'relink-row' + (row.done ? ' done' : '');
                el.innerHTML = '<span class="relink-icon">' + icon(row.done ? 'finish' : 'warn') + '</span>' +
                    '<span class="relink-main"><span class="relink-name"></span><span class="relink-path"></span><span class="relink-note"></span></span>';
                el.querySelector('.relink-name').textContent = row.item.name;
                const path = el.querySelector('.relink-path');
                path.textContent = row.done ? row.newPath || 'Kept inside the file' : row.item.path || '';
                path.title = path.textContent;
                el.querySelector('.relink-note').textContent = row.note;
                const pick = document.createElement('button');
                pick.className = 'dialog-btn';
                pick.textContent = row.done ? 'Change' : 'Select File';
                pick.disabled = row.busy;
                pick.addEventListener('click', function () {
                    choose(row);
                });
                el.appendChild(pick);
                list.appendChild(el);
            });
            const left = rows.filter(function (r) {
                return !r.done;
            }).length;
            close.textContent = left ? 'Skip' : 'Done';
            close.className = 'dialog-btn' + (left ? '' : ' primary');
            close.title = left ? 'Leave the files that are still missing; they show a warning in the browser, where Relink Part brings this back' : '';
        }

        function relink(row, file, note) {
            options.apply(row.item.id, file);
            row.done = true;
            row.newPath = file.path;
            row.note = note;
        }

        function choose(row) {
            row.busy = true;
            render();
            options.pick().then(function (file) {
                row.busy = false;
                if (!file) {
                    render();
                    return null;
                }
                if (options.accepts && !options.accepts(file)) {
                    row.note = file.name + ' is not the right kind of file';
                    render();
                    return null;
                }
                relink(row, file, 'Relinked');
                render();
                return file.path ? lookBeside(folderOf(file.path)) : null;
            }).catch(function (err) {
                row.busy = false;
                row.note = err.message;
                render();
            });
        }

        // The other missing files, under their old names in the folder
        // the user just picked from
        function lookBeside(folder) {
            const others = rows.filter(function (r) {
                return !r.done && r.item.path;
            });
            return Promise.all(others.map(function (row) {
                const candidate = folder + fileNameOf(row.item.path);
                return options.read(candidate).then(function (file) {
                    if (!row.done && (!options.accepts || options.accepts(file))) {
                        relink(row, file, 'Found in the same folder');
                    }
                }, function () {
                    // Not there either: it stays missing
                });
            })).then(render);
        }

        close.addEventListener('click', finish);
        document.addEventListener('keydown', onKey, true);
        render();
        document.body.appendChild(veil);
    });
}
