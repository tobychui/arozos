/*
    chunkupload.js

    Client side of the low-memory (WebSocket chunked) upload channel,
    /system/file_system/lowmemUpload. Shared by the File Manager and the
    desktop so both speak exactly the same protocol.

    Protocol, per chunk: a text frame {"index": N, "checksum": "<crc32 hex>"}
    followed by a binary frame with the chunk bytes. The server takes chunks
    strictly in index order and answers each one it accepts with "next".
    Anything else it silently drops: a copy of a chunk it already has, or a
    chunk sent ahead of one that failed its CRC. On a CRC mismatch it asks for
    {"retryChunk": N}. When every chunk is acknowledged the client sends
    {"done": true, "totalChunks": N, "fileChecksum": "<crc32 hex>"} and the
    server merges the chunks, reporting {"move": "..."} and finally "OK".

    Pipelining: instead of waiting for "next" after every chunk, up to
    windowSize bytes of chunks are kept in flight, so one connection is no
    longer capped at one chunk per round trip. Because the server answers in
    order, each "next" acknowledges the oldest chunk still in flight. A retry
    request rewinds the sender to the chunk that failed (go-back-N); an
    acknowledgement timeout resends just the oldest unacknowledged chunk. The
    server drops whatever it receives out of order, so both are always safe.

    Every chunk is read and checksummed exactly once per send. The whole-file
    CRC32 is built from the chunk CRCs with crc32Combine instead of a second
    pass over the bytes.
*/

(function (global) {
    "use strict";

    /*
        CRC32 (IEEE, reflected, polynomial 0xEDB88320) - matches Go's
        hash/crc32.ChecksumIEEE. Slicing-by-8 tables: CRC_TABLES[k] advances the
        CRC by one byte followed by k zero bytes.
    */
    const CRC_POLY = 0xEDB88320;
    const CRC_TABLES = (function () {
        let tables = [];
        for (let k = 0; k < 8; k++) {
            tables.push(new Int32Array(256));
        }
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = (c & 1) ? (CRC_POLY ^ (c >>> 1)) : (c >>> 1);
            }
            tables[0][i] = c;
        }
        for (let i = 0; i < 256; i++) {
            let c = tables[0][i];
            for (let k = 1; k < 8; k++) {
                c = tables[0][c & 0xFF] ^ (c >>> 8);
                tables[k][i] = c;
            }
        }
        return tables;
    })();

    //CRC32 of a Uint8Array as an unsigned 32-bit number
    function crc32(bytes) {
        const t0 = CRC_TABLES[0], t1 = CRC_TABLES[1], t2 = CRC_TABLES[2], t3 = CRC_TABLES[3];
        const t4 = CRC_TABLES[4], t5 = CRC_TABLES[5], t6 = CRC_TABLES[6], t7 = CRC_TABLES[7];
        let crc = -1;
        let i = 0;
        const len = bytes.length;
        const fast = len - (len % 8);
        while (i < fast) {
            const lo = crc ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24));
            crc = t7[lo & 0xFF] ^ t6[(lo >>> 8) & 0xFF] ^ t5[(lo >>> 16) & 0xFF] ^ t4[lo >>> 24] ^
                  t3[bytes[i + 4]] ^ t2[bytes[i + 5]] ^ t1[bytes[i + 6]] ^ t0[bytes[i + 7]];
            i += 8;
        }
        while (i < len) {
            crc = t0[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            i++;
        }
        return (crc ^ -1) >>> 0;
    }

    /*
        crc32Combine(crcA, crcB, lenB) returns the CRC32 of A followed by B,
        given only the CRC of each part and the byte length of B. Port of
        zlib's crc32_combine (multmodp / x2nmodp).
    */
    function multmodp(a, b) {
        let m = 0x80000000;
        let p = 0;
        for (;;) {
            if (a & m) {
                p ^= b;
                if ((a & (m - 1)) === 0) {
                    break;
                }
            }
            m = m / 2;
            b = (b & 1) ? ((b >>> 1) ^ CRC_POLY) : (b >>> 1);
        }
        return p >>> 0;
    }

    //X2N_TABLE[k] = x^(2^k) modulo the CRC polynomial
    const X2N_TABLE = (function () {
        let table = new Array(32);
        let p = 0x40000000; //x^1
        table[0] = p;
        for (let n = 1; n < 32; n++) {
            p = multmodp(p, p);
            table[n] = p;
        }
        return table;
    })();

    //x^(n * 2^k) modulo the CRC polynomial
    function x2nmodp(n, k) {
        let p = 0x80000000; //x^0 == 1
        while (n > 0) {
            if (n % 2 === 1) {
                p = multmodp(X2N_TABLE[k & 31], p);
            }
            n = Math.floor(n / 2);
            k++;
        }
        return p;
    }

    function crc32Combine(crcA, crcB, lenB) {
        return (multmodp(x2nmodp(lenB, 3), crcA) ^ crcB) >>> 0;
    }

    function crc32ToHex(crc) {
        return (crc >>> 0).toString(16).padStart(8, "0");
    }

    function noop() {}

    /*
        Start uploading file over a new WebSocket to url.

        Options (all callbacks optional):
          url, file         - required
          chunkSize         - bytes per chunk (default 1MB)
          windowSize        - bytes allowed in flight (default 8MB, at least one chunk)
          ackTimeout        - ms without any acknowledgement before rewinding (default 30s)
          maxRetries        - rewinds allowed without progress before failing (default 3)
          pingInterval      - heartbeat interval while paused (default 20s)
          onProgress(ackedBytes, totalBytes)
          onProcessing()    - every chunk acknowledged, server is merging
          onMove(status)    - merge progress text from the server
          onDone()          - server reported "OK"
          onError(message, fromServer) - the upload failed
          onClose(event)    - the WebSocket closed, for any reason
          onSocketError(error)

        Returns a controller: {pause(), resume(), abort(), isPaused(), socket}
    */
    function start(opts) {
        const file = opts.file;
        const chunkSize = opts.chunkSize || 1024 * 1024;
        const windowChunks = Math.max(1, Math.floor((opts.windowSize || 8 * 1024 * 1024) / chunkSize));
        const ackTimeout = opts.ackTimeout || 30000;
        const maxRetries = (opts.maxRetries === undefined) ? 3 : opts.maxRetries;
        const pingInterval = opts.pingInterval || 20000;
        const chunks = Math.ceil(file.size / chunkSize);

        const onProgress = opts.onProgress || noop;
        const onProcessing = opts.onProcessing || noop;
        const onMove = opts.onMove || noop;
        const onDone = opts.onDone || noop;
        const onError = opts.onError || noop;
        const onClose = opts.onClose || noop;
        const onSocketError = opts.onSocketError || noop;

        const socket = new WebSocket(opts.url);

        let acked = 0;          //chunks [0, acked) are accepted by the server
        let nextIndex = 0;      //next chunk to put on the wire
        let generation = 0;     //bumped on every rewind, invalidates a send in progress
        let pumping = false;
        let retries = 0;        //rewinds since the last acknowledgement

        //Whole-file CRC, folded from each chunk's CRC the first time it is sent
        let fileCRC = 0;
        let crcFolded = 0;

        let paused = false;
        let doneSent = false;
        let failed = false;
        let aborted = false;
        let ackTimer = null;
        let pingTimer = null;

        //No more chunk traffic once the upload is finished one way or another
        function halted() {
            return doneSent || failed || aborted;
        }

        function send(data) {
            try {
                socket.send(data);
            } catch (e) {}
        }

        function stopAckTimer() {
            clearTimeout(ackTimer);
            ackTimer = null;
        }

        function armAckTimer() {
            stopAckTimer();
            if (paused || halted() || acked >= nextIndex) {
                return;
            }
            ackTimer = setTimeout(onAckTimeout, ackTimeout);
        }

        function onAckTimeout() {
            ackTimer = null;
            if (paused || halted()) {
                return;
            }
            if (socket.bufferedAmount > 0) {
                //Still handing bytes to the network - a slow link, not a lost
                //chunk. Resending now would only queue duplicates behind them.
                armAckTimer();
                return;
            }
            if (retries >= maxRetries) {
                fail("Upload stalled: no acknowledgement from server", false);
                return;
            }
            retries++;
            console.warn("[Upload] Chunk " + acked + " not acknowledged - resending it (" + retries + "/" + maxRetries + ")");
            /*
                Only the oldest chunk, not the whole window. On a live socket
                nothing is actually lost - the server is just slow - so every
                resent chunk is a duplicate it has to read and drop before it
                can acknowledge anything new. Rewinding a full window here would
                bury the next acknowledgement under it and time out again.
            */
            resendChunk(acked);
            armAckTimer();
        }

        //Put one chunk on the wire again without moving the send position
        async function resendChunk(id) {
            let bytes;
            try {
                bytes = await readChunk(id);
            } catch (e) {
                console.error("[Upload] Failed to read chunk " + id + ": " + e);
                fail("Failed to read file", false);
                return;
            }
            if (halted() || id < acked || socket.readyState != WebSocket.OPEN) {
                return;
            }
            sendChunk(id, bytes, crc32(new Uint8Array(bytes)));
        }

        function readChunk(id) {
            const offsetStart = id * chunkSize;
            return file.slice(offsetStart, Math.min(file.size, offsetStart + chunkSize)).arrayBuffer();
        }

        //The header and its payload always leave back to back, with no await
        //between them, so two senders can never interleave a pair
        function sendChunk(id, buffer, chunkCRC) {
            send(JSON.stringify({index: id, checksum: crc32ToHex(chunkCRC)}));
            send(buffer);
        }

        function startPing() {
            stopPing();
            pingTimer = setInterval(function () {
                if (socket.readyState != WebSocket.OPEN) {
                    stopPing();
                    return;
                }
                send(JSON.stringify({ping: true}));
            }, pingInterval);
        }

        function stopPing() {
            if (pingTimer != null) {
                clearInterval(pingTimer);
                pingTimer = null;
            }
        }

        function fail(message, fromServer) {
            if (failed || aborted) {
                return;
            }
            failed = true;
            stopAckTimer();
            stopPing();
            onError(message, fromServer);
            if (!fromServer) {
                try { socket.close(); } catch (e) {}
            }
        }

        //Go back to chunk index and send everything from there again
        function rewind(index) {
            generation++;
            nextIndex = Math.max(acked, Math.min(index, nextIndex));
            armAckTimer();
            pump();
        }

        //Fill the window. Only one pump runs at a time so chunks leave in order.
        async function pump() {
            if (pumping) {
                return;
            }
            pumping = true;
            try {
                while (!paused && !halted() && socket.readyState == WebSocket.OPEN &&
                        nextIndex < chunks && nextIndex - acked < windowChunks) {
                    const id = nextIndex;
                    const gen = generation;

                    let buffer;
                    try {
                        buffer = await readChunk(id);
                    } catch (e) {
                        console.error("[Upload] Failed to read chunk " + id + ": " + e);
                        fail("Failed to read file", false);
                        return;
                    }
                    if (gen !== generation) {
                        //Rewound while reading, re-evaluate from the top
                        continue;
                    }
                    if (paused || halted() || socket.readyState != WebSocket.OPEN) {
                        break;
                    }

                    const chunkCRC = crc32(new Uint8Array(buffer));
                    if (id === crcFolded) {
                        //First time this chunk is sent (a resend never runs ahead of it)
                        fileCRC = crc32Combine(fileCRC, chunkCRC, buffer.byteLength);
                        crcFolded++;
                    }

                    sendChunk(id, buffer, chunkCRC);
                    nextIndex = id + 1;
                    if (ackTimer == null) {
                        armAckTimer();
                    }
                }

                if (!paused && !halted() && acked >= chunks && socket.readyState == WebSocket.OPEN) {
                    doneSent = true;
                    stopAckTimer();
                    send(JSON.stringify({done: true, totalChunks: chunks, fileChecksum: crc32ToHex(fileCRC)}));
                    onProcessing();
                }
            } finally {
                pumping = false;
            }
        }

        socket.onopen = function () {
            if (paused) {
                //Paused before the socket connected - tell the server now, or
                //it reaps the silent connection as idle
                send(JSON.stringify({pause: true}));
                startPing();
                return;
            }
            pump();
        };

        socket.onmessage = function (event) {
            const incoming = event.data;

            if (incoming == "next") {
                if (acked < chunks) {
                    acked++;
                    if (nextIndex < acked) {
                        //The original copy got through after a rewind
                        nextIndex = acked;
                    }
                }
                retries = 0;
                onProgress(Math.min(file.size, acked * chunkSize), file.size);
                armAckTimer();
                pump();
                return;
            }

            if (incoming == "OK") {
                onDone();
                return;
            }

            let resp;
            try {
                resp = JSON.parse(incoming);
            } catch (e) {
                console.log("[Upload] Unexpected message: ", incoming);
                return;
            }

            if (resp.pong !== undefined) {
                //Heartbeat reply while paused
                return;
            } else if (resp.error !== undefined) {
                fail(resp.error, true);
            } else if (resp.retryChunk !== undefined) {
                if (halted()) {
                    return;
                }
                if (retries >= maxRetries) {
                    console.error("[Upload] Chunk " + resp.retryChunk + " CRC32 mismatch after max retries");
                    fail("Chunk checksum mismatch after " + maxRetries + " retries", false);
                    return;
                }
                retries++;
                console.warn("[Upload] Server requested retry for chunk " + resp.retryChunk + " (CRC32 mismatch) - retry " + retries + "/" + maxRetries);
                rewind(resp.retryChunk);
            } else if (resp.move !== undefined) {
                onMove(resp.move);
            }
        };

        socket.onclose = function (event) {
            stopAckTimer();
            stopPing();
            onClose(event);
        };

        socket.onerror = function (error) {
            onSocketError(error);
        };

        return {
            socket: socket,
            isPaused: function () {
                return paused;
            },
            pause: function () {
                if (paused || halted()) {
                    return;
                }
                paused = true;
                //Chunks already in flight still get acknowledged; only the ack
                //clock stops, or a legitimately idle upload would "time out"
                stopAckTimer();
                if (socket.readyState == WebSocket.OPEN) {
                    send(JSON.stringify({pause: true}));
                    startPing();
                }
            },
            resume: function () {
                if (!paused) {
                    return;
                }
                paused = false;
                stopPing();
                if (socket.readyState == WebSocket.OPEN) {
                    send(JSON.stringify({resume: true}));
                    armAckTimer();
                    pump();
                }
            },
            abort: function () {
                aborted = true;
                stopAckTimer();
                stopPing();
                try { socket.close(); } catch (e) {}
            }
        };
    }

    global.ChunkUpload = {
        start: start,
        crc32: crc32,
        crc32Combine: crc32Combine,
        crc32ToHex: crc32ToHex
    };
})(window);
