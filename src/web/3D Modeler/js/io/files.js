/*
    3D Modeler - opening and saving part and assembly files

    Inside ArozOS everything goes through the AGI script backend/file.agi and
    the system file selector (ao_module.js). Without a backend - the static
    preview, or the page opened on its own - it falls back to the browser's
    file picker and a download, so the app stays usable for development.

    jQuery and ao_module.js are classic scripts; they are reached through
    window so this module loads even where they are missing.
*/

import { toHex, fromHex } from './exchange.js';

const SCRIPT = '3D Modeler/backend/file.agi';
// Documents open in tabs of this window: a read of their path gets what the
// tab holds now (unsaved edits included), so assemblies and drawings show
// a part as it is being edited. Set by app.js: path -> { data, name } or null
let openLookup = null;

export function setOpenDocuments(lookup) {
    openLookup = lookup;
}
const EXTENSION = '.aopart';
const EXTENSIONS = ['.aopart', '.aoasm', '.aodrw'];
let backend = null; // null = not probed yet

function agi(data) {
    const root = typeof window.ao_root === 'string' ? window.ao_root : '../';
    return fetch(root + 'system/ajgi/interface?script=' + encodeURIComponent(SCRIPT), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin'
    }).then(function (response) {
        if (!response.ok) {
            throw new Error('The server answered with error ' + response.status);
        }
        return response.text();
    }).then(function (text) {
        let reply;
        try {
            reply = JSON.parse(text);
        } catch (e) {
            throw new Error('Unexpected reply from the server');
        }
        if (!reply || reply.error) {
            const err = new Error(reply && reply.error ? reply.error : 'Unexpected reply from the server');
            err.code = reply && reply.code ? reply.code : '';
            throw err;
        }
        return reply;
    });
}

// Resolves to true when the AGI backend answers. Asked once per session.
export function hasBackend() {
    if (backend === null) {
        backend = agi({ opr: 'ping' }).then(function () {
            return true;
        }).catch(function () {
            return false;
        });
    }
    return backend;
}

// The name of a part or assembly file without its extension
export function baseName(path) {
    const file = String(path).split('/').pop();
    const ext = EXTENSIONS.filter(function (e) {
        return file.toLowerCase().endsWith(e);
    })[0];
    return ext ? file.slice(0, -ext.length) : file;
}

function withExtension(name, ext) {
    const want = ext || EXTENSION;
    return name.toLowerCase().endsWith(want) ? name : name + want;
}

function dirOf(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? 'user:/Desktop' : path.slice(0, i + 1);
}

// Ask the ArozOS file selector. Resolves to { filepath, filename } or null.
function select(type, startDir, options) {
    return new Promise(function (resolve) {
        // The selector calls back by name into this window
        window.modelerFileSelected = function (files) {
            resolve(files && files.length ? files[0] : null);
        };
        window.ao_module_openFileSelector(window.modelerFileSelected, startDir, type, false, options);
    });
}

function parse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('This file is not a 3D Modeler part or assembly: it could not be read as JSON');
    }
}

// Read one part, assembly or drawing by its ArozOS path. Resolves to
// { data, name, path } (data.format tells which: "aopart", "aoasm", "aodrw").

export function readPath(path) {
    const open = openLookup && path ? openLookup(path) : null;
    if (open) {
        return Promise.resolve({ data: JSON.parse(JSON.stringify(open.data)), name: open.name, path: path, open: true });
    }
    return agi({ opr: 'read', path: path }).then(function (reply) {
        return { data: parse(reply.content), name: baseName(path), path: path };
    });
}

function browserPick(accept) {
    return new Promise(function (resolve, reject) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept || EXTENSIONS.join(',') + ',application/json';
        input.addEventListener('change', function () {
            const file = input.files && input.files[0];
            if (!file) {
                resolve(null);
                return;
            }
            file.text().then(function (text) {
                resolve({ data: parse(text), name: baseName(file.name), path: '' });
            }).catch(reject);
        });
        input.addEventListener('cancel', function () {
            resolve(null);
        });
        input.click();
    });
}

// Let the user choose a part or an assembly and read it. Resolves to
// { data, name, path }, or null when cancelled.
export function open() {
    return hasBackend().then(function (ok) {
        if (!ok) {
            return browserPick();
        }
        return select('file', 'user:/Desktop', { path_memory_key: 'part', filter: ['aopart', 'aoasm', 'aodrw'] }).then(function (file) {
            return file ? readPath(file.filepath) : null;
        });
    });
}

// Let the user choose a part file (a missing part found again). Resolves
// to { data, name, path } or null when cancelled.
export function openPartFile() {
    return hasBackend().then(function (ok) {
        if (!ok) {
            return browserPick('.aopart');
        }
        return select('file', 'user:/Desktop', { path_memory_key: 'part', filter: ['aopart'] }).then(function (file) {
            if (file && !/\.aopart$/i.test(file.filepath)) {
                throw new Error('Choose a part file (.aopart)');
            }
            return file ? readPath(file.filepath) : null;
        });
    });
}

// Let the user choose a part or an assembly to draw. Resolves to
// { data, name, path } or null when cancelled.
export function openModel() {
    return hasBackend().then(function (ok) {
        if (!ok) {
            return browserPick('.aopart,.aoasm');
        }
        return select('file', 'user:/Desktop', { path_memory_key: 'part', filter: ['aopart', 'aoasm'] }).then(function (file) {
            if (file && !/\.(aopart|aoasm)$/i.test(file.filepath)) {
                throw new Error('Choose a part (.aopart) or an assembly (.aoasm)');
            }
            return file ? readPath(file.filepath) : null;
        });
    });
}

// Let the user choose a part (or a STEP file) to place in an assembly.
// Resolves to { data, name, path } for a part, { step: text, name, path }
// for a STEP file, or null when cancelled.
export function openForPlace() {
    return hasBackend().then(function (ok) {
        if (!ok) {
            return new Promise(function (resolve, reject) {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.aopart,.step,.stp';
                input.addEventListener('change', function () {
                    const file = input.files && input.files[0];
                    if (!file) {
                        resolve(null);
                        return;
                    }
                    file.text().then(function (text) {
                        resolve(/\.(step|stp)$/i.test(file.name) ? { step: text, name: file.name.replace(/\.[^.]+$/, ''), path: '' }
                            : { data: parse(text), name: baseName(file.name), path: '' });
                    }).catch(reject);
                });
                input.addEventListener('cancel', function () {
                    resolve(null);
                });
                input.click();
            });
        }
        return select('file', 'user:/Desktop', { path_memory_key: 'part', filter: ['aopart', 'step', 'stp'] }).then(function (file) {
            if (!file) {
                return null;
            }
            if (/\.(step|stp)$/i.test(file.filepath)) {
                return readText(file.filepath).then(function (got) {
                    return { step: got.text, name: got.name.replace(/\.[^.]+$/, ''), path: '' };
                });
            }
            return readPath(file.filepath);
        });
    });
}

function download(name, text, ext) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = withExtension(name, ext);
    link.click();
    setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 1000);
}

// Save `text`. With a path and askWhere = false it overwrites that file,
// otherwise the user picks a destination. ext is ".aopart" (the default),
// ".aoasm" or ".aodrw". `text` may be a function of the path written to
// ("" for a browser download): a document whose links are relative to
// its own file writes them for where it lands. Resolves to { name, path } (path is empty for a browser
// download), or null when cancelled.
export function save(text, name, path, askWhere, ext) {
    return hasBackend().then(function (ok) {
        if (!ok) {
            download(name, typeof text === 'function' ? text('') : text, ext);
            return { name: name, path: '' };
        }
        if (path && !askWhere) {
            return path;
        }
        return select('new', path ? dirOf(path) : 'user:/Desktop', {
            defaultName: withExtension(name, ext),
            path_memory_key: 'part',
            force_path_overwrite: !path
        }).then(function (file) {
            if (!file) {
                return null;
            }
            // The "new file" selector may hand back the folder and the name apart
            let target = file.filepath;
            if (file.filename && !target.endsWith(file.filename)) {
                target = target.replace(/\/?$/, '/') + file.filename;
            }
            return withExtension(target, ext);
        });
    }).then(function (target) {
        if (!target || typeof target !== 'string') {
            return target;
        }
        return agi({ opr: 'write', path: target, content: typeof text === 'function' ? text(target) : text }).then(function () {
            return { name: baseName(target), path: target };
        });
    });
}

/* ================= other file types (import and export) ================= */
function extensionOf(name) {
    const file = String(name).split('/').pop();
    const dot = file.lastIndexOf('.');
    return dot < 0 ? '' : file.slice(dot + 1).toLowerCase();
}

// Save an exported file where the user chooses. `fileName` carries the
// extension ("bracket.step"); content is { text } or { bytes: Uint8Array }.
// Resolves to { name, path } (path empty for a browser download) or null
// when cancelled.
export function saveAs(fileName, content) {
    const ext = extensionOf(fileName);
    return hasBackend().then(function (ok) {
        if (!ok) {
            const blob = new Blob([content.bytes || content.text], { type: content.bytes ? 'application/octet-stream' : 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);
            return { name: fileName, path: '' };
        }
        return select('new', 'user:/Desktop', { defaultName: fileName, path_memory_key: 'export' }).then(function (file) {
            if (!file) {
                return null;
            }
            let target = file.filepath;
            if (file.filename && !target.endsWith(file.filename)) {
                target = target.replace(/\/?$/, '/') + file.filename;
            }
            if (extensionOf(target) !== ext) {
                target += '.' + ext;
            }
            const request = content.bytes ? { opr: 'writeBinary', path: target, hex: toHex(content.bytes) }
                : { opr: 'write', path: target, content: content.text };
            return agi(request).then(function () {
                return { name: target.split('/').pop(), path: target };
            });
        });
    });
}

// Let the user choose a file of one of the given extensions and read it.
// Resolves to { name, path, text } (or { name, path, bytes } with `binary`),
// or null when cancelled.
export function openOther(extensions, binary) {
    const wrong = function (name) {
        return extensions.indexOf(extensionOf(name)) < 0;
    };
    return hasBackend().then(function (ok) {
        if (!ok) {
            return new Promise(function (resolve, reject) {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = extensions.map(function (e) {
                    return '.' + e;
                }).join(',');
                input.addEventListener('change', function () {
                    const file = input.files && input.files[0];
                    if (!file) {
                        resolve(null);
                    } else if (wrong(file.name)) {
                        reject(new Error('Choose a ' + extensions.join(' or ') + ' file'));
                    } else if (binary) {
                        file.arrayBuffer().then(function (buffer) {
                            resolve({ name: file.name, path: '', bytes: new Uint8Array(buffer) });
                        }, reject);
                    } else {
                        file.text().then(function (text) {
                            resolve({ name: file.name, path: '', text: text });
                        }, reject);
                    }
                });
                input.addEventListener('cancel', function () {
                    resolve(null);
                });
                input.click();
            });
        }
        return select('file', 'user:/Desktop', { path_memory_key: 'import' }).then(function (file) {
            if (!file) {
                return null;
            }
            if (wrong(file.filepath)) {
                throw new Error('Choose a ' + extensions.join(' or ') + ' file');
            }
            const name = file.filepath.split('/').pop();
            return agi({ opr: binary ? 'readBinary' : 'read', path: file.filepath }).then(function (reply) {
                return binary ? { name: name, path: file.filepath, bytes: fromHex(reply.hex) }
                    : { name: name, path: file.filepath, text: reply.content };
            });
        });
    });
}

// Read a text file (a STEP file handed over by the File Manager) by its
// ArozOS path. Resolves to { name, path, text }.
export function readText(path) {
    return agi({ opr: 'read', path: path }).then(function (reply) {
        return { name: String(path).split('/').pop(), path: path, text: reply.content };
    });
}

// The part the File Manager asked this window to open, or null.
export function launchPath() {
    try {
        const files = window.ao_module_loadInputFiles();
        if (files && files.length && files[0].filepath) {
            return files[0].filepath;
        }
    } catch (e) {
        // ao_module.js is not loaded
    }
    return null;
}
