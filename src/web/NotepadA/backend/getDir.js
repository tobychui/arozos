/*
    getDir.js

    Author: tobychui
    An implementation in AGI script for getDir.php

*/

function basename(filepath){
    return filepath.split("/").pop();
}


requirelib("filelib");
var results = [];
if (listpath == ""){
    listpath = "user:/";
}
if (listpath.substring(listpath.length - 1, listpath.length) != "/"){
    listpath = listpath + "/";
}
var fileList = filelib.aglob(listpath + "*");
for (var i = 0; i < fileList.length; i++){
    if (filelib.isDir(fileList[i]) && basename(fileList[i]).substring(0, 1) != "."){
        results.push([fileList[i] + "/",basename(fileList[i])])
    }
}
sendJSONResp(JSON.stringify(results));