requirelib("filelib")

function getExt(filename){
    return filename.split(".").pop();
}

function isImage(filename){
    var ext = getExt(filename);
    ext = ext.toLowerCase();
    if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "webp"){
        return true;
    }
    return false;
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
    var results = filelib.aglob(filepath + "/*", "user");
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
    //Scan the folder
    var results = filelib.aglob(folder, "user");

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
    sendJSONResp(JSON.stringify([folders, files]));	
}

main();
