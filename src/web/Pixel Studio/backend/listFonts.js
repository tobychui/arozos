/*
	Pixel Studio - Font listing backend

	Lists font files stored inside this webapp's ./fonts/ folder (appdata).
	Drop .ttf / .otf / .woff / .woff2 files into "web/Pixel Studio/fonts/"
	and they will show up in the text tool automatically.

	Returns: JSON array of {name, file} objects where
	  name - display name derived from the filename
	  file - path of the font file relative to the web root
*/

requirelib("appdata");

function main() {
	var supported = ["ttf", "otf", "woff", "woff2"];
	var fonts = [];

	var files = [];
	try {
		var raw = appdata.listDir("Pixel Studio/fonts");
		files = JSON.parse(raw);
	} catch (e) {
		//fonts folder missing or unreadable, return an empty list
		sendJSONResp(JSON.stringify([]));
		return;
	}

	for (var i = 0; i < files.length; i++) {
		var file = files[i];
		var ext = file.split(".").pop().toLowerCase();
		if (supported.indexOf(ext) < 0) {
			continue;
		}

		//Derive a friendly display name from the filename
		var name = file.split("/").pop();
		name = name.substring(0, name.length - ext.length - 1);
		name = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ");

		fonts.push({
			name: name,
			file: file
		});
	}

	sendJSONResp(JSON.stringify(fonts));
}

main();
