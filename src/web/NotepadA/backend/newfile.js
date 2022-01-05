requirelib("filelib");
filelib.mkdir("user:/Document/NotepadA");
filelib.writeFile("user:/Document/NotepadA/" + tmpid + ".tmp", "");
sendJSONResp(JSON.stringify("user:/Document/NotepadA/" + tmpid+".tmp"));