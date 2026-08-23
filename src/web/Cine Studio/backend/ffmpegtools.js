/*
	Cine Studio - Server side ffmpeg helpers

	The browser export pipeline records the timeline as a WebM file.
	When the host has ffmpeg installed, this script converts the
	uploaded WebM into an MP4 (H.264) file next to it.

	Parameters:
	  action = "check"                    - report whether ffmpeg is available
	  action = "convert", src, dst        - convert virtual path src into dst
	  action = "cleanup", target          - delete a temporary export render file
	                                      (a *.render.webm intermediate, or any
	                                      file inside the Cine Studio folder)

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
		//Deletable artifacts are the intermediate renders the exporter itself
		//writes (*.render.webm, which may sit in any folder the user picked as
		//the export destination) and anything inside the app folder
		var inAppFolder = (target.indexOf("user:/Cine Studio/") == 0);
		var isRenderTemp = (target.length > 12 &&
			target.substr(target.length - 12) == ".render.webm");
		if (!inAppFolder && !isRenderTemp) {
			sendJSONResp(JSON.stringify({ error: "target is not a Cine Studio export artifact" }));
			return;
		}
		if (target.indexOf("..") >= 0) {
			sendJSONResp(JSON.stringify({ error: "invalid target path" }));
			return;
		}
		var existed = filelib.fileExists(target);
		if (existed) {
			filelib.deleteFile(target);
		}
		sendJSONResp(JSON.stringify({ ok: true, deleted: existed && !filelib.fileExists(target) }));
		return;
	}

	sendJSONResp(JSON.stringify({ error: "unknown action: " + action }));
}

main();
