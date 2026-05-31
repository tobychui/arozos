requirelib("filelib");
filelib.mkdir("user:/Document/Appdata/NotepadA");
filelib.writeFile("user:/Document/Appdata/NotepadA/" + tmpid + ".tmp", "");
sendJSONResp(JSON.stringify("user:/Document/Appdata/NotepadA/" + tmpid+".tmp"));