/*
    Get Meta Data

    Get the target file meta
    supplied data: file=(path)

*/
//Define helper functions
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
 }



if (requirelib("filelib") == true){
    //Get the filename from paramters
    var openingFilePath = decodeURIComponent(file);
    var dirname = openingFilePath.split("/")
    dirname.pop()
    dirname = dirname.join("/");

    //Scan nearby files
    var nearbyFiles = filelib.aglob(dirname + "/*", "user") //aglob must be used here to prevent errors for non-unicode filename
    var audioFiles = [];
    var supportedFormats = [".mp3",".flac",".wav",".ogg",".aac",".webm",".mp4"];
    //For each nearby files
    for (var i =0; i < nearbyFiles.length; i++){
        var thisFile = nearbyFiles[i];
        var ext = thisFile.split(".").pop();
        ext = "." + ext;
        //Check if the file extension is in the supported extension list
        for (var k = 0; k < supportedFormats.length; k++){
            if (filelib.isDir(nearbyFiles[i]) == false && supportedFormats[k] == ext){
                var fileExt = ext.substr(1);
                var fileName = thisFile.split("/").pop();
                var fileSize = filelib.filesize(thisFile);
                var humanReadableFileSize = bytesToSize(fileSize);

                var thisFileInfo = [];
                thisFileInfo.push(fileName);
                thisFileInfo.push(thisFile);
                thisFileInfo.push(fileExt);
                thisFileInfo.push(humanReadableFileSize);
                
                audioFiles.push(thisFileInfo);
                break;
            }
        }
    }
    sendJSONResp(JSON.stringify(audioFiles));
}

