/*
	Cine Studio - Ensure app folders exist

	Creates the per-user folder structure used to store imported
	media and exported renders.

	Parameters:
	  (none)

	Returns { ok: true, root: "user:/Cine Studio" }
*/

requirelib("filelib");

var root = "user:/Cine Studio";
var subfolders = ["Media", "Exports", "Projects"];

if (!filelib.fileExists(root)) {
	filelib.mkdir(root);
}

for (var i = 0; i < subfolders.length; i++) {
	var target = root + "/" + subfolders[i];
	if (!filelib.fileExists(target)) {
		filelib.mkdir(target);
	}
}

sendJSONResp(JSON.stringify({
	ok: true,
	root: root
}));
