/*
    Shared application state of Paint.

    The document is one canvas (#doc-canvas) holding the picture at its real
    size; nothing is layered. Edits that are still being made (a shape that
    can be moved, a floating selection, a text box) live on the preview
    canvas above it, and are drawn into the document by App.finalize().
*/

const PREF_KEY = 'arozos.paint.prefs';

export const App = {
    state: {
        tool: 'brush',
        primary: '#000000',
        secondary: '#ffffff',
        sizes: { pencil: 1, brush: 6, eraser: 20, shape: 3 },
        brushType: 'round',     // round | calligraphy | highlighter | spray
        shape: 'rect',
        outline: true,
        filled: false,
        dash: 'solid',          // solid | dash | dot
        tolerance: 15,          // flood fill tolerance in percent
        transparentBg: false,   // erasing and moving selections leave transparency
        font: 'Arial',
        fontSize: 28,
        bold: false,
        italic: false,
        underline: false,
        align: 'left',
        textBg: false,
        grid: false,
        customColors: []
    },

    // The document canvas and the preview canvas above it
    canvas: null,
    ctx: null,
    preview: null,
    pctx: null,

    tools: {},
    tool: null,
    prevToolId: null,

    backend: false,             // logged in to an ArozOS server (open / save there)
    file: { path: '', name: 'Untitled.png' },
    dirty: false,
    untouched: true,            // blank new document nobody drew on yet

    history: null,
    view: null,

    _ev: {},
    on(name, fn) {
        (this._ev[name] = this._ev[name] || []).push(fn);
    },
    emit(name, a, b) {
        (this._ev[name] || []).forEach((fn) => {
            try {
                fn(a, b);
            } catch (e) {
                console.error(e);
            }
        });
    },

    get W() {
        return this.canvas.width;
    },
    get H() {
        return this.canvas.height;
    },

    registerTool(t) {
        this.tools[t.id] = t;
    },

    setTool(id, keepPrev) {
        if (!this.tools[id]) {
            return;
        }
        if (this.tool && this.tool.id === id) {
            this.emit('tool');
            return;
        }
        this.finalize();
        if (this.tool) {
            if (!keepPrev) {
                this.prevToolId = this.tool.id;
            }
            if (this.tool.deactivate) {
                this.tool.deactivate();
            }
        }
        this.tool = this.tools[id];
        this.state.tool = id;
        if (this.tool.activate) {
            this.tool.activate();
        }
        this.savePrefs();
        this.emit('tool');
        this.emit('overlay');
    },

    // Commit anything still being edited: shape, floating selection, text
    finalize() {
        for (const id in this.tools) {
            const t = this.tools[id];
            if (t.commit) {
                t.commit();
            }
        }
    },

    // Is there an edit in progress that finalize() would commit?
    hasPending() {
        for (const id in this.tools) {
            const t = this.tools[id];
            if (t.isPending && t.isPending()) {
                return true;
            }
        }
        return false;
    },

    markDirty() {
        this.untouched = false;
        if (!this.dirty) {
            this.dirty = true;
            this.emit('dirty');
        }
    },

    setClean() {
        this.dirty = false;
        this.emit('dirty');
    },

    // Colour the eraser and holes left by moved selections use (null = transparent)
    backgroundFill() {
        return this.state.transparentBg ? null : this.state.secondary;
    },

    setColor(which, hex) {
        if (which !== 'primary' && which !== 'secondary') {
            return;
        }
        this.state[which] = hex;
        this.savePrefs();
        this.emit('colors');
    },

    swapColors() {
        const s = this.state;
        const p = s.primary;
        s.primary = s.secondary;
        s.secondary = p;
        this.savePrefs();
        this.emit('colors');
    },

    clearPreview() {
        this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
    },

    /* ------------------------------------------------------------ prefs */
    loadPrefs() {
        try {
            const raw = localStorage.getItem(PREF_KEY);
            if (!raw) {
                return;
            }
            const p = JSON.parse(raw);
            const keep = ['tool', 'primary', 'secondary', 'brushType', 'shape', 'outline', 'filled', 'dash',
                'tolerance', 'font', 'fontSize', 'bold', 'italic', 'underline', 'align', 'textBg', 'grid', 'customColors'];
            for (const k of keep) {
                if (p[k] !== undefined && typeof p[k] === typeof this.state[k]) {
                    this.state[k] = p[k];
                }
            }
            if (p.sizes && typeof p.sizes === 'object') {
                for (const k in this.state.sizes) {
                    if (typeof p.sizes[k] === 'number') {
                        this.state.sizes[k] = p.sizes[k];
                    }
                }
            }
        } catch (e) {
            //no storage
        }
    },

    savePrefs() {
        clearTimeout(this._prefTimer);
        this._prefTimer = setTimeout(() => {
            try {
                const s = Object.assign({}, this.state);
                delete s.transparentBg;
                localStorage.setItem(PREF_KEY, JSON.stringify(s));
            } catch (e) {
                //no storage
            }
        }, 300);
    }
};
