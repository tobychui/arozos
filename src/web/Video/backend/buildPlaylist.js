//Build the playlist for Video modules
var storages = USER_VROOTS;
var validVideoFormat = ["ogg","webm","mp4"];
var playlist = [];

//Require libraries
requirelib("filelib");

//Create a function to build file data from filepath
function buildFileObject(filepath){
    var fileObject = {};
    fileObject["Filename"] = filepath.split("/").pop();
    fileObject["Filepath"] = filepath;
    fileObject["Ext"] = "." + filepath.split(".").pop();
    return fileObject;
}

function ext(filepath){
    return filepath.split(".").pop();
}

function basename(filepath){
    return filepath.split("/").pop();
}

function scanPathForVideo(thisDir, thisStorageName){
    var playlistInThisStorage = [];
    var thisStoragePlaylist = {};
    
    if (filelib.fileExists(thisDir + "Video/")){
        var walkPath = thisDir + "Video/";
        var folderList = filelib.walk(walkPath, "folder")

        //Build the folder list base on the discovered mp4 files
        var foldersThatContainsVideoFile = [];
        for (var i = 0; i < folderList.length; i++){
            var thisFolderPath = folderList[i];
            var validFilesInThisPath = 0;
            for (var j = 0; j < validVideoFormat.length; j++){
                var videoFile = filelib.aglob(thisFolderPath + "/*." + validVideoFormat[j])
                validFilesInThisPath += videoFile.length;
            }
            
            if (validFilesInThisPath > 0){
                //This folder contain video file
                foldersThatContainsVideoFile.push(thisFolderPath);
            }
        }

        thisStoragePlaylist["StorageName"] = thisStorageName;
        for (var i = 0; i < foldersThatContainsVideoFile.length; i++){
            //Generate playlist
            var thisFolder = foldersThatContainsVideoFile[i];
            var playlistFilelist = filelib.aglob(thisFolder + "/*.*")
            var playlistName = basename(thisFolder);
            var thisPlaylistObject = {};

            //If name parent is not Video, add a subfix
            var baseBasename = thisFolder.split("/");
            baseBasename.pop();
            baseBasename = baseBasename.pop();

            if (baseBasename != "Video"){
                playlistName = baseBasename + " / " + playlistName
            }

            thisPlaylistObject["Name"] = playlistName;
            thisPlaylistObject["Files"] = [];
            for (var k =0; k < playlistFilelist.length; k++){
                //For each files in this folder
                if (!filelib.isDir(playlistFilelist[k]) && validVideoFormat.indexOf(ext(playlistFilelist[k])) > -1 ){
                    //This is a video file extension file
                    var filenameOnly = JSON.parse(JSON.stringify(playlistFilelist[k])).split("/").pop();
                    if (filenameOnly.substr(0,2) == "._"){
                        //MacOS caching files. Ignore this
                        continue
                    }
                    thisPlaylistObject["Files"].push(buildFileObject(playlistFilelist[k]));
                }
            }

            playlistInThisStorage.push(thisPlaylistObject)
        }

        //Build the unsorted file list
        /*
        var unsortedFileList = [];
        for (var i = 0; i < validVideoFormat.length; i++){
            var unsortedFiles = filelib.aglob(walkPath + "/*." + validVideoFormat[i])
            for (var j = 0; j < unsortedFiles.length; j++){
                unsortedFileList.push(buildFileObject(unsortedFiles[j]));
            }
        }
        */
        

        //Push scan into results
        if (playlistInThisStorage.length > 0){
            thisStoragePlaylist["PlayLists"] = playlistInThisStorage;
            //thisStoragePlaylist["UnsortedVideos"] = unsortedFileList;
            playlist.push(thisStoragePlaylist);
        }
    }
    
}


function main(){
    //Craete the user Video folder
    filelib.mkdir("user:/Video");

    //Scan each of the storage devices for video files
    for (var i =0; i < storages.length; i++){
        var thisDir = storages[i].UUID + ":/";
        var thisStorageName = storages[i].Name;
        scanPathForVideo(thisDir, thisStorageName)
    }

    sendJSONResp(JSON.stringify(playlist));
}


main();