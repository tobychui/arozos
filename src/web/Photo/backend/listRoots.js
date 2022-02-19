requirelib("filelib");

function folderContainSubFiles(filepath){
    var results = filelib.aglob(filepath + "/*", "default");
    if (results.length > 0){
        return true;
    }
    return false;
}


function main(){
    var possibleRoots = [];
    for ( var i = 0; i < USER_VROOTS.length; i++){
        var thisRoot = USER_VROOTS[i];
        if (thisRoot.Filesystem != "virtual" && filelib.fileExists(thisRoot.UUID + ":/Photo") && folderContainSubFiles(thisRoot.UUID + ":/Photo/")){
            possibleRoots.push([thisRoot.Name, thisRoot.UUID + ":/", thisRoot.UUID + ":/Photo"]);
        }else{

        }
    }

    sendJSONResp(JSON.stringify(possibleRoots));
}

main();