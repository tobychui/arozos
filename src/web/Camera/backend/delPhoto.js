/*
    Delete a given photo file by path

    Require paramter
    - savetarget
    - filename
*/

requirelib("filelib");

function deleteFile(){
    //Check if the save dir 
    if (savetarget.substring(savetarget.length - 1,1) != "/"){
        savetarget = savetarget + "/";
    }

    //Check if the file exists
    var targetFilepath = savetarget + filename;
    if (!filelib.fileExists(targetFilepath)){
        sendJSONResp(JSON.stringify({
            error: "Target file not exists"
        }));
        return
    }

    //Check if it is a supported photo or video file extension
    var ext = targetFilepath.split(".").pop().toLowerCase();
    var supportedExt = ["png", "jpg", "mp4", "webm"];
    if (supportedExt.indexOf(ext) < 0){
        //This is not a media file taken by Camera. Reject delete operation
        sendJSONResp(JSON.stringify({
            error: "Target file is not a photo or video taken by Camera"
        }));
        return
    }

    //OK. Remove the file.
    filelib.deleteFile(targetFilepath);
    sendJSONResp(JSON.stringify("OK"));
}

deleteFile();