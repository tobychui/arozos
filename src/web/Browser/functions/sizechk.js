/*
    Check the download size of the current file
    Require paramter

    filepath (full path of downloading file)
*/

requirelib("filelib");
if (!filelib.fileExists(filepath)){
    sendJSONResp(-1);
}else{
    var filesize = filelib.filesize(filepath);
    sendJSONResp(filesize);    
}
