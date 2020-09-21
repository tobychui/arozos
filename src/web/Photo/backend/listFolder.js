var folderList = glob("user:/Photo/Photo/storage/*");
arr = []
for (var i = 0; i < folderList.length; i++) {
    if (isDir(folderList[i])) {
        arr.push({ VPath: folderList[i] + "/", Foldername: folderList[i].split("/").pop() })
    }
}
sendJSONResp(JSON.stringify(arr))