/*
	Cine Studio - list saved projects

	Returns the .cine project files stored in the per-user
	user:/Cine Studio/Projects folder as a JSON array of
	{ filename, vpath } objects (newest first by user sort).
*/

requirelib("filelib");

var dir = "user:/Cine Studio/Projects";
var out = [];

if (filelib.fileExists(dir)) {
	var files = filelib.aglob(dir + "/*.cine", "mostRecent");
	if (files === false || files === null) {
		files = [];
	}
	for (var i = 0; i < files.length; i++) {
		var vpath = files[i];
		var parts = vpath.split("/");
		out.push({
			filename: parts[parts.length - 1],
			vpath: vpath
		});
	}
}

sendJSONResp(JSON.stringify(out));
