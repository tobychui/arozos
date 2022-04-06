/*
    Exclude.js

    Handle read write of the excluded dirs function
    Excluded dirs shd be start with base folder name, for example
    for excluding user:/Photo/Manga/, just enter Manga

    Required paramters:
    set 
    folders (Required when set=true)
*/

includes("imagedb.js");

function GetExcludeFolders(){
    return getExcludeFolders();
}

function SetExcludeFolders(folders){
    setExcludeFolders(folders);
    sendJSONResp(JSON.stringify("OK"));
}

if (typeof(set) == "undefined"){
    //Get
    var excludeFolders = GetExcludeFolders();
    sendJSONResp(excludeFolders);
}else{
    //Set
    SetExcludeFolders(folders);
}