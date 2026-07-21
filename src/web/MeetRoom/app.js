/*
    MeetRoom - Video conferencing WebApp
    author: tobychui / AI assisted

    Front-end for the mod/meetroom backend (src/meetroom.go). Media flows
    peer-to-peer over a WebRTC mesh; the ArozOS server only relays JSON
    signaling frames over /system/meetroom/ws and stores shared files.

    Connection model:
      - Each peer connection carries exactly one audio and one video
        transceiver, created up-front in sendrecv mode. Camera / screen
        tracks are attached with replaceTrack(), so toggling the camera
        or starting a screen share never needs SDP renegotiation.
      - The newcomer is always the offerer: on "welcome" it creates an
        offer to every existing peer; existing peers answer.

    Resilience:
      - An app-level ping/pong heartbeat detects half-dead sockets (e.g.
        a silently dropped network) and force-closes them.
      - When the signaling socket drops mid-meeting, the client keeps the
        room UI and local media alive and reconnects with capped
        exponential backoff. Reconnecting rejoins as a fresh peer, so the
        WebRTC mesh is rebuilt from the new "welcome" frame. If the room
        cannot be reached again within RECONNECT_WINDOW_MS (or no longer
        exists), the client gives up and returns to the lobby.
*/

(function () {
    "use strict";

    var HEARTBEAT_INTERVAL_MS = 15000; //app-level ping cadence
    var HEARTBEAT_TIMEOUT_MS = 40000;  //no pong for this long = dead socket
    var RECONNECT_WINDOW_MS = 60000;   //give up reconnecting after this long
    var RECONNECT_MAX_DELAY_MS = 10000; //backoff cap between attempts

    var API = {
        create: "/system/meetroom/create",
        join: "/system/meetroom/join",
        info: "/system/meetroom/info",
        end: "/system/meetroom/end",
        ice: "/system/meetroom/iceservers",
        upload: "/system/meetroom/upload",
        attachfile: "/system/meetroom/attachfile",
        download: "/system/meetroom/download",
        ws: "/system/meetroom/ws"
    };

    //File extensions the chat renders inline as images; must match the
    //server-side raster whitelist (mod/sharedspace IsImageName)
    var IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

    var state = {
        ws: null,
        connected: false,
        myPeerId: -1,
        username: "",
        isHost: false,
        room: null, // {id, displayid, title, host, protected}
        password: "",
        peers: {}, // peerid -> peer record
        iceConfig: { iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] },
        localStream: null,
        camTrack: null,
        micTrack: null,
        screenStream: null,
        screenTrack: null,
        micOn: true,
        camOn: true,
        sharing: false,
        handRaised: false,
        handAt: {}, // peerid -> time (ms) the hand went up, for the raise queue order
        chatOpen: false,
        peopleOpen: false,
        statsOpen: false,
        unreadChat: 0,
        clockTimer: null,
        statsTimer: null,
        leaving: false,
        currentRoomId: "",
        reconnecting: false,
        reconnectDeadline: 0,
        reconnectAttempt: 0,
        reconnectTimer: null,
        heartbeatTimer: null,
        lastPong: 0
    };

    /* ================= Small helpers ================= */

    function $id(id) { return document.getElementById(id); }

    function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    //For values placed inside HTML attributes: escapeHtml does not cover
    //quotes, so escape them explicitly to stay inside the attribute.
    function escapeAttr(text) {
        return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + " B";
        var units = ["KB", "MB", "GB"];
        var v = bytes;
        for (var i = 0; i < units.length; i++) {
            v = v / 1024;
            if (v < 1024 || i === units.length - 1) {
                return v.toFixed(1) + " " + units[i];
            }
        }
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            return;
        }
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    }

    function showLobbyError(msg) {
        var box = $id("lobbyError");
        box.textContent = msg;
        box.style.display = msg ? "block" : "none";
    }

    function setWindowTitle(title) {
        document.title = title;
        if (typeof ao_module_setWindowTitle === "function") {
            try { ao_module_setWindowTitle(title); } catch (e) { }
        }
    }

    function isImageName(name) {
        var idx = name.lastIndexOf(".");
        if (idx < 0) return false;
        return IMAGE_EXTS.indexOf(name.substring(idx + 1).toLowerCase()) >= 0;
    }

    /* ================= Sound effects ================= */
    //Short synthesized chimes via WebAudio: no bundled audio assets needed.
    //The context is created lazily on the first join (a user gesture has
    //happened by then, so autoplay policies allow it).

    var audioCtx = null;

    function playChime(notes) {
        try {
            if (!audioCtx) {
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                audioCtx = new Ctx();
            }
            if (audioCtx.state === "suspended") {
                var resumed = audioCtx.resume();
                if (resumed && resumed.catch) resumed.catch(function () { });
            }
            var t = audioCtx.currentTime;
            notes.forEach(function (note) {
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.value = note.freq;
                gain.gain.setValueAtTime(0.0001, t + note.at);
                gain.gain.linearRampToValueAtTime(0.12, t + note.at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + note.at + note.len);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(t + note.at);
                osc.stop(t + note.at + note.len + 0.05);
            });
        } catch (e) { }
    }

    function playJoinSound() {
        //Ascending two-note chime (C5 -> G5)
        playChime([
            { freq: 523.25, at: 0, len: 0.18 },
            { freq: 783.99, at: 0.13, len: 0.25 }
        ]);
    }

    function playLeaveSound() {
        //Descending two-note chime (E5 -> G4)
        playChime([
            { freq: 659.25, at: 0, len: 0.18 },
            { freq: 392.00, at: 0.13, len: 0.25 }
        ]);
    }

    function playHandSound() {
        //Gentle single note (A5) to flag a raised hand
        playChime([
            { freq: 880.00, at: 0, len: 0.22 }
        ]);
    }

    /* ================= Lobby actions ================= */

    $id("createBtn").addEventListener("click", function () {
        var btn = this;
        btn.classList.add("loading", "disabled");
        showLobbyError("");
        $.post(API.create, {
            title: $id("createTitle").value.trim(),
            password: $id("createPassword").value
        }, function (data) {
            btn.classList.remove("loading", "disabled");
            if (data.error !== undefined) {
                showLobbyError(data.error);
                return;
            }
            enterRoom(data.roomid, $id("createPassword").value);
        }, "json").fail(function () {
            btn.classList.remove("loading", "disabled");
            showLobbyError("Failed to create the meeting. Are you still logged in?");
        });
    });

    $id("joinBtn").addEventListener("click", function () {
        var btn = this;
        var roomid = $id("joinRoomId").value.trim();
        if (roomid === "") {
            showLobbyError("Please enter a meeting ID");
            return;
        }
        var password = $id("joinPassword").value;
        btn.classList.add("loading", "disabled");
        showLobbyError("");
        $.post(API.join, { roomid: roomid, password: password }, function (data) {
            btn.classList.remove("loading", "disabled");
            if (data.error !== undefined) {
                showLobbyError(data.error);
                return;
            }
            enterRoom(data.room.id, password);
        }, "json").fail(function () {
            btn.classList.remove("loading", "disabled");
            showLobbyError("Failed to join the meeting. Are you still logged in?");
        });
    });

    $id("joinRoomId").addEventListener("keyup", function (e) {
        if (e.key === "Enter") $id("joinPassword").focus();
    });
    $id("joinPassword").addEventListener("keyup", function (e) {
        if (e.key === "Enter") $id("joinBtn").click();
    });

    //Allow invite links of the form index.html#123456789
    if (location.hash.length > 1) {
        $id("joinRoomId").value = decodeURIComponent(location.hash.substring(1));
    }

    /* ================= Room setup ================= */

    function enterRoom(roomId, password) {
        state.password = password || "";
        state.leaving = false;

        fetch(API.ice).then(function (r) { return r.json(); }).then(function (cfg) {
            if (cfg && cfg.iceServers && cfg.iceServers.length > 0) {
                state.iceConfig = cfg;
            }
        }).catch(function () { }).then(function () {
            return acquireLocalMedia();
        }).then(function () {
            openSignalingSocket(roomId);
        });
    }

    //Try cam+mic, then mic only, then cam only; joining with no devices at
    //all is still allowed (view-only + chat + screen share).
    function acquireLocalMedia() {
        var constraints = [
            { video: true, audio: true },
            { audio: true },
            { video: true }
        ];
        var attempt = function (idx) {
            if (idx >= constraints.length) return Promise.resolve();
            return navigator.mediaDevices.getUserMedia(constraints[idx]).then(function (stream) {
                state.localStream = stream;
                state.micTrack = stream.getAudioTracks()[0] || null;
                state.camTrack = stream.getVideoTracks()[0] || null;
            }).catch(function () {
                return attempt(idx + 1);
            });
        };
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return Promise.resolve();
        }
        return attempt(0);
    }

    function openSignalingSocket(roomId) {
        state.currentRoomId = roomId;
        var proto = location.protocol === "https:" ? "wss://" : "ws://";
        var url = proto + location.host + API.ws +
            "?roomid=" + encodeURIComponent(roomId) +
            "&password=" + encodeURIComponent(state.password);
        var ws = new WebSocket(url);
        state.ws = ws;

        ws.onmessage = function (evt) {
            var msg;
            try { msg = JSON.parse(evt.data); } catch (e) { return; }
            handleServerMessage(msg);
        };
        ws.onclose = function () {
            stopHeartbeat();
            if (state.leaving) return;
            if (state.connected || state.reconnecting) {
                //Dropped mid-meeting (or a reconnect attempt failed):
                //keep the room alive and retry.
                beginReconnect();
            } else {
                showLobbyError("Could not join: the room may not exist or the password is wrong.");
            }
        };
    }

    function sendFrame(obj) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(obj));
        }
    }

    /* ================= Heartbeat & auto-reconnect ================= */

    function startHeartbeat() {
        stopHeartbeat();
        state.lastPong = Date.now();
        state.heartbeatTimer = setInterval(function () {
            if (Date.now() - state.lastPong > HEARTBEAT_TIMEOUT_MS) {
                //Half-dead socket: force-close so onclose starts reconnecting
                if (state.ws) { try { state.ws.close(); } catch (e) { } }
                return;
            }
            sendFrame({ type: "ping" });
        }, HEARTBEAT_INTERVAL_MS);
    }

    function stopHeartbeat() {
        if (state.heartbeatTimer) {
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
    }

    function showReconnectBanner(show, text) {
        $id("reconnectBanner").style.display = show ? "" : "none";
        if (text) $id("reconnectText").textContent = text;
    }

    function beginReconnect() {
        if (!state.reconnecting) {
            //First drop: open the give-up window and freeze the mesh
            state.reconnecting = true;
            state.connected = false;
            state.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
            state.reconnectAttempt = 0;
            addSystemChat("Connection lost - trying to reconnect...");
        }
        scheduleReconnectAttempt();
    }

    function scheduleReconnectAttempt() {
        if (state.leaving || !state.reconnecting) return;
        if (Date.now() > state.reconnectDeadline) {
            giveUpReconnect("Connection to the meeting was lost and could not be re-established.");
            return;
        }
        state.reconnectAttempt++;
        var delay = Math.min(1000 * Math.pow(2, state.reconnectAttempt - 1), RECONNECT_MAX_DELAY_MS);
        showReconnectBanner(true, "Connection lost - reconnecting (attempt " + state.reconnectAttempt + ")...");
        state.reconnectTimer = setTimeout(tryReconnect, delay);
    }

    function tryReconnect() {
        if (state.leaving || !state.reconnecting) return;
        //Probe the room first: if the meeting ended (or was swept) while we
        //were offline there is nothing to reconnect to.
        fetch(API.info + "?roomid=" + encodeURIComponent(state.currentRoomId)).then(function (r) {
            return r.json();
        }).then(function (info) {
            if (state.leaving || !state.reconnecting) return;
            if (!info || info.exists === false) {
                giveUpReconnect("The meeting is no longer available.");
                return;
            }
            //Refresh the ICE config: built-in TURN credentials are
            //short-lived and may have expired while we were offline.
            fetch(API.ice).then(function (r) { return r.json(); }).then(function (cfg) {
                if (cfg && cfg.iceServers && cfg.iceServers.length > 0) {
                    state.iceConfig = cfg;
                }
            }).catch(function () { }).then(function () {
                if (state.leaving || !state.reconnecting) return;
                openSignalingSocket(state.currentRoomId);
            });
        }).catch(function () {
            //Server unreachable: back off and retry within the window
            scheduleReconnectAttempt();
        });
    }

    function giveUpReconnect(msg) {
        state.reconnecting = false;
        state.leaving = true;
        cleanupRoom();
        showLobbyError(msg);
    }

    /* ================= Server messages ================= */

    function handleServerMessage(msg) {
        switch (msg.type) {
            case "welcome":
                var wasReconnect = state.reconnecting;
                state.reconnecting = false;
                if (state.reconnectTimer) {
                    clearTimeout(state.reconnectTimer);
                    state.reconnectTimer = null;
                }
                showReconnectBanner(false);
                state.connected = true;
                state.myPeerId = msg.peerid;
                state.username = msg.username;
                state.isHost = msg.isHost;
                state.room = msg.room;
                //Peer connections from before a drop are stale; rebuild the
                //mesh from scratch as the fresh peer the server sees us as.
                Object.keys(state.peers).forEach(function (peerId) {
                    removePeer(peerId);
                });
                showRoomUI(wasReconnect);
                (msg.peers || []).forEach(function (peerInfo) {
                    var peer = createPeerRecord(peerInfo);
                    startOfferTo(peer);
                });
                startHeartbeat();
                broadcastState();
                updateParticipantCount();
                if (wasReconnect) {
                    addSystemChat("Reconnected to the meeting");
                } else {
                    playJoinSound();
                }
                break;
            case "pong":
                state.lastPong = Date.now();
                break;
            case "peer-join":
                createPeerRecord(msg.peer);
                addSystemChat(msg.peer.username + " joined the meeting");
                playJoinSound();
                broadcastState(); //let the newcomer learn our mute/cam state
                updateParticipantCount();
                refreshAttendance();
                break;
            case "peer-leave":
                removePeer(msg.peerid);
                addSystemChat(msg.username + (msg.kicked ? " was removed from the meeting" : " left the meeting"));
                playLeaveSound();
                updateParticipantCount();
                refreshAttendance();
                break;
            case "kicked":
                //The host removed us from the meeting. Stop reconnecting and
                //fall back to the lobby with a notice.
                state.leaving = true;
                cleanupRoom();
                showLobbyError("You have been removed from the meeting by the host.");
                break;
            case "signal":
                handleSignal(msg.from, msg.data);
                break;
            case "chat":
                addChatMessage(msg);
                break;
            case "file":
                addFileMessage(msg);
                break;
            case "state":
                updatePeerState(msg);
                break;
            case "attendance":
                renderAttendance(msg.records || []);
                break;
            case "room-closed":
                state.leaving = true;
                cleanupRoom();
                showLobbyError("The meeting has been ended by the host.");
                break;
        }
    }

    /* ================= Peer connections ================= */

    function createPeerRecord(info) {
        if (state.peers[info.peerid]) return state.peers[info.peerid];
        var peer = {
            info: info,
            pc: null,
            stream: new MediaStream(),
            senders: { audio: null, video: null },
            pendingCandidates: [],
            state: { audio: false, video: false, screen: false, hand: false }
        };
        state.peers[info.peerid] = peer;
        addVideoTile(info.peerid, info.username, false);
        return peer;
    }

    function buildPeerConnection(peer) {
        var pc = new RTCPeerConnection(state.iceConfig);
        peer.pc = pc;

        pc.onicecandidate = function (evt) {
            if (evt.candidate) {
                sendFrame({
                    type: "signal",
                    to: peer.info.peerid,
                    data: { kind: "ice", candidate: evt.candidate }
                });
            }
        };
        pc.ontrack = function (evt) {
            peer.stream.addTrack(evt.track);
            attachStreamToTile(peer.info.peerid, peer.stream);
        };
        pc.onconnectionstatechange = function () {
            if (pc.connectionState === "failed") {
                try { pc.restartIce(); } catch (e) { }
            }
        };
        return pc;
    }

    function currentVideoTrack() {
        if (state.sharing && state.screenTrack) return state.screenTrack;
        return state.camTrack;
    }

    //Newcomer side: create both transceivers, attach local tracks, offer.
    function startOfferTo(peer) {
        var pc = buildPeerConnection(peer);
        var audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
        var videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
        peer.senders.audio = audioTx.sender;
        peer.senders.video = videoTx.sender;
        if (state.micTrack) audioTx.sender.replaceTrack(state.micTrack);
        if (currentVideoTrack()) videoTx.sender.replaceTrack(currentVideoTrack());

        pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer);
        }).then(function () {
            sendFrame({
                type: "signal",
                to: peer.info.peerid,
                data: { kind: "offer", sdp: pc.localDescription }
            });
        }).catch(function () { });
    }

    //Existing-member side: answer the newcomer's offer, reusing the
    //transceivers created by setRemoteDescription.
    function handleOffer(peer, sdp) {
        var pc = peer.pc || buildPeerConnection(peer);
        pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
            pc.getTransceivers().forEach(function (tx) {
                var kind = tx.receiver && tx.receiver.track ? tx.receiver.track.kind : "";
                tx.direction = "sendrecv";
                if (kind === "audio") {
                    peer.senders.audio = tx.sender;
                    if (state.micTrack) tx.sender.replaceTrack(state.micTrack);
                } else if (kind === "video") {
                    peer.senders.video = tx.sender;
                    if (currentVideoTrack()) tx.sender.replaceTrack(currentVideoTrack());
                }
            });
            return pc.createAnswer();
        }).then(function (answer) {
            return pc.setLocalDescription(answer);
        }).then(function () {
            sendFrame({
                type: "signal",
                to: peer.info.peerid,
                data: { kind: "answer", sdp: pc.localDescription }
            });
            drainCandidates(peer);
        }).catch(function () { });
    }

    function handleSignal(fromPeerId, data) {
        if (!data || !data.kind) return;
        var peer = state.peers[fromPeerId];
        if (!peer) {
            //Offer can arrive before the peer-join broadcast is processed
            peer = createPeerRecord({ peerid: fromPeerId, username: "Guest", isHost: false });
        }
        if (data.kind === "offer") {
            handleOffer(peer, data.sdp);
        } else if (data.kind === "answer") {
            if (peer.pc) {
                peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
                    drainCandidates(peer);
                }).catch(function () { });
            }
        } else if (data.kind === "ice") {
            if (peer.pc && peer.pc.remoteDescription) {
                peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function () { });
            } else {
                peer.pendingCandidates.push(data.candidate);
            }
        }
    }

    function drainCandidates(peer) {
        var queued = peer.pendingCandidates;
        peer.pendingCandidates = [];
        queued.forEach(function (candidate) {
            peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function () { });
        });
    }

    function removePeer(peerId) {
        var peer = state.peers[peerId];
        if (!peer) return;
        if (peer.pc) {
            try { peer.pc.close(); } catch (e) { }
        }
        delete state.peers[peerId];
        delete state.handAt[peerId];
        var tile = $id("tile-" + peerId);
        if (tile) tile.remove();
    }

    /* ================= Video tiles ================= */

    function addVideoTile(peerId, username, isLocal) {
        if ($id("tile-" + peerId)) return;
        var tile = document.createElement("div");
        tile.className = "video-tile no-video";
        tile.id = "tile-" + peerId;
        tile.innerHTML =
            '<video autoplay playsinline ' + (isLocal ? "muted" : "") + '></video>' +
            '<div class="tile-avatar">' + escapeHtml(username.substring(0, 1)) + '</div>' +
            '<div class="sharing-badge"><i class="desktop icon"></i> Sharing screen</div>' +
            '<div class="hand-badge" title="Hand raised"><i class="hand paper icon"></i></div>' +
            '<div class="tile-label">' +
            '<i class="microphone slash icon muted-icon" style="display:none;"></i>' +
            '<span class="label-name">' + escapeHtml(username) + (isLocal ? " (You)" : "") + '</span>' +
            '</div>';
        $id("videoGrid").appendChild(tile);
    }

    function attachStreamToTile(peerId, stream) {
        var tile = $id("tile-" + peerId);
        if (!tile) return;
        var video = tile.querySelector("video");
        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }
        var p = video.play();
        if (p && p.catch) p.catch(function () { });
    }

    function setTileState(peerId, audioOn, videoOn, screenOn, handUp) {
        var tile = $id("tile-" + peerId);
        if (!tile) return;
        tile.classList.toggle("no-video", !videoOn);
        tile.classList.toggle("is-sharing", !!screenOn);
        tile.classList.toggle("hand-raised", !!handUp);
        tile.querySelector(".muted-icon").style.display = audioOn ? "none" : "";
    }

    function updatePeerState(msg) {
        var peer = state.peers[msg.from];
        if (!peer) return;
        var wasHandUp = peer.state.hand;
        //The first state frame from a peer is an initial sync (peers re-send
        //their state when anyone joins), so don't treat a hand already up as a
        //fresh raise - just reflect it on the tile.
        var firstSync = !peer.stateSynced;
        peer.stateSynced = true;
        peer.state = { audio: msg.audio, video: msg.video, screen: msg.screen, hand: !!msg.hand };
        setTileState(msg.from, msg.audio, msg.video, msg.screen, msg.hand);
        //Maintain the raise-hand queue order: stamp the first time we see a
        //hand up, clear it when lowered.
        if (msg.hand && !wasHandUp) {
            state.handAt[msg.from] = Date.now();
        } else if (!msg.hand) {
            delete state.handAt[msg.from];
        }
        if (msg.hand && !wasHandUp && !firstSync) {
            addSystemChat(peer.info.username + " raised their hand");
            playHandSound();
        }
        if (state.peopleOpen) refreshAttendance();
    }

    function updateParticipantCount() {
        $id("participantCount").textContent = String(Object.keys(state.peers).length + 1);
    }

    /* ================= Clock & meeting timer ================= */

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    //Render a second count as H:MM:SS, dropping the hours until they matter.
    function formatDuration(totalSeconds) {
        if (totalSeconds < 0) totalSeconds = 0;
        var h = Math.floor(totalSeconds / 3600);
        var m = Math.floor((totalSeconds % 3600) / 60);
        var s = totalSeconds % 60;
        return (h > 0 ? h + ":" + pad2(m) : pad2(m)) + ":" + pad2(s);
    }

    function tickClock() {
        var now = new Date();
        $id("systemClock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (state.room && state.room.createdat) {
            var elapsed = Math.floor(Date.now() / 1000) - state.room.createdat;
            $id("meetingElapsed").textContent = formatDuration(elapsed);
        }
    }

    function startClock() {
        stopClock();
        tickClock();
        state.clockTimer = setInterval(tickClock, 1000);
    }

    function stopClock() {
        if (state.clockTimer) {
            clearInterval(state.clockTimer);
            state.clockTimer = null;
        }
    }

    /* ================= Room UI ================= */

    function showRoomUI(isReconnect) {
        $id("lobby").style.display = "none";
        $id("room").style.display = "flex";
        $id("roomTitle").textContent = state.room.title;
        $id("roomIdText").textContent = state.room.displayid;
        $id("endBtn").style.display = state.isHost ? "" : "none";
        setWindowTitle("MeetRoom - " + state.room.title);

        //Local tile
        addVideoTile("local", state.username, true);
        if (state.localStream && !state.sharing) {
            attachStreamToTile("local", state.localStream);
        }
        if (!isReconnect) {
            //Keep the user's mute / camera choices across a reconnect
            state.micOn = !!state.micTrack;
            state.camOn = !!state.camTrack;
        }
        if (!state.micTrack) $id("micBtn").disabled = true;
        if (!state.camTrack) $id("camBtn").disabled = true;
        refreshControlButtons();
        refreshLocalTile();
        startClock();
        if (!isReconnect) {
            addSystemChat("You joined the meeting as " + state.username);
        }
    }

    function refreshLocalTile() {
        var videoOn = (state.camOn && !!state.camTrack) || state.sharing;
        setTileState("local", state.micOn && !!state.micTrack, videoOn, state.sharing, state.handRaised);
    }

    function refreshControlButtons() {
        var micBtn = $id("micBtn");
        micBtn.classList.toggle("ctrl-off", !(state.micOn && state.micTrack));
        micBtn.querySelector("i").className = (state.micOn && state.micTrack) ? "microphone icon" : "microphone slash icon";
        micBtn.querySelector("span").textContent = (state.micOn && state.micTrack) ? "Mute" : "Unmute";

        var camBtn = $id("camBtn");
        camBtn.classList.toggle("ctrl-off", !(state.camOn && state.camTrack));
        camBtn.querySelector("i").className = (state.camOn && state.camTrack) ? "video icon" : "video slash icon";

        var shareBtn = $id("shareBtn");
        shareBtn.classList.toggle("ctrl-active", state.sharing);
        shareBtn.querySelector("span").textContent = state.sharing ? "Stop" : "Share";

        var handBtn = $id("handBtn");
        handBtn.classList.toggle("ctrl-active", state.handRaised);
        handBtn.querySelector("i").className = state.handRaised ? "hand paper icon" : "hand paper outline icon";
        handBtn.querySelector("span").textContent = state.handRaised ? "Lower" : "Raise";
    }

    function broadcastState() {
        sendFrame({
            type: "state",
            audio: state.micOn && !!state.micTrack,
            video: (state.camOn && !!state.camTrack) || state.sharing,
            screen: state.sharing,
            hand: state.handRaised
        });
    }

    /* ================= Controls ================= */

    $id("micBtn").addEventListener("click", function () {
        if (!state.micTrack) return;
        state.micOn = !state.micOn;
        state.micTrack.enabled = state.micOn;
        refreshControlButtons();
        refreshLocalTile();
        broadcastState();
    });

    $id("camBtn").addEventListener("click", function () {
        if (!state.camTrack) return;
        state.camOn = !state.camOn;
        state.camTrack.enabled = state.camOn;
        refreshControlButtons();
        refreshLocalTile();
        broadcastState();
    });

    $id("shareBtn").addEventListener("click", function () {
        if (state.sharing) {
            stopScreenShare();
        } else {
            startScreenShare();
        }
    });

    $id("handBtn").addEventListener("click", function () {
        state.handRaised = !state.handRaised;
        if (state.handRaised) {
            state.handAt[state.myPeerId] = Date.now();
        } else {
            delete state.handAt[state.myPeerId];
        }
        refreshControlButtons();
        refreshLocalTile();
        broadcastState();
        if (state.peopleOpen) refreshAttendance();
        addSystemChat(state.handRaised ? "You raised your hand" : "You lowered your hand");
        if (state.handRaised) playHandSound();
    });

    function replaceOutgoingVideoTrack(track) {
        Object.keys(state.peers).forEach(function (peerId) {
            var peer = state.peers[peerId];
            if (peer.senders.video) {
                peer.senders.video.replaceTrack(track).catch(function () { });
            }
        });
    }

    function startScreenShare() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            addSystemChat("Screen sharing is not supported by this browser");
            return;
        }
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
            state.screenStream = stream;
            state.screenTrack = stream.getVideoTracks()[0];
            state.sharing = true;
            state.screenTrack.onended = function () {
                if (state.sharing) stopScreenShare();
            };
            replaceOutgoingVideoTrack(state.screenTrack);
            //Preview the shared screen locally
            var preview = new MediaStream([state.screenTrack]);
            if (state.micTrack) preview.addTrack(state.micTrack);
            attachStreamToTile("local", preview);
            refreshControlButtons();
            refreshLocalTile();
            broadcastState();
        }).catch(function () { });
    }

    function stopScreenShare() {
        state.sharing = false;
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(function (t) { t.stop(); });
        }
        state.screenStream = null;
        state.screenTrack = null;
        replaceOutgoingVideoTrack(state.camOn ? state.camTrack : null);
        if (state.localStream) {
            attachStreamToTile("local", state.localStream);
        }
        refreshControlButtons();
        refreshLocalTile();
        broadcastState();
    }

    /* ================= Invite dialog ================= */

    //Build a shareable link to this meeting. The lobby reads the room ID from
    //the URL hash on load (NormalizeRoomID strips the dashes), so the display
    //ID is fine to embed.
    function inviteLink() {
        return location.origin + location.pathname + "#" + state.room.displayid;
    }

    //Assemble the full invitation text, folding in the host's optional message.
    function buildInviteText() {
        var message = $id("inviteMessage").value.trim();
        var lines = [];
        if (message !== "") {
            lines.push(message, "");
        }
        lines.push("You're invited to a MeetRoom meeting" + (state.room.title ? ": " + state.room.title : ""));
        lines.push("Meeting ID: " + state.room.displayid);
        lines.push("Link: " + inviteLink());
        if (state.room.protected) {
            lines.push("(This meeting is password protected - the password will be shared separately.)");
        }
        return lines.join("\n");
    }

    function openInviteModal() {
        $id("inviteTitle").textContent = state.room.title || "Untitled meeting";
        $id("inviteId").textContent = state.room.displayid;
        $id("inviteLink").value = inviteLink();
        $id("invitePasswordNote").style.display = state.room.protected ? "" : "none";
        $id("inviteModal").style.display = "flex";
    }

    function closeInviteModal() {
        $id("inviteModal").style.display = "none";
    }

    //Flash a check mark on a copy button so the user sees the copy took
    function flashCopied(btn) {
        var icon = btn.querySelector("i");
        if (!icon || btn.dataset.flashing === "1") return;
        var original = icon.className;
        btn.dataset.flashing = "1";
        icon.className = "check icon";
        setTimeout(function () {
            icon.className = original;
            btn.dataset.flashing = "0";
        }, 1200);
    }

    $id("inviteBtn").addEventListener("click", openInviteModal);
    $id("inviteCloseBtn").addEventListener("click", closeInviteModal);
    $id("inviteModal").addEventListener("click", function (e) {
        //Click on the dimmed backdrop (not the card) closes the dialog
        if (e.target === this) closeInviteModal();
    });

    Array.prototype.forEach.call(document.querySelectorAll(".invite-copy-btn"), function (btn) {
        btn.addEventListener("click", function () {
            copyText(btn.dataset.copy === "link" ? inviteLink() : state.room.displayid);
            flashCopied(btn);
        });
    });

    $id("inviteCopyAllBtn").addEventListener("click", function () {
        copyText(buildInviteText());
        flashCopied(this);
        addSystemChat("Invitation copied to clipboard");
    });

    $id("roomIdTag").addEventListener("click", function () {
        copyText(state.room.displayid);
        addSystemChat("Meeting ID copied to clipboard");
    });

    $id("leaveBtn").addEventListener("click", function () {
        state.leaving = true;
        playLeaveSound();
        cleanupRoom();
        showLobbyError("");
    });

    $id("endBtn").addEventListener("click", function () {
        if (!confirm("End the meeting for all participants?")) return;
        sendFrame({ type: "end" });
        state.leaving = true;
        playLeaveSound();
        cleanupRoom();
        showLobbyError("");
    });

    window.addEventListener("beforeunload", function () {
        state.leaving = true;
        if (state.ws) { try { state.ws.close(); } catch (e) { } }
    });

    /* ================= Chat ================= */

    function toggleChat(open) {
        state.chatOpen = open;
        $id("chatPanel").style.display = open ? "flex" : "none";
        if (open) {
            if (state.peopleOpen) togglePeople(false);
            hideMessageToast();
            state.unreadChat = 0;
            $id("chatBadge").style.display = "none";
            $id("chatText").focus();
            scrollChat();
        }
    }

    $id("chatBtn").addEventListener("click", function () { toggleChat(!state.chatOpen); });
    $id("chatCloseBtn").addEventListener("click", function () { toggleChat(false); });

    /* ================= Participants & attendance ================= */

    function togglePeople(open) {
        state.peopleOpen = open;
        $id("peoplePanel").style.display = open ? "flex" : "none";
        if (open) {
            if (state.chatOpen) toggleChat(false);
            refreshAttendance();
        }
    }

    $id("peopleBtn").addEventListener("click", function () { togglePeople(!state.peopleOpen); });
    $id("peopleCloseBtn").addEventListener("click", function () { togglePeople(false); });

    //Host action: kick a participant. The list is re-rendered often, so the
    //click is handled by delegation on the stable container.
    $id("attendanceList").addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest(".kick-btn") : null;
        if (!btn) return;
        var peerId = parseInt(btn.dataset.peerid, 10);
        var name = btn.dataset.name || "this participant";
        if (isNaN(peerId)) return;
        if (!confirm("Remove " + name + " from the meeting?")) return;
        sendFrame({ type: "kick", to: peerId });
    });

    //Ask the server for the join/leave log; the reply arrives as an
    //"attendance" frame and lands in renderAttendance()
    function refreshAttendance() {
        if (!state.peopleOpen) return;
        sendFrame({ type: "attendance" });
    }

    function attendanceTime(unixTime) {
        return new Date(unixTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    //Is the participant behind this present attendance record raising a hand?
    function recordHandRaised(record) {
        if (!record.present) return false;
        if (record.peerid === state.myPeerId) return state.handRaised;
        var peer = state.peers[record.peerid];
        return !!(peer && peer.state && peer.state.hand);
    }

    function attendanceEntry(record) {
        var entry = document.createElement("div");
        entry.className = "attendance-entry" + (record.present ? " present" : "");
        var times = record.present
            ? "joined " + attendanceTime(record.joinedat)
            : attendanceTime(record.joinedat) + " - " + attendanceTime(record.leftat);
        var isHostRecord = state.room && record.username === state.room.host;
        var handUp = recordHandRaised(record);
        //The host can remove any present participant other than themselves
        var canKick = state.isHost && record.present && !isHostRecord && record.peerid !== state.myPeerId;
        entry.innerHTML =
            '<i class="' + (record.present ? "user icon" : "sign-out icon") + '"></i>' +
            '<span class="attendee-name">' + escapeHtml(record.username) + '</span>' +
            (isHostRecord ? '<span class="host-tag">Host</span>' : "") +
            (handUp ? '<i class="hand paper icon hand-indicator" title="Hand raised"></i>' : "") +
            '<span class="attendee-times">' + escapeHtml(times) + '</span>' +
            (canKick
                ? '<button class="kick-btn" data-peerid="' + record.peerid + '" data-name="' + escapeAttr(record.username) + '" title="Remove from meeting"><i class="user times icon"></i></button>'
                : "");
        return entry;
    }

    //Build the raise-hand queue: everyone currently present with a hand up,
    //ordered by when they raised it (earliest first).
    function raisedHandQueue(present) {
        return present.filter(recordHandRaised).sort(function (a, b) {
            return (state.handAt[a.peerid] || 0) - (state.handAt[b.peerid] || 0);
        });
    }

    function handQueueEntry(record, position) {
        var entry = document.createElement("div");
        entry.className = "hand-queue-entry";
        var isSelf = record.peerid === state.myPeerId;
        entry.innerHTML =
            '<span class="hand-queue-pos">' + position + '</span>' +
            '<i class="hand paper icon hand-indicator"></i>' +
            '<span class="attendee-name">' + escapeHtml(record.username) + (isSelf ? " (You)" : "") + '</span>';
        return entry;
    }

    function renderAttendance(records) {
        var box = $id("attendanceList");
        box.innerHTML = "";
        var present = records.filter(function (r) { return r.present; });
        var past = records.filter(function (r) { return !r.present; });

        //Raised-hand queue first, so the speaking order is front and centre
        var raised = raisedHandQueue(present);
        if (raised.length > 0) {
            var groupHands = document.createElement("div");
            groupHands.className = "attendance-group";
            groupHands.textContent = "Raised hands (" + raised.length + ")";
            box.appendChild(groupHands);
            raised.forEach(function (record, i) { box.appendChild(handQueueEntry(record, i + 1)); });
        }

        var groupPresent = document.createElement("div");
        groupPresent.className = "attendance-group";
        groupPresent.textContent = "In meeting (" + present.length + ")";
        box.appendChild(groupPresent);
        present.forEach(function (record) { box.appendChild(attendanceEntry(record)); });

        if (past.length > 0) {
            var groupPast = document.createElement("div");
            groupPast.className = "attendance-group";
            groupPast.textContent = "Left the meeting (" + past.length + ")";
            box.appendChild(groupPast);
            past.forEach(function (record) { box.appendChild(attendanceEntry(record)); });
        }
    }

    /* ================= Connection performance ================= */

    function toggleStats(open) {
        state.statsOpen = open;
        $id("statsBtn").classList.toggle("ctrl-active", open);
        $id("statsPanel").style.display = open ? "flex" : "none";
        if (open) {
            startStatsPolling();
        } else {
            stopStatsPolling();
        }
    }

    $id("statsBtn").addEventListener("click", function () { toggleStats(!state.statsOpen); });
    $id("statsCloseBtn").addEventListener("click", function () { toggleStats(false); });

    //Let the user drag the floating stats window around the meeting. Uses
    //pointer events so it works with both mouse and touch; the header keeps
    //the pointer capture so dragging continues even if it briefly leaves it.
    (function makeStatsDraggable() {
        var panel = $id("statsPanel");
        var handle = $id("statsHeader");
        var dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

        handle.addEventListener("pointerdown", function (e) {
            if (e.target.closest && e.target.closest(".stats-close")) return;
            var parent = panel.offsetParent || panel.parentElement;
            var rect = panel.getBoundingClientRect();
            var pr = parent.getBoundingClientRect();
            startLeft = rect.left - pr.left;
            startTop = rect.top - pr.top;
            startX = e.clientX;
            startY = e.clientY;
            //Switch from the CSS right-anchor to explicit left/top so drags move it
            panel.style.left = startLeft + "px";
            panel.style.top = startTop + "px";
            panel.style.right = "auto";
            dragging = true;
            try { handle.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();
        });
        handle.addEventListener("pointermove", function (e) {
            if (!dragging) return;
            var parent = panel.offsetParent || panel.parentElement;
            var maxL = Math.max(0, parent.clientWidth - panel.offsetWidth);
            var maxT = Math.max(0, parent.clientHeight - panel.offsetHeight);
            panel.style.left = Math.max(0, Math.min(startLeft + (e.clientX - startX), maxL)) + "px";
            panel.style.top = Math.max(0, Math.min(startTop + (e.clientY - startY), maxT)) + "px";
        });
        var endDrag = function (e) {
            if (!dragging) return;
            dragging = false;
            try { handle.releasePointerCapture(e.pointerId); } catch (err) { }
        };
        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);
    })();

    function startStatsPolling() {
        stopStatsPolling();
        collectAndRenderStats();
        state.statsTimer = setInterval(collectAndRenderStats, 2000);
    }

    function stopStatsPolling() {
        if (state.statsTimer) {
            clearInterval(state.statsTimer);
            state.statsTimer = null;
        }
    }

    function formatBitrate(kbps) {
        if (kbps >= 1000) return (kbps / 1000).toFixed(1) + " Mbps";
        return kbps + " kbps";
    }

    //Reduce a peer connection's raw getStats() report to the handful of
    //numbers worth showing, turning cumulative byte counters into a live
    //bitrate by diffing against the previous sample.
    function summarizePeerStats(peer, report) {
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        var bytesRecv = 0, bytesSent = 0, packetsRecv = 0, packetsLost = 0, rttMs = null;
        report.forEach(function (r) {
            if (r.type === "inbound-rtp" && !r.isRemote) {
                bytesRecv += r.bytesReceived || 0;
                packetsRecv += r.packetsReceived || 0;
                packetsLost += r.packetsLost || 0;
            } else if (r.type === "outbound-rtp" && !r.isRemote) {
                bytesSent += r.bytesSent || 0;
            } else if (r.type === "candidate-pair" && (r.nominated || r.state === "succeeded") &&
                typeof r.currentRoundTripTime === "number") {
                rttMs = Math.round(r.currentRoundTripTime * 1000);
            }
        });

        var last = peer._lastStats;
        var recvKbps = 0, sentKbps = 0;
        if (last && now > last.t) {
            var dt = (now - last.t) / 1000;
            recvKbps = Math.max(0, Math.round((bytesRecv - last.bytesRecv) * 8 / 1000 / dt));
            sentKbps = Math.max(0, Math.round((bytesSent - last.bytesSent) * 8 / 1000 / dt));
        }
        peer._lastStats = { t: now, bytesRecv: bytesRecv, bytesSent: bytesSent };

        var totalPackets = packetsRecv + packetsLost;
        return {
            username: peer.info.username,
            recvKbps: recvKbps,
            sentKbps: sentKbps,
            rttMs: rttMs,
            lossPct: totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0
        };
    }

    function collectAndRenderStats() {
        if (!state.statsOpen) return;
        var peerIds = Object.keys(state.peers);
        var promises = peerIds.map(function (peerId) {
            var peer = state.peers[peerId];
            if (!peer.pc || !peer.pc.getStats) return Promise.resolve(null);
            return peer.pc.getStats().then(function (report) {
                return summarizePeerStats(peer, report);
            }).catch(function () { return null; });
        });
        Promise.all(promises).then(function (results) {
            renderStats(results.filter(function (r) { return r; }));
        });
    }

    //Classify a link by round-trip time and loss so a colour can flag it
    function linkQuality(s) {
        if (s.rttMs === null) return "";
        if (s.rttMs < 150 && s.lossPct < 2) return "good";
        if (s.rttMs < 300 && s.lossPct < 5) return "fair";
        return "poor";
    }

    function renderStats(list) {
        var box = $id("statsBody");
        if (!state.connected) {
            box.innerHTML = '<div class="stats-empty">Not connected.</div>';
            return;
        }
        if (list.length === 0) {
            box.innerHTML = '<div class="stats-empty">No peer connections yet - stats appear once someone else joins.</div>';
            return;
        }
        var totalRecv = 0, totalSent = 0;
        list.forEach(function (s) { totalRecv += s.recvKbps; totalSent += s.sentKbps; });

        var html = '<div class="stats-summary">' +
            '<div class="stats-summary-item"><i class="download icon"></i><strong>' + formatBitrate(totalRecv) + '</strong><span>received</span></div>' +
            '<div class="stats-summary-item"><i class="upload icon"></i><strong>' + formatBitrate(totalSent) + '</strong><span>sent</span></div>' +
            '</div>';

        list.forEach(function (s) {
            var quality = linkQuality(s);
            html += '<div class="stats-peer">' +
                '<div class="stats-peer-name">' + escapeHtml(s.username) +
                (quality ? '<span class="stats-quality ' + quality + '">' + quality + '</span>' : "") +
                '</div>' +
                '<div class="stats-peer-metrics">' +
                '<span title="Receiving from this peer"><i class="download icon"></i>' + formatBitrate(s.recvKbps) + '</span>' +
                '<span title="Sending to this peer"><i class="upload icon"></i>' + formatBitrate(s.sentKbps) + '</span>' +
                '<span title="Round-trip time"><i class="stopwatch icon"></i>' + (s.rttMs === null ? "-" : s.rttMs + " ms") + '</span>' +
                '<span title="Packet loss"><i class="exclamation triangle icon"></i>' + s.lossPct.toFixed(1) + '%</span>' +
                '</div>' +
                '</div>';
        });
        box.innerHTML = html;
    }

    /* ================= New message popup ================= */

    var toastTimer = null;

    function showMessageToast(title, body) {
        if (state.chatOpen) return; //already reading the chat
        var toast = $id("msgToast");
        toast.querySelector(".toast-title span").textContent = title;
        toast.querySelector(".toast-body").textContent = body;
        toast.style.display = "block";
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(hideMessageToast, 6000);
    }

    function hideMessageToast() {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
        $id("msgToast").style.display = "none";
    }

    $id("msgToast").addEventListener("click", function () {
        hideMessageToast();
        toggleChat(true);
    });

    function sendChat() {
        var input = $id("chatText");
        var text = input.value.trim();
        if (text === "") return;
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            //Keep the draft in the input so nothing is lost mid-reconnect
            addSystemChat("Reconnecting - message not sent, please retry in a moment");
            return;
        }
        sendFrame({ type: "chat", text: text });
        input.value = "";
    }

    $id("chatSendBtn").addEventListener("click", sendChat);
    $id("chatText").addEventListener("keyup", function (e) {
        if (e.key === "Enter") sendChat();
    });

    function bumpUnread() {
        if (state.chatOpen) return;
        state.unreadChat++;
        var badge = $id("chatBadge");
        badge.textContent = state.unreadChat > 9 ? "9+" : String(state.unreadChat);
        badge.style.display = "";
    }

    function appendChatNode(node) {
        $id("chatMessages").appendChild(node);
        scrollChat();
    }

    function scrollChat() {
        var box = $id("chatMessages");
        box.scrollTop = box.scrollHeight;
    }

    function chatTimestamp(unixTime) {
        var d = unixTime ? new Date(unixTime * 1000) : new Date();
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function addChatMessage(msg) {
        var own = msg.from === state.myPeerId;
        var node = document.createElement("div");
        node.className = "chat-msg" + (own ? " own" : "");
        node.innerHTML =
            '<div class="msg-meta">' + escapeHtml(msg.username) + " - " + chatTimestamp(msg.time) + '</div>' +
            '<div class="msg-body">' + escapeHtml(msg.text) + '</div>';
        appendChatNode(node);
        if (!own) {
            bumpUnread();
            showMessageToast(msg.username, msg.text);
        }
    }

    function addFileMessage(msg) {
        var own = msg.from === state.myPeerId;
        var href = API.download +
            "?roomid=" + encodeURIComponent(state.room.id) +
            "&password=" + encodeURIComponent(state.password) +
            "&fileid=" + encodeURIComponent(msg.fileid);
        var node = document.createElement("div");
        node.className = "chat-msg" + (own ? " own" : "");

        //Images render inline so nobody has to download them; clicking the
        //preview opens the full-size image in a new tab (inline=1 keeps the
        //browser from forcing a download). Everything else stays a link.
        var body;
        if (isImageName(msg.name)) {
            var inlineHref = href + "&inline=1";
            body =
                '<a target="_blank" rel="noopener" href="' + inlineHref + '" title="Open full size">' +
                '<img class="chat-image" src="' + inlineHref + '" alt="' + escapeAttr(msg.name) + '">' +
                '</a>' +
                '<a class="file-link" href="' + href + '" download>' +
                '<i class="download icon"></i>' + escapeHtml(msg.name) +
                '</a> <span class="file-size">(' + formatBytes(msg.size) + ')</span>';
        } else {
            body =
                '<a class="file-link" target="_blank" rel="noopener" href="' + href + '" download>' +
                '<i class="file outline icon"></i>' + escapeHtml(msg.name) +
                '</a> <span class="file-size">(' + formatBytes(msg.size) + ')</span>';
        }
        node.innerHTML =
            '<div class="msg-meta">' + escapeHtml(msg.username) + " - " + chatTimestamp(msg.time) + '</div>' +
            '<div class="msg-body">' + body + '</div>';
        appendChatNode(node);
        var preview = node.querySelector(".chat-image");
        if (preview) {
            //Keep the newest message visible once the preview finishes loading
            preview.addEventListener("load", scrollChat);
        }
        if (!own) {
            bumpUnread();
            showMessageToast(msg.username, "Shared " + (isImageName(msg.name) ? "an image: " : "a file: ") + msg.name);
        }
    }

    function addSystemChat(text) {
        var node = document.createElement("div");
        node.className = "chat-msg system";
        node.innerHTML = '<div class="msg-body">' + escapeHtml(text) + '</div>';
        appendChatNode(node);
    }

    /* ================= Attachments ================= */

    function toggleAttachMenu(open) {
        $id("attachMenu").style.display = open ? "block" : "none";
    }

    //The attach button opens a small menu: upload a local file, or pick a
    //file the user already has in their ArozOS storage.
    $id("attachBtn").addEventListener("click", function (e) {
        e.stopPropagation();
        toggleAttachMenu($id("attachMenu").style.display === "none");
    });

    //Any click elsewhere dismisses the menu
    document.addEventListener("click", function () { toggleAttachMenu(false); });
    $id("attachMenu").addEventListener("click", function (e) { e.stopPropagation(); });

    $id("attachDeviceBtn").addEventListener("click", function () {
        toggleAttachMenu(false);
        $id("attachInput").click();
    });

    $id("attachArozosBtn").addEventListener("click", function () {
        toggleAttachMenu(false);
        if (typeof ao_module_openFileSelector !== "function") {
            addSystemChat("ArozOS file picker is only available inside the ArozOS desktop");
            return;
        }
        //ao_module_openFileSelector needs a window-scoped callback name; the
        //selector hands back an array of {filepath, filename}.
        ao_module_openFileSelector("meetroomArozFilesSelected", "user:/", "file", true);
    });

    //Called back by the ArozOS file selector (must live on window)
    window.meetroomArozFilesSelected = function (files) {
        if (!files || files.length === 0) return;
        Array.prototype.forEach.call(files, function (f) {
            attachArozosPath(f.filepath, f.filename);
        });
    };

    //Stream a file that already lives in the user's ArozOS storage into the
    //room without downloading it to the browser first: the server reads it
    //straight from the user's file system (see /system/meetroom/attachfile).
    function attachArozosPath(vpath, displayName) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            addSystemChat("Reconnecting - please try sharing the file again in a moment");
            return;
        }
        var name = displayName || vpath.split("/").pop();
        var form = new FormData();
        form.append("roomid", state.room.id);
        form.append("password", state.password);
        form.append("path", vpath);

        $id("uploadStatus").style.display = "";
        $id("uploadStatusText").textContent = "Sharing " + name + "...";

        fetch(API.attachfile, { method: "POST", body: form }).then(function (r) {
            return r.json();
        }).then(function (data) {
            $id("uploadStatus").style.display = "none";
            if (data.error !== undefined) {
                addSystemChat("Could not share " + name + ": " + data.error);
                return;
            }
            sendFrame({ type: "file", fileid: data.fileid });
        }).catch(function () {
            $id("uploadStatus").style.display = "none";
            addSystemChat("Could not share " + name);
        });
    }

    //Upload a file (or pasted image blob) and announce it to the room
    function uploadAndAnnounce(file, displayName) {
        if (!file) return;
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            addSystemChat("Reconnecting - please try sharing the file again in a moment");
            return;
        }
        var name = displayName || file.name;

        var form = new FormData();
        form.append("roomid", state.room.id);
        form.append("password", state.password);
        form.append("file", file, name);

        $id("uploadStatus").style.display = "";
        $id("uploadStatusText").textContent = "Uploading " + name + "...";

        fetch(API.upload, { method: "POST", body: form }).then(function (r) {
            return r.json();
        }).then(function (data) {
            $id("uploadStatus").style.display = "none";
            if (data.error !== undefined) {
                addSystemChat("Upload failed: " + data.error);
                return;
            }
            sendFrame({ type: "file", fileid: data.fileid });
        }).catch(function () {
            $id("uploadStatus").style.display = "none";
            addSystemChat("Upload failed");
        });
    }

    $id("attachInput").addEventListener("change", function () {
        var file = this.files[0];
        this.value = "";
        uploadAndAnnounce(file);
    });

    //Ctrl+V in the meeting attaches a copied image (screenshot, copied
    //picture, ...) to the chat
    document.addEventListener("paste", function (e) {
        if (!state.connected) return;
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind !== "file" || items[i].type.indexOf("image/") !== 0) continue;
            var blob = items[i].getAsFile();
            if (!blob) continue;
            e.preventDefault();
            if (!state.chatOpen) toggleChat(true);
            var ext = (items[i].type.split("/")[1] || "png").split("+")[0];
            uploadAndAnnounce(blob, "pasted-image-" + Date.now() + "." + ext);
            return;
        }
    });

    /* ================= Teardown ================= */

    function cleanupRoom() {
        stopHeartbeat();
        stopClock();
        stopStatsPolling();
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
        state.reconnecting = false;
        state.currentRoomId = "";
        showReconnectBanner(false);
        if (state.ws) {
            var ws = state.ws;
            state.ws = null;
            try { ws.onclose = null; ws.close(); } catch (e) { }
        }
        Object.keys(state.peers).forEach(function (peerId) {
            removePeer(peerId);
        });
        if (state.localStream) {
            state.localStream.getTracks().forEach(function (t) { t.stop(); });
        }
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(function (t) { t.stop(); });
        }
        state.localStream = null;
        state.camTrack = null;
        state.micTrack = null;
        state.screenStream = null;
        state.screenTrack = null;
        state.sharing = false;
        state.handRaised = false;
        state.handAt = {};
        state.connected = false;
        state.myPeerId = -1;
        state.room = null;
        state.password = "";
        state.unreadChat = 0;

        $id("videoGrid").innerHTML = "";
        $id("chatMessages").innerHTML = "";
        $id("attendanceList").innerHTML = "";
        $id("chatBadge").style.display = "none";
        $id("micBtn").disabled = false;
        $id("camBtn").disabled = false;
        hideMessageToast();
        toggleChat(false);
        togglePeople(false);
        toggleStats(false);
        //Return the floating stats window to its default corner for next time
        var sp = $id("statsPanel");
        sp.style.left = "";
        sp.style.top = "";
        sp.style.right = "";
        closeInviteModal();
        toggleAttachMenu(false);
        $id("room").style.display = "none";
        $id("lobby").style.display = "flex";
        setWindowTitle("MeetRoom");
    }

})();
