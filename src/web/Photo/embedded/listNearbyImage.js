var loadedfile = requirelib("filelib");
if (!loadedfile) {
    console.log("Failed to load lib filelib, terminated.");
}

function listNearby(){
    var result = [];
    //Extract the path from the filepath
    var dirpath = path.split("\\").join("/");
    dirpath = dirpath.split("/");
    dirpath.pop();
    dirpath = dirpath.join("/");

    //Get nearby files and filter out the one that is web supported photo format
    var nearbyFiles = filelib.aglob(dirpath + "/*", "user")
    for (var i = 0; i < nearbyFiles.length; i++){
        var ext = nearbyFiles[i].split(".").pop();
        ext = ext.toLowerCase();
        if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" || ext == "webp"){
            result.push(nearbyFiles[i]);
        }
    }

    sendJSONResp(JSON.stringify(result))
}


if (typeof(path) == "undefined"){
    sendJSONResp(JSON.stringify({
        "error": "Invalid path given"
    }));
}else{
    listNearby();
}
