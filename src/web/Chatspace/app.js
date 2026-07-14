/*
    Chatspace - Slack-style team chat WebApp
    author: AI assisted

    Built entirely on the ArozOS shared space collaboration backbone
    (mod/sharedspace + the sharedspace AGI library):

      - Every channel / DM is a shared space. Channels are "public"
        (discoverable, self-join) or "private" (invite only) spaces; DMs
        are private spaces keyed by their sorted participant list.
      - A message is a space text item whose text carries a small JSON
        envelope: {"cs":1,"a":"msg","t":...}. Reactions ("rct"), edits
        ("edt") and pins ("pin") are further envelope items referencing
        the target item id, so the full message model (threads, reaction
        pills, edited flags, pinned state) is *reduced* client-side from
        the plain item stream. Plain text items posted by other
        sharedspace clients render as ordinary messages.
      - Attachments are space blobs uploaded via /system/sharedspace/
        upload and rendered from the item stream.
      - Realtime delivery, presence and typing indicators ride the
        per-space WebSocket channel (/system/sharedspace/ws): persisted
        items fan out as "item" frames, typing uses ephemeral
        "broadcast" frames and presence comes from peer-join/peer-leave.
      - Workspace bootstrap / channel creation / DM find-or-create run
        as AGI backend scripts (./backend) through /system/ajgi/interface.

    UI intentionally mirrors the Slack desktop client: left icon rail,
    aubergine sidebar with unread badges, message pane with hover
    actions, reactions, threads in a right-hand panel, a composer with a
    formatting toolbar, quick switcher (Ctrl+K), search, saved items,
    drafts and an activity feed. All glyphs are Semantic UI font icons
    or local SVGs - no emoji (repo convention); ":shortcode:" tokens
    render as icons instead.
*/

(function () {
    "use strict";

    /* ================= Constants ================= */

    var API = {
        users: "../system/users/list",
        bootstrap: "../system/ajgi/interface?script=Chatspace/backend/bootstrap.js",
        createChannel: "../system/ajgi/interface?script=Chatspace/backend/createChannel.js",
        openDm: "../system/ajgi/interface?script=Chatspace/backend/openDm.js",
        aibot: "../system/ajgi/interface?script=Chatspace/backend/aibot.js",
        saveToArozOS: "../system/ajgi/interface?script=Chatspace/backend/saveToArozOS.js",
        info: "../system/sharedspace/info",
        join: "../system/sharedspace/join",
        leave: "../system/sharedspace/leave",
        del: "../system/sharedspace/delete",
        meta: "../system/sharedspace/meta",
        access: "../system/sharedspace/access",
        membersAdd: "../system/sharedspace/members/add",
        membersRemove: "../system/sharedspace/members/remove",
        items: "../system/sharedspace/items",
        addtext: "../system/sharedspace/addtext",
        removeitem: "../system/sharedspace/removeitem",
        upload: "../system/sharedspace/upload",
        download: "../system/sharedspace/download",
        ws: "../system/sharedspace/ws"
    };

    var HEARTBEAT_MS = 25000;        //app-level ping cadence per socket
    var HEARTBEAT_TIMEOUT_MS = 70000; //no pong for this long = dead socket
    var RECONNECT_MAX_DELAY_MS = 15000;
    var REFRESH_MS = 60000;          //workspace re-bootstrap cadence
    var COMPACT_WINDOW_S = 300;      //group consecutive messages within 5 min
    var MAX_MSG_LEN = 3500;          //fits the server's 4000-rune ws chat cap
    var TYPING_TTL_MS = 4000;
    var TYPING_EMIT_MS = 2500;
    var IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
    var VIDEO_EXTS = ["mp4", "webm", "ogv", "mov", "m4v", "mkv"];
    var AUDIO_EXTS = ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"];
    //Files rendered as an inline text preview (fetched and escaped client
    //side). Kept to plain-text / code types; never rendered as HTML.
    var TEXT_EXTS = ["txt", "md", "markdown", "log", "csv", "tsv", "json",
        "xml", "yaml", "yml", "ini", "conf", "cfg", "js", "ts", "css", "html",
        "htm", "go", "py", "java", "c", "cpp", "h", "hpp", "sh", "bat", "rb",
        "php", "sql", "agi", "svg"];
    var TEXT_PREVIEW_MAX_BYTES = 256 * 1024; //do not fetch huge files inline
    var TEXT_PREVIEW_MAX_CHARS = 6000;       //cap what we render

    //Icon shortcodes: ":code:" in message text renders as a Semantic UI
    //icon; the same set powers reactions. Emoji glyphs are never used.
    var ICON_SET = [
        { code: "thumbsup", icon: "thumbs up" },
        { code: "thumbsdown", icon: "thumbs down" },
        { code: "heart", icon: "heart" },
        { code: "smile", icon: "smile" },
        { code: "frown", icon: "frown" },
        { code: "check", icon: "check" },
        { code: "star", icon: "star" },
        { code: "fire", icon: "fire" },
        { code: "coffee", icon: "coffee" },
        { code: "rocket", icon: "rocket" },
        { code: "bug", icon: "bug" },
        { code: "gift", icon: "gift" },
        { code: "trophy", icon: "trophy" },
        { code: "bell", icon: "bell" },
        { code: "eye", icon: "eye" },
        { code: "bolt", icon: "lightning" },
        { code: "peace", icon: "hand peace" },
        { code: "spock", icon: "hand spock" },
        { code: "flag", icon: "flag" },
        { code: "cake", icon: "birthday cake" },
        { code: "handshake", icon: "handshake" }
    ];
    var ICON_BY_CODE = {};
    ICON_SET.forEach(function (entry) { ICON_BY_CODE[entry.code] = entry.icon; });
    var QUICK_REACTS = ["check", "thumbsup", "heart"];

    var AVATAR_COLORS = ["#e01e5a", "#36c5f0", "#2eb67d", "#ecb22e",
        "#764fa5", "#e8912d", "#5b6dcd", "#00a3a3"];

    //Broadcast mentions: "@everyone" / "@channel" address every member of
    //the conversation (badge + notification for everybody).
    var BROADCAST_MENTIONS = { everyone: true, channel: true };

    //The built-in AI assistant: mention "@ai" in any conversation to have
    //backend/aibot.js answer through the AGI LLM library.
    var AI_HANDLE = "ai";
    var AI_DISPLAY = "Chatspace AI";
    var AI_THINKING_MS = 45000; //thinking indicator cap while awaiting the reply

    /* ================= State ================= */

    var state = {
        username: "",
        users: {},        // username -> {icon, groups}
        userOrder: [],
        convos: {},       // spaceid -> convo record
        directory: [],    // public channels not joined
        active: null,     // active convo spaceid
        activeThread: null, // root item id open in the thread panel
        rpMode: null,     // "thread" | "details" | "profile"
        rpProfileUser: null,
        railView: "home",
        sbNav: null,      // "threads"|"drafts"|"activity"|"later" alt list
        mainView: "convo", // "convo" | "activity" (main pane content)
        activityTab: "all",
        detailsTab: "about", // active tab in the channel details modal
        collapsedFiles: {},  // itemid -> true when the preview is folded
        editing: null,    // {convoId, itemId} composer edit target
        navHist: [],
        navPos: -1,
        focused: !document.hidden,
        booted: false,
        prefs: {
            lastRead: {}, starred: [], saved: [], drafts: {},
            collapsed: {}, lastActive: "", activitySeen: 0
        }
    };

    /* ================= Tiny helpers ================= */

    function $id(id) { return document.getElementById(id); }

    /* ---- mobile navigation (single-column, Slack-style) ---- */

    //On narrow screens the sidebar (list) and content (conversation /
    //activity) become two stacked screens; a class on #app slides the
    //detail screen over the list.
    function isMobile() { return window.matchMedia("(max-width: 768px)").matches; }

    function showMobileDetail() {
        if (isMobile()) $id("app").classList.add("mobile-detail");
    }

    function showMobileList() {
        $id("app").classList.remove("mobile-detail");
    }

    function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text === undefined || text === null ? "" : String(text);
        return div.innerHTML;
    }

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

    function extOf(name) {
        var idx = String(name).lastIndexOf(".");
        return idx < 0 ? "" : String(name).substring(idx + 1).toLowerCase();
    }

    function isImageName(name) { return IMAGE_EXTS.indexOf(extOf(name)) >= 0; }
    function isVideoName(name) { return VIDEO_EXTS.indexOf(extOf(name)) >= 0; }
    function isAudioName(name) { return AUDIO_EXTS.indexOf(extOf(name)) >= 0; }
    function isTextName(name) { return TEXT_EXTS.indexOf(extOf(name)) >= 0; }

    function fmtTime(unix) {
        return new Date(unix * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function fmtFull(unix) {
        return new Date(unix * 1000).toLocaleString();
    }

    function dayKey(unix) {
        var d = new Date(unix * 1000);
        return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    }

    function fmtDayLabel(unix) {
        var d = new Date(unix * 1000);
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        var diff = Math.round((today - that) / 86400000);
        if (diff === 0) return "Today";
        if (diff === 1) return "Yesterday";
        var opts = { weekday: "long", month: "long", day: "numeric" };
        if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
        return d.toLocaleDateString([], opts);
    }

    function fmtAgo(unix) {
        var s = Math.max(1, Math.floor(Date.now() / 1000 - unix));
        if (s < 60) return "just now";
        if (s < 3600) return Math.floor(s / 60) + "m ago";
        if (s < 86400) return Math.floor(s / 3600) + "h ago";
        return fmtDayLabel(unix).toLowerCase() === "yesterday" ? "yesterday" : new Date(unix * 1000).toLocaleDateString();
    }

    function wsUrl(spaceid) {
        var u = new URL(API.ws + "?spaceid=" + encodeURIComponent(spaceid), location.href);
        u.protocol = (location.protocol === "https:") ? "wss:" : "ws:";
        return u.toString();
    }

    function setWindowTitle(title) {
        document.title = title;
        if (typeof ao_module_setWindowTitle === "function") {
            try { ao_module_setWindowTitle(title); } catch (e) { }
        }
    }

    function apiFail(data, fallback) {
        if (data && data.error !== undefined) return data.error;
        return fallback || null;
    }

    /* ================= Preferences (per user, localStorage) ================= */

    function prefsKey() { return "chatspace-prefs-" + state.username; }

    function loadPrefs() {
        try {
            var raw = localStorage.getItem(prefsKey());
            if (raw) {
                var stored = JSON.parse(raw);
                Object.keys(state.prefs).forEach(function (k) {
                    if (stored[k] !== undefined) state.prefs[k] = stored[k];
                });
            }
        } catch (e) { }
    }

    function savePrefs() {
        try { localStorage.setItem(prefsKey(), JSON.stringify(state.prefs)); } catch (e) { }
    }

    /* ================= Avatars ================= */

    function avatarColor(username) {
        var hash = 0;
        for (var i = 0; i < username.length; i++) {
            hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
        }
        return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    }

    function avatarHtml(username, fontPx) {
        var user = state.users[username];
        if (user && user.icon) {
            //The class constrains the image to its container regardless of
            //the profile picture's own (possibly large) dimensions
            return '<img class="cs-avatar-img" src="' + escapeAttr(user.icon) + '" alt="">';
        }
        var initial = username ? username.substring(0, 1) : "?";
        return '<div class="avatar-fallback" style="background:' + avatarColor(username || "?") +
            ';font-size:' + (fontPx || 14) + 'px;">' + escapeHtml(initial) + '</div>';
    }

    /* ================= Sound (WebAudio chime, no bundled assets) ================= */

    var audioCtx = null;
    var lastChime = 0;

    function playNotifySound() {
        var now = Date.now();
        if (now - lastChime < 3000) return;
        lastChime = now;
        try {
            if (!audioCtx) {
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                audioCtx = new Ctx();
            }
            if (audioCtx.state === "suspended") {
                var p = audioCtx.resume();
                if (p && p.catch) p.catch(function () { });
            }
            var t = audioCtx.currentTime;
            [{ freq: 830, at: 0, len: 0.09 }, { freq: 1245, at: 0.09, len: 0.16 }].forEach(function (note) {
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.value = note.freq;
                gain.gain.setValueAtTime(0.0001, t + note.at);
                gain.gain.linearRampToValueAtTime(0.08, t + note.at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + note.at + note.len);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(t + note.at);
                osc.stop(t + note.at + note.len + 0.05);
            });
        } catch (e) { }
    }

    /* ================= Toasts ================= */

    function showToast(title, body, onClick) {
        var node = document.createElement("div");
        node.className = "toast";
        node.innerHTML = '<div class="toast-title"><i class="comment icon"></i>' +
            escapeHtml(title) + '</div><div class="toast-body">' + escapeHtml(body) + '</div>';
        node.addEventListener("click", function () {
            node.remove();
            if (onClick) onClick();
        });
        $id("toastZone").appendChild(node);
        setTimeout(function () { node.remove(); }, 6000);
    }

    /* ================= Conversation model ================= */

    function metaOf(desc) { return (desc && desc.metadata) || {}; }

    function convoKind(desc) {
        return metaOf(desc)["cs-kind"] === "dm" ? "dm" : "channel";
    }

    function channelDisplayName(desc) {
        return metaOf(desc)["cs-name"] || desc.name || "channel";
    }

    function dmOthers(convo) {
        var listed = (metaOf(convo.desc)["cs-members"] || "").split(",");
        var others = [];
        for (var i = 0; i < listed.length; i++) {
            var u = listed[i];
            if (u !== "" && u !== state.username) others.push(u);
        }
        if (others.length === 0) {
            Object.keys(convo.members).forEach(function (u) {
                if (u !== state.username) others.push(u);
            });
        }
        return others;
    }

    function convoLabel(convo) {
        if (convo.kind === "dm") {
            var others = dmOthers(convo);
            return others.length > 0 ? others.join(", ") : state.username + " (you)";
        }
        return channelDisplayName(convo.desc);
    }

    function canManage(convo) {
        return convo.desc.myrole === "owner" || convo.desc.myrole === "admin";
    }

    //Create or refresh the convo record for a space descriptor while
    //preserving runtime state (items, socket, unread counters).
    function upsertConvo(desc) {
        var convo = state.convos[desc.spaceid];
        if (!convo) {
            convo = {
                id: desc.spaceid,
                kind: convoKind(desc),
                desc: desc,
                members: desc.memberlist || {},
                items: [],
                msgs: {},
                roots: [],
                activity: [],
                loaded: false,
                loading: false,
                ws: null,
                wsOk: false,
                reconnAttempt: 0,
                reconnTimer: null,
                hbTimer: null,
                lastPong: 0,
                lastTypingSent: 0,
                peers: {},
                typing: {},
                unread: 0,
                mentions: 0,
                lastMsgTime: desc.createdat || 0
            };
            state.convos[desc.spaceid] = convo;
        } else {
            convo.desc = desc;
            convo.kind = convoKind(desc);
            if (desc.memberlist) convo.members = desc.memberlist;
        }
        return convo;
    }

    function removeConvo(spaceid) {
        var convo = state.convos[spaceid];
        if (!convo) return;
        closeSocket(convo);
        delete state.convos[spaceid];
        if (state.active === spaceid) {
            state.active = null;
            state.activeThread = null;
            closeRightPanel();
        }
    }

    function joinedConvos(kind) {
        var list = [];
        Object.keys(state.convos).forEach(function (id) {
            var convo = state.convos[id];
            if (convo.desc.ismember && (!kind || convo.kind === kind)) list.push(convo);
        });
        list.sort(function (a, b) {
            var an = convoLabel(a).toLowerCase();
            var bn = convoLabel(b).toLowerCase();
            return an < bn ? -1 : (an > bn ? 1 : 0);
        });
        return list;
    }

    /* ================= Message envelope + reducer ================= */

    function parseEnvelope(text) {
        if (!text || text.charAt(0) !== "{") return null;
        try {
            var obj = JSON.parse(text);
            if (obj && obj.cs === 1 && typeof obj.a === "string") return obj;
        } catch (e) { }
        return null;
    }

    function mentionsMe(text) {
        if (!text || !state.username) return false;
        //Broadcast mentions address everyone in the conversation
        if (/(^|[\s(>])@(everyone|channel)(?![A-Za-z0-9_.\-])/.test(text)) return true;
        var re = new RegExp("(^|[\\s(>])@" + state.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_.\\-])");
        return re.test(text);
    }

    function mentionsAi(text) {
        return /(^|[\s(>])@ai(?![A-Za-z0-9_.\-])/i.test(text || "");
    }

    //Rebuild the full message model of a conversation from its raw item
    //stream. Spaces cap items at ~1k, so a full re-reduce stays cheap and
    //keeps every edge case (out-of-order arrival, deletions) correct.
    //Same-second tiebreak: an assistant reply always sorts after the human
    //message that triggered it (item times have one-second resolution).
    function itemBotRank(item) {
        if (item.csBotRank === undefined) {
            var env = parseEnvelope(item.text || "");
            item.csBotRank = (env && env.bot) ? 1 : 0;
        }
        return item.csBotRank;
    }

    function reduceConvo(convo) {
        convo.items.sort(function (a, b) {
            if (a.time !== b.time) return a.time - b.time;
            if (itemBotRank(a) !== itemBotRank(b)) return itemBotRank(a) - itemBotRank(b);
            return a.itemid < b.itemid ? -1 : (a.itemid > b.itemid ? 1 : 0);
        });

        var msgs = {};
        var actions = [];
        var activity = [];
        var lastTime = convo.desc.createdat || 0;

        //Pass 1: materialize message records
        convo.items.forEach(function (item) {
            if (item.time > lastTime) lastTime = item.time;
            if (item.type === "file" || item.type === "image") {
                msgs[item.itemid] = {
                    id: item.itemid, user: item.uploader, time: item.time,
                    kind: item.type, text: "", name: item.name, size: item.size,
                    thread: null, broadcast: false, bot: false,
                    replies: [], replyUsers: [],
                    lastReplyTime: 0, reactions: {}, pinned: false, edited: false
                };
                return;
            }
            var env = parseEnvelope(item.text);
            if (env && env.a !== "msg") {
                actions.push({ item: item, env: env });
                return;
            }
            var text = env ? String(env.t || "") : String(item.text || "");
            msgs[item.itemid] = {
                id: item.itemid, user: item.uploader, time: item.time,
                kind: "text", text: text, name: "", size: 0,
                thread: env && env.th ? String(env.th) : null,
                broadcast: !!(env && env.bc), bot: !!(env && env.bot),
                replies: [], replyUsers: [],
                lastReplyTime: 0, reactions: {}, pinned: false, edited: false
            };
        });

        //Pass 2: apply reactions / edits / pins chronologically
        actions.forEach(function (entry) {
            var env = entry.env;
            var actor = entry.item.uploader;
            var target = msgs[String(env.g || "")];
            if (!target) return;
            if (env.a === "rct" && ICON_BY_CODE[env.k]) {
                var list = target.reactions[env.k] || [];
                var at = list.indexOf(actor);
                if (env.on && at < 0) list.push(actor);
                if (!env.on && at >= 0) list.splice(at, 1);
                if (list.length > 0) {
                    target.reactions[env.k] = list;
                } else {
                    delete target.reactions[env.k];
                }
                if (env.on && target.user === state.username && actor !== state.username) {
                    activity.push({
                        type: "reaction", time: entry.item.time, user: actor,
                        convoId: convo.id, msgId: target.id, extra: env.k
                    });
                }
            } else if (env.a === "edt") {
                //Only the original author may edit their message
                if (actor === target.user) {
                    target.text = String(env.t || "");
                    target.edited = true;
                }
            } else if (env.a === "pin") {
                target.pinned = !!env.on;
            }
        });

        //Pass 3: thread wiring + root ordering
        var roots = [];
        Object.keys(msgs).forEach(function (id) {
            var msg = msgs[id];
            if (msg.thread && msgs[msg.thread] && msg.thread !== id) {
                var parent = msgs[msg.thread];
                parent.replies.push(id);
                if (msg.time > parent.lastReplyTime) parent.lastReplyTime = msg.time;
                if (parent.replyUsers.indexOf(msg.user) < 0) parent.replyUsers.push(msg.user);
                if (msg.broadcast) roots.push(msg);
                if (msg.user !== state.username && parent.user === state.username) {
                    activity.push({
                        type: "reply", time: msg.time, user: msg.user,
                        convoId: convo.id, msgId: parent.id, extra: msg.text
                    });
                }
            } else {
                msg.thread = msgs[msg.thread] ? msg.thread : null;
                roots.push(msg);
            }
            if (msg.user !== state.username && msg.kind === "text" && mentionsMe(msg.text)) {
                activity.push({
                    type: "mention", time: msg.time, user: msg.user,
                    convoId: convo.id, msgId: msg.id, extra: msg.text
                });
            }
        });
        roots.sort(function (a, b) {
            if (a.time !== b.time) return a.time - b.time;
            return a.id < b.id ? -1 : 1;
        });
        Object.keys(msgs).forEach(function (id) {
            msgs[id].replies.sort(function (x, y) { return msgs[x].time - msgs[y].time; });
        });

        convo.msgs = msgs;
        convo.roots = roots;
        convo.activity = activity;
        convo.lastMsgTime = lastTime;
        recountUnread(convo);
    }

    //Unread + mention counters that drive the sidebar badge. Every message
    //(including thread replies) since the last read is counted; a message
    //that @mentions me (or @everyone / @channel) also bumps the mention
    //count. The badge itself only appears for DMs (unread count) or for
    //channels with mentions - see convoItemHtml.
    function recountUnread(convo) {
        var since = state.prefs.lastRead[convo.id] || 0;
        var unread = 0;
        var mentions = 0;
        Object.keys(convo.msgs).forEach(function (id) {
            var msg = convo.msgs[id];
            if (msg.time <= since || msg.user === state.username) return;
            unread++;
            if (msg.kind === "text" && mentionsMe(msg.text)) mentions++;
        });
        convo.unread = unread;
        convo.mentions = mentions;
    }

    function markRead(convo) {
        if (!convo) return;
        var latest = convo.lastMsgTime || Math.floor(Date.now() / 1000);
        if ((state.prefs.lastRead[convo.id] || 0) < latest) {
            state.prefs.lastRead[convo.id] = latest;
            savePrefs();
        }
        convo.unread = 0;
        convo.mentions = 0;
        updateTitleBadge();
    }

    function updateTitleBadge() {
        var total = 0;
        Object.keys(state.convos).forEach(function (id) {
            var convo = state.convos[id];
            total += (convo.kind === "dm") ? convo.unread : convo.mentions;
        });
        setWindowTitle(total > 0 ? "(" + total + ") Chatspace" : "Chatspace");
    }

    /* ================= Item fetch / mutation ================= */

    function fetchItems(convo, done) {
        if (convo.loading) return;
        convo.loading = true;
        $.get(API.items, { spaceid: convo.id }, function (data) {
            convo.loading = false;
            if (!data || data.error !== undefined) return;
            convo.items = data;
            convo.loaded = true;
            reduceConvo(convo);
            if (state.active === convo.id) {
                //Already looking at it: everything just loaded counts as read
                if (state.focused) markRead(convo);
                renderMain();
                scrollMessagesToBottom();
            }
            renderSidebar();
            if (done) done();
        }, "json").fail(function () { convo.loading = false; });
    }

    function upsertItem(convo, item) {
        for (var i = 0; i < convo.items.length; i++) {
            if (convo.items[i].itemid === item.itemid) {
                convo.items[i] = item;
                return;
            }
        }
        convo.items.push(item);
    }

    //Send a message envelope: over the live socket when possible (the
    //persisted item event echoes back to everyone), HTTP otherwise.
    function sendEnvelope(convo, env) {
        var text = JSON.stringify(env);
        if (convo.ws && convo.ws.readyState === WebSocket.OPEN) {
            convo.ws.send(JSON.stringify({ type: "chat", text: text }));
            return;
        }
        $.post(API.addtext, { spaceid: convo.id, text: text }, function () {
            fetchItems(convo);
        }, "json");
    }

    function sendMessage(convo, text, threadId, alsoSend) {
        var env = { cs: 1, a: "msg", t: text };
        if (threadId) {
            env.th = threadId;
            if (alsoSend) env.bc = 1;
        }
        sendEnvelope(convo, env);
        markRead(convo);
        if (mentionsAi(text)) triggerAiBot(convo, text, threadId || "");
    }

    //Summon the built-in assistant: backend/aibot.js reads the recent
    //conversation, asks the configured LLM and posts the reply into the
    //space (it arrives like any other realtime item). A typing indicator
    //stands in while the model thinks.
    function triggerAiBot(convo, text, threadId) {
        convo.typing[AI_DISPLAY] = Date.now() + AI_THINKING_MS;
        if (state.active === convo.id) renderTyping();
        var clearThinking = function () {
            delete convo.typing[AI_DISPLAY];
            if (state.active === convo.id) renderTyping();
        };
        $.post(API.aibot, { spaceid: convo.id, prompt: text, thread: threadId }, function (data) {
            clearThinking();
            var err = apiFail(data);
            if (err) showToast(AI_DISPLAY, err);
        }, "json").fail(function () {
            clearThinking();
            showToast(AI_DISPLAY, "The assistant did not answer - is the AGI gateway reachable?");
        });
    }

    function toggleReaction(convo, msgId, code) {
        var msg = convo.msgs[msgId];
        if (!msg) return;
        var mine = (msg.reactions[code] || []).indexOf(state.username) >= 0;
        sendEnvelope(convo, { cs: 1, a: "rct", g: msgId, k: code, on: !mine });
    }

    function sendEdit(convo, msgId, text) {
        sendEnvelope(convo, { cs: 1, a: "edt", g: msgId, t: text });
    }

    function togglePin(convo, msgId) {
        var msg = convo.msgs[msgId];
        if (!msg) return;
        sendEnvelope(convo, { cs: 1, a: "pin", g: msgId, on: !msg.pinned });
    }

    function deleteMessage(convo, msgId) {
        if (!confirm("Delete this message? This cannot be undone.")) return;
        $.post(API.removeitem, { spaceid: convo.id, itemid: msgId }, function (data) {
            var err = apiFail(data);
            if (err) showToast("Could not delete", err);
        }, "json");
    }

    /* ================= WebSocket per conversation ================= */

    function connectConvo(convo) {
        if (!convo.desc.ismember || convo.ws) return;
        var ws = new WebSocket(wsUrl(convo.id));
        convo.ws = ws;

        ws.onmessage = function (evt) {
            var frame;
            try { frame = JSON.parse(evt.data); } catch (e) { return; }
            handleFrame(convo, frame);
        };
        ws.onclose = function () {
            stopHeartbeat(convo);
            convo.ws = null;
            convo.wsOk = false;
            convo.peers = {};
            if (!state.convos[convo.id] || !convo.desc.ismember) return;
            scheduleReconnect(convo);
            if (state.active === convo.id) renderOfflineBanner();
            renderSidebar();
        };
    }

    function closeSocket(convo) {
        stopHeartbeat(convo);
        if (convo.reconnTimer) {
            clearTimeout(convo.reconnTimer);
            convo.reconnTimer = null;
        }
        if (convo.ws) {
            var ws = convo.ws;
            convo.ws = null;
            try { ws.onclose = null; ws.close(); } catch (e) { }
        }
        convo.wsOk = false;
        convo.peers = {};
    }

    function scheduleReconnect(convo) {
        if (convo.reconnTimer) return;
        convo.reconnAttempt++;
        var delay = Math.min(1000 * Math.pow(2, convo.reconnAttempt - 1), RECONNECT_MAX_DELAY_MS);
        convo.reconnTimer = setTimeout(function () {
            convo.reconnTimer = null;
            if (state.convos[convo.id] && convo.desc.ismember && !convo.ws) {
                connectConvo(convo);
            }
        }, delay);
    }

    function startHeartbeat(convo) {
        stopHeartbeat(convo);
        convo.lastPong = Date.now();
        convo.hbTimer = setInterval(function () {
            if (Date.now() - convo.lastPong > HEARTBEAT_TIMEOUT_MS) {
                if (convo.ws) { try { convo.ws.close(); } catch (e) { } }
                return;
            }
            if (convo.ws && convo.ws.readyState === WebSocket.OPEN) {
                convo.ws.send(JSON.stringify({ type: "ping" }));
            }
        }, HEARTBEAT_MS);
    }

    function stopHeartbeat(convo) {
        if (convo.hbTimer) {
            clearInterval(convo.hbTimer);
            convo.hbTimer = null;
        }
    }

    function handleFrame(convo, frame) {
        switch (frame.type) {
            case "welcome":
                convo.wsOk = true;
                convo.reconnAttempt = 0;
                convo.lastPong = Date.now();
                convo.peers = {};
                (frame.peers || []).forEach(function (peer) {
                    convo.peers[peer.subid] = peer.username;
                });
                if (frame.space) {
                    //The welcome descriptor carries our role server-side;
                    //fall back to what we knew if it ever lacks it
                    if (frame.space.ismember === undefined) {
                        frame.space.ismember = convo.desc.ismember;
                        frame.space.myrole = convo.desc.myrole;
                    }
                    convo.desc = frame.space;
                }
                startHeartbeat(convo);
                //Resync anything missed while the socket was down
                if (convo.loaded) fetchItems(convo);
                if (state.active === convo.id) {
                    renderOfflineBanner();
                    renderChannelHeader();
                }
                renderSidebar();
                break;
            case "pong":
                convo.lastPong = Date.now();
                break;
            case "peer-join":
                if (frame.peer) convo.peers[frame.peer.subid] = frame.peer.username;
                renderPresence();
                break;
            case "peer-leave":
                delete convo.peers[frame.subid];
                renderPresence();
                break;
            case "item":
                if (frame.item) {
                    upsertItem(convo, frame.item);
                    reduceConvo(convo);
                    onItemArrived(convo, frame.item);
                }
                break;
            case "item-removed":
                convo.items = convo.items.filter(function (item) {
                    return item.itemid !== frame.itemid;
                });
                reduceConvo(convo);
                if (state.active === convo.id) {
                    renderMain();
                    renderRightPanel();
                }
                renderSidebar();
                break;
            case "member":
                onMemberEvent(convo, frame);
                break;
            case "broadcast":
                if (frame.data && frame.data.a === "typing" && frame.username !== state.username) {
                    convo.typing[frame.username] = Date.now() + TYPING_TTL_MS;
                    if (state.active === convo.id) renderTyping();
                }
                break;
            case "space-closed":
                var label = convoLabel(convo);
                removeConvo(convo.id);
                showToast("Conversation removed", (convo.kind === "dm" ? "" : "#") + label + " is no longer available");
                renderAll();
                break;
            case "error":
                if (frame.error) showToast("Chatspace", frame.error);
                break;
        }
    }

    function onItemArrived(convo, item) {
        var env = parseEnvelope(item.text || "");
        var isMessage = item.type !== "text" || !env || env.a === "msg";
        var mine = item.uploader === state.username;
        var isBot = !!(env && env.bot);

        if (state.active === convo.id && state.mainView === "convo") {
            var stick = isScrolledToBottom();
            renderMain();
            renderRightPanel();
            if (stick || mine) scrollMessagesToBottom();
            if (state.focused) markRead(convo);
            //Ease the fresh message in
            var fresh = $id("msg-" + item.itemid);
            if (fresh) fresh.classList.add("msg-new");
        }

        if (isBot) delete convo.typing[AI_DISPLAY];

        if (isMessage && !mine) {
            var text = env ? String(env.t || "") : (item.type === "text" ? item.text : "Shared " + item.name);
            var sender = isBot ? AI_DISPLAY : item.uploader;
            var notify = false;
            if (convo.kind === "dm") notify = true;
            if (mentionsMe(text)) notify = true;
            if (notify && (!state.focused || state.active !== convo.id)) {
                playNotifySound();
                showToast(
                    convo.kind === "dm" ? sender : sender + " in #" + convoLabel(convo),
                    text || item.name || "",
                    function () { setActive(convo.id); }
                );
            }
        }
        delete convo.typing[item.uploader];
        if (state.active === convo.id) renderTyping();
        renderSidebar();
        updateTitleBadge();
        renderActivityDot();
    }

    function onMemberEvent(convo, frame) {
        if (frame.action === "add") {
            convo.members[frame.username] = frame.role || "member";
            if (state.active === convo.id && convo.kind === "channel") {
                appendSysline(frame.username + " was added to the channel");
            }
        } else if (frame.action === "remove") {
            delete convo.members[frame.username];
            if (frame.username === state.username) {
                //We were removed (or left): private content is gone for us
                var label = convoLabel(convo);
                removeConvo(convo.id);
                showToast("Removed", "You left or were removed from #" + label);
                renderAll();
                return;
            }
            if (state.active === convo.id && convo.kind === "channel") {
                appendSysline(frame.username + " left the channel");
            }
        } else if (frame.action === "role") {
            convo.members[frame.username] = frame.role;
        }
        convo.desc.members = Object.keys(convo.members).length;
        if (state.active === convo.id) {
            renderChannelHeader();
            if (detailsModalOpen()) renderDetailsModal();
        }
    }

    function emitTyping(convo) {
        if (!convo || !convo.ws || convo.ws.readyState !== WebSocket.OPEN) return;
        var now = Date.now();
        if (now - convo.lastTypingSent < TYPING_EMIT_MS) return;
        convo.lastTypingSent = now;
        convo.ws.send(JSON.stringify({ type: "broadcast", data: { a: "typing" } }));
    }

    /* ================= Presence ================= */

    function isOnline(username) {
        if (username === state.username) return true;
        var ids = Object.keys(state.convos);
        for (var i = 0; i < ids.length; i++) {
            var peers = state.convos[ids[i]].peers;
            var subs = Object.keys(peers);
            for (var j = 0; j < subs.length; j++) {
                if (peers[subs[j]] === username) return true;
            }
        }
        return false;
    }

    function renderPresence() {
        renderSidebar();
        if (state.rpMode === "profile") renderRightPanel();
        if (detailsModalOpen()) renderDetailsModal();
    }

    /* ================= Workspace bootstrap ================= */

    function loadUsers(done) {
        $.get(API.users, function (data) {
            if (!data || data.error !== undefined) { if (done) done(); return; }
            state.users = {};
            state.userOrder = [];
            data.forEach(function (row) {
                //rows: [username, [groups], iconDataUri, isSelf]
                state.users[row[0]] = { icon: row[2] || "", groups: row[1] || [] };
                state.userOrder.push(row[0]);
                if (row[3] === true) state.username = row[0];
            });
            state.userOrder.sort();
            if (done) done();
        }, "json").fail(function () { if (done) done(); });
    }

    function bootstrapWorkspace(done) {
        $.post(API.bootstrap, {}, function (data) {
            if (!data || data.error !== undefined) {
                showToast("Chatspace", (data && data.error) || "Could not load the workspace");
                if (done) done(false);
                return;
            }
            state.username = data.username || state.username;
            var seen = {};
            (data.channels || []).concat(data.dms || []).forEach(function (desc) {
                seen[desc.spaceid] = true;
                var convo = upsertConvo(desc);
                connectConvo(convo);
                if (!convo.loaded && !convo.loading) fetchItems(convo);
            });
            //Drop joined convos that no longer exist server-side (but keep
            //non-member previews alive - they are not in the joined list)
            Object.keys(state.convos).forEach(function (id) {
                if (!seen[id] && state.convos[id].desc.ismember) removeConvo(id);
            });
            state.directory = data.directory || [];
            if (done) done(true);
        }, "json").fail(function () {
            showToast("Chatspace", "Could not reach the server");
            if (done) done(false);
        });
    }

    /* ================= Navigation ================= */

    function setActive(spaceid, opts) {
        opts = opts || {};
        var convo = state.convos[spaceid];
        if (!convo) return;
        saveDraft();
        if (state.active !== spaceid) {
            if (!opts.fromHistory) {
                state.navHist = state.navHist.slice(0, state.navPos + 1);
                state.navHist.push(spaceid);
                state.navPos = state.navHist.length - 1;
            }
            state.active = spaceid;
            state.activeThread = null;
            if (state.rpMode === "thread" || state.rpMode === "details") closeRightPanel();
            state.editing = null;
        }
        state.mainView = "convo";
        state.prefs.lastActive = spaceid;
        savePrefs();
        if (!convo.loaded && !convo.loading) fetchItems(convo);
        if (state.focused) markRead(convo);
        showMobileDetail();
        renderAll();
        restoreDraft();
        scrollMessagesToBottom();
        var input = $id("composeInput");
        //Do not steal focus (and pop the keyboard) on touch screens
        if (input && convo.desc.ismember && !isMobile()) input.focus();
    }

    function navGo(step) {
        var pos = state.navPos + step;
        while (pos >= 0 && pos < state.navHist.length && !state.convos[state.navHist[pos]]) {
            pos += step;
        }
        if (pos < 0 || pos >= state.navHist.length) return;
        state.navPos = pos;
        setActive(state.navHist[pos], { fromHistory: true });
    }

    /* ================= Rich text rendering ================= */

    function stash(store, html) {
        store.push(html);
        return "\u0000" + (store.length - 1) + "\u0000";
    }

    function unstash(store, html) {
        return html.replace(/\u0000(\d+)\u0000/g, function (m, idx) {
            return store[Number(idx)];
        });
    }

    function renderInline(text) {
        var store = [];
        var html = escapeHtml(text);

        //Inline code first: its contents are exempt from other formatting
        html = html.replace(/`([^`\n]+)`/g, function (m, code) {
            return stash(store, '<code class="cs-code">' + code + '</code>');
        });
        //Bare links
        html = html.replace(/(https?:\/\/[^\s<]+)/g, function (m, url) {
            return stash(store, '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>');
        });
        //Slack-style markup
        html = html.replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
        html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/gm, "$1<i>$2</i>");
        html = html.replace(/~([^~\n]+)~/g, "<s>$1</s>");
        //Icon shortcodes (the no-emoji stand-in)
        html = html.replace(/:([a-z0-9_]+):/g, function (m, code) {
            if (!ICON_BY_CODE[code]) return m;
            return stash(store, '<i class="' + ICON_BY_CODE[code] + ' icon cs-ic" title=":' + code + ':"></i>');
        });
        //Mentions: real users, broadcast tokens (@everyone/@channel) and
        //the built-in @ai assistant. The name class includes "@" so email
        //style usernames (e.g. admin@example.com) are captured whole instead
        //of stopping at the embedded "@" and only highlighting "admin".
        html = html.replace(/(^|[^A-Za-z0-9_.\-@])@([A-Za-z0-9_.\-@]+)/g, function (m, lead, name) {
            if (BROADCAST_MENTIONS[name.toLowerCase()]) {
                return lead + stash(store, '<span class="mention mention-me">@' + escapeHtml(name) + '</span>');
            }
            if (name.toLowerCase() === AI_HANDLE && !state.users[name]) {
                return lead + stash(store, '<span class="mention mention-ai"><i class="magic icon"></i>@' + escapeHtml(name) + '</span>');
            }
            if (!state.users[name]) return m;
            var cls = name === state.username ? "mention mention-me" : "mention";
            return lead + stash(store, '<span class="' + cls + '" data-user="' + escapeAttr(name) + '">@' + escapeHtml(name) + '</span>');
        });

        //Line-level structures: quotes and bullets
        var lines = html.split("\n");
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf("&gt; ") === 0 || line === "&gt;") {
                var quote = [];
                while (i < lines.length && (lines[i].indexOf("&gt; ") === 0 || lines[i] === "&gt;")) {
                    quote.push(lines[i].replace(/^&gt;\s?/, ""));
                    i++;
                }
                i--;
                out.push('<span class="cs-quote">' + quote.join("\n") + '</span>');
            } else if (line.indexOf("- ") === 0) {
                out.push("&bull; " + line.substring(2));
            } else {
                out.push(line);
            }
        }
        html = out.join("\n");
        return unstash(store, html);
    }

    function renderRich(text) {
        var parts = String(text).split("```");
        if (parts.length < 3) return renderInline(text);
        var html = "";
        for (var i = 0; i < parts.length; i++) {
            if (i % 2 === 1 && i !== parts.length - 1) {
                html += '<pre class="cs-pre">' + escapeHtml(parts[i].replace(/^\n|\n$/g, "")) + '</pre>';
            } else if (i % 2 === 1) {
                html += renderInline("```" + parts[i]);
            } else {
                html += renderInline(parts[i]);
            }
        }
        return html;
    }

    /* ================= Sidebar rendering ================= */

    function isStarred(spaceid) { return state.prefs.starred.indexOf(spaceid) >= 0; }

    function toggleStar(spaceid) {
        var at = state.prefs.starred.indexOf(spaceid);
        if (at >= 0) state.prefs.starred.splice(at, 1);
        else state.prefs.starred.push(spaceid);
        savePrefs();
        renderSidebar();
        renderChannelHeader();
    }

    function convoItemHtml(convo) {
        var active = state.active === convo.id ? " active" : "";
        var unreadCls = convo.unread > 0 ? " unread" : "";
        var badge = "";
        if (convo.kind === "dm" && convo.unread > 0) {
            badge = '<span class="sb-count">' + (convo.unread > 99 ? "99+" : convo.unread) + '</span>';
        } else if (convo.mentions > 0) {
            badge = '<span class="sb-count">' + convo.mentions + '</span>';
        }
        var label = convoLabel(convo);
        var lead;
        if (convo.kind === "dm") {
            var others = dmOthers(convo);
            var first = others[0] || state.username;
            var online = others.length > 0 ? others.some(isOnline) : true;
            lead = '<span class="sb-avatar">' + avatarHtml(first, 10) + '</span>' +
                '<span class="presence-dot' + (online ? " online" : "") + '"></span>';
            if (others.length > 1) label += " (" + (others.length + 1) + ")";
        } else {
            lead = '<i class="' + (convo.desc.access === "private" ? "lock" : "hashtag") + ' icon"></i>';
        }
        return '<div class="sb-item sb-convo' + active + unreadCls + '" data-convo="' + escapeAttr(convo.id) + '">' +
            lead + '<span class="sb-label">' + escapeHtml(label) + '</span>' + badge + '</div>';
    }

    function renderSidebar() {
        if (!state.booted) return;
        var home = $id("sbViewHome");
        var alt = $id("sbViewAlt");
        if (state.railView === "home" && !state.sbNav) {
            home.style.display = "";
            alt.style.display = "none";
            renderHomeSidebar();
        } else {
            home.style.display = "none";
            alt.style.display = "";
            renderAltSidebar();
        }
        renderActivityDot();
        renderDraftCount();
    }

    function renderHomeSidebar() {
        var channels = joinedConvos("channel");
        var dms = joinedConvos("dm");

        var starredHtml = "";
        var starred = channels.concat(dms).filter(function (convo) { return isStarred(convo.id); });
        $id("sbStarredSection").style.display = starred.length > 0 ? "" : "none";
        starred.forEach(function (convo) { starredHtml += convoItemHtml(convo); });
        $id("sbStarredList").innerHTML = starredHtml;

        //Starred conversations are surfaced in the Starred shortcut section
        //but still listed under their own Channels / Direct messages section.
        var chHtml = "";
        channels.forEach(function (convo) { chHtml += convoItemHtml(convo); });
        $id("sbChannelList").innerHTML = chHtml;

        var dmHtml = "";
        dms.forEach(function (convo) { dmHtml += convoItemHtml(convo); });
        $id("sbDmList").innerHTML = dmHtml;

        //Collapse states
        ["starred", "channels", "dms"].forEach(function (key) {
            var title = document.querySelector('[data-collapse="' + key + '"]');
            if (title) {
                title.parentElement.classList.toggle("collapsed", !!state.prefs.collapsed[key]);
            }
        });

        Array.prototype.forEach.call(document.querySelectorAll("#sbViewHome .sb-convo"), function (node) {
            node.addEventListener("click", function () {
                setActive(node.getAttribute("data-convo"));
            });
        });
    }

    function altRowHtml(icon, title, snippet, time, dataAttrs) {
        return '<div class="alt-row" ' + dataAttrs + '>' +
            '<div class="alt-title"><i class="' + icon + ' icon"></i>' + title + '</div>' +
            (snippet ? '<div class="alt-snippet">' + snippet + '</div>' : "") +
            (time ? '<div class="alt-time">' + escapeHtml(time) + '</div>' : "") +
            '</div>';
    }

    function renderAltSidebar() {
        var view = state.sbNav || state.railView;
        var title = { dms: "Direct messages", activity: "Activity", later: "Later", threads: "Threads", drafts: "Drafts & sent" }[view] || "";
        $id("sbAltTitle").textContent = title;
        var html = "";

        if (view === "dms") {
            joinedConvos("dm").forEach(function (convo) {
                var last = convo.roots.length > 0 ? convo.roots[convo.roots.length - 1] : null;
                var snippet = last ? escapeHtml(last.user + ": " + (last.text || last.name)) : "No messages yet";
                html += altRowHtml("user outline", escapeHtml(convoLabel(convo)), snippet,
                    last ? fmtAgo(last.time) : "", 'data-convo="' + escapeAttr(convo.id) + '"');
            });
            if (html === "") html = '<div class="alt-empty">No direct messages yet. Use the + button to start one.</div>';
        } else if (view === "activity") {
            var events = collectActivity();
            events.forEach(function (ev) {
                var convo = state.convos[ev.convoId];
                if (!convo) return;
                var what = ev.type === "mention" ? "mentioned you in" :
                    (ev.type === "reaction" ? "reacted in" : "replied in");
                var where = (convo.kind === "dm" ? "" : "#") + convoLabel(convo);
                var body = ev.type === "reaction"
                    ? '<i class="' + (ICON_BY_CODE[ev.extra] || "smile") + ' icon"></i>'
                    : escapeHtml(String(ev.extra || "").substring(0, 120));
                html += altRowHtml(
                    ev.type === "reaction" ? "smile outline" : (ev.type === "reply" ? "comment outline" : "at"),
                    escapeHtml(ev.user + " " + what + " " + where), body, fmtAgo(ev.time),
                    'data-convo="' + escapeAttr(ev.convoId) + '" data-msg="' + escapeAttr(ev.msgId) + '"');
            });
            if (html === "") html = '<div class="alt-empty">Mentions, replies and reactions to your messages show up here.</div>';
            state.prefs.activitySeen = Math.floor(Date.now() / 1000);
            savePrefs();
        } else if (view === "later") {
            state.prefs.saved.forEach(function (entry) {
                var convo = state.convos[entry.convoId];
                var msg = convo ? convo.msgs[entry.msgId] : null;
                if (!convo || !msg) return;
                html += altRowHtml("bookmark", escapeHtml(msg.user + " in " + (convo.kind === "dm" ? "" : "#") + convoLabel(convo)),
                    escapeHtml((msg.text || msg.name || "").substring(0, 120)), fmtAgo(msg.time),
                    'data-convo="' + escapeAttr(entry.convoId) + '" data-msg="' + escapeAttr(entry.msgId) + '"');
            });
            if (html === "") html = '<div class="alt-empty">Save messages for later with the bookmark action.</div>';
        } else if (view === "threads") {
            var threads = [];
            Object.keys(state.convos).forEach(function (id) {
                var convo = state.convos[id];
                convo.roots.forEach(function (msg) {
                    if (msg.replies.length === 0) return;
                    var involved = msg.user === state.username || msg.replyUsers.indexOf(state.username) >= 0;
                    if (involved) threads.push({ convo: convo, msg: msg });
                });
            });
            threads.sort(function (a, b) { return b.msg.lastReplyTime - a.msg.lastReplyTime; });
            threads.forEach(function (entry) {
                html += altRowHtml("comment outline",
                    escapeHtml((entry.convo.kind === "dm" ? "" : "#") + convoLabel(entry.convo)),
                    escapeHtml(entry.msg.text.substring(0, 100)) +
                    ' <b>&middot; ' + entry.msg.replies.length + ' repl' + (entry.msg.replies.length === 1 ? "y" : "ies") + '</b>',
                    "last reply " + fmtAgo(entry.msg.lastReplyTime),
                    'data-convo="' + escapeAttr(entry.convo.id) + '" data-msg="' + escapeAttr(entry.msg.id) + '" data-thread="1"');
            });
            if (html === "") html = '<div class="alt-empty">Threads you started or replied to show up here.</div>';
        } else if (view === "drafts") {
            Object.keys(state.prefs.drafts).forEach(function (key) {
                var draft = state.prefs.drafts[key];
                if (!draft) return;
                var convoId = key.split("|")[0];
                var convo = state.convos[convoId];
                if (!convo) return;
                html += altRowHtml("edit outline", escapeHtml((convo.kind === "dm" ? "" : "#") + convoLabel(convo)),
                    escapeHtml(draft.substring(0, 120)), "draft",
                    'data-convo="' + escapeAttr(convoId) + '"');
            });
            if (html === "") html = '<div class="alt-empty">Message drafts you have not sent yet show up here.</div>';
        }

        $id("sbAltBody").innerHTML = html;
        Array.prototype.forEach.call(document.querySelectorAll("#sbAltBody .alt-row"), function (node) {
            node.addEventListener("click", function () {
                var convoId = node.getAttribute("data-convo");
                var msgId = node.getAttribute("data-msg");
                if (!convoId) return;
                if (msgId) {
                    jumpToMessage(convoId, msgId, node.getAttribute("data-thread") === "1");
                } else {
                    setActive(convoId);
                }
            });
        });
    }

    function collectActivity() {
        var events = [];
        Object.keys(state.convos).forEach(function (id) {
            events = events.concat(state.convos[id].activity);
        });
        events.sort(function (a, b) { return b.time - a.time; });
        return events.slice(0, 100);
    }

    function renderActivityDot() {
        var latest = 0;
        collectActivity().forEach(function (ev) { if (ev.time > latest) latest = ev.time; });
        $id("railActivityDot").style.display =
            latest > (state.prefs.activitySeen || 0) ? "" : "none";
    }

    /* ---- Activity as a full main-pane view ---- */

    function openActivityView() {
        state.mainView = "activity";
        state.prefs.activitySeen = Math.floor(Date.now() / 1000);
        savePrefs();
        showMobileDetail();
        renderMain();
        renderActivityDot();
    }

    function activityRowHtml(ev, convo) {
        var what = ev.type === "mention" ? "mentioned you in" :
            (ev.type === "reaction" ? "reacted to your message in" : "replied to your thread in");
        var where = (convo.kind === "dm" ? "" : "#") + convoLabel(convo);
        var body = ev.type === "reaction"
            ? '<i class="' + (ICON_BY_CODE[ev.extra] || "smile") + ' icon"></i> reacted with :' + escapeHtml(ev.extra) + ':'
            : escapeHtml(String(ev.extra || "").substring(0, 200));
        return '<div class="ap-row" data-convo="' + escapeAttr(ev.convoId) + '" data-msg="' + escapeAttr(ev.msgId) + '"' +
            (ev.type === "reply" ? ' data-thread="1"' : "") + '>' +
            '<span class="avatar ap-avatar">' + avatarHtml(ev.user, 13) + '</span>' +
            '<div class="ap-main">' +
            '<div class="ap-title"><b>' + escapeHtml(ev.user) + '</b> ' + escapeHtml(what) + ' <b>' + escapeHtml(where) + '</b></div>' +
            '<div class="ap-snippet">' + body + '</div>' +
            '</div>' +
            '<span class="ap-time">' + escapeHtml(fmtAgo(ev.time)) + '</span>' +
            '</div>';
    }

    function renderActivityPane() {
        Array.prototype.forEach.call(document.querySelectorAll(".ap-tab"), function (tab) {
            tab.classList.toggle("active", tab.getAttribute("data-aptab") === state.activityTab);
        });
        var events = collectActivity().filter(function (ev) {
            return state.activityTab === "all" || ev.type === state.activityTab;
        });
        var html = "";
        events.forEach(function (ev) {
            var convo = state.convos[ev.convoId];
            if (convo) html += activityRowHtml(ev, convo);
        });
        if (html === "") {
            html = '<div class="ap-empty"><i class="bell outline icon"></i>' +
                '<h3>Nothing new for you</h3>' +
                '<p>Mentions of you or @everyone, replies to your threads and reactions to your messages show up here.</p></div>';
        }
        $id("apList").innerHTML = html;
        Array.prototype.forEach.call(document.querySelectorAll("#apList .ap-row"), function (row) {
            row.addEventListener("click", function () {
                jumpToMessage(row.getAttribute("data-convo"), row.getAttribute("data-msg"),
                    row.getAttribute("data-thread") === "1");
            });
        });
    }

    function renderDraftCount() {
        var count = 0;
        Object.keys(state.prefs.drafts).forEach(function (key) {
            if (state.prefs.drafts[key]) count++;
        });
        var badge = $id("draftCount");
        badge.style.display = count > 0 ? "" : "none";
        badge.textContent = count;
    }

    /* ================= Main pane rendering ================= */

    function renderAll() {
        renderSidebar();
        renderMain();
        renderRightPanel();
        updateTitleBadge();
    }

    function activeConvo() {
        return state.active ? state.convos[state.active] : null;
    }

    function renderMain() {
        //Activity takes over the whole content pane, Slack style
        if (state.mainView === "activity") {
            $id("channelHeader").style.display = "none";
            $id("emptyState").style.display = "none";
            $id("messages").style.display = "none";
            $id("composerWrap").style.display = "none";
            $id("previewBanner").style.display = "none";
            $id("offlineBanner").style.display = "none";
            $id("typingBar").style.display = "none";
            $id("activityPane").style.display = "";
            renderActivityPane();
            return;
        }
        $id("activityPane").style.display = "none";
        $id("typingBar").style.display = "";

        var convo = activeConvo();
        var has = !!convo;
        $id("channelHeader").style.display = has ? "" : "none";
        $id("emptyState").style.display = has ? "none" : "";
        $id("messages").style.display = has ? "" : "none";
        $id("composerWrap").style.display = has && convo.desc.ismember ? "" : "none";
        $id("previewBanner").style.display = "none";
        if (!has) { renderOfflineBanner(); return; }

        if (!convo.desc.ismember && convo.kind === "channel") {
            $id("previewBanner").style.display = "";
            $id("pvName").textContent = "#" + convoLabel(convo);
        }
        renderChannelHeader();
        renderMessages();
        renderTyping();
        renderOfflineBanner();
        updateComposerPlaceholder();
    }

    function renderOfflineBanner() {
        var convo = activeConvo();
        var show = convo && convo.desc.ismember && !convo.wsOk && state.booted;
        $id("offlineBanner").style.display = show ? "" : "none";
    }

    function renderChannelHeader() {
        var convo = activeConvo();
        if (!convo) return;
        var isDm = convo.kind === "dm";
        var prefixIcon = isDm ? "" :
            (convo.desc.access === "private" ? '<i class="lock icon"></i> ' : '<i class="hashtag icon"></i> ');
        $id("chName").innerHTML = prefixIcon + escapeHtml(convoLabel(convo));

        var star = $id("chStarBtn");
        star.classList.toggle("starred", isStarred(convo.id));
        star.innerHTML = '<i class="star ' + (isStarred(convo.id) ? "" : "outline ") + 'icon"></i>';

        var topic = metaOf(convo.desc)["cs-topic"] || "";
        if (isDm) {
            var others = dmOthers(convo);
            var online = others.length === 0 || others.some(isOnline);
            topic = online ? "Active now" : "Away";
        }
        $id("chTopic").textContent = topic || "Add a topic";

        //Facepile: up to three member avatars + count
        var pile = "";
        var names = Object.keys(convo.members).sort();
        names.slice(0, 3).forEach(function (name) {
            pile += '<span class="avatar">' + avatarHtml(name, 10) + '</span>';
        });
        $id("chFacepile").innerHTML = pile;
        $id("chMemberCount").textContent = names.length || convo.desc.members || "";
    }

    function isScrolledToBottom() {
        var box = $id("messages");
        return box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    }

    function scrollMessagesToBottom() {
        var box = $id("messages");
        box.scrollTop = box.scrollHeight;
    }

    function renderMessages() {
        var convo = activeConvo();
        var box = $id("messages");
        //Keep the reading position on re-render unless the view was
        //already following the newest message
        var stick = box.childElementCount === 0 || isScrolledToBottom();
        var oldScroll = box.scrollTop;
        box.innerHTML = "";
        if (!convo) return;
        if (!convo.loaded) {
            box.innerHTML = '<div class="sysline"><i class="spinner loading icon"></i> Loading messages...</div>';
            return;
        }
        if (convo.roots.length === 0) {
            var label = convo.kind === "dm" ? convoLabel(convo) : "#" + convoLabel(convo);
            box.innerHTML =
                '<div class="sysline" style="padding:20px;">' +
                '<h3 style="margin:0 0 6px 0;color:var(--cs-text);">' +
                (convo.kind === "dm" ? "This is the very beginning of your conversation with <b>" + escapeHtml(label) + "</b>"
                    : "This is the very beginning of the <b>" + escapeHtml(label) + "</b> channel") +
                '</h3>Send a message to get things going.</div>';
            return;
        }

        var lastDay = "";
        var prev = null;
        convo.roots.forEach(function (msg) {
            var day = dayKey(msg.time);
            if (day !== lastDay) {
                lastDay = day;
                var divider = document.createElement("div");
                divider.className = "day-divider";
                divider.innerHTML = '<span class="day-pill" title="Jump to a date">' +
                    escapeHtml(fmtDayLabel(msg.time)) + ' <i class="chevron down icon"></i></span>';
                divider.querySelector(".day-pill").addEventListener("click", function (e) {
                    e.stopPropagation();
                    openJumpMenu(this);
                });
                box.appendChild(divider);
                prev = null;
            }
            var compact = prev && prev.user === msg.user && prev.bot === msg.bot &&
                (msg.time - prev.time) < COMPACT_WINDOW_S && !msg.pinned;
            box.appendChild(buildMsgNode(convo, msg, { compact: compact }));
            prev = msg;
        });
        if (stick) scrollMessagesToBottom();
        else box.scrollTop = oldScroll;
    }

    function buildMsgNode(convo, msg, opts) {
        opts = opts || {};
        var node = document.createElement("div");
        node.className = "msg" + (opts.compact ? " compact" : "");
        node.id = (opts.idPrefix || "msg-") + msg.id;

        //Bot replies render as the assistant (Slack app style), whoever
        //triggered them
        var avatarCell = msg.bot
            ? '<div class="msg-avatar avatar-ai"><i class="magic icon"></i></div>'
            : '<div class="msg-avatar" data-profile="' + escapeAttr(msg.user) + '">' + avatarHtml(msg.user, 16) + '</div>';
        var gutter = '<div class="msg-gutter">' + avatarCell +
            '<div class="msg-hovertime">' + escapeHtml(fmtTime(msg.time)) + '</div>' +
            '</div>';

        var body = "";
        if (msg.pinned) {
            body += '<div class="msg-pin-flag"><i class="thumbtack icon"></i> Pinned to this conversation</div>';
        }
        var authorHtml = msg.bot
            ? '<span class="msg-user">' + escapeHtml(AI_DISPLAY) + '</span><span class="app-badge">APP</span>'
            : '<span class="msg-user" data-profile="' + escapeAttr(msg.user) + '">' + escapeHtml(msg.user) + '</span>';
        body += '<div class="msg-head">' + authorHtml +
            '<span class="msg-time" title="' + escapeAttr(fmtFull(msg.time)) + '">' + escapeHtml(fmtTime(msg.time)) + '</span>' +
            '</div>';

        if (msg.kind === "image" || msg.kind === "file") {
            //Slack-style attachment: a filename bar with a collapse chevron
            //above the preview. Images, video, audio and text files get an
            //inline preview; the download control asks where to save.
            var dlHref = downloadHref(convo.id, msg.id, false);
            var inlineHref = downloadHref(convo.id, msg.id, true);
            var collapsed = !!state.collapsedFiles[msg.id];
            var dlBtn = '<button class="fa-btn dl-menu-btn" data-dl-space="' + escapeAttr(convo.id) +
                '" data-dl-item="' + escapeAttr(msg.id) + '" data-dl-name="' + escapeAttr(msg.name) +
                '" title="Download or save"><i class="download icon"></i></button>';
            body += '<div class="file-head" data-collapse-file="' + escapeAttr(msg.id) + '" ' +
                'title="' + (collapsed ? "Show preview" : "Hide preview") + '">' +
                '<span class="file-head-name">' + escapeHtml(msg.name) + '</span> ' +
                '<i class="chevron ' + (collapsed ? "right" : "down") + ' icon"></i></div>';
            if (collapsed) {
                //nothing else - the bar alone
            } else if (msg.kind === "image") {
                body += '<div class="file-preview">' +
                    '<img class="msg-img" data-lightbox="' + escapeAttr(msg.id) + '" src="' + inlineHref + '" alt="' + escapeAttr(msg.name) + '" title="Click to preview">' +
                    '<div class="file-actions">' + dlBtn +
                    '<a class="fa-btn" href="' + inlineHref + '" target="_blank" rel="noopener" title="Open in new tab"><i class="external alternate icon"></i></a>' +
                    '</div></div>';
            } else if (isVideoName(msg.name)) {
                body += '<div class="file-preview media-preview">' +
                    '<video class="msg-video" controls preload="metadata" src="' + dlHref + '"></video>' +
                    '<div class="media-foot"><span class="file-size">' + formatBytes(msg.size) + '</span>' + dlBtn + '</div></div>';
            } else if (isAudioName(msg.name)) {
                body += '<div class="file-preview media-preview">' +
                    '<audio class="msg-audio" controls preload="metadata" src="' + dlHref + '"></audio>' +
                    '<div class="media-foot"><span class="file-size">' + formatBytes(msg.size) + '</span>' + dlBtn + '</div></div>';
            } else if (isTextName(msg.name) && msg.size <= TEXT_PREVIEW_MAX_BYTES) {
                body += '<div class="file-preview text-preview-wrap">' +
                    '<pre class="text-preview" data-tp-space="' + escapeAttr(convo.id) + '" data-tp-item="' + escapeAttr(msg.id) +
                    '"><span class="tp-loading"><i class="spinner loading icon"></i> Loading preview...</span></pre>' +
                    '<div class="media-foot"><span class="file-size">' + formatBytes(msg.size) + '</span>' + dlBtn + '</div></div>';
            } else {
                body += '<div class="file-preview">' +
                    '<div class="msg-file">' +
                    '<i class="file outline icon"></i>' +
                    '<span><span class="file-name">' + escapeHtml(msg.name) + '</span><br>' +
                    '<span class="file-size">' + formatBytes(msg.size) + '</span></span>' +
                    dlBtn + '</div></div>';
            }
        } else {
            body += '<div class="msg-text">' + renderRich(msg.text) +
                (msg.edited ? ' <span class="msg-edited">(edited)</span>' : "") + '</div>';
        }

        //Reaction pills
        var reactHtml = "";
        var codes = Object.keys(msg.reactions);
        codes.sort();
        codes.forEach(function (code) {
            var users = msg.reactions[code];
            var mine = users.indexOf(state.username) >= 0;
            reactHtml += '<span class="react-pill' + (mine ? " mine" : "") + '" data-react="' + escapeAttr(code) +
                '" title="' + escapeAttr(users.join(", ") + " reacted with :" + code + ":") + '">' +
                '<i class="' + ICON_BY_CODE[code] + ' icon"></i>' + users.length + '</span>';
        });
        if (codes.length > 0) {
            reactHtml += '<span class="react-pill react-add" data-addreact="1" title="Add reaction">' +
                '<i class="smile outline icon"></i><i class="plus icon" style="font-size:9px;"></i></span>';
        }
        if (reactHtml !== "") body += '<div class="msg-reactions">' + reactHtml + '</div>';

        //Thread summary (root messages in the main pane only)
        if (!opts.noThreadBar && msg.replies.length > 0) {
            var pile = "";
            msg.replyUsers.slice(0, 3).forEach(function (user) {
                pile += '<span class="avatar">' + avatarHtml(user, 9) + '</span>';
            });
            body += '<div class="msg-thread-bar" data-thread="' + escapeAttr(msg.id) + '">' + pile +
                '<span>' + msg.replies.length + ' repl' + (msg.replies.length === 1 ? "y" : "ies") + '</span>' +
                '<span class="tb-last">Last reply ' + escapeHtml(fmtAgo(msg.lastReplyTime)) + '</span></div>';
        }

        //Hover toolbar
        var actions = "";
        QUICK_REACTS.forEach(function (code) {
            actions += '<button class="ma-btn" data-react="' + code + '" title="React with :' + code + ':">' +
                '<i class="' + ICON_BY_CODE[code] + ' icon"></i></button>';
        });
        actions += '<button class="ma-btn" data-addreact="1" title="Find another reaction"><i class="smile outline icon"></i></button>';
        if (!opts.noThreadBar) {
            actions += '<button class="ma-btn" data-thread="' + escapeAttr(msg.thread || msg.id) + '" title="Reply in thread"><i class="comment outline icon"></i></button>';
        }
        var saved = isSaved(convo.id, msg.id);
        actions += '<button class="ma-btn' + (saved ? " saved" : "") + '" data-save="1" title="' + (saved ? "Remove from Later" : "Save for later") + '">' +
            '<i class="bookmark ' + (saved ? "" : "outline ") + 'icon"></i></button>';
        actions += '<button class="ma-btn' + (msg.pinned ? " pinned" : "") + '" data-pin="1" title="' + (msg.pinned ? "Unpin" : "Pin to conversation") + '">' +
            '<i class="thumbtack icon"></i></button>';
        if (msg.user === state.username && msg.kind === "text" && !msg.bot) {
            actions += '<button class="ma-btn" data-edit="1" title="Edit message"><i class="pencil icon"></i></button>';
        }
        if (msg.user === state.username || canManage(convo)) {
            actions += '<button class="ma-btn" data-del="1" title="Delete message"><i class="trash icon"></i></button>';
        }

        node.innerHTML = gutter +
            '<div class="msg-main">' + body + '</div>' +
            '<div class="msg-actions">' + actions + '</div>';

        wireMsgNode(node, convo, msg);
        return node;
    }

    function wireMsgNode(node, convo, msg) {
        Array.prototype.forEach.call(node.querySelectorAll("[data-react]"), function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                toggleReaction(convo, msg.id, btn.getAttribute("data-react"));
            });
        });
        Array.prototype.forEach.call(node.querySelectorAll("[data-addreact]"), function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                openIconPicker(btn, function (code) {
                    toggleReaction(convo, msg.id, code);
                });
            });
        });
        Array.prototype.forEach.call(node.querySelectorAll("[data-thread]"), function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                openThread(convo.id, btn.getAttribute("data-thread"));
            });
        });
        var saveBtn = node.querySelector("[data-save]");
        if (saveBtn) {
            saveBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                toggleSaved(convo.id, msg.id);
            });
        }
        var pinBtn = node.querySelector("[data-pin]");
        if (pinBtn) {
            pinBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                togglePin(convo, msg.id);
            });
        }
        var editBtn = node.querySelector("[data-edit]");
        if (editBtn) {
            editBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                startEdit(convo, msg);
            });
        }
        var delBtn = node.querySelector("[data-del]");
        if (delBtn) {
            delBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                deleteMessage(convo, msg.id);
            });
        }
        Array.prototype.forEach.call(node.querySelectorAll("[data-profile]"), function (el) {
            el.addEventListener("click", function (e) {
                e.stopPropagation();
                openProfile(el.getAttribute("data-profile"));
            });
        });
        //Only real-user mentions carry data-user and open a profile; broadcast
        //(@everyone/@channel) and the @ai handle are not people, so skip them.
        Array.prototype.forEach.call(node.querySelectorAll(".mention[data-user]"), function (el) {
            el.addEventListener("click", function (e) {
                e.stopPropagation();
                openProfile(el.getAttribute("data-user"));
            });
        });
        var img = node.querySelector(".msg-img");
        if (img) {
            img.addEventListener("load", function () {
                if (state.active === convo.id && isScrolledToBottom()) scrollMessagesToBottom();
            });
            img.addEventListener("click", function (e) {
                e.stopPropagation();
                openLightbox(convo, msg.id);
            });
        }
        var fileHead = node.querySelector("[data-collapse-file]");
        if (fileHead) {
            fileHead.addEventListener("click", function (e) {
                e.stopPropagation();
                var id = fileHead.getAttribute("data-collapse-file");
                if (state.collapsedFiles[id]) delete state.collapsedFiles[id];
                else state.collapsedFiles[id] = true;
                renderMain();
                renderRightPanel();
            });
        }
        //Download / save-to-ArozOS chooser
        Array.prototype.forEach.call(node.querySelectorAll(".dl-menu-btn"), function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                openDownloadMenu(btn, btn.getAttribute("data-dl-space"),
                    btn.getAttribute("data-dl-item"), btn.getAttribute("data-dl-name"));
            });
        });
        //Text file inline preview: fetch + escape (never rendered as HTML)
        var tp = node.querySelector(".text-preview[data-tp-item]");
        if (tp) fillTextPreview(tp, convo.id, msg.id);
        //Keep the newest message in view once media reports its dimensions
        var media = node.querySelector(".msg-video, .msg-audio");
        if (media) media.addEventListener("loadedmetadata", function () {
            if (state.active === convo.id && isScrolledToBottom()) scrollMessagesToBottom();
        });
    }

    function fillTextPreview(pre, spaceid, itemid) {
        fetch(downloadHref(spaceid, itemid, false), { credentials: "same-origin" })
            .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
            .then(function (text) {
                var truncated = text.length > TEXT_PREVIEW_MAX_CHARS;
                if (truncated) text = text.substring(0, TEXT_PREVIEW_MAX_CHARS);
                //textContent keeps it inert - the file body is never HTML
                pre.textContent = text;
                if (truncated) {
                    var more = document.createElement("div");
                    more.className = "tp-more";
                    more.textContent = "Preview truncated - download the file to see the rest";
                    pre.appendChild(more);
                }
                if (state.active === spaceid && isScrolledToBottom()) scrollMessagesToBottom();
            })
            .catch(function () {
                pre.textContent = "";
                var err = document.createElement("span");
                err.className = "tp-loading";
                err.textContent = "Preview unavailable";
                pre.appendChild(err);
            });
    }

    function appendSysline(text) {
        var box = $id("messages");
        var node = document.createElement("div");
        node.className = "sysline";
        node.textContent = text;
        box.appendChild(node);
        if (isScrolledToBottom()) scrollMessagesToBottom();
    }

    function renderTyping() {
        var convo = activeConvo();
        var bar = $id("typingBar");
        if (!convo) { bar.innerHTML = "&nbsp;"; return; }
        var now = Date.now();
        var names = [];
        Object.keys(convo.typing).forEach(function (user) {
            if (convo.typing[user] > now) names.push(user);
            else delete convo.typing[user];
        });
        if (names.length === 0) {
            bar.innerHTML = "&nbsp;";
        } else if (names.length === 1) {
            bar.innerHTML = "<b>" + escapeHtml(names[0]) + "</b> is typing...";
        } else {
            bar.innerHTML = "<b>" + escapeHtml(names.join(", ")) + "</b> are typing...";
        }
    }

    setInterval(renderTyping, 1500);

    /* ---- image lightbox ---- */

    var lightbox = { convoId: null, images: [], index: 0 };

    function downloadHref(convoId, itemId, inline) {
        return API.download + "?spaceid=" + encodeURIComponent(convoId) +
            "&itemid=" + encodeURIComponent(itemId) + (inline ? "&inline=1" : "");
    }

    //Open the in-app preview over an image message; arrows move through
    //every image of the conversation in chronological order
    function openLightbox(convo, itemId) {
        var images = [];
        Object.keys(convo.msgs).forEach(function (id) {
            if (convo.msgs[id].kind === "image") images.push(convo.msgs[id]);
        });
        images.sort(function (a, b) { return a.time - b.time || (a.id < b.id ? -1 : 1); });
        var index = 0;
        images.forEach(function (msg, i) { if (msg.id === itemId) index = i; });
        lightbox = { convoId: convo.id, images: images, index: index };
        renderLightbox();
        $id("lightbox").style.display = "flex";
    }

    function closeLightbox() {
        $id("lightbox").style.display = "none";
        $id("lbImg").src = "";
    }

    function lightboxOpen() {
        return $id("lightbox").style.display !== "none";
    }

    function renderLightbox() {
        var msg = lightbox.images[lightbox.index];
        if (!msg) { closeLightbox(); return; }
        var img = $id("lbImg");
        img.classList.remove("zoomed");
        img.src = downloadHref(lightbox.convoId, msg.id, true);
        img.alt = msg.name;
        $id("lbAvatar").innerHTML = avatarHtml(msg.user, 12);
        $id("lbUser").textContent = msg.user;
        $id("lbFile").textContent = msg.name + " (" + formatBytes(msg.size) + ")";
        $id("lbDownload").href = downloadHref(lightbox.convoId, msg.id, false);
        $id("lbOpen").href = downloadHref(lightbox.convoId, msg.id, true);
        var multi = lightbox.images.length > 1;
        $id("lbPrev").style.visibility = multi && lightbox.index > 0 ? "" : "hidden";
        $id("lbNext").style.visibility = multi && lightbox.index < lightbox.images.length - 1 ? "" : "hidden";
        $id("lbCounter").textContent = multi ? (lightbox.index + 1) + " of " + lightbox.images.length : "";
    }

    function lightboxNav(step) {
        var next = lightbox.index + step;
        if (next < 0 || next >= lightbox.images.length) return;
        lightbox.index = next;
        renderLightbox();
    }

    /* ---- download / save-to-ArozOS chooser ---- */

    //Trigger a plain browser download of the attachment to the local device
    function downloadToDevice(spaceid, itemid, name) {
        var a = document.createElement("a");
        a.href = downloadHref(spaceid, itemid, false);
        a.download = name || "";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    //Copy the attachment into the user's ArozOS storage. Uses the desktop
    //folder picker when available, else falls back to user:/Desktop.
    function saveToArozOS(spaceid, itemid, name) {
        var doSave = function (folder) {
            showToast("Saving", "Copying " + name + " to " + folder + "...");
            $.post(API.saveToArozOS, { spaceid: spaceid, itemid: itemid, dest: folder }, function (data) {
                var err = apiFail(data);
                if (err) { showToast("Could not save", err); return; }
                showToast("Saved to ArozOS", data.path || folder);
            }, "json").fail(function () {
                showToast("Chatspace", "Could not reach the server to save the file");
            });
        };
        if (typeof ao_module_openFileSelector === "function") {
            //Folder picker (works in the ArozOS desktop and standalone)
            try {
                ao_module_openFileSelector(function (files) {
                    if (files && files.length > 0) doSave(files[0].filepath);
                }, "user:/", "folder", false);
                return;
            } catch (e) { /* fall through to the default location */ }
        }
        doSave("user:/Desktop");
    }

    function openDownloadMenu(anchor, spaceid, itemid, name) {
        var menu = $id("downloadMenu");
        menu.innerHTML =
            '<div class="dl-row" data-dl-act="device"><i class="download icon"></i>' +
            '<div><b>Download to this device</b><span>Save a copy on your computer</span></div></div>' +
            '<div class="dl-row" data-dl-act="arozos"><i class="hdd outline icon"></i>' +
            '<div><b>Save to ArozOS files</b><span>Keep it in your ArozOS storage</span></div></div>';
        menu.style.display = "";
        positionPopover(menu, anchor);
        Array.prototype.forEach.call(menu.querySelectorAll(".dl-row"), function (row) {
            row.addEventListener("click", function (e) {
                e.stopPropagation();
                var act = row.getAttribute("data-dl-act");
                closePickers();
                if (act === "device") downloadToDevice(spaceid, itemid, name);
                else saveToArozOS(spaceid, itemid, name);
            });
        });
    }

    /* ---- day divider "Jump to..." menu ---- */

    //Scroll to the first message on or after the given time (or the last
    //message when everything is older) and flash it.
    function jumpToTime(targetUnix) {
        var convo = activeConvo();
        if (!convo || convo.roots.length === 0) return;
        var target = convo.roots[convo.roots.length - 1];
        for (var i = 0; i < convo.roots.length; i++) {
            if (convo.roots[i].time >= targetUnix) {
                target = convo.roots[i];
                break;
            }
        }
        var node = $id("msg-" + target.id);
        if (node) {
            node.scrollIntoView({ block: "center" });
            node.classList.add("highlight");
            setTimeout(function () { node.classList.remove("highlight"); }, 2500);
        }
    }

    function startOfDay(date) {
        return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
    }

    function openJumpMenu(anchor) {
        var menu = $id("jumpMenu");
        menu.innerHTML =
            '<div class="jm-label">Jump to...</div>' +
            '<div class="jm-row" data-jmp="today">Today</div>' +
            '<div class="jm-row" data-jmp="week">Last week</div>' +
            '<div class="jm-row" data-jmp="month">Last month</div>' +
            '<div class="jm-sep"></div>' +
            '<label class="jm-row jm-date">Jump to a specific date' +
            '<input type="date" id="jmDate"></label>';
        menu.style.display = "";
        positionPopover(menu, anchor);
        Array.prototype.forEach.call(menu.querySelectorAll("[data-jmp]"), function (row) {
            row.addEventListener("click", function (e) {
                e.stopPropagation();
                var now = new Date();
                var kind = row.getAttribute("data-jmp");
                var when = startOfDay(now);
                if (kind === "week") when = startOfDay(new Date(now.getTime() - 7 * 86400000));
                if (kind === "month") when = startOfDay(new Date(now.getTime() - 30 * 86400000));
                closePickers();
                jumpToTime(when);
            });
        });
        var dateInput = $id("jmDate");
        dateInput.addEventListener("click", function (e) { e.stopPropagation(); });
        dateInput.addEventListener("change", function (e) {
            e.stopPropagation();
            if (!this.value) return;
            var parts = this.value.split("-");
            var picked = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            closePickers();
            jumpToTime(startOfDay(picked));
        });
    }

    function jumpToMessage(convoId, msgId, openThreadPanel) {
        var convo = state.convos[convoId];
        if (!convo) return;
        setActive(convoId);
        var apply = function () {
            var msg = convo.msgs[msgId];
            if (msg && msg.thread) {
                openThread(convoId, msg.thread);
                return;
            }
            if (openThreadPanel && msg && msg.replies.length > 0) openThread(convoId, msgId);
            var node = $id("msg-" + msgId);
            if (node) {
                node.scrollIntoView({ block: "center" });
                node.classList.add("highlight");
                setTimeout(function () { node.classList.remove("highlight"); }, 2500);
            }
        };
        if (convo.loaded) {
            apply();
        } else {
            fetchItems(convo, apply);
        }
    }

    /* ================= Saved (Later) ================= */

    function isSaved(convoId, msgId) {
        return state.prefs.saved.some(function (entry) {
            return entry.convoId === convoId && entry.msgId === msgId;
        });
    }

    function toggleSaved(convoId, msgId) {
        var at = -1;
        state.prefs.saved.forEach(function (entry, idx) {
            if (entry.convoId === convoId && entry.msgId === msgId) at = idx;
        });
        if (at >= 0) state.prefs.saved.splice(at, 1);
        else state.prefs.saved.unshift({ convoId: convoId, msgId: msgId });
        savePrefs();
        renderMain();
        renderSidebar();
    }

    /* ================= Right panel ================= */

    //PWA history integration: the thread / profile panel is a full-screen
    //sub-view on mobile, so opening it pushes a single history entry. The
    //device or browser Back button then closes the panel instead of leaving
    //the app, matching the behaviour of a native chat client.
    //  active   - a sentinel entry is currently on the history stack
    //  suppress - true during an internal convo switch, so the transient
    //             close-then-reopen reuses the sentinel instead of unwinding
    //             and re-pushing it (which would race the async popstate).
    var panelHist = { active: false, suppress: false };

    function pushPanelHistory() {
        if (!panelHist.active) {
            panelHist.active = true;
            try { history.pushState({ csPanel: 1 }, ""); } catch (e) { /* history unavailable */ }
        }
    }

    //fromPop === true when invoked from the popstate handler: the browser has
    //already unwound our sentinel, so we must not call history.back() again.
    function closeRightPanel(fromPop) {
        var wasOpen = !!state.rpMode;
        state.rpMode = null;
        state.activeThread = null;
        state.rpProfileUser = null;
        //Drop any in-progress thread-scoped edit so it cannot leak into the
        //main composer's draft/edit state once the panel is gone.
        if (state.editing && state.editing.thread) state.editing = null;
        $id("rightPanel").style.display = "none";
        if (!wasOpen || panelHist.suppress) return;
        if (fromPop) { panelHist.active = false; return; }
        if (panelHist.active) {
            //UI dismissal (close button / Esc / convo switch): consume the entry
            panelHist.active = false;
            try { history.back(); } catch (e) { /* history unavailable */ }
        }
    }

    function openThread(convoId, rootId) {
        //Switching convo may close a currently open thread; suppress the
        //history unwind during that internal transition so we reuse the
        //sentinel we are about to keep (avoids an async popstate race).
        if (state.active !== convoId) {
            panelHist.suppress = true;
            setActive(convoId);
            panelHist.suppress = false;
        }
        state.rpMode = "thread";
        state.activeThread = rootId;
        pushPanelHistory();
        renderRightPanel();
        restoreDraft(true);
        var input = $id("rpComposeInput");
        if (input) input.focus();
    }

    function openDetails() {
        if (!activeConvo()) return;
        state.detailsTab = "about";
        renderDetailsModal();
        openModal("detailsModal");
    }

    function detailsModalOpen() {
        return $id("detailsModal").style.display !== "none";
    }

    function openProfile(username) {
        state.rpMode = "profile";
        state.rpProfileUser = username;
        pushPanelHistory();
        renderRightPanel();
    }

    function renderRightPanel() {
        var panel = $id("rightPanel");
        if (!state.rpMode) { panel.style.display = "none"; return; }
        var convo = activeConvo();
        if (state.rpMode !== "profile" && !convo) { closeRightPanel(); return; }
        panel.style.display = "flex";
        $id("rpComposerWrap").style.display = "none";

        if (state.rpMode === "thread") {
            renderThreadPanel(convo);
        } else if (state.rpMode === "profile") {
            renderProfilePanel(state.rpProfileUser);
        }
    }

    function renderThreadPanel(convo) {
        var root = convo.msgs[state.activeThread];
        $id("rpTitle").textContent = "Thread";
        $id("rpSubtitle").textContent = (convo.kind === "dm" ? "" : "#") + convoLabel(convo);
        var body = $id("rpBody");
        body.innerHTML = "";
        if (!root) {
            body.innerHTML = '<div class="sysline">This message was deleted.</div>';
            return;
        }
        body.appendChild(buildMsgNode(convo, root, { noThreadBar: true, idPrefix: "th-" }));
        if (root.replies.length > 0) {
            var divider = document.createElement("div");
            divider.className = "rp-replies-divider";
            divider.textContent = root.replies.length + " repl" + (root.replies.length === 1 ? "y" : "ies");
            body.appendChild(divider);
        }
        var prev = null;
        root.replies.forEach(function (replyId) {
            var reply = convo.msgs[replyId];
            if (!reply) return;
            var compact = prev && prev.user === reply.user && (reply.time - prev.time) < COMPACT_WINDOW_S;
            body.appendChild(buildMsgNode(convo, reply, { noThreadBar: true, compact: compact, idPrefix: "th-" }));
            prev = reply;
        });
        if (convo.desc.ismember) $id("rpComposerWrap").style.display = "";
        body.scrollTop = body.scrollHeight;
    }

    //Slack-style tabbed channel details modal (About / Members / Settings)
    function renderDetailsModal() {
        var convo = activeConvo();
        if (!convo) { closeModal("detailsModal"); return; }
        var isDm = convo.kind === "dm";
        var meta = metaOf(convo.desc);
        var manager = canManage(convo);

        var prefixIcon = isDm ? "" :
            (convo.desc.access === "private" ? '<i class="lock icon"></i> ' : '<i class="hashtag icon"></i> ');
        $id("dtName").innerHTML = prefixIcon + escapeHtml(convoLabel(convo));
        $id("dtStarBtn").innerHTML = '<i class="star ' + (isStarred(convo.id) ? "" : "outline ") + 'icon"></i> ' +
            (isStarred(convo.id) ? "Starred" : "Star");
        $id("dtMemberCount").textContent = Object.keys(convo.members).length || convo.desc.members || 0;
        Array.prototype.forEach.call(document.querySelectorAll(".dt-tab"), function (tab) {
            tab.classList.toggle("active", tab.getAttribute("data-dtab") === state.detailsTab);
        });

        if (state.detailsTab === "about") renderDetailsAbout(convo, meta, manager, isDm);
        else if (state.detailsTab === "members") renderDetailsMembers(convo, manager);
        else renderDetailsSettings(convo, manager, isDm);
    }

    function renderDetailsAbout(convo, meta, manager, isDm) {
        var html = "";
        html += '<div class="dt-section"><h4>Topic</h4><div class="dt-value">' +
            (meta["cs-topic"] ? escapeHtml(meta["cs-topic"]) : '<span style="color:var(--cs-muted);">Add a topic</span>') +
            (manager ? '<span class="rp-editlink" id="dtEditTopic">Edit</span>' : "") + '</div></div>';
        if (!isDm) {
            html += '<div class="dt-section"><h4>Description</h4><div class="dt-value">' +
                (meta["cs-desc"] ? escapeHtml(meta["cs-desc"]) : '<span style="color:var(--cs-muted);">Add a description</span>') +
                (manager ? '<span class="rp-editlink" id="dtEditDesc">Edit</span>' : "") + '</div></div>';
            html += '<div class="dt-section"><h4>Created by</h4><div class="dt-value">' +
                escapeHtml(convo.desc.owner) + ' on ' +
                new Date((convo.desc.createdat || 0) * 1000).toLocaleDateString() + '</div>' +
                '<div class="rp-sub">' + escapeHtml(convo.desc.access) + " channel" +
                (convo.desc.persistent ? "" : " &middot; not persistent (history is lost on server restart)") +
                '</div></div>';
        }
        //Pinned messages
        var pinned = convo.roots.filter(function (msg) { return msg.pinned; });
        if (pinned.length > 0) {
            html += '<div class="dt-section"><h4><i class="thumbtack icon"></i> Pinned</h4>';
            pinned.forEach(function (msg) {
                html += '<div class="dt-value" style="cursor:pointer;padding:3px 0;" data-jump="' + escapeAttr(msg.id) + '">' +
                    '<b>' + escapeHtml(msg.user) + ':</b> ' +
                    escapeHtml((msg.text || msg.name || "").substring(0, 80)) + '</div>';
            });
            html += '</div>';
        }
        html += '<div class="dt-section" style="border-bottom:none;"><div class="rp-sub">Conversation ID: ' +
            escapeHtml(convo.id) + '</div></div>';

        var body = $id("dtBody");
        body.innerHTML = html;
        var editTopic = $id("dtEditTopic");
        if (editTopic) editTopic.addEventListener("click", function () { editTopicPrompt(convo); });
        var editDesc = $id("dtEditDesc");
        if (editDesc) editDesc.addEventListener("click", function () { editDescPrompt(convo); });
        Array.prototype.forEach.call(body.querySelectorAll("[data-jump]"), function (row) {
            row.addEventListener("click", function () {
                closeModal("detailsModal");
                jumpToMessage(convo.id, row.getAttribute("data-jump"));
            });
        });
    }

    function renderDetailsMembers(convo, manager) {
        var body = $id("dtBody");
        body.innerHTML =
            '<div class="dt-find"><i class="search icon"></i>' +
            '<input type="text" id="dtMemberFilter" placeholder="Find members" autocomplete="off"></div>' +
            '<div class="rp-action-row" id="dtInviteBtn"><span class="dt-addicon"><i class="user plus icon"></i></span>Add people</div>' +
            '<div id="dtMemberRows"></div>';

        var renderRows = function () {
            var filter = $id("dtMemberFilter").value.trim().toLowerCase();
            var names = Object.keys(convo.members).sort();
            var html = "";
            names.forEach(function (name) {
                if (filter && name.toLowerCase().indexOf(filter) < 0) return;
                var role = convo.members[name];
                var roleTag = role === "owner" ? "Channel Manager" : (role === "admin" ? "Admin" : "");
                html += '<div class="rp-member-row" data-member="' + escapeAttr(name) + '">' +
                    '<span class="avatar">' + avatarHtml(name, 11) + '</span>' +
                    '<span class="presence-dot' + (isOnline(name) ? " online" : "") + '" style="margin:0;border-color:#fff;"></span>' +
                    '<span class="member-name">' + escapeHtml(name) + (name === state.username ? " (you)" : "") + '</span>' +
                    (roleTag ? '<span class="dt-role-tag">' + escapeHtml(roleTag) + '</span>' : "") +
                    (manager && name !== state.username && name !== convo.desc.owner
                        ? '<button class="member-remove" data-kick="' + escapeAttr(name) + '" title="Remove">Remove</button>' : "") +
                    '</div>';
            });
            if (html === "") html = '<div class="alt-empty" style="color:var(--cs-muted);">Nobody matches</div>';
            $id("dtMemberRows").innerHTML = html;

            Array.prototype.forEach.call(document.querySelectorAll("#dtMemberRows [data-kick]"), function (btn) {
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    var target = btn.getAttribute("data-kick");
                    if (!confirm("Remove " + target + " from this conversation?")) return;
                    $.post(API.membersRemove, { spaceid: convo.id, username: target }, function (data) {
                        var err = apiFail(data);
                        if (err) showToast("Could not remove", err);
                    }, "json");
                });
            });
            Array.prototype.forEach.call(document.querySelectorAll("#dtMemberRows .rp-member-row"), function (row) {
                row.addEventListener("click", function () {
                    closeModal("detailsModal");
                    openProfile(row.getAttribute("data-member"));
                });
            });
        };
        renderRows();
        $id("dtMemberFilter").addEventListener("input", renderRows);
        $id("dtInviteBtn").addEventListener("click", function () {
            closeModal("detailsModal");
            openInviteModal(convo);
        });
    }

    function renderDetailsSettings(convo, manager, isDm) {
        var html = "";
        if (!isDm && manager) {
            html += '<div class="rp-action-row" id="dtRenameBtn"><i class="pencil icon"></i>Rename channel</div>';
            html += '<div class="rp-action-row" id="dtAccessBtn"><i class="' +
                (convo.desc.access === "private" ? "unlock" : "lock") + ' icon"></i>Change to a ' +
                (convo.desc.access === "private" ? "public" : "private") + ' channel</div>';
        }
        if (!isDm && convoLabel(convo) !== "general") {
            html += '<div class="rp-action-row danger" id="dtLeaveBtn"><i class="sign out icon"></i>Leave channel</div>';
        }
        if (manager) {
            html += '<div class="rp-action-row danger" id="dtDeleteBtn"><i class="trash icon"></i>Delete this ' +
                (isDm ? "conversation" : "channel") + '</div>';
        }
        if (html === "") {
            html = '<div class="alt-empty" style="color:var(--cs-muted);">Only channel managers can change the settings here.</div>';
        }
        $id("dtBody").innerHTML = html;

        var rename = $id("dtRenameBtn");
        if (rename) rename.addEventListener("click", function () { renameChannelPrompt(convo); });
        var access = $id("dtAccessBtn");
        if (access) access.addEventListener("click", function () { toggleChannelAccess(convo); });
        var leave = $id("dtLeaveBtn");
        if (leave) leave.addEventListener("click", function () {
            closeModal("detailsModal");
            leaveConvo(convo);
        });
        var del = $id("dtDeleteBtn");
        if (del) del.addEventListener("click", function () {
            closeModal("detailsModal");
            deleteConvo(convo);
        });
    }

    function renderProfilePanel(username) {
        $id("rpTitle").textContent = "Profile";
        $id("rpSubtitle").textContent = "";
        var online = isOnline(username);
        var html = '<div class="rp-profile">' +
            '<div class="avatar">' + avatarHtml(username, 64) + '</div>' +
            '<h3>' + escapeHtml(username) + '</h3>' +
            '<div class="rp-presence"><span class="presence-dot' + (online ? " online" : "") + '"></span>' +
            (online ? "Active" : "Away") + '</div></div>';
        if (username !== state.username) {
            html += '<div class="rp-action-row" id="rpDmBtn"><i class="comment outline icon"></i>Send a direct message</div>';
        }
        var groups = state.users[username] ? state.users[username].groups : [];
        if (groups && groups.length > 0) {
            html += '<div class="rp-section"><h4>Groups</h4><div class="rp-value">' +
                escapeHtml(groups.join(", ")) + '</div></div>';
        }
        $id("rpBody").innerHTML = html;
        var dmBtn = $id("rpDmBtn");
        if (dmBtn) dmBtn.addEventListener("click", function () { openDmWith([username]); });
    }

    /* ================= Channel management actions ================= */

    function editTopicPrompt(convo) {
        var current = metaOf(convo.desc)["cs-topic"] || "";
        var topic = prompt("Set the topic for this conversation:", current);
        if (topic === null) return;
        $.post(API.meta, { spaceid: convo.id, key: "cs-topic", value: topic }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not set topic", err); return; }
            convo.desc.metadata = convo.desc.metadata || {};
            convo.desc.metadata["cs-topic"] = topic;
            renderChannelHeader();
            if (detailsModalOpen()) renderDetailsModal();
        }, "json");
    }

    function editDescPrompt(convo) {
        var current = metaOf(convo.desc)["cs-desc"] || "";
        var desc = prompt("Set the description for this channel:", current);
        if (desc === null) return;
        $.post(API.meta, { spaceid: convo.id, key: "cs-desc", value: desc }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not set description", err); return; }
            convo.desc.metadata = convo.desc.metadata || {};
            convo.desc.metadata["cs-desc"] = desc;
            if (detailsModalOpen()) renderDetailsModal();
        }, "json");
    }

    function toggleChannelAccess(convo) {
        var target = convo.desc.access === "private" ? "public" : "private";
        var note = target === "private"
            ? "Only invited members will be able to see or join it."
            : "Anyone on this server will be able to find and join it.";
        if (!confirm("Change #" + convoLabel(convo) + " to a " + target + " channel? " + note)) return;
        $.post(API.access, { spaceid: convo.id, access: target }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not change visibility", err); return; }
            convo.desc.access = target;
            renderAll();
            if (detailsModalOpen()) renderDetailsModal();
        }, "json");
    }

    function renameChannelPrompt(convo) {
        var current = convoLabel(convo);
        var name = prompt("Rename this channel:", current);
        if (name === null) return;
        name = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_]/g, "");
        if (name === "") { showToast("Rename", "That name is not valid"); return; }
        $.post(API.meta, { spaceid: convo.id, key: "cs-name", value: name }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not rename", err); return; }
            convo.desc.metadata = convo.desc.metadata || {};
            convo.desc.metadata["cs-name"] = name;
            renderAll();
        }, "json");
    }

    function leaveConvo(convo) {
        if (!confirm("Leave " + (convo.kind === "dm" ? "this conversation" : "#" + convoLabel(convo)) + "?")) return;
        $.post(API.leave, { spaceid: convo.id }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not leave", err); return; }
            removeConvo(convo.id);
            renderAll();
        }, "json");
    }

    function deleteConvo(convo) {
        var label = convo.kind === "dm" ? "this conversation" : "#" + convoLabel(convo);
        if (!confirm("Delete " + label + " for everyone? All messages and files will be removed.")) return;
        $.post(API.del, { spaceid: convo.id }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not delete", err); return; }
            removeConvo(convo.id);
            renderAll();
        }, "json");
    }

    function joinActiveChannel() {
        var convo = activeConvo();
        if (!convo) return;
        $.post(API.join, { spaceid: convo.id }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not join", err); return; }
            convo.desc.ismember = true;
            convo.desc.myrole = "member";
            convo.members[state.username] = "member";
            connectConvo(convo);
            bootstrapWorkspace(function () { renderAll(); });
        }, "json");
    }

    /* ================= Composer ================= */

    function draftKey(thread) {
        return (state.active || "") + (thread ? "|" + state.activeThread : "");
    }

    function saveDraft() {
        if (!state.active) return;
        var main = $id("composeInput").value;
        if (main.trim() !== "" && !state.editing) state.prefs.drafts[draftKey(false)] = main;
        else delete state.prefs.drafts[draftKey(false)];
        if (state.activeThread) {
            var reply = $id("rpComposeInput").value;
            if (reply.trim() !== "") state.prefs.drafts[draftKey(true)] = reply;
            else delete state.prefs.drafts[draftKey(true)];
        }
        savePrefs();
        renderDraftCount();
    }

    function restoreDraft(threadOnly) {
        if (!threadOnly) {
            $id("composeInput").value = state.prefs.drafts[draftKey(false)] || "";
            autoGrow($id("composeInput"));
            refreshSendButtons();
        }
        if (state.activeThread) {
            $id("rpComposeInput").value = state.prefs.drafts[draftKey(true)] || "";
            refreshSendButtons();
        }
    }

    function updateComposerPlaceholder() {
        var convo = activeConvo();
        var input = $id("composeInput");
        if (!convo) return;
        if (state.editing) {
            input.placeholder = "Edit your message - Enter to save, Esc to cancel";
        } else {
            input.placeholder = "Message " + (convo.kind === "dm" ? convoLabel(convo) : "#" + convoLabel(convo));
        }
    }

    function autoGrow(textarea) {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
    }

    function refreshSendButtons() {
        $id("sendBtn").disabled = $id("composeInput").value.trim() === "";
        $id("rpSendBtn").disabled = $id("rpComposeInput").value.trim() === "";
    }

    function submitComposer() {
        var convo = activeConvo();
        if (!convo || !convo.desc.ismember) return;
        var input = $id("composeInput");
        var text = input.value.trim();
        if (text === "") return;
        if (text.length > MAX_MSG_LEN) {
            showToast("Message too long", "Messages are capped at " + MAX_MSG_LEN + " characters");
            return;
        }
        if (state.editing && !state.editing.thread) {
            sendEdit(convo, state.editing.itemId, text);
            state.editing = null;
            updateComposerPlaceholder();
        } else {
            sendMessage(convo, text, null, false);
        }
        input.value = "";
        autoGrow(input);
        delete state.prefs.drafts[draftKey(false)];
        savePrefs();
        refreshSendButtons();
        renderDraftCount();
    }

    function submitThreadComposer() {
        var convo = activeConvo();
        if (!convo || !state.activeThread) return;
        var input = $id("rpComposeInput");
        var text = input.value.trim();
        if (text === "" || text.length > MAX_MSG_LEN) return;
        if (state.editing && state.editing.thread) {
            sendEdit(convo, state.editing.itemId, text);
            state.editing = null;
        } else {
            sendMessage(convo, text, state.activeThread, $id("rpAlsoSend").checked);
        }
        input.value = "";
        autoGrow(input);
        $id("rpAlsoSend").checked = false;
        delete state.prefs.drafts[draftKey(true)];
        savePrefs();
        refreshSendButtons();
        renderDraftCount();
    }

    function startEdit(convo, msg) {
        if (state.active !== convo.id) setActive(convo.id);
        state.editing = { convoId: convo.id, itemId: msg.id };
        var input = $id("composeInput");
        input.value = msg.text;
        autoGrow(input);
        updateComposerPlaceholder();
        refreshSendButtons();
        input.focus();
    }

    //Edit a reply from inside the open thread panel (parity with the main
    //composer's inline edit); keeps the edit bound to the thread composer.
    function startEditInThread(convo, msg) {
        state.editing = { convoId: convo.id, itemId: msg.id, thread: true };
        var input = $id("rpComposeInput");
        input.value = msg.text;
        autoGrow(input);
        input.placeholder = "Edit your reply - Enter to save, Esc to cancel";
        refreshSendButtons();
        input.focus();
    }

    function cancelThreadEdit() {
        if (!state.editing || !state.editing.thread) return;
        state.editing = null;
        var input = $id("rpComposeInput");
        input.value = state.prefs.drafts[draftKey(true)] || "";
        input.placeholder = "Reply...";
        autoGrow(input);
        refreshSendButtons();
    }

    function editLastOwnMessage() {
        var convo = activeConvo();
        if (!convo) return;
        for (var i = convo.roots.length - 1; i >= 0; i--) {
            var msg = convo.roots[i];
            if (msg.user === state.username && msg.kind === "text") {
                startEdit(convo, msg);
                return;
            }
        }
    }

    //Up-arrow-to-edit inside the thread panel: pick the last own reply
    function editLastOwnThreadReply() {
        var convo = activeConvo();
        if (!convo || !state.activeThread) return;
        var root = convo.msgs[state.activeThread];
        if (!root) return;
        for (var i = root.replies.length - 1; i >= 0; i--) {
            var msg = convo.msgs[root.replies[i]];
            if (msg && msg.user === state.username && msg.kind === "text" && !msg.bot) {
                startEditInThread(convo, msg);
                return;
            }
        }
    }

    //Shared keydown logic for both composers. `opts.thread` selects the
    //thread composer behaviour (reply submit / thread-scoped inline edit).
    function composerKeydown(e, opts) {
        var input = e.currentTarget;
        //Mention autocomplete captures navigation keys while it is open
        if (mentionPickerOpen()) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                moveMentionSelection(1);
                return;
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                moveMentionSelection(-1);
                return;
            } else if (e.key === "Enter" || e.key === "Tab") {
                if (confirmMention()) { e.preventDefault(); return; }
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closePickers();
                return;
            }
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (opts.thread) submitThreadComposer();
            else submitComposer();
        } else if (e.key === "Escape" && state.editing) {
            //Cancel an in-progress inline edit (do not also close the thread)
            e.stopPropagation();
            if (opts.thread) cancelThreadEdit();
            else {
                state.editing = null;
                input.value = state.prefs.drafts[draftKey(false)] || "";
                updateComposerPlaceholder();
                refreshSendButtons();
            }
        } else if (e.key === "ArrowUp" && input.value === "") {
            if (opts.thread) editLastOwnThreadReply();
            else editLastOwnMessage();
        }
    }

    //Wrap the current textarea selection in markdown-style tokens
    function applyFormat(kind) {
        var input = $id("composeInput");
        var start = input.selectionStart;
        var end = input.selectionEnd;
        var value = input.value;
        var selected = value.substring(start, end);
        var replaced;
        if (kind === "bold") replaced = "*" + selected + "*";
        else if (kind === "italic") replaced = "_" + selected + "_";
        else if (kind === "strike") replaced = "~" + selected + "~";
        else if (kind === "code") replaced = "`" + selected + "`";
        else if (kind === "codeblock") replaced = "```\n" + selected + "\n```";
        else if (kind === "link") replaced = selected + " https://";
        else if (kind === "quote") {
            replaced = selected.split("\n").map(function (line) { return "> " + line; }).join("\n");
        } else if (kind === "ul") {
            replaced = selected.split("\n").map(function (line) { return "- " + line; }).join("\n");
        } else if (kind === "ol") {
            replaced = selected.split("\n").map(function (line, idx) { return (idx + 1) + ". " + line; }).join("\n");
        } else {
            return;
        }
        input.value = value.substring(0, start) + replaced + value.substring(end);
        input.focus();
        var cursor = start + replaced.length - (selected === "" && "*_~`".indexOf(replaced.charAt(replaced.length - 1)) >= 0 ? 1 : 0);
        input.setSelectionRange(cursor, cursor);
        autoGrow(input);
        refreshSendButtons();
    }

    /* ================= Uploads ================= */

    function uploadFiles(fileList) {
        var convo = activeConvo();
        if (!convo || !convo.desc.ismember) return;
        Array.prototype.forEach.call(fileList, function (file) {
            var form = new FormData();
            form.append("spaceid", convo.id);
            form.append("file", file, file.name);
            showToast("Uploading", file.name);
            fetch(API.upload, { method: "POST", body: form }).then(function (r) {
                return r.json();
            }).then(function (data) {
                if (data.error !== undefined) {
                    showToast("Upload failed", data.error);
                    return;
                }
                //The item event over the socket renders it; resync if the
                //socket is down
                if (!convo.wsOk) fetchItems(convo);
            }).catch(function () {
                showToast("Upload failed", file.name);
            });
        });
    }

    /* ================= Icon picker / mention picker popovers ================= */

    var iconPickCallback = null;

    function openIconPicker(anchor, callback) {
        iconPickCallback = callback;
        var picker = $id("iconPicker");
        var html = '<div class="ip-title">Pick an icon</div><div class="ip-grid">';
        ICON_SET.forEach(function (entry) {
            html += '<button class="ip-cell" data-code="' + entry.code + '" title=":' + entry.code + ':">' +
                '<i class="' + entry.icon + ' icon"></i></button>';
        });
        html += '</div>';
        picker.innerHTML = html;
        picker.style.display = "";
        positionPopover(picker, anchor);
        Array.prototype.forEach.call(picker.querySelectorAll(".ip-cell"), function (cell) {
            cell.addEventListener("click", function (e) {
                e.stopPropagation();
                closePickers();
                if (iconPickCallback) iconPickCallback(cell.getAttribute("data-code"));
            });
        });
    }

    function positionPopover(popover, anchor) {
        var rect = anchor.getBoundingClientRect();
        popover.style.visibility = "hidden";
        popover.style.left = "0px";
        popover.style.top = "0px";
        var w = popover.offsetWidth;
        var h = popover.offsetHeight;
        var left = Math.min(rect.left, window.innerWidth - w - 8);
        var top = rect.top - h - 6;
        if (top < 8) top = rect.bottom + 6;
        popover.style.left = Math.max(8, left) + "px";
        popover.style.top = top + "px";
        popover.style.visibility = "";
    }

    function anyPickerOpen() {
        return ["iconPicker", "mentionPicker", "jumpMenu", "downloadMenu"].some(function (id) {
            return $id(id).style.display !== "none";
        });
    }

    function closePickers() {
        $id("iconPicker").style.display = "none";
        $id("mentionPicker").style.display = "none";
        $id("jumpMenu").style.display = "none";
        $id("downloadMenu").style.display = "none";
        mentionMode = null;
    }

    document.addEventListener("click", function (e) {
        if (!$id("iconPicker").contains(e.target) && !$id("mentionPicker").contains(e.target) &&
            !$id("jumpMenu").contains(e.target) && !$id("downloadMenu").contains(e.target)) {
            closePickers();
        }
        if (!$id("searchBox").contains(e.target)) {
            $id("searchResults").style.display = "none";
        }
    });

    //Mention autocomplete over a composer: opened by the @ button or by
    //typing "@..." at the caret. The picker is fully keyboard driven -
    //Up/Down move the highlight, Enter/Tab confirm, Esc dismisses - and it
    //works over whichever composer (main or thread) currently has focus.
    var mentionMode = null; // {prefixStart, input, anchor} when open

    function mentionPickerOpen() {
        return !!mentionMode && $id("mentionPicker").style.display !== "none";
    }

    function openMentionPicker(filter, prefixStart, input, anchor) {
        var convo = activeConvo();
        if (!convo) return;
        input = input || $id("composeInput");
        anchor = anchor || $id("composer");
        mentionMode = { prefixStart: prefixStart, input: input, anchor: anchor };
        var picker = $id("mentionPicker");
        var lowered = (filter || "").toLowerCase();
        var candidates = [];
        //Built-in handles first: the AI assistant and, in channels, the
        //broadcast mention that pings every member
        if (AI_HANDLE.indexOf(lowered) === 0) {
            candidates.push({ name: AI_HANDLE, special: '<i class="magic icon"></i>', sub: AI_DISPLAY });
        }
        if ("everyone".indexOf(lowered) === 0) {
            candidates.push({ name: "everyone", special: '<i class="users icon"></i>', sub: "Notify everyone here" });
        }
        state.userOrder.forEach(function (name) {
            if (name.toLowerCase().indexOf(lowered) === 0 && name !== state.username) {
                candidates.push({ name: name });
            }
        });
        candidates = candidates.slice(0, 9);
        if (candidates.length === 0) { closePickers(); return; }
        var html = "";
        candidates.forEach(function (entry, idx) {
            var lead = entry.special
                ? '<span class="avatar avatar-ai">' + entry.special + '</span>'
                : '<span class="avatar">' + avatarHtml(entry.name, 10) + '</span>';
            html += '<div class="mp-row' + (idx === 0 ? " selected" : "") + '" data-name="' + escapeAttr(entry.name) + '">' +
                lead + escapeHtml(entry.name) +
                (entry.sub ? ' <span class="mp-sub">' + escapeHtml(entry.sub) + '</span>' : "") +
                (!entry.special && isOnline(entry.name) ? ' <span class="presence-dot online" style="margin:0;"></span>' : "") + '</div>';
        });
        picker.innerHTML = html;
        picker.style.display = "";
        positionPopover(picker, anchor);
        Array.prototype.forEach.call(picker.querySelectorAll(".mp-row"), function (row) {
            row.addEventListener("mousedown", function (e) {
                //mousedown (not click) so the composer keeps focus/selection
                e.preventDefault();
                e.stopPropagation();
                insertMention(row.getAttribute("data-name"));
            });
        });
    }

    //Move the mention highlight by delta (wraps around) and keep it visible
    function moveMentionSelection(delta) {
        var rows = $id("mentionPicker").querySelectorAll(".mp-row");
        if (rows.length === 0) return;
        var cur = 0;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].classList.contains("selected")) { cur = i; break; }
        }
        rows[cur].classList.remove("selected");
        var next = (cur + delta + rows.length) % rows.length;
        rows[next].classList.add("selected");
        rows[next].scrollIntoView({ block: "nearest" });
    }

    //Confirm the highlighted mention; returns false when nothing is picked
    function confirmMention() {
        var selected = $id("mentionPicker").querySelector(".mp-row.selected") ||
            $id("mentionPicker").querySelector(".mp-row");
        if (!selected) return false;
        insertMention(selected.getAttribute("data-name"));
        return true;
    }

    function insertMention(name) {
        var input = (mentionMode && mentionMode.input) || $id("composeInput");
        var caret = input.selectionStart;
        var start = mentionMode ? mentionMode.prefixStart : caret;
        input.value = input.value.substring(0, start) + "@" + name + " " + input.value.substring(caret);
        closePickers();
        input.focus();
        var pos = start + name.length + 2;
        input.setSelectionRange(pos, pos);
        refreshSendButtons();
    }

    function detectMentionTyping(input, anchor) {
        input = input || $id("composeInput");
        var caret = input.selectionStart;
        var upto = input.value.substring(0, caret);
        var match = upto.match(/(^|[\s(])@([A-Za-z0-9_.\-@]*)$/);
        if (match) {
            openMentionPicker(match[2], caret - match[2].length - 1, input, anchor);
        } else if (mentionMode) {
            closePickers();
        }
    }

    /* ================= Modals ================= */

    function openModal(id) { $id(id).style.display = "flex"; }
    function closeModal(id) { $id(id).style.display = "none"; }

    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (btn) {
        btn.addEventListener("click", function () {
            closeModal(btn.getAttribute("data-close"));
        });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".cs-overlay"), function (overlay) {
        overlay.addEventListener("mousedown", function (e) {
            if (e.target === overlay) overlay.style.display = "none";
        });
    });

    /* ---- create channel ---- */

    function openCreateModal() {
        $id("ncName").value = "";
        $id("ncDesc").value = "";
        $id("ncPrivate").checked = false;
        $id("ncError").style.display = "none";
        openModal("createModal");
        $id("ncName").focus();
    }

    function submitCreateChannel() {
        var name = $id("ncName").value.trim();
        if (name === "") {
            $id("ncError").textContent = "A channel needs a name";
            $id("ncError").style.display = "";
            return;
        }
        $.post(API.createChannel, {
            name: name,
            desc: $id("ncDesc").value.trim(),
            access: $id("ncPrivate").checked ? "private" : "public"
        }, function (data) {
            var err = apiFail(data);
            if (err) {
                $id("ncError").textContent = err;
                $id("ncError").style.display = "";
                return;
            }
            closeModal("createModal");
            var convo = upsertConvo(data);
            connectConvo(convo);
            fetchItems(convo);
            setActive(convo.id);
        }, "json").fail(function () {
            $id("ncError").textContent = "Could not reach the server";
            $id("ncError").style.display = "";
        });
    }

    /* ---- browse channels ---- */

    function openBrowseModal() {
        $id("browseFilter").value = "";
        renderBrowseList();
        openModal("browseModal");
        //Refresh the public directory while the modal is open
        bootstrapWorkspace(function () { renderBrowseList(); });
    }

    function renderBrowseList() {
        var filter = $id("browseFilter").value.trim().toLowerCase();
        var rows = [];
        joinedConvos("channel").forEach(function (convo) {
            rows.push({ desc: convo.desc, joined: true });
        });
        state.directory.forEach(function (desc) {
            rows.push({ desc: desc, joined: false });
        });
        rows.sort(function (a, b) {
            var an = channelDisplayName(a.desc).toLowerCase();
            var bn = channelDisplayName(b.desc).toLowerCase();
            return an < bn ? -1 : 1;
        });
        var html = "";
        rows.forEach(function (row) {
            var name = channelDisplayName(row.desc);
            if (filter && name.toLowerCase().indexOf(filter) < 0) return;
            var meta = metaOf(row.desc);
            html += '<div class="browse-row">' +
                '<div><div class="browse-name"><i class="' +
                (row.desc.access === "private" ? "lock" : "hashtag") + ' icon"></i> ' + escapeHtml(name) + '</div>' +
                '<div class="browse-sub">' +
                (row.joined ? "Joined &middot; " : "") + (row.desc.members || 0) + ' member' + (row.desc.members === 1 ? "" : "s") +
                (meta["cs-desc"] ? " &middot; " + escapeHtml(meta["cs-desc"]) : "") + '</div></div>' +
                (row.joined
                    ? '<button class="cs-btn" data-open="' + escapeAttr(row.desc.spaceid) + '">Open</button>'
                    : '<button class="cs-btn cs-btn-primary" data-preview="' + escapeAttr(row.desc.spaceid) + '">View</button>') +
                '</div>';
        });
        if (html === "") html = '<div class="alt-empty" style="color:var(--cs-muted);">No channels found. Create one!</div>';
        $id("browseList").innerHTML = html;

        Array.prototype.forEach.call(document.querySelectorAll("#browseList [data-open]"), function (btn) {
            btn.addEventListener("click", function () {
                closeModal("browseModal");
                setActive(btn.getAttribute("data-open"));
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll("#browseList [data-preview]"), function (btn) {
            btn.addEventListener("click", function () {
                closeModal("browseModal");
                previewChannel(btn.getAttribute("data-preview"));
            });
        });
    }

    //Open a public channel the user has not joined: read-only preview with
    //a join banner (public spaces are readable by any logged-in user)
    function previewChannel(spaceid) {
        var desc = null;
        state.directory.forEach(function (entry) {
            if (entry.spaceid === spaceid) desc = entry;
        });
        if (!desc) return;
        desc.ismember = false;
        desc.myrole = "";
        var convo = upsertConvo(desc);
        setActive(convo.id);
    }

    /* ---- user pickers (new DM / invite) ---- */

    var dmPicked = {};
    var invitePicked = {};
    var inviteConvo = null;

    function renderUserPicker(listId, filterValue, picked, excluded) {
        var lowered = filterValue.trim().toLowerCase();
        var html = "";
        state.userOrder.forEach(function (name) {
            if (name === state.username) return;
            if (excluded && excluded[name]) return;
            if (lowered && name.toLowerCase().indexOf(lowered) < 0) return;
            html += '<div class="pick-row' + (picked[name] ? " picked" : "") + '" data-name="' + escapeAttr(name) + '">' +
                '<span class="avatar">' + avatarHtml(name, 11) +
                '<span class="presence-dot' + (isOnline(name) ? " online" : "") + '"></span></span>' +
                '<span class="pick-name">' + escapeHtml(name) + '</span>' +
                '<i class="check icon pick-check"></i></div>';
        });
        if (html === "") html = '<div class="alt-empty" style="color:var(--cs-muted);">Nobody found</div>';
        $id(listId).innerHTML = html;
    }

    function openDmModal() {
        dmPicked = {};
        $id("dmFilter").value = "";
        pickKb.dmUserList = 0;
        renderDmPicker();
        openModal("dmModal");
        $id("dmFilter").focus();
    }

    //Keyboard cursor for the people/channel picker lists (arrows + Enter).
    var pickKb = { dmUserList: 0, inviteUserList: 0 };

    function applyPickFocus(listId) {
        var rows = $id(listId).querySelectorAll(".pick-row");
        var idx = pickKb[listId] || 0;
        if (idx > rows.length - 1) idx = rows.length - 1;
        if (idx < 0) idx = 0;
        pickKb[listId] = idx;
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("kbfocus", i === idx);
    }

    function pickerKeydown(e, listId) {
        var rows = $id(listId).querySelectorAll(".pick-row");
        if (rows.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            pickKb[listId] = (pickKb[listId] + 1) % rows.length;
            applyPickFocus(listId);
            rows[pickKb[listId]].scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            pickKb[listId] = (pickKb[listId] - 1 + rows.length) % rows.length;
            applyPickFocus(listId);
            rows[pickKb[listId]].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (rows[pickKb[listId]]) rows[pickKb[listId]].click();
        }
    }

    function renderDmPicker() {
        renderUserPicker("dmUserList", $id("dmFilter").value, dmPicked, null);
        $id("dmStartBtn").disabled = Object.keys(dmPicked).length === 0;
        Array.prototype.forEach.call(document.querySelectorAll("#dmUserList .pick-row"), function (row) {
            row.addEventListener("click", function () {
                var name = row.getAttribute("data-name");
                if (dmPicked[name]) delete dmPicked[name];
                else if (Object.keys(dmPicked).length < 8) dmPicked[name] = true;
                renderDmPicker();
            });
        });
        applyPickFocus("dmUserList");
    }

    function openDmWith(usernames) {
        $.post(API.openDm, { targets: usernames.join(",") }, function (data) {
            var err = apiFail(data);
            if (err) { showToast("Could not open the conversation", err); return; }
            closeModal("dmModal");
            closeRightPanel();
            var convo = upsertConvo(data);
            connectConvo(convo);
            if (!convo.loaded) fetchItems(convo);
            setActive(convo.id);
        }, "json").fail(function () {
            showToast("Chatspace", "Could not reach the server");
        });
    }

    function openInviteModal(convo) {
        inviteConvo = convo;
        invitePicked = {};
        $id("inviteFilter").value = "";
        pickKb.inviteUserList = 0;
        $id("inviteTitle").textContent = "Add people to " + (convo.kind === "dm" ? "the conversation" : "#" + convoLabel(convo));
        renderInvitePicker();
        openModal("inviteModal");
        $id("inviteFilter").focus();
    }

    function renderInvitePicker() {
        if (!inviteConvo) return;
        renderUserPicker("inviteUserList", $id("inviteFilter").value, invitePicked, inviteConvo.members);
        $id("inviteAddBtn").disabled = Object.keys(invitePicked).length === 0;
        Array.prototype.forEach.call(document.querySelectorAll("#inviteUserList .pick-row"), function (row) {
            row.addEventListener("click", function () {
                var name = row.getAttribute("data-name");
                if (invitePicked[name]) delete invitePicked[name];
                else invitePicked[name] = true;
                renderInvitePicker();
            });
        });
        applyPickFocus("inviteUserList");
    }

    function submitInvite() {
        if (!inviteConvo) return;
        var names = Object.keys(invitePicked);
        var pending = names.length;
        if (pending === 0) return;
        names.forEach(function (name) {
            $.post(API.membersAdd, { spaceid: inviteConvo.id, username: name, role: "member" }, function (data) {
                var err = apiFail(data);
                if (err) showToast("Could not add " + name, err);
                pending--;
                if (pending === 0 && detailsModalOpen()) renderDetailsModal();
            }, "json");
        });
        closeModal("inviteModal");
    }

    /* ---- quick switcher (Ctrl+K) ---- */

    var qsSelection = 0;

    function openQuickSwitcher() {
        $id("qsInput").value = "";
        qsSelection = 0;
        renderQsResults();
        openModal("qsModal");
        $id("qsInput").focus();
    }

    function qsCandidates() {
        var filter = $id("qsInput").value.trim().toLowerCase();
        var rows = [];
        joinedConvos().forEach(function (convo) {
            var label = convoLabel(convo);
            if (filter && label.toLowerCase().indexOf(filter) < 0) return;
            rows.push({ convo: convo, label: label });
        });
        state.directory.forEach(function (desc) {
            var label = channelDisplayName(desc);
            if (filter && label.toLowerCase().indexOf(filter) < 0) return;
            rows.push({ directory: desc, label: label });
        });
        return rows.slice(0, 12);
    }

    function renderQsResults() {
        var rows = qsCandidates();
        if (qsSelection >= rows.length) qsSelection = Math.max(0, rows.length - 1);
        var html = "";
        rows.forEach(function (row, idx) {
            var lead;
            var sub = "";
            if (row.convo && row.convo.kind === "dm") {
                var first = dmOthers(row.convo)[0] || state.username;
                lead = '<span class="avatar">' + avatarHtml(first, 10) + '</span>';
            } else {
                var desc = row.convo ? row.convo.desc : row.directory;
                lead = '<i class="' + (desc.access === "private" ? "lock" : "hashtag") + ' icon"></i>';
                if (row.directory) sub = '<span class="qs-sub">not joined</span>';
            }
            html += '<div class="qs-row' + (idx === qsSelection ? " selected" : "") + '" data-idx="' + idx + '">' +
                lead + '<span>' + escapeHtml(row.label) + '</span>' + sub + '</div>';
        });
        if (html === "") html = '<div class="sr-empty">Nothing matches</div>';
        $id("qsResults").innerHTML = html;
        Array.prototype.forEach.call(document.querySelectorAll("#qsResults .qs-row"), function (node) {
            node.addEventListener("click", function () {
                qsSelection = Number(node.getAttribute("data-idx"));
                qsCommit();
            });
        });
    }

    function qsCommit() {
        var rows = qsCandidates();
        var row = rows[qsSelection];
        if (!row) return;
        closeModal("qsModal");
        if (row.convo) setActive(row.convo.id);
        else previewChannel(row.directory.spaceid);
    }

    /* ================= Search ================= */

    var searchTimer = null;

    //Wire jump-on-click for every result / recent row in the search dropdown
    function wireSearchRows(box) {
        Array.prototype.forEach.call(box.querySelectorAll(".sr-row"), function (row, idx) {
            row.addEventListener("mouseenter", function () { setSearchSelection(idx); });
            row.addEventListener("click", function () { activateSearchRow(row); });
        });
        searchSel = 0;
        applySearchSelection();
    }

    var searchSel = 0; //keyboard cursor into the search dropdown rows

    function searchRows() { return $id("searchResults").querySelectorAll(".sr-row"); }

    function applySearchSelection() {
        var rows = searchRows();
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.toggle("selected", i === searchSel);
        }
    }

    function setSearchSelection(idx) {
        searchSel = idx;
        applySearchSelection();
    }

    function moveSearchSelection(delta) {
        var rows = searchRows();
        if (rows.length === 0) return;
        searchSel = (searchSel + delta + rows.length) % rows.length;
        applySearchSelection();
        rows[searchSel].scrollIntoView({ block: "nearest" });
    }

    function activateSearchRow(row) {
        $id("searchResults").style.display = "none";
        $id("searchInput").value = "";
        var convoId = row.getAttribute("data-convo");
        var msgId = row.getAttribute("data-msg");
        if (!convoId) return;
        if (msgId) jumpToMessage(convoId, msgId);
        else setActive(convoId);
    }

    //Keyboard control for the search box: arrows move the highlight, Enter
    //opens it, Escape dismisses the dropdown.
    function searchKeydown(e) {
        var box = $id("searchResults");
        if (box.style.display === "none") return;
        if (e.key === "ArrowDown") { e.preventDefault(); moveSearchSelection(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveSearchSelection(-1); }
        else if (e.key === "Enter") {
            var rows = searchRows();
            if (rows[searchSel]) { e.preventDefault(); activateSearchRow(rows[searchSel]); }
        } else if (e.key === "Escape") {
            box.style.display = "none";
            $id("searchInput").blur();
        }
    }

    //Slack-style empty state shown when the search box is focused but blank:
    //a short hint plus recent conversations as quick jumps.
    function showSearchEmptyState() {
        var box = $id("searchResults");
        var html = '<div class="sr-hint">' +
            '<div class="sr-hint-title"><i class="search icon"></i>Search messages, files and more</div>' +
            '<div class="sr-hint-sub">Looking for a particular message, file or conversation? ' +
            'If it happened in Chatspace, you can find it here.</div></div>';
        var recents = joinedConvos().slice();
        recents.sort(function (a, b) {
            var ta = a.roots.length ? a.roots[a.roots.length - 1].time : 0;
            var tb = b.roots.length ? b.roots[b.roots.length - 1].time : 0;
            return tb - ta;
        });
        recents = recents.slice(0, 6);
        if (recents.length > 0) {
            html += '<div class="sr-group">Recent</div>';
            recents.forEach(function (convo) {
                html += '<div class="sr-row" data-convo="' + escapeAttr(convo.id) + '">' +
                    '<span class="sr-convo">' + (convo.kind === "dm" ? "" : "#") + escapeHtml(convoLabel(convo)) + '</span></div>';
            });
        }
        box.innerHTML = html;
        box.style.display = "";
        wireSearchRows(box);
    }

    function runSearch() {
        var query = $id("searchInput").value.trim().toLowerCase();
        var box = $id("searchResults");
        if (query === "") { showSearchEmptyState(); return; }

        var convoHits = [];
        var msgHits = [];
        Object.keys(state.convos).forEach(function (id) {
            var convo = state.convos[id];
            var label = convoLabel(convo);
            if (label.toLowerCase().indexOf(query) >= 0) convoHits.push(convo);
            Object.keys(convo.msgs).forEach(function (msgId) {
                var msg = convo.msgs[msgId];
                var haystack = (msg.text + " " + msg.name + " " + msg.user).toLowerCase();
                if (haystack.indexOf(query) >= 0) {
                    msgHits.push({ convo: convo, msg: msg });
                }
            });
        });
        msgHits.sort(function (a, b) { return b.msg.time - a.msg.time; });
        msgHits = msgHits.slice(0, 20);

        var html = "";
        if (convoHits.length > 0) {
            html += '<div class="sr-group">Channels &amp; DMs</div>';
            convoHits.slice(0, 5).forEach(function (convo) {
                html += '<div class="sr-row" data-convo="' + escapeAttr(convo.id) + '">' +
                    '<span class="sr-convo">' + (convo.kind === "dm" ? "" : "#") + escapeHtml(convoLabel(convo)) + '</span></div>';
            });
        }
        if (msgHits.length > 0) {
            html += '<div class="sr-group">Messages</div>';
            msgHits.forEach(function (hit) {
                html += '<div class="sr-row" data-convo="' + escapeAttr(hit.convo.id) + '" data-msg="' + escapeAttr(hit.msg.id) + '">' +
                    '<span class="sr-convo">' + (hit.convo.kind === "dm" ? "" : "#") + escapeHtml(convoLabel(hit.convo)) + '</span>' +
                    '<span class="sr-snippet"><b>' + escapeHtml(hit.msg.user) + ':</b> ' +
                    escapeHtml((hit.msg.text || hit.msg.name).substring(0, 90)) + '</span>' +
                    '<span class="sr-time">' + escapeHtml(fmtAgo(hit.msg.time)) + '</span></div>';
            });
        }
        if (html === "") html = '<div class="sr-empty">No results for "' + escapeHtml(query) + '"</div>';
        box.innerHTML = html;
        box.style.display = "";
        wireSearchRows(box);
    }

    /* ================= Rail views ================= */

    function setRailView(view) {
        state.railView = view;
        state.sbNav = null;
        Array.prototype.forEach.call(document.querySelectorAll(".rail-btn[data-view]"), function (btn) {
            btn.classList.toggle("active", btn.getAttribute("data-view") === view);
        });
        //Activity is a full main-pane view; the other rail views only swap
        //the sidebar and keep the open conversation
        if (view === "activity") {
            openActivityView();
        } else {
            if (state.mainView === "activity") {
                state.mainView = "convo";
                renderMain();
            }
            //On mobile, the other tabs bring the list screen forward
            showMobileList();
        }
        renderSidebar();
    }

    /* ================= Event wiring ================= */

    function wireEvents() {
        //Rail
        Array.prototype.forEach.call(document.querySelectorAll(".rail-btn[data-view]"), function (btn) {
            btn.addEventListener("click", function () {
                setRailView(btn.getAttribute("data-view"));
            });
        });
        $id("railBrowseBtn").addEventListener("click", openBrowseModal);
        $id("railNewBtn").addEventListener("click", openDmModal);
        $id("railAvatar").addEventListener("click", function () { openProfile(state.username); });
        $id("railSearchBtn").addEventListener("click", openQuickSwitcher);
        $id("sbAvatarBtn").addEventListener("click", function () { openProfile(state.username); });
        //Mobile: back out of a conversation / activity to the list screen
        $id("chBackBtn").addEventListener("click", showMobileList);
        $id("apBackBtn").addEventListener("click", showMobileList);

        //Topbar
        $id("histBackBtn").addEventListener("click", function () { navGo(-1); });
        $id("histFwdBtn").addEventListener("click", function () { navGo(1); });
        $id("qsOpenBtn").addEventListener("click", openQuickSwitcher);
        $id("helpBtn").addEventListener("click", function () { openModal("helpModal"); });
        $id("searchInput").addEventListener("input", function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(runSearch, 200);
        });
        $id("searchInput").addEventListener("focus", function () {
            //Show results when there is a query, otherwise the empty-state hint
            runSearch();
        });
        $id("searchInput").addEventListener("keydown", searchKeydown);

        //Sidebar
        $id("sbComposeBtn").addEventListener("click", openDmModal);
        $id("sbAddChannelBtn").addEventListener("click", openBrowseModal);
        $id("sbNewDmBtn").addEventListener("click", openDmModal);
        Array.prototype.forEach.call(document.querySelectorAll(".sb-nav"), function (item) {
            item.addEventListener("click", function () {
                state.sbNav = item.getAttribute("data-nav");
                if (state.sbNav === "activity") openActivityView();
                renderSidebar();
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll(".ap-tab"), function (tab) {
            tab.addEventListener("click", function () {
                state.activityTab = tab.getAttribute("data-aptab");
                renderActivityPane();
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll(".sb-section-title"), function (title) {
            title.addEventListener("click", function () {
                var key = title.getAttribute("data-collapse");
                state.prefs.collapsed[key] = !state.prefs.collapsed[key];
                savePrefs();
                renderSidebar();
            });
        });
        $id("sbAltTitle").addEventListener("click", function () {
            state.sbNav = null;
            setRailView("home");
        });

        //Channel header
        $id("chNameBtn").addEventListener("click", openDetails);
        $id("chDetailsBtn").addEventListener("click", openDetails);
        $id("chMembersBtn").addEventListener("click", function () {
            state.detailsTab = "members";
            renderDetailsModal();
            openModal("detailsModal");
        });

        //Details modal
        Array.prototype.forEach.call(document.querySelectorAll(".dt-tab"), function (tab) {
            tab.addEventListener("click", function () {
                state.detailsTab = tab.getAttribute("data-dtab");
                renderDetailsModal();
            });
        });
        $id("dtStarBtn").addEventListener("click", function () {
            if (state.active) {
                toggleStar(state.active);
                renderDetailsModal();
            }
        });
        $id("dtHuddleBtn").addEventListener("click", function () {
            closeModal("detailsModal");
            $id("chHuddleBtn").click();
        });
        $id("chStarBtn").addEventListener("click", function () {
            if (state.active) toggleStar(state.active);
        });
        $id("chTopic").addEventListener("click", function () {
            var convo = activeConvo();
            if (!convo) return;
            if (convo.kind !== "dm" && canManage(convo)) editTopicPrompt(convo);
            else openDetails();
        });
        $id("chHuddleBtn").addEventListener("click", function () {
            //Inside the ArozOS desktop this opens MeetRoom as a floatWindow;
            //ao_module_newfw itself falls back to window.open elsewhere
            if (typeof ao_module_newfw === "function") {
                ao_module_newfw({
                    url: "MeetRoom/index.html",
                    title: "MeetRoom",
                    appicon: "MeetRoom/img/module_icon.svg",
                    width: 1080,
                    height: 700
                });
            } else {
                window.open("../MeetRoom/index.html", "_blank");
            }
        });
        $id("pvJoinBtn").addEventListener("click", joinActiveChannel);
        $id("rpCloseBtn").addEventListener("click", function () {
            saveDraft();
            closeRightPanel();
        });

        //Composer
        var input = $id("composeInput");
        input.addEventListener("input", function () {
            autoGrow(input);
            refreshSendButtons();
            emitTyping(activeConvo());
            detectMentionTyping();
        });
        input.addEventListener("keydown", function (e) {
            composerKeydown(e, { thread: false });
        });
        input.addEventListener("blur", saveDraft);
        $id("sendBtn").addEventListener("click", submitComposer);

        Array.prototype.forEach.call(document.querySelectorAll(".fmt-btn"), function (btn) {
            btn.addEventListener("click", function () {
                applyFormat(btn.getAttribute("data-fmt"));
            });
        });
        $id("fmtToggleBtn").addEventListener("click", function () {
            //Robust across layouts: the bar starts hidden on mobile (CSS) and
            //shown on desktop, so read the computed state rather than assume
            var bar = $id("fmtToolbar");
            var shown = window.getComputedStyle(bar).display !== "none";
            bar.style.display = shown ? "none" : "flex";
            this.classList.toggle("fmt-hidden", shown);
        });
        $id("iconPickBtn").addEventListener("click", function (e) {
            e.stopPropagation();
            openIconPicker(this, function (code) {
                var box = $id("composeInput");
                var caret = box.selectionStart;
                box.value = box.value.substring(0, caret) + ":" + code + ":" + box.value.substring(box.selectionEnd);
                box.focus();
                refreshSendButtons();
            });
        });
        $id("mentionBtn").addEventListener("click", function (e) {
            e.stopPropagation();
            var box = $id("composeInput");
            box.focus();
            openMentionPicker("", box.selectionStart);
        });
        $id("attachBtn").addEventListener("click", function () {
            $id("attachInput").click();
        });
        $id("attachInput").addEventListener("change", function () {
            uploadFiles(this.files);
            this.value = "";
        });

        //Thread composer - same keyboard affordances as the main composer
        var rpInput = $id("rpComposeInput");
        rpInput.addEventListener("input", function () {
            autoGrow(rpInput);
            refreshSendButtons();
            emitTyping(activeConvo());
            detectMentionTyping(rpInput, $id("rpComposer"));
        });
        rpInput.addEventListener("keydown", function (e) {
            composerKeydown(e, { thread: true });
        });
        rpInput.addEventListener("blur", saveDraft);
        $id("rpSendBtn").addEventListener("click", submitThreadComposer);

        //Modals
        $id("ncCreateBtn").addEventListener("click", submitCreateChannel);
        $id("ncName").addEventListener("keyup", function (e) {
            if (e.key === "Enter") submitCreateChannel();
        });
        $id("browseFilter").addEventListener("input", renderBrowseList);
        $id("browseCreateBtn").addEventListener("click", function () {
            closeModal("browseModal");
            openCreateModal();
        });
        $id("dmFilter").addEventListener("input", function () { pickKb.dmUserList = 0; renderDmPicker(); });
        $id("dmFilter").addEventListener("keydown", function (e) { pickerKeydown(e, "dmUserList"); });
        $id("dmStartBtn").addEventListener("click", function () {
            openDmWith(Object.keys(dmPicked));
        });
        $id("inviteFilter").addEventListener("input", function () { pickKb.inviteUserList = 0; renderInvitePicker(); });
        $id("inviteFilter").addEventListener("keydown", function (e) { pickerKeydown(e, "inviteUserList"); });
        $id("inviteAddBtn").addEventListener("click", submitInvite);

        //Quick switcher
        $id("qsInput").addEventListener("input", function () {
            qsSelection = 0;
            renderQsResults();
        });
        $id("qsInput").addEventListener("keydown", function (e) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                qsSelection++;
                renderQsResults();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                qsSelection = Math.max(0, qsSelection - 1);
                renderQsResults();
            } else if (e.key === "Enter") {
                e.preventDefault();
                qsCommit();
            } else if (e.key === "Escape") {
                closeModal("qsModal");
            }
        });

        //Image lightbox
        $id("lbClose").addEventListener("click", closeLightbox);
        $id("lbPrev").addEventListener("click", function () { lightboxNav(-1); });
        $id("lbNext").addEventListener("click", function () { lightboxNav(1); });
        $id("lightbox").addEventListener("mousedown", function (e) {
            //Backdrop click closes; clicks on the image / chrome do not
            if (e.target === this || e.target === $id("lbStage")) closeLightbox();
        });
        $id("lbImg").addEventListener("click", function () {
            this.classList.toggle("zoomed");
        });

        //Global keys
        document.addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
                e.preventDefault();
                openQuickSwitcher();
                return;
            }
            if (lightboxOpen()) {
                if (e.key === "Escape") closeLightbox();
                else if (e.key === "ArrowLeft") lightboxNav(-1);
                else if (e.key === "ArrowRight") lightboxNav(1);
                return;
            }
            if (e.key === "Escape") {
                //Close the top-most layer only, so one Esc peels back one level:
                //popovers first, then open modals, then the thread / detail panel.
                if (anyPickerOpen()) { closePickers(); return; }
                var closedModal = false;
                Array.prototype.forEach.call(document.querySelectorAll(".cs-overlay"), function (overlay) {
                    if (overlay.style.display !== "none") { overlay.style.display = "none"; closedModal = true; }
                });
                if (closedModal) return;
                if (state.rpMode) { closeRightPanel(); return; }
            }
        });

        //PWA / native Back button closes the thread (or profile) panel first
        window.addEventListener("popstate", function () {
            if (state.rpMode) closeRightPanel(true);
            else panelHist.active = false;
        });

        //Focus tracking drives read-marking and notification muting
        window.addEventListener("focus", function () {
            state.focused = true;
            var convo = activeConvo();
            if (convo) { markRead(convo); renderSidebar(); }
        });
        window.addEventListener("blur", function () { state.focused = false; });

        //Drag & drop / paste uploads
        var content = $id("content");
        content.addEventListener("dragover", function (e) { e.preventDefault(); });
        content.addEventListener("drop", function (e) {
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                uploadFiles(e.dataTransfer.files);
            }
        });
        document.addEventListener("paste", function (e) {
            var convo = activeConvo();
            if (!convo || !convo.desc.ismember) return;
            var items = (e.clipboardData && e.clipboardData.items) || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].kind !== "file" || items[i].type.indexOf("image/") !== 0) continue;
                var blob = items[i].getAsFile();
                if (!blob) continue;
                e.preventDefault();
                var ext = (items[i].type.split("/")[1] || "png").split("+")[0];
                var named = new File([blob], "pasted-image-" + Date.now() + "." + ext, { type: blob.type });
                uploadFiles([named]);
                return;
            }
        });

        window.addEventListener("beforeunload", function () {
            saveDraft();
            Object.keys(state.convos).forEach(function (id) {
                closeSocket(state.convos[id]);
            });
        });
    }

    /* ================= Boot ================= */

    function boot() {
        wireEvents();
        //PWA: offline app shell (the API surface always goes to the network)
        if ("serviceWorker" in navigator) {
            try {
                navigator.serviceWorker.register("sw.js").catch(function () { });
            } catch (e) { }
        }
        loadUsers(function () {
            //Prefs are keyed by username, so load them as soon as we know
            //who we are - before any item fetch computes unread counts
            loadPrefs();
            bootstrapWorkspace(function (ok) {
                state.booted = true;
                $id("railAvatar").innerHTML = avatarHtml(state.username, 14);
                $id("sbAvatarBtn").innerHTML = avatarHtml(state.username, 12);
                if (!ok) { renderAll(); return; }
                //Restore the last conversation, or land in #general
                var target = state.prefs.lastActive && state.convos[state.prefs.lastActive]
                    ? state.prefs.lastActive : null;
                if (!target) {
                    joinedConvos("channel").forEach(function (convo) {
                        if (!target && convoLabel(convo) === "general") target = convo.id;
                    });
                }
                if (!target) {
                    var joined = joinedConvos();
                    if (joined.length > 0) target = joined[0].id;
                }
                if (target) {
                    setActive(target);
                    //On phones, land on the Home list (Slack behaviour); the
                    //conversation is preloaded behind it for an instant open
                    if (isMobile()) showMobileList();
                } else {
                    renderAll();
                }
            });
        });

        //Periodic workspace refresh: picks up channels created elsewhere,
        //DMs opened with us and membership / metadata changes.
        setInterval(function () {
            if (!state.booted) return;
            var wasActive = state.active;
            bootstrapWorkspace(function () {
                renderSidebar();
                renderChannelHeader();
                //The refresh may have dropped the conversation we were in
                if (wasActive && !state.convos[wasActive]) renderMain();
            });
        }, REFRESH_MS);
    }

    boot();

})();
