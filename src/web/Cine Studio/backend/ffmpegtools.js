/*
	Cine Studio - Server side ffmpeg helpers

	The browser export pipeline records the timeline as a WebM file.
	When the host has ffmpeg installed, this script converts the
	uploaded WebM into an MP4 (H.264) file next to it.

	Parameters:
	  action = "check"                    - report whether ffmpeg is available
	  action = "convert", src, dst        - convert virtual path src into dst
	  action = "cleanup", target          - delete a temporary file owned by the export

	All paths are ArozOS virtual paths (e.g. user:/Cine Studio/Exports/out.webm)
*/

var hasFFmpeg = false;
try {
	hasFFmpeg = requirelib("ffmpeg");
} catch (e) {
	hasFFmpeg = false;
}

function main() {
	if (typeof(action) == "undefined") {
		sendJSONResp(JSON.stringify({ error: "action parameter is required" }));
		return;
	}

	if (action == "check") {
		sendJSONResp(JSON.stringify({ ffmpeg: hasFFmpeg }));
		return;
	}

	if (action == "convert") {
		if (!hasFFmpeg) {
			sendJSONResp(JSON.stringify({ error: "ffmpeg is not available on this host" }));
			return;
		}
		if (typeof(src) == "undefined" || typeof(dst) == "undefined") {
			sendJSONResp(JSON.stringify({ error: "src and dst parameters are required" }));
			return;
		}

		requirelib("filelib");
		if (!filelib.fileExists(src)) {
			sendJSONResp(JSON.stringify({ error: "source file not found" }));
			return;
		}

		var progressFile = "tmp:/cinestudio_" + Math.floor(Math.random() * 100000000) + ".progress.json";
		var ok = false;
		var errMsg = "";
		try {
			ok = ffmpeg.convertWithProgress(src, dst, progressFile);
		} catch (e) {
			errMsg = e.toString();
			ok = false;
		}

		if (filelib.fileExists(progressFile)) {
			filelib.deleteFile(progressFile);
		}

		sendJSONResp(JSON.stringify({
			success: ok,
			output: dst,
			error: errMsg
		}));
		return;
	}

	if (action == "cleanup") {
		if (typeof(target) == "undefined") {
			sendJSONResp(JSON.stringify({ error: "target parameter is required" }));
			return;
		}
		requirelib("filelib");
		//Only allow deleting temporary export artifacts inside the app folder
		if (target.indexOf("user:/Cine Studio/") != 0) {
			sendJSONResp(JSON.stringify({ error: "target outside of Cine Studio folder" }));
			return;
		}
		if (filelib.fileExists(target)) {
			filelib.deleteFile(target);
		}
		sendJSONResp(JSON.stringify({ ok: true }));
		return;
	}

	sendJSONResp(JSON.stringify({ error: "unknown action: " + action }));
}

main();
