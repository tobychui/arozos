/*
    List Photos

    This script list all the photos within the user selected save target folder
    sorted by the time where the photo is taken (Latest first)
*/

requirelib("filelib");

function generatePhotoList(){
    //Check if savetarget is empty
    if (typeof savetarget == 'undefined' || savetarget == ""){
        sendJSONResp(JSON.stringify({
            error: "savetarget not defined"
        }));
        return
    }

    //Check if save target exists
    if (!filelib.fileExists(savetarget)){
        sendJSONResp(JSON.stringify({
            error: "savetarget not exists"
        }));
        return
    }

    //Glob it
    if (savetarget.substring(savetarget.length - 1,1) != "/"){
        savetarget = savetarget + "/";
    }

    var files = filelib.aglob(savetarget + "*.*", "mostRecent");
    var results = [];

    //Filter out only the supported photo and video files.
    //Each entry carries its path and modification time (Unix seconds) so the
    //viewer can display the creation date like the iPhone Photos app.
    var supportedExt = ["jpg", "png", "mp4", "webm"];
    for (var i = 0; i < files.length; i++){
        var thisFile = files[i];
        if (!filelib.isDir(thisFile)){
            var ext = thisFile.split(".").pop().toLowerCase();
            if (supportedExt.indexOf(ext) >= 0){
                results.push({
                    path: thisFile,
                    mtime: filelib.mtime(thisFile, true)
                });
            }
        }
    }

    //Send the results
    sendJSONResp(JSON.stringify(results));
}

generatePhotoList();