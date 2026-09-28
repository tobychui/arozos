/*
    Cine Studio - captions

    Imports SubRip (.srt) and WebVTT (.vtt) files as caption title clips
    on a dedicated "Captions" video track, one clip per cue, styled with
    the Caption preset; exports the caption clips of the project back to
    SRT. Caption clips are ordinary title clips, so they can be edited,
    moved and rendered like any other title.
*/
"use strict";

window.CS = window.CS || {};

CS.captions = {

    /* ---------- parsing ---------- */

    parseTime: function (s) {
        var m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(s.trim());
        if (!m) { return NaN; }
        var h = m[1] ? parseInt(m[1], 10) : 0;
        var ms = parseInt((m[4] + "00").slice(0, 3), 10);
        return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + ms / 1000;
    },

    //Cues {start, end, text} from SRT or VTT text
    parse: function (raw) {
        var text = raw.replace(/\r/g, "").replace(/^﻿/, "");
        var cues = [];
        text.split(/\n\n+/).forEach(function (block) {
            var lines = block.split("\n").filter(function (l) { return l.trim() !== ""; });
            if (!lines.length) { return; }
            if (/^WEBVTT/i.test(lines[0]) || /^NOTE/i.test(lines[0]) || /^STYLE/i.test(lines[0])) { return; }
            var idx = lines.findIndex(function (l) { return l.indexOf("-->") >= 0; });
            if (idx < 0) { return; }
            var parts = lines[idx].split("-->");
            var start = CS.captions.parseTime(parts[0]);
            var end = CS.captions.parseTime((parts[1] || "").trim().split(/\s+/)[0] || "");
            if (isNaN(start) || isNaN(end) || end <= start) { return; }
            var body = lines.slice(idx + 1).join("\n").replace(/<[^>]+>/g, "").trim();
            if (!body) { return; }
            cues.push({ start: start, end: end, text: body });
        });
        return cues;
    },

    /* ---------- import ---------- */

    importDialog: function () {
        if (CS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
            window.csCaptionCallback = function csCaptionCallback(filedata) {
                if (!filedata || !filedata.length) { return; }
                fetch("../media?file=" + encodeURIComponent(filedata[0].filepath))
                    .then(function (r) { return r.text(); })
                    .then(function (txt) { CS.captions.importText(txt, filedata[0].filename); })
                    .catch(function () { CS.toast("Could not read the caption file", true); });
            };
            ao_module_openFileSelector(window.csCaptionCallback, "user:/Desktop", "file", false, {
                filter: ["srt", "vtt"],
                path_memory_key: "captions"
            });
            return;
        }
        var inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".srt,.vtt";
        inp.addEventListener("change", function () {
            if (!inp.files.length) { return; }
            inp.files[0].text().then(function (txt) { CS.captions.importText(txt, inp.files[0].name); });
        });
        inp.click();
    },

    //Create the caption track and one title clip per cue
    importText: function (txt, filename) {
        var cues = CS.captions.parse(txt || "");
        if (!cues.length) { CS.toast("No captions found in " + (filename || "the file"), true); return 0; }
        var trackId = CS.captions.captionTrack();
        var preset = CS.titles.presets.filter(function (p) { return p.id === "caption"; })[0];
        cues.forEach(function (cue) {
            var props = CS.defaultClipProps();
            props.text = JSON.parse(JSON.stringify(preset.text));
            props.text.content = cue.text;
            props.caption = true;
            CS.project.clips.push({
                id: CS.uid(),
                mediaId: null,
                kind: "title",
                trackId: trackId,
                start: cue.start,
                in: 0,
                out: cue.end - cue.start,
                props: props
            });
        });
        CS.commit("Import Captions");
        CS.toast(cues.length + " caption" + (cues.length === 1 ? "" : "s") + " imported");
        return cues.length;
    },

    //The "Captions" video track, created above everything else when missing
    captionTrack: function () {
        var existing = CS.project.tracks.filter(function (t) { return t.kind === "video" && t.caption; })[0];
        if (existing) { return existing.id; }
        var id = CS.createTrack("video");
        var track = CS.getTrack(id);
        track.name = "Captions";
        track.caption = true;
        return id;
    },

    /* ---------- export ---------- */

    formatTime: function (t) {
        var ms = Math.round((t - Math.floor(t)) * 1000);
        var s = Math.floor(t);
        function p(n, w) { n = String(n); while (n.length < (w || 2)) { n = "0" + n; } return n; }
        return p(Math.floor(s / 3600)) + ":" + p(Math.floor(s / 60) % 60) + ":" + p(s % 60) + "," + p(ms, 3);
    },

    //Caption clips (any title clip on a caption track, or flagged as a caption) as SRT
    toSRT: function () {
        var clips = CS.project.clips.filter(function (c) {
            if (c.kind !== "title") { return false; }
            var track = CS.getTrack(c.trackId);
            return c.props.caption || (track && track.caption);
        }).sort(function (a, b) { return a.start - b.start; });
        return clips.map(function (c, i) {
            return (i + 1) + "\n" + CS.captions.formatTime(c.start) + " --> " + CS.captions.formatTime(CS.clipEnd(c)) +
                "\n" + ((c.props.text && c.props.text.content) || "") + "\n";
        }).join("\n");
    },

    exportSRT: function () {
        var srt = CS.captions.toSRT();
        if (!srt) { CS.toast("No caption clips to export", true); return; }
        var name = (CS.project.name || "captions") + ".srt";
        var blob = new Blob([srt], { type: "text/plain" });
        if (CS.inArozOS() && typeof ao_module_uploadFile !== "undefined") {
            var file = new File([blob], name, { type: "text/plain" });
            ao_module_uploadFile(file, CS.APP_ROOT + "/Exports", function () {
                CS.toast("Exported " + name + " to Cine Studio/Exports");
            }, undefined, function () { CS.toast("Could not save the captions", true); });
        } else {
            CS.fileio.downloadBlob(blob, name);
            CS.toast("Captions downloaded");
        }
    }
};
