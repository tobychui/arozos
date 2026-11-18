/*
    3D Modeler - the mesh export dialog

    STL, OBJ and 3MF hold triangles, not the exact shape (STEP and BREP
    keep the exact shape and have nothing to choose). How closely the
    triangles follow curved faces is picked from a list; for each choice
    the dialog makes the file in the background (options.make) and shows
    its size and triangle count, so the cost of a finer mesh is known
    before it is saved. What was made is kept, and Export saves it without
    meshing again. The last choices are remembered in the browser, per
    format.

    MESH_LEVELS             [{ id, label, deflection (mm), angle (rad) }]
    askMeshExport(options)  -> Promise of { content, level, choices } or null
        options.title, options.text
        options.format      "stl" | "obj" | "3mf": the key the choices are
                            remembered under
        options.choices     more drop-downs: [{ key, label, items: [{ id,
                            label }] }] (units, ASCII or binary STL)
        options.make(level, choices) -> Promise of { content, size (bytes),
                               triangles, warning? (said under the size, e.g.
                               a mesh that is not watertight) }
*/

export const MESH_LEVELS = [
    { id: 'draft', label: 'Draft', deflection: 0.5, angle: 0.8 },
    { id: 'coarse', label: 'Coarse', deflection: 0.2, angle: 0.5 },
    { id: 'normal', label: 'Normal', deflection: 0.05, angle: 0.25 },
    { id: 'fine', label: 'Fine', deflection: 0.01, angle: 0.1 },
    { id: 'finest', label: 'Very fine', deflection: 0.002, angle: 0.05 }
];

const PREF = '3dmodeler.meshlevel';

export function levelById(id) {
    return MESH_LEVELS.filter(function (l) {
        return l.id === id;
    })[0] || MESH_LEVELS[2];
}

// "840 bytes", "12.4 KB", "3.1 MB"
export function formatSize(bytes) {
    if (bytes < 1024) {
        return bytes + ' bytes';
    }
    if (bytes < 1024 * 1024) {
        const kb = bytes / 1024;
        return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
    }
    const mb = bytes / (1024 * 1024);
    return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
}

function stored(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (e) {
        return null;
    }
}

function remembered(format) {
    return levelById(stored(PREF + (format ? '.' + format : '')) || stored(PREF)).id;
}

function remember(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (e) {
        // Not kept
    }
}

export function askMeshExport(options) {
    return new Promise(function (resolve) {
        const veil = document.createElement('div');
        veil.className = 'veil';
        const box = document.createElement('div');
        box.className = 'dialog meshexport';
        box.setAttribute('role', 'dialog');
        box.innerHTML = '<div class="dialog-title"></div><div class="dialog-text"></div>' +
            '<label class="export-row"><span>Fineness</span><select class="props-input export-level"></select></label>' +
            '<div class="export-choices"></div>' +
            '<div class="export-hint"></div><div class="export-estimate"></div>' +
            '<div class="dialog-buttons"><button class="dialog-btn" data-act="cancel">Cancel</button>' +
            '<button class="dialog-btn primary" data-act="export">Export</button></div>';
        box.querySelector('.dialog-title').textContent = options.title;
        box.querySelector('.dialog-text').textContent = options.text;
        const select = box.querySelector('.export-level');
        const hint = box.querySelector('.export-hint');
        const estimate = box.querySelector('.export-estimate');
        const exportButton = box.querySelector('[data-act="export"]');
        MESH_LEVELS.forEach(function (l) {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.label + ' (' + l.deflection + ' mm)';
            select.appendChild(opt);
        });
        select.value = remembered(options.format);
        // More choices (units, encoding), each remembered per format
        const choiceSelects = {};
        (options.choices || []).forEach(function (choice) {
            const row = document.createElement('label');
            row.className = 'export-row';
            const name = document.createElement('span');
            name.textContent = choice.label;
            const pick = document.createElement('select');
            pick.className = 'props-input';
            choice.items.forEach(function (item) {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.label;
                pick.appendChild(opt);
            });
            const kept = stored(PREF + '.' + (options.format || '') + '.' + choice.key);
            pick.value = choice.items.some(function (item) {
                return item.id === kept;
            }) ? kept : choice.items[0].id;
            row.appendChild(name);
            row.appendChild(pick);
            box.querySelector('.export-choices').appendChild(row);
            choiceSelects[choice.key] = pick;
            pick.addEventListener('change', show);
        });
        const choices = function () {
            const out = {};
            Object.keys(choiceSelects).forEach(function (key) {
                out[key] = choiceSelects[key].value;
            });
            return out;
        };
        const cacheKey = function (id) {
            return id + JSON.stringify(choices());
        };
        veil.appendChild(box);

        const made = {};    // level id -> Promise of { content, size, triangles }
        let closed = false;

        function make(id) {
            const key = cacheKey(id);
            if (!made[key]) {
                made[key] = options.make(levelById(id), choices());
                made[key].catch(function () {
                    delete made[key]; // try again next time
                });
            }
            return made[key];
        }

        function show() {
            const id = select.value;
            const key = cacheKey(id);
            const level = levelById(id);
            hint.textContent = 'Curved faces are followed within ' + level.deflection + ' mm.';
            estimate.textContent = 'Working out the file size...';
            estimate.classList.remove('bad');
            estimate.classList.add('busy');
            make(id).then(function (r) {
                if (!closed && cacheKey(select.value) === key) {
                    estimate.classList.remove('busy');
                    estimate.textContent = 'About ' + formatSize(r.size) + ', ' + r.triangles.toLocaleString('en-US') +
                        (r.triangles === 1 ? ' triangle' : ' triangles') + (r.warning ? '. ' + r.warning : '');
                    estimate.classList.toggle('bad', !!r.warning);
                }
            }, function (err) {
                if (!closed && cacheKey(select.value) === key) {
                    estimate.classList.remove('busy');
                    estimate.classList.add('bad');
                    estimate.textContent = err.message;
                }
            });
        }

        function done(value) {
            closed = true;
            document.removeEventListener('keydown', onKey, true);
            veil.remove();
            resolve(value);
        }

        function onKey(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                done(null);
            } else if (event.key === 'Enter' && event.target !== select) {
                event.preventDefault();
                exportButton.click();
            }
        }

        select.addEventListener('change', show);
        box.querySelector('[data-act="cancel"]').addEventListener('click', function () {
            done(null);
        });
        exportButton.addEventListener('click', function () {
            const id = select.value;
            exportButton.disabled = true;
            remember(PREF + (options.format ? '.' + options.format : ''), id);
            const picked = choices();
            Object.keys(picked).forEach(function (key) {
                remember(PREF + '.' + (options.format || '') + '.' + key, picked[key]);
            });
            make(id).then(function (r) {
                done({ content: r.content, level: levelById(id), choices: picked });
            }, function () {
                exportButton.disabled = false;
            });
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(veil);
        show();
        select.focus();
    });
}
