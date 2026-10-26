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

// Grid zoom: 0 = responsive (auto column count by width); a positive value pins
// the number of columns, set by the user with Ctrl/⌘ + mouse wheel over the grid
// (Google-Photos-style gallery zoom). Smaller column count => larger thumbnails.
let photoGridColumns = 0;
const PHOTO_GRID_MIN_COLS = 2;
const PHOTO_GRID_MAX_COLS = 12;

function getContainerWidth(){
    const container = document.getElementById('viewboxContainer');
    return container ? container.clientWidth : (window.innerWidth - 210);
}

// Responsive column count for a given container width (used until the user
// pins a zoom level via the mouse wheel).
function autoColumnCount(containerWidth){
    if (containerWidth < 400) return 2;
    if (containerWidth < 600) return 3;
    if (containerWidth < 900) return 4;
    if (containerWidth < 1100) return 5;
    if (containerWidth < 1400) return 6;
    return 8;
}

function getColumnCount(){
    if (photoGridColumns > 0) return photoGridColumns;
    return autoColumnCount(getContainerWidth());
}

function getImageWidth(){
    // Use the actual viewbox container width so the sidebar and scrollbar are
    // already subtracted — this prevents gaps when the window is resized.
    return Math.floor(getContainerWidth() / getColumnCount());
}

function updateImageSizes(){
    let newImageWidth = getImageWidth();
    //Updates all the size of the images
    $(".imagecard").css({
        width: newImageWidth,
        height: newImageWidth
    });
}

// Briefly show the current columns-per-row while zooming the grid.
let _gridZoomHintTimer = null;
function showGridZoomHint(cols){
    const el = document.getElementById('grid-zoom-snackbar');
    if (!el) return;
    el.textContent = cols + ' per row';
    el.classList.add('visible');
    clearTimeout(_gridZoomHintTimer);
    _gridZoomHintTimer = setTimeout(function(){ el.classList.remove('visible'); }, 1100);
}

// ── Date grouping (Google-Photos-style Year / Month sections) ──────────────────
// Capture date for a grid item: the EXIF shoot time (taken_date, supplied by
// both search results and folder listings via the photo index) with file mtime
// as the fallback for photos the background indexer has not reached yet.
function photoImageDateUnix(img){
    if (!img) return null;
    if (img.taken_date) return img.taken_date;
    if (img.mtime) return img.mtime;
    if (img.modified_date) return img.modified_date;
    return null;
}

// "June 2023" style header for a unix-second timestamp (PHOTO_MONTHS: search.js).
function photoGroupLabel(unixSec){
    if (!unixSec) return 'Undated';
    var d = new Date(unixSec * 1000);
    if (isNaN(d.getTime())) return 'Undated';
    return PHOTO_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

// Newest-first ordering so each Year/Month section is contiguous regardless of
// the folder's own sort order.
function sortImagesByDateDesc(arr){
    return arr.slice().sort(function(a, b){
        return (photoImageDateUnix(b) || 0) - (photoImageDateUnix(a) || 0);
    });
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

function photoListObject() {
    return {
        // data
        pathWildcard: "user:/Photo/*",
        currentPath: "user:/Photo",
        renderSize: 200,
        vroots: [],
        allImages: [],       // full list from server
        images: [],           // currently displayed slice
        folders: [],
        sortOrder: 'smart',
        groupByDate: true,    // Google-Photos-style Year / Month grid sections
        ratingFilter: 0,      // active "rating ≥ N stars" quick filter (0 = off)
        restored: false,
        hasMoreImages: false,
        isLoadingMore: false, // guard: blocks new batch until DOM has updated
        sidebarOpen: !isMobile,  // start hidden on mobile, visible on desktop

        // search state (tags input)
        searchTags: [],         // committed filter chips: {label, value, type}
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

        // init
        init() {
            this.getFolderInfo();
            this.getRootInfo();
            this.renderSize = getImageWidth();
            updateImageSizes();
            this.restored = false;
            this.$nextTick(() => { this.setupInfiniteScroll(); this.setupGridZoom(); });

            // Kick off background (auto) indexing shortly after the first paint so
            // it doesn't compete with the initial folder load.
            setTimeout(() => { this.startAutoIndex(); }, 1200);

            const MOBILE_BP = 768;
            let _prevMobile = window.innerWidth <= MOBILE_BP;
            let _resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(_resizeTimer);
                _resizeTimer = setTimeout(() => {
                    // Recalculate tile sizes
                    this.renderSize = getImageWidth();
                    updateImageSizes();

                    // Auto-manage sidebar visibility on breakpoint crossing
                    const nowMobile = window.innerWidth <= MOBILE_BP;
                    if (nowMobile && !_prevMobile) {
                        // Desktop → mobile: hide sidebar so it doesn't overlay content
                        this.sidebarOpen = false;
                    } else if (!nowMobile && _prevMobile) {
                        // Mobile → desktop: sidebar is back in normal flow, keep state clean
                        this.sidebarOpen = false;
                    }
                    _prevMobile = nowMobile;
                }, 80);
            });
        },
        
        updateRenderingPath(newPath, callback = null){
            this.currentPath = JSON.parse(JSON.stringify(newPath));
            this.pathWildcard = newPath + '/*';
            this.restored = false;
            if (isMobile) this.sidebarOpen = false;
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

        getFolderInfo(callback = null) {
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listFolder.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "folder": this.pathWildcard,
                    "sort": this.sortOrder
                })
            }).then(resp => {
                resp.json().then(data => {
                    console.log(data);
                    this.folders = data[0];
                    this.allImages = data[1];
                    // Date grouping reads cleanest newest-first; sort the loaded
                    // list so Year/Month sections are contiguous as you scroll.
                    if (this.groupByDate) { this.allImages = sortImagesByDateDesc(this.allImages); }
                    this.images = this.allImages.slice(0, PAGE_SIZE);
                    this.hasMoreImages = this.allImages.length > PAGE_SIZE;
                    this.isLoadingMore = false;

                    if (this.allImages.length == 0){
                        $("#noimg").show();
                    }else{
                        $("#noimg").hide();
                    }

                    console.log(this.folders);

                    if (!this.restored) { restoreFromHash(); this.restored = true; }
                    
                    if (callback) callback();
                });
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
                    this.$nextTick(() => {
                        $('.ui.dropdown').dropdown();
                    });
                });
            })
        },

        changeSort(newSort) {
            this.sortOrder = newSort;
            this.getFolderInfo();
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
            this.$nextTick(() => { this.isLoadingMore = false; });
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

        // ── Grid zoom (Ctrl/⌘ + mouse wheel) ───────────────────────────────────

        // Recompute the tile size from the current column count and push it to
        // both the reactive binding and the already-rendered cards.
        applyRenderSize() {
            this.renderSize = getImageWidth();
            updateImageSizes();
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

        // direction: +1 = zoom in (fewer columns, larger photos), -1 = zoom out.
        zoomGrid(direction) {
            const cur = getColumnCount();
            let next = cur - direction;
            if (next < PHOTO_GRID_MIN_COLS) next = PHOTO_GRID_MIN_COLS;
            if (next > PHOTO_GRID_MAX_COLS) next = PHOTO_GRID_MAX_COLS;
            if (next === cur) return;
            photoGridColumns = next;
            this.applyRenderSize();
            showGridZoomHint(next);
        },

        // ── Date grouping ──────────────────────────────────────────────────────

        // Split the loaded slice into contiguous Year/Month sections for the grid.
        // Returns a single unlabelled group when grouping is disabled.
        groupedImages() {
            const imgs = this.images;
            if (!this.groupByDate) {
                return [{ key: 'all', label: '', images: imgs }];
            }
            const groups = [];
            let cur = null;
            for (let i = 0; i < imgs.length; i++) {
                const img = imgs[i];
                const d = photoImageDateUnix(img);
                let key, label;
                if (d) {
                    const dt = new Date(d * 1000);
                    key = dt.getFullYear() + '-' + (dt.getMonth() + 1);
                    label = photoGroupLabel(d);
                } else {
                    key = 'undated';
                    label = 'Undated';
                }
                if (!cur || cur.key !== key) {
                    cur = { key: key, label: label, images: [] };
                    groups.push(cur);
                }
                cur.images.push(img);
            }
            return groups;
        },

        // Re-fetch the current view so the new ordering / headers take effect.
        onGroupByDateChange() {
            if (this.searchMode) { this.runSearch(); }
            else { this.getFolderInfo(); }
        },

        // ── Rating quick-filter (sidebar stars) ────────────────────────────────

        // Select "rating ≥ n" (tapping the active level again clears it). Driven
        // through the same search-chip pipeline as every other filter.
        setRatingFilter(n) {
            n = parseInt(n, 10) || 0;
            if (n === this.ratingFilter) n = 0;
            this.ratingFilter = n;
            this.searchTags = this.searchTags.filter(function (t) { return t.type !== 'rating'; });
            if (n > 0) {
                this.searchTags.push({ label: '★ ≥ ' + n, value: 'rating:>=' + n, type: 'rating' });
            }
            this.runSearch();
        },

        // Keep the sidebar stars in step with whatever rating chip is present
        // (a chip may also be typed, picked from autocomplete or removed by hand).
        syncRatingFilterFromTags() {
            let found = 0;
            for (let i = 0; i < this.searchTags.length; i++) {
                const t = this.searchTags[i];
                if (t.type === 'rating') {
                    const m = ('' + t.value).match(/(\d)/);
                    if (m) found = parseInt(m[1], 10);
                }
            }
            this.ratingFilter = found;
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
                this.suggestions = (data && data.suggestions) ? data.suggestions : [];
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
            this.searchTags.push({ label: tag.label, value: tag.value, type: tag.type || 'search' });
            this.searchInput = '';
            this.suggestions = [];
            this.showSuggestions = false;
            this.suggestIndex = -1;
            this.runSearch();
        },

        // A picked autocomplete suggestion becomes a chip.
        applySuggestion(s) { this.addTag({ label: s.label, value: s.value, type: s.type }); },

        // Commit whatever text is in the box as a chip (Enter / Space).
        commitInput() {
            const text = this.searchInput.trim();
            if (text.length === 0) return;
            this.addTag(photoParseTagToken(text));
        },

        removeTag(i) {
            this.searchTags.splice(i, 1);
            this.runSearch();
            this.$nextTick(() => { const el = document.getElementById('photo-search-input'); if (el) el.focus(); });
        },

        removeLastTag() {
            if (this.searchTags.length > 0) {
                this.searchTags.pop();
                this.runSearch();
            }
        },

        runSearch() {
            // NOTE: this is also the live/debounced search fired while typing, so it
            // must NOT close the autocomplete dropdown — only explicit actions
            // (pick/commit/Escape/click-outside/clear) hide it. Closing it here made
            // the dropdown flash and vanish ~400ms after each keystroke.
            clearTimeout(this._searchTimer);
            this.syncRatingFilterFromTags();
            const q = this.currentQuery();
            if (q.length === 0) {
                // Nothing to search — fall back to normal folder browsing.
                if (this.searchMode) { this.searchMode = false; this.searchTotal = 0; this.getFolderInfo(); }
                return;
            }
            this.searchMode = true;
            aoPhotoBackend("Photo/backend/searchPhotos.js", {
                q: q,
                sort: 'taken_desc',
                limit: 1000
            }).then(data => {
                const results = (data && data.results) ? data.results : [];
                this.searchTotal = (data && typeof data.total === 'number') ? data.total : results.length;
                // Carry the date + rating through so the grid can group by month
                // and the viewer can show the star rating without a refetch.
                this.allImages = results.map(r => ({
                    filepath: r.filepath, filesize: r.filesize,
                    taken_date: r.taken_date, modified_date: r.modified_date, rating: r.rating
                }));
                if (this.groupByDate) { this.allImages = sortImagesByDateDesc(this.allImages); }
                this.images = this.allImages.slice(0, PAGE_SIZE);
                this.hasMoreImages = this.allImages.length > PAGE_SIZE;
                this.isLoadingMore = false;
                this.folders = [];
                if (this.allImages.length == 0) { $("#noimg").show(); } else { $("#noimg").hide(); }
                this.$nextTick(() => { updateImageSizes(); });
            }).catch(() => { /* leave current view untouched on error */ });
        },

        clearSearch() {
            this.searchTags = [];
            this.searchInput = '';
            this.suggestions = [];
            this.showSuggestions = false;
            this.suggestIndex = -1;
            this.searchTotal = 0;
            this.searchMode = false;
            this.ratingFilter = 0;
            clearTimeout(this._searchTimer);
            this.getFolderInfo();   // restore normal folder browsing
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

        // ── Auto indexing ─────────────────────────────────────────────────────
        // Loops indexPhotos.js in the background until the whole library is
        // indexed. Incremental, so steady-state runs finish in a single pass.
        startAutoIndex() {
            if (this.indexing) return;
            this.indexing = true;
            let indexedThisRun = 0;
            const step = () => {
                aoPhotoBackend("Photo/backend/indexPhotos.js", { mode: 'incremental' }).then(data => {
                    if (data && data.error) { this.indexing = false; this.indexStatusText = ''; return; }
                    const total = (data && data.total) ? data.total : 0;
                    indexedThisRun += (data && data.indexed) ? data.indexed : 0;
                    if (data && data.hasMore) {
                        this.indexStatusText = 'Indexing… ' + total + ' photos';
                        setTimeout(step, 50);
                    } else {
                        this.indexing = false;
                        this.indexStatusText = total ? (total + ' photos indexed') : '';
                        // Newly indexed photos may carry EXIF shoot times the
                        // current grid grouped without (mtime fallback) — reload
                        // the view so the Year/Month sections use them.
                        if (indexedThisRun > 0 && this.groupByDate && !this.searchMode) {
                            this.getFolderInfo();
                        }
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
            this.indexStatusText = 'Rebuilding index…';
            const step = (mode) => {
                aoPhotoBackend("Photo/backend/indexPhotos.js", { mode: mode }).then(data => {
                    if (data && data.error) { this.indexing = false; this.indexStatusText = ''; return; }
                    const total = (data && data.total) ? data.total : 0;
                    if (data && data.hasMore) {
                        this.indexStatusText = 'Rebuilding… ' + total + ' photos';
                        setTimeout(() => step('incremental'), 50);
                    } else {
                        this.indexing = false;
                        this.indexStatusText = total ? (total + ' photos indexed') : '';
                        if (this.searchMode) { this.runSearch(); }
                        else if (this.groupByDate) { this.getFolderInfo(); } // refresh EXIF shoot times
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
    ao_module_setWindowTitle("Photo");

    setTimeout(function(){
        $("#fullImage").attr("src","img/loading.png");
        $("#compressedImage").attr("src","").hide().removeClass('hidden');
        $("#bg-image").attr("src","");
        $("#info-filename").text("");
        $("#info-filepath").text("");
        $("#info-dimensions").text("Loading...");

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
    $("#info-dimensions").text("Calculating...");
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
        $("#loading-progress").html(`<i class="loading spinner icon"></i> Loading`);
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
                    $("#loading-progress").html(`<i class="loading spinner icon"></i> Optimizing Resolution`);
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

        ao_module_setWindowTitle("Photo - " + fd.filename);
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
    if (label) label.textContent = currentPhotoRating ? (currentPhotoRating + ' / 5') : 'Rate';
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
        let colorSpace = exif.ColorSpace === 1 ? "sRGB" : exif.ColorSpace === 65535 ? "Uncalibrated" : "Unknown";
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
        let programs = ["Not defined", "Manual", "Normal program", "Aperture priority", "Shutter priority", "Creative program", "Action program", "Portrait mode", "Landscape mode"];
        let program = programs[exif.ExposureProgram] || "Unknown";
        $('#exposure-program-value').text(program);
        $('#exposure-program-row').show();
        shootingModeShown = true;
    } else {
        $('#exposure-program-row').hide();
    }

    if (exif.ExposureMode !== undefined) {
        let modes = ["Auto exposure", "Manual exposure", "Auto bracket"];
        let mode = modes[exif.ExposureMode] || "Unknown";
        $('#exposure-mode-value').text(mode);
        $('#exposure-mode-row').show();
        shootingModeShown = true;
    } else {
        $('#exposure-mode-row').hide();
    }

    if (exif.MeteringMode !== undefined) {
        let metering = ["Unknown", "Average", "Center-weighted average", "Spot", "Multi-spot", "Pattern", "Partial"];
        let meter = metering[exif.MeteringMode] || "Unknown";
        $('#metering-mode-value').text(meter);
        $('#metering-mode-row').show();
        shootingModeShown = true;
    } else {
        $('#metering-mode-row').hide();
    }

    if (exif.WhiteBalance !== undefined) {
        let wb = exif.WhiteBalance === 0 ? "Auto" : "Manual";
        $('#white-balance-value').text(wb);
        $('#white-balance-row').show();
        shootingModeShown = true;
    } else {
        $('#white-balance-row').hide();
    }

    if (exif.Flash !== undefined) {
        let flash = (exif.Flash & 1) ? "On" : "Off";
        $('#flash-value').text(flash);
        $('#flash-row').show();
        shootingModeShown = true;
    } else {
        $('#flash-row').hide();
    }

    if (exif.SceneCaptureType !== undefined) {
        let scenes = ["Standard", "Landscape", "Portrait", "Night scene"];
        let scene = scenes[exif.SceneCaptureType] || "Unknown";
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

// Modify the window onload event to ensure folder and thumbnails are loaded first
window.addEventListener('load', () => {
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
        stat.textContent = 'Connected to room ' + _photoCastCode;
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
    if (code.length !== 4) { err.textContent = 'Enter a 4-digit room code.'; return; }
    err.textContent = '';

    fetch(ao_root + 'api/arozcast/ping?code=' + code)
        .then(r => r.json())
        .then(data => {
            if (!data.exists) { err.textContent = 'Room not found. Is Arozcast running?'; return; }

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
                document.getElementById('cast-photo-status').textContent = 'Connected to room ' + code;
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

            ws.onerror = function() { err.textContent = 'Connection error.'; };

            closePhotoCastDialog();
        })
        .catch(function() { err.textContent = 'Network error.'; });
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
    if (stat) { stat.style.display = 'block'; stat.textContent = 'Reconnected to room ' + code; }
}

// When the user returns to this tab after the phone was asleep, reconnect immediately
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && _photoCastPendingCode) {
        clearTimeout(_photoCastReconnectTimer);
        _photoCastReconnectTimer = null;
        _attemptPhotoCastReconnect();
    }
});
