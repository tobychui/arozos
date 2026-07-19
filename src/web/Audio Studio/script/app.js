/*
    Audio Studio - app.js

    UI layer: toolbar, track headers, timeline rendering (canvas),
    mouse interactions (select / move / trim clips), transport,
    recording flow, shortcuts handling and dialogs.

    Depends on ASEngine, ASProject and ASShortcuts.
*/

(function () {
    "use strict";

    /* ============ Constants & state ============ */

    var LANE_H = 110;            //Must match .lane / .trackHeader height in CSS
    var CLIP_HEADER_H = 16;      //Draggable title strip at the top of a clip
    var EDGE_TOL = 6;            //Px tolerance for grabbing a clip edge
    var MIN_PPS = 4;
    var MAX_PPS = 2000;
    var PREFS_KEY = "AudioStudio.prefs";

    var pxPerSec = 100;
    var scrollX = 0;
    var cursor = 0;              //Edit cursor position (sec)
    var selection = null;        //{trackId, t0, t1}
    var selectedTrackId = null;
    var clipboard = null;        //AudioBuffer copied from a selection
    var playStartCursor = 0;
    var dragState = null;
    var recInfo = null;          //{trackId, startPos, peaks, active}
    var capturingShortcut = false;
    var meterDb = -Infinity;
    var rafRunning = false;
    var renderQueued = false;

    var prefs = {
        deleteMode: "gap",       //"gap" = leave gap, "ripple" = close gap
        overdub: true,           //Play other tracks while recording
        snap: false
    };

    /* DOM refs */
    var laneView, laneList, headerList, rulerCanvas, playheadEl, hscroll,
        hscrollInner, timeDisplay, meterCanvas, emptyHint, snapCheck;
    var laneCanvasByTrack = {};  //trackId -> canvas

    function byId(id) {
        return document.getElementById(id);
    }

    /* ============ Preferences ============ */

    function loadPrefs() {
        try {
            var stored = JSON.parse(localStorage.getItem(PREFS_KEY));
            if (stored !== null && typeof stored === "object") {
                Object.keys(prefs).forEach(function (k) {
                    if (stored[k] !== undefined) {
                        prefs[k] = stored[k];
                    }
                });
            }
        } catch (e) { /* keep defaults */ }
    }

    function savePrefs() {
        //Persists to user:/.appdata/Audio_Studio/prefs.json on the server
        //(with localStorage as cache / standalone fallback)
        ASStorage.save("prefs", prefs);
    }

    function mergePrefs(stored) {
        if (stored === null || typeof stored !== "object") {
            return;
        }
        Object.keys(prefs).forEach(function (k) {
            if (stored[k] !== undefined) {
                prefs[k] = stored[k];
            }
        });
    }

    /* ============ Time helpers ============ */

    function viewportW() {
        return rulerCanvas.parentElement.clientWidth;
    }

    function xToTime(x) {
        return (x + scrollX) / pxPerSec;
    }

    function timeToX(t) {
        return t * pxPerSec - scrollX;
    }

    var GRID_STEPS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

    function gridStep() {
        for (var i = 0; i < GRID_STEPS.length; i++) {
            if (GRID_STEPS[i] * pxPerSec >= 14) {
                return GRID_STEPS[i];
            }
        }
        return 600;
    }

    function majorStep() {
        for (var i = 0; i < GRID_STEPS.length; i++) {
            if (GRID_STEPS[i] * pxPerSec >= 75) {
                return GRID_STEPS[i];
            }
        }
        return 600;
    }

    function snapTime(t) {
        if (!prefs.snap) {
            return Math.max(0, t);
        }
        var s = gridStep();
        return Math.max(0, Math.round(t / s) * s);
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function formatTime(t) {
        if (!isFinite(t) || t < 0) { t = 0; }
        var h = Math.floor(t / 3600);
        var m = Math.floor((t % 3600) / 60);
        var s = t % 60;
        var sStr = s.toFixed(2);
        if (s < 10) { sStr = "0" + sStr; }
        return pad2(h) + "h" + pad2(m) + "m" + sStr + "s";
    }

    function formatRulerTime(t, step) {
        var m = Math.floor(t / 60);
        var s = t - m * 60;
        if (step < 1) {
            var fixed = step < 0.1 ? 2 : 1;
            return m + ":" + (s < 10 ? "0" : "") + s.toFixed(fixed);
        }
        return m + ":" + pad2(Math.round(s));
    }

    /* ============ Toasts ============ */

    function toast(msg, isError) {
        var area = byId("toastArea");
        var el = document.createElement("div");
        el.className = "asToast" + (isError ? " error" : "");
        el.textContent = msg;
        area.appendChild(el);
        setTimeout(function () {
            if (el.parentElement !== null) {
                el.parentElement.removeChild(el);
            }
        }, isError ? 5000 : 2600);
    }

    /* ============ Canvas helpers ============ */

    function setupCanvas(canvas, cssW, cssH) {
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, Math.floor(cssW * dpr));
        var h = Math.max(1, Math.floor(cssH * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        var g = canvas.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        return g;
    }

    /* ============ Rendering ============ */

    //Schedule a frame callback; falls back to a timer when the document is
    //hidden (rAF is throttled to zero in background tabs / hidden windows)
    function scheduleFrame(fn) {
        if (document.hidden) {
            setTimeout(fn, 50);
        } else {
            window.requestAnimationFrame(fn);
        }
    }

    function requestRender() {
        if (renderQueued) {
            return;
        }
        renderQueued = true;
        scheduleFrame(function () {
            renderQueued = false;
            renderAll();
        });
    }

    function renderAll() {
        renderRuler();
        ASProject.getTracks().forEach(function (track) {
            var canvas = laneCanvasByTrack[track.id];
            if (canvas !== undefined) {
                renderLane(track, canvas);
            }
        });
        updatePlayhead();
        updateToolbarState();
        updateEmptyHint();
    }

    function renderRuler() {
        var w = viewportW();
        var g = setupCanvas(rulerCanvas, w, 30);
        g.clearRect(0, 0, w, 30);
        g.fillStyle = "#101318";
        g.fillRect(0, 0, w, 30);

        var major = majorStep();
        var minor = major / 5;
        var t0 = Math.floor(xToTime(0) / minor) * minor;
        var t1 = xToTime(w);
        g.strokeStyle = "#3a4150";
        g.fillStyle = "#9aa2b1";
        g.font = "11px 'Segoe UI', sans-serif";
        g.textBaseline = "top";
        g.beginPath();
        for (var t = t0; t <= t1 + minor; t += minor) {
            var tt = Math.round(t / minor) * minor; //Kill float drift
            if (tt < 0) { continue; }
            var x = Math.round(timeToX(tt)) + 0.5;
            var isMajor = Math.abs(tt / major - Math.round(tt / major)) < 0.001;
            g.moveTo(x, isMajor ? 14 : 22);
            g.lineTo(x, 30);
            if (isMajor) {
                g.fillText(formatRulerTime(tt, major), x + 4, 3);
            }
        }
        g.stroke();

        //Cursor marker
        var cx = timeToX(cursor);
        if (cx >= -6 && cx <= w + 6) {
            g.fillStyle = "#e8eaf0";
            g.beginPath();
            g.moveTo(cx - 5, 0);
            g.lineTo(cx + 5, 0);
            g.lineTo(cx, 9);
            g.closePath();
            g.fill();
        }
    }

    function roundRectPath(g, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }

    function renderLane(track, canvas) {
        var w = viewportW();
        var g = setupCanvas(canvas, w, LANE_H);
        var isSel = track.id === selectedTrackId;
        g.clearRect(0, 0, w, LANE_H);
        g.fillStyle = isSel ? "#252a34" : "#20242d";
        g.fillRect(0, 0, w, LANE_H);

        //Vertical grid
        var major = majorStep();
        var t0 = Math.max(0, Math.floor(xToTime(0) / major) * major);
        var t1 = xToTime(w);
        g.strokeStyle = "#2b303b";
        g.beginPath();
        for (var t = t0; t <= t1 + major; t += major) {
            var x = Math.round(timeToX(t)) + 0.5;
            g.moveTo(x, 0);
            g.lineTo(x, LANE_H);
        }
        g.stroke();

        //Clips
        var dimmed = track.muted;
        track.clips.forEach(function (clip) {
            drawClip(g, track, clip, w, dimmed);
        });

        //Live recording preview
        if (recInfo !== null && recInfo.trackId === track.id && recInfo.active) {
            drawRecordingPreview(g, w);
        }

        //Selection overlay
        if (selection !== null && selection.trackId === track.id) {
            var sx0 = timeToX(selection.t0);
            var sx1 = timeToX(selection.t1);
            if (sx1 > 0 && sx0 < w) {
                g.fillStyle = "rgba(255, 255, 255, 0.20)";
                g.fillRect(Math.max(0, sx0), 0, Math.min(w, sx1) - Math.max(0, sx0), LANE_H);
                g.strokeStyle = "rgba(255, 255, 255, 0.55)";
                g.beginPath();
                g.moveTo(Math.round(sx0) + 0.5, 0); g.lineTo(Math.round(sx0) + 0.5, LANE_H);
                g.moveTo(Math.round(sx1) + 0.5, 0); g.lineTo(Math.round(sx1) + 0.5, LANE_H);
                g.stroke();
            }
        }
    }

    function drawClip(g, track, clip, w, dimmed) {
        var x0 = timeToX(clip.start);
        var x1 = timeToX(ASProject.clipEnd(clip));
        if (x1 < 0 || x0 > w) {
            return;
        }
        var color = ASProject.trackColor(track);
        var cw = Math.max(2, x1 - x0);

        g.save();
        g.globalAlpha = dimmed ? 0.4 : 1;
        roundRectPath(g, x0, 3, cw, LANE_H - 7, 4);
        g.fillStyle = color.clip;
        g.fill();
        g.clip();

        //Header strip with the clip name
        g.fillStyle = "rgba(0, 0, 0, 0.14)";
        g.fillRect(x0, 3, cw, CLIP_HEADER_H);
        if (cw > 34) {
            g.fillStyle = color.wave;
            g.font = "10px 'Segoe UI', sans-serif";
            g.textBaseline = "middle";
            g.fillText(clip.name, Math.max(x0, 0) + 5, 3 + CLIP_HEADER_H / 2, cw - 10);
        }

        //Waveform
        var peaks = ASProject.getPeaks(clip.buffer);
        var sr = clip.buffer.sampleRate;
        var binDur = peaks.bin / sr;
        var waveTop = 3 + CLIP_HEADER_H + 2;
        var waveBottom = LANE_H - 8;
        var mid = (waveTop + waveBottom) / 2;
        var amp = (waveBottom - waveTop) / 2 * 0.95;

        g.fillStyle = color.wave;
        var pxStart = Math.max(0, Math.floor(x0));
        var pxEnd = Math.min(w, Math.ceil(x1));
        for (var px = pxStart; px < pxEnd; px++) {
            var tA = clip.offset + (xToTime(px) - clip.start);
            var tB = tA + 1 / pxPerSec;
            var i0 = Math.max(0, Math.floor(tA / binDur));
            var i1 = Math.min(peaks.min.length - 1, Math.floor(tB / binDur));
            if (i0 >= peaks.min.length) { continue; }
            var mn = 1, mx = -1;
            for (var i = i0; i <= i1; i++) {
                if (peaks.min[i] < mn) { mn = peaks.min[i]; }
                if (peaks.max[i] > mx) { mx = peaks.max[i]; }
            }
            if (mx < mn) { continue; }
            var yTop = mid - mx * amp;
            var yBot = mid - mn * amp;
            g.fillRect(px, yTop, 1, Math.max(1, yBot - yTop));
        }

        //Center line
        g.fillRect(Math.max(0, x0), mid, cw, 0.5);
        g.restore();
    }

    function drawRecordingPreview(g, w) {
        var pos = ASEngine.getPosition();
        var x0 = timeToX(recInfo.startPos);
        var x1 = timeToX(Math.max(pos, recInfo.startPos + 0.05));
        if (x1 < 0 || x0 > w) {
            return;
        }
        g.fillStyle = "rgba(229, 72, 77, 0.30)";
        g.fillRect(x0, 3, x1 - x0, LANE_H - 7);
        g.strokeStyle = "#e5484d";
        g.strokeRect(x0 + 0.5, 3.5, x1 - x0 - 1, LANE_H - 8);

        //Live peak bars collected while recording
        var mid = LANE_H / 2 + 6;
        var amp = (LANE_H - CLIP_HEADER_H - 14) / 2 * 0.9;
        g.fillStyle = "rgba(255, 235, 235, 0.85)";
        for (var i = 0; i < recInfo.peaks.length; i++) {
            var p = recInfo.peaks[i];
            var px = timeToX(p.t);
            if (px < 0 || px > w) { continue; }
            var hgt = Math.max(1, p.v * amp * 2);
            g.fillRect(px, mid - hgt / 2, 1, hgt);
        }
    }

    function updatePlayhead() {
        var active = ASEngine.isPlaying() || ASEngine.isRecording();
        var pos = active ? ASEngine.getPosition() : cursor;
        var x = timeToX(pos);
        var trackCount = ASProject.getTracks().length;
        playheadEl.style.height = (trackCount * LANE_H) + "px";
        if (x < 0 || x > viewportW()) {
            playheadEl.style.display = "none";
        } else {
            playheadEl.style.display = "block";
            playheadEl.style.left = x + "px";
        }
        timeDisplay.textContent = formatTime(pos);
    }

    function updateEmptyHint() {
        emptyHint.style.display = ASProject.isEmpty() && recInfo === null ? "block" : "none";
        var hintKey = byId("hintRecKey");
        if (hintKey !== null) {
            hintKey.textContent = ASShortcuts.getBinding("record") || "R";
        }
    }

    function updateToolbarState() {
        byId("btnUndo").disabled = !ASProject.canUndo();
        byId("btnRedo").disabled = !ASProject.canRedo();
        byId("btnPaste").disabled = clipboard === null;
        var playing = ASEngine.isPlaying();
        byId("playIcon").setAttribute("d", playing
            ? "M3 2h3.4v12H3zM9.6 2H13v12H9.6z"
            : "M3 1.5v13l11-6.5z");
        var recBtn = byId("btnRecord");
        if (ASEngine.isRecording()) {
            recBtn.classList.add("recording");
        } else {
            recBtn.classList.remove("recording");
        }
        snapCheck.checked = prefs.snap;
    }

    function updateHScroll() {
        var contentW = Math.max((ASProject.duration() + 60) * pxPerSec, viewportW() + 200);
        hscrollInner.style.width = contentW + "px";
        if (Math.abs(hscroll.scrollLeft - scrollX) > 1) {
            hscroll.scrollLeft = scrollX;
        }
    }

    /* ============ Meter ============ */

    function renderMeter() {
        var w = 150, h = 16;
        var g = setupCanvas(meterCanvas, w, h);
        var db = ASEngine.getMeterDb();
        if (db > meterDb) {
            meterDb = db;
        } else {
            meterDb = meterDb - 1.5; //Decay per frame
        }
        g.clearRect(0, 0, w, h);
        g.fillStyle = "#171b22";
        g.fillRect(0, 0, w, h);

        //Scale ticks every 12 dB from -60 to 0
        g.fillStyle = "#3a4150";
        for (var d = -60; d <= 0; d += 12) {
            var tx = (d + 60) / 60 * w;
            g.fillRect(Math.min(w - 1, tx), 0, 1, h);
        }

        if (meterDb > -60) {
            var frac = Math.max(0, Math.min(1, (meterDb + 60) / 60));
            var grad = g.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, "#35c25e");
            grad.addColorStop(0.72, "#35c25e");
            grad.addColorStop(0.86, "#e7c65c");
            grad.addColorStop(1, "#e5484d");
            g.fillStyle = grad;
            g.fillRect(0, 3, frac * w, h - 6);
        }
    }

    /* ============ Animation loop ============ */

    function ensureRafLoop() {
        if (rafRunning) {
            return;
        }
        rafRunning = true;
        scheduleFrame(rafTick);
    }

    function rafTick() {
        var playing = ASEngine.isPlaying();
        var recording = ASEngine.isRecording();

        if (recInfo !== null && !recInfo.active && recording) {
            //Mic stream is live: recording really started now
            recInfo.active = true;
            ASEngine.setPosition(recInfo.startPos);
            if (prefs.overdub && !ASProject.isEmpty()) {
                ASEngine.play(ASProject.getTracks(), recInfo.startPos);
            } else {
                //Track time manually through the playback clock
                ASEngine.play([], recInfo.startPos);
            }
            requestRender(); //Red record state, hint and playhead
        }

        if (recInfo !== null && recInfo.active) {
            var pos = ASEngine.getPosition();
            recInfo.peaks.push({ t: pos, v: ASEngine.getRecordingPeak() });
            var canvas = laneCanvasByTrack[recInfo.trackId];
            var track = ASProject.getTrack(recInfo.trackId);
            if (canvas !== undefined && track !== null) {
                renderLane(track, canvas);
            }
        }

        if (playing || recording) {
            updatePlayhead();
            //Auto page-scroll to follow the playhead
            var x = timeToX(ASEngine.getPosition());
            if (x > viewportW() - 30) {
                scrollX = ASEngine.getPosition() * pxPerSec - 60;
                updateHScroll();
                requestRender();
            }
            //Auto stop at project end (not while recording)
            if (playing && !recording && ASEngine.getPosition() > ASProject.duration() + 0.05) {
                ASEngine.stop();
                cursor = playStartCursor;
                requestRender();
            }
        }

        renderMeter();

        //recInfo keeps the loop alive while the mic permission prompt is
        //still pending, so the UI catches the moment recording starts
        if (playing || recording || recInfo !== null || meterDb > -60) {
            scheduleFrame(rafTick);
        } else {
            rafRunning = false;
        }
    }

    /* ============ Transport ============ */

    function playPause() {
        if (ASEngine.isRecording()) {
            return;
        }
        if (ASEngine.isPlaying()) {
            cursor = ASEngine.getPosition();
            ASEngine.stop();
        } else {
            playStartCursor = cursor;
            ASEngine.play(ASProject.getTracks(), cursor);
            ensureRafLoop();
        }
        requestRender();
    }

    function stopAll() {
        if (ASEngine.isRecording()) {
            toggleRecord();
            return;
        }
        if (ASEngine.isPlaying()) {
            ASEngine.stop();
            cursor = playStartCursor;
            ASEngine.setPosition(cursor);
        }
        requestRender();
    }

    function seekTo(t) {
        cursor = Math.max(0, t);
        if (ASEngine.isPlaying() && !ASEngine.isRecording()) {
            ASEngine.play(ASProject.getTracks(), cursor);
            playStartCursor = cursor;
        } else {
            ASEngine.setPosition(cursor);
        }
        requestRender();
    }

    function goToStart() {
        scrollX = 0;
        updateHScroll();
        seekTo(0);
    }

    function goToEnd() {
        var d = ASProject.duration();
        seekTo(d);
        scrollX = Math.max(0, d * pxPerSec - viewportW() * 0.8);
        updateHScroll();
        requestRender();
    }

    /* ============ Recording ============ */

    function toggleRecord() {
        if (ASEngine.isRecording()) {
            ASEngine.stopRecording();
            ASEngine.stop();
            return;
        }
        if (recInfo !== null) {
            return; //Mic permission request still pending
        }
        var track = ASProject.getTrack(selectedTrackId);
        if (track === null) {
            track = ASProject.addTrack();
            selectedTrackId = track.id;
            rebuildDOM();
        }
        var startPos = cursor;
        recInfo = { trackId: track.id, startPos: startPos, peaks: [], active: false };
        ASEngine.startRecording(function (buffer, err) {
            //Recording finished and decoded
            var info = recInfo;
            recInfo = null;
            ASEngine.stop();
            cursor = playStartCursor = info !== null ? info.startPos : cursor;
            if (err !== null || buffer === null) {
                toast(err || "Recording failed", true);
                requestRender();
                return;
            }
            var target = info !== null ? ASProject.getTrack(info.trackId) : null;
            if (target === null) {
                target = ASProject.addTrack();
            }
            ASProject.insertClip(target, buffer, info.startPos, target.name);
            cursor = info.startPos + buffer.duration;
            ASEngine.setPosition(cursor);
            updateHScroll();
            rebuildDOM();
            toast("Recorded " + buffer.duration.toFixed(2) + "s");
        }, function (errMsg) {
            recInfo = null;
            toast(errMsg, true);
            requestRender();
        });
        ensureRafLoop();
        requestRender();
    }

    /* ============ Editing actions ============ */

    function getTargetTrack() {
        if (selection !== null) {
            var t = ASProject.getTrack(selection.trackId);
            if (t !== null) {
                return t;
            }
        }
        return ASProject.getTrack(selectedTrackId);
    }

    function requireSelection() {
        if (selection === null || selection.t1 - selection.t0 < 0.001) {
            toast("Select a range on a track first (click and drag on the timeline)");
            return null;
        }
        return selection;
    }

    function actSplit() {
        var track = getTargetTrack();
        if (track === null) {
            toast("Select a track first");
            return;
        }
        if (ASProject.splitAt(track, cursor)) {
            requestRender();
        } else {
            toast("No clip under the cursor on track \"" + track.name + "\"");
        }
    }

    function actCopy() {
        var sel = requireSelection();
        if (sel === null) { return; }
        var track = ASProject.getTrack(sel.trackId);
        var buf = ASProject.copyRange(track, sel.t0, sel.t1);
        if (buf === null) {
            toast("The selection contains no audio");
            return;
        }
        clipboard = buf;
        toast("Copied " + (sel.t1 - sel.t0).toFixed(2) + "s");
        updateToolbarState();
    }

    function actCut() {
        var sel = requireSelection();
        if (sel === null) { return; }
        var track = ASProject.getTrack(sel.trackId);
        var buf = ASProject.copyRange(track, sel.t0, sel.t1);
        if (buf !== null) {
            clipboard = buf;
        }
        ASProject.deleteRange(track, sel.t0, sel.t1, true);
        cursor = sel.t0;
        selection = null;
        updateHScroll();
        requestRender();
    }

    function actDelete() {
        var sel = requireSelection();
        if (sel === null) { return; }
        var track = ASProject.getTrack(sel.trackId);
        var ripple = prefs.deleteMode === "ripple";
        if (ASProject.deleteRange(track, sel.t0, sel.t1, ripple)) {
            if (ripple) {
                cursor = sel.t0;
            }
            selection = null;
            updateHScroll();
            requestRender();
        } else {
            toast("The selection contains no audio");
        }
    }

    function actMute() {
        var sel = requireSelection();
        if (sel === null) { return; }
        var track = ASProject.getTrack(sel.trackId);
        if (ASProject.muteRange(track, sel.t0, sel.t1)) {
            requestRender();
        } else {
            toast("The selection contains no audio");
        }
    }

    function actPaste() {
        if (clipboard === null) {
            toast("Clipboard is empty: copy or cut a selection first");
            return;
        }
        var track = getTargetTrack();
        if (track === null) {
            track = ASProject.addTrack();
            selectedTrackId = track.id;
            rebuildDOM();
        }
        ASProject.pasteBuffer(track, cursor, clipboard, "Pasted");
        cursor += clipboard.duration;
        selection = null;
        updateHScroll();
        requestRender();
    }

    function actUndo() {
        if (ASProject.undo()) {
            selection = null;
            if (ASProject.getTrack(selectedTrackId) === null) {
                selectedTrackId = null;
            }
            updateHScroll();
            rebuildDOM();
        }
    }

    function actRedo() {
        if (ASProject.redo()) {
            selection = null;
            if (ASProject.getTrack(selectedTrackId) === null) {
                selectedTrackId = null;
            }
            updateHScroll();
            rebuildDOM();
        }
    }

    /* ============ Zoom ============ */

    function zoomAt(centerX, factor) {
        var tAtCenter = xToTime(centerX);
        pxPerSec = Math.max(MIN_PPS, Math.min(MAX_PPS, pxPerSec * factor));
        scrollX = Math.max(0, tAtCenter * pxPerSec - centerX);
        updateHScroll();
        requestRender();
    }

    function zoomFit() {
        var d = ASProject.duration();
        if (d <= 0) {
            return;
        }
        pxPerSec = Math.max(MIN_PPS, Math.min(MAX_PPS, viewportW() / d * 0.94));
        scrollX = 0;
        updateHScroll();
        requestRender();
    }

    /* ============ Popups ============ */

    var activePopup = null;

    function closePopup() {
        if (activePopup !== null && activePopup.parentElement !== null) {
            activePopup.parentElement.removeChild(activePopup);
        }
        activePopup = null;
    }

    function showPopup(anchorEl, buildContent) {
        closePopup();
        var pop = document.createElement("div");
        pop.className = "asPopup";
        buildContent(pop);
        document.body.appendChild(pop);
        var rect = anchorEl.getBoundingClientRect();
        var px = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8);
        var py = rect.bottom + 4;
        if (py + pop.offsetHeight > window.innerHeight - 8) {
            py = Math.max(8, rect.top - pop.offsetHeight - 4);
        }
        pop.style.left = Math.max(8, px) + "px";
        pop.style.top = py + "px";
        activePopup = pop;
        setTimeout(function () {
            document.addEventListener("mousedown", onDocDown);
        }, 0);
        function onDocDown(ev) {
            if (activePopup === null || !activePopup.contains(ev.target)) {
                document.removeEventListener("mousedown", onDocDown);
                closePopup();
            }
        }
    }

    function menuItem(label, onClick, danger) {
        var item = document.createElement("div");
        item.className = "asPopupItem" + (danger ? " danger" : "");
        item.textContent = label;
        item.addEventListener("click", function () {
            closePopup();
            onClick();
        });
        return item;
    }

    /* ============ Track headers ============ */

    var SVG_MIC = '<svg viewBox="0 0 16 16"><path d="M8 1a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 8 1zm-4.5 6h1.2v.5a3.3 3.3 0 0 0 6.6 0V7h1.2v.5a4.5 4.5 0 0 1-3.9 4.4V14H11v1.2H5V14h2.4v-2.1A4.5 4.5 0 0 1 3.5 7.5z"/></svg>';
    var SVG_DOTS = '<svg viewBox="0 0 16 16"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>';

    function buildTrackHeader(track) {
        var el = document.createElement("div");
        el.className = "trackHeader" + (track.id === selectedTrackId ? " selected" : "");
        el.dataset.trackId = track.id;

        //Row 1: icon, name, menu
        var row1 = document.createElement("div");
        row1.className = "thRow";
        var icon = document.createElement("span");
        icon.className = "thIcon";
        icon.innerHTML = SVG_MIC;
        var name = document.createElement("span");
        name.className = "thName";
        name.textContent = track.name;
        name.title = "Double-click to rename";
        name.addEventListener("dblclick", function (ev) {
            ev.stopPropagation();
            startRenameTrack(track, row1, name);
        });
        var menuBtn = document.createElement("button");
        menuBtn.className = "thMenuBtn";
        menuBtn.title = "Track options";
        menuBtn.innerHTML = SVG_DOTS;
        menuBtn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            showTrackMenu(track, menuBtn, row1, name);
        });
        row1.appendChild(icon);
        row1.appendChild(name);
        row1.appendChild(menuBtn);

        //Row 2: gain knob, volume slider, M / S
        var row2 = document.createElement("div");
        row2.className = "thRow";
        var knob = document.createElement("div");
        knob.className = "thKnob";
        updateKnob(knob, track);
        bindKnob(knob, track);
        var vol = document.createElement("input");
        vol.type = "range";
        vol.className = "thVolume";
        vol.min = "0";
        vol.max = "150";
        vol.value = String(Math.round(track.volume * 100));
        vol.title = "Volume";
        updateVolStyle(vol);
        vol.addEventListener("input", function () {
            track.volume = parseInt(vol.value, 10) / 100;
            updateVolStyle(vol);
            ASEngine.updateTrackGains(ASProject.getTracks());
        });
        vol.addEventListener("click", function (ev) { ev.stopPropagation(); });
        var muteBtn = document.createElement("button");
        muteBtn.className = "thToggle" + (track.muted ? " muteOn" : "");
        muteBtn.textContent = "M";
        muteBtn.title = "Mute track";
        muteBtn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            track.muted = !track.muted;
            muteBtn.classList.toggle("muteOn", track.muted);
            ASEngine.updateTrackGains(ASProject.getTracks());
            requestRender();
        });
        var soloBtn = document.createElement("button");
        soloBtn.className = "thToggle" + (track.solo ? " soloOn" : "");
        soloBtn.textContent = "S";
        soloBtn.title = "Solo track";
        soloBtn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            track.solo = !track.solo;
            soloBtn.classList.toggle("soloOn", track.solo);
            ASEngine.updateTrackGains(ASProject.getTracks());
            requestRender();
        });
        row2.appendChild(knob);
        row2.appendChild(vol);
        row2.appendChild(muteBtn);
        row2.appendChild(soloBtn);

        //Row 3: effects (channel strip) button
        var fxBtn = document.createElement("button");
        fxBtn.className = "thEffects";
        fxBtn.textContent = "Effects";
        fxBtn.title = "Gain and pan for this track";
        fxBtn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            showEffectsPanel(track, fxBtn, knob);
        });

        el.appendChild(row1);
        el.appendChild(row2);
        el.appendChild(fxBtn);

        el.addEventListener("mousedown", function () {
            if (selectedTrackId !== track.id) {
                selectedTrackId = track.id;
                refreshHeaderSelection();
                requestRender();
            }
        });
        return el;
    }

    function updateVolStyle(vol) {
        var pct = Math.round(parseInt(vol.value, 10) / 150 * 100);
        vol.style.setProperty("--vol-pct", pct + "%");
    }

    function updateKnob(knob, track) {
        var angle = track.gainDb / 24 * 135;
        knob.style.setProperty("--knob-angle", angle + "deg");
        knob.title = "Gain: " + track.gainDb.toFixed(1) + " dB (drag up / down, double-click to reset)";
    }

    function bindKnob(knob, track) {
        knob.addEventListener("mousedown", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var startY = ev.clientY;
            var startDb = track.gainDb;
            function onMove(mv) {
                var db = startDb + (startY - mv.clientY) * 0.15;
                track.gainDb = Math.max(-24, Math.min(24, Math.round(db * 10) / 10));
                updateKnob(knob, track);
                ASEngine.updateTrackGains(ASProject.getTracks());
            }
            function onUp() {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            }
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
        knob.addEventListener("dblclick", function (ev) {
            ev.stopPropagation();
            track.gainDb = 0;
            updateKnob(knob, track);
            ASEngine.updateTrackGains(ASProject.getTracks());
        });
    }

    function startRenameTrack(track, row, nameEl) {
        var input = document.createElement("input");
        input.className = "thNameInput";
        input.value = track.name;
        row.replaceChild(input, nameEl);
        input.focus();
        input.select();
        var done = false;
        function commit(apply) {
            if (done) { return; }
            done = true;
            if (apply && input.value.trim() !== "") {
                track.name = input.value.trim();
            }
            rebuildDOM();
        }
        input.addEventListener("keydown", function (ev) {
            ev.stopPropagation();
            if (ev.key === "Enter") { commit(true); }
            if (ev.key === "Escape") { commit(false); }
        });
        input.addEventListener("blur", function () { commit(true); });
    }

    function showTrackMenu(track, anchor, row, nameEl) {
        showPopup(anchor, function (pop) {
            pop.appendChild(menuItem("Rename", function () {
                startRenameTrack(track, row, nameEl);
            }));
            pop.appendChild(menuItem("Move up", function () {
                ASProject.moveTrack(track.id, -1);
                rebuildDOM();
            }));
            pop.appendChild(menuItem("Move down", function () {
                ASProject.moveTrack(track.id, 1);
                rebuildDOM();
            }));
            var sep = document.createElement("div");
            sep.className = "asPopupSep";
            pop.appendChild(sep);
            pop.appendChild(menuItem("Delete track", function () {
                ASProject.removeTrack(track.id);
                if (selectedTrackId === track.id) {
                    selectedTrackId = null;
                }
                if (selection !== null && selection.trackId === track.id) {
                    selection = null;
                }
                updateHScroll();
                rebuildDOM();
            }, true));
        });
    }

    function showEffectsPanel(track, anchor, knob) {
        showPopup(anchor, function (pop) {
            var panel = document.createElement("div");
            panel.className = "fxPanel";
            panel.innerHTML =
                "<h4>" + escapeHtml(track.name) + " - channel strip</h4>" +
                "<div class='fxRow'><label>Gain</label><input type='range' class='fxGain' min='-24' max='24' step='0.5'><span class='fxVal fxGainVal'></span></div>" +
                "<div class='fxRow'><label>Pan</label><input type='range' class='fxPan' min='-100' max='100' step='1'><span class='fxVal fxPanVal'></span></div>";
            var gainSlider = panel.querySelector(".fxGain");
            var gainVal = panel.querySelector(".fxGainVal");
            var panSlider = panel.querySelector(".fxPan");
            var panVal = panel.querySelector(".fxPanVal");

            function refresh() {
                gainSlider.value = String(track.gainDb);
                gainVal.textContent = track.gainDb.toFixed(1) + " dB";
                panSlider.value = String(Math.round((track.pan || 0) * 100));
                var p = Math.round((track.pan || 0) * 100);
                panVal.textContent = p === 0 ? "C" : (p < 0 ? "L" + (-p) : "R" + p);
            }
            gainSlider.addEventListener("input", function () {
                track.gainDb = parseFloat(gainSlider.value);
                updateKnob(knob, track);
                ASEngine.updateTrackGains(ASProject.getTracks());
                refresh();
            });
            panSlider.addEventListener("input", function () {
                track.pan = parseInt(panSlider.value, 10) / 100;
                ASEngine.updateTrackGains(ASProject.getTracks());
                refresh();
            });
            refresh();
            pop.appendChild(panel);

            //Destructive effects list
            var sep = document.createElement("div");
            sep.className = "asPopupSep";
            pop.appendChild(sep);
            var caption = document.createElement("div");
            caption.className = "scGroupTitle";
            caption.style.padding = "0 12px";
            caption.textContent = "Apply effect";
            pop.appendChild(caption);
            ASEffects.getEffects().forEach(function (effect) {
                pop.appendChild(menuItem(effect.label, function () {
                    showEffectDialog(track, effect);
                }));
            });
        });
    }

    //Timeline range an effect applies to: the selection on this track,
    //or the whole track when nothing is selected
    function effectTargetRange(track) {
        if (selection !== null && selection.trackId === track.id && selection.t1 - selection.t0 > 0.001) {
            return { t0: selection.t0, t1: selection.t1, label: "selection " + selection.t0.toFixed(2) + "s - " + selection.t1.toFixed(2) + "s" };
        }
        var end = 0;
        track.clips.forEach(function (c) {
            end = Math.max(end, ASProject.clipEnd(c));
        });
        if (end <= 0) {
            return null;
        }
        return { t0: 0, t1: end, label: "the whole track" };
    }

    function showEffectDialog(track, effect) {
        var range = effectTargetRange(track);
        if (range === null) {
            toast("Track \"" + track.name + "\" has no audio to process");
            return;
        }
        var paramValues = {};
        effect.params.forEach(function (p) {
            paramValues[p.id] = p.def;
        });

        buildModal(effect.label, function (body) {
            var info = document.createElement("div");
            info.className = "prefHint";
            info.style.marginLeft = "0";
            info.style.marginBottom = "12px";
            info.textContent = effect.hint + " Applies to " + range.label + " on \"" + track.name + "\".";
            body.appendChild(info);

            effect.params.forEach(function (p) {
                var row = document.createElement("div");
                row.className = "fxRow";
                var label = document.createElement("label");
                label.textContent = p.label;
                var slider = document.createElement("input");
                slider.type = "range";
                slider.min = String(p.min);
                slider.max = String(p.max);
                slider.step = String(p.step);
                slider.value = String(p.def);
                var val = document.createElement("span");
                val.className = "fxVal";
                function refreshVal() {
                    val.textContent = paramValues[p.id] + (p.unit ? " " + p.unit : "");
                }
                slider.addEventListener("input", function () {
                    paramValues[p.id] = parseFloat(slider.value);
                    refreshVal();
                });
                refreshVal();
                row.appendChild(label);
                row.appendChild(slider);
                row.appendChild(val);
                body.appendChild(row);
            });
            if (effect.params.length === 0) {
                var none = document.createElement("div");
                none.className = "prefHint";
                none.style.marginLeft = "0";
                none.textContent = "This effect has no parameters.";
                body.appendChild(none);
            }
        }, function (footer, close) {
            var cancel = document.createElement("button");
            cancel.className = "asBtn";
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", close);
            var apply = document.createElement("button");
            apply.className = "asBtn primary";
            apply.textContent = "Apply";
            apply.addEventListener("click", function () {
                apply.disabled = true;
                apply.textContent = "Processing...";
                //Let the button repaint before the (possibly heavy) DSP runs
                setTimeout(function () {
                    try {
                        var count = ASProject.applyEffectToRange(track, range.t0, range.t1, function (buf) {
                            return ASEffects.apply(effect.id, buf, paramValues);
                        });
                        close();
                        if (count === 0) {
                            toast("Nothing to process in that range");
                        } else {
                            toast(effect.label + " applied to " + range.label);
                            updateHScroll();
                            requestRender();
                        }
                    } catch (e) {
                        close();
                        toast(effect.label + " failed: " + e.message, true);
                    }
                }, 30);
            });
            footer.appendChild(cancel);
            footer.appendChild(apply);
        });
    }

    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function refreshHeaderSelection() {
        var headers = headerList.querySelectorAll(".trackHeader");
        headers.forEach(function (h) {
            h.classList.toggle("selected", parseInt(h.dataset.trackId, 10) === selectedTrackId);
        });
    }

    /* ============ DOM rebuild (tracks changed) ============ */

    function rebuildDOM() {
        closePopup();
        headerList.innerHTML = "";
        laneCanvasByTrack = {};

        //Preserve the playhead element across rebuilds
        if (playheadEl.parentElement !== null) {
            playheadEl.parentElement.removeChild(playheadEl);
        }
        laneList.innerHTML = "";

        ASProject.getTracks().forEach(function (track) {
            headerList.appendChild(buildTrackHeader(track));

            var lane = document.createElement("div");
            lane.className = "lane";
            var canvas = document.createElement("canvas");
            canvas.className = "laneCanvas";
            lane.appendChild(canvas);
            laneList.appendChild(lane);
            laneCanvasByTrack[track.id] = canvas;
            bindLaneEvents(canvas, track);
        });
        laneList.style.height = (ASProject.getTracks().length * LANE_H) + "px";
        laneList.appendChild(playheadEl);
        requestRender();
    }

    /* ============ Lane interactions ============ */

    function clipHitTest(track, t, x) {
        //Returns {clip, zone} where zone = "trimL" | "trimR" | "move" | "body"
        for (var i = track.clips.length - 1; i >= 0; i--) {
            var c = track.clips[i];
            var x0 = timeToX(c.start);
            var x1 = timeToX(ASProject.clipEnd(c));
            if (x < x0 - EDGE_TOL || x > x1 + EDGE_TOL) {
                continue;
            }
            if (Math.abs(x - x0) <= EDGE_TOL) {
                return { clip: c, zone: "trimL" };
            }
            if (Math.abs(x - x1) <= EDGE_TOL) {
                return { clip: c, zone: "trimR" };
            }
            if (x >= x0 && x <= x1) {
                return { clip: c, zone: "body" };
            }
        }
        return null;
    }

    function bindLaneEvents(canvas, track) {
        canvas.addEventListener("mousedown", function (ev) {
            if (ev.button !== 0) {
                return;
            }
            ev.preventDefault();
            var rect = canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var t = xToTime(x);

            if (selectedTrackId !== track.id) {
                selectedTrackId = track.id;
                refreshHeaderSelection();
            }

            var hit = clipHitTest(track, t, x);
            var mode = "select";
            var clip = null;
            if (hit !== null) {
                clip = hit.clip;
                if (hit.zone === "trimL" || hit.zone === "trimR") {
                    mode = hit.zone;
                } else if (y <= 3 + CLIP_HEADER_H) {
                    mode = "move";
                }
            }

            dragState = {
                mode: mode,
                track: track,
                clip: clip,
                baseLeft: rect.left,
                startX: x,
                startT: t,
                origStart: clip !== null ? clip.start : 0,
                origOffset: clip !== null ? clip.offset : 0,
                origDuration: clip !== null ? clip.duration : 0,
                //Neighbour limits so clips can never overlap on a track
                bounds: clip !== null ? ASProject.moveBounds(track, clip) : null,
                moved: false,
                editBegun: false
            };

            if (mode === "select") {
                cursor = snapTime(t);
                if (!ASEngine.isPlaying()) {
                    ASEngine.setPosition(cursor);
                }
                selection = null;
                requestRender();
            }
        });

        //Hover cursor feedback
        canvas.addEventListener("mousemove", function (ev) {
            if (dragState !== null) {
                return;
            }
            var rect = canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var hit = clipHitTest(track, xToTime(x), x);
            if (hit === null) {
                canvas.style.cursor = "text";
            } else if (hit.zone === "trimL" || hit.zone === "trimR") {
                canvas.style.cursor = "ew-resize";
            } else if (y <= 3 + CLIP_HEADER_H) {
                canvas.style.cursor = "grab";
            } else {
                canvas.style.cursor = "text";
            }
        });

        canvas.addEventListener("dblclick", function (ev) {
            var rect = canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var hit = clipHitTest(track, xToTime(x), x);
            if (hit !== null) {
                selection = {
                    trackId: track.id,
                    t0: hit.clip.start,
                    t1: ASProject.clipEnd(hit.clip)
                };
                requestRender();
            }
        });
    }

    function onWindowMouseMove(ev) {
        if (dragState === null) {
            return;
        }
        var x = ev.clientX - dragState.baseLeft;
        var dt = (x - dragState.startX) / pxPerSec;
        var st = dragState;

        if (st.mode === "select") {
            if (!st.moved && Math.abs(x - st.startX) < 4) {
                return;
            }
            st.moved = true;
            var a = snapTime(st.startT);
            var b = snapTime(xToTime(x));
            selection = {
                trackId: st.track.id,
                t0: Math.max(0, Math.min(a, b)),
                t1: Math.max(a, b)
            };
            requestRender();
            return;
        }

        if (st.clip === null) {
            return;
        }
        if (!st.moved && Math.abs(x - st.startX) < 3) {
            return;
        }
        if (!st.editBegun) {
            ASProject.beginEdit();
            st.editBegun = true;
        }
        st.moved = true;

        if (st.mode === "move") {
            var ns = snapTime(Math.max(0, st.origStart + dt));
            st.clip.start = Math.max(st.bounds.min, Math.min(st.bounds.max, ns));
        } else if (st.mode === "trimL") {
            var newStart = snapTime(st.origStart + dt);
            var delta = newStart - st.origStart;
            //Clamp: buffer head, timeline start, and the previous clip's end
            var minDelta = Math.max(-st.origOffset, -st.origStart, st.bounds.min - st.origStart);
            delta = Math.max(minDelta, Math.min(st.origDuration - ASProject.MIN_CLIP_LEN, delta));
            st.clip.start = st.origStart + delta;
            st.clip.offset = st.origOffset + delta;
            st.clip.duration = st.origDuration - delta;
        } else if (st.mode === "trimR") {
            var maxDur = st.clip.buffer.duration - st.origOffset;
            //bounds.max = nextClipStart - duration, so this is the next clip's start
            if (isFinite(st.bounds.max)) {
                maxDur = Math.min(maxDur, st.bounds.max + st.origDuration - st.origStart);
            }
            var target = snapTime(st.origStart + st.origDuration + dt) - st.origStart;
            st.clip.duration = Math.max(ASProject.MIN_CLIP_LEN, Math.min(maxDur, target));
        }
        requestRender();
    }

    function onWindowMouseUp() {
        if (dragState === null) {
            return;
        }
        if (dragState.mode === "move" && dragState.moved) {
            ASProject.sortClips(dragState.track);
        }
        if (dragState.moved) {
            updateHScroll();
        }
        dragState = null;
        requestRender();
    }

    /* ============ Ruler interactions ============ */

    function bindRulerEvents() {
        var down = false;
        rulerCanvas.addEventListener("mousedown", function (ev) {
            down = true;
            seekFromEvent(ev);
        });
        window.addEventListener("mousemove", function (ev) {
            if (down) {
                seekFromEvent(ev);
            }
        });
        window.addEventListener("mouseup", function () {
            down = false;
        });
        function seekFromEvent(ev) {
            var rect = rulerCanvas.getBoundingClientRect();
            var t = snapTime(xToTime(ev.clientX - rect.left));
            seekTo(t);
        }
    }

    /* ============ Wheel: scroll & zoom ============ */

    function onWheel(ev) {
        if (ev.ctrlKey) {
            ev.preventDefault();
            var rect = rulerCanvas.getBoundingClientRect();
            var cx = ev.clientX - rect.left;
            zoomAt(cx, ev.deltaY < 0 ? 1.25 : 0.8);
            return;
        }
        var dx = ev.deltaX;
        if (ev.shiftKey && dx === 0) {
            dx = ev.deltaY;
        }
        if (dx !== 0) {
            ev.preventDefault();
            scrollX = Math.max(0, scrollX + dx);
            updateHScroll();
            requestRender();
        }
    }

    /* ============ Import / Export ============ */

    function importFiles(fileList) {
        var files = Array.prototype.slice.call(fileList);
        if (files.length === 0) {
            return;
        }
        //A locally opened .asproj is loaded as a project (embedded audio only:
        //the browser cannot read a _data folder next to a picked file)
        var projFile = files.find(function (f) { return /\.asproj$/i.test(f.name); });
        if (projFile !== undefined) {
            if (!confirmReplaceProject()) {
                return;
            }
            projFile.text().then(function (txt) {
                openProjectFromMeta(JSON.parse(txt), null);
            }).catch(function () {
                toast("Could not read \"" + projFile.name + "\"", true);
            });
            return;
        }
        var pending = files.length;
        files.forEach(function (file) {
            file.arrayBuffer().then(function (ab) {
                return ASEngine.getContext().decodeAudioData(ab);
            }).then(function (buffer) {
                var base = file.name.replace(/\.[^.]+$/, "");
                var track = ASProject.addTrack(base);
                ASProject.addClip(track, buffer, cursor, base);
                selectedTrackId = track.id;
                done();
            }).catch(function () {
                toast("Could not decode \"" + file.name + "\"", true);
                done();
            });
        });
        function done() {
            pending--;
            if (pending === 0) {
                updateHScroll();
                rebuildDOM();
            }
        }
    }

    //True when running inside the ArozOS virtual desktop, where the
    //ao_module file selector and upload helpers are available
    function inArozOS() {
        try {
            return typeof ao_module_virtualDesktop !== "undefined" && ao_module_virtualDesktop &&
                typeof ao_module_openFileSelector === "function";
        } catch (e) {
            return false;
        }
    }

    function importFromVirtualFS(fileInfoList, at, fitAfter) {
        var pending = fileInfoList.length;
        if (pending === 0) {
            return;
        }
        fileInfoList.forEach(function (info) {
            fetch("/media?file=" + encodeURIComponent(info.filepath)).then(function (resp) {
                if (!resp.ok) {
                    throw new Error("HTTP " + resp.status);
                }
                return resp.arrayBuffer();
            }).then(function (ab) {
                return ASEngine.getContext().decodeAudioData(ab);
            }).then(function (buffer) {
                var base = info.filename.replace(/\.[^.]+$/, "");
                var track = ASProject.addTrack(base);
                ASProject.addClip(track, buffer, at, base);
                selectedTrackId = track.id;
                done();
            }).catch(function () {
                toast("Could not load \"" + info.filename + "\"", true);
                done();
            });
        });
        function done() {
            pending--;
            if (pending === 0) {
                updateHScroll();
                if (fitAfter) {
                    zoomFit();
                }
                rebuildDOM();
            }
        }
    }

    function openImport(anchor) {
        if (!inArozOS()) {
            byId("importFileInput").click();
            return;
        }
        showPopup(anchor, function (pop) {
            pop.appendChild(menuItem("From ArozOS storage...", function () {
                ao_module_openFileSelector(function (filedata) {
                    if (filedata && filedata.length > 0) {
                        importFromVirtualFS(filedata, cursor, false);
                    }
                }, "user:/Music", "file", true);
            }));
            pop.appendChild(menuItem("Upload from this device...", function () {
                byId("importFileInput").click();
            }));
            var sep = document.createElement("div");
            sep.className = "asPopupSep";
            pop.appendChild(sep);
            pop.appendChild(menuItem("Open project (.asproj)...", openProjectPicker));
        });
    }

    //Render the whole project into a 16-bit WAV blob, then cb(blob, duration)
    function renderMixWav(busyBtn, cb) {
        var dur = ASProject.duration();
        if (dur <= 0) {
            toast("The project is empty: record or import some audio first");
            return;
        }
        busyBtn.disabled = true;
        toast("Rendering mix...");
        ASEngine.mixdown(ASProject.getTracks(), dur).then(function (rendered) {
            busyBtn.disabled = false;
            cb(ASEngine.encodeWav(rendered), dur);
        }).catch(function (err) {
            busyBtn.disabled = false;
            toast("Render failed: " + err.message, true);
        });
    }

    function exportMix() {
        renderMixWav(byId("btnExport"), function (blob, dur) {
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "AudioStudio_Mix.wav";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
            toast("Exported " + dur.toFixed(2) + "s mix as WAV");
        });
    }

    //Save the rendered mix onto the ArozOS server through the user's storage
    function saveToServer() {
        if (!inArozOS() || typeof ao_module_uploadFile !== "function") {
            //Standalone mode: fall back to a local download
            exportMix();
            return;
        }
        renderMixWav(byId("btnSave"), function (blob) {
            ao_module_openFileSelector(function (filedata) {
                if (!filedata || filedata.length === 0) {
                    return;
                }
                var target = filedata[0];
                var filename = target.filename;
                if (!/\.wav$/i.test(filename)) {
                    filename += ".wav";
                }
                var dir = target.filepath.split("/").slice(0, -1).join("/");
                var file = new File([blob], filename, { type: "audio/wav" });
                ao_module_uploadFile(file, dir, function () {
                    toast("Saved " + filename + " to " + dir);
                }, undefined, function (status) {
                    toast("Save failed (HTTP " + status + "): check folder permissions", true);
                });
            }, "user:/Music", "new", false, { defaultName: "AudioStudio_Mix.wav" });
        });
    }

    function showSaveMenu(anchor) {
        showPopup(anchor, function (pop) {
            pop.appendChild(menuItem("Save project (.asproj)...", saveProject));
            pop.appendChild(menuItem("Save mix as WAV...", saveToServer));
        });
    }

    /* ============ Project file save / open ============ */

    //Save the project as <name>.asproj + <name>_data/ audio folder (Audacity
    //style). The metadata references the data files relatively, so copying
    //the .asproj together with its _data folder to another ArozOS instance
    //keeps the project openable.
    function saveProject() {
        if (ASProject.isEmpty()) {
            toast("The project is empty: record or import some audio first");
            return;
        }
        if (!inArozOS() || typeof ao_module_uploadFile !== "function") {
            saveProjectEmbeddedDownload();
            return;
        }
        ao_module_openFileSelector(function (filedata) {
            if (!filedata || filedata.length === 0) {
                return;
            }
            var target = filedata[0];
            var filename = target.filename;
            if (!/\.asproj$/i.test(filename)) {
                filename += ".asproj";
            }
            var dir = target.filepath.split("/").slice(0, -1).join("/");
            var basename = filename.replace(/\.asproj$/i, "");
            var dataDirName = basename + "_data";
            var ser = ASProject.serializeProject(basename);
            var total = ser.buffers.length;
            var i = 0;
            var btn = byId("btnSave");
            btn.disabled = true;
            toast("Saving project (" + total + " audio file" + (total === 1 ? "" : "s") + ")...");

            function fail(status) {
                btn.disabled = false;
                toast("Project save failed (HTTP " + status + "): check folder permissions", true);
            }

            function next() {
                if (i >= total) {
                    //All audio uploaded: reference them and write the metadata
                    ser.meta.buffers.forEach(function (b, idx) {
                        b.file = dataDirName + "/audio_" + idx + ".wav";
                    });
                    var metaBlob = new Blob([JSON.stringify(ser.meta, null, 2)], { type: "application/json" });
                    var metaFile = new File([metaBlob], filename, { type: "application/json" });
                    ao_module_uploadFile(metaFile, dir, function () {
                        btn.disabled = false;
                        toast("Project saved: " + filename);
                    }, undefined, fail);
                    return;
                }
                var blob = ASEngine.encodeWavFloat32(ser.buffers[i]);
                var f = new File([blob], "audio_" + i + ".wav", { type: "audio/wav" });
                ao_module_uploadFile(f, dir + "/" + dataDirName, function () {
                    i++;
                    next();
                }, undefined, fail);
            }
            next();
        }, "user:/Music", "new", false, { defaultName: "MyProject.asproj" });
    }

    //Standalone fallback: one self-contained .asproj download with the audio
    //embedded as base64 (no server to hold a _data folder)
    function saveProjectEmbeddedDownload() {
        var ser = ASProject.serializeProject("Project");
        toast("Packing project...");
        Promise.all(ser.buffers.map(function (b) {
            return ASEngine.encodeWavFloat32(b).arrayBuffer();
        })).then(function (arrayBuffers) {
            arrayBuffers.forEach(function (ab, i) {
                ser.meta.buffers[i].data = ASStorage.arrayBufferToBase64(ab);
            });
            var blob = new Blob([JSON.stringify(ser.meta)], { type: "application/json" });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "AudioStudio_Project.asproj";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
            toast("Project downloaded as .asproj (audio embedded)");
        });
    }

    function confirmReplaceProject() {
        return ASProject.isEmpty() ||
            window.confirm("Opening a project will replace the current tracks. Continue?");
    }

    //Restore a project from its metadata. baseDir is the virtual directory
    //holding the .asproj (for resolving relative data files), or null when
    //only embedded base64 audio can be used (local file open).
    function openProjectFromMeta(meta, baseDir) {
        if (!ASProject.isProjectMeta(meta)) {
            toast("Not a valid Audio Studio project file", true);
            return;
        }
        toast("Loading project audio...");
        Promise.all(meta.buffers.map(function (entry) {
            var abPromise;
            if (typeof entry.data === "string") {
                abPromise = Promise.resolve(ASStorage.base64ToArrayBuffer(entry.data));
            } else if (baseDir !== null && typeof entry.file === "string") {
                abPromise = fetch("/media?file=" + encodeURIComponent(baseDir + "/" + entry.file)).then(function (resp) {
                    if (!resp.ok) {
                        throw new Error("HTTP " + resp.status);
                    }
                    return resp.arrayBuffer();
                });
            } else {
                abPromise = Promise.reject(new Error("no audio source"));
            }
            return abPromise.then(function (ab) {
                return ASEngine.getContext().decodeAudioData(ab);
            }).catch(function () {
                return null; //Missing / unreadable data file: clip is skipped
            });
        })).then(function (buffers) {
            ASProject.restoreProject(meta, buffers);
            selection = null;
            selectedTrackId = null;
            cursor = 0;
            ASEngine.setPosition(0);
            scrollX = 0;
            updateHScroll();
            zoomFit();
            rebuildDOM();
            var missing = buffers.filter(function (b) { return b === null; }).length;
            if (missing > 0) {
                toast(missing + " audio file(s) missing: is the _data folder next to the project file?", true);
            } else {
                toast("Project opened: " + (meta.name || "untitled"));
            }
        });
    }

    function openProjectFromVpath(vpath) {
        if (!confirmReplaceProject()) {
            return;
        }
        fetch("/media?file=" + encodeURIComponent(vpath)).then(function (resp) {
            if (!resp.ok) {
                throw new Error("HTTP " + resp.status);
            }
            return resp.json();
        }).then(function (meta) {
            var baseDir = vpath.split("/").slice(0, -1).join("/");
            openProjectFromMeta(meta, baseDir);
        }).catch(function (err) {
            toast("Could not open project: " + err.message, true);
        });
    }

    function openProjectPicker() {
        ao_module_openFileSelector(function (filedata) {
            if (!filedata || filedata.length === 0) {
                return;
            }
            var f = filedata[0];
            if (!/\.asproj$/i.test(f.filename)) {
                toast("Please select an Audio Studio project (.asproj) file", true);
                return;
            }
            openProjectFromVpath(f.filepath);
        }, "user:/Music", "file", false);
    }

    /* ============ Shortcut & settings modals ============ */

    function buildModal(titleText, buildBody, buildFooter) {
        var overlay = document.createElement("div");
        overlay.className = "asModalOverlay";
        var modal = document.createElement("div");
        modal.className = "asModal";
        var title = document.createElement("div");
        title.className = "asModalTitle";
        title.textContent = titleText;
        var body = document.createElement("div");
        body.className = "asModalBody";
        var footer = document.createElement("div");
        footer.className = "asModalFooter";
        modal.appendChild(title);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        function close() {
            capturingShortcut = false;
            if (overlay.parentElement !== null) {
                overlay.parentElement.removeChild(overlay);
            }
        }
        overlay.addEventListener("mousedown", function (ev) {
            if (ev.target === overlay) {
                close();
            }
        });
        buildBody(body, close);
        buildFooter(footer, close);
        document.body.appendChild(overlay);
        return close;
    }

    function showShortcutsModal() {
        buildModal("Keyboard shortcuts", function (body) {
            renderShortcutRows(body);
        }, function (footer, close) {
            var resetBtn = document.createElement("button");
            resetBtn.className = "asBtn";
            resetBtn.textContent = "Reset all to defaults";
            resetBtn.addEventListener("click", function () {
                ASShortcuts.resetAll();
                var body = footer.parentElement.querySelector(".asModalBody");
                renderShortcutRows(body);
                updateEmptyHint();
            });
            var closeBtn = document.createElement("button");
            closeBtn.className = "asBtn primary";
            closeBtn.textContent = "Done";
            closeBtn.addEventListener("click", close);
            footer.appendChild(resetBtn);
            footer.appendChild(closeBtn);
        });
    }

    function renderShortcutRows(body) {
        body.innerHTML = "";
        var actions = ASShortcuts.getActions();
        var groups = [];
        actions.forEach(function (a) {
            if (groups.indexOf(a.group) < 0) {
                groups.push(a.group);
            }
        });
        groups.forEach(function (group) {
            var gt = document.createElement("div");
            gt.className = "scGroupTitle";
            gt.textContent = group;
            body.appendChild(gt);
            actions.filter(function (a) { return a.group === group; }).forEach(function (action) {
                body.appendChild(buildShortcutRow(action, body));
            });
        });
    }

    function buildShortcutRow(action, body) {
        var row = document.createElement("div");
        row.className = "scRow";
        var label = document.createElement("span");
        label.className = "scLabel";
        label.textContent = action.label;
        var binding = document.createElement("button");
        binding.className = "scBinding";
        binding.textContent = ASShortcuts.getBinding(action.id) || "(none)";
        binding.title = "Click, then press the new key combination";
        binding.addEventListener("click", function () {
            if (capturingShortcut) {
                return;
            }
            capturingShortcut = true;
            binding.classList.add("capturing");
            binding.textContent = "Press keys...";
            function onKey(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.key === "Escape") {
                    finish(null);
                    return;
                }
                var b = ASShortcuts.bindingFromEvent(ev);
                if (b === null) {
                    return; //Pure modifier: keep waiting
                }
                finish(b);
            }
            function finish(b) {
                window.removeEventListener("keydown", onKey, true);
                capturingShortcut = false;
                if (b !== null) {
                    ASShortcuts.setBinding(action.id, b);
                }
                renderShortcutRows(body);
                updateEmptyHint();
            }
            window.addEventListener("keydown", onKey, true);
        });
        var reset = document.createElement("button");
        reset.className = "scReset";
        reset.textContent = "Reset";
        reset.title = "Restore default: " + action.def;
        reset.addEventListener("click", function () {
            ASShortcuts.resetBinding(action.id);
            renderShortcutRows(body);
            updateEmptyHint();
        });
        row.appendChild(label);
        row.appendChild(binding);
        row.appendChild(reset);
        return row;
    }

    function showSettingsModal() {
        buildModal("Editor preferences", function (body) {
            body.innerHTML =
                "<div class='scGroupTitle'>Behavior when deleting a portion of a clip</div>" +
                "<div class='prefRow'><label><input type='radio' name='delMode' value='gap'> Leave gap</label>" +
                "<div class='prefHint'>The removed section leaves silence behind; nothing moves.</div></div>" +
                "<div class='prefRow'><label><input type='radio' name='delMode' value='ripple'> Close gap (ripple)</label>" +
                "<div class='prefHint'>Front and back sections are joined together and later audio shifts left.</div></div>" +
                "<div class='scGroupTitle'>Recording</div>" +
                "<div class='prefRow'><label><input type='checkbox' id='prefOverdub'> Play other tracks while recording (overdub)</label></div>";
            var radios = body.querySelectorAll("input[name='delMode']");
            radios.forEach(function (r) {
                r.checked = r.value === prefs.deleteMode;
                r.addEventListener("change", function () {
                    if (r.checked) {
                        prefs.deleteMode = r.value;
                        savePrefs();
                    }
                });
            });
            var od = body.querySelector("#prefOverdub");
            od.checked = prefs.overdub;
            od.addEventListener("change", function () {
                prefs.overdub = od.checked;
                savePrefs();
            });
        }, function (footer, close) {
            var closeBtn = document.createElement("button");
            closeBtn.className = "asBtn primary";
            closeBtn.textContent = "Done";
            closeBtn.addEventListener("click", close);
            footer.appendChild(closeBtn);
        });
    }

    /* ============ Keyboard dispatch ============ */

    var ACTION_HANDLERS = {
        playPause: playPause,
        stop: stopAll,
        record: toggleRecord,
        goToStart: goToStart,
        goToEnd: goToEnd,
        splitAtCursor: actSplit,
        copySelection: actCopy,
        cutSelection: actCut,
        pasteAtCursor: actPaste,
        deleteSelection: actDelete,
        muteSelection: actMute,
        undo: actUndo,
        redo: actRedo,
        zoomIn: function () { zoomAt(viewportW() / 2, 1.35); },
        zoomOut: function () { zoomAt(viewportW() / 2, 0.74); },
        zoomFit: zoomFit,
        toggleSnap: function () {
            prefs.snap = !prefs.snap;
            savePrefs();
            updateToolbarState();
            toast("Snapping " + (prefs.snap ? "enabled" : "disabled"));
        },
        addTrack: function () {
            var track = ASProject.addTrack();
            selectedTrackId = track.id;
            rebuildDOM();
        },
        exportMix: exportMix
    };

    function onKeyDown(ev) {
        if (capturingShortcut) {
            return;
        }
        var target = ev.target;
        if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        var actionId = ASShortcuts.matchEvent(ev);
        if (actionId === null || ACTION_HANDLERS[actionId] === undefined) {
            return;
        }
        ev.preventDefault();
        ACTION_HANDLERS[actionId]();
    }

    /* ============ Init ============ */

    function bindToolbar() {
        byId("btnGoStart").addEventListener("click", goToStart);
        byId("btnPlay").addEventListener("click", playPause);
        byId("btnStop").addEventListener("click", stopAll);
        byId("btnGoEnd").addEventListener("click", goToEnd);
        byId("btnRecord").addEventListener("click", toggleRecord);
        byId("btnUndo").addEventListener("click", actUndo);
        byId("btnRedo").addEventListener("click", actRedo);
        byId("btnSplit").addEventListener("click", actSplit);
        byId("btnCopy").addEventListener("click", actCopy);
        byId("btnCut").addEventListener("click", actCut);
        byId("btnPaste").addEventListener("click", actPaste);
        byId("btnMuteSel").addEventListener("click", actMute);
        byId("btnDeleteSel").addEventListener("click", actDelete);
        byId("btnZoomIn").addEventListener("click", function () { zoomAt(viewportW() / 2, 1.35); });
        byId("btnZoomOut").addEventListener("click", function () { zoomAt(viewportW() / 2, 0.74); });
        byId("btnZoomFit").addEventListener("click", zoomFit);
        byId("btnImport").addEventListener("click", function () {
            openImport(byId("btnImport"));
        });
        byId("importFileInput").addEventListener("change", function (ev) {
            importFiles(ev.target.files);
            ev.target.value = "";
        });
        byId("btnSave").addEventListener("click", function () {
            showSaveMenu(byId("btnSave"));
        });
        byId("btnExport").addEventListener("click", exportMix);
        byId("btnShortcuts").addEventListener("click", showShortcutsModal);
        byId("btnSettings").addEventListener("click", showSettingsModal);
        byId("addTrackBtn").addEventListener("click", ACTION_HANDLERS.addTrack);
        snapCheck.addEventListener("change", function () {
            prefs.snap = snapCheck.checked;
            savePrefs();
        });
    }

    function init() {
        laneView = byId("laneView");
        laneList = byId("laneList");
        headerList = byId("headerList");
        rulerCanvas = byId("rulerCanvas");
        playheadEl = byId("playhead");
        hscroll = byId("hscroll");
        hscrollInner = byId("hscrollInner");
        timeDisplay = byId("timeDisplay");
        meterCanvas = byId("meterCanvas");
        emptyHint = byId("emptyHint");
        snapCheck = byId("snapCheck");

        loadPrefs(); //Local cache first for instant startup
        bindToolbar();
        bindRulerEvents();

        //Sync settings from the user's server-side appdata (cross-device)
        ASShortcuts.setPersistHandler(function (bindingMap) {
            ASStorage.save("keybinds", bindingMap);
        });
        ASStorage.load("prefs", function (stored) {
            mergePrefs(stored);
            requestRender();
        });
        ASStorage.load("keybinds", function (stored) {
            ASShortcuts.applyStored(stored);
            updateEmptyHint();
        });

        window.addEventListener("mousemove", onWindowMouseMove);
        window.addEventListener("mouseup", onWindowMouseUp);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", function () {
            updateHScroll();
            requestRender();
        });
        laneView.addEventListener("wheel", onWheel, { passive: false });
        rulerCanvas.addEventListener("wheel", onWheel, { passive: false });
        hscroll.addEventListener("scroll", function () {
            scrollX = hscroll.scrollLeft;
            requestRender();
        });
        laneView.addEventListener("scroll", function () {
            headerList.style.transform = "translateY(" + (-laneView.scrollTop) + "px)";
        });
        window.addEventListener("beforeunload", function (ev) {
            if (!ASProject.isEmpty()) {
                ev.preventDefault();
                ev.returnValue = "";
            }
        });

        //Float window title (when running inside the ArozOS desktop)
        try {
            if (typeof ao_module_setWindowTitle === "function") {
                ao_module_setWindowTitle("Audio Studio");
            }
        } catch (e) { /* standalone mode */ }

        //Load files passed by "open with" (embedded launch)
        var inputFiles = null;
        try {
            if (typeof ao_module_loadInputFiles === "function") {
                inputFiles = ao_module_loadInputFiles();
            }
        } catch (e) {
            inputFiles = null;
        }

        if (inputFiles !== null && inputFiles.length > 0) {
            var projInput = inputFiles.find(function (f) { return /\.asproj$/i.test(f.filename); });
            if (projInput !== undefined) {
                openProjectFromVpath(projInput.filepath);
            } else {
                importFromVirtualFS(inputFiles, 0, true);
            }
        } else {
            //Start with one empty track ready for recording
            var track = ASProject.addTrack();
            selectedTrackId = track.id;
        }

        updateHScroll();
        rebuildDOM();
        ensureRafLoop();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
