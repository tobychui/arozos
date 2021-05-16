/*

    This script load the latest image from the save directory
    Require paramter: savetarget
*/

requirelib('filelib');



function getLatestPhotoFilename(){
    if (savetarget == ""){
        sendJSONResp(JSON.stringify({
            error: "savetarget not defined"
        }));
        return
    }

    if (!filelib.fileExists(savetarget)){
        sendJSONResp(JSON.stringify({
            error: "savetarget not exists"
        }));
        return
    }

    if (savetarget.substring(savetarget.length - 1,1) != "/"){
        savetarget = savetarget + "/";
    }

    //Save target exists. Glob it
    var jpgFiles = filelib.aglob(savetarget + "*.jpg");
    var pngFiles = filelib.aglob(savetarget + "*.png");
    var files = [];

    for (var i = 0; i < jpgFiles.length; i++){
        files.push(jpgFiles[i]);
    }

    for (var i = 0; i < pngFiles.length; i++){
        files.push(pngFiles[i]);
    }

    var latestFileMtime = 0;
    var latestFilename = "";
    for (var i = 0; i < files.length; i++){
        var thisFile = files[i];
        var thisModTime = filelib.mtime(thisFile, true);
        if (thisModTime > latestFileMtime){
            latestFileMtime = thisModTime;
            latestFilename = thisFile;
        }
    }

    sendJSONResp(JSON.stringify(latestFilename));
}

getLatestPhotoFilename();