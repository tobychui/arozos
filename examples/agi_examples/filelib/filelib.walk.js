/*
    File Walk. Recursive scan all files and subdirs under this root
*/
console.log("Testing File Walk");
requirelib("filelib");
var fileList = filelib.walk("user:/", true);
sendJSONResp(JSON.stringify(fileList));