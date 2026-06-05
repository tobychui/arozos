requirelib("filelib");
if (!filelib.fileExists("user:/.appdata/"))        { filelib.mkdir("user:/.appdata/"); }
if (!filelib.fileExists("user:/.appdata/NotepadA")) { filelib.mkdir("user:/.appdata/NotepadA"); }
filelib.writeFile("user:/.appdata/NotepadA/" + tmpid + ".tmp", "");
sendJSONResp(JSON.stringify("user:/.appdata/NotepadA/" + tmpid+".tmp"));