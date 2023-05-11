/*
    Download.js

    Download a file given
    - link
    - filepath
    - filename
*/
requirelib("http");

//Create the download folder if not exists
requirelib("filelib");
if (!filelib.fileExists(filepath)){
    filelib.mkdir(filepath);
}

//Download the file to target location
http.download(link, filepath, filename);

HTTP_HEADER = "application/json; charset=utf-8";
sendResp('"OK"');