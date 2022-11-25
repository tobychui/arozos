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
    
    /*
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
            if (nearbyFiles[i] != "" && filelib.isDir(nearbyFiles[i]) == false && supportedFormats[k] == ext){
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
    */
    var nearbyFiles = filelib.readdir(dirname, "user");
    var audioFiles = [];
    var supportedFormats = [".mp3",".flac",".wav",".ogg",".aac",".webm",".mp4"];
    //For each nearby files
    for (var i =0; i < nearbyFiles.length; i++){
        var thisFile = nearbyFiles[i];
        var ext = thisFile.Ext;
        //Check if the file extension is in the supported extension list
        for (var k = 0; k < supportedFormats.length; k++){
            if (!thisFile.IsDir && supportedFormats[k] == ext){
                var fileExt = ext.substr(1);
                var fileName = thisFile.Filename;
                var fileSize = thisFile.Filesize;
                var humanReadableFileSize = bytesToSize(fileSize);

                var thisFileInfo = [];
                thisFileInfo.push(fileName);
                thisFileInfo.push(thisFile.Filepath);
                thisFileInfo.push(fileExt);
                thisFileInfo.push(humanReadableFileSize);
                
                audioFiles.push(thisFileInfo);
                break;
            }
        }
    }


    if (nearbyFiles == false || nearbyFiles.length == 0){
        //There are some error that unable to scan nearby files. Return this file info only.
        audioFiles = [];
        var thisFile = openingFilePath;
        var ext = thisFile.split(".").pop();
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
    }
    sendJSONResp(JSON.stringify(audioFiles));
}

