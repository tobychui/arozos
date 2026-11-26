/*
    Photo.js

    Author: tobychui
    This is a complete rewrite of the legacy Photo module for ArozOS

*/

// Number of photos to load per page (infinite scroll batch size)
const PAGE_SIZE = 40; //large enough to fill the whole page on load, but small enough to keep initial load fast and responsive

let photoList = [];
let prePhoto = "";
let nextPhoto = "";
let currentModel = "";
let currentPhotoAllIndex = -1; // index of current photo in allImages (full server list)
let currentPhotoFilepath = null; // filepath of the photo open in the viewer (download / rating)
let currentPhotoRating = 0;      // star rating (0-5) of the open photo
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Check if image should use compression (only JPG/PNG)
function shouldUseCompression(filepath, filesize) {
    const ext = filepath.split('.').pop().toLowerCase();
    const isJpgOrPng = (ext === 'jpg' || ext === 'jpeg' || ext === 'png');
    const COMPRESSION_THRESHOLD = 5 * 1024 * 1024; // 5MB
    return isJpgOrPng && filesize && filesize > COMPRESSION_THRESHOLD;
}

// Get viewable image URL (handles RAW files)
function getViewableImageUrl(filepath, callback) {
    // Both RAW and regular images now use backend rendering
    const imageUrl = "../media?file=" + encodeURIComponent(filepath);
    callback(imageUrl, true, false, isRawImage(filepath) ? 'backend_raw' : 'direct');
}

// The running gallery component, or null before Alpine has started
function photoApp(){
    const el = document.querySelector('[x-data*="photoListObject"]');
    return (el && el._x_dataStack) ? el._x_dataStack[0] : null;
}

// Called on window resizes (and by older markup): the gallery measures its
// width again, which sets the column count
function updateImageSizes(){
    const app = photoApp();
    if (app) app.measureGallery();
}

// Briefly show the current columns-per-row while zooming the grid.
let _gridZoomHintTimer = null;
function showGridZoomHint(cols){
    const el = document.getElementById('grid-zoom-snackbar');
    if (!el) return;
    el.textContent = T('grid/perRow', '{n} per row', { n: cols });
    el.classList.add('visible');
    clearTimeout(_gridZoomHintTimer);
    _gridZoomHintTimer = setTimeout(function(){ el.classList.remove('visible'); }, 1100);
}

function extractFolderName(folderpath){
    return folderpath.split("/").pop();
}

function parseExifValue(value) {
    if (typeof value === 'string' && value.includes('/')) {
        let parts = value.split('/');
        if (parts.length === 2) {
            let num = parseFloat(parts[0]);
            let den = parseFloat(parts[1]);
            if (den !== 0) {
                return num / den;
            }
        }
    }
    return parseFloat(value) || value;
}

function formatShutterSpeed(value) {
    let num = parseExifValue(value);
    if (num < 1) {
        return "1/" + Math.round(1 / num);
    } else {
        return num ;
    }
}

// View choices kept between visits (this browser)
const PHOTO_PREFS_KEY = 'ao-photo-view';
const PHOTO_TIMELINES = ['none', 'day', 'month', 'year'];

function photoLoadPrefs(){
    try {
        return JSON.parse(localStorage.getItem(PHOTO_PREFS_KEY)) || {};
    } catch (e) {
        return {};
    }
}

// Ratios the index knows for the photos on show (not reactive)
let photoIndexRatios = {};

// Messages of photoSettings.js errors
function photoSettingsError(code){
    switch (code) {
        case 'not a folder path': return T('settings/errPath', 'Pick a folder.');
        case 'folder not found': return T('settings/errMissing', 'That folder does not exist.');
        case 'folder is read only': return T('settings/errReadOnly', 'You cannot write to that folder.');
        case 'folder is inside the photo library': return T('settings/errLibrary', 'Pick a folder outside the Photo library, or the previews would show up as photos.');
        case 'index unavailable': return T('settings/errIndex', 'The photo index cannot be opened.');
        default: return code;
    }
}

function photoListObject() {
    const prefs = photoLoadPrefs();
    return {
        // data
        pathWildcard: "user:/Photo/*",
        currentPath: "user:/Photo",
        vroots: [],
        allImages: [],       // full list from server
        images: [],           // currently displayed slice
        folders: [],
        restored: false,
        hasMoreImages: false,
        isLoadingMore: false, // guard: blocks new batch until DOM has updated
        sidebarOpen: !isMobile,  // start hidden on mobile, visible on desktop

        // view (top right "view" menu), kept in localStorage
        sortOrder: PHOTO_SORT_OPTIONS.some(o => o.v === prefs.sortOrder) ? prefs.sortOrder : 'smart',
        timeline: PHOTO_TIMELINES.includes(prefs.timeline) ? prefs.timeline : 'month',
        layout: prefs.layout === 'waterfall' ? 'waterfall' : 'grid',
        zoomLevel: Number.isInteger(prefs.zoomLevel) ? Math.max(0, Math.min(PHOTO_ZOOM_STEPS.length - 1, prefs.zoomLevel)) : PHOTO_ZOOM_DEFAULT,
        containerWidth: 0,
        layoutTick: 0,        // bumps when preview shapes arrive (waterfall relayout)
        openMenu: '',         // '' | 'filter' | 'view'

        // filter panel (top right funnel); its controls write search chips
        scope: prefs.scope === 'all' ? 'all' : 'folder',
        pf: photoEmptyPanel(),
        showAdvanced: false,
        facets: null,
        facetsKey: '',
        facetsLoading: false,

        // search state (tags input)
        searchTags: [],         // chips: {label, value, type, slot?, neg?}
        searchInput: '',        // text currently being typed in the box
        searchMode: false,      // true while showing search results instead of a folder
        suggestions: [],
        showSuggestions: false,
        suggestIndex: -1,       // keyboard-highlighted suggestion (-1 = none)
        searchTotal: 0,
        indexing: false,
        indexStatusText: '',
        _suggestTimer: null,
        _searchTimer: null,
        _searchSeq: 0,
        _relayoutTimer: null,

        // settings dialog (gear)
        settingsOpen: false,
        settings: {
            loaded: false, mode: 'realtime', path: '', dir: '', defaultDir: '',
            stats: null, statsLoading: false, error: '', busy: false,
            total: 0, lastIndexed: 0, exclude: [], excludeInput: ''
        },

        // init
        init() {
            this.getFolderInfo();
            this.getRootInfo();
            this.restored = false;
            this.$nextTick(() => {
                this.measureGallery();
                this.setupInfiniteScroll();
                this.setupGridZoom();
                this.setupResizeWatch();
            });
            PhotoPreviews.onSize = (fp, w, h) => this.onPreviewSize(fp, w, h);
            ['sortOrder', 'timeline', 'layout', 'zoomLevel', 'scope'].forEach(k => {
                this.$watch(k, () => this.savePrefs());
            });

            // Kick off background (auto) indexing shortly after the first paint so
            // it doesn't compete with the initial folder load.
            setTimeout(() => { this.startAutoIndex(); }, 1200);

            const MOBILE_BP = 768;
            let _prevMobile = window.innerWidth <= MOBILE_BP;
            let _resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(_resizeTimer);
                _resizeTimer = setTimeout(() => {
                    this.measureGallery();
                    // Auto-manage sidebar visibility on breakpoint crossing
                    const nowMobile = window.innerWidth <= MOBILE_BP;
                    if (nowMobile !== _prevMobile) {
                        this.sidebarOpen = false;
                    }
                    _prevMobile = nowMobile;
                }, 80);
            });
        },

        savePrefs() {
            try {
                localStorage.setItem(PHOTO_PREFS_KEY, JSON.stringify({
                    sortOrder: this.sortOrder, timeline: this.timeline, layout: this.layout,
                    zoomLevel: this.zoomLevel, scope: this.scope
                }));
            } catch (e) { /* private mode: keep for this visit only */ }
        },

        updateRenderingPath(newPath, callback = null){
            this.currentPath = JSON.parse(JSON.stringify(newPath));
            this.pathWildcard = newPath + '/*';
            this.restored = false;
            if (isMobile) this.sidebarOpen = false;
            const box = document.getElementById('viewboxContainer');
            if (box) box.scrollTop = 0;
            if (this.searchMode) {
                if (this.scope === 'folder') {
                    // Keep the filters, now for the new folder
                    this.facets = null;
                    this.runSearch();
                } else {
                    // Browsing a folder ends a search over every photo
                    this.clearSearch(true);
                }
            }
            this.getFolderInfo(callback);
        },

        // Returns path segments for the sidebar breadcrumb tree
        getPathSegments() {
            const parts = this.currentPath.split('/');
            let segments = [];
            let accumulated = '';
            for (let i = 0; i < parts.length; i++) {
                accumulated = i === 0 ? parts[0] : accumulated + '/' + parts[i];
                segments.push({ name: parts[i], path: accumulated, depth: i, isDiskRoot: i === 0 });
            }
            return segments;
        },

        // Whether the photos are ordered by the date they were taken (the
        // timeline needs it; "newest / oldest first" ask for it)
        needsDateSort() {
            return this.timeline !== 'none' || this.sortOrder === 'mostRecent' || this.sortOrder === 'leastRecent';
        },

        orderImages(list) {
            if (this.needsDateSort()) return sortImagesByDate(list, this.sortOrder === 'leastRecent');
            return list;
        },

        // Show a new list of photos (folder content or search results)
        setImages(list) {
            photoIndexRatios = {};
            for (let i = 0; i < list.length; i++) {
                if (list[i].width && list[i].height) photoIndexRatios[list[i].filepath] = list[i].width / list[i].height;
            }
            this.allImages = list;
            this.images = list.slice(0, PAGE_SIZE);
            this.hasMoreImages = list.length > PAGE_SIZE;
            this.isLoadingMore = false;
            if (list.length == 0) { $("#noimg").show(); } else { $("#noimg").hide(); }
            this.$nextTick(() => this.ensureFilled());
        },

        getFolderInfo(callback = null) {
            const path = this.currentPath;
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listFolder.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "folder": this.pathWildcard,
                    // Dates are sorted here, by the date taken
                    "sort": this.needsDateSort() ? 'smart' : this.sortOrder
                })
            }).then(resp => resp.json()).then(data => {
                if (path !== this.currentPath) return; // navigated on meanwhile
                this.folders = data[0];
                if (!this.searchMode) {
                    this.setImages(this.orderImages(data[1]));
                }
                if (!this.restored) {
                    this.restored = true;
                    this.$nextTick(() => restoreFromHash());
                }
                if (callback) callback();
            });
        },

        getRootInfo() {
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listRoots.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            }).then(resp => {
                resp.json().then(data => {
                    this.vroots = data;
                });
            })
        },

        // Fetch the view again so a new order takes effect
        reloadView() {
            if (this.searchMode) { this.runSearch(); }
            else { this.getFolderInfo(); }
        },

        // Load the next PAGE_SIZE images into the displayed list
        loadMoreImages() {
            if (this.isLoadingMore) return;
            const current = this.images.length;
            if (current >= this.allImages.length) return;
            this.isLoadingMore = true;
            const next = this.allImages.slice(current, current + PAGE_SIZE);
            this.images = this.images.concat(next);
            this.hasMoreImages = this.images.length < this.allImages.length;
            // Release the guard only after Alpine has re-rendered and scrollHeight has grown
            this.$nextTick(() => { this.isLoadingMore = false; this.ensureFilled(); });
        },

        // Small tiles may not fill the window with one page, and then no
        // scroll event ever asks for more: keep loading until it is full
        ensureFilled() {
            const box = document.getElementById('viewboxContainer');
            if (!box || !this.hasMoreImages || this.isLoadingMore) return;
            if (box.scrollHeight - box.clientHeight < 300) {
                this.loadMoreImages();
            }
        },

        // Attach a scroll listener to the viewbox container for infinite scroll
        setupInfiniteScroll() {
            const container = document.getElementById('viewboxContainer');
            if (!container) return;
            container.addEventListener('scroll', () => {
                const { scrollTop, scrollHeight, clientHeight } = container;
                // Trigger when within 300px of the bottom
                if (scrollTop + clientHeight >= scrollHeight - 300) {
                    this.loadMoreImages();
                }
            });
        },

        // ── Gallery size, zoom and layout ──────────────────────────────────────

        measureGallery() {
            const box = document.getElementById('viewboxContainer');
            if (!box) return;
            const w = box.clientWidth;
            if (w > 0 && Math.abs(w - this.containerWidth) > 1) {
                this.containerWidth = w;
                this.$nextTick(() => this.ensureFilled());
            }
        },

        setupResizeWatch() {
            const box = document.getElementById('viewboxContainer');
            if (!box || typeof ResizeObserver === 'undefined') return;
            let frame = 0;
            new ResizeObserver(() => {
                cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => this.measureGallery());
            }).observe(box);
        },

        columnCount() {
            return photoColumnCount(this.containerWidth, this.zoomLevel);
        },

        gridStyle() {
            return { gridTemplateColumns: 'repeat(' + this.columnCount() + ', minmax(0, 1fr))' };
        },

        // Ctrl/⌘ + wheel (and trackpad pinch, which also sets ctrlKey) zooms the
        // whole grid; a plain wheel keeps scrolling the gallery.
        setupGridZoom() {
            const container = document.getElementById('viewboxContainer');
            if (!container) return;
            container.addEventListener('wheel', (e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                e.preventDefault();
                this.zoomGrid(e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
        },

        // direction: +1 = zoom in (larger photos), -1 = zoom out.
        zoomGrid(direction) {
            this.setZoom(this.zoomLevel + direction);
        },

        setZoom(level) {
            level = Math.max(0, Math.min(PHOTO_ZOOM_STEPS.length - 1, level));
            if (level === this.zoomLevel) return;
            this.zoomLevel = level;
            showGridZoomHint(this.columnCount());
            this.$nextTick(() => this.ensureFilled());
        },

        // The 5-dot zoom slider: click or drag along it
        zoomPointer(e) {
            const slider = e.currentTarget;
            const track = slider.querySelector('.zs-track');
            if (!track) return;
            const pick = (x) => {
                const r = track.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
                this.setZoom(Math.round(ratio * (PHOTO_ZOOM_STEPS.length - 1)));
            };
            pick(e.clientX);
            slider.focus();
            const move = (ev) => pick(ev.clientX);
            const up = () => {
                slider.removeEventListener('pointermove', move);
                slider.removeEventListener('pointerup', up);
                slider.removeEventListener('pointercancel', up);
            };
            try { slider.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
            slider.addEventListener('pointermove', move);
            slider.addEventListener('pointerup', up);
            slider.addEventListener('pointercancel', up);
        },

        zoomKey(e) {
            const map = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
            if (map[e.key]) { e.preventDefault(); this.setZoom(this.zoomLevel + map[e.key]); }
            else if (e.key === 'Home') { e.preventDefault(); this.setZoom(0); }
            else if (e.key === 'End') { e.preventDefault(); this.setZoom(PHOTO_ZOOM_STEPS.length - 1); }
        },

        setTimeline(mode) {
            if (this.timeline === mode) return;
            this.timeline = mode;
            if (this.needsDateSort()) {
                // Every item knows its date: order the list here, at once
                this.setImages(this.orderImages(this.allImages));
            } else {
                // Back to a name / size / type order, which the server gives
                this.reloadView();
            }
        },

        setLayout(layout) {
            if (this.layout === layout) return;
            this.layout = layout;
            this.$nextTick(() => this.ensureFilled());
        },

        setSort(v) {
            if (this.sortOrder === v) return;
            this.sortOrder = v;
            this.reloadView();
        },

        // The order in effect: the timeline always orders by date
        effectiveSort() {
            const opt = PHOTO_SORT_OPTIONS.find(o => o.v === this.sortOrder);
            if (this.timeline !== 'none' && (!opt || !opt.date)) return 'mostRecent';
            return this.sortOrder;
        },

        sortOptions() {
            return PHOTO_SORT_OPTIONS.map(o => ({ v: o.v, date: o.date, label: T(o.key, o.en) }));
        },

        // A sort the timeline cannot show (it orders by date)
        sortDisabled(opt) {
            return this.timeline !== 'none' && !opt.date;
        },

        timelineOptions() {
            return [
                { v: 'none', label: T('view/timelineOff', 'Off') },
                { v: 'day', label: T('view/day', 'Day') },
                { v: 'month', label: T('view/month', 'Month') },
                { v: 'year', label: T('view/year', 'Year') }
            ];
        },

        // Split the loaded slice into date sections (one unlabelled section
        // with the timeline off); in waterfall each section is dealt into columns
        groupedImages() {
            this.layoutTick; // waterfall shapes changed
            const imgs = this.images;
            let groups = [];
            if (this.timeline === 'none') {
                groups = [{ key: 'all', label: '', images: imgs }];
            } else {
                let cur = null;
                let curSection = '';
                const used = {};
                for (let i = 0; i < imgs.length; i++) {
                    const sec = photoTimelineSection(imgs[i], this.timeline);
                    if (!cur || curSection !== sec.key) {
                        // Keys must be unique for x-for, even if a list that
                        // is not in date order brings a section back
                        let key = this.timeline + ':' + sec.key;
                        used[key] = (used[key] || 0) + 1;
                        if (used[key] > 1) key += '#' + used[key];
                        cur = { key: key, label: sec.label, images: [] };
                        curSection = sec.key;
                        groups.push(cur);
                    }
                    cur.images.push(imgs[i]);
                }
            }
            if (this.layout === 'waterfall') {
                const cols = this.columnCount();
                groups.forEach(g => { g.columns = photoMasonry(g.images, cols); });
            }
            return groups;
        },

        thumbUrl(image) {
            return '../system/file_system/loadThumbnail?bytes=true&vpath=' + encodeURIComponent(image.filepath);
        },

        // Waterfall card shape (follows previews as they arrive)
        cardRatio(image) {
            this.layoutTick;
            return '' + Math.max(0.25, Math.min(4, photoRatioOf(image)));
        },

        cardFiledata(image) {
            return encodeURIComponent(JSON.stringify({
                'filename': image.filepath.split('/').pop(),
                'filepath': image.filepath,
                'filesize': image.filesize
            }));
        },

        // A preview showed the real shape of a photo: lay the waterfall out
        // again if it differs from what the cards assumed (batched)
        onPreviewSize(filepath, w, h) {
            const ratio = w / h;
            const before = photoRatioOverrides[filepath] || photoIndexRatios[filepath] || 4 / 3;
            photoRatioOverrides[filepath] = ratio;
            if (Math.abs(before - ratio) / ratio > 0.02 && this.layout === 'waterfall') {
                clearTimeout(this._relayoutTimer);
                this._relayoutTimer = setTimeout(() => { this.layoutTick++; }, 250);
            }
        },

        // ── Top right menus ────────────────────────────────────────────────────

        toggleMenu(name) {
            this.openMenu = this.openMenu === name ? '' : name;
            if (this.openMenu === 'filter') this.loadFacets();
        },

        closeMenu(name) {
            if (this.openMenu === name) this.openMenu = '';
        },

        activeFilterCount() {
            return photoPanelCount(this.pf);
        },

        // Write the panel's chips (keeping the typed ones) and search again
        applyPanel() {
            const typed = this.searchTags.filter(t => !t.slot);
            const panel = photoPanelChips(this.pf).filter(c => !typed.some(t => t.value === c.value));
            this.searchTags = typed.concat(panel);
            this.runSearch();
        },

        resetPanel() {
            this.pf = photoEmptyPanel();
            this.applyPanel();
        },

        setPanelRating(n) {
            this.pf.rating = this.pf.rating === n ? 0 : n;
            this.applyPanel();
        },

        togglePanelValue(field, v) {
            const list = this.pf[field];
            const i = list.indexOf(v);
            if (i >= 0) list.splice(i, 1); else list.push(v);
            this.applyPanel();
        },

        setScope(scope) {
            if (this.scope === scope) return;
            this.scope = scope;
            this.facets = null;
            if (this.openMenu === 'filter') this.loadFacets();
            if (this.searchMode) this.runSearch();
        },

        scopeName() {
            return extractFolderName(this.currentPath) || this.currentPath;
        },

        // "12 results in Trip" under the search box
        searchSummary() {
            const n = this.searchTotal;
            const results = n === 1 ? T('search/result', '{n} result', { n: n }) : T('search/results', '{n} results', { n: n });
            if (this.scope !== 'folder') return results;
            return T('search/inFolder', '{results} in {folder}', { results: results, folder: this.scopeName() });
        },

        // What the panel can offer for the current scope
        loadFacets(force) {
            const key = this.scope === 'folder' ? this.currentPath : '*';
            if (!force && this.facets && this.facetsKey === key) return;
            this.facetsKey = key;
            this.facetsLoading = true;
            aoPhotoBackend('Photo/backend/searchFacets.js', { folder: this.scope === 'folder' ? this.currentPath : '' }).then(data => {
                if (this.facetsKey !== key) return;
                this.facets = (data && data.available) ? data : null;
                this.facetsLoading = false;
            }).catch(() => { this.facetsLoading = false; });
        },

        cameraOptions() {
            const list = (this.facets && this.facets.cameras) ? this.facets.cameras.map(c => ({ v: c.v, label: photoCameraName(c.v, c.make), c: c.c })) : [];
            if (this.pf.camera && !list.some(c => c.v === this.pf.camera)) list.unshift({ v: this.pf.camera, label: this.pf.camera, c: 0 });
            return list;
        },

        lensOptions() {
            const list = (this.facets && this.facets.lenses) ? this.facets.lenses.map(l => ({ v: l.v, label: l.v, c: l.c })) : [];
            if (this.pf.lens && !list.some(l => l.v === this.pf.lens)) list.unshift({ v: this.pf.lens, label: this.pf.lens, c: 0 });
            return list;
        },

        typeOptions() {
            const list = (this.facets && this.facets.exts) ? this.facets.exts.map(e => ({ v: e.v, c: e.c })) : [];
            this.pf.types.forEach(t => { if (!list.some(e => e.v === t)) list.push({ v: t, c: 0 }); });
            return list;
        },

        ratingCount(n) {
            if (!this.facets || !this.facets.ratings) return '';
            const r = this.facets.ratings;
            let c = 0;
            if (n < 0) { c = r[0] || 0; }
            else { for (let k = n; k <= 5; k++) c += (r[k] || 0); }
            return c;
        },

        rangeHint(name, fmt) {
            const r = this.facets && this.facets.ranges ? this.facets.ranges[name] : null;
            if (!r || r.min === null || r.max === null) return '';
            fmt = fmt || (v => Math.round(v * 10) / 10);
            return fmt(r.min) + ' – ' + fmt(r.max);
        },

        // ── Search ────────────────────────────────────────────────────────────

        suggestIcon(type) { return photoSuggestIcon(type); },

        // The committed query is the chips; currentQuery also folds in the text
        // still being typed so results update live.
        committedQuery() { return this.searchTags.map(t => t.value).join(' '); },
        currentQuery() {
            let q = this.committedQuery();
            const inp = this.searchInput.trim();
            if (inp) q = (q ? q + ' ' : '') + inp;
            return q;
        },
        searchActive() { return this.searchTags.length > 0 || this.searchInput.trim().length > 0; },

        // Debounced autocomplete + live search on every keystroke.
        onSearchInput() {
            this.suggestIndex = -1;
            const q = this.searchInput;
            clearTimeout(this._suggestTimer);
            this._suggestTimer = setTimeout(() => { this.fetchSuggestions(q); }, 150);
            this.scheduleSearch();
        },

        fetchSuggestions(q) {
            aoPhotoBackend("Photo/backend/searchSuggest.js", { q: q }).then(data => {
                this.suggestions = (data && data.suggestions) ? data.suggestions.map(photoLocalizeSuggestion) : [];
                this.showSuggestions = this.suggestions.length > 0;
            }).catch(() => {
                this.suggestions = [];
                this.showSuggestions = false;
            });
        },

        scheduleSearch() {
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(() => { this.runSearch(); }, 400);
        },

        // Add a chip from an explicit {label, value, type}.
        addTag(tag) {
            if (!tag || !tag.value) return;
            // Ignore exact duplicates (same token already a chip).
            if (this.searchTags.some(t => t.value === tag.value)) {
                this.searchInput = '';
                this.showSuggestions = false;
                return;
            }
            this.searchTags.push({ label: tag.label, value: tag.value, type: tag.type || 'search', neg: !!tag.neg });
            this.searchInput = '';
            this.suggestions = [];
            this.showSuggestions = false;
            this.suggestIndex = -1;
            this.runSearch();
        },

        // A picked autocomplete suggestion becomes a chip.
        applySuggestion(s) {
            this.addTag({ label: s.label, value: s.value, type: s.type, neg: /(^|\s)-\S/.test(s.value) && s.type !== 'file' });
        },

        // Commit whatever text is in the box as a chip (Enter / Space).
        commitInput() {
            const text = this.searchInput.trim();
            if (text.length === 0) return;
            this.addTag(photoParseTagToken(text));
        },

        removeTag(i) {
            const tag = this.searchTags[i];
            this.searchTags.splice(i, 1);
            if (tag && tag.slot) photoClearPanelSlot(this.pf, tag.slot);
            this.runSearch();
            this.$nextTick(() => { const el = document.getElementById('photo-search-input'); if (el) el.focus(); });
        },

        removeLastTag() {
            if (this.searchTags.length > 0) {
                this.removeTag(this.searchTags.length - 1);
            }
        },

        runSearch() {
            // NOTE: this is also the live/debounced search fired while typing, so it
            // must NOT close the autocomplete dropdown — only explicit actions
            // (pick/commit/Escape/click-outside/clear) hide it.
            clearTimeout(this._searchTimer);
            const q = this.currentQuery();
            const seq = ++this._searchSeq;
            if (q.length === 0) {
                // Nothing to search — fall back to normal folder browsing.
                if (this.searchMode) { this.searchMode = false; this.searchTotal = 0; this.getFolderInfo(); }
                return;
            }
            this.searchMode = true;
            const sort = this.needsDateSort() ? (this.sortOrder === 'leastRecent' ? 'taken_asc' : 'taken_desc') : photoBackendSort(this.sortOrder);
            aoPhotoBackend("Photo/backend/searchPhotos.js", {
                q: q,
                folder: this.scope === 'folder' ? this.currentPath : '',
                sort: sort,
                limit: 5000
            }).then(data => {
                if (seq !== this._searchSeq || !this.searchMode) return; // a newer search is on its way
                const results = (data && data.results) ? data.results : [];
                this.searchTotal = (data && typeof data.total === 'number') ? data.total : results.length;
                // Carry the date, size and rating through so the grid can group,
                // lay out and the viewer can show the rating without a refetch.
                this.setImages(this.orderImages(results.map(r => ({
                    filepath: r.filepath, filesize: r.filesize,
                    taken_date: r.taken_date, modified_date: r.modified_date, rating: r.rating,
                    width: r.width, height: r.height
                }))));
            }).catch(() => { /* leave current view untouched on error */ });
        },

        // keepFolder: called while navigating, which loads the folder itself
        clearSearch(keepFolder) {
            this.searchTags = [];
            this.searchInput = '';
            this.suggestions = [];
            this.showSuggestions = false;
            this.suggestIndex = -1;
            this.searchTotal = 0;
            this.searchMode = false;
            this.pf = photoEmptyPanel();
            this._searchSeq++;
            clearTimeout(this._searchTimer);
            if (keepFolder !== true) this.getFolderInfo();   // restore normal folder browsing
        },

        onSearchKeydown(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.showSuggestions && this.suggestIndex >= 0 && this.suggestions[this.suggestIndex]) {
                    this.applySuggestion(this.suggestions[this.suggestIndex]);
                } else if (this.searchInput.trim().length > 0) {
                    this.commitInput();
                } else {
                    this.runSearch();
                }
            } else if (e.key === ' ') {
                // Space turns the current token into a chip (unless mid-quote/"key:").
                if (photoInputCommittable(this.searchInput)) {
                    e.preventDefault();
                    this.commitInput();
                }
            } else if (e.key === 'Backspace') {
                if (this.searchInput.length === 0 && this.searchTags.length > 0) {
                    e.preventDefault();
                    this.removeLastTag();
                }
            } else if (e.key === 'ArrowDown') {
                if (this.showSuggestions) {
                    e.preventDefault();
                    this.suggestIndex = Math.min(this.suggestIndex + 1, this.suggestions.length - 1);
                }
            } else if (e.key === 'ArrowUp') {
                if (this.showSuggestions) {
                    e.preventDefault();
                    this.suggestIndex = Math.max(this.suggestIndex - 1, -1);
                }
            } else if (e.key === 'Escape') {
                if (this.showSuggestions) { this.showSuggestions = false; }
                else if (this.searchActive()) { this.clearSearch(); }
            }
        },

        // Escape closes the top-most of the menus / dialog
        onEscape() {
            if (this.settingsOpen) { this.settingsOpen = false; return; }
            if (this.openMenu) { this.openMenu = ''; }
        },

        // ── Settings dialog ───────────────────────────────────────────────────

        openSettings() {
            this.openMenu = '';
            this.settingsOpen = true;
            this.settings.error = '';
            this.loadSettings();
        },

        loadSettings() {
            aoPhotoBackend('Photo/backend/photoSettings.js', { action: 'get' }).then(d => {
                this.applySettingsReply(d);
            }).catch(() => { this.settings.error = T('settings/errLoad', 'Settings could not be loaded.'); });
        },

        applySettingsReply(d) {
            const s = this.settings;
            if (!d || d.error) {
                s.error = photoSettingsError(d ? d.error : '');
                return;
            }
            s.mode = d.preview.mode;
            s.path = d.preview.path || '';
            s.dir = d.preview.dir || '';
            s.defaultDir = d.preview.defaultDir;
            s.total = d.index.total;
            s.lastIndexed = d.index.lastIndexed;
            s.exclude = d.exclude || [];
            s.loaded = true;
            this.loadCacheStats();
        },

        setPreviewMode(mode, path) {
            const s = this.settings;
            if (mode === 'custom' && !path && !s.path) {
                this.chooseCacheFolder();
                return;
            }
            s.error = '';
            s.busy = true;
            const before = s.mode + '|' + s.dir;
            aoPhotoBackend('Photo/backend/photoSettings.js', { action: 'set', previewMode: mode, previewPath: path || s.path }).then(d => {
                s.busy = false;
                if (!d || d.error) {
                    s.error = photoSettingsError(d ? d.error : '');
                    return;
                }
                this.applySettingsReply(d);
                if (before !== s.mode + '|' + s.dir) PhotoPreviews.reset();
            }).catch(() => { s.busy = false; });
        },

        chooseCacheFolder() {
            window.photoCacheFolderPicked = (files) => {
                if (files && files.length && files[0].filepath) {
                    this.setPreviewMode('custom', files[0].filepath.replace(/\/+$/, ''));
                }
            };
            ao_module_openFileSelector(window.photoCacheFolderPicked, this.settings.path || 'user:/', 'folder', false, {
                path_memory_key: 'previewCache'
            });
        },

        loadCacheStats() {
            const s = this.settings;
            if (s.mode === 'realtime') { s.stats = null; return; }
            s.statsLoading = true;
            aoPhotoBackend('Photo/backend/photoSettings.js', { action: 'cacheStats' }).then(d => {
                s.statsLoading = false;
                s.stats = d && typeof d.files === 'number' ? d : null;
            }).catch(() => { s.statsLoading = false; });
        },

        cacheStatsText() {
            const st = this.settings.stats;
            if (this.settings.statsLoading) return T('settings/counting', 'Counting…');
            if (!st) return '';
            return T('settings/cacheSize', '{n} previews, {size}', { n: st.files, size: photoFormatBytes(st.bytes) });
        },

        clearPreviewCache() {
            const s = this.settings;
            s.busy = true;
            aoPhotoBackend('Photo/backend/photoSettings.js', { action: 'clearCache' }).then(() => {
                s.busy = false;
                PhotoPreviews.reset();
                this.loadCacheStats();
            }).catch(() => { s.busy = false; });
        },

        addExclude() {
            const v = this.settings.excludeInput.trim().replace(/^\/+|\/+$/g, '');
            if (!v || this.settings.exclude.includes(v)) { this.settings.excludeInput = ''; return; }
            this.saveExclude(this.settings.exclude.concat([v]));
            this.settings.excludeInput = '';
        },

        removeExclude(i) {
            const list = this.settings.exclude.slice();
            list.splice(i, 1);
            this.saveExclude(list);
        },

        saveExclude(list) {
            aoPhotoBackend('Photo/backend/photoSettings.js', { action: 'setExclude', folders: list }).then(d => {
                if (d && !d.error) {
                    this.settings.exclude = d.exclude || [];
                    // The next index pass drops (or adds back) those photos
                    this.facets = null;
                    this.startAutoIndex();
                }
            });
        },

        lastIndexedText() {
            const t = this.settings.lastIndexed;
            if (!t) return T('settings/neverIndexed', 'not indexed yet');
            return new Date(t * 1000).toLocaleString(localeTag() || undefined);
        },

        // ── Auto indexing ─────────────────────────────────────────────────────
        // Loops indexPhotos.js in the background until the whole library is
        // indexed. Incremental, so steady-state runs finish in a single pass.
        startAutoIndex() {
            if (this.indexing) return;
            this.indexing = true;
            let changedThisRun = 0;
            const step = () => {
                aoPhotoBackend("Photo/backend/indexPhotos.js", { mode: 'incremental' }).then(data => {
                    if (data && data.error) { this.indexing = false; this.indexStatusText = ''; return; }
                    const total = (data && data.total) ? data.total : 0;
                    changedThisRun += ((data && data.indexed) || 0) + ((data && data.removed) || 0);
                    if (data && data.hasMore) {
                        this.indexStatusText = T('index/progress', 'Indexing… {n} photos', { n: total });
                        setTimeout(step, 50);
                    } else {
                        this.indexing = false;
                        this.indexStatusText = total ? T('index/done', '{n} photos indexed', { n: total }) : '';
                        // Newly indexed photos carry EXIF shoot times and upright
                        // sizes the current view was drawn without: reload it
                        if (changedThisRun > 0) {
                            this.facets = null;
                            this.reloadView();
                        }
                        if (this.settingsOpen) this.loadSettings();
                        setTimeout(() => { if (!this.indexing) this.indexStatusText = ''; }, 4000);
                    }
                }).catch(() => { this.indexing = false; this.indexStatusText = ''; });
            };
            step();
        },

        // Force a full re-index (used by the "Rebuild" action). The first request
        // wipes the index ("full"); subsequent rounds loop incrementally so the
        // batch loop advances to completion.
        rebuildIndex() {
            if (this.indexing) return;
            this.indexing = true;
            this.indexStatusText = T('index/rebuilding', 'Rebuilding index…');
            const step = (mode) => {
                aoPhotoBackend("Photo/backend/indexPhotos.js", { mode: mode }).then(data => {
                    if (data && data.error) { this.indexing = false; this.indexStatusText = ''; return; }
                    const total = (data && data.total) ? data.total : 0;
                    if (data && data.hasMore) {
                        this.indexStatusText = T('index/rebuildProgress', 'Rebuilding… {n} photos', { n: total });
                        setTimeout(() => step('incremental'), 50);
                    } else {
                        this.indexing = false;
                        this.indexStatusText = total ? T('index/done', '{n} photos indexed', { n: total }) : '';
                        this.facets = null;
                        if (this.settingsOpen) this.loadSettings();
                        this.reloadView();
                        setTimeout(() => { if (!this.indexing) this.indexStatusText = ''; }, 4000);
                    }
                }).catch(() => { this.indexing = false; this.indexStatusText = ''; });
            };
            step('full');
        }
    }
}

function renderImageList(object){
    var fd = $(object).attr("filedata");
    fd = JSON.parse(decodeURIComponent(fd));
    console.log(fd);
    
}

function ShowModal(){
    $('#photo-viewer').show();
}

function closeViewer(){
    $('#photo-viewer').hide();
    if (!ao_module_virtualDesktop){
        // Only update hash if not under WebDesktop mode 
        // to prevent iframe refresh
        window.location.hash = '';
    }
    ao_module_setWindowTitle(T('app/title', 'Photo'));

    setTimeout(function(){
        $("#fullImage").attr("src","img/loading.png");
        $("#compressedImage").attr("src","").hide().removeClass('hidden');
        $("#bg-image").attr("src","");
        $("#info-filename").text("");
        $("#info-filepath").text("");
        $("#info-dimensions").text(T('info/loading', 'Loading...'));

        // Reset EXIF data display
        $('#basic-info-section').hide();
        $('#shooting-params-section').hide();
        $('#tone-analysis-section').hide();
        $('#device-info-section').hide();
        $('#shooting-mode-section').hide();
        $('#technical-params-section').hide();
        $('#no-exif-message').hide();
        $('.ui.divider').hide();

        // Clear histogram canvas
        const canvas = document.getElementById('histogram-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, 300);
}

let compressedImageLoaded = false;
let fullsizeImageLoaded = false;

function showImage(object){
    // Reset zoom level when switching photos
    if (typeof resetZoom === 'function') {
        resetZoom();
    }

    if (!$(object).hasClass("imagecard")){
        // Not an image card, do nothing
        return;
    }
    
    // Reset loading flags
    compressedImageLoaded = false;
    fullsizeImageLoaded = false;
    
    var fd = JSON.parse(decodeURIComponent($(object).attr("filedata")));
    _currentCastFilepath = fd.filepath;
    currentPhotoFilepath = fd.filepath;
    fetchPhotoRating(fd.filepath);
    if (_photoCastConnected()) _photoCastSendPhoto(fd.filepath);
    $("#info-dimensions").text(T('info/calculating', 'Calculating...'));
    // Check if we should use compression (only for JPG/PNG > 5MB)
    const useCompression = shouldUseCompression(fd.filepath, fd.filesize);

    // Set thumbnail as placeholder for full image
    const thumbnailUrl = $(object).find('img').attr('src');
    $("#fullImage").attr("src", thumbnailUrl);
    $("#fullImage").hide();
    $("#compressedImage").show();
    $("#compressedImage").attr("src", thumbnailUrl);
    $("#bg-image").attr("src", thumbnailUrl);
    
    // Get image URL (backend handles RAW files automatically)
    getViewableImageUrl(fd.filepath, (imageUrl, isSupported, isBlob, method) => {
        $("#loading-progress").show();
        const compressedImg = document.getElementById('compressedImage');
        const fullImg = document.getElementById('fullImage');
        const bgImg = document.getElementById('bg-image');
        $("#loading-progress").html('<i class="loading spinner icon"></i> ' + T('viewer/loading', 'Loading'));
        if (useCompression) {
            // Use compressed version for large JPG/PNG files
            console.log('Large JPG/PNG detected (' + (fd.filesize / 1024 / 1024).toFixed(2) + 'MB), loading compressed version first');

            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/getCompressedImg.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "filepath": fd.filepath
                })
            }).then(resp => {
                resp.text().then(dataURL => {
                    $("#loading-progress").html('<i class="loading spinner icon"></i> ' + T('viewer/optimizing', 'Optimizing Resolution'));
                    compressedImageLoaded = true;

                    // Only show compressed image if full-size hasn't loaded yet
                    if (!fullsizeImageLoaded) {
                        compressedImg.src = dataURL;
                        compressedImg.style.display = 'block';
                        bgImg.src = dataURL;
                    } else {
                        console.log('Full-size image already loaded, skipping compressed image display');
                    }
                });
            }).catch(error => {
                console.error('Failed to load compressed image:', error);
                // Fall back to full size image
                fullImg.src = imageUrl;
                bgImg.src = imageUrl;
            });

            // Start loading full-size image in background
            loadFullSizeImageInBackground(imageUrl, fd);
        } else {
            $("#compressedImage").hide();
            $("#fullImage").show();
            $("#loading-progress").hide();
            // Use full image URL directly for RAW, WEBP, or small JPG/PNG files
            if (method === 'backend_raw') {
                console.log('RAW file: Rendered by backend');
            }
            fullImg.src = imageUrl;
            bgImg.src = imageUrl;
        }

        // Update image dimensions and generate histogram when full image loads
        $("#fullImage").off("load").on('load', function() {
            fullsizeImageLoaded = true;
            let width = this.naturalWidth;
            let height = this.naturalHeight;
            $("#info-dimensions").text(width + ' × ' + height + "px");

            // Hide the compressed image once full image is loaded
            $("#compressedImage").hide();
            $("#fullImage").show();
            $("#loading-progress").hide();
            const canvas = document.getElementById('histogram-canvas');
            if (canvas) {
                generateHistogram(this, canvas);
            }
        });

        $("#info-filename").text(fd.filename);
        $("#info-filepath").text(fd.filepath);

        var nextCard = $(object).next();
        var prevCard = $(object).prev();
        if (nextCard.length > 0){
            nextPhoto = nextCard[0];
        }else{
            nextPhoto = null;
        }

        if (prevCard.length > 0){
            prePhoto = prevCard[0];
        }else{
            prePhoto = null;
        }

        // Track position in the full allImages list for index-based navigation
        const _appEl = document.querySelector('[x-data*="photoListObject"]');
        if (_appEl && _appEl._x_dataStack) {
            const _app = _appEl._x_dataStack[0];
            currentPhotoAllIndex = _app.allImages.findIndex(img => img.filepath === fd.filepath);

            // Proactively load next batch when within PAGE_SIZE of the end of rendered images
            if (currentPhotoAllIndex >= 0 && _app.hasMoreImages &&
                    currentPhotoAllIndex >= _app.images.length - PAGE_SIZE) {
                _app.loadMoreImages();
            }
        }

        // Update navigation buttons state
        if (typeof updateNavigationButtons === 'function') {
            updateNavigationButtons();
        }

        ao_module_setWindowTitle(T('app/title', 'Photo') + ' - ' + fd.filename);
        if (!ao_module_virtualDesktop){
            window.location.hash = encodeURIComponent(JSON.stringify({filename: fd.filename, filepath: fd.filepath}));
        }
        
        // Check for EXIF data
        fetch(ao_root + "system/ajgi/interface?script=Photo/backend/getExif.js", {
            method: 'POST',
            cache: 'no-cache',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "filepath": fd.filepath
            })
        }).then(resp => {
            resp.json().then(data => {
                formatExifData(data, fd);
            })
        }).catch(error => {
            console.error('Failed to fetch EXIF data:', error);
            formatExifData({}, fd); // Call with empty EXIF to show tone analysis
        });
    });
}


// Function to load full-size image in background with progress tracking
function loadFullSizeImageInBackground(fullSizeUrl, fileData) {
    console.log('Starting background download of full-size image...');
    const fullImage = document.getElementById('fullImage');
    fullImage.src = fullSizeUrl;
}

// ── Download current photo ─────────────────────────────────────────────────────
// Streams the *original* file (RAW included) via the media server's download
// mode, which sets a Content-Disposition: attachment header.
function downloadCurrentPhoto() {
    if (!currentPhotoFilepath) return;
    var url = ao_root + 'media?download=true&file=' + encodeURIComponent(currentPhotoFilepath);
    var a = document.createElement('a');
    a.href = url;
    a.download = currentPhotoFilepath.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ── Star rating (viewer) ───────────────────────────────────────────────────────

// Paint the 1-5 star widget to reflect `rating` (and remember it).
function renderPhotoRating(rating) {
    currentPhotoRating = rating || 0;
    var container = document.getElementById('photo-rating-stars');
    if (container) {
        var stars = container.querySelectorAll('.photo-star');
        for (var i = 0; i < stars.length; i++) {
            stars[i].classList.toggle('filled', (i + 1) <= currentPhotoRating);
            stars[i].classList.remove('hover');
        }
    }
    var label = document.getElementById('photo-rating-label');
    if (label) label.textContent = currentPhotoRating ? (currentPhotoRating + ' / 5') : T('info/rate', 'Rate');
}

// Persist a new rating for the open photo (tapping the current value clears it).
function setPhotoRating(n) {
    if (!currentPhotoFilepath) return;
    if (n === currentPhotoRating) n = 0;
    renderPhotoRating(n); // optimistic update
    var target = currentPhotoFilepath;
    fetch(ao_root + "system/ajgi/interface?script=Photo/backend/setRating.js", {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: target, rating: n })
    }).then(function (r) { return r.json(); }).then(function (data) {
        if (target !== currentPhotoFilepath) return; // user already moved on
        if (data && typeof data.rating === 'number') renderPhotoRating(data.rating);
    }).catch(function () { /* keep the optimistic value */ });
}

// Load the stored rating for a freshly-opened photo.
function fetchPhotoRating(filepath) {
    renderPhotoRating(0);
    fetch(ao_root + "system/ajgi/interface?script=Photo/backend/getRating.js", {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: filepath })
    }).then(function (r) { return r.json(); }).then(function (data) {
        if (filepath !== currentPhotoFilepath) return; // raced past this photo
        renderPhotoRating(data && data.rating ? data.rating : 0);
    }).catch(function () { renderPhotoRating(0); });
}

// Wire click + hover-preview on the star widget once.
function initPhotoRatingWidget() {
    var container = document.getElementById('photo-rating-stars');
    if (!container) return;
    var stars = container.querySelectorAll('.photo-star');
    for (var i = 0; i < stars.length; i++) {
        (function (star, value) {
            star.addEventListener('click', function () { setPhotoRating(value); });
            star.addEventListener('mouseenter', function () {
                for (var j = 0; j < stars.length; j++) {
                    stars[j].classList.toggle('hover', j < value);
                }
            });
        })(stars[i], i + 1);
    }
    container.addEventListener('mouseleave', function () {
        for (var k = 0; k < stars.length; k++) stars[k].classList.remove('hover');
    });
}
document.addEventListener('DOMContentLoaded', initPhotoRatingWidget);

$(document).on("keydown", function(e){
    // Arrows only step through photos while the viewer is open (they also
    // move the cursor in the search box and the filter fields)
    if ((e.keyCode == 37 || e.keyCode == 39) && !$('#photo-viewer').is(':visible')) {
        return;
    }
    if (e.keyCode == 27){ // Escape
        if ($('#photo-viewer').is(':visible')) {
            closeViewer();
        }
    } else if (e.keyCode == 37){
        //Left
        if (typeof showPreviousImage === 'function') {
            showPreviousImage();
        } else if (prePhoto != null){
            showImage(prePhoto);
        }
       
    }else if (e.keyCode == 39){
        //Right
        if (typeof showNextImage === 'function') {
            showNextImage();
        } else if (nextPhoto != null){
            showImage(nextPhoto);
        }
        
    }
})

function generateToneAnalysis(imageElement) {
    analysis_tone_types(imageElement, function(result) {
        if (result) {
            // Update tone type based on brightness, contrast, shadow and highlight ratios
            let toneType = get_tone_type(result.brightness, result.contrast, result.shadowRatio, result.highlightRatio);
            $('.tone-type-value').text(toneType);
            $('.brightness-value').text(result.brightness);
            $('.contrast-value').text(result.contrast);
            $('.shadow-ratio-value').text(result.shadowRatio);
            $('.highlight-ratio-value').text(result.highlightRatio);
        } else {
            $('.tone-type-value').text("N/A");
            $('.brightness-value').text("N/A");
            $('.contrast-value').text("N/A");
            $('.shadow-ratio-value').text("N/A");
            $('.highlight-ratio-value').text("N/A");
        }
    });
}

function formatExifData(exif, fileData) {
    // Hide all sections initially
    $('#basic-info-section').hide();
    $('#shooting-params-section').hide();
    $('#tone-analysis-section').hide();
    $('#device-info-section').hide();
    $('#shooting-mode-section').hide();
    $('#technical-params-section').hide();
    $('#no-exif-message').hide();

    // Hide all dividers
    $('.ui.divider').hide();

    if (!exif || Object.keys(exif).length === 0) {
        $('#no-exif-message').show();
        //Generate histogram and tone analysis only
        generateHistogram(document.getElementById('fullImage'), document.getElementById('histogram-canvas'));
        generateToneAnalysis(document.getElementById('fullImage'));
        $('#tone-analysis-section').show();
        return;
    }

    let sectionsShown = 0;

    // Section 1: Basic Information
    let basicInfoShown = false;
    if (fileData.filename) {
        let ext = fileData.filename.split('.').pop().toUpperCase();
        $('#format-value').text(ext);
        $('#format-row').show();
        basicInfoShown = true;
    } else {
        $('#format-row').hide();
    }

    if (exif.PixelXDimension && exif.PixelYDimension) {
        $('#dimensions-value').text(`${exif.PixelXDimension} × ${exif.PixelYDimension}`);
        $('#dimensions-row').show();
        let pixels = (exif.PixelXDimension * exif.PixelYDimension / 1000000).toFixed(1);
        $('#pixels-value').text(`${pixels} MP`);
        $('#pixels-row').show();
        basicInfoShown = true;
    } else {
        $('#dimensions-row').hide();
        $('#pixels-row').hide();
    }

    if (exif.ColorSpace !== undefined) {
        exif.ColorSpace = JSON.parse(exif.ColorSpace);
        let colorSpace = exif.ColorSpace === 1 ? "sRGB" : exif.ColorSpace === 65535 ? T('value/uncalibrated', 'Uncalibrated') : T('value/unknown', 'Unknown');
        $('#color-space-value').text(colorSpace);
        $('#color-space-row').show();
        basicInfoShown = true;
    } else {
        $('#color-space-row').hide();
    }

    if (exif.DateTimeOriginal) {
        exif.DateTimeOriginal = JSON.parse(exif.DateTimeOriginal);
        $('#shooting-time-value').text(exif.DateTimeOriginal.replace(/:/g, '/').replace(' ', ' '));
        $('#shooting-time-row').show();
        basicInfoShown = true;
    } else {
        $('#shooting-time-row').hide();
    }

    if (exif.Software) {
        exif.Software = JSON.parse(exif.Software);
        $('#software-value').text(exif.Software);
        $('#software-row').show();
        basicInfoShown = true;
    } else {
        $('#software-row').hide();
    }

    if (basicInfoShown) {
        $('#basic-info-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#basic-info-divider').show();
    }

    // Section 2: Shooting Parameters
    let shootingParamsShown = false;
    if (exif.FocalLength) {
        $('#focal-length-value').text(JSON.parse(exif.FocalLength));
        $('#focal-length-row').show();
        shootingParamsShown = true;
    } else {
        $('#focal-length-row').hide();
    }

    if (exif.FNumber) {
        exif.FNumber = JSON.parse(exif.FNumber);
        let aperture = parseExifValue(exif.FNumber);
        let formattedAperture = aperture % 1 === 0 ? aperture.toString() : aperture.toFixed(1);
        $('#aperture-value').text('f/' + formattedAperture);
        $('#aperture-row').show();
        shootingParamsShown = true;
    } else {
        $('#aperture-row').hide();
    }

    if (exif.ExposureTime) {
        let exposureTime = JSON.parse(exif.ExposureTime);
        let formattedExposure = formatShutterSpeed(exposureTime);
        $('#shutter-speed-value').text(formattedExposure + 's');
        $('#shutter-speed-row').show();
        shootingParamsShown = true;
    } else {
        $('#shutter-speed-row').hide();
    }

    if (exif.ISOSpeedRatings) {
        $('#iso-value').text(exif.ISOSpeedRatings);
        $('#iso-row').show();
        shootingParamsShown = true;
    } else {
        $('#iso-row').hide();
    }

    if (exif.ExposureBiasValue) {
        $('#ev-value').text(JSON.parse(exif.ExposureBiasValue));
        $('#ev-row').show();
        shootingParamsShown = true;
    } else {
        $('#ev-row').hide();
    }

    if (shootingParamsShown) {
        $('#shooting-params-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#shooting-params-divider').show();
    }

    // Section 3: Tone Analysis
    $('#tone-analysis-section').show();
    sectionsShown++;
    if (sectionsShown > 1) $('#tone-analysis-divider').show();

    generateToneAnalysis(document.getElementById('fullImage'));

    // Section 4: Device Information
    let deviceInfoShown = false;
    if (exif.Make && exif.Model) {
        exif.Make = JSON.parse(exif.Make);
        exif.Model = JSON.parse(exif.Model);
        $('#camera-value').text(`${exif.Make} ${exif.Model}`);
        $('#camera-row').show();
        deviceInfoShown = true;
    } else if (exif.Model) {
        exif.Model = JSON.parse(exif.Model);
        $('#camera-value').text(exif.Model);
        $('#camera-row').show();
        deviceInfoShown = true;
    } else {
        $('#camera-row').hide();
    }

    if (exif.LensModel) {
        exif.LensModel = JSON.parse(exif.LensModel);
        $('#lens-value').text(exif.LensModel);
        $('#lens-row').show();
        deviceInfoShown = true;
    } else {
        $('#lens-row').hide();
    }

    if (exif.FocalLength) {
        exif.FocalLength = JSON.parse(exif.FocalLength);
        $('#focal-length-device-value').text(`${exif.FocalLength}mm`);
        $('#focal-length-device-row').show();
        deviceInfoShown = true;
    } else {
        $('#focal-length-device-row').hide();
    }

    if (exif.MaxApertureValue) {
        exif.MaxApertureValue = JSON.parse(exif.MaxApertureValue);
        $('#max-aperture-value').text(exif.MaxApertureValue);
        $('#max-aperture-row').show();
        deviceInfoShown = true;
    } else {
        $('#max-aperture-row').hide();
    }

    if (deviceInfoShown) {
        $('#device-info-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#device-info-divider').show();
    }

    // Section 5: Shooting Mode
    let shootingModeShown = false;
    if (exif.ExposureProgram !== undefined) {
        let programs = [
            T('value/notDefined', 'Not defined'),
            T('value/manual', 'Manual'),
            T('value/normalProgram', 'Normal program'),
            T('value/aperturePriority', 'Aperture priority'),
            T('value/shutterPriority', 'Shutter priority'),
            T('value/creativeProgram', 'Creative program'),
            T('value/actionProgram', 'Action program'),
            T('value/portraitMode', 'Portrait mode'),
            T('value/landscapeMode', 'Landscape mode')];
        let program = programs[exif.ExposureProgram] || T('value/unknown', 'Unknown');
        $('#exposure-program-value').text(program);
        $('#exposure-program-row').show();
        shootingModeShown = true;
    } else {
        $('#exposure-program-row').hide();
    }

    if (exif.ExposureMode !== undefined) {
        let modes = [
            T('value/autoExposure', 'Auto exposure'),
            T('value/manualExposure', 'Manual exposure'),
            T('value/autoBracket', 'Auto bracket')];
        let mode = modes[exif.ExposureMode] || T('value/unknown', 'Unknown');
        $('#exposure-mode-value').text(mode);
        $('#exposure-mode-row').show();
        shootingModeShown = true;
    } else {
        $('#exposure-mode-row').hide();
    }

    if (exif.MeteringMode !== undefined) {
        let metering = [
            T('value/unknown', 'Unknown'),
            T('value/average', 'Average'),
            T('value/centerWeighted', 'Center-weighted average'),
            T('value/spot', 'Spot'),
            T('value/multiSpot', 'Multi-spot'),
            T('value/pattern', 'Pattern'),
            T('value/partial', 'Partial')];
        let meter = metering[exif.MeteringMode] || T('value/unknown', 'Unknown');
        $('#metering-mode-value').text(meter);
        $('#metering-mode-row').show();
        shootingModeShown = true;
    } else {
        $('#metering-mode-row').hide();
    }

    if (exif.WhiteBalance !== undefined) {
        let wb = exif.WhiteBalance === 0 ? T('value/auto', 'Auto') : T('value/manual', 'Manual');
        $('#white-balance-value').text(wb);
        $('#white-balance-row').show();
        shootingModeShown = true;
    } else {
        $('#white-balance-row').hide();
    }

    if (exif.Flash !== undefined) {
        let flash = (exif.Flash & 1) ? T('value/on', 'On') : T('value/off', 'Off');
        $('#flash-value').text(flash);
        $('#flash-row').show();
        shootingModeShown = true;
    } else {
        $('#flash-row').hide();
    }

    if (exif.SceneCaptureType !== undefined) {
        let scenes = [
            T('value/standard', 'Standard'),
            T('value/landscape', 'Landscape'),
            T('value/portrait', 'Portrait'),
            T('value/night', 'Night scene')];
        let scene = scenes[exif.SceneCaptureType] || T('value/unknown', 'Unknown');
        $('#scene-capture-value').text(scene);
        $('#scene-capture-row').show();
        shootingModeShown = true;
    } else {
        $('#scene-capture-row').hide();
    }

    if (shootingModeShown) {
        $('#shooting-mode-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#shooting-mode-divider').show();
    }

    // Section 6: Technical Parameters
    let technicalParamsShown = false;
    if (exif.ShutterSpeedValue) {
        exif.ShutterSpeedValue = JSON.parse(exif.ShutterSpeedValue);
        let apexValue = parseExifValue(exif.ShutterSpeedValue);
        let shutterSpeedSeconds = Math.pow(2, -apexValue);
        let shutterValue = formatShutterSpeed(shutterSpeedSeconds);
        $('#shutter-speed-tech-value').text(shutterValue);
        $('#shutter-speed-tech-row').show();
        technicalParamsShown = true;
    } else {
        $('#shutter-speed-tech-row').hide();
    }

    if (exif.ApertureValue) {
       exif.ApertureValue = JSON.parse(exif.ApertureValue);
       let apexValue = parseExifValue(exif.ApertureValue);
       let apertureValue = Math.pow(2, apexValue / 2);
        $('#aperture-value-value').text(apertureValue.toFixed(1) + ' EV');
        $('#aperture-value-row').show();
        technicalParamsShown = true;
    } else {
        $('#aperture-value-row').hide();
    }

    if (exif.FocalPlaneXResolution && exif.FocalPlaneYResolution) {
        exif.FocalPlaneXResolution = JSON.parse(exif.FocalPlaneXResolution);
        exif.FocalPlaneYResolution = JSON.parse(exif.FocalPlaneYResolution);
        let xRes = parseExifValue(exif.FocalPlaneXResolution);
        let yRes = parseExifValue(exif.FocalPlaneYResolution);
        $('#focal-plane-res-value').text(Math.round(xRes) + ' × ' + Math.round(yRes));
        $('#focal-plane-res-row').show();
        technicalParamsShown = true;
    } else {
        $('#focal-plane-res-row').hide();
    }

    if (technicalParamsShown) {
        $('#technical-params-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#technical-params-divider').show();
    }
}

function restoreFromHash() {
    if (window.location.hash) {
        let hashData = decodeURIComponent(window.location.hash.substring(1));
        try {
            let data = JSON.parse(hashData);
            // Find the element with matching filepath
            let elements = document.querySelectorAll('[filedata]');
            for (let el of elements) {
                let fdStr = el.getAttribute('filedata');
                if (fdStr) {
                    let fd = JSON.parse(decodeURIComponent(fdStr));
                    if (fd.filepath === data.filepath) {
                        showImage(el);
                        ShowModal();
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Invalid hash data', e);
        }
    }
}

// Restore the photo named in the address once the gallery is running (Alpine
// starts after the language file, which may be later than the load event)
document.addEventListener('alpine:initialized', () => {
    setTimeout(function(){
        if (window.location.hash) {
            const hashData = decodeURIComponent(window.location.hash.substring(1));
            try {
                const data = JSON.parse(hashData);
                let filename = data.filename;
                let filepath = data.filepath;
                let dir = filepath.split("/").slice(0, -1).join("/");

                // Access the Alpine data instance
                const appElement = document.querySelector('[x-data*="photoListObject"]');
                if (appElement) {
                    const app = appElement._x_dataStack[0];
                    if (app.currentPath !== dir) {
                        app.updateRenderingPath(dir, () => { 
                           setTimeout(function(){
                                console.log("Test")
                                restoreFromHash(); 
                           }, 100);
                        });
                    } else {
                        // Folder is already loaded, try to restore immediately
                        restoreFromHash();
                    }
                }
            } catch (e) {
                console.error('Invalid hash data', e);
            }
        }
     }, 100);
});

// ── Arozcast Photo Cast ───────────────────────────────────────────────────────

let _photoCastWs = null;
let _photoCastCode = null;
let _photoCastPingTimer = null;
let _photoCastWatchTimer = null;
let _photoCastLastSeen = 0;
let _currentCastFilepath = null;
let _photoCastReconnectTimer = null;
let _photoCastReconnectCount = 0;
let _photoCastPendingCode    = null;

function _photoCastConnected() { return _photoCastWs !== null && _photoCastWs.readyState === WebSocket.OPEN; }

function openPhotoCastDialog() {
    const modal = document.getElementById('cast-photo-modal');
    const inp   = document.getElementById('cast-photo-code');
    const err   = document.getElementById('cast-photo-error');
    const stat  = document.getElementById('cast-photo-status');
    const connBtn = document.getElementById('cast-photo-conn-btn');
    const discBtn = document.getElementById('cast-photo-disc-btn');

    err.textContent = '';
    if (_photoCastConnected()) {
        inp.style.display = 'none';
        stat.style.display = 'block';
        stat.textContent = T('cast/connected', 'Connected to room {code}', { code: _photoCastCode });
        connBtn.style.display = 'none';
        discBtn.style.display = '';
    } else {
        inp.style.display = '';
        inp.value = '';
        stat.style.display = 'none';
        connBtn.style.display = '';
        discBtn.style.display = 'none';
    }
    modal.classList.add('visible');
    if (inp.style.display !== 'none') inp.focus();
}

function closePhotoCastDialog() {
    document.getElementById('cast-photo-modal').classList.remove('visible');
}

function connectPhotoCast() {
    const inp  = document.getElementById('cast-photo-code');
    const err  = document.getElementById('cast-photo-error');
    const code = inp.value.trim();
    if (code.length !== 4) { err.textContent = T('cast/enterCode', 'Enter a 4-digit room code.'); return; }
    err.textContent = '';

    fetch(ao_root + 'api/arozcast/ping?code=' + code)
        .then(r => r.json())
        .then(data => {
            if (!data.exists) { err.textContent = T('cast/noRoom', 'Room not found. Is Arozcast running?'); return; }

            // Disconnect any existing photo cast session
            if (_photoCastWs) {
                _photoCastWs.onclose = null;
                _photoCastWs.close();
                _photoCastWs = null;
            }
            clearInterval(_photoCastPingTimer);
            clearInterval(_photoCastWatchTimer);
            // Cancel any pending auto-reconnect to the old room — user is opening a new session
            clearTimeout(_photoCastReconnectTimer); _photoCastReconnectTimer = null;
            _photoCastReconnectCount = 0; _photoCastPendingCode = null;

            // Signal other apps (e.g. Musicify) to yield the cast session
            try { new BroadcastChannel('arozcast').postMessage({ type: 'arozcast.takeover' }); } catch(e) {}

            _photoCastCode = code;
            const wsUrl = new URL(ao_root + 'api/arozcast/ws?code=' + code, window.location.href);
            wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(wsUrl.toString());
            _photoCastWs = ws;

            ws.onopen = function() {
                _photoCastLastSeen = Date.now();
                ws.send(JSON.stringify({ topic: 'peer.hello', payload: {} }));
                if (_currentCastFilepath) _photoCastSendPhoto(_currentCastFilepath);
                _photoCastPingTimer = setInterval(function() {
                    if (_photoCastConnected()) ws.send(JSON.stringify({ topic: 'peer.heartbeat', payload: {} }));
                }, 5000);
                _photoCastWatchTimer = setInterval(function() {
                    if (Date.now() - _photoCastLastSeen > 12000) { ws.close(); }
                }, 4000);
                // Update modal to connected state
                document.getElementById('cast-photo-status').style.display = 'block';
                document.getElementById('cast-photo-status').textContent = T('cast/connected', 'Connected to room {code}', { code: code });
                document.getElementById('cast-photo-code').style.display = 'none';
                document.getElementById('cast-photo-conn-btn').style.display = 'none';
                document.getElementById('cast-photo-disc-btn').style.display = '';
                document.getElementById('cast-photo-btn').classList.add('casting');
            };

            ws.onmessage = function() { _photoCastLastSeen = Date.now(); };

            ws.onclose = function() {
                clearInterval(_photoCastPingTimer);
                clearInterval(_photoCastWatchTimer);
                var savedCode = _photoCastCode;
                _photoCastWs = null;
                _photoCastCode = null;
                document.getElementById('cast-photo-btn').classList.remove('casting');
                _startPhotoCastReconnect(savedCode);
            };

            ws.onerror = function() { err.textContent = T('cast/connError', 'Connection error.'); };

            closePhotoCastDialog();
        })
        .catch(function() { err.textContent = T('cast/netError', 'Network error.'); });
}

function disconnectPhotoCast() {
    // Cancel any pending auto-reconnect before tearing down
    clearTimeout(_photoCastReconnectTimer); _photoCastReconnectTimer = null;
    _photoCastReconnectCount = 0; _photoCastPendingCode = null;
    if (_photoCastWs) {
        _photoCastWs.onclose = null;   // suppress reconnect trigger
        _photoCastWs.close();
        _photoCastWs = null;
    }
    clearInterval(_photoCastPingTimer);
    clearInterval(_photoCastWatchTimer);
    _photoCastCode = null;
    document.getElementById('cast-photo-btn').classList.remove('casting');
    closePhotoCastDialog();
}

function _photoCastSendPhoto(filepath) {
    if (!_photoCastConnected()) return;
    var fileUrl = ao_root + 'media?file=' + encodeURIComponent(filepath);
    _photoCastWs.send(JSON.stringify({
        topic: 'media.load',
        payload: { filepath: filepath, name: filepath.split('/').pop(), type: 'photo', src: fileUrl }
    }));
}

// ── Arozcast photo auto-reconnect ─────────────────────────────────────────────
var _PHOTO_CAST_RECONNECT_DELAYS = [2000, 5000, 12000];

function _startPhotoCastReconnect(code) {
    if (!code || _photoCastReconnectCount >= _PHOTO_CAST_RECONNECT_DELAYS.length) {
        _photoCastReconnectCount = 0; _photoCastPendingCode = null;
        return;
    }
    _photoCastPendingCode = code;
    var delay = _PHOTO_CAST_RECONNECT_DELAYS[_photoCastReconnectCount++];
    clearTimeout(_photoCastReconnectTimer);
    _photoCastReconnectTimer = setTimeout(function() {
        _photoCastReconnectTimer = null;
        _attemptPhotoCastReconnect();
    }, delay);
}

function _attemptPhotoCastReconnect() {
    if (!_photoCastPendingCode) return;
    var code = _photoCastPendingCode;
    var wsUrl = new URL(ao_root + 'api/arozcast/ws?code=' + code, window.location.href);
    wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(wsUrl.toString());
    var openTimer = setTimeout(function() {
        ws.onopen = ws.onclose = ws.onerror = null; ws.close();
        _startPhotoCastReconnect(code);
    }, 8000);
    ws.onopen  = function() { clearTimeout(openTimer); _photoCastPendingCode = null; _photoCastDidReconnect(ws, code); };
    ws.onerror = function() {};
    ws.onclose = function() { clearTimeout(openTimer); _startPhotoCastReconnect(code); };
}

function _photoCastDidReconnect(ws, code) {
    _photoCastWs = ws;
    _photoCastCode = code;
    _photoCastLastSeen = Date.now();
    ws.onmessage = function() { _photoCastLastSeen = Date.now(); _photoCastReconnectCount = 0; }; // any reply = receiver alive — reset retry counter
    ws.onclose = function() {
        clearInterval(_photoCastPingTimer); clearInterval(_photoCastWatchTimer);
        var savedCode = _photoCastCode;
        _photoCastWs = null; _photoCastCode = null;
        document.getElementById('cast-photo-btn').classList.remove('casting');
        _startPhotoCastReconnect(savedCode);
    };
    // Re-announce and re-push the current photo
    ws.send(JSON.stringify({ topic: 'peer.hello', payload: {} }));
    if (_currentCastFilepath) _photoCastSendPhoto(_currentCastFilepath);
    clearInterval(_photoCastPingTimer); clearInterval(_photoCastWatchTimer);
    _photoCastPingTimer = setInterval(function() {
        if (_photoCastConnected()) ws.send(JSON.stringify({ topic: 'peer.heartbeat', payload: {} }));
    }, 5000);
    _photoCastWatchTimer = setInterval(function() {
        if (Date.now() - _photoCastLastSeen > 12000) { ws.close(); }
    }, 4000);
    document.getElementById('cast-photo-btn').classList.add('casting');
    var stat = document.getElementById('cast-photo-status');
    if (stat) { stat.style.display = 'block'; stat.textContent = T('cast/reconnected', 'Reconnected to room {code}', { code: code }); }
}

// When the user returns to this tab after the phone was asleep, reconnect immediately
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && _photoCastPendingCode) {
        clearTimeout(_photoCastReconnectTimer);
        _photoCastReconnectTimer = null;
        _attemptPhotoCastReconnect();
    }
});
