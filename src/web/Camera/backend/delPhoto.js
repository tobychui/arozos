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

    //Check if it is supported image file extension
    var ext = targetFilepath.split(".").pop();
    if (ext != "png" && ext != "jpg"){
        //This is not an image file. Reject delete operation
        sendJSONResp(JSON.stringify({
            error: "Target file is not an image taken by Camera"
        }));
        return
    }

    //OK. Remove the file.
    filelib.deleteFile(targetFilepath);
    sendJSONResp(JSON.stringify("OK"));
}

deleteFile();