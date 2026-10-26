/*
    WebSocket Test Script

    Demonstrates three read patterns:

    MODE 1 — blocking read with timeout  (default)
      Send "mode2" or "mode3" to switch to another demo.
      echo <text>  → echoes text back
      stop         → closes the connection

    MODE 2 — available() polling (Arduino-style)
      Uses websocket.available() + websocket.read(0) in a tight loop.

    MODE 3 — onMessage callback
      Assigns websocket.onMessage; the handler fires inside delay().
      echo <text>  → echoes text back
      stop         → closes the connection

    Author: tobychui
*/

if (!requirelib("websocket")) {
    console.log("WebSocket library load failed");
} else if (!websocket.upgrade(120)) {
    // upgrade() also overrides delay() with a message-pumping version
    console.log("WebSocket upgrade failed");
} else {
    console.log("WebSocket opened");
    runMode1();
    websocket.close();
    console.log("WebSocket closed");
}

// ── MODE 1: blocking read with optional millisecond timeout ──────────────────
function runMode1() {
    websocket.send("[Mode 1] Blocking read with timeout. Commands: echo <text> | stop | mode2 | mode3");

    while (true) {
        // Block up to 30 s waiting for a message; returns null on timeout, false if closed
        var msg = websocket.read(30000);

        if (msg === false) {
            // Connection was closed remotely
            break;
        }
        if (msg === null) {
            // 30-second idle timeout — send a ping to keep things alive
            websocket.send("[Mode 1] Still here. 30 s idle timeout reached.");
            continue;
        }

        msg = msg.trim();

        if (msg === "stop") {
            websocket.send("Bye!");
            return;
        } else if (msg === "mode2") {
            websocket.send("Switching to Mode 2 (available polling)...");
            runMode2();
            return;
        } else if (msg === "mode3") {
            websocket.send("Switching to Mode 3 (onMessage callback)...");
            runMode3();
            return;
        } else if (msg.indexOf("echo ") === 0) {
            websocket.send(msg.slice(5));
        } else if (msg !== "") {
            websocket.send("[Mode 1] Unknown command: '" + msg + "'");
        }
    }
}

// ── MODE 2: available() + non-blocking read ───────────────────────────────────
function runMode2() {
    websocket.send("[Mode 2] available() polling. Commands: echo <text> | stop | mode1");

    while (true) {
        if (websocket.isClosed()) {
            break;
        }

        var pending = websocket.available();
        if (pending > 0) {
            // Read all queued messages without blocking
            for (var i = 0; i < pending; i++) {
                var msg = websocket.read(0); // 0 = block; channel already has data
                if (msg === false) { return; }
                if (msg === null)  { continue; }

                msg = msg.trim();
                if (msg === "stop") {
                    websocket.send("Bye!");
                    return;
                } else if (msg === "mode1") {
                    websocket.send("Switching to Mode 1...");
                    runMode1();
                    return;
                } else if (msg.indexOf("echo ") === 0) {
                    websocket.send(msg.slice(5));
                } else if (msg !== "") {
                    websocket.send("[Mode 2] Unknown command: '" + msg + "'");
                }
            }
        } else {
            // Nothing waiting — report queue depth and sleep briefly
            websocket.send("[Mode 2] Queue empty (available=" + pending + "). Sleeping 500 ms...");
            delay(500); // delay() is now message-pumping, but onMessage is null here
        }
    }
}

// ── MODE 3: onMessage callback ────────────────────────────────────────────────
function runMode3() {
    websocket.send("[Mode 3] onMessage callback. Commands: echo <text> | stop | mode1");

    var lastMessage = "";

    // Assign the async handler — fires inside delay() on the script's goroutine
    websocket.onMessage = function(msg) {
        // msg = { data: string, timestamp: number, type: number }
        lastMessage = msg.data;
        console.log("onMessage fired at " + msg.timestamp + " ms: " + msg.data);
    };

    while (true) {
        if (lastMessage !== "") {
            var msg = lastMessage.trim();
            lastMessage = "";

            if (msg === "stop") {
                websocket.send("Bye!");
                websocket.onMessage = null;
                return;
            } else if (msg === "mode1") {
                websocket.send("Switching to Mode 1...");
                websocket.onMessage = null;
                runMode1();
                return;
            } else if (msg.indexOf("echo ") === 0) {
                websocket.send(msg.slice(5));
            } else if (msg !== "") {
                websocket.send("[Mode 3] Unknown command: '" + msg + "'");
            }
        }

        if (websocket.isClosed()) {
            break;
        }

        // delay() pumps the inbound channel and fires onMessage for each frame
        delay(100);
    }

    websocket.onMessage = null;
}
