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
        default:
            return 'search';
    }
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

// Turn a raw query token the user typed into a display tag {label, value, type}.
// `value` is always a token that the backend query parser understands; `label`
// is the friendly text shown on the chip; `type` drives the chip icon/colour.
function photoParseTagToken(token) {
    token = ('' + token).trim();
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
        return { label: photoCap(lower), value: lower, type: 'filter' };
    if (colon < 0 && lower === 'raw') return { label: 'RAW', value: 'raw', type: 'type' };
    var mn = (colon < 0) ? photoMonthNameToNum(lower) : null;
    if (colon < 0 && mn && /^[a-z]+$/.test(lower)) return { label: PHOTO_MONTHS[mn - 1], value: 'month:' + mn, type: 'date' };
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
                else { label = 'Rating ' + rv; }
                return { label: label, value: 'rating:' + rv, type: 'rating' };
            }
            case 'f': case 'aperture': case 'fnumber': return { label: 'f/' + val.replace(/^\//, ''), value: token, type: 'filter' };
            case 'focal': case 'fl': return { label: val.replace(/mm$/i, '') + 'mm', value: token, type: 'filter' };
            case 'mp': case 'megapixels': return { label: val + ' MP', value: token, type: 'filter' };
            case 'width': case 'w': return { label: 'Width ' + val, value: token, type: 'filter' };
            case 'height': case 'h': return { label: 'Height ' + val, value: token, type: 'filter' };
            case 'model': case 'camera': return { label: unq(val), value: token, type: 'camera' };
            case 'make': case 'brand': return { label: unq(val), value: token, type: 'camera' };
            case 'lens': return { label: unq(val), value: token, type: 'lens' };
            case 'ext': case 'type': return { label: '.' + unq(val).replace(/^\./, ''), value: token, type: 'type' };
            case 'name': case 'filename': return { label: unq(val), value: token, type: 'file' };
            case 'orientation': return { label: photoCap(unq(val)), value: token, type: 'filter' };
            case 'month':
                var ms = ('' + val).split(',').map(function (x) { var n = photoMonthNameToNum(x); return n ? PHOTO_MONTHS[n - 1] : x; });
                return { label: ms.join(', '), value: token, type: 'date' };
            case 'taken': case 'date': case 'year': return { label: unq(val), value: token, type: 'date' };
            case 'modified': case 'mtime': return { label: 'Modified ' + unq(val), value: token, type: 'date' };
            case 'before': return { label: 'Before ' + unq(val), value: token, type: 'date' };
            case 'after': return { label: 'After ' + unq(val), value: token, type: 'date' };
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
