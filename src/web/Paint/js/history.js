/*
    Undo / redo.

    begin() copies the whole document once when an edit starts; commit()
    keeps only the area the edit touched (before and after), so a brush
    stroke on a big picture costs a small rectangle, not two full copies.
    Edits that change the picture size keep both whole images.
*/
import { App } from './app.js';
import { copyCanvas } from './util.js';
import { clipRect } from './raster.js';

const MAX_STEPS = 60;
const MAX_BYTES = 384 * 1024 * 1024;

export class History {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.snap = null;
        this.bytes = 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.snap = null;
        this.bytes = 0;
        App.emit('history');
    }

    get active() {
        return this.snap !== null;
    }

    // Snapshot the document before an edit (no-op when one is open already)
    begin() {
        if (this.snap) {
            return;
        }
        this.snap = copyCanvas(App.canvas);
    }

    // Close the edit; rect is the area it changed (null = everything)
    commit(label, rect) {
        if (!this.snap) {
            return;
        }
        const snap = this.snap;
        this.snap = null;
        if (snap.width !== App.W || snap.height !== App.H) {
            this.pushResize(label, snap);
            return;
        }
        const r = clipRect(rect || { x: 0, y: 0, w: App.W, h: App.H }, App.W, App.H);
        if (!r) {
            return;
        }
        const entry = {
            label: label,
            r: r,
            before: copyCanvas(snap, r.x, r.y, r.w, r.h),
            after: copyCanvas(App.canvas, r.x, r.y, r.w, r.h)
        };
        entry.bytes = r.w * r.h * 8;
        this.push(entry);
    }

    // Put the snapshot back and forget the edit (an edit that was cancelled)
    revert() {
        if (!this.snap) {
            return;
        }
        const snap = this.snap;
        this.snap = null;
        if (snap.width !== App.W || snap.height !== App.H) {
            App.canvas.width = snap.width;
            App.canvas.height = snap.height;
            App.emit('docsize');
        }
        App.ctx.clearRect(0, 0, App.W, App.H);
        App.ctx.drawImage(snap, 0, 0);
    }

    cancel() {
        this.snap = null;
    }

    // Record an edit that replaced the whole picture (size may differ)
    pushResize(label, beforeCanvas) {
        const entry = {
            label: label,
            resize: true,
            before: beforeCanvas,
            after: copyCanvas(App.canvas)
        };
        entry.bytes = (entry.before.width * entry.before.height + entry.after.width * entry.after.height) * 4;
        this.push(entry);
    }

    push(entry) {
        this.undoStack.push(entry);
        this.bytes += entry.bytes;
        for (const e of this.redoStack) {
            this.bytes -= e.bytes;
        }
        this.redoStack = [];
        while (this.undoStack.length > 1 && (this.undoStack.length > MAX_STEPS || this.bytes > MAX_BYTES)) {
            this.bytes -= this.undoStack.shift().bytes;
        }
        App.markDirty();
        App.emit('history');
    }

    apply(entry, img) {
        if (entry.resize) {
            const sizeChanged = App.W !== img.width || App.H !== img.height;
            App.canvas.width = img.width;
            App.canvas.height = img.height;
            App.ctx.drawImage(img, 0, 0);
            if (sizeChanged) {
                App.emit('docsize');
            }
        } else {
            const r = entry.r;
            App.ctx.clearRect(r.x, r.y, r.w, r.h);
            App.ctx.drawImage(img, r.x, r.y);
        }
    }

    canUndo() {
        return this.undoStack.length > 0 || App.hasPending();
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    undo() {
        // An edit still in progress (a shape, a pasted image) is undone first
        App.finalize();
        const e = this.undoStack.pop();
        if (!e) {
            return;
        }
        this.apply(e, e.before);
        this.redoStack.push(e);
        App.markDirty();
        App.emit('history');
        App.emit('changed');
    }

    redo() {
        App.finalize();
        const e = this.redoStack.pop();
        if (!e) {
            return;
        }
        this.apply(e, e.after);
        this.undoStack.push(e);
        App.markDirty();
        App.emit('history');
        App.emit('changed');
    }

    nextUndoLabel() {
        const e = this.undoStack[this.undoStack.length - 1];
        return e ? e.label : '';
    }

    nextRedoLabel() {
        const e = this.redoStack[this.redoStack.length - 1];
        return e ? e.label : '';
    }
}
