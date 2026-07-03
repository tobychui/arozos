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
*/

(function () {
    "use strict";

    var API = {
        create: "/system/meetroom/create",
        join: "/system/meetroom/join",
        end: "/system/meetroom/end",
        ice: "/system/meetroom/iceservers",
        upload: "/system/meetroom/upload",
        download: "/system/meetroom/download",
        ws: "/system/meetroom/ws"
    };

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
        chatOpen: false,
        unreadChat: 0,
        leaving: false
    };

    /* ================= Small helpers ================= */

    function $id(id) { return document.getElementById(id); }

    function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
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
            if (state.connected && !state.leaving) {
                cleanupRoom();
                showLobbyError("Connection to the meeting was lost.");
            } else if (!state.connected) {
                showLobbyError("Could not join: the room may not exist or the password is wrong.");
            }
        };
    }

    function sendFrame(obj) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(obj));
        }
    }

    /* ================= Server messages ================= */

    function handleServerMessage(msg) {
        switch (msg.type) {
            case "welcome":
                state.connected = true;
                state.myPeerId = msg.peerid;
                state.username = msg.username;
                state.isHost = msg.isHost;
                state.room = msg.room;
                showRoomUI();
                (msg.peers || []).forEach(function (peerInfo) {
                    var peer = createPeerRecord(peerInfo);
                    startOfferTo(peer);
                });
                broadcastState();
                updateParticipantCount();
                break;
            case "peer-join":
                createPeerRecord(msg.peer);
                addSystemChat(msg.peer.username + " joined the meeting");
                broadcastState(); //let the newcomer learn our mute/cam state
                updateParticipantCount();
                break;
            case "peer-leave":
                removePeer(msg.peerid);
                addSystemChat(msg.username + " left the meeting");
                updateParticipantCount();
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
            state: { audio: false, video: false, screen: false }
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

    function setTileState(peerId, audioOn, videoOn, screenOn) {
        var tile = $id("tile-" + peerId);
        if (!tile) return;
        tile.classList.toggle("no-video", !videoOn);
        tile.classList.toggle("is-sharing", !!screenOn);
        tile.querySelector(".muted-icon").style.display = audioOn ? "none" : "";
    }

    function updatePeerState(msg) {
        var peer = state.peers[msg.from];
        if (!peer) return;
        peer.state = { audio: msg.audio, video: msg.video, screen: msg.screen };
        setTileState(msg.from, msg.audio, msg.video, msg.screen);
    }

    function updateParticipantCount() {
        $id("participantCount").textContent = String(Object.keys(state.peers).length + 1);
    }

    /* ================= Room UI ================= */

    function showRoomUI() {
        $id("lobby").style.display = "none";
        $id("room").style.display = "flex";
        $id("roomTitle").textContent = state.room.title;
        $id("roomIdText").textContent = state.room.displayid;
        $id("endBtn").style.display = state.isHost ? "" : "none";
        setWindowTitle("MeetRoom - " + state.room.title);

        //Local tile
        addVideoTile("local", state.username, true);
        if (state.localStream) {
            attachStreamToTile("local", state.localStream);
        }
        state.micOn = !!state.micTrack;
        state.camOn = !!state.camTrack;
        if (!state.micTrack) $id("micBtn").disabled = true;
        if (!state.camTrack) $id("camBtn").disabled = true;
        refreshControlButtons();
        refreshLocalTile();
        addSystemChat("You joined the meeting as " + state.username);
    }

    function refreshLocalTile() {
        var videoOn = (state.camOn && !!state.camTrack) || state.sharing;
        setTileState("local", state.micOn && !!state.micTrack, videoOn, state.sharing);
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
    }

    function broadcastState() {
        sendFrame({
            type: "state",
            audio: state.micOn && !!state.micTrack,
            video: (state.camOn && !!state.camTrack) || state.sharing,
            screen: state.sharing
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

    $id("inviteBtn").addEventListener("click", function () {
        var text = "Join my ArozOS meeting" +
            "\nMeeting ID: " + state.room.displayid +
            (state.room.protected ? "\n(Password required)" : "");
        copyText(text);
        addSystemChat("Invite info copied to clipboard");
    });

    $id("roomIdTag").addEventListener("click", function () {
        copyText(state.room.displayid);
        addSystemChat("Meeting ID copied to clipboard");
    });

    $id("leaveBtn").addEventListener("click", function () {
        state.leaving = true;
        cleanupRoom();
        showLobbyError("");
    });

    $id("endBtn").addEventListener("click", function () {
        if (!confirm("End the meeting for all participants?")) return;
        sendFrame({ type: "end" });
        state.leaving = true;
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
            state.unreadChat = 0;
            $id("chatBadge").style.display = "none";
            $id("chatText").focus();
            scrollChat();
        }
    }

    $id("chatBtn").addEventListener("click", function () { toggleChat(!state.chatOpen); });
    $id("chatCloseBtn").addEventListener("click", function () { toggleChat(false); });

    function sendChat() {
        var input = $id("chatText");
        var text = input.value.trim();
        if (text === "") return;
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
        if (!own) bumpUnread();
    }

    function addFileMessage(msg) {
        var own = msg.from === state.myPeerId;
        var href = API.download +
            "?roomid=" + encodeURIComponent(state.room.id) +
            "&password=" + encodeURIComponent(state.password) +
            "&fileid=" + encodeURIComponent(msg.fileid);
        var node = document.createElement("div");
        node.className = "chat-msg" + (own ? " own" : "");
        node.innerHTML =
            '<div class="msg-meta">' + escapeHtml(msg.username) + " - " + chatTimestamp(msg.time) + '</div>' +
            '<div class="msg-body">' +
            '<a class="file-link" target="_blank" rel="noopener" href="' + href + '" download>' +
            '<i class="file outline icon"></i>' + escapeHtml(msg.name) +
            '</a> <span class="file-size">(' + formatBytes(msg.size) + ')</span>' +
            '</div>';
        appendChatNode(node);
        if (!own) bumpUnread();
    }

    function addSystemChat(text) {
        var node = document.createElement("div");
        node.className = "chat-msg system";
        node.innerHTML = '<div class="msg-body">' + escapeHtml(text) + '</div>';
        appendChatNode(node);
    }

    /* ================= Attachments ================= */

    $id("attachBtn").addEventListener("click", function () {
        $id("attachInput").click();
    });

    $id("attachInput").addEventListener("change", function () {
        var file = this.files[0];
        this.value = "";
        if (!file) return;

        var form = new FormData();
        form.append("roomid", state.room.id);
        form.append("password", state.password);
        form.append("file", file);

        $id("uploadStatus").style.display = "";
        $id("uploadStatusText").textContent = "Uploading " + file.name + "...";

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
    });

    /* ================= Teardown ================= */

    function cleanupRoom() {
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
        state.connected = false;
        state.myPeerId = -1;
        state.room = null;
        state.password = "";
        state.unreadChat = 0;

        $id("videoGrid").innerHTML = "";
        $id("chatMessages").innerHTML = "";
        $id("chatBadge").style.display = "none";
        $id("micBtn").disabled = false;
        $id("camBtn").disabled = false;
        toggleChat(false);
        $id("room").style.display = "none";
        $id("lobby").style.display = "flex";
        setWindowTitle("MeetRoom");
    }

})();
