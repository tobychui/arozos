requirelib("filelib")
include("../constants.js")

function getExt(filename){
    return filename.split(".").pop();
}

function isImage(filename){
    var ext = getExt(filename);
    ext = ext.toLowerCase();
    if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "webp" || isRawImage(filename)){
        return true;
    }
    return false;
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

function isHiddenFile(filepath){
    var filename = filepath.split("/").pop();
    if (filename.substring(0, 1) == "."){
        return true;
    }else{
        return false;
    }
}

function folderContainSubFiles(filepath){
    var results = filelib.aglob(filepath + "/*", "smart");
    if (results.length > 0){
        return true;
    }
    return false;
}

function dirname(filepath){
    var tmp = filepath.split("/");
    tmp.pop();
    return tmp.join("/");
}


function main(){
    //Get the sort method from agi input
    if (typeof(sort) == "undefined"){
        sort = "smart";
    }

    //Scan the folder
    var results = filelib.aglob(folder, sort);

    //Sort the files
    var files = [];
    var folders = [];
    for (var i = 0; i < results.length; i++){
        var thisFile = results[i];
        if (filelib.isDir(thisFile)){
            if (!isHiddenFile(thisFile) && folderContainSubFiles(thisFile)){
                folders.push(thisFile);
            }

        }else{
            if (isImage(thisFile)){
                files.push(thisFile);
            }
        }
    }

    // Filter out JPG duplicates when RAW files exist
    files = filterDuplicates(files);

    sendJSONResp(JSON.stringify([folders, files]));
}

main();
