/*
    List Song

    This function will list all song with the given directories.
    Type of operations

    listSong=(type)
    listSong=search:(keyword)
    listdir=root
    listdir= (Target path)
    listfolder=(target folder)

    This module is a direct lanuage translation from the original module.Musi.go

*/

//Global variables
var MINCACHESIZE = 300;  //Min song list length for start using cache method

//Include the common library
var succ = includes("common.js")
if (succ == false){
    console.log("Failed to load common.js");
}


//Handle user request
function handleUserRequest(){
    if (requirelib("filelib") == false){
        sendJSONResp(JSON.stringify({
            error: "Unable to load filelib"
        }));
    }else{
        var musicDis = [];
        
        //Make the user's root music folder if not exists
        if (filelib.fileExists("user:/Music/") == false){
            filelib.mkdir("user:/Music/");
        }

        //Scan all music directories
        var rootDirs = filelib.glob("/");
        for (var i = 0; i < rootDirs.length; i++){
            var thisRoot = rootDirs[i];
           
            //Always use all roots
            musicDis.push(thisRoot);
            
        }

        //Handle user request on listing
        if (typeof(listSong) != "undefined"){
            //List song given type
            if (listSong == "all"){
                //Load from cache first. If cache list > 1000 then deliver the cache then update the cache file
                newDBTableIfNotExists("AirMusic");
                var cacheListRaw = readDBItem("AirMusic", "cache");
                //var isRanged = false; //Check if this only need to return from a range
                //if (typeof(start) != "undefined" && typeof(end) != "undefined"){
                //    isRanged = true;
                //}
                if (cacheListRaw == ""){
                    //Cache list not generated yet. Continue

                }else if (cacheListRaw != ""){
                    //There is something in the cache list. Try parse it
                    try{
                        //Try parse it.
                        var cacheList = JSON.parse(cacheListRaw);
                        if (cacheList.length > MINCACHESIZE){
                            //Too many songs. Just use the cache list instead.
                            sendJSONResp(JSON.stringify({
                                cached: true,
                                list: cacheList
                            }));
                            return
                        }
                    }catch(ex){

                    }
                }

                //Do the scanning
                var songData = [];
                var musicFiles = [];
                for (var i = 0; i < musicDis.length; i++){
                    var thisFileLib = musicDis[i];
                    var allfilelist = filelib.walk(thisFileLib, "file");
                    for (var k = 0; k < allfilelist.length; k++){
                        var ext = allfilelist[k].split('.').pop();
                        if (IsSupportExt(ext) == true && !IsMetaFile(allfilelist[k])){
                            musicFiles.push(allfilelist[k]);
                        }
                    }
                }

                for (var i = 0; i < musicFiles.length; i++){
                    var thisMusicFile = musicFiles[i];
                    var thisSongData = [];
                    
                    /*
                        Catch formats looks like this
                        entry = [access_url, filename, ext, filesize]
                    */
                    //Access Path 
                    thisSongData.push("/media?file=" + thisMusicFile);
                    //File Name only
                    var filename = thisMusicFile.split("/").pop()
                    filename = filename.split(".");
                    var ext = filename.pop();
                    filename = filename.join(".");
                    thisSongData.push(filename);
                    //File Extension
                    thisSongData.push(ext);
                    //File size
                    var fileSize = bytesToSize(filelib.filesize(thisMusicFile))
                    thisSongData.push(fileSize)

                    songData.push(thisSongData);
                }

                //Return the parsed info
                //sendJSONResp(JSON.stringify(songData));

                //Write to cache and send
                writeDBItem("AirMusic", "cache", JSON.stringify(songData));
                sendJSONResp(JSON.stringify({
                    cached: false,
                    list: songData
                }));
            
            }else if (listSong.substr(0,7) == "search:"){
                //Search mode
                var keyword = listSong.substr(7)
                keyword = keyword.toLowerCase();
                var songData = [];

                var cachedList = readDBItem("AirMusic", "cache");
                var allfilelist = [];

                function getRealtimeAllFleList(){
                    var allfilelist = [];
                    for (var i = 0; i < musicDis.length; i++){
                        var thisFileLib = musicDis[i];
                        thisDirList  = filelib.walk(thisFileLib, "file");
                        for (var j = 0; j < thisDirList.length; j++){
                            allfilelist.push(thisDirList[j]);
                        }
                    }
                    return allfilelist;
                }

                if (cachedList == ""){
                    //No cache. Do real time scanning
                    allfilelist = getRealtimeAllFleList();
                }else{
                    //Try parse it. If parse failed fallback to realtime scanning
                    try{    
                        cachedList = JSON.parse(cachedList);
                        for (var j = 0; j < cachedList.length; j++){
                            var thisCachedSong = cachedList[j];
                            var thisFilepath = thisCachedSong[0].replace("/media?file=", "");
                            //Check if this file still exists. If not, get realtime list instead.
                            if (filelib.fileExists(thisFilepath)){
                                allfilelist.push(thisFilepath);
                            }else{
                                //Cache outdated. Rescanning now
                                allfilelist = getRealtimeAllFleList();
                                execd("buildCache.js")
                                break;
                            }
                        }
                    }catch(ex){
                        //Fallback
                        allfilelist = getRealtimeAllFleList();
                    }
                }
                    
                for (var k = 0; k < allfilelist.length; k++){
                    var thisFile = allfilelist[k];
                    var ext = allfilelist[k].split('.').pop();
                    var filename = allfilelist[k].split('/').pop();
                    filename = filename.toLowerCase();
                    if (IsSupportExt(ext) == true && filename.indexOf(keyword) !== -1 && !IsMetaFile(allfilelist[k])){
                        //This file match our ext req and keyword exists
                        var thisSongData = [];
                        //Access Path 
                        thisSongData.push("/media?file=" + thisFile);
                        //File Name only
                        var filename = thisFile.split("/").pop()
                        filename = filename.split(".");
                        var ext = filename.pop();
                        filename = filename.join(".");
                        thisSongData.push(filename);
                        //File Extension
                        thisSongData.push(ext);
                        //File size
                        var fileSize = bytesToSize(filelib.filesize(thisFile))
                        thisSongData.push(fileSize)
        
                        songData.push(thisSongData);

                    }
                }
                

                //Send resp
                sendJSONResp(JSON.stringify(songData));

                //Run build cache in background so to update any cache if exists
                execd("buildCache.js")
            }else{
                //WIP
                console.log("listSong type " + listSong + " work in progress")
            }
        }else if (typeof(listdir) != "undefined"){
            //List dir given path
            if (listdir == "root"){
                //List the information of the user roots that contain Music folder
                var rootInfo = [];
                for (var i =0; i < musicDis.length; i++){
                    var thisRootInfo = [];

                    var thisMusicDir = musicDis[i];
                    var thisRoot = thisMusicDir.split("/").shift() + "/";
                    var objcetsInRoot = [];
                    if (thisRoot == "user:/"){
                        objcetsInRoot = filelib.glob(thisRoot + "Music/*");
                    }else{
                        objcetsInRoot = filelib.glob(thisRoot + "*");
                        thisMusicDir = thisRoot;
                    }
                    
                    var rootName = filelib.rootName(thisRoot);
                    if (rootName == false){
                        rootName = thisRoot
                    }
                    thisRootInfo.push(rootName);
                    thisRootInfo.push(thisMusicDir);

                    var files = [];
                    var folders = [];
                    for (var j = 0; j < objcetsInRoot.length; j++){
                        if (filelib.isDir(objcetsInRoot[j])){
                            folders.push(objcetsInRoot[j]);
                        }else{
                            files.push(objcetsInRoot[j]);
                        }
                    }

                    thisRootInfo.push(files.length);
                    thisRootInfo.push(folders.length);

                    rootInfo.push(thisRootInfo);
                }

                sendJSONResp(JSON.stringify(rootInfo));
            }else{
                //List information about other folders
                var targetpath = decodeURIComponent(listdir)
                var filelist = filelib.aglob(targetpath + "*")
                var files = [];
                var folders = [];
                for (var j = 0; j < filelist.length; j++){
                    if (filelib.isDir(filelist[j])){
                        folders.push(filelist[j]);
                    }else{
                        var ext = filelist[j].split(".").pop();
                        if (IsSupportExt(ext)  && !IsMetaFile(filelist[j])){
                            files.push(filelist[j]);
                        }
                        
                    }
                }

                //For each folder, get its information
                var folderInfo = [];
                
                for (var i = 0; i < folders.length; i++){
                    var thisFolderInfo = [];
                    var folderName = folders[i].split("/").pop();
                    var thisFolderSubfolder = [];
                    var thisFolderSubfiles = [];
                    var subFolderFileList = filelib.aglob(folders[i] + "/*")
                    for (var j = 0; j < subFolderFileList.length; j++){
                        if (filelib.isDir(subFolderFileList[j])){
                            var thisFolderName = subFolderFileList[j].split("/").pop();
                            if (thisFolderName.substring(0,1) != "."){
                                thisFolderSubfolder.push(subFolderFileList[j]);
                            }
                        }else{
                            var ext = subFolderFileList[j].split(".").pop();
                            if (IsSupportExt(ext) && !IsMetaFile(subFolderFileList[j])){
                                thisFolderSubfiles.push(subFolderFileList[j]);
                            }
                            
                        }
                    }

                    thisFolderInfo.push(folderName);
                    thisFolderInfo.push(folders[i] + "/");
                    thisFolderInfo.push((thisFolderSubfiles).length + "");
                    thisFolderInfo.push((thisFolderSubfolder).length + "");
                    
                    folderInfo.push(thisFolderInfo)
                }
                
                
                var fileInfo = [];
                for (var i = 0; i < files.length; i++){
                    var thisFileInfo = [];
                    var filename = files[i].split("/").pop();
                    filename = filename.split('.')
                    filename.pop();
                    filename = filename.join(".");
                    var ext = files[i].split(".").pop()

                    var filesize = filelib.filesize(files[i]);
                    filesize = bytesToSize(filesize);

                    thisFileInfo.push("/media?file=" + files[i]);
                    thisFileInfo.push(filename);
                    thisFileInfo.push(ext);
                    thisFileInfo.push(filesize);

                    fileInfo.push(thisFileInfo);
                }

                var results = [];
                results.push(folderInfo);
                results.push(fileInfo);
                sendJSONResp(JSON.stringify(results));
                
            }
            

        }else if (typeof(listFolder) != "undefined"){
            //List folder giben filepath

        }


    }
}

//Execute Handler
handleUserRequest();