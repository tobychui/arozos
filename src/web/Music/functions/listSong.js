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

//Helper Functions
function IsSupportExt(ext){
    var supportExtList = [".mp3",".flac",".wav",".ogg",".aac",".webm"];
    ext = "." + ext;
    for (var i = 0; i < supportExtList.length; i++){
        var thisExt = supportExtList[i];
        if (ext == thisExt){
            return true
        }
    }
    return false
}

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
 }

//Handle user request
if (requirelib("filelib") == false){
    sendJSONResp(JSON.stringify({
        error: "Unable to load filelib"
    }));
}else{
    var musicDis = [];
    var playList = [];
    
    //Make the user's root music folder if not exists
    if (filelib.fileExists("user:/Music/") == false){
        filelib.mkdir("user:/Music/");
    }

    //Scan all music directories
    var rootDirs = filelib.glob("/");
    for (var i = 0; i < rootDirs.length; i++){
        var thisRoot = rootDirs[i];
        /*
        if (filelib.fileExists(thisRoot + "Music/")){
            musicDis.push(thisRoot + "Music/");
        }
        */
        //Always use all roots
        musicDis.push(thisRoot);
        
    }

    //Handle user request on listing
    if (typeof(listSong) != "undefined"){
        //List song given type
        if (listSong == "all"){
            var songData = [];
            var musicFiles = [];
            for (var i = 0; i < musicDis.length; i++){
                var thisFileLib = musicDis[i];
                var allfilelist = filelib.walk(thisFileLib, "file");
                for (var k = 0; k < allfilelist.length; k++){
                    var ext = allfilelist[k].split('.').pop();
                    if (IsSupportExt(ext) == true){
                        musicFiles.push(allfilelist[k]);
                    }
                }
            }

            for (var i = 0; i < musicFiles.length; i++){
                var thisMusicFile = musicFiles[i];
                var thisSongData = [];
                
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
            sendJSONResp(JSON.stringify(songData));
        
        }else if (listSong.substr(0,7) == "search:"){
            var keyword = listSong.substr(7)
            var songData = [];
            for (var i = 0; i < musicDis.length; i++){
                var thisFileLib = musicDis[i];
                var allfilelist = filelib.walk(thisFileLib, "file");
                for (var k = 0; k < allfilelist.length; k++){
                    var thisFile = allfilelist[k];
                    var ext = allfilelist[k].split('.').pop();
                    var filename = allfilelist[k].split('/').pop();
                    if (IsSupportExt(ext) == true && filename.indexOf(keyword) !== -1){
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
            }

            sendJSONResp(JSON.stringify(songData));

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
                
                var rootName = filelib.rname(thisRoot);
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
                    if (IsSupportExt(ext)){
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
                        if (IsSupportExt(ext)){
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

