/*
    Common.js

    This file includes all the common functions required by other script files
    To use this, include this script file at the top of the other script file

    e.g.

    var succ = includes("common.js");

*/

//Check if the given extension is supported in AirMusic
function IsSupportExt(ext){
    var supportExtList = [".mp3",".flac",".wav",".ogg",".aac",".webm"];
    ext = "." + ext;
    for (var i = 0; i < supportExtList.length; i++){
        var thisExt = supportExtList[i];
        if (ext == thisExt){
            return true
        }
    }
    return false
}

//Convert filesize from bytes to human readable format
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
 }
