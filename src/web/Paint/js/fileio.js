/*
    Opening and saving pictures.

    Logged in to ArozOS, files are opened and saved through the ArozOS file
    selector and the upload endpoint; opened files are read through /media.
    Without a server (the page opened on its own) Open reads a local file and
    Save downloads the picture.
*/
import { App } from './app.js';
import { T, TF, toast, extOf, baseName, dirOf, newCanvas } from './util.js';
import { encodeBMP } from './raster.js';
import { Sel, loadImageUrl, loadImageBlob } from './selection.js';
import { Ops } from './imageops.js';
import { dialog, newImageDialog } from './dialogs.js';

export const OPEN_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'];
export const WRITE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' };

function inVirtualDesktop() {
    return typeof ao_module_virtualDesktop !== 'undefined' && !!ao_module_virtualDesktop;
}

// Same picture on a solid background (formats without transparency)
function flattened(bg) {
    const c = newCanvas(App.W, App.H);
    const x = c.getContext('2d');
    x.fillStyle = bg;
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(App.canvas, 0, 0);
    return c;
}

// Upload errors come back as HTTP 200 with {"error": "..."}
function upload(blob, filename, dir) {
    return new Promise((resolve, reject) => {
        const file = new File([blob], filename, { type: blob.type });
        ao_module_uploadFile(file, dir, (resp) => {
            try {
                const j = JSON.parse(resp);
                if (j && j.error) {
                    reject(new Error(j.error));
                    return;
                }
            } catch (e) {
                //not JSON: treat as success
            }
            resolve();
        }, undefined, (status) => {
            reject(new Error(status === 401 || status === 403 ? T('denied', 'permission denied') : 'HTTP ' + status));
        });
    });
}

export const FileIO = {
    detectBackend() {
        return new Promise((resolve) => {
            if (location.protocol === 'file:' || typeof ao_module_uploadFile === 'undefined') {
                resolve(false);
                return;
            }
            const timer = setTimeout(() => resolve(false), 4000);
            fetch('../system/auth/checkLogin', { credentials: 'same-origin' })
                .then((r) => r.json())
                .then((v) => {
                    clearTimeout(timer);
                    resolve(v === true || v === 'true');
                })
                .catch(() => {
                    clearTimeout(timer);
                    resolve(false);
                });
        });
    },

    mediaUrl(path) {
        return '../media/?file=' + encodeURIComponent(path);
    },

    updateTitle() {
        const name = App.file.name || T('untitled', 'Untitled');
        const title = (App.dirty ? '• ' : '') + name + ' - ' + T('app-name', 'Paint');
        document.title = title;
        try {
            if (typeof ao_module_setWindowTitle === 'function') {
                ao_module_setWindowTitle(title);
            }
        } catch (e) {
            //not in a float window
        }
    },

    /* ------------------------------------------------------------ open */

    openPath(path, name) {
        if (OPEN_EXTS.indexOf(extOf(name)) < 0) {
            toast(TF('not-image', '{name} is not an image Paint can open', { name: name }), true);
            return Promise.resolve(false);
        }
        App.emit('busy', true);
        return loadImageUrl(this.mediaUrl(path)).then((img) => {
            App.emit('busy', false);
            Ops.loadImage(img, { path: path, name: name });
            return true;
        }, () => {
            App.emit('busy', false);
            toast(TF('open-failed', 'Could not open {name}', { name: name }), true);
            return false;
        });
    },

    openLocalFile(file) {
        return loadImageBlob(file).then((img) => {
            Ops.loadImage(img, { path: '', name: file.name });
        }, () => toast(TF('open-failed', 'Could not open {name}', { name: file.name }), true));
    },

    pickLocalFile(cb) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
            if (input.files && input.files[0]) {
                cb(input.files[0]);
            }
        });
        input.click();
    },

    openDialog() {
        this.confirmDiscard(() => {
            if (!App.backend) {
                this.pickLocalFile((f) => this.openLocalFile(f));
                return;
            }
            ao_module_openFileSelector((files) => {
                if (files && files.length) {
                    this.openPath(files[0].filepath, files[0].filename);
                }
            }, 'user:/Desktop', 'file', false, { filter: OPEN_EXTS, path_memory_key: 'open' });
        });
    },

    // Edit > Paste from file: an image file placed as a selection
    pasteFromFile() {
        if (!App.backend) {
            this.pickLocalFile((f) => loadImageBlob(f).then((img) => Sel.paste(img), () => toast(TF('open-failed', 'Could not open {name}', { name: f.name }), true)));
            return;
        }
        ao_module_openFileSelector((files) => {
            if (files && files.length) {
                const f = files[0];
                loadImageUrl(this.mediaUrl(f.filepath)).then((img) => Sel.paste(img), () => toast(TF('open-failed', 'Could not open {name}', { name: f.filename }), true));
            }
        }, 'user:/Desktop', 'file', false, { filter: OPEN_EXTS, path_memory_key: 'open' });
    },

    newDialog() {
        this.confirmDiscard(() => {
            newImageDialog((w, h, transparent) => Ops.newImage(w, h, transparent));
        });
    },

    /* ------------------------------------------------------------ save */

    encode(ext) {
        if (ext === 'bmp') {
            const c = flattened('#ffffff');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
            return Promise.resolve(new Blob([encodeBMP(d.data, c.width, c.height)], { type: 'image/bmp' }));
        }
        const type = MIME[ext] || 'image/png';
        const src = type === 'image/jpeg' ? flattened('#ffffff') : App.canvas;
        return new Promise((resolve, reject) => {
            src.toBlob((b) => {
                if (!b) {
                    reject(new Error(T('encode-failed', 'the picture could not be encoded')));
                } else if (b.type !== type) {
                    reject(new Error(TF('format-unsupported', 'this browser cannot write {ext} files', { ext: ext.toUpperCase() })));
                } else {
                    resolve(b);
                }
            }, type, 0.92);
        });
    },

    // Resolves true once saved, false when cancelled or failed
    save() {
        App.finalize();
        if (!App.backend) {
            return this.download();
        }
        const f = App.file;
        if (!f.path || WRITE_EXTS.indexOf(extOf(f.name)) < 0) {
            return this.saveAs();
        }
        return this.writeTo(f.path, f.name);
    },

    saveAs() {
        App.finalize();
        if (!App.backend) {
            return this.download();
        }
        let name = App.file.name || T('untitled', 'Untitled') + '.png';
        if (WRITE_EXTS.indexOf(extOf(name)) < 0) {
            name = baseName(name) + '.png';
        }
        const startDir = App.file.path ? dirOf(App.file.path) : 'user:/Desktop';
        return new Promise((resolve) => {
            ao_module_openFileSelector((files) => {
                if (!files || !files.length) {
                    resolve(false);
                    return;
                }
                let path = files[0].filepath;
                let fname = files[0].filename;
                if (WRITE_EXTS.indexOf(extOf(fname)) < 0) {
                    fname += '.png';
                    path += '.png';
                }
                this.writeTo(path, fname).then(resolve);
            }, startDir, 'new', false, {
                defaultName: name,
                path_memory_key: 'save',
                force_path_overwrite: !App.file.path
            });
        });
    },

    writeTo(path, name) {
        const ext = extOf(name);
        App.emit('busy', true);
        return this.encode(ext).then((blob) => upload(blob, name, dirOf(path))).then(() => {
            App.emit('busy', false);
            App.file = { path: path, name: name };
            App.setClean();
            App.emit('file');
            toast(TF('saved', 'Saved {name}', { name: name }));
            return true;
        }, (err) => {
            App.emit('busy', false);
            toast(TF('save-failed', 'Could not save: {msg}', { msg: err.message || String(err) }), true);
            return false;
        });
    },

    // Save a copy to this computer
    download() {
        App.finalize();
        let name = App.file.name || T('untitled', 'Untitled') + '.png';
        let ext = extOf(name);
        if (WRITE_EXTS.indexOf(ext) < 0) {
            name = baseName(name) + '.png';
            ext = 'png';
        }
        return this.encode(ext).then((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(a.href);
                a.remove();
            }, 1000);
            if (!App.backend) {
                App.setClean();
            }
            return true;
        }, (err) => {
            toast(TF('save-failed', 'Could not save: {msg}', { msg: err.message }), true);
            return false;
        });
    },

    /* ------------------------------------------------------------ unsaved work */

    confirmDiscard(next) {
        if (!App.dirty && !App.hasPending()) {
            next();
            return;
        }
        dialog({
            title: T('app-name', 'Paint'),
            body: TF('save-changes', 'Do you want to save changes to {name}?', { name: App.file.name }),
            buttons: [
                { label: T('cancel', 'Cancel') },
                { label: T('dont-save', "Don't save"), action: () => next() },
                {
                    label: T('save', 'Save'), primary: true, action: () => {
                        this.save().then((ok) => {
                            if (ok) {
                                next();
                            }
                        });
                    }
                }
            ]
        });
    },

    canClose() {
        return inVirtualDesktop();
    },

    requestClose() {
        this.confirmDiscard(() => {
            App.dirty = false;
            if (typeof ao_module_closeHandler === 'function') {
                ao_module_closeHandler();
            }
        });
    },

    /* ------------------------------------------------------------ launch and drop */

    openLaunchFiles() {
        let files = null;
        try {
            files = typeof ao_module_loadInputFiles === 'function' ? ao_module_loadInputFiles() : null;
        } catch (e) {
            files = null;
        }
        if (files && files.length > 0 && App.backend) {
            this.openPath(files[0].filepath, files[0].filename);
            return true;
        }
        return false;
    },

    bindDrop(target) {
        target.addEventListener('dragover', (e) => {
            e.preventDefault();
            target.classList.add('dropping');
        });
        target.addEventListener('dragleave', (e) => {
            if (e.target === target) {
                target.classList.remove('dropping');
            }
        });
        target.addEventListener('drop', (e) => {
            e.preventDefault();
            target.classList.remove('dropping');
            const at = App.view.toDoc(e);
            let list = null;
            try {
                list = typeof ao_module_utils !== 'undefined' ? ao_module_utils.getDropFileInfo(e) : null;
            } catch (err) {
                list = null;
            }
            if (list && list.length && App.backend) {
                const f = list[0];
                if (OPEN_EXTS.indexOf(extOf(f.filename)) < 0) {
                    toast(TF('not-image', '{name} is not an image Paint can open', { name: f.filename }), true);
                    return;
                }
                if (App.untouched) {
                    this.openPath(f.filepath, f.filename);
                } else {
                    loadImageUrl(this.mediaUrl(f.filepath)).then((img) => Sel.paste(img, at), () => toast(TF('open-failed', 'Could not open {name}', { name: f.filename }), true));
                }
                return;
            }
            const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
            const img = files.find((f) => f.type.startsWith('image/'));
            if (!img) {
                return;
            }
            if (App.untouched) {
                this.openLocalFile(img);
            } else {
                loadImageBlob(img).then((bm) => Sel.paste(bm, at), () => toast(TF('open-failed', 'Could not open {name}', { name: img.name }), true));
            }
        });
    }
};
