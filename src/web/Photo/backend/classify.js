/*
    Aroz Photo

    Image Classification Script
    Generate classification for the given image path

    Paramters:
    ws (Optional), upgrade this connection to websocket for realtime progress viewing
*/


requirelib("filelib");
requirelib("imagelib");
requirelib("websocket");
includes("imagedb.js");



function returnError(msg){
    sendJSONResp(JSON.stringify({"error": msg}));
}

function init(){
    newDBTableIfNotExists("photo");
}

function main(){
    var roots = getAllPossibleRoots();
    
    for (var i = 0; i < roots.length; i++){
        var thisVroot = roots[i][1];
        
        //Check if there is a lock for this tag file
        var lockFile = thisVroot + "Photo/tags.json.lock";
        if (filelib.fileExists(lockFile)){
            //Check if the file was > 24hs old. If yes, ignore it (maybe the previous rendering process crashed)
            var lockFileCreationTime = filelib.mtime(lockFile, true);
            if (Date.now()/1000 - lockFileCreationTime > 86400){
                //Delete the file and continue
                filelib.deleteFile(lockFile);
            }else{
                //Skip this vroot
                continue;
            }
        }
        
        //Create a lock file
        filelib.writeFile(lockFile, "")

        //Load all tags record for this vroot
        var tagsRecords = loadAllTagsRecord(thisVroot);

        //Clear up all images tags that no longer exists
        tagsRecords = matchAndClearNonExistsRecords(tagsRecords);
        
        //Convert it to a path:value keypair 
        var filepathMap = summarizeAndRestructureFilepaths(tagsRecords);
        //sendResp(JSON.stringify(filepathMap));

        //Scan for new images that is not classified and add them to the root tag file
        var allValidImagesInThisDir = getAllImageFilesInRoot(thisVroot);

        var websocketMode = false;
        if (typeof(ws) != "undefined"){
            websocketMode = true;
            websocket.upgrade(10);
            delay(100);
        }
        var counter = 1;
        for ( var j = 0; j < allValidImagesInThisDir.length; j++){
            var thisImageFile = allValidImagesInThisDir[j];

            //Check if this filepath is already been classified.
            if (typeof(filepathMap[thisImageFile]) == "undefined"){
                //Not found in cache. New photo! 
                console.log("[Photo] Analysising photo with neuralnet: " + thisImageFile);
                var thisImageTagRecord = getImageTagsRecord(thisImageFile);
                if (websocketMode){
                    websocket.send(JSON.stringify(thisImageFile));
                }

                //Push it into the record
                tagsRecords.push(thisImageTagRecord);
                counter++;
            }

            if (counter%5 == 0){
                //Auto save every 5 photos
                console.log("[Photo] Auto saved")
                saveAllTagsRecords(thisVroot, tagsRecords);
            }
          
        }
        //Final save
        saveAllTagsRecords(thisVroot, tagsRecords);

        //Delete lock file on this vroot
        filelib.deleteFile(lockFile);
    }
    console.log("[Photo] Automatic tag generation - Done")
    websocket.close();
    sendResp("OK");
}

init();
main();

