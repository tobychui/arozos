/*
	Cine Studio - Server side ffmpeg helpers

	Everything Cine Studio asks the host's ffmpeg to do goes through here:
	proxy media for footage the browser cannot decode (or that is too big
	to scrub at the chosen playback resolution), and the final timeline
	render, which runs on the server from the original files instead of
	recording the preview in real time.

	Both are background jobs (ffmpeg.makeProxy / ffmpeg.renderTimeline):
	the call returns at once and the front end follows the job through its
	progress file with the "progress" action.

	Parameters:
	  action = "check"                       - { ffmpeg, hwEncoder }
	  action = "proxy", src, kind, height    - start (or find) a proxy of src;
	                                           kind = video | audio | image,
	                                           height caps video proxies (0 = source)
	                                           -> { ok, ready, vpath, progress }
	  action = "jobdir"                      - create a scratch folder for a render
	                                           -> { ok, vpath }
	  action = "render", spec, dst           - start rendering the timeline spec
	                                           (JSON, see mod/media/render) into dst
	                                           -> { ok, progress }
	  action = "progress", progress, target  - { percentage, completed, stage, error, exists }
	  action = "cancel", progress            - stop a running job -> { ok, stopped }
	  action = "cleanup", target             - delete a scratch file / folder or a
	                                           progress file -> { ok, deleted }

	All paths are ArozOS virtual paths. Proxies and scratch folders live in
	user:/Cine Studio/Cache; progress files in tmp:/.
*/

requirelib("filelib");

var CACHE_ROOT = "user:/Cine Studio/Cache";

var hasFFmpeg = false;
try {
	hasFFmpeg = requirelib("ffmpeg");
} catch (e) {
	hasFFmpeg = false;
}

function reply(obj) {
	sendJSONResp(JSON.stringify(obj));
}

function fail(msg) {
	reply({ error: msg });
}

//Short stable hash of a string (FNV-1a), for cache file names
function hashString(s) {
	var h = 0x811c9dc5;
	for (var i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	var hex = h.toString(16);
	while (hex.length < 8) { hex = "0" + hex; }
	return hex;
}

function ensureCacheRoot() {
	if (!filelib.fileExists("user:/Cine Studio")) {
		filelib.mkdir("user:/Cine Studio");
	}
	if (!filelib.fileExists(CACHE_ROOT)) {
		filelib.mkdir(CACHE_ROOT);
	}
}

function isInsideCache(vpath) {
	return vpath.indexOf(CACHE_ROOT + "/") == 0 && vpath.indexOf("..") < 0;
}

function isProgressFile(vpath) {
	return vpath.indexOf("tmp:/cinestudio_") == 0 && vpath.indexOf("..") < 0 &&
		vpath.substr(vpath.length - 14) == ".progress.json";
}

function readProgress(progressFile) {
	if (!filelib.fileExists(progressFile)) {
		return null;
	}
	try {
		return JSON.parse(filelib.readFile(progressFile));
	} catch (e) {
		return null;
	}
}

//A job is in flight when its progress file is fresh: running jobs rewrite
//it twice a second, queued ones wait for an encoder slot
function jobInFlight(progressFile) {
	var p = readProgress(progressFile);
	if (!p || p.completed || p.stage == "failed" || p.stage == "done") {
		return false;
	}
	var age = Math.floor(Date.now() / 1000) - filelib.mtime(progressFile, true);
	if (p.stage == "queued") {
		return age < 600;
	}
	return age < 30;
}

function main() {
	if (typeof(action) == "undefined") {
		fail("action parameter is required");
		return;
	}

	if (action == "check") {
		var hw = "";
		if (hasFFmpeg) {
			try { hw = ffmpeg.hwEncoder() || ""; } catch (e) { hw = ""; }
		}
		reply({ ffmpeg: hasFFmpeg, hwEncoder: hw });
		return;
	}

	if (action == "proxy") {
		if (!hasFFmpeg) { fail("ffmpeg is not available on this host"); return; }
		if (typeof(src) == "undefined" || typeof(kind) == "undefined") {
			fail("src and kind parameters are required");
			return;
		}
		var exts = { video: ".mp4", audio: ".m4a", image: ".png" };
		if (!exts[kind]) { fail("unsupported proxy kind"); return; }
		if (!filelib.fileExists(src)) { fail("source file not found"); return; }
		var h = (typeof(height) == "undefined") ? 0 : parseInt(height, 10);
		if (isNaN(h) || h < 0) { h = 0; }
		if (kind != "video") { h = 0; }

		ensureCacheRoot();
		//Same source, same modification time, same size, same height: same proxy
		var key = hashString(src) + hashString(filelib.mtime(src, true) + "|" + filelib.filesize(src));
		var name = "proxy_" + key + "_" + h + exts[kind];
		//Not "dst": a var here is hoisted over the whole of main() and would shadow
		//the dst POST parameter that the render action reads
		var proxyDst = CACHE_ROOT + "/" + name;
		var progressFile = "tmp:/cinestudio_" + name.replace(/\./g, "_") + ".progress.json";

		if (filelib.fileExists(proxyDst)) {
			reply({ ok: true, ready: true, vpath: proxyDst, progress: progressFile });
			return;
		}
		if (jobInFlight(progressFile)) {
			//Another tab or an earlier import already asked for it
			reply({ ok: true, ready: false, vpath: proxyDst, progress: progressFile });
			return;
		}
		var started = false;
		var errMsg = "";
		try {
			started = ffmpeg.makeProxy(src, proxyDst, kind, h, progressFile);
		} catch (e) {
			errMsg = e.toString();
		}
		if (!started) { fail(errMsg || "unable to start the proxy conversion"); return; }
		reply({ ok: true, ready: false, vpath: proxyDst, progress: progressFile });
		return;
	}

	if (action == "jobdir") {
		ensureCacheRoot();
		var jobdir = CACHE_ROOT + "/render_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
		filelib.mkdir(jobdir);
		reply({ ok: filelib.fileExists(jobdir), vpath: jobdir });
		return;
	}

	if (action == "render") {
		if (!hasFFmpeg) { fail("ffmpeg is not available on this host"); return; }
		if (typeof(spec) == "undefined" || typeof(dst) == "undefined") {
			fail("spec and dst parameters are required");
			return;
		}
		if (dst.indexOf("..") >= 0) { fail("invalid destination"); return; }
		var renderProgress = "tmp:/cinestudio_render_" + Date.now().toString(36) + "_" +
			Math.floor(Math.random() * 1e6).toString(36) + ".progress.json";
		var ok = false;
		var renderErr = "";
		try {
			ok = ffmpeg.renderTimeline(spec, dst, renderProgress);
		} catch (e) {
			renderErr = e.toString();
		}
		if (!ok) { fail(renderErr || "unable to start the render"); return; }
		reply({ ok: true, progress: renderProgress, output: dst });
		return;
	}

	if (action == "progress") {
		if (typeof(progress) == "undefined") { fail("progress parameter is required"); return; }
		if (!isProgressFile(progress)) { fail("invalid progress file"); return; }
		var p = readProgress(progress) || { percentage: 0, completed: false, stage: "" };
		p.exists = (typeof(target) != "undefined" && target != "") ? filelib.fileExists(target) : false;
		reply(p);
		return;
	}

	if (action == "cancel") {
		if (!hasFFmpeg) { fail("ffmpeg is not available on this host"); return; }
		if (typeof(progress) == "undefined") { fail("progress parameter is required"); return; }
		if (!isProgressFile(progress)) { fail("invalid progress file"); return; }
		var stopped = false;
		try { stopped = ffmpeg.cancel(progress); } catch (e) { stopped = false; }
		reply({ ok: true, stopped: stopped });
		return;
	}

	if (action == "cleanup") {
		if (typeof(target) == "undefined") { fail("target parameter is required"); return; }
		//Only Cine Studio's own scratch data is ever deleted from here
		if (!isInsideCache(target) && !isProgressFile(target)) {
			fail("target is not a Cine Studio scratch file");
			return;
		}
		var existed = filelib.fileExists(target);
		if (existed) {
			if (filelib.isDir(target)) {
				var inner = filelib.glob(target + "/*");
				for (var i = 0; i < inner.length; i++) {
					filelib.deleteFile(inner[i]);
				}
			}
			filelib.deleteFile(target);
		}
		reply({ ok: true, deleted: existed && !filelib.fileExists(target) });
		return;
	}

	fail("unknown action: " + action);
}

main();
