/*
    DOM and small helpers shared by the browser modules.
*/

// Translated string from locale/paint.json, or the English fallback
export function T(key, fallback) {
    try {
        if (typeof applocale !== 'undefined' && applocale && applocale.localData) {
            return applocale.getString('paint/' + key, fallback);
        }
    } catch (e) {
        //no locale loaded
    }
    return fallback;
}

// T() with {name} placeholders
export function TF(key, fallback, vars) {
    let s = T(key, fallback);
    for (const k in vars) {
        s = s.split('{' + k + '}').join(String(vars[k]));
    }
    return s;
}

export function $(id) {
    return document.getElementById(id);
}

/*
    el('div', {class: 'x', onclick: fn, title: '...'}, child, 'text', ...)
    Attributes starting with "on" become listeners, "html" sets innerHTML.
*/
export function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
        for (const k in attrs) {
            const v = attrs[k];
            if (v === undefined || v === null || v === false) {
                continue;
            }
            if (k.startsWith('on') && typeof v === 'function') {
                e.addEventListener(k.substring(2), v);
            } else if (k === 'html') {
                e.innerHTML = v;
            } else if (k === 'style' && typeof v === 'object') {
                Object.assign(e.style, v);
            } else if (v === true) {
                e.setAttribute(k, '');
            } else {
                e.setAttribute(k, v);
            }
        }
    }
    for (const c of children) {
        if (c === null || c === undefined || c === false) {
            continue;
        }
        e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
}

export function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

export function copyCanvas(src, x, y, w, h) {
    x = x || 0;
    y = y || 0;
    w = w === undefined ? src.width : w;
    h = h === undefined ? src.height : h;
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    return c;
}

export function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

export function isMac() {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

// "Ctrl+S" written the way this platform shows it
export function shortcutLabel(s) {
    if (!s) {
        return '';
    }
    return isMac() ? s.replace('Ctrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : s;
}

/* ------------------------------------------------------------ toasts */

let toastTimer = null;
export function toast(msg, isError) {
    let t = $('toast');
    if (!t) {
        t = el('div', { id: 'toast', role: 'status' });
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2600);
}

/* ------------------------------------------------------------ filenames */

export function extOf(name) {
    const m = /\.([^./\\]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
}

export function baseName(name) {
    return String(name || '').replace(/\.[^./\\]+$/, '');
}

export function dirOf(path) {
    const i = String(path).lastIndexOf('/');
    return i >= 0 ? path.substring(0, i) : path;
}
