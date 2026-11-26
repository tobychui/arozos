/*
    search.js

    Front-end helpers for the Photo search feature. The reactive state and the
    Alpine methods live in photoListObject() (photo.js); this file only holds the
    pure helpers they delegate to, so the search logic stays out of the big
    component object.

    Backend endpoints used (all under system/ajgi/interface):
      Photo/backend/searchPhotos.js   - run a search
      Photo/backend/searchSuggest.js  - autocomplete suggestions
      Photo/backend/indexPhotos.js    - incremental (auto) indexing
      Photo/backend/indexStatus.js    - index statistics
*/

// POST a JSON payload to a Photo AGI backend script and resolve with parsed JSON.
function aoPhotoBackend(script, payload) {
    return fetch(ao_root + "system/ajgi/interface?script=" + script, {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
    }).then(function (resp) {
        return resp.json();
    });
}

// Map a suggestion type to a Semantic-UI icon class.
function photoSuggestIcon(type) {
    switch (type) {
        case 'camera':
            return 'camera';
        case 'lens':
            return 'expand';
        case 'date':
            return 'calendar alternate outline';
        case 'type':
            return 'file image outline';
        case 'file':
            return 'image outline';
        case 'filter':
            return 'filter';
        case 'rating':
            return 'star';
        case 'folder':
            return 'folder outline';
        case 'shutter':
            return 'stopwatch';
        case 'size':
            return 'hdd outline';
        case 'time':
            return 'clock outline';
        default:
            return 'search';
    }
}

// The label of a preset token (shutter / time of day), or null
function photoPresetTokenLabel(value) {
    var lists = [PHOTO_SHUTTER_PRESETS, PHOTO_TIME_PRESETS];
    for (var l = 0; l < lists.length; l++) {
        for (var i = 0; i < lists[l].length; i++) {
            if (lists[l][i].q === value) return T(lists[l][i].key, lists[l][i].en);
        }
    }
    return null;
}

// "1 MB", "500 KB": a size bound as typed (MB when it has no unit)
function photoSizeBoundLabel(s) {
    var m = /^([0-9.]+)\s*(b|k|kb|m|mb|g|gb)?$/i.exec(('' + s).trim());
    if (!m) return '' + s;
    var u = (m[2] || 'mb').toLowerCase();
    var unit = u === 'b' ? 'B' : (u.charAt(0) === 'k' ? 'KB' : (u.charAt(0) === 'g' ? 'GB' : 'MB'));
    return m[1] + ' ' + unit;
}

// Label of a range value as typed after "key:" (">=1", "1/250..1/30", "5-10")
function photoTypedRangeLabel(val, fmt) {
    fmt = fmt || function (v) { return v; };
    var s = ('' + val).trim(), m;
    if ((m = /^>=?\s*(.+)$/.exec(s))) return '≥ ' + fmt(m[1]);
    if ((m = /^<=?\s*(.+)$/.exec(s))) return '≤ ' + fmt(m[1]);
    if ((m = /^(.+?)\.\.(.+)$/.exec(s)) || (m = /^([^\-]+)-([^\-]+)$/.exec(s))) return fmt(m[1]) + ' – ' + fmt(m[2]);
    return fmt(s);
}

// Title-case a single word.
function photoCap(s) {
    s = '' + s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

var PHOTO_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
var PHOTO_MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function photoMonthNameToNum(s) {
    s = ('' + s).trim().toLowerCase();
    var i = PHOTO_MONTHS.findIndex(function (m) { return m.toLowerCase() === s; });
    if (i >= 0) return i + 1;
    i = PHOTO_MONTHS_ABBR.indexOf(s);
    if (i >= 0) return i + 1;
    var n = parseInt(s);
    if (!isNaN(n) && n >= 1 && n <= 12) return n;
    return null;
}

// Month name in the page's language, month 1-12 (the query keeps the number)
function photoMonthName(month) {
    return new Date(2000, month - 1, 1).toLocaleDateString(localeTag() || 'en-us', { month: 'long' });
}

// Label of an orientation filter; the query value stays the English word
function photoOrientationLabel(value) {
    var names = {
        landscape: T('orient/landscape', 'Landscape'),
        portrait: T('orient/portrait', 'Portrait'),
        square: T('orient/square', 'Square')
    };
    return names[('' + value).toLowerCase()] || photoCap(value);
}

// searchSuggest.js answers with English labels and hints. Translate those that
// are not data (camera, lens and file names stay as they are), never the value.
function photoLocalizeSuggestion(s) {
    var label = s.label, hint = s.hint, m;
    if (s.type === 'filter' && (label === 'Landscape' || label === 'Portrait')) {
        label = photoOrientationLabel(label);
    } else if (s.type === 'rating' && (m = /^(\d)★ & up$/.exec(label))) {
        label = T('suggest/andUp', '{n}★ & up', { n: m[1] });
    } else if (s.type === 'date' && (m = /month:(\d+)$/.exec(s.value))) {
        label = photoMonthName(parseInt(m[1], 10));
    } else if (s.type === 'shutter' || s.type === 'size' || s.type === 'time') {
        label = photoParseTagToken(s.value.split(' ').pop().replace(/^-/, '')).label;
    }
    if (/(^|\s)-\S/.test(s.value) && s.type !== 'file') {
        label = T('tag/not', 'Not {v}', { v: label });
    }
    if (hint === 'orientation') {
        hint = T('suggest/orientation', 'orientation');
    } else if (hint === 'file name') {
        hint = T('suggest/fileName', 'file name');
    } else if ((m = /^(\d+) photos$/.exec(hint))) {
        hint = T('suggest/photos', '{n} photos', { n: m[1] });
    }
    return { type: s.type, label: label, value: s.value, hint: hint };
}

// Turn a raw query token the user typed into a display tag {label, value, type}.
// `value` is always a token that the backend query parser understands; `label`
// is the friendly text shown on the chip; `type` drives the chip icon/colour.
function photoParseTagToken(token) {
    token = ('' + token).trim();
    // "-token" leaves out what the token matches
    if (token.length > 1 && token.charAt(0) === '-') {
        var inner = photoParseTagToken(token.substring(1));
        return { label: T('tag/not', 'Not {v}', { v: inner.label }), value: '-' + inner.value, type: inner.type, neg: true };
    }
    var preset = photoPresetTokenLabel(token);
    if (preset) {
        return { label: preset, value: token, type: token.indexOf('hour:') === 0 ? 'time' : 'shutter' };
    }
    var lower = token.toLowerCase();
    var colon = token.indexOf(':');
    var key = colon > 0 ? lower.substring(0, colon) : '';
    var val = colon > 0 ? token.substring(colon + 1) : '';
    function unq(s) { return ('' + s).replace(/^"(.*)"$/, '$1'); }

    var fm = lower.match(/^f\/?(\d+(?:\.\d+)?)$/);
    if (colon < 0 && fm) return { label: 'f/' + fm[1], value: 'f/' + fm[1], type: 'filter' };
    var fmm = lower.match(/^(\d+(?:\.\d+)?)mm$/);
    if (colon < 0 && fmm) return { label: fmm[1] + 'mm', value: fmm[1] + 'mm', type: 'filter' };
    if (colon < 0 && lower.charAt(0) === '.') return { label: lower, value: lower, type: 'type' };
    if (colon < 0 && (lower === 'landscape' || lower === 'portrait' || lower === 'square'))
        return { label: photoOrientationLabel(lower), value: lower, type: 'filter' };
    if (colon < 0 && lower === 'raw') return { label: 'RAW', value: 'raw', type: 'type' };
    var mn = (colon < 0) ? photoMonthNameToNum(lower) : null;
    if (colon < 0 && mn && /^[a-z]+$/.test(lower)) return { label: photoMonthName(mn), value: 'month:' + mn, type: 'date' };
    if (colon < 0 && /^\d{4}$/.test(lower)) return { label: lower, value: lower, type: 'date' };

    if (colon > 0) {
        switch (key) {
            case 'iso': return { label: 'ISO ' + val, value: 'iso:' + val, type: 'filter' };
            case 'rating': case 'stars': case 'star': {
                var rv = unq(val).replace(/★|\*/g, '').trim();
                var label;
                var mge = rv.match(/^>=?\s*(\d)/);
                var mle = rv.match(/^<=?\s*(\d)/);
                if (mge) { label = '★ ≥ ' + mge[1]; }
                else if (mle) { label = '★ ≤ ' + mle[1]; }
                else if (/^\d$/.test(rv)) { label = rv + '★'; }
                else { label = T('tag/rating', 'Rating {v}', { v: rv }); }
                return { label: label, value: 'rating:' + rv, type: 'rating' };
            }
            case 'f': case 'aperture': case 'fnumber': return { label: 'f/' + val.replace(/^\//, ''), value: token, type: 'filter' };
            case 'focal': case 'fl': return { label: val.replace(/mm$/i, '') + 'mm', value: token, type: 'filter' };
            case 'mp': case 'megapixels': return { label: val + ' MP', value: token, type: 'filter' };
            case 'width': case 'w': return { label: T('tag/width', 'Width {v}', { v: val }), value: token, type: 'filter' };
            case 'height': case 'h': return { label: T('tag/height', 'Height {v}', { v: val }), value: token, type: 'filter' };
            case 'model': case 'camera': return { label: unq(val), value: token, type: 'camera' };
            case 'make': case 'brand': return { label: unq(val), value: token, type: 'camera' };
            case 'lens': return { label: unq(val), value: token, type: 'lens' };
            case 'ext': case 'type':
                return {
                    label: unq(val).split(',').map(function (e) {
                        e = e.trim().replace(/^\./, '');
                        return e.toLowerCase() === 'raw' ? 'RAW' : '.' + e;
                    }).join(', '),
                    value: token, type: 'type'
                };
            case 'shutter': case 'exposure': case 'ss':
                return { label: photoTypedRangeLabel(unq(val), function (v) { return ('' + v).replace(/s$/i, '') + ' s'; }), value: token, type: 'shutter' };
            case 'size': case 'filesize':
                return { label: T('tag/size', 'Size {v}', { v: photoTypedRangeLabel(unq(val), photoSizeBoundLabel) }), value: token, type: 'size' };
            case 'hour': case 'time':
                return { label: photoTypedRangeLabel(unq(val), function (v) { return v + ':00'; }), value: token, type: 'time' };
            case 'folder': case 'in': {
                var fv = unq(val).replace(/\/+$/, '');
                return { label: fv.split('/').pop() || fv, value: token, type: 'folder' };
            }
            case 'name': case 'filename': return { label: unq(val), value: token, type: 'file' };
            case 'orientation': return { label: photoOrientationLabel(unq(val)), value: token, type: 'filter' };
            case 'month':
                var ms = ('' + val).split(',').map(function (x) { var n = photoMonthNameToNum(x); return n ? photoMonthName(n) : x; });
                return { label: ms.join(', '), value: token, type: 'date' };
            case 'taken': case 'date': case 'year': return { label: unq(val), value: token, type: 'date' };
            case 'modified': case 'mtime': return { label: T('tag/modified', 'Modified {v}', { v: unq(val) }), value: token, type: 'date' };
            case 'before': return { label: T('tag/before', 'Before {v}', { v: unq(val) }), value: token, type: 'date' };
            case 'after': return { label: T('tag/after', 'After {v}', { v: unq(val) }), value: token, type: 'date' };
            default: return { label: token, value: token, type: 'search' };
        }
    }
    return { label: token, value: token, type: 'search' };
}

// Whether the current input token can be committed as a chip on space:
// non-empty, not waiting for a value ("iso:"), and not inside an open quote.
function photoInputCommittable(s) {
    s = ('' + s).trim();
    if (s.length === 0) return false;
    if (s.charAt(s.length - 1) === ':') return false;
    if (((s.match(/"/g) || []).length) % 2 !== 0) return false;
    return true;
}

// Simple debounce used for the autocomplete fetch.
function photoDebounce(fn, ms) {
    var timer = null;
    return function () {
        var ctx = this;
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {
            fn.apply(ctx, args);
        }, ms);
    };
}
