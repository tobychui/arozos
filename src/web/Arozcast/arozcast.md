# arozcast.js — SDK Reference

`arozcast.js` is a ready-made JavaScript client for ArozOS webapps that want to send media to an Arozcast receiver screen. It wraps the raw WebSocket API (documented in `README.md`) and handles connection management, heartbeating, exponential-backoff reconnection, and cross-tab coordination so you don't have to.

---

## Table of Contents

1. [Setup](#setup)
2. [Quick Start](#quick-start)
3. [Constructor](#constructor)
4. [Lifecycle Methods](#lifecycle-methods)
   - [connect()](#connectcode)
   - [disconnect()](#disconnect)
   - [destroy()](#destroy)
   - [ping()](#pingcode)
   - [notifyTakeover()](#notifytakeover)
   - [isConnected()](#isconnected)
5. [Playback Commands](#playback-commands)
   - [load()](#loadtrack)
   - [play()](#play)
   - [pause()](#pause)
   - [seek()](#seektime)
   - [seekRel()](#seekreldelta)
   - [setVolume()](#setvolumelevel-muted)
   - [setRepeat()](#setrepeatmode)
   - [stop()](#stop)
   - [send()](#sendtopic-payload)
6. [Events](#events)
7. [Properties](#properties)
8. [Integration Patterns](#integration-patterns)
   - [Basic audio player](#basic-audio-player)
   - [Video player with seek bar](#video-player-with-seek-bar)
   - [Playlist with repeat modes](#playlist-with-repeat-modes)
   - [Reconnect UI feedback](#reconnect-ui-feedback)
   - [Handing off to another app](#handing-off-to-another-app)
9. [Lifecycle Diagram](#lifecycle-diagram)
10. [Comparison: SDK vs Raw API](#comparison-sdk-vs-raw-api)

---

## Setup

Copy `arozcast.js` from `src/web/Arozcast/` into your webapp, or reference it with a relative path:

```html
<!-- From your webapp's HTML -->
<script src="../../Arozcast/arozcast.js"></script>
```

No bundler or npm install required. The class is attached to `window.ArozCast` after the script loads.

---

## Quick Start

```javascript
// 1. Create one instance for your app's cast session
const cast = new ArozCast({ aoRoot: ao_root });

// 2. Listen for events
cast
  .on('connect',      ({ code })  => updateUI('Connected to room ' + code))
  .on('disconnect',   ({ code })  => updateUI('Lost connection — retrying…'))
  .on('giveup',       ({ code })  => resumeLocally())
  .on('status',       (s)        => updateProgress(s.currentTime, s.duration))
  .on('ended',        ()         => playNextTrack());

// 3. Check the room is alive, then connect
const code = prompt('Enter Arozcast room code:');
cast.ping(code).then(exists => {
    if (!exists) { alert('Room not found'); return; }

    cast.connect(code).then(() => {
        // 4. Send the current media item
        const vid = document.getElementById('my-video');
        cast.load({
            name:      currentEpisode.name,
            type:      'video',
            src:       currentEpisode.streamUrl,   // full playback URL
            filepath:  currentEpisode.filepath,    // ArozOS virtual path
            startTime: vid.currentTime             // sync mid-playback
        });
        cast.setVolume(vid.volume * 100, vid.muted);
        cast.play();

        vid.pause(); // local video hands off to receiver
    });
});

// 5. Explicit user disconnect
document.getElementById('disconnect-btn').addEventListener('click', () => {
    const pos = /* save current position from status event */;
    cast.disconnect();
    resumeLocallyAt(pos);
});
```

---

## Constructor

```javascript
const cast = new ArozCast(options);
```

| Option             | Type       | Default                | Description |
|--------------------|------------|------------------------|-------------|
| `aoRoot`           | `string`   | global `ao_root` or `/` | ArozOS root URL. Pass `ao_root` (set by `ao_module.js`) when available. |
| `reconnectDelays`  | `number[]` | `[2000, 5000, 12000]`  | Millisecond delays before each reconnection attempt. Three entries = three attempts. Pass `[]` to disable auto-reconnect entirely. |

```javascript
// Custom backoff (5 attempts)
const cast = new ArozCast({
    aoRoot:          ao_root,
    reconnectDelays: [1000, 3000, 8000, 15000, 30000],
});

// Auto-reconnect disabled
const cast = new ArozCast({ aoRoot: ao_root, reconnectDelays: [] });
```

---

## Lifecycle Methods

### `connect(code)`

Connects to an existing Arozcast room and announces the sender.

- Cancels any pending auto-reconnect to the previous room.
- Broadcasts `arozcast.takeover` so other open sender apps (Musicify, Movie, Photo) release their sessions.
- Sends `peer.hello` and starts the heartbeat on success.

```javascript
cast.connect('1234')
    .then(() => { /* socket open, peer.hello sent */ })
    .catch(err => console.error('Failed to connect:', err.message));
```

**Returns:** `Promise<void>` — resolves when the WebSocket is open, rejects if the server refuses the connection or the 8-second handshake times out.

> After `connect()` resolves, always send `load()`, `setVolume()`, then `play()` in that order.

---

### `disconnect()`

Explicitly disconnects from the current room.

- Sends `media.stop` to clear the receiver's screen.
- Cancels any pending auto-reconnect.
- Sets `cast.connected = false` and `cast.code = null`.

Use this when the **user** actively chooses to stop casting (e.g. clicks "Stop Cast"). Do **not** call this on page unload — use `destroy()` or let `beforeunload` handle it automatically.

```javascript
function stopCasting() {
    const resumeAt = lastStatusTime; // saved from 'status' event
    cast.disconnect();
    resumeLocalVideoAt(resumeAt);
}
```

---

### `destroy()`

Releases all resources held by this instance without notifying the receiver.

- Removes `visibilitychange` and `beforeunload` listeners added in the constructor.
- Closes the BroadcastChannel.
- Closes the WebSocket silently — **does not** send `media.stop`, so the receiver keeps playing.

Called automatically on `beforeunload`. Call it manually only if you need to tear down the instance while the page is still open (e.g. unmounting a component).

```javascript
// Clean up when navigating away within a SPA
onRouteChange(() => cast.destroy());
```

---

### `ping(code)`

Checks whether a room with the given code is currently active.

```javascript
const exists = await cast.ping('1234');
if (exists) { /* safe to connect */ }
```

**Returns:** `Promise<boolean>`

Call this before `connect()` to give the user a clear error message instead of a silent timeout.

---

### `notifyTakeover()`

Broadcasts `arozcast.takeover` on the `BroadcastChannel('arozcast')` channel, signalling all other open sender tabs to release their sessions.

Called automatically by `connect()`. Call it manually if your app starts a new session through a path that bypasses `connect()` (e.g. a deep-link handler).

```javascript
// Taking over from a non-SDK code path
myLegacyCastWs = new WebSocket(url);
cast.notifyTakeover(); // silence other senders
```

---

### `isConnected()`

Returns `true` when the WebSocket is open and ready to accept messages.

```javascript
if (cast.isConnected()) {
    cast.seek(42);
} else {
    myVideo.currentTime = 42;
}
```

Equivalent to checking `cast.connected`, but safe to call at any time.

---

## Playback Commands

All commands are silently dropped if the socket is not open. There is no queue — if you need to wait, check `isConnected()` first.

---

### `load(track)`

Loads a new media item on the receiver. The receiver starts playing automatically after this call; always follow with `setVolume()` then `play()` or `pause()` to set the correct volume and play state before the browser starts decoding.

```javascript
cast.load({
    name:      'Episode 3.mp4',   // displayed in receiver toolbar
    type:      'video',           // 'audio' | 'video' | 'photo'
    src:       streamUrl,         // full URL the receiver's <video> will load
    filepath:  '/Videos/ep3.mp4', // ArozOS vpath for album art
    startTime: 120,               // seek to 2 min before play (optional)
});
cast.setVolume(myVideo.volume * 100, myVideo.muted);
cast.play();
```

| Field        | Required | Description |
|--------------|----------|-------------|
| `name`       | ✓        | Display name in the receiver toolbar |
| `type`       | ✓        | `'audio'`, `'video'`, or `'photo'` |
| `src`        | ✓        | Playback URL. Use the ArozOS transcoding API (`/media/transcode?file=…`) for formats the browser may not natively support. |
| `filepath`   | ✓        | ArozOS virtual path — receiver uses it to load album art |
| `startTime`  |          | Seconds to seek to before playback (default: 0) |
| `artist`     |          | Artist subtitle (audio mode) |
| `cover`      |          | Cover art URL override (audio mode) |

---

### `play()`

Resumes or starts playback.

```javascript
cast.play();
```

---

### `pause()`

Pauses playback.

```javascript
cast.pause();
```

---

### `seek(time)`

Seeks to an absolute position in seconds.

```javascript
// User clicked on the progress bar
cast.seek(progressBar.ratio * duration);
```

For **skip buttons** (e.g. ±10 s), prefer `seekRel()` — it avoids stale-base accumulation when the button is tapped faster than `status` events arrive.

---

### `seekRel(delta)`

Seeks by a relative delta in seconds. The receiver applies the delta to its **live** `currentTime`, so rapid presses stack correctly without waiting for a `status` round-trip.

```javascript
// +10 s with optimistic local UI update
cast.seekRel(10);
localDisplayTime = Math.min(localDuration, localDisplayTime + 10);
updateProgressBar();
```

Negative values rewind:

```javascript
cast.seekRel(-10); // rewind 10 s
```

---

### `setVolume(level, muted)`

Sets volume and mute state on the receiver.

> **Scale:** Arozcast uses **0–100**. HTML `<video>` / `<audio>` uses **0–1**. Multiply by 100 when passing the element's `.volume` property.

```javascript
// Sync local element's volume to receiver
cast.setVolume(myVideo.volume * 100, myVideo.muted);
```

---

### `setRepeat(mode)`

Syncs the repeat mode to the receiver.

| `mode`   | Receiver behaviour |
|----------|--------------------|
| `'none'` | No looping |
| `'one'`  | Sets `loop = true` on the media element — browser handles it natively, no `ended` event fires |
| `'all'`  | Shows a visual indicator only — your app must listen for the `ended` event and call `load()` with the next track |

```javascript
cast.setRepeat('one');  // loop this track
cast.setRepeat('all');  // playlist loop — handle via 'ended' event
cast.setRepeat('none'); // no repeat
```

Send on: initial `connect()`, when the user changes repeat mode, and inside the `connect` event handler (for reconnects).

---

### `stop()`

Stops playback and clears the receiver's screen. The receiver returns to its idle/waiting state.

```javascript
cast.stop();
```

**Only call this when the user explicitly disconnects.** Do not call it on page unload or when the WebSocket drops — the receiver should keep playing while the sender reconnects.

`disconnect()` calls `stop()` internally, so you normally don't need to call it directly.

---

### `send(topic, payload)`

Send a raw message to the room. Use this for custom topics or for topics not covered by the helpers above.

```javascript
cast.send('media.seekrel', { delta: -30 });
cast.send('my.custom.topic', { data: 'hello' });
```

Silently dropped if `isConnected()` is false.

---

## Events

Register handlers with `.on(event, handler)`. A handler can be removed with `.off(event, handler)`. Both methods return `this` for chaining.

```javascript
cast
    .on('connect',      handler)
    .on('disconnect',   handler)
    .on('giveup',       handler);
```

---

### `connect` — `{ code }`

Fired when the WebSocket is successfully opened. This fires for both the **initial** connection and every successful **reconnection**.

On reconnect, re-sync state to the receiver — send `setVolume()` and `setRepeat()`. Do **not** resend `load()` — Arozcast kept playing.

```javascript
cast.on('connect', ({ code }) => {
    showToast('Connected to room ' + code);

    // Re-sync state on reconnect
    cast.setVolume(myVideo.volume * 100, myVideo.muted);
    cast.setRepeat(currentRepeatMode);
    // Do NOT call cast.load() here — Arozcast kept playing
});
```

---

### `disconnect` — `{ code }`

Fired when the WebSocket drops unexpectedly (phone sleep, network error, proxy timeout). Auto-reconnect will begin according to `reconnectDelays`. Update your UI to indicate the reconnection attempt.

```javascript
cast.on('disconnect', ({ code }) => {
    showToast('Connection lost — reconnecting…');
    disableSeekBar();
});
```

---

### `reconnecting` — `{ code, attempt, delay }`

Fired just before each reconnection attempt is scheduled. Useful for showing a countdown or attempt counter.

```javascript
cast.on('reconnecting', ({ code, attempt, delay }) => {
    showToast(`Reconnecting… attempt ${attempt} in ${delay / 1000}s`);
});
```

---

### `giveup` — `{ code }`

Fired in two situations:

1. **Retries exhausted** — all reconnection attempts failed (network error, room no longer exists).
2. **Server closed the room** — the backend broadcast `room.closed` because the Arozcast receiver page was idle for more than 30 seconds. In this case `giveup` fires immediately, without going through the reconnect cycle.

```javascript
cast.on('giveup', ({ code }) => {
    showToast('Could not reconnect — resuming locally');
    resumeLocally(lastKnownTime);
});
```

> **Note:** `room.closed` is a backend-internal topic; you never need to handle it directly when using this SDK — it is converted to the `giveup` event automatically.

---

### `takeover` — `{}`

Fired when another sender app has claimed the Arozcast session. The current instance's WebSocket is closed and no reconnection is attempted. Clean up your cast UI.

```javascript
cast.on('takeover', () => {
    updateCastButton('inactive');
});
```

---

### `status` — `{ currentTime, duration, isPlaying, volume, isMuted }`

Fired every ~3 seconds with the receiver's live playback state. Use this to keep your sender-side progress bar in sync.

```javascript
let lastStatus = null;
cast.on('status', s => {
    lastStatus = s;
    updateProgressBar(s.currentTime, s.duration);
    updatePlayIcon(s.isPlaying);
});

// On reconnect, wait for the next status event (arrives within 3 s)
// instead of pushing your local stale time to the receiver.
```

---

### `ended` — `{}`

Fired when the current media track finishes playing on the receiver. Handle this to advance a playlist when `repeatMode === 'all'`.

```javascript
cast.on('ended', () => {
    if (repeatMode === 'all') {
        const next = getNextTrack();
        cast.load({ ...next });
        cast.setVolume(volume, muted);
        cast.play();
    }
});
```

> **Note:** When `repeat === 'one'`, the receiver sets `loop = true` on its media element. The browser loops natively and `ended` is never fired.

---

## Properties

| Property    | Type          | Description |
|-------------|---------------|-------------|
| `code`      | `string\|null` | The current room code, or `null` when not connected |
| `connected` | `boolean`     | `true` while the WebSocket is open |

---

## Integration Patterns

### Basic audio player

```javascript
const cast = new ArozCast({ aoRoot: ao_root });
let lastTime = 0;

cast.on('status', s => { lastTime = s.currentTime; });
cast.on('giveup', () => {
    audio.currentTime = lastTime;
    if (wasPlaying) audio.play();
});
cast.on('connect', () => {
    cast.setVolume(audio.volume * 100, audio.muted);
    cast.setRepeat(repeatMode);
});

async function startCast(code) {
    if (!(await cast.ping(code))) { showError('Room not found'); return; }
    await cast.connect(code);
    cast.load({
        name:      currentTrack.name,
        type:      'audio',
        src:       ao_root + 'media?file=' + encodeURIComponent(currentTrack.filepath),
        filepath:  currentTrack.filepath,
        artist:    currentTrack.artist,
        startTime: audio.currentTime,
    });
    cast.setVolume(audio.volume * 100, audio.muted);
    cast.setRepeat(repeatMode);
    wasPlaying = !audio.paused;
    cast[wasPlaying ? 'play' : 'pause']();
    audio.pause();
}
```

---

### Video player with seek bar

```javascript
cast.on('status', s => {
    // Authoritative sync from receiver (~3 s interval)
    castTime     = s.currentTime;
    castDuration = s.duration;
    castPlaying  = s.isPlaying;
    updateSeekBar(castTime, castDuration);
});

// Seek bar click — use absolute seek
seekBar.addEventListener('click', e => {
    if (!cast.isConnected()) { vid.currentTime = e.ratio * vid.duration; return; }
    const t = e.ratio * castDuration;
    cast.seek(t);
    castTime = t;          // optimistic update
    updateSeekBar(castTime, castDuration);
});

// Keyboard skip — use relative seek for rapid key presses
document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') {
        cast.seekRel(10);
        castTime = Math.min(castDuration, castTime + 10); // optimistic
        updateSeekBar(castTime, castDuration);
    }
    if (e.key === 'ArrowLeft') {
        cast.seekRel(-10);
        castTime = Math.max(0, castTime - 10);
        updateSeekBar(castTime, castDuration);
    }
});

// Play / pause — optimistic UI
playBtn.addEventListener('click', () => {
    if (cast.isConnected()) {
        if (castPlaying) { cast.pause(); castPlaying = false; }
        else             { cast.play();  castPlaying = true;  }
        updatePlayIcon(castPlaying);
    } else {
        vid.paused ? vid.play() : vid.pause();
    }
});
```

---

### Playlist with repeat modes

```javascript
let repeatMode = 'none'; // 'none' | 'one' | 'all'

function cycleRepeat() {
    const modes = ['none', 'all', 'one'];
    repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    if (cast.isConnected()) cast.setRepeat(repeatMode);
    updateRepeatIcon(repeatMode);
}

// Advance playlist when the receiver finishes the track
cast.on('ended', () => {
    // repeatMode 'one' never fires ended (receiver loops natively)
    if (repeatMode === 'all') {
        loadTrack(nextTrackIndex());
    } else {
        // repeatMode 'none' — stop after last track
        if (hasNextTrack()) loadTrack(nextTrackIndex());
    }
});

function loadTrack(index) {
    const t = playlist[index];
    cast.load({ name: t.name, type: 'audio', src: t.url, filepath: t.path });
    cast.setVolume(volume, muted);
    cast.play();
    currentIndex = index;
}
```

---

### Reconnect UI feedback

```javascript
const toast = document.getElementById('cast-toast');

cast
    .on('connect',      ({ code }) => {
        toast.textContent = 'Casting to room ' + code;
        toast.className   = 'toast connected';
    })
    .on('disconnect',   () => {
        toast.textContent = 'Connection lost — reconnecting…';
        toast.className   = 'toast reconnecting';
    })
    .on('reconnecting', ({ attempt, delay }) => {
        toast.textContent = `Reconnecting (attempt ${attempt})…`;
    })
    .on('giveup', () => {
        toast.textContent = 'Cast ended — playing locally';
        toast.className   = 'toast';
        resumeLocally();
    });
```

---

### Handing off to another app

When the user switches from one sender app to another (e.g. from Movie to Musicify), the new session automatically calls `notifyTakeover()` inside `connect()`. The old `ArozCast` instance in the previous app receives the `takeover` event and cleans up.

If you manage the session outside of `connect()` (e.g. you reuse an open WebSocket), call `notifyTakeover()` manually:

```javascript
cast.notifyTakeover(); // signals all other open sender tabs
```

---

## Lifecycle Diagram

```
new ArozCast()
      │
      ▼
 ┌──────────┐    connect(code)    ┌─────────────┐
 │  Idle    │ ─────────────────▶ │ Connecting  │
 └──────────┘                    └──────┬──────┘
                                        │ onopen
                                        ▼
                                  ┌──────────┐   drop    ┌──────────────┐
                                  │Connected │ ────────▶ │Reconnecting  │
                                  └──────────┘           └──────┬───────┘
                                        │                       │ success
                                        │ disconnect()          ▼
                                        │              ┌─────Connected────┐
                                        │              │ (same as above)  │
                                        ▼              └──────────────────┘
                                  ┌──────────┐
                                  │  Idle    │  (media.stop sent to receiver)
                                  └──────────┘

At any point: destroy() → removes all listeners, closes WS silently
```

---

## Comparison: SDK vs Raw API

| Task | Raw API | SDK |
|------|---------|-----|
| Connect to a room | Manually create WS, attach handlers, send `peer.hello` | `cast.connect('1234')` |
| Send heartbeat | `setInterval(() => ws.send(...), 5000)` | Automatic |
| Watchdog (detect dead receiver) | `setInterval(() => { if (stale) ws.close(); }, 4000)` | Automatic |
| Reconnect on drop | Manual backoff + `visibilitychange` handler | Automatic |
| Cross-app takeover | `new BroadcastChannel('arozcast').postMessage(...)` | `cast.connect()` or `cast.notifyTakeover()` |
| Null old WS handlers before reconnect | Manual `ws.onopen = ws.onclose = null; ws.close()` | Automatic |
| Stop cleanly | `ws.send(media.stop); ws.close()` | `cast.disconnect()` |
| Page unload cleanup | Manual `beforeunload` listener | Automatic |
| Receive status updates | `ws.onmessage` + JSON parse + topic switch | `cast.on('status', handler)` |
| Detect track end | `ws.onmessage` + check `media.ended` topic | `cast.on('ended', handler)` |
