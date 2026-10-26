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

    //Save target exists. Glob all supported photo and video files
    var supportedExt = ["jpg", "png", "mp4", "webm"];
    var files = [];
    for (var e = 0; e < supportedExt.length; e++){
        var matched = filelib.aglob(savetarget + "*." + supportedExt[e]);
        for (var i = 0; i < matched.length; i++){
            files.push(matched[i]);
        }
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