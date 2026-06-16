# Arozcast — Developer API Reference

Arozcast is ArozOS's built-in remote-projection relay. It uses a **room-based WebSocket pub/sub** model: a sender (e.g. Musicify, Movie) opens a room and controls playback; a receiver (the Arozcast webapp running on a TV or second screen) joins the same room and acts on the commands it receives.

Any ArozOS webapp can become a sender by using the HTTP and WebSocket APIs documented below. **Login is required** for all endpoints.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [HTTP Endpoints](#http-endpoints)
   - [POST /api/arozcast/create](#post-apiarozcastcreate)
   - [GET /api/arozcast/ping](#get-apiarozcastping)
   - [GET /api/arozcast/close](#get-apiarozcastclose)
   - [POST /api/arozcast/publish](#post-apiarozcastpublish)
   - [GET /api/arozcast/ws](#get-apiarozcastws)
   - [GET /api/arozcast/iceservers](#get-apiarozcasticeservers)
3. [WebSocket Message Protocol](#websocket-message-protocol)
   - [Message Envelope](#message-envelope)
   - [Sender → Receiver Topics](#sender--receiver-topics)
   - [Receiver → Sender Topics](#receiver--sender-topics)
4. [Complete Integration Walkthrough](#complete-integration-walkthrough)
5. [Reconnection & Resilience](#reconnection--resilience)
6. [Best Practices & Notes](#best-practices--notes)

---

## Architecture Overview

```
Sender webapp                Arozcast relay               Arozcast receiver
(Musicify, Movie, …)         (Go backend)                 (index.html on TV)

  POST /create  ──────────→  allocates 4-digit room
  WS  /ws?code  ◄──────────→  joins room #1234   ◄──────────  WS /ws?code
  media.load    ──────────→  broadcast to all    ──────────→  _loadMedia()
  media.play    ──────────→  broadcast to all    ──────────→  _play()
                ◄──────────  status.update every 3s ◄──────  setInterval
  media.seekrel ──────────→  broadcast to all    ──────────→  _seek(t+Δ)
  media.stop    ──────────→  broadcast to all    ──────────→  _stop()
  GET  /close   ──────────→  closes room, kicks all clients
```

Key design points:
- The relay is **dumb**: every WebSocket frame sent by a client is echoed to all *other* clients in the room. No processing happens server-side.
- Rooms are created by the **sender** and destroyed by the sender (or cleaned up after 10 minutes of inactivity).
- The receiver broadcasts `status.update` every 3 seconds so the sender can stay in sync even after a reconnect.

---

## HTTP Endpoints

All endpoints are under `/api/arozcast/` and require an authenticated ArozOS session cookie.

---

### POST /api/arozcast/create

Creates a new room and returns a 4-digit code.

**Request:** No body required.

**Response:**
```json
{ "code": "1234" }
```

**Example (fetch):**
```javascript
const res  = await fetch(ao_root + 'api/arozcast/create', { method: 'POST' });
const data = await res.json();
const code = data.code; // e.g. "1234"
```

**Example (jQuery):**
```javascript
$.post(ao_root + 'api/arozcast/create', function(data) {
    var code = data.code;
});
```

---

### GET /api/arozcast/ping

Checks whether a room with the given code currently exists.

**Query parameter:** `code` — the 4-digit room code.

**Response:**
```json
{ "exists": true }
// or
{ "exists": false }
```

**Example:**
```javascript
fetch(ao_root + 'api/arozcast/ping?code=' + code)
    .then(r => r.json())
    .then(d => {
        if (d.exists) { /* room is alive */ }
    });
```

Use this before displaying a "Reconnect" UI to confirm the receiver is still running.

---

### GET /api/arozcast/close

Closes a room and forcibly disconnects all WebSocket clients.

**Query parameter:** `code` — the room code to close.

**Response:** `"OK"`

**Example:**
```javascript
// Reliable even during page unload:
navigator.sendBeacon(ao_root + 'api/arozcast/close?code=' + code);

// Or with fetch during normal teardown:
await fetch(ao_root + 'api/arozcast/close?code=' + code);
```

Always call this (preferably via `sendBeacon`) in the sender's `beforeunload` handler so the receiver's room is cleaned up promptly.

---

### POST /api/arozcast/publish

Broadcasts a raw JSON message to every client in the room **without** requiring a WebSocket connection. Intended for AGI scripts or server-side integrations that cannot hold a long-lived connection.

**Form parameters:**
| Field | Type   | Description                        |
|-------|--------|------------------------------------|
| `code`| string | 4-digit room code                  |
| `msg` | string | JSON-encoded message (see protocol)|

**Response:** `"OK"` or `{"error":"…"}`

**Example (curl):**
```bash
curl -X POST https://your-arozos/api/arozcast/publish \
     -d "code=1234" \
     --data-urlencode 'msg={"topic":"media.pause","payload":{}}'
```

**Example (AGI / JavaScript):**
```javascript
var payload = JSON.stringify({ topic: 'media.pause', payload: {} });
$.post(ao_root + 'api/arozcast/publish', { code: code, msg: payload });
```

---

### GET /api/arozcast/ws

Upgrades the connection to a WebSocket and joins the room. Every text frame sent by this client is relayed to all other participants in the room.

**Query parameter:** `code` — the room code (must already exist).

**Protocol:** `ws://` or `wss://` (matches the page's HTTP/HTTPS scheme).

**Example:**
```javascript
var wsUrl = new URL(ao_root + 'api/arozcast/ws?code=' + code, window.location.href);
wsUrl.protocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
var ws = new WebSocket(wsUrl.toString());
```

Frames are plain text containing JSON. See [Message Protocol](#websocket-message-protocol) for the format.

---

### GET /api/arozcast/iceservers

Returns the ICE server list the **screen-share** feature feeds to
`RTCPeerConnection`. Screen share is a direct WebRTC peer-to-peer connection;
STUN alone is enough on a LAN, but crossing the Internet (peers behind NAT)
needs a TURN relay. This endpoint supplies both.

**Request:** No parameters.

**Response:** an `RTCConfiguration`-shaped object:
```json
{
  "iceServers": [
    { "urls": ["stun:stun.l.google.com:19302"] },
    {
      "urls": ["turn:cloud.example.com:3478?transport=udp",
               "turn:cloud.example.com:3478?transport=tcp"],
      "username":   "1718540000:alice",
      "credential": "h6Yc…base64-hmac…="
    }
  ]
}
```

**Example:**
```javascript
const res = await fetch(ao_root + 'api/arozcast/iceservers');
const cfg = await res.json();              // { iceServers: [...] }
const pc  = new RTCPeerConnection(cfg);    // pass straight to RTCPeerConnection
```

The TURN entry is present only when the built-in relay is running. Its
credentials are minted per request, HMAC-signed and short-lived, so the relay is
never an open proxy. The TURN host mirrors the host the client used to reach
ArozOS (honouring `X-Forwarded-Host`). See
[Screen Share over the Internet](#screen-share-over-the-internet).

---

## WebSocket Message Protocol

### Message Envelope

Every frame — in both directions — uses the same JSON envelope:

```json
{
    "topic":   "<topic-string>",
    "payload": { /* topic-specific fields */ }
}
```

`topic` is a dot-separated string that identifies the message type. `payload` is an object (never null; use `{}` for topics with no data).

---

### Sender → Receiver Topics

These are sent by the controlling webapp (Musicify, Movie, Photo, or your own app) and acted on by the Arozcast receiver.

---

#### `peer.hello`

Announces that a sender has connected or reconnected. The receiver uses this to mark the sender as active and reset its watchdog timer.

Send on: initial WebSocket open, and on every reconnect.

```json
{ "topic": "peer.hello", "payload": {} }
```

---

#### `peer.heartbeat`

Keeps the sender's presence alive. The receiver considers a sender disconnected if no message is received for 12 seconds.

Send on: a 5-second `setInterval` while the WebSocket is open.

```json
{ "topic": "peer.heartbeat", "payload": {} }
```

---

#### `media.load`

Instructs the receiver to load and immediately begin playing a new media item.

```json
{
    "topic": "media.load",
    "payload": {
        "name":      "My Song.flac",
        "type":      "audio",
        "src":       "https://arozos.host/media?file=%2Fmusic%2Fsong.flac",
        "filepath":  "/music/song.flac",
        "startTime": 42.5,
        "artist":    "Artist Name",
        "cover":     "https://…/cover.jpg"
    }
}
```

| Field       | Type   | Required | Description                                                                           |
|-------------|--------|----------|---------------------------------------------------------------------------------------|
| `name`      | string | ✓        | Display name shown in the toolbar                                                     |
| `type`      | string | ✓        | `"audio"`, `"video"`, or `"photo"`                                                    |
| `src`       | string | ✓        | Full playback URL (use the transcoding API if the format may not be natively playable)|
| `filepath`  | string | ✓        | ArozOS virtual path; used by the receiver to load album art                           |
| `startTime` | number |          | Seconds to seek to before playback (default: `0`)                                     |
| `artist`    | string |          | Artist subtitle shown in audio mode                                                   |
| `cover`     | string |          | Cover image URL override (audio mode)                                                 |

Always send `media.volume` **after** `media.load` and **before** `media.play` so volume is set before the browser begins decoding.

---

#### `media.play`

Resumes or starts playback.

```json
{ "topic": "media.play", "payload": {} }
```

---

#### `media.pause`

Pauses playback.

```json
{ "topic": "media.pause", "payload": {} }
```

---

#### `media.seek`

Seeks to an absolute position.

```json
{
    "topic": "media.seek",
    "payload": { "time": 123.4 }
}
```

| Field  | Type   | Description                  |
|--------|--------|------------------------------|
| `time` | number | Target position in seconds   |

> **Prefer `media.seekrel` for keyboard/button skipping** — see below.

---

#### `media.seekrel`

Seeks by a relative delta. The receiver applies the delta to its **live** `currentTime`, so rapid presses accumulate correctly even before a `status.update` has arrived.

```json
{
    "topic": "media.seekrel",
    "payload": { "delta": 10 }
}
```

| Field   | Type   | Description                                       |
|---------|--------|---------------------------------------------------|
| `delta` | number | Seconds to skip (positive = forward, negative = backward) |

**Example — keyboard skip with optimistic local UI:**
```javascript
case 'ArrowRight':
    castSend('media.seekrel', { delta: 10 });
    castCurrentTime = Math.min(castDuration, castCurrentTime + 10);
    updateProgressUI();
    break;
case 'ArrowLeft':
    castSend('media.seekrel', { delta: -10 });
    castCurrentTime = Math.max(0, castCurrentTime - 10);
    updateProgressUI();
    break;
```

---

#### `media.volume`

Sets the playback volume and mute state. The receiver applies this to both its audio and video elements.

```json
{
    "topic": "media.volume",
    "payload": {
        "volume": 80,
        "muted":  false
    }
}
```

| Field    | Type    | Description                        |
|----------|---------|------------------------------------|
| `volume` | number  | Volume level, 0–100                |
| `muted`  | boolean | Whether audio is muted             |

> **Scale note:** Arozcast uses **0–100** for volume. If your sender's native element uses 0–1 (like a `<video>` element), multiply by 100 before sending.

---

#### `media.repeat`

Syncs the repeat mode. The receiver sets `el.loop = true` for `'one'` (browser handles looping natively) and only shows a visual indicator for `'all'` (the sender drives playlist advancement via `media.ended`).

```json
{
    "topic": "media.repeat",
    "payload": { "mode": "one" }
}
```

| `mode`   | Meaning                                    |
|----------|--------------------------------------------|
| `"none"` | No repeat                                  |
| `"one"`  | Loop the current track (receiver sets `loop=true`) |
| `"all"`  | Loop the playlist (sender listens for `media.ended` and loads the next track) |

Send on: user changes repeat mode, initial cast connection, and every reconnect.

---

#### `media.stop`

Stops playback and clears the current track from the receiver's UI. The receiver returns to its idle/waiting screen.

```json
{ "topic": "media.stop", "payload": {} }
```

**Only send this when the user explicitly disconnects.** Do **not** send it on page unload or on a broken WebSocket — this would stop the receiver even when the sender only navigated away or the phone went to sleep. Let the receiver keep playing and display its "sender disconnected" banner instead.

---

### Receiver → Sender Topics

These are sent by the Arozcast receiver back to the sender.

---

#### `status.update`

Broadcast by the receiver every **3 seconds** so all connected senders can stay in sync.

```json
{
    "topic": "status.update",
    "payload": {
        "currentTime": 87.4,
        "duration":    240.0,
        "isPlaying":   true,
        "volume":      80,
        "isMuted":     false,
        "peerCount":   1
    }
}
```

On reconnect, do **not** push the sender's local time to the receiver. Instead, wait for the next `status.update` (arrives within 3 seconds) and let it overwrite your local display. This prevents stale sender-side time from rewinding a track that kept playing while the phone was asleep.

---

#### `media.ended`

Sent by the receiver when the current track finishes naturally (i.e. `loop` is `false`). The sender should respond by loading the next track (for `repeat === 'all'`) or doing nothing (for `repeat === 'none'`).

```json
{ "topic": "media.ended", "payload": {} }
```

---

## Complete Integration Walkthrough

Below is a minimal but complete sender implementation in plain JavaScript.

```javascript
// ── State ────────────────────────────────────────────────────────────────
var castWs        = null;
var castCode      = null;
var castMode      = false;
var castDuration  = 0;
var castTime      = 0;
var castPlaying   = false;
var castPingTimer = null;

// ── Helpers ──────────────────────────────────────────────────────────────
function castSend(topic, payload) {
    if (castWs && castWs.readyState === WebSocket.OPEN) {
        castWs.send(JSON.stringify({ topic: topic, payload: payload }));
    }
}

function castConnected() {
    return castMode && castWs && castWs.readyState === WebSocket.OPEN;
}

// ── 1. Create a room and open the WebSocket ───────────────────────────────
async function startCast() {
    // Create room
    const res  = await fetch(ao_root + 'api/arozcast/create', { method: 'POST' });
    const data = await res.json();
    castCode = data.code;

    // Show the code to the user so they can enter it in the Arozcast receiver
    showCodeUI(castCode);

    // Connect WebSocket
    var wsUrl = new URL(ao_root + 'api/arozcast/ws?code=' + castCode, window.location.href);
    wsUrl.protocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    castWs = new WebSocket(wsUrl.toString());

    castWs.onopen = function() {
        castMode = true;

        // Announce presence
        castSend('peer.hello', {});

        // Send current media + volume state so receiver syncs immediately
        var video = document.getElementById('my-video');
        castSend('media.load', {
            name:      currentEpisode.name,
            type:      'video',
            src:       currentEpisode.url,       // full playback URL
            filepath:  currentEpisode.filepath,  // ArozOS vpath
            startTime: video.currentTime
        });
        castSend('media.volume', { volume: video.volume * 100, muted: video.muted });
        castSend(video.paused ? 'media.pause' : 'media.play', {});

        // Pause local playback — receiver takes over
        video.pause();

        // Heartbeat
        castPingTimer = setInterval(function() {
            castSend('peer.heartbeat', {});
        }, 5000);
    };

    castWs.onmessage = function(evt) {
        var msg = JSON.parse(evt.data);
        if (msg.topic === 'status.update') {
            // Sync sender-side progress display
            castTime     = msg.payload.currentTime;
            castDuration = msg.payload.duration;
            castPlaying  = msg.payload.isPlaying;
            updateProgressUI();
        } else if (msg.topic === 'media.ended') {
            loadNextTrack(); // advance playlist
        }
    };

    castWs.onclose = function() {
        clearInterval(castPingTimer);
        castMode = false; castWs = null;
        updateCastUI();
    };
}

// ── 2. Send playback commands ─────────────────────────────────────────────
function togglePlayPause() {
    if (castConnected()) {
        if (castPlaying) {
            castSend('media.pause', {});
            castPlaying = false;             // optimistic update
        } else {
            castSend('media.play', {});
            castPlaying = true;
        }
        updatePlayIcon();
        return;
    }
    // fallback: control local video
    var v = document.getElementById('my-video');
    v.paused ? v.play() : v.pause();
}

function skipForward(seconds) {
    if (castConnected()) {
        castSend('media.seekrel', { delta: seconds });
        castTime = Math.min(castDuration, castTime + seconds); // optimistic
        updateProgressUI();
        return;
    }
    var v = document.getElementById('my-video');
    v.currentTime = Math.min(v.duration || 0, v.currentTime + seconds);
}

function setVolume(pct, muted) {
    if (castConnected()) {
        castSend('media.volume', { volume: pct, muted: muted });
    }
    // also update local video for when we disconnect
    var v = document.getElementById('my-video');
    v.volume = pct / 100;
    v.muted  = muted;
}

// ── 3. Load a new track while casting ────────────────────────────────────
function castLoadTrack(episode) {
    if (!castConnected()) return;
    castSend('media.load', {
        name:      episode.name,
        type:      'video',
        src:       episode.url,
        filepath:  episode.filepath,
        startTime: 0
    });
    castSend('media.volume', { volume: myVideo().volume * 100, muted: myVideo().muted });
    castSend('media.play', {});
}

// ── 4. Explicitly disconnect ──────────────────────────────────────────────
function disconnectCast() {
    if (castConnected()) {
        castSend('media.stop', {}); // tell receiver to clear its screen
    }
    if (castWs) { castWs.onclose = null; castWs.close(); castWs = null; }
    clearInterval(castPingTimer);
    castMode = false;

    // Resume locally at the last known position
    var v = document.getElementById('my-video');
    v.currentTime = castTime;
    v.play();
}

// ── 5. Clean up on page unload ────────────────────────────────────────────
window.addEventListener('beforeunload', function() {
    // Do NOT send media.stop — receiver should keep playing.
    // Close the WS silently and ask the server to clean up the room.
    if (castWs) { castWs.onclose = null; castWs.close(); }
    if (castCode) { navigator.sendBeacon(ao_root + 'api/arozcast/close?code=' + castCode); }
});
```

---

## Reconnection & Resilience

Mobile browsers suspend WebSocket connections when the screen locks. Implement exponential-backoff reconnection so the cast session survives a brief sleep.

```javascript
var RECONNECT_DELAYS   = [2000, 5000, 12000]; // ms
var reconnectCount     = 0;
var reconnectTimer     = null;
var pendingCode        = null;

function onCastDisconnect(savedCode) {
    castMode = false; castWs = null;
    pendingCode = savedCode;
    scheduleReconnect();
}

function scheduleReconnect() {
    if (reconnectCount >= RECONNECT_DELAYS.length) {
        // Give up — fall back to local playback
        reconnectCount = 0; pendingCode = null;
        resumeLocally();
        return;
    }
    var delay = RECONNECT_DELAYS[reconnectCount++];
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(attemptReconnect, delay);
}

function attemptReconnect() {
    if (!pendingCode) return;
    var code = pendingCode;

    var wsUrl = new URL(ao_root + 'api/arozcast/ws?code=' + code, window.location.href);
    wsUrl.protocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    var ws = new WebSocket(wsUrl.toString());

    var timeout = setTimeout(function() {
        ws.onopen = ws.onclose = ws.onerror = null; ws.close();
        scheduleReconnect(); // timed out — try again
    }, 8000);

    ws.onopen = function() {
        clearTimeout(timeout);
        reconnectCount = 0; pendingCode = null;
        castWs = ws; castCode = code; castMode = true;

        // Re-announce only — do NOT resend media.load.
        // The receiver kept playing; status.update will sync time within 3 s.
        castSend('peer.hello', {});
        castSend('media.volume', { volume: myVideo().volume * 100, muted: myVideo().muted });

        startHeartbeat();
        showToast('Arozcast reconnected');
    };

    ws.onclose = function() {
        clearTimeout(timeout);
        scheduleReconnect();
    };
}

// Wake-up accelerator: retry immediately when the tab/app comes back to foreground
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && pendingCode) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        attemptReconnect();
    }
});
```

### Reconnection rules

| Situation | Action |
|-----------|--------|
| WS drops unexpectedly | Retry up to 3 times (2 s / 5 s / 12 s backoff) |
| Tab becomes visible while retrying | Retry immediately |
| All retries exhausted | Call `resumeLocally()` — fall back to device playback |
| User explicitly presses "Disconnect" | Send `media.stop`, skip retries, resume locally |
| Page/tab closed | Send only `media.stop` if explicit disconnect; otherwise let receiver keep playing |
| Server sends `room.closed` | Give up immediately — no retries; see [receiver idle timeout](#receiver-idle-timeout) |

> **Important:** Do not reset the reconnect counter when the WebSocket opens. Only reset it after the **first `status.update` is received** — this proves the receiver is alive. Resetting on WS open alone creates an infinite loop when the room exists on the server but the receiver page is gone.

```javascript
ws.onopen = function() {
    // Do NOT set reconnectCount = 0 here
    pendingCode = null;
    castWs = ws; castCode = code; castMode = true;
    castSend('peer.hello', {});
    startHeartbeat();
};

ws.onmessage = function(evt) {
    var msg = JSON.parse(evt.data);
    if (msg.topic === 'status.update') {
        reconnectCount = 0; // receiver confirmed alive — now safe to reset
        // ... sync playback state
    } else if (msg.topic === 'room.closed') {
        // Backend closed the room — stop retrying immediately
        reconnectCount = 0; pendingCode = null;
        clearTimeout(reconnectTimer);
        resumeLocally();
    }
};
```

---

## Best Practices & Notes

### Volume scale
Arozcast uses **0–100** for volume. HTML `<video>` / `<audio>` elements use **0–1**. Always multiply by 100 before sending and divide by 100 after receiving.

```javascript
// Sending:
castSend('media.volume', { volume: videoEl.volume * 100, muted: videoEl.muted });

// Receiving status.update:
videoEl.volume = payload.volume / 100;
```

### Ordering of messages on initial load
Always send in this order:
1. `media.load` (sets the file)
2. `media.volume` (sets volume **before** decoding begins)
3. `media.play` or `media.pause` (starts/withholds playback)
4. `media.repeat` (sets loop state)

Sending `media.volume` after `media.play` can race the browser's default volume assignment.

### Optimistic UI for seek and play/pause
Because `status.update` arrives every 3 seconds, applying seek/play/pause commands to your sender-side progress bar immediately (before confirmation) makes the UI feel responsive:

```javascript
// Optimistic seek
castSend('media.seekrel', { delta: 10 });
castTime = Math.min(castDuration, castTime + 10); // update sender UI now
updateProgressUI();                                // status.update will correct within 3 s
```

### `media.stop` — send only on explicit disconnect
Do **not** send `media.stop` when the page unloads or the WebSocket drops. The receiver will display a "sender disconnected" banner but continue playing. This is the desired behaviour for mobile devices that lock the screen.

Only send `media.stop` when the user explicitly clicks "Disconnect cast".

### `repeat === 'all'` requires the sender to advance the playlist
Setting `repeat === 'all'` does **not** make the receiver loop automatically. Instead:
- The receiver fires `media.ended` when the current track finishes.
- The sender receives `media.ended` and calls `media.load` with the next track.

Setting `repeat === 'one'` sets `loop = true` on the receiver's media element, so the browser handles looping natively and `media.ended` is never fired.

### Room lifetime

Rooms are closed automatically by the server in two cases:

| Condition | Timeout | Notes |
|-----------|---------|-------|
| **Receiver idle** | **30 seconds** | The receiver (`index.html`) sends `status.update` every 3 s. If no `status.update` has been seen for 30 s the receiver is considered gone and the room is closed. |
| **Empty room** | **10 minutes** | The room has no connected WebSocket clients. Catches rooms whose owner never opened the Arozcast page. |

The sweep runs every 15 seconds. When a room is closed by the sweep, the backend first broadcasts `{"topic":"room.closed","payload":{}}` to every connected sender before dropping their sockets. A well-behaved sender should stop retrying immediately on receiving this message.

Always call `/api/arozcast/close` when tearing down intentionally so the slot is freed immediately without waiting for the sweep.

#### Receiver idle timeout

The **30-second receiver idle** guard is the second line of defence against zombie sessions where the Arozcast iframe was force-removed from the DOM without triggering `beforeunload` (so the room was not explicitly closed via `/api/arozcast/close`). When the sweep fires:

1. Room is deleted from the server's room map.
2. `{"topic":"room.closed","payload":{}}` is broadcast to all connected senders.
3. All WebSocket connections are closed.
4. Any sender that receives `room.closed` should give up immediately; any sender that misses it will discover the room is gone when its next reconnect attempt gets a **404 Room not found** response.

### Screen Share over the Internet

Media casting (Musicify / Movie / Photo) already works over the Internet: both
sender and receiver relay through this ArozOS host, and the receiver loads media
from the host it reached, so nothing extra is required beyond the host being
reachable.

**Screen share is different** — it is a direct WebRTC peer-to-peer connection.
On a LAN the peers connect with host candidates, but across the Internet they
are usually behind NAT and need a **TURN relay** to forward the stream. ArozOS
ships a built-in TURN relay so this works without a third-party service:

| Flag | Default | Purpose |
|------|---------|---------|
| `-arozcast_turn` | `true` | Enable the built-in TURN relay. |
| `-arozcast_turn_port` | `3478` | UDP **and** TCP port the relay listens on. |
| `-arozcast_turn_publicip` | *(auto)* | Public IP/hostname advertised to peers. Auto-detected from the outbound interface; **set this when the host is behind NAT**. |

For screen share to work across the Internet, the relay port must be reachable
by both peers:

- **Host with a public IP (VPS / port-forwarded):** forward `-arozcast_turn_port`
  (UDP + TCP). Behind NAT, also set `-arozcast_turn_publicip` to your public IP.
- **Behind a reverse proxy:** the proxy only carries HTTP(S); expose the TURN
  port separately (it does not go through the proxy).
- The relay is **non-fatal**: if it cannot start, screen share silently falls
  back to STUN-only (LAN works, Internet may not).

**Using an external TURN instead.** Drop a `system/arozcast/iceservers.json`
file to fully replace the ICE list returned by `/api/arozcast/iceservers`
(e.g. to point at coturn or a managed TURN provider). When present and valid it
takes precedence over the built-in relay:

```json
{
  "iceServers": [
    { "urls": ["stun:stun.l.google.com:19302"] },
    {
      "urls": ["turn:turn.example.com:3478"],
      "username": "myuser",
      "credential": "mypassword"
    }
  ]
}
```

### HTTP publish for non-WS contexts
AGI scripts and server-side code that cannot hold a WebSocket can use `/api/arozcast/publish` to inject any message into a live room. This is useful for automation (e.g. skip to next track on a timer) without modifying the frontend.

```bash
# Pause playback from the command line
curl -X POST https://your-arozos/api/arozcast/publish \
     -d "code=1234" \
     --data-urlencode 'msg={"topic":"media.pause","payload":{}}'
```
