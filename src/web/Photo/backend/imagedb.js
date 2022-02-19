/*
    Image DB
    The get and put function for image classification database
    and its utilities
*/

requirelib("filelib");
requirelib("imagelib");

//Tags record structure
/*
    {
        "filepath": {image_vpath},
        "tags": [
            {
                "object": {detected_object_1},
                "confidence": {confidence_in_percentage}
            },
            {
                "object": {detected_object_2},
                "confidence": {confidence_in_percentage}
            }
        ]
    }
*/

//Get all possible roots, return array of [name, path and photo root]
function getAllPossibleRoots(){
    function folderContainSubFiles(filepath){
        var results = filelib.aglob(filepath + "/*", "default");
        if (results.length > 0){
            return true;
        }
        return false;
    }
    var possibleRoots = [];
    for ( var i = 0; i < USER_VROOTS.length; i++){
        var thisRoot = USER_VROOTS[i];
        if (thisRoot.Filesystem != "virtual" && filelib.fileExists(thisRoot.UUID + ":/Photo") && folderContainSubFiles(thisRoot.UUID + ":/Photo/")){
            possibleRoots.push([thisRoot.Name, thisRoot.UUID + ":/", thisRoot.UUID + ":/Photo"]);
        }
    }

    return possibleRoots;
}

function isSupportedImage(filename){
    var fileExt = filename.split(".").pop();
    if (fileExt == "jpg" || fileExt == "png" || fileExt == "jpeg"){
        return true;
    }else{
        return false
    }
}

function inCacheFolder(filename){
    if (filename.indexOf(".cache") >= 0){
        return true;
    }
    return false;
}

//Check if this photo shd be rendered
function checkIsInExcludeFolders(filename){
    var excludeRootFolders = ["Manga", "tmp", "thumbnail"];
    var pathinfo = filename.split("/");
    if (pathinfo.length > 2){
        var basefolder = pathinfo[2];
        for (var i = 0; i < excludeRootFolders.length; i++){
            if (basefolder == excludeRootFolders[i]){
                return true;
            }
        }
        return false;
    }else{
        return false;
    }
}

//Get all the image files exists in *:/Photo/*
function getAllImageFiles(){
    var results = [];
    var possibleRoots = getAllPossibleRoots();
    for ( var i = 0; i < possibleRoots.length; i++){
        var thisRootInfo = possibleRoots[i];
        var allFilesInThisPhotoRoot = filelib.walk(thisRootInfo[2]);
        for ( var j = 0; j < allFilesInThisPhotoRoot.length; j++){
            var thisFile = allFilesInThisPhotoRoot[j];
            if (!filelib.isDir(thisFile) && isSupportedImage(thisFile) && !inCacheFolder(thisFile)){
                if (!checkIsInExcludeFolders(thisFile)){
                    results.push(thisFile);
                }
                
            }
        }
    }

    return results;
}

//Get all the image files exists in given root as rootID:/Photo/*
function getAllImageFilesInRoot(targetRootID){
    if (targetRootID.indexOf(":") >= 0){
        targetRootID = targetRootID.split(":")[0];
    }
    var results = [];
    var allFilesInThisPhotoRoot = filelib.walk(targetRootID + ":/Photo/");
    for ( var j = 0; j < allFilesInThisPhotoRoot.length; j++){
        var thisFile = allFilesInThisPhotoRoot[j];
        if (!filelib.isDir(thisFile) && isSupportedImage(thisFile) && !inCacheFolder(thisFile)){
            if (!checkIsInExcludeFolders(thisFile)){
                results.push(thisFile);
            }
            
        }
    }

    return results;
}

//Get the tag of a certain image file given its filepath
function getImageTags(imagefile){
    var results = imagelib.classify(imagefile, "yolo3"); 
    var tags = [];
    for (var i = 0; i < results.length; i++){
        console.log(results[i].Name, results[i].Percentage);
        if (results[i].Percentage > 10){
            //Confidence larger than 50
            tags.push({
                "object": results[i].Name,
                "confidence":results[i].Percentage
            });
        }
    }

    return tags;
}

function getImageTagsRecord(imagefile){
    var tags = getImageTags(imagefile);
    return {
        "filepath": imagefile,
        "tags": tags
    }
}

function loadAllTagsRecord(rootID){
    var tagFile = rootID + "Photo/tags.json"
    if (filelib.fileExists(tagFile)){
        var tagsData = filelib.readFile(tagFile)
        return JSON.parse(tagsData);
    }
    return [];
}

function saveAllTagsRecords(rootID, tagRecords){
    var tagFile = rootID + "Photo/tags.json"
    return filelib.writeFile(tagFile, JSON.stringify(tagRecords))
}

//Clearn up the record from the list of tag records that its file no longer exists
function matchAndClearNonExistsRecords(tagRecords){
    var cleanedTagRecords = [];
    for ( var i = 0; i < tagRecords.length; i++){
        var thisRecord = tagRecords[i];
        var thisFilepath = thisRecord.filepath;
        //Check if this file exists
        if (filelib.fileExists(thisFilepath)){
            //Add it to the cleaned tag records
            cleanedTagRecords.push(JSON.parse(JSON.stringify(thisRecord)));
        }
    }

    return cleanedTagRecords;
}

//Translate the record array into keyvalue paris of [filepath](record object)
function summarizeAndRestructureFilepaths(tagRecords){
    var filepathMap = {};
    for ( var i = 0; i < tagRecords.length; i++){
        var thisRecord = tagRecords[i];
        filepathMap[thisRecord.filepath] = JSON.parse(JSON.stringify(thisRecord));
    }
    return filepathMap;
}

//Translate the tag array into key-value pairs of [tag](filepath)
function summarizeAndrestructureTags(tagRecords){
    var tags = {};
    for ( var i = 0; i < tagRecords.length; i++){
        var thisRecord = tagRecords[i];
        for ( var j = 0; j < thisRecord.tags.length; j++){
            var thisTag = thisRecord.tags[j];
            if (typeof(tags[thisTag.object]) == "undefined"){
                //Not exists. Create it
                tags[thisTag.object] = [thisRecord.filepath];
            }else{
                //Already exists. Remove duplicate
                var alreadyExists = false;
                for ( var k = 0; k < tags[thisTag.object].length; k++){
                    if (tags[thisTag.object][k] == thisRecord.filepath){
                        alreadyExists = true;
                    }
                }
                if (!alreadyExists){
                    tags[thisTag.object].push(thisRecord.filepath);
                }
                
                
            }
        }
        
    }

    return tags;
}