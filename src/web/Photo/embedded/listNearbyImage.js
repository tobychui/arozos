var loadedfile = requirelib("filelib");
if (!loadedfile) {
    console.log("Failed to load lib filelib, terminated.");
}

function isRawImage(filename){
    var ext = getExt(filename);
    ext = ext.toLowerCase();
    return (ext == "arw" || ext == "cr2" || ext == "dng" || ext == "nef" || ext == "raf" || ext == "orf");
}

function getExt(filename){
    return filename.split(".").pop();
}

function getBasename(filename){
    var parts = filename.split("/");
    var name = parts[parts.length - 1];
    var nameParts = name.split(".");
    nameParts.pop();
    return nameParts.join(".");
}

function filterDuplicates(files){
    // Create a map to store files by their basename
    var fileMap = {};

    for (var i = 0; i < files.length; i++){
        var filepath = files[i];
        var basename = getBasename(filepath);
        var isRaw = isRawImage(filepath);

        if (!fileMap[basename]){
            fileMap[basename] = {
                raw: null,
                jpg: null
            };
        }

        if (isRaw){
            fileMap[basename].raw = filepath;
        } else {
            fileMap[basename].jpg = filepath;
        }
    }

    // Build result array, prioritizing RAW over JPG
    var result = [];
    for (var basename in fileMap){
        var entry = fileMap[basename];
        if (entry.raw){
            // If RAW exists, use it (ignore JPG)
            result.push(entry.raw);
        } else if (entry.jpg){
            // Otherwise use JPG
            result.push(entry.jpg);
        }
    }

    return result;
}

function listNearby(){
    var result = [];
    //Extract the path from the filepath
    var dirpath = path.split("\\").join("/");
    dirpath = dirpath.split("/");
    dirpath.pop();
    dirpath = dirpath.join("/");

    //Get nearby files and filter out the one that is web supported photo format
    var nearbyFiles = filelib.readdir(dirpath, "user")
    for (var i = 0; i < nearbyFiles.length; i++){
        var thisFile = nearbyFiles[i];
        //console.log(JSON.stringify(nearbyFiles[i]));
        var ext = thisFile.Ext.substr(1);
        ext = ext.toLowerCase();
        if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" || ext == "webp" ||
            isRawImage(filename)){
            result.push(thisFile.Filepath);
        }
    }

    // Filter out JPG duplicates when RAW files exist
    result = filterDuplicates(result);

    sendJSONResp(JSON.stringify(result))
}


if (typeof(path) == "undefined"){
    sendJSONResp(JSON.stringify({
        "error": "Invalid path given"
    }));
}else{
    listNearby();
}
