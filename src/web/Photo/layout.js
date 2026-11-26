/*
    layout.js

    Gallery layout helpers for the Photo grid, used by photoListObject()
    (photo.js):

      - zoom: five steps, each a target tile width; the column count follows
        the width of the gallery
      - timeline: Day / Month / Year sections keyed by the date a photo was
        taken (EXIF times are the camera's clock, stored as UTC, so they are
        read back in UTC; file times are real instants, read in local time)
      - waterfall: photos keep their shape and are dealt into equal width
        columns, each to the shortest column so far
      - PhotoPreviews: loads the upright, uncropped previews the waterfall
        shows (backend/previews.js) for the cards that scroll into view

    Ratios learnt from previews live outside Alpine (photoRatioOf), so a
    preview arriving does not re-render the gallery by itself; the component
    batches a relayout instead.
*/

// Target tile width (CSS px) of each zoom step, small to large
var PHOTO_ZOOM_STEPS = [96, 136, 190, 260, 360];
var PHOTO_ZOOM_DEFAULT = 2;
var PHOTO_MAX_COLUMNS = 20;
var PHOTO_GAP = 3;

// Columns for a gallery width at a zoom step
function photoColumnCount(width, zoomLevel) {
    var target = PHOTO_ZOOM_STEPS[Math.max(0, Math.min(PHOTO_ZOOM_STEPS.length - 1, zoomLevel))];
    if (!width || width <= 0) {
        width = Math.max(320, window.innerWidth - 210);
    }
    var cols = Math.round(width / target);
    return Math.max(1, Math.min(PHOTO_MAX_COLUMNS, cols));
}

// ── Dates ─────────────────────────────────────────────────────────────────────

// The date a grid item stands for: {t: unix seconds, utc: bool} or null.
// taken_date comes from the index (EXIF clock time stored as UTC); mtime is a
// real instant, used for photos the indexer has not reached yet.
function photoImageDate(img) {
    if (!img) return null;
    if (img.taken_date) return { t: img.taken_date, utc: true };
    if (img.mtime) return { t: img.mtime, utc: false };
    if (img.modified_date) return { t: img.modified_date, utc: false };
    return null;
}

// Kept for the code that only needs a number to sort by
function photoImageDateUnix(img) {
    var d = photoImageDate(img);
    return d ? d.t : null;
}

// Sort key that orders UTC clock times and local instants together
function photoDateSortKey(img) {
    var d = photoImageDate(img);
    if (!d) return 0;
    return d.utc ? d.t : d.t - new Date(d.t * 1000).getTimezoneOffset() * 60;
}

function sortImagesByDate(arr, ascending) {
    return arr.slice().sort(function (a, b) {
        var ka = photoDateSortKey(a);
        var kb = photoDateSortKey(b);
        if (ka === kb) {
            return a.filepath < b.filepath ? -1 : (a.filepath > b.filepath ? 1 : 0);
        }
        return ascending ? ka - kb : kb - ka;
    });
}

// Newest first (kept for older callers)
function sortImagesByDateDesc(arr) {
    return sortImagesByDate(arr, false);
}

// Section {key, label} of an item for a timeline mode ('day' | 'month' | 'year')
function photoTimelineSection(img, mode) {
    var d = photoImageDate(img);
    if (!d) {
        return { key: 'undated', label: T('grid/undated', 'Undated') };
    }
    var dt = new Date(d.t * 1000);
    if (isNaN(dt.getTime())) {
        return { key: 'undated', label: T('grid/undated', 'Undated') };
    }
    var y = d.utc ? dt.getUTCFullYear() : dt.getFullYear();
    var m = d.utc ? dt.getUTCMonth() : dt.getMonth();
    var day = d.utc ? dt.getUTCDate() : dt.getDate();
    var lang = localeTag() || undefined;
    // Format the calendar date itself, whatever zone it was read in
    var labelDate = new Date(Date.UTC(y, m, day, 12));
    var opts = { timeZone: 'UTC' };
    if (mode === 'year') {
        opts.year = 'numeric';
        return { key: '' + y, label: labelDate.toLocaleDateString(lang, opts) };
    }
    if (mode === 'day') {
        opts.weekday = 'short';
        opts.year = 'numeric';
        opts.month = 'long';
        opts.day = 'numeric';
        return { key: y + '-' + (m + 1) + '-' + day, label: labelDate.toLocaleDateString(lang, opts) };
    }
    opts.year = 'numeric';
    opts.month = 'long';
    return { key: y + '-' + (m + 1), label: labelDate.toLocaleDateString(lang, opts) };
}

// ── Waterfall ─────────────────────────────────────────────────────────────────

// Width / height ratios learnt from loaded previews, by file path
var photoRatioOverrides = {};

// Shape of a photo: the preview's when known, else the index's, else 4:3
function photoRatioOf(img) {
    var r = photoRatioOverrides[img.filepath];
    if (r) return r;
    if (img.width && img.height) return img.width / img.height;
    return 4 / 3;
}

// Deal items into `cols` columns, each to the column that is shortest so far.
// Heights are compared for equal column widths, so 1 / ratio is enough.
function photoMasonry(items, cols) {
    var columns = [];
    var heights = [];
    for (var c = 0; c < cols; c++) {
        columns.push({ key: 'c' + c, items: [] });
        heights.push(0);
    }
    for (var i = 0; i < items.length; i++) {
        var best = 0;
        for (var k = 1; k < cols; k++) {
            if (heights[k] < heights[best] - 1e-6) best = k;
        }
        var ratio = photoRatioOf(items[i]);
        // Keep extreme panoramas / strips readable
        ratio = Math.max(0.25, Math.min(4, ratio));
        columns[best].items.push(items[i]);
        heights[best] += 1 / ratio;
    }
    return columns;
}

// ── Previews for the waterfall ────────────────────────────────────────────────

var PhotoPreviews = {
    ready: {},          // filepath -> {url, w, h} or {failed: true}
    elements: {},       // filepath -> [img elements waiting for it]
    lookupQueue: [],
    lookupTimer: null,
    generateQueue: [],
    queued: {},         // filepath -> true while looked up / generating
    active: 0,
    maxActive: 2,
    batchSize: 3,
    mode: '',
    observer: null,
    failures: 0,        // generate requests failed in a row
    generation: 0,      // bumps on reset, so late answers are dropped
    onSize: null,       // function(filepath, w, h) set by the component

    url: function (filepath) {
        var r = this.ready[filepath];
        return r && r.url ? r.url : null;
    },

    // Watch a card image: load its preview when it comes near the viewport
    observe: function (el, filepath) {
        var self = this;
        el.setAttribute('data-preview', filepath);
        if (this.ready[filepath]) {
            this.apply(el, filepath);
            return;
        }
        if (!this.observer) {
            var root = document.getElementById('viewboxContainer');
            this.observer = new IntersectionObserver(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                    if (!entries[i].isIntersecting) continue;
                    var target = entries[i].target;
                    self.observer.unobserve(target);
                    self.want(target, target.getAttribute('data-preview'));
                }
            }, { root: root, rootMargin: '800px 0px' });
        }
        this.observer.observe(el);
    },

    unobserve: function (el) {
        if (this.observer) this.observer.unobserve(el);
    },

    // Show the preview of a card. The blurred thumbnail stays until the
    // preview has really loaded; a photo without preview shows it sharp.
    apply: function (el, filepath) {
        var r = this.ready[filepath];
        if (!r || el.getAttribute('data-preview') !== filepath) return;
        if (!r.url) {
            el.classList.remove('pv-pending');
            return;
        }
        el.classList.add('is-preview');
        if (el.getAttribute('src') === r.url) {
            if (el.complete) el.classList.remove('pv-pending');
            return;
        }
        var done = function () { el.classList.remove('pv-pending'); };
        el.addEventListener('load', done, { once: true });
        el.addEventListener('error', done, { once: true });
        el.setAttribute('src', r.url);
    },

    want: function (el, filepath) {
        if (!filepath) return;
        if (this.ready[filepath]) {
            this.apply(el, filepath);
            return;
        }
        if (!this.elements[filepath]) this.elements[filepath] = [];
        this.elements[filepath].push(el);
        if (this.queued[filepath]) return;
        this.queued[filepath] = true;
        this.lookupQueue.push(filepath);
        var self = this;
        clearTimeout(this.lookupTimer);
        this.lookupTimer = setTimeout(function () { self.flushLookups(); }, 60);
    },

    flushLookups: function () {
        var self = this;
        var gen = this.generation;
        while (this.lookupQueue.length) {
            (function (batch) {
                aoPhotoBackend('Photo/backend/previews.js', { files: batch, generate: false }).then(function (data) {
                    if (gen !== self.generation) return;
                    self.mode = (data && data.mode) || self.mode;
                    var items = (data && data.items) || {};
                    for (var f in items) {
                        if (items[f].pending) {
                            self.generateQueue.push(f);
                        } else {
                            self.store(f, items[f]);
                        }
                    }
                    self.pump();
                }).catch(function () {
                    // Show these thumbnails sharp instead of blurred
                    if (gen !== self.generation) return;
                    for (var i = 0; i < batch.length; i++) self.store(batch[i], { error: 'failed' });
                });
            })(this.lookupQueue.splice(0, 200));
        }
    },

    pump: function () {
        var self = this;
        while (this.active < this.maxActive && this.generateQueue.length) {
            this.active++;
            (function (batch, gen) {
                aoPhotoBackend('Photo/backend/previews.js', { files: batch, generate: true }).then(function (data) {
                    if (gen !== self.generation) return;
                    self.failures = 0;
                    var items = (data && data.items) || {};
                    for (var f in items) self.store(f, items[f]);
                }).catch(function () {
                    if (gen !== self.generation) return;
                    // Keep the thumbnails of this batch; after a few failed
                    // requests in a row stop asking (the server cannot draw)
                    for (var i = 0; i < batch.length; i++) self.store(batch[i], { error: 'failed' });
                    self.failures++;
                    if (self.failures >= 3) {
                        var rest = self.generateQueue.splice(0);
                        for (var k = 0; k < rest.length; k++) self.store(rest[k], { error: 'failed' });
                    }
                }).then(function () {
                    if (gen !== self.generation) return;
                    self.active--;
                    self.pump();
                });
            })(this.generateQueue.splice(0, this.batchSize), this.generation);
        }
    },

    store: function (filepath, item) {
        delete this.queued[filepath];
        if (!item || item.error || item.pending) {
            this.ready[filepath] = { failed: true };
        } else {
            var url = item.dataURL ? item.dataURL :
                ao_root + 'media?file=' + encodeURIComponent(item.src) + '&v=' + (item.v || 0);
            this.ready[filepath] = { url: url, w: item.w, h: item.h };
            this.trim();
            if (this.onSize && item.w && item.h) this.onSize(filepath, item.w, item.h);
        }
        var els = this.elements[filepath] || [];
        delete this.elements[filepath];
        for (var i = 0; i < els.length; i++) {
            if (els[i].isConnected) this.apply(els[i], filepath);
        }
        // Cards rendered again since they asked
        var again = document.querySelectorAll('#viewbox img[data-preview]');
        for (var k = 0; k < again.length; k++) {
            if (again[k].getAttribute('data-preview') === filepath) this.apply(again[k], filepath);
        }
    },

    // Realtime previews are data URLs held in memory: keep the newest 400
    trim: function () {
        if (this.mode !== 'realtime') return;
        var keys = Object.keys(this.ready);
        var over = keys.length - 400;
        for (var i = 0; i < keys.length && over > 0; i++) {
            if (this.ready[keys[i]].url && this.ready[keys[i]].url.indexOf('data:') === 0) {
                delete this.ready[keys[i]];
                over--;
            }
        }
    },

    // Forget everything (settings changed or cache cleared) and ask again for
    // the cards on the page
    reset: function () {
        this.generation++;
        this.ready = {};
        this.elements = {};
        this.lookupQueue = [];
        this.generateQueue = [];
        this.queued = {};
        this.active = 0;
        this.failures = 0;
        clearTimeout(this.lookupTimer);
        var imgs = document.querySelectorAll('#viewbox img[data-preview]');
        for (var i = 0; i < imgs.length; i++) {
            imgs[i].classList.remove('is-preview');
            imgs[i].classList.add('pv-pending');
            var thumb = imgs[i].getAttribute('data-thumb');
            if (thumb) imgs[i].setAttribute('src', thumb);
            this.observe(imgs[i], imgs[i].getAttribute('data-preview'));
        }
    }
};
