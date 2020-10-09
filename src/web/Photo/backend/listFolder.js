var loadedfile = requirelib("filelib");
if (!loadedfile) {
    console.log("Failed to load lib filelib, terminated.");
}

var folderList = filelib.glob("user:/Photo/Photo/storage/*");
arr = []
for (var i = 0; i < folderList.length; i++) {
    if (filelib.isDir(folderList[i])) {
        arr.push({ VPath: folderList[i] + "/", Foldername: folderList[i].split("/").pop() })
    }
}
sendJSONResp(JSON.stringify(arr))