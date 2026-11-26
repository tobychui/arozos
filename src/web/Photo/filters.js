/*
    filters.js

    The Sort & filter panel of the Photo gallery (the funnel button at the top
    right). Each control of the panel owns a "slot" and writes its value as
    one search chip carrying that slot, so the chips in the search box stay
    the single description of the search: removing a chip clears its control,
    and every chip is a token backend/imagedb.js parses (see searchPhotos.js
    for the syntax). Chips typed by hand have no slot and are left alone.

    The panel state lives in photoListObject().pf; this file holds the pure
    helpers it uses.
*/

// Panel values with nothing chosen
function photoEmptyPanel() {
    return {
        rating: 0,          // 1-5: that many stars or more, -1: unrated
        from: '', to: '',   // taken between (yyyy-mm-dd)
        camera: '', lens: '',
        types: [],          // extensions
        orient: [],         // landscape / portrait / square
        isoMin: '', isoMax: '',
        fMin: '', fMax: '',
        focalMin: '', focalMax: '',
        shutter: '',        // PHOTO_SHUTTER_PRESETS value
        time: '',           // PHOTO_TIME_PRESETS value
        mpMin: '',
        sizeMin: '', sizeMax: ''   // MB
    };
}

var PHOTO_SHUTTER_PRESETS = [
    { v: 'fast', q: 'shutter:<=1/1000', key: 'shutter/fast', en: 'Faster than 1/1000 s' },
    { v: 'action', q: 'shutter:1/1000..1/250', key: 'shutter/action', en: '1/1000 – 1/250 s' },
    { v: 'normal', q: 'shutter:1/250..1/30', key: 'shutter/normal', en: '1/250 – 1/30 s' },
    { v: 'slow', q: 'shutter:1/30..1', key: 'shutter/slow', en: '1/30 – 1 s' },
    { v: 'long', q: 'shutter:>=1', key: 'shutter/long', en: 'Long exposure (1 s or longer)' }
];

var PHOTO_TIME_PRESETS = [
    { v: 'morning', q: 'hour:5..11', key: 'time/morning', en: 'Morning' },
    { v: 'afternoon', q: 'hour:12..16', key: 'time/afternoon', en: 'Afternoon' },
    { v: 'evening', q: 'hour:17..20', key: 'time/evening', en: 'Evening' },
    { v: 'night', q: 'hour:21..4', key: 'time/night', en: 'Night' }
];

var PHOTO_SORT_OPTIONS = [
    { v: 'smart', key: 'sort/smart', en: 'Natural Order', date: false },
    { v: 'mostRecent', key: 'sort/newest', en: 'Newest First', date: true },
    { v: 'leastRecent', key: 'sort/oldest', en: 'Oldest First', date: true },
    { v: 'default', key: 'sort/nameAsc', en: 'Filename A→Z', date: false },
    { v: 'reverse', key: 'sort/nameDesc', en: 'Filename Z→A', date: false },
    { v: 'smallToLarge', key: 'sort/sizeAsc', en: 'Size Small→Large', date: false },
    { v: 'largeToSmall', key: 'sort/sizeDesc', en: 'Size Large→Small', date: false },
    { v: 'fileTypeAsce', key: 'sort/extAsc', en: 'Extension A→Z', date: false },
    { v: 'fileTypeDesc', key: 'sort/extDesc', en: 'Extension Z→A', date: false }
];

// The searchPhotos.js order of a folder sort mode
function photoBackendSort(sortOrder) {
    switch (sortOrder) {
        case 'leastRecent': return 'taken_asc';
        case 'default': case 'smart': return 'name_asc';
        case 'reverse': return 'name_desc';
        case 'smallToLarge': return 'size_asc';
        case 'largeToSmall': return 'size_desc';
        case 'fileTypeAsce': return 'ext_asc';
        case 'fileTypeDesc': return 'ext_desc';
        default: return 'taken_desc';
    }
}

function photoPresetLabel(list, v) {
    for (var i = 0; i < list.length; i++) {
        if (list[i].v === v) return T(list[i].key, list[i].en);
    }
    return v;
}

function photoPresetQuery(list, v) {
    for (var i = 0; i < list.length; i++) {
        if (list[i].v === v) return list[i].q;
    }
    return '';
}

// A number typed in the panel, or null
function photoNum(v) {
    if (v === null || v === undefined || ('' + v).trim() === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
}

// "key:min..max" / "key:>=min" / "key:<=max", or '' when both are empty
function photoRangeToken(key, min, max, unit) {
    var lo = photoNum(min);
    var hi = photoNum(max);
    unit = unit || '';
    if (lo !== null && hi !== null && lo > hi) { var t = lo; lo = hi; hi = t; }
    if (lo !== null && hi !== null) return key + ':' + lo + unit + '..' + hi + unit;
    if (lo !== null) return key + ':>=' + lo + unit;
    if (hi !== null) return key + ':<=' + hi + unit;
    return '';
}

// "a – b", "≥ a" or "≤ b", each bound passed through fmt
function photoRangeLabel(min, max, fmt) {
    fmt = fmt || function (v) { return '' + v; };
    var lo = photoNum(min);
    var hi = photoNum(max);
    if (lo !== null && hi !== null && lo > hi) { var t = lo; lo = hi; hi = t; }
    if (lo !== null && hi !== null) return lo === hi ? fmt(lo) : fmt(lo) + ' – ' + fmt(hi);
    if (lo !== null) return '≥ ' + fmt(lo);
    if (hi !== null) return '≤ ' + fmt(hi);
    return '';
}

// A yyyy-mm-dd day in the page's language
function photoFormatDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec('' + s);
    if (!m) return '' + s;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return d.toLocaleDateString(localeTag() || undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Name of a camera for lists: the model, with its make in front when the
// model does not already say it ("SONY ILCE-7M4", "Canon EOS R5")
function photoCameraName(model, make) {
    model = '' + (model || '');
    make = ('' + (make || '')).replace(/\s+(corporation|corp\.?|co\.,?\s*ltd\.?|imaging|company)$/i, '').trim();
    if (!make || model.toLowerCase().indexOf(make.toLowerCase().split(' ')[0]) === 0) return model;
    return make + ' ' + model;
}

function photoQuote(v) {
    return '"' + ('' + v).replace(/"/g, '') + '"';
}

// The chips the panel values stand for, in panel order
function photoPanelChips(pf) {
    var chips = [];
    function add(slot, type, label, value) {
        if (value) chips.push({ slot: slot, type: type, label: label, value: value });
    }
    if (pf.rating > 0) {
        add('rating', 'rating', '★ ≥ ' + pf.rating, 'rating:>=' + pf.rating);
    } else if (pf.rating < 0) {
        add('rating', 'rating', T('rating/unrated', 'Unrated'), 'rating:0');
    }
    if (pf.from || pf.to) {
        var dv = pf.from && pf.to ? 'taken:' + (pf.from <= pf.to ? pf.from + '..' + pf.to : pf.to + '..' + pf.from) :
            (pf.from ? 'taken:>=' + pf.from : 'taken:<=' + pf.to);
        var dl = pf.from && pf.to ? photoFormatDay(pf.from <= pf.to ? pf.from : pf.to) + ' – ' + photoFormatDay(pf.from <= pf.to ? pf.to : pf.from) :
            (pf.from ? T('tag/from', 'From {v}', { v: photoFormatDay(pf.from) }) : T('tag/until', 'Until {v}', { v: photoFormatDay(pf.to) }));
        add('taken', 'date', dl, dv);
    }
    if (pf.camera) add('camera', 'camera', pf.camera, 'model:' + photoQuote(pf.camera));
    if (pf.lens) add('lens', 'lens', pf.lens, 'lens:' + photoQuote(pf.lens));
    for (var i = 0; i < pf.types.length; i++) {
        add('type:' + pf.types[i], 'type', '.' + pf.types[i], '.' + pf.types[i]);
    }
    for (var o = 0; o < pf.orient.length; o++) {
        add('orient:' + pf.orient[o], 'filter', photoOrientationLabel(pf.orient[o]), pf.orient[o]);
    }
    add('iso', 'filter', 'ISO ' + photoRangeLabel(pf.isoMin, pf.isoMax), photoRangeToken('iso', pf.isoMin, pf.isoMax));
    add('aperture', 'filter', photoRangeLabel(pf.fMin, pf.fMax, function (v) { return 'f/' + v; }),
        photoRangeToken('aperture', pf.fMin, pf.fMax));
    add('focal', 'filter', photoRangeLabel(pf.focalMin, pf.focalMax) + ' mm', photoRangeToken('focal', pf.focalMin, pf.focalMax));
    if (pf.shutter) add('shutter', 'shutter', photoPresetLabel(PHOTO_SHUTTER_PRESETS, pf.shutter), photoPresetQuery(PHOTO_SHUTTER_PRESETS, pf.shutter));
    if (pf.time) add('time', 'time', photoPresetLabel(PHOTO_TIME_PRESETS, pf.time), photoPresetQuery(PHOTO_TIME_PRESETS, pf.time));
    add('mp', 'filter', photoRangeLabel(pf.mpMin, null) + ' MP', photoRangeToken('mp', pf.mpMin, null));
    add('size', 'size', T('tag/size', 'Size {v}', { v: photoRangeLabel(pf.sizeMin, pf.sizeMax, function (v) { return v + ' MB'; }) }),
        photoRangeToken('size', pf.sizeMin, pf.sizeMax, 'mb'));
    return chips;
}

// Clear the panel control that owns a slot (its chip was removed)
function photoClearPanelSlot(pf, slot) {
    var k = ('' + slot).split(':');
    switch (k[0]) {
        case 'rating': pf.rating = 0; break;
        case 'taken': pf.from = ''; pf.to = ''; break;
        case 'camera': pf.camera = ''; break;
        case 'lens': pf.lens = ''; break;
        case 'type': pf.types = pf.types.filter(function (t) { return t !== k[1]; }); break;
        case 'orient': pf.orient = pf.orient.filter(function (t) { return t !== k[1]; }); break;
        case 'iso': pf.isoMin = ''; pf.isoMax = ''; break;
        case 'aperture': pf.fMin = ''; pf.fMax = ''; break;
        case 'focal': pf.focalMin = ''; pf.focalMax = ''; break;
        case 'shutter': pf.shutter = ''; break;
        case 'time': pf.time = ''; break;
        case 'mp': pf.mpMin = ''; break;
        case 'size': pf.sizeMin = ''; pf.sizeMax = ''; break;
    }
}

// How many panel controls are set (the badge on the funnel button)
function photoPanelCount(pf) {
    var groups = {};
    var chips = photoPanelChips(pf);
    for (var i = 0; i < chips.length; i++) groups[chips[i].slot.split(':')[0]] = true;
    return Object.keys(groups).length;
}

// "1.2 MB" style size
function photoFormatBytes(n) {
    n = n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}
