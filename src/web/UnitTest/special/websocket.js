/*
    WebSocket Test Script

    Supports an interactive command loop:
      echo <text>  — sends <text> back to the client
      stop         — closes the connection gracefully

    Author: tobychui
*/

function setup() {
    if (!requirelib("websocket")) {
        console.log("WebSocket library load failed");
        return false;
    }

    // Upgrade to WebSocket; 120-second idle timeout
    if (!websocket.upgrade(120)) {
        console.log("WebSocket upgrade failed");
        return false;
    }

    console.log("WebSocket opened");
    return true;
}

function commandLoop() {
    websocket.send("Connected. Commands: echo <text> | stop");

    while (true) {
        var msg = websocket.read();

        // null means the connection was closed or timed out
        if (msg == null) {
            console.log("WebSocket read returned null — closing");
            break;
        }

        msg = msg.trim();

        if (msg === "stop") {
            websocket.send("Bye!");
            break;
        } else if (msg.indexOf("echo ") === 0) {
            websocket.send(msg.slice(5));
        } else if (msg === "") {
            // ignore empty messages
        } else {
            websocket.send("Unknown command: '" + msg + "'");
        }
    }
}

if (setup()) {
    commandLoop();
    websocket.close();
} else {
    console.log("WebSocket setup failed");
}
