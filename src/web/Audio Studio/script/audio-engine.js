/*
    Audio Studio - audio-engine.js

    Wraps the Web Audio API: shared AudioContext, multi-track playback
    scheduling, microphone recording (MediaRecorder), level metering and
    offline mixdown to 16-bit WAV.

    Depends on nothing. ASProject / app.js sit on top of this.
*/

var ASEngine = (function () {
    "use strict";

    var actx = null;            //Shared AudioContext, lazy created
    var masterGain = null;
    var masterAnalyser = null;

    //Playback state
    var playing = false;
    var startCtxTime = 0;       //actx.currentTime when playback started
    var startPos = 0;           //Project time (sec) where playback started
    var activeSources = [];     //AudioBufferSourceNodes currently scheduled
    var liveTrackNodes = {};    //trackId -> {gain, pan} for live adjustment

    //Recording state
    var recState = null;        //{recorder, stream, srcNode, analyser, chunks, onComplete}

    var SCHEDULE_DELAY = 0.06;  //Small delay so all sources start in sync

    function getContext() {
        if (actx === null) {
            var AC = window.AudioContext || window.webkitAudioContext;
            actx = new AC();
            masterGain = actx.createGain();
            masterAnalyser = actx.createAnalyser();
            masterAnalyser.fftSize = 2048;
            masterGain.connect(masterAnalyser);
            masterAnalyser.connect(actx.destination);
        }
        return actx;
    }

    function resume() {
        var c = getContext();
        if (c.state === "suspended") {
            c.resume();
        }
    }

    function dbToLinear(db) {
        return Math.pow(10, db / 20);
    }

    //Effective linear gain of a track, honoring mute / solo states
    function trackGainValue(track, anySolo) {
        if (track.muted) {
            return 0;
        }
        if (anySolo && !track.solo) {
            return 0;
        }
        return track.volume * dbToLinear(track.gainDb);
    }

    //Build gain/pan nodes for every track of the project on the given context
    function buildTrackNodes(context, destination, tracks) {
        var anySolo = tracks.some(function (t) { return t.solo; });
        var nodes = {};
        tracks.forEach(function (track) {
            var g = context.createGain();
            g.gain.value = trackGainValue(track, anySolo);
            var out = g;
            if (typeof context.createStereoPanner === "function") {
                var p = context.createStereoPanner();
                p.pan.value = track.pan || 0;
                g.connect(p);
                out = p;
                nodes[track.id] = { gain: g, pan: p };
            } else {
                nodes[track.id] = { gain: g, pan: null };
            }
            out.connect(destination);
        });
        return nodes;
    }

    //Schedule every clip of every track onto the given context.
    //from = project time (sec) to start playing at.
    function scheduleClips(context, nodes, tracks, from, baseTime, collector) {
        tracks.forEach(function (track) {
            var trackNode = nodes[track.id];
            track.clips.forEach(function (clip) {
                var clipEnd = clip.start + clip.duration;
                if (clipEnd <= from + 0.001) {
                    return; //Entirely before the play position
                }
                var src = context.createBufferSource();
                src.buffer = clip.buffer;
                src.connect(trackNode.gain);
                var when = baseTime + Math.max(0, clip.start - from);
                var skip = Math.max(0, from - clip.start);
                var offset = clip.offset + skip;
                var dur = clip.duration - skip;
                if (dur <= 0) {
                    return;
                }
                src.start(when, offset, dur);
                if (collector) {
                    collector.push(src);
                }
            });
        });
    }

    function play(tracks, from) {
        resume();
        stopPlayback();
        var now = actx.currentTime;
        liveTrackNodes = buildTrackNodes(actx, masterGain, tracks);
        activeSources = [];
        scheduleClips(actx, liveTrackNodes, tracks, from, now + SCHEDULE_DELAY, activeSources);
        playing = true;
        startPos = from;
        startCtxTime = now + SCHEDULE_DELAY;
    }

    function stopPlayback() {
        if (playing) {
            startPos = getPosition();
        }
        activeSources.forEach(function (src) {
            try { src.stop(); } catch (e) { /* already stopped */ }
        });
        activeSources = [];
        Object.keys(liveTrackNodes).forEach(function (id) {
            try { liveTrackNodes[id].gain.disconnect(); } catch (e) { }
            if (liveTrackNodes[id].pan !== null) {
                try { liveTrackNodes[id].pan.disconnect(); } catch (e) { }
            }
        });
        liveTrackNodes = {};
        playing = false;
    }

    function getPosition() {
        if (!playing) {
            return startPos;
        }
        var p = startPos + (actx.currentTime - startCtxTime);
        return Math.max(startPos, p);
    }

    function setPosition(p) {
        startPos = Math.max(0, p);
    }

    function isPlaying() {
        return playing;
    }

    //Live-update track gains (volume slider / mute / solo changed mid-playback)
    function updateTrackGains(tracks) {
        if (!playing) {
            return;
        }
        var anySolo = tracks.some(function (t) { return t.solo; });
        tracks.forEach(function (track) {
            var node = liveTrackNodes[track.id];
            if (node === undefined) {
                return;
            }
            node.gain.gain.setTargetAtTime(trackGainValue(track, anySolo), actx.currentTime, 0.02);
            if (node.pan !== null) {
                node.pan.pan.setTargetAtTime(track.pan || 0, actx.currentTime, 0.02);
            }
        });
    }

    /* ---------- Metering ---------- */

    var meterBuf = null;
    function readAnalyserDb(analyser) {
        if (analyser === null) {
            return -Infinity;
        }
        if (meterBuf === null || meterBuf.length !== analyser.fftSize) {
            meterBuf = new Float32Array(analyser.fftSize);
        }
        if (typeof analyser.getFloatTimeDomainData !== "function") {
            return -Infinity;
        }
        analyser.getFloatTimeDomainData(meterBuf);
        var peak = 0;
        for (var i = 0; i < meterBuf.length; i++) {
            var v = Math.abs(meterBuf[i]);
            if (v > peak) {
                peak = v;
            }
        }
        if (peak <= 0.00001) {
            return -Infinity;
        }
        return 20 * Math.log10(peak);
    }

    //Returns the current meter level in dBFS. Prefers the mic while recording.
    function getMeterDb() {
        if (recState !== null) {
            return readAnalyserDb(recState.analyser);
        }
        return readAnalyserDb(masterAnalyser);
    }

    /* ---------- Recording ---------- */

    function isRecording() {
        return recState !== null;
    }

    //Returns the current instantaneous mic peak (0..1) for live waveform preview
    function getRecordingPeak() {
        if (recState === null) {
            return 0;
        }
        var db = readAnalyserDb(recState.analyser);
        if (db === -Infinity) {
            return 0;
        }
        return Math.min(1, Math.pow(10, db / 20));
    }

    //Start microphone recording. onComplete(audioBuffer|null, errMessage) fires
    //after stopRecording() once the captured audio has been decoded.
    function startRecording(onComplete, onError) {
        resume();
        if (recState !== null) {
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            onError("Microphone access is not supported by this browser (HTTPS is required)");
            return;
        }
        navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        }).then(function (stream) {
            var recorder;
            try {
                recorder = new MediaRecorder(stream);
            } catch (e) {
                stream.getTracks().forEach(function (t) { t.stop(); });
                onError("MediaRecorder is not supported by this browser");
                return;
            }
            var chunks = [];
            var srcNode = actx.createMediaStreamSource(stream);
            var analyser = actx.createAnalyser();
            analyser.fftSize = 2048;
            srcNode.connect(analyser); //Not routed to destination: no monitor feedback

            recorder.ondataavailable = function (ev) {
                if (ev.data && ev.data.size > 0) {
                    chunks.push(ev.data);
                }
            };
            recorder.onstop = function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                try { srcNode.disconnect(); } catch (e) { }
                var cb = recState !== null ? recState.onComplete : onComplete;
                recState = null;
                var blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
                if (blob.size === 0) {
                    cb(null, "Nothing was recorded");
                    return;
                }
                blob.arrayBuffer().then(function (ab) {
                    return actx.decodeAudioData(ab);
                }).then(function (audioBuffer) {
                    cb(audioBuffer, null);
                }).catch(function () {
                    cb(null, "Unable to decode the recorded audio");
                });
            };
            recState = {
                recorder: recorder,
                stream: stream,
                srcNode: srcNode,
                analyser: analyser,
                onComplete: onComplete
            };
            recorder.start(250);
        }).catch(function (err) {
            onError("Microphone permission denied or unavailable: " + err.message);
        });
    }

    function stopRecording() {
        if (recState === null) {
            return;
        }
        try {
            recState.recorder.stop();
        } catch (e) {
            recState = null;
        }
    }

    /* ---------- Offline mixdown / WAV export ---------- */

    //Render all tracks into a stereo AudioBuffer using an OfflineAudioContext
    function mixdown(tracks, durationSec) {
        return new Promise(function (resolve, reject) {
            var c = getContext();
            if (durationSec <= 0) {
                reject(new Error("Project is empty"));
                return;
            }
            var sr = c.sampleRate;
            var frames = Math.ceil(durationSec * sr);
            var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            var octx = new OAC(2, frames, sr);
            var nodes = buildTrackNodes(octx, octx.destination, tracks);
            scheduleClips(octx, nodes, tracks, 0, 0, null);
            octx.startRendering().then(resolve).catch(reject);
        });
    }

    //Encode an AudioBuffer as a 16-bit PCM WAV Blob
    function encodeWav(buffer) {
        var numCh = buffer.numberOfChannels;
        var sr = buffer.sampleRate;
        var frames = buffer.length;
        var bytesPerSample = 2;
        var blockAlign = numCh * bytesPerSample;
        var dataSize = frames * blockAlign;
        var ab = new ArrayBuffer(44 + dataSize);
        var view = new DataView(ab);

        function writeStr(offset, str) {
            for (var i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        }

        writeStr(0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, "WAVE");
        writeStr(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);            //PCM
        view.setUint16(22, numCh, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);           //Bits per sample
        writeStr(36, "data");
        view.setUint32(40, dataSize, true);

        var channels = [];
        var ch;
        for (ch = 0; ch < numCh; ch++) {
            channels.push(buffer.getChannelData(ch));
        }
        var pos = 44;
        for (var i = 0; i < frames; i++) {
            for (ch = 0; ch < numCh; ch++) {
                var s = Math.max(-1, Math.min(1, channels[ch][i]));
                view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                pos += 2;
            }
        }
        return new Blob([ab], { type: "audio/wav" });
    }

    //Encode an AudioBuffer as a 32-bit float WAV Blob (lossless; used for
    //project data files so repeated save / open cycles never degrade audio)
    function encodeWavFloat32(buffer) {
        var numCh = buffer.numberOfChannels;
        var sr = buffer.sampleRate;
        var frames = buffer.length;
        var blockAlign = numCh * 4;
        var dataSize = frames * blockAlign;
        var ab = new ArrayBuffer(44 + dataSize);
        var view = new DataView(ab);

        function writeStr(offset, str) {
            for (var i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        }

        writeStr(0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, "WAVE");
        writeStr(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 3, true);            //IEEE float
        view.setUint16(22, numCh, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 32, true);           //Bits per sample
        writeStr(36, "data");
        view.setUint32(40, dataSize, true);

        var channels = [];
        var ch;
        for (ch = 0; ch < numCh; ch++) {
            channels.push(buffer.getChannelData(ch));
        }
        var pos = 44;
        for (var i = 0; i < frames; i++) {
            for (ch = 0; ch < numCh; ch++) {
                view.setFloat32(pos, channels[ch][i], true);
                pos += 4;
            }
        }
        return new Blob([ab], { type: "audio/wav" });
    }

    return {
        getContext: getContext,
        resume: resume,
        dbToLinear: dbToLinear,
        play: play,
        stop: stopPlayback,
        isPlaying: isPlaying,
        getPosition: getPosition,
        setPosition: setPosition,
        updateTrackGains: updateTrackGains,
        getMeterDb: getMeterDb,
        isRecording: isRecording,
        getRecordingPeak: getRecordingPeak,
        startRecording: startRecording,
        stopRecording: stopRecording,
        mixdown: mixdown,
        encodeWav: encodeWav,
        encodeWavFloat32: encodeWavFloat32
    };
})();
