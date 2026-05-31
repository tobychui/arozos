/*
    Musicify - Alpine.js Application Component
    Modern music player for ArozOS
*/



// ─── Default cover art SVG (music note) ──────────────────────────────────────
const DEFAULT_COVER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231e1e26'/%3E%3Ctext x='50' y='62' font-size='48' text-anchor='middle' fill='%23a855f7'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E";

function musicifyApp() {
    return {

        // ── Navigation ──────────────────────────────────────────────────────
        view: 'home',           // 'home' | 'folders' | 'artists' | 'recent' | 'playlist'
        sidebarOpen: false,
        loading: false,
        loadingMsg: '',

        // ── Folder Browser ──────────────────────────────────────────────────
        folderRoot: 'user:/Music',
        folderPath: 'user:/Music',
        folderStack: [],        // stack of previous paths for back navigation
        folderContents: { folders: [], songs: [] },
        musicLibraries: [],     // [ { label, root } ] from listRoots.js

        // ── Artists ─────────────────────────────────────────────────────────
        artists: [],
        selectedArtist: null,   // full artist object for dedicated artist songs view
        artistDetailOpen: false,
        artistsFromCache: false,
        artistsRefreshing: false,
        artistsCacheUpdatedAt: 0,
        _artistsFetchInFlight: false,
        _artistsUpdateFlash: false,
        _artistsUpdateFlashTimer: null,
        _artistsWorker: null,
        _artistsWorkerReqId: 0,
        _artistsActiveReqId: 0,
        _artistsWatchdogTimer: null,
        // Artist virtual scrolling
        artistRowHeight: 65, // must match CSS .artist-row height
        artistOverscan: 120, //artistRowHeight * artistOverscan = overscan px, Should be large enough for playlist expansion
        artistScrollTop: 0,
        artistListScrollTop: 0,
        selectedArtistListScrollTop: 0,

        // ── Recent ──────────────────────────────────────────────────────────
        recentSongs: [],

        // ── Playlists ────────────────────────────────────────────────────────
        playlists: [],
        currentPlaylistName: null,
        currentPlaylistSongs: [],
        showNewPlaylistModal: false,
        newPlaylistName: '',
        showAddToPlaylistModal: false,
        addToPlaylistSong: null,

        // ── Search ───────────────────────────────────────────────────────────
        searchQuery: '',
        searchResults: [],

        // ── Player ───────────────────────────────────────────────────────────
        queue: [],              // current ordered play queue
        shuffledQueue: [],      // shuffled copy used when shuffle is on
        queueIndex: -1,
        currentTrack: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        isSeeking: false,
        volume: 80,
        isMuted: false,
        shuffle: false,
        repeat: 'none',         // 'none' | 'all' | 'one'
        showQueue: false,
        coverError: false,

        // ── Sleep Timer ──────────────────────────────────────────────────────
        showSleepModal: false,
        sleepActive: false,
        sleepMinutes: 30,
        sleepCountdown: '',
        _sleepTimer: null,
        _sleepEnd: 0,

        // ── Recently Played (localStorage) ───────────────────────────────────
        recentlyPlayed: [],     // last 12 tracks

        // ── Track Info Panel ─────────────────────────────────────────────────
        showTrackInfo: false,
        trackInfoSong: null,

        // ── Internal playback guard ──────────────────────────────────────────
        _suppressEnded: false,  // true while a new track is loading (prevents double-skip)

        // ── Helpers (accessible from Alpine template expressions) ─────────────
        isSidebarDesktop() { return window.innerWidth > 768; },

        // ── Internal refs ────────────────────────────────────────────────────
        _audio: null,

        // ════════════════════════════════════════════════════════════════════
        //  INIT
        // ════════════════════════════════════════════════════════════════════
        init() {
            this._audio = document.getElementById('musicPlayer');
            const self = this;

            this._audio.addEventListener('timeupdate', () => {
                if (!self.isSeeking) self.currentTime = self._audio.currentTime;
            });
            this._audio.addEventListener('loadedmetadata', () => {
                self.duration = self._audio.duration || 0;
            });
            this._audio.addEventListener('ended', () => { self._onEnded(); });
            this._audio.addEventListener('error', () => { self._onError(); });
            this._audio.addEventListener('play',  () => { self.isPlaying = true; self._suppressEnded = false; self._updateMediaSession(); });
            this._audio.addEventListener('pause', () => { self.isPlaying = false; self._updateMediaSession(); });

            // Restore volume
            var savedVol = localStorage.getItem('musicify_volume');
            if (savedVol !== null) {
                this.volume = parseInt(savedVol);
                this._audio.volume = this.volume / 100;
            } else {
                this._audio.volume = this.volume / 100;
            }

            // Restore recently played
            try {
                var rp = localStorage.getItem('musicify_recent');
                if (rp) this.recentlyPlayed = JSON.parse(rp).slice(0, 12);
            } catch(e) {}

            // Restore shuffle/repeat prefs
            this.shuffle = localStorage.getItem('musicify_shuffle') === 'true';
            var rep = localStorage.getItem('musicify_repeat');
            if (rep === 'all' || rep === 'one') this.repeat = rep;

            // MediaSession
            this._setupMediaSession();

            // Load playlists for sidebar
            this._loadPlaylists();

            // Pre-load available music library roots for the folder-view switcher
            this._loadMusicLibraries();

            // Register service worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('sw.js').catch(function(){});
            }

            window.addEventListener('beforeunload', () => {
                if (this._artistsWorker) {
                    this._artistsWorker.terminate();
                    this._artistsWorker = null;
                }
            });

            // Handle #folder=<path> hash from embedded player's "Open in Musicify" button
            var _hash = window.location.hash;
            if (_hash.startsWith('#folder=')) {
                var _folder = decodeURIComponent(_hash.substring(8));
                window.history.replaceState(null, '', window.location.pathname);
                this.view = 'folders';
                this.folderStack = [];
                this.loadFolder(_folder);
            }

            // Responsive sidebar
            this.sidebarOpen = window.innerWidth > 768;
            var resizeT;
            window.addEventListener('resize', () => {
                clearTimeout(resizeT);
                resizeT = setTimeout(() => {
                    if (window.innerWidth <= 768) this.sidebarOpen = false;
                }, 150);
            });
        },

        // ════════════════════════════════════════════════════════════════════
        //  NAVIGATION
        // ════════════════════════════════════════════════════════════════════
        navigateTo(v) {
            this.view = v;
            this.searchQuery = '';
            if (window.innerWidth <= 768) this.sidebarOpen = false;

            if (v === 'folders') {
                if (this.musicLibraries.length === 0) this._loadMusicLibraries();
                if (this.folderContents.songs.length === 0 && this.folderContents.folders.length === 0) {
                    this.loadFolder(this.folderRoot);
                }
            } else if (v === 'artists') {
                this._loadArtists();
            } else if (v === 'recent' && this.recentSongs.length === 0) {
                this._loadRecent();
            }
        },

        openPlaylistView(name) {
            this.currentPlaylistName = name;
            this.view = 'playlist';
            if (window.innerWidth <= 768) this.sidebarOpen = false;
            this._loadPlaylistSongs(name);
        },

        // ════════════════════════════════════════════════════════════════════
        //  LIBRARY ROOTS
        // ════════════════════════════════════════════════════════════════════
        _loadMusicLibraries() {
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/listRoots.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }).then(r => r.json()).then(data => {
                // Remove tmp:/ and trash:/ from the array 
                data = Array.isArray(data) ? data.map(d => {
                    if (d.root.startsWith('tmp:/') || d.root.startsWith('trash:/')) {
                        return null;
                    }
                    return d;
                }) : [];
                self.musicLibraries = Array.isArray(data) ? data : [];
            }).catch(() => {});
        },

        switchLibrary(root) {
            this.folderRoot = root;
            this.folderStack = [];
            this.folderContents = { folders: [], songs: [] };
            this.loadFolder(root, false);
        },

        // ════════════════════════════════════════════════════════════════════
        //  FOLDER BROWSER
        // ════════════════════════════════════════════════════════════════════
        loadFolder(path, showLoading = true) {
            if (showLoading) {
                this.loadingMsg = 'Loading folder…';
                this.loading = true;
            }
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/listFolder.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: path })
            }).then(r => r.json()).then(data => {
                if (data.error) { self._showToast(data.error, 'error'); if (showLoading) self.loading = false; return; }
                self.folderContents = data;
                self.folderPath = path;
                if (showLoading) {
                    setTimeout(() => { self.loading = false; }, 100); // slight delay for smoother UX
                };
            }).catch(() => { if (showLoading){
                setTimeout(() => { self.loading = false; }, 100); // slight delay for smoother UX
            } });
        },

        folderNavigate(path) {
            this.folderStack.push(this.folderPath);
            this.artistDetailOpen = false;
            this.selectedArtist = null;
            this.loadFolder(path);
        },

        folderBack() {
            if (this.folderStack.length === 0) return;
            var prev = this.folderStack.pop();
            this.loadFolder(prev);
        },

        getFolderBreadcrumbs() {
            var parts = this.folderPath.split('/');
            var crumbs = [];
            var acc = '';
            for (var i = 0; i < parts.length; i++) {
                acc = i === 0 ? parts[0] : acc + '/' + parts[i];
                crumbs.push({ name: parts[i], path: acc });
            }
            return crumbs;
        },

        // ════════════════════════════════════════════════════════════════════
        //  ARTISTS
        // ════════════════════════════════════════════════════════════════════
        _loadArtists(opts) {
            opts = opts || {};
            var forceNetwork = !!opts.forceNetwork;
            var cache = null;

            // Artists refresh should never block the entire content panel.
            this.loading = false;

            if (!forceNetwork) {
                cache = this._readArtistsCache();
                if (cache && Array.isArray(cache.items)) {
                    this.artists = cache.items;
                    this.artistsFromCache = true;
                    this.artistsCacheUpdatedAt = cache.updatedAt || 0;
                }
            }

            if (this._artistsFetchInFlight) return;

            this._artistsFetchInFlight = true;
            this.artistsRefreshing = true;

            var reqId = ++this._artistsWorkerReqId;
            this._artistsActiveReqId = reqId;
            this._startArtistsWatchdog(reqId);

            // Use worker first to keep fetch + JSON parsing off the UI thread.
            var startedInWorker = this._dispatchArtistsFetchToWorker(reqId);
            if (!startedInWorker) {
                // Fallback for environments where Worker is unavailable.
                this._dispatchArtistsFetchFallback(reqId);
            }
        },

        _dispatchArtistsFetchToWorker(reqId) {
            if (!('Worker' in window)) return false;
            const self = this;

            if (!this._artistsWorker) {
                try {
                    this._artistsWorker = new Worker('artistsWorker.js');
                } catch (e) {
                    this._artistsWorker = null;
                    return false;
                }

                this._artistsWorker.onmessage = function(evt) {
                    var msg = evt && evt.data ? evt.data : {};
                    if (msg.type === 'artistsResult') {
                        self._applyArtistsResult(msg.items, msg.reqId);
                    } else if (msg.type === 'artistsError') {
                        self._handleArtistsError(msg.reqId);
                    }
                };

                this._artistsWorker.onerror = function() {
                    self._handleArtistsError(self._artistsActiveReqId);
                    if (self._artistsWorker) {
                        self._artistsWorker.terminate();
                        self._artistsWorker = null;
                    }
                };
            }

            try {
                this._artistsWorker.postMessage({
                    type: 'fetchArtists',
                    reqId: reqId,
                    endpoint: ao_root + 'system/ajgi/interface?script=Musicify/backend/listArtists.js'
                });
                return true;
            } catch (e) {
                return false;
            }
        },

        _dispatchArtistsFetchFallback(reqId) {
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/listArtists.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }).then(r => r.json()).then(data => {
                this._applyArtistsResult(data, reqId);
            }).catch(() => {
                this._handleArtistsError(reqId);
            });
        },

        _applyArtistsResult(data, reqId) {
            if (reqId !== this._artistsActiveReqId) return;

            data = Array.isArray(data) ? data : [];
            var selectedPath = this.selectedArtist ? this.selectedArtist.path : null;

            this.artists = data;
            this.artistsFromCache = false;
            this.artistsCacheUpdatedAt = Date.now();
            this._writeArtistsCache(data, this.artistsCacheUpdatedAt);
            this._flashArtistsUpdated();

            if (selectedPath) {
                var matched = null;
                for (var i = 0; i < data.length; i++) {
                    if (data[i].path === selectedPath) {
                        matched = data[i];
                        break;
                    }
                }
                this.selectedArtist = matched;
            }

            this._finalizeArtistsFetch(reqId);
        },

        _handleArtistsError(reqId) {
            if (reqId !== this._artistsActiveReqId) return;
            this._finalizeArtistsFetch(reqId);
        },

        _startArtistsWatchdog(reqId) {
            if (this._artistsWatchdogTimer) clearTimeout(this._artistsWatchdogTimer);
            const self = this;
            this._artistsWatchdogTimer = setTimeout(() => {
                if (reqId !== self._artistsActiveReqId) return;
                self._finalizeArtistsFetch(reqId);
                if (self._artistsWorker) {
                    self._artistsWorker.terminate();
                    self._artistsWorker = null;
                }
            }, 25000);
        },

        _finalizeArtistsFetch(reqId) {
            if (reqId !== this._artistsActiveReqId) return;
            if (this._artistsWatchdogTimer) {
                clearTimeout(this._artistsWatchdogTimer);
                this._artistsWatchdogTimer = null;
            }
            this.artistsRefreshing = false;
            this._artistsFetchInFlight = false;
        },

        _readArtistsCache() {
            try {
                var raw = localStorage.getItem('musicify_artists_cache');
                if (!raw) return null;
                var payload = JSON.parse(raw);
                if (!payload || !Array.isArray(payload.items)) return null;
                return {
                    updatedAt: payload.updatedAt || 0,
                    items: payload.items
                };
            } catch (e) {
                return null;
            }
        },

        _writeArtistsCache(items, updatedAt) {
            try {
                localStorage.setItem('musicify_artists_cache', JSON.stringify({
                    updatedAt: updatedAt || Date.now(),
                    items: Array.isArray(items) ? items : []
                }));
            } catch (e) {}
        },

        _flashArtistsUpdated() {
            this._artistsUpdateFlash = true;
            if (this._artistsUpdateFlashTimer) clearTimeout(this._artistsUpdateFlashTimer);
            const self = this;
            this._artistsUpdateFlashTimer = setTimeout(() => {
                self._artistsUpdateFlash = false;
            }, 3000);
        },

        artistsStatusText() {
            if (this.artistsRefreshing && this.artistsFromCache) {
                return 'Showing cached artists while refreshing in background';
            }
            if (this.artistsFromCache) {
                return 'Showing cached artists';
            }
            if (this.artistsRefreshing) {
                return 'Refreshing artist list';
            }
            if (this._artistsUpdateFlash) {
                return 'Artist list updated';
            }
            return 'Live artist list';
        },

        artistsUpdatedTimeText() {
            if (!this.artistsCacheUpdatedAt) return '';
            var d = new Date(this.artistsCacheUpdatedAt);
            return 'Updated at ' + d.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                timeZoneName: 'short'
            });
        },

        _getSelectedArtistListContainer() {
            return document.getElementById('artist-selected-content-body');
        },

        _getMainContentContainer() {
            return document.getElementById('mainContent');
        },

        selectArtist(artist) {
            var mainContainer = this._getMainContentContainer();
            if (mainContainer) {
                this.artistListScrollTop = mainContainer.scrollTop;
                this.artistScrollTop = mainContainer.scrollTop;
            }
            console.log(this.artistListScrollTop,  this.artistScrollTop);

            this.selectedArtist = artist;
            this.artistDetailOpen = true;

            this.$nextTick(() => {
                this.$nextTick(() => {
                    var mainContainer = this._getMainContentContainer();
                    if (mainContainer) {
                        mainContainer.scrollTop = 0;
                    };
                });
            });
        },

        backToArtistList() {
            this.artistDetailOpen = false;
            var targetScrollTop = this.artistListScrollTop || 0;
            this.artistScrollTop = targetScrollTop;

            this.$nextTick(() => {
                this.$nextTick(() => {
                    var mainContainer = this._getMainContentContainer();
                    if (mainContainer) {
                        mainContainer.scrollTop = targetScrollTop;
                    }
                });
            });
        },

        visibleArtists() {
            const viewportHeight = window.innerHeight;

            const start =
                Math.max(
                    0,
                    Math.floor(this.artistScrollTop / this.artistRowHeight)
                    - this.artistOverscan
                );

            const count =
                Math.ceil(viewportHeight / this.artistRowHeight)
                + (this.artistOverscan * 2);

            return this.artists.slice(start, start + count);
        },

        artistStartIndex() {
            return Math.max(
                0,
                Math.floor(this.artistScrollTop / this.artistRowHeight)
                - this.artistOverscan
            );
        },

        artistTopSpacerHeight() {
            return this.artistStartIndex() * this.artistRowHeight;
        },

        artistBottomSpacerHeight() {
            const rendered =
                this.visibleArtists().length;

            return Math.max(
                0,
                (this.artists.length -
                    this.artistStartIndex() -
                    rendered) * this.artistRowHeight
            );
        },

        onArtistScroll(e) {
            this.artistScrollTop = e.target.scrollTop;
            this.artistListScrollTop = e.target.scrollTop;
        },

        onSelectedArtistListScroll(e) {
            this.selectedArtistListScrollTop = e.target.scrollTop;
        },

        // ════════════════════════════════════════════════════════════════════
        //  RECENT
        // ════════════════════════════════════════════════════════════════════
        _loadRecent() {
            this.loading = true;
            this.loadingMsg = 'Loading recent tracks…';
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/listRecent.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }).then(r => r.json()).then(data => {
                self.recentSongs = data;
                self.loading = false;
            }).catch(() => { self.loading = false; });
        },

        // ════════════════════════════════════════════════════════════════════
        //  PLAYLISTS
        // ════════════════════════════════════════════════════════════════════
        _loadPlaylists() {
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/playlist.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opr: 'list_all' })
            }).then(r => r.json()).then(data => {
                self.playlists = Array.isArray(data) ? data : [];
            }).catch(() => {});
        },

        _loadPlaylistSongs(name) {
            this.loading = true;
            this.loadingMsg = 'Loading playlist…';
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/playlist.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opr: 'get', name: name })
            }).then(r => r.json()).then(data => {
                self.currentPlaylistSongs = Array.isArray(data) ? data : [];
                self.loading = false;
            }).catch(() => { self.loading = false; });
        },

        createPlaylist() {
            var n = this.newPlaylistName.trim();
            if (!n) return;
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/playlist.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opr: 'create', name: n })
            }).then(r => r.json()).then(data => {
                if (data.error) { self._showToast(data.error, 'error'); return; }
                self.newPlaylistName = '';
                self.showNewPlaylistModal = false;
                self._loadPlaylists();
                self._showToast('Playlist "' + n + '" created');
            });
        },

        deletePlaylist(name) {
            if (!confirm('Delete playlist "' + name + '"?')) return;
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/playlist.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opr: 'delete', name: name })
            }).then(() => {
                if (self.currentPlaylistName === name) { self.currentPlaylistName = null; self.view = 'home'; }
                self._loadPlaylists();
                self._showToast('Playlist deleted');
            });
        },

        promptAddToPlaylist(song, event) {
            if (event) event.stopPropagation();
            this.addToPlaylistSong = song;
            this.showAddToPlaylistModal = true;
        },

        addSongToPlaylist(playlistName) {
            if (!this.addToPlaylistSong) return;
            const self = this;
            const song = this.addToPlaylistSong;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/playlist.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opr: 'add', name: playlistName, song: encodeURIComponent(song.filepath) })
            }).then(r => r.json()).then(data => {
                self.showAddToPlaylistModal = false;
                self.addToPlaylistSong = null;
                if (data.error) { self._showToast(data.error, 'error'); return; }
                if (data.duplicate) { self._showToast('Already in playlist'); return; }
                self._showToast('Added to "' + playlistName + '"');
                self._loadPlaylists();
                if (self.currentPlaylistName === playlistName) self._loadPlaylistSongs(playlistName);
            });
        },

        removeFromCurrentPlaylist(index, event) {
            if (event) event.stopPropagation();
            const self = this;
            fetch(ao_root + 'system/ajgi/interface?script=Musicify/backend/playlist.js', {
                method: 'POST', cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opr: 'remove', name: self.currentPlaylistName, index: index })
            }).then(() => {
                self._loadPlaylistSongs(self.currentPlaylistName);
                self._loadPlaylists();
            });
        },

        // ════════════════════════════════════════════════════════════════════
        //  SEARCH
        // ════════════════════════════════════════════════════════════════════
        doSearch() {
            var q = this.searchQuery.toLowerCase().trim();
            if (!q) { this.searchResults = []; return; }
            // Search across already-loaded data pools
            var results = [];
            var seen = {};

            function addIfNew(song) {
                if (!seen[song.filepath]) {
                    seen[song.filepath] = true;
                    results.push(song);
                }
            }

            // Folder contents
            (this.folderContents.songs || []).forEach(s => { if (s.name.toLowerCase().includes(q)) addIfNew(s); });
            // Recent
            (this.recentSongs || []).forEach(s => { if (s.name.toLowerCase().includes(q)) addIfNew(s); });
            // Artists
            (this.artists || []).forEach(a => {
                (a.songs || []).forEach(s => { if (s.name.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) addIfNew(s); });
            });
            // Current playlist
            (this.currentPlaylistSongs || []).forEach(s => { if (s.name.toLowerCase().includes(q)) addIfNew(s); });
            // Recently played
            (this.recentlyPlayed || []).forEach(s => { if (s.name.toLowerCase().includes(q)) addIfNew(s); });

            this.searchResults = results.slice(0, 100);
        },

        // ════════════════════════════════════════════════════════════════════
        //  PLAYER – Queue management
        // ════════════════════════════════════════════════════════════════════
        playList(songs, startIndex) {
            if (!songs || songs.length === 0) return;
            startIndex = startIndex || 0;
            this.queue = songs.slice();
            this.queueIndex = startIndex;
            if (this.shuffle) this._buildShuffledQueue(startIndex);
            this._loadTrack(this._effectiveQueue()[this._effectiveIndex(startIndex)]);
        },

        playSong(song, sourceList, event) {
            if (event) event.stopPropagation();
            if (!sourceList || sourceList.length === 0) sourceList = [song];
            var idx = 0;
            for (var i = 0; i < sourceList.length; i++) {
                if (sourceList[i].filepath === song.filepath) { idx = i; break; }
            }
            this.playList(sourceList, idx);
        },

        addToQueue(song, event) {
            if (event) event.stopPropagation();
            this.queue.push(song);
            if (this.shuffle) this.shuffledQueue.push(song);
            this._showToast('Added to queue');
        },

        playNext(song, event) {
            if (event) event.stopPropagation();
            var insertAt = this.queueIndex + 1;
            this.queue.splice(insertAt, 0, song);
            if (this.shuffle) this.shuffledQueue.splice(this._effectiveIndex(this.queueIndex) + 1, 0, song);
            this._showToast('Playing next');
        },

        removeFromQueue(index, event) {
            if (event) event.stopPropagation();
            if (index === this.queueIndex) return; // can't remove currently playing
            this.queue.splice(index, 1);
            if (index < this.queueIndex) this.queueIndex--;
        },

        _effectiveQueue() { return this.shuffle ? this.shuffledQueue : this.queue; },

        _effectiveIndex(rawIndex) {
            if (!this.shuffle) return rawIndex;
            var track = this.queue[rawIndex];
            if (!track) return 0;
            for (var i = 0; i < this.shuffledQueue.length; i++) {
                if (this.shuffledQueue[i].filepath === track.filepath) return i;
            }
            return 0;
        },

        _buildShuffledQueue(currentIndex) {
            var arr = this.queue.slice();
            var current = arr.splice(currentIndex, 1)[0];
            for (var i = arr.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
            this.shuffledQueue = current ? [current].concat(arr) : arr;
        },

        // ════════════════════════════════════════════════════════════════════
        //  PLAYER – Playback control
        // ════════════════════════════════════════════════════════════════════
        _loadTrack(song) {
            if (!song) return;
            this._suppressEnded = true;
            this.currentTrack = song;
            this.coverError = false;
            this.currentTime = 0;
            this.duration = 0;
            this._audio.src = ao_root + 'media?file=' + encodeURIComponent(song.filepath);
            this._audio.load();
            this._audio.play().catch(() => {});
            this._saveRecentlyPlayed(song);
            this._setupMediaSession();
            document.title = song.name + ' – Musicify';
            if (ao_module_virtualDesktop){
                ao_module_setWindowTitle('Musicify - ' + song.name);
            }
            this.trackInfoSong = song;
        },

        togglePlay() {
            if (!this.currentTrack) return;
            if (this._audio.paused) { this._audio.play().catch(() => {}); }
            else { this._audio.pause(); }
        },

        nextTrack() {
            var eq = this._effectiveQueue();
            var ei = this._effectiveIndex(this.queueIndex);
            if (eq.length === 0) return;
            var next = ei + 1;
            if (next >= eq.length) {
                if (this.repeat === 'all') next = 0;
                else { this._audio.pause(); this.isPlaying = false; return; }
            }
            // Map back to queue index for shuffle mode
            if (this.shuffle) {
                var nextSong = this.shuffledQueue[next];
                for (var i = 0; i < this.queue.length; i++) {
                    if (this.queue[i].filepath === nextSong.filepath) { this.queueIndex = i; break; }
                }
            } else {
                this.queueIndex = next;
            }
            this._loadTrack(eq[next]);
        },

        prevTrack() {
            if (this.currentTime > 3) { this._audio.currentTime = 0; return; }
            var eq = this._effectiveQueue();
            var ei = this._effectiveIndex(this.queueIndex);
            var prev = ei - 1;
            if (prev < 0) { prev = this.repeat === 'all' ? eq.length - 1 : 0; }
            if (this.shuffle) {
                var prevSong = this.shuffledQueue[prev];
                for (var i = 0; i < this.queue.length; i++) {
                    if (this.queue[i].filepath === prevSong.filepath) { this.queueIndex = i; break; }
                }
            } else {
                this.queueIndex = prev;
            }
            this._loadTrack(eq[prev]);
        },

        seekTo(val) {
            this._audio.currentTime = parseFloat(val);
            this.currentTime = this._audio.currentTime;
        },

        beginSeek() { this.isSeeking = true; },
        endSeek(val) { this.isSeeking = false; this.seekTo(val); },

        setVolume(val) {
            this.volume = parseInt(val);
            this._audio.volume = this.volume / 100;
            this.isMuted = this.volume === 0;
            localStorage.setItem('musicify_volume', this.volume);
        },

        toggleMute() {
            this.isMuted = !this.isMuted;
            this._audio.muted = this.isMuted;
        },

        toggleShuffle() {
            this.shuffle = !this.shuffle;
            localStorage.setItem('musicify_shuffle', this.shuffle);
            if (this.shuffle) this._buildShuffledQueue(this.queueIndex);
        },

        cycleRepeat() {
            var modes = ['none', 'all', 'one'];
            var idx = modes.indexOf(this.repeat);
            this.repeat = modes[(idx + 1) % modes.length];
            localStorage.setItem('musicify_repeat', this.repeat);
        },

        _onEnded() {
            if (this._suppressEnded) return;
            if (this.repeat === 'one') {
                this._audio.currentTime = 0;
                this._audio.play().catch(() => {});
                return;
            }
            this.nextTrack();
        },

        _onError() {
            this._showToast('Playback error – skipping', 'error');
            setTimeout(() => { this.nextTrack(); }, 1500);
        },

        isCurrentTrack(song) {
            return this.currentTrack && this.currentTrack.filepath === song.filepath;
        },

        isCurrentQueueItem(index) {
            if (!this.shuffle) return index === this.queueIndex;
            var eq = this._effectiveQueue();
            var current = eq[this._effectiveIndex(this.queueIndex)];
            return current && this.queue[index].filepath === current.filepath;
        },

        // ════════════════════════════════════════════════════════════════════
        //  SLEEP TIMER
        // ════════════════════════════════════════════════════════════════════
        startSleepTimer() {
            this.cancelSleepTimer();
            this._sleepEnd = Date.now() + this.sleepMinutes * 60000;
            this.sleepActive = true;
            this.showSleepModal = false;
            const self = this;
            this._sleepTimer = setInterval(() => {
                var rem = self._sleepEnd - Date.now();
                if (rem <= 0) {
                    self._fadeOutAndPause();
                    self.cancelSleepTimer();
                } else {
                    var m = Math.floor(rem / 60000);
                    var s = Math.floor((rem % 60000) / 1000);
                    self.sleepCountdown = m + ':' + String(s).padStart(2, '0');
                }
            }, 1000);
            this._showToast('Sleep timer set for ' + this.sleepMinutes + ' min');
        },

        cancelSleepTimer() {
            if (this._sleepTimer) clearInterval(this._sleepTimer);
            this._sleepTimer = null;
            this.sleepActive = false;
            this.sleepCountdown = '';
        },

        _fadeOutAndPause() {
            const audio = this._audio;
            const originalVol = audio.volume;
            const self = this;
            var fadeInterval = setInterval(() => {
                if (audio.volume > 0.05) {
                    audio.volume = Math.max(0, audio.volume - 0.04);
                } else {
                    audio.volume = 0;
                    audio.pause();
                    audio.volume = originalVol;
                    self.isPlaying = false;
                    clearInterval(fadeInterval);
                    self._showToast('Sleep timer: music stopped');
                }
            }, 150);
        },

        // ════════════════════════════════════════════════════════════════════
        //  MEDIA SESSION API
        // ════════════════════════════════════════════════════════════════════
        _setupMediaSession() {
            if (!('mediaSession' in navigator) || !this.currentTrack) return;
            const self = this;
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.currentTrack.name,
                artist: this._getArtistName(this.currentTrack),
                album: '',
                artwork: [{ src: this.getCoverUrl(this.currentTrack), sizes: '512x512', type: 'image/jpeg' }]
            });
            navigator.mediaSession.setActionHandler('play',          () => self._audio.play());
            navigator.mediaSession.setActionHandler('pause',         () => self._audio.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => self.prevTrack());
            navigator.mediaSession.setActionHandler('nexttrack',     () => self.nextTrack());
            navigator.mediaSession.setActionHandler('seekto', details => {
                self._audio.currentTime = details.seekTime;
            });
        },

        _updateMediaSession() {
            if (!('mediaSession' in navigator)) return;
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
            if (this.duration > 0) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: this.duration,
                        playbackRate: 1,
                        position: Math.min(this.currentTime, this.duration)
                    });
                } catch(e) {}
            }
        },

        // ════════════════════════════════════════════════════════════════════
        //  RECENTLY PLAYED (localStorage)
        // ════════════════════════════════════════════════════════════════════
        _saveRecentlyPlayed(song) {
            var list = this.recentlyPlayed.filter(s => s.filepath !== song.filepath);
            list.unshift(song);
            list = list.slice(0, 12);
            this.recentlyPlayed = list;
            try { localStorage.setItem('musicify_recent', JSON.stringify(list)); } catch(e) {}
        },

        // ════════════════════════════════════════════════════════════════════
        //  HELPERS
        // ════════════════════════════════════════════════════════════════════
        formatTime(s) {
            if (!s || isNaN(s)) return '0:00';
            s = Math.floor(s);
            return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        },

        getCoverUrl(song) {
            if (!song) return 'img/placeholder.png';
            return ao_root + 'system/file_system/loadThumbnail?bytes=true&vpath=' + encodeURIComponent(song.filepath);
        },

        handleCoverError(event) {
            event.target.src = 'img/placeholder.png';
            event.target.onerror = null;
        },

        _getArtistName(song) {
            if (!song) return '';
            var parts = song.filepath.split('/');
            // /user:/Music/ArtistName/... → index 2
            if (parts.length >= 3) return parts[parts.length - 2];
            return '';
        },

        getArtistLabel(song) {
            return this._getArtistName(song) || '';
        },

        progressPercent() {
            if (!this.duration) return 0;
            return (this.currentTime / this.duration) * 100;
        },

        volumeIcon() {
            if (this.isMuted || this.volume === 0) return 'volume off';
            if (this.volume < 40) return 'volume down';
            return 'volume up';
        },

        repeatIcon() {
            if (this.repeat === 'one') return 'repeat';
            return 'redo alternate';
        },

        repeatTitle() {
            if (this.repeat === 'none') return 'Repeat: off';
            if (this.repeat === 'all') return 'Repeat: all';
            return 'Repeat: one';
        },

        // ════════════════════════════════════════════════════════════════════
        //  TRACK INFO PANEL
        // ════════════════════════════════════════════════════════════════════
        openTrackInfo(song, event) {
            if (event) event.stopPropagation();
            if (!song) return;
            var mc = document.getElementById('mainContent');
            // Pin overlay to the current visible top before Alpine shows it
            var overlay = mc ? mc.querySelector('.track-info-overlay') : null;
            if (overlay) overlay.style.top = (mc.scrollTop) + 'px';
            if (mc) mc.style.overflow = 'hidden';
            this.trackInfoSong = song;
            this.showTrackInfo = true;
            if (!ao_module_virtualDesktop){
                // Not in webdesktop mode, so "Open in Embedded Player" option doesn't make sense – hide it
                $("#open-in-embedded").hide();
            }else{
                $("#open-in-embedded").show();
            }
        },

        closeTrackInfo() {
            this.showTrackInfo = false;
            this.trackInfoSong = null;
            var mc = document.getElementById('mainContent');
            if (mc) mc.style.overflow = '';
        },

        copyTrackTitle(song) {
            if (!song) return;
            var text = song.name;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text)
                    .then(() => { this._showToast('Title copied!'); })
                    .catch(() => { this._showToast('Failed to copy', 'error'); });
            } else {
                var el = document.createElement('textarea');
                el.value = text;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                this._showToast('Title copied!');
            }
        },

        openInFileManager(song) {
            if (!song) return;
            var parts = song.filepath.split('/');
            var filename = parts.pop();
            var folder = parts.join('/');
            ao_module_openPath(folder, filename);
        },

        openInEmbedded(song) {
            if (!song) return;
            var fileList = [{
                filename: song.name + (song.ext ? '.' + song.ext : ''),
                filepath: song.filepath
            }];
            ao_module_newfw({
                url: 'Musicify/embedded.html#' + encodeURIComponent(JSON.stringify(fileList)),
                title: song.name,
                appicon: 'Musicify/img/module_icon.png',
                width: 360,
                height: 254
            });
        },

        searchOnYoutube(song) {
            if (!song) return;
            var q = encodeURIComponent(song.name + ' ' + this.getArtistLabel(song));
            window.open('https://www.youtube.com/results?search_query=' + q, '_blank');
        },

        downloadSong(song) {
            if (!song) return;
            var a = document.createElement('a');
            a.href = ao_root + 'media?file=' + encodeURIComponent(song.filepath);
            a.download = song.name + (song.ext ? '.' + song.ext : '');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },

        getTrackFolder(song) {
            if (!song) return '';
            var parts = song.filepath.split('/');
            parts.pop();
            return parts.join('/');
        },

        // Toast notification (simple, injected into DOM)
        _toastTimer: null,
        toastMsg: '',
        toastType: 'info',
        showToast: false,
        _showToast(msg, type) {
            this.toastMsg = msg;
            this.toastType = type || 'info';
            this.showToast = true;
            if (this._toastTimer) clearTimeout(this._toastTimer);
            const self = this;
            this._toastTimer = setTimeout(() => { self.showToast = false; }, 2500);
        }
    };
}
