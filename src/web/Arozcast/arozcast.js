/**
 * arozcast.js — Arozcast Sender SDK
 *
 * A lightweight, self-contained client library for ArozOS webapps that want
 * to cast media to an Arozcast receiver screen.
 *
 * Include with a plain <script> tag — no build tools or module system needed:
 *
 *   <script src="../../Arozcast/arozcast.js"></script>
 *
 * Then create one instance per cast session:
 *
 *   const cast = new ArozCast({ aoRoot: ao_root });
 *   cast.on('status', s => console.log(s.currentTime));
 *
 *   cast.ping('1234').then(exists => {
 *       if (exists) cast.connect('1234').then(() => {
 *           cast.load({ name: 'clip.mp4', type: 'video', src: url, filepath: vpath });
 *           cast.setVolume(videoEl.volume * 100, videoEl.muted);
 *           cast.play();
 *       });
 *   });
 *
 * See arozcast.md for the full reference.
 */
class ArozCast {
    /**
     * @param {object}   [options]
     * @param {string}   [options.aoRoot]           - ArozOS root URL (defaults to the
     *                                                 global `ao_root` variable or '/').
     * @param {number[]} [options.reconnectDelays]   - Backoff delays in ms before each
     *                                                 reconnection attempt. Default: [2000, 5000, 12000].
     *                                                 Pass [] to disable auto-reconnect.
     */
    constructor(options = {}) {
        this._root    = options.aoRoot
                     || (typeof ao_root !== 'undefined' ? ao_root : '/');
        this._delays  = options.reconnectDelays !== undefined
                     ? options.reconnectDelays
                     : [2000, 5000, 12000];

        /** @type {string|null} Current room code, or null when not connected. */
        this.code      = null;
        /** @type {boolean} True while the WebSocket is open. */
        this.connected = false;

        this._ws             = null;
        this._pingTimer      = null;
        this._watchTimer     = null;
        this._lastSeen       = 0;
        this._reconnectTimer = null;
        this._reconnectCount = 0;
        this._pendingCode    = null;  // code being retried
        this._intentional    = false; // true when WE are closing the socket on purpose
        this._listeners      = {};    // event → [handler, ...]

        // ── Visibility accelerator ─────────────────────────────────────────
        // When the phone comes back from sleep, retry reconnect immediately
        // rather than waiting for the next scheduled attempt.
        this._onVisibility = () => {
            if (document.visibilityState === 'visible' && this._pendingCode) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
                this._attemptReconnect();
            }
        };
        document.addEventListener('visibilitychange', this._onVisibility);

        // ── Page unload ────────────────────────────────────────────────────
        // Close the WS silently — do NOT send media.stop so the receiver
        // keeps playing after the sender tab is closed.
        this._onUnload = () => this._abortWs();
        window.addEventListener('beforeunload', this._onUnload);

        // ── BroadcastChannel takeover ──────────────────────────────────────
        // If another app (Movie, Photo, …) calls notifyTakeover(), this
        // instance yields gracefully without reconnecting.
        try {
            this._bc = new BroadcastChannel('arozcast');
            this._bc.onmessage = (e) => {
                if (e.data && e.data.type === 'arozcast.takeover') {
                    this._intentional = true;
                    clearTimeout(this._reconnectTimer);
                    this._reconnectTimer = null;
                    this._reconnectCount = 0;
                    this._pendingCode    = null;
                    this._abortWs();
                    this._emit('takeover', {});
                }
            };
        } catch (_) {
            this._bc = null;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Core lifecycle
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Connect to an existing Arozcast room.
     *
     * - Cancels any pending auto-reconnect to the previous room.
     * - Broadcasts an `arozcast.takeover` signal so other apps (Musicify,
     *   Photo, Movie) release their session.
     * - Sends `peer.hello` and starts the heartbeat on success.
     *
     * @param  {string}        code - 4-digit room code shown by the Arozcast receiver.
     * @returns {Promise<void>}      Resolves when the socket is open and announced.
     *                               Rejects if the server refuses the connection or
     *                               the 8-second handshake times out.
     */
    connect(code) {
        // Cancel any pending auto-reconnect to the old room
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        this._reconnectCount = 0;
        this._pendingCode    = null;
        this._intentional    = false;

        // Silence the old socket's handlers before replacing it
        this._abortWs();

        // Tell other sender apps to yield their sessions
        this.notifyTakeover();

        return this._openWs(code);
    }

    /**
     * Explicitly disconnect from the current room.
     *
     * - Sends `media.stop` so the receiver clears its screen.
     * - Cancels any pending auto-reconnect.
     * - Does NOT close the room itself (the Arozcast receiver owns the room).
     */
    disconnect() {
        this._intentional    = true;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        this._reconnectCount = 0;
        this._pendingCode    = null;
        if (this.isConnected()) this.stop();  // tell receiver to clear its screen
        this._abortWs();
        this.code      = null;
        this.connected = false;
    }

    /**
     * Release all resources held by this instance.
     *
     * Removes the `visibilitychange` and `beforeunload` listeners, closes the
     * BroadcastChannel, and closes the WebSocket silently (no `media.stop`).
     * Call this if you no longer need the instance but the page is still open
     * (e.g. when unmounting a UI component). For page unload, `beforeunload`
     * handles cleanup automatically.
     */
    destroy() {
        this._intentional = true;
        clearTimeout(this._reconnectTimer);
        document.removeEventListener('visibilitychange', this._onVisibility);
        window.removeEventListener('beforeunload', this._onUnload);
        if (this._bc) { this._bc.close(); this._bc = null; }
        this._abortWs();
        this._listeners = {};
    }

    /**
     * Check whether a room exists before connecting.
     *
     * @param  {string}           code - 4-digit room code.
     * @returns {Promise<boolean>}      true if the room is active.
     */
    async ping(code) {
        const res  = await fetch(this._root + 'api/arozcast/ping?code=' + code);
        const data = await res.json();
        return !!data.exists;
    }

    /**
     * Signal other ArozOS apps to yield their cast sessions.
     *
     * Called automatically by `connect()`. Call manually if your app takes
     * over a session through a path that bypasses `connect()`.
     */
    notifyTakeover() {
        try {
            new BroadcastChannel('arozcast').postMessage({ type: 'arozcast.takeover' });
        } catch (_) {}
    }

    /** @returns {boolean} true when the WebSocket is open and ready. */
    isConnected() {
        return !!(this._ws && this._ws.readyState === WebSocket.OPEN);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Event emitter
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Register an event listener. Returns `this` for chaining.
     *
     * | Event          | Payload fields                                            |
     * |----------------|-----------------------------------------------------------|
     * | `connect`      | `{ code }`                                                |
     * | `disconnect`   | `{ code }`                                                |
     * | `reconnecting` | `{ code, attempt, delay }`                                |
     * | `giveup`       | `{ code }`                                                |
     * | `takeover`     | `{}`  — another app claimed the cast session              |
     * | `status`       | `{ currentTime, duration, isPlaying, volume, isMuted }`   |
     * | `ended`        | `{}`  — current media finished on the receiver            |
     *
     * @param  {string}   event
     * @param  {Function} handler
     * @returns {ArozCast}
     */
    on(event, handler) {
        (this._listeners[event] = this._listeners[event] || []).push(handler);
        return this;
    }

    /**
     * Remove a previously registered listener. Returns `this` for chaining.
     * @param  {string}   event
     * @param  {Function} handler
     * @returns {ArozCast}
     */
    off(event, handler) {
        if (this._listeners[event]) {
            this._listeners[event] = this._listeners[event].filter(h => h !== handler);
        }
        return this;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Playback command helpers
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Load a new media item on the receiver and start playing from the
     * optional start position.
     *
     * **Send order matters:** always follow with `setVolume()` then `play()` or
     * `pause()` so the receiver has the right volume before decoding begins.
     *
     * @param {object} track
     * @param {string}  track.name        Display name shown in the receiver toolbar.
     * @param {string}  track.type        `'audio'` | `'video'` | `'photo'`
     * @param {string}  track.src         Full playback URL. For formats that may not be
     *                                    natively playable in the browser, use the ArozOS
     *                                    transcoding API URL instead of the raw file URL.
     * @param {string}  track.filepath    ArozOS virtual path (used by receiver for album art).
     * @param {number}  [track.startTime] Position in seconds to seek to before playback.
     * @param {string}  [track.artist]    Artist label (audio mode only).
     * @param {string}  [track.cover]     Cover image URL override (audio mode only).
     */
    load(track)             { this.send('media.load',    track);                          }

    /** Resume or start playback on the receiver. */
    play()                  { this.send('media.play',    {});                             }

    /** Pause playback on the receiver. */
    pause()                 { this.send('media.pause',   {});                             }

    /**
     * Seek to an absolute position.
     * For skip buttons, prefer `seekRel()` — it avoids stale-base accumulation
     * when the user presses the button faster than `status` events arrive.
     * @param {number} time Position in seconds.
     */
    seek(time)              { this.send('media.seek',    { time });                       }

    /**
     * Seek by a relative delta. The receiver applies the delta to its **live**
     * `currentTime`, so rapid key presses accumulate correctly without waiting
     * for a `status` update round-trip.
     * @param {number} delta Seconds to skip. Negative = rewind.
     */
    seekRel(delta)          { this.send('media.seekrel', { delta });                      }

    /**
     * Set volume and mute state on the receiver.
     *
     * > **Scale:** Arozcast uses **0–100**. If your local `<video>` / `<audio>`
     * > element uses 0–1 (the HTML default), multiply by 100 before calling.
     *
     * @param {number}  level Volume level, 0–100.
     * @param {boolean} muted Whether audio should be muted.
     */
    setVolume(level, muted) { this.send('media.volume',  { volume: level, muted: !!muted }); }

    /**
     * Sync the repeat mode to the receiver.
     *
     * | mode     | Receiver behaviour                                               |
     * |----------|------------------------------------------------------------------|
     * | `'none'` | No looping.                                                      |
     * | `'one'`  | Sets `loop = true` on the media element (browser handles it).   |
     * | `'all'`  | Visual indicator only — your app must listen for the `ended`    |
     * |          | event and call `load()` with the next track.                     |
     *
     * @param {'none'|'one'|'all'} mode
     */
    setRepeat(mode)         { this.send('media.repeat',  { mode });                       }

    /**
     * Stop playback and clear the receiver's screen.
     * Only call this when the user **explicitly** disconnects. Do not call it
     * on page unload — let the receiver keep playing.
     */
    stop()                  { this.send('media.stop',    {});                             }

    /**
     * Send a raw message to the room. Silently dropped if the socket is not open.
     * @param {string}  topic
     * @param {object} [payload]
     */
    send(topic, payload) {
        if (this.isConnected()) {
            this._ws.send(JSON.stringify({ topic, payload: payload || {} }));
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Internals
    // ══════════════════════════════════════════════════════════════════════

    /** Fire all handlers registered for `event`. */
    _emit(event, detail) {
        (this._listeners[event] || []).forEach(h => {
            try { h(detail); } catch (_) {}
        });
    }

    /**
     * Open a fresh WebSocket to `code`. Returns a Promise that resolves once
     * `peer.hello` is sent, or rejects if the connection fails / times out.
     * @private
     */
    _openWs(code) {
        const self = this;
        return new Promise((resolve, reject) => {
            const wsUrl = new URL(
                self._root + 'api/arozcast/ws?code=' + code,
                window.location.href
            );
            wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

            const ws  = new WebSocket(wsUrl.toString());
            let settled = false;

            // 8-second handshake timeout
            const timeout = setTimeout(() => {
                ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
                ws.close();
                if (!settled) { settled = true; reject(new Error('Connection timed out')); }
            }, 8000);

            ws.onerror = () => {}; // onerror always precedes onclose — handled there

            ws.onmessage = (evt) => {
                self._lastSeen = Date.now();
                try { self._handleIncoming(JSON.parse(evt.data)); } catch (_) {}
            };

            // This initial onclose only fires when the connect itself fails.
            // Once onopen has run, we replace it with the reconnect handler.
            ws.onclose = () => {
                clearTimeout(timeout);
                if (!settled) { settled = true; reject(new Error('Connection failed')); }
            };

            ws.onopen = () => {
                clearTimeout(timeout);
                settled         = true;
                self._ws        = ws;
                self.code       = code;
                self.connected  = true;
                self._lastSeen  = Date.now();
                self._intentional = false;

                // Announce presence and start heartbeat
                self.send('peer.hello', {});
                self._startTimers();
                self._emit('connect', { code });

                // Replace the connect-phase onclose with the live reconnect handler
                ws.onclose = () => self._onDrop(code);

                resolve();
            };
        });
    }

    /**
     * Called when an established connection drops unexpectedly.
     * Schedules auto-reconnect unless the close was intentional.
     * @private
     */
    _onDrop(code) {
        this._stopTimers();
        this.connected = false;
        this._ws       = null;
        if (!this._intentional) {
            this._pendingCode = code;
            this._emit('disconnect', { code });
            this._scheduleReconnect();
        }
    }

    /**
     * Schedule the next reconnection attempt with the appropriate backoff delay.
     * @private
     */
    _scheduleReconnect() {
        if (!this._delays.length || this._reconnectCount >= this._delays.length) {
            this._reconnectCount = 0;
            this._pendingCode    = null;
            this._emit('giveup', { code: this.code });
            return;
        }
        const delay = this._delays[this._reconnectCount++];
        this._emit('reconnecting', { code: this._pendingCode, attempt: this._reconnectCount, delay });
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._attemptReconnect();
        }, delay);
    }

    /**
     * Attempt a single reconnection to `_pendingCode`.
     * On success: announces peer.hello and re-syncs volume/repeat (caller's
     * responsibility via the `connect` event). Does NOT resend `media.load` —
     * Arozcast kept playing while the sender was gone.
     * @private
     */
    _attemptReconnect() {
        const code = this._pendingCode;
        if (!code) return;
        const self = this;

        const wsUrl = new URL(
            this._root + 'api/arozcast/ws?code=' + code,
            window.location.href
        );
        wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

        const ws = new WebSocket(wsUrl.toString());

        // 8-second timeout per attempt
        const timeout = setTimeout(() => {
            ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
            ws.close();
            self._scheduleReconnect();
        }, 8000);

        ws.onerror = () => {};

        ws.onmessage = (evt) => {
            self._lastSeen = Date.now();
            try { self._handleIncoming(JSON.parse(evt.data)); } catch (_) {}
        };

        ws.onclose = () => {
            clearTimeout(timeout);
            self._scheduleReconnect();
        };

        ws.onopen = () => {
            clearTimeout(timeout);
            self._reconnectCount = 0;
            self._pendingCode    = null;
            self._ws             = ws;
            self.code            = code;
            self.connected       = true;
            self._lastSeen       = Date.now();
            self._intentional    = false;

            // Re-announce — do NOT resend media.load; Arozcast kept playing
            self.send('peer.hello', {});
            self._startTimers();
            self._emit('connect', { code });

            ws.onclose = () => self._onDrop(code);
        };
    }

    /**
     * Dispatch incoming receiver messages to the event system.
     * Only `status.update` and `media.ended` are receiver-originated.
     * All other topics are sender-originated and should not appear here.
     * @private
     */
    _handleIncoming(msg) {
        switch (msg.topic) {
            case 'status.update': this._emit('status', msg.payload); break;
            case 'media.ended':   this._emit('ended',  msg.payload); break;
            // Unknown/loopback topics are silently ignored
        }
    }

    /**
     * Start the heartbeat interval (5 s) and the watchdog interval (4 s).
     * The watchdog closes the socket if no message has arrived in 12 s,
     * triggering the reconnect flow.
     * @private
     */
    _startTimers() {
        this._stopTimers();
        this._pingTimer = setInterval(() => {
            this.send('peer.heartbeat', {});
        }, 5000);
        this._watchTimer = setInterval(() => {
            if (Date.now() - this._lastSeen > 12000 && this._ws) {
                this._ws.close();
            }
        }, 4000);
    }

    /** @private */
    _stopTimers() {
        clearInterval(this._pingTimer);
        clearInterval(this._watchTimer);
        this._pingTimer  = null;
        this._watchTimer = null;
    }

    /**
     * Silently close the current WebSocket, nulling all handlers first so
     * the close does not trigger reconnection.
     * @private
     */
    _abortWs() {
        this._stopTimers();
        if (this._ws) {
            const old = this._ws;
            old.onopen = old.onclose = old.onerror = old.onmessage = null;
            old.close();
            this._ws = null;
        }
        this.connected = false;
    }
}
