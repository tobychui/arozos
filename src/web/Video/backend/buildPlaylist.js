//Build the playlist for Video modules
var storages = LOADED_STORAGES;
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
    var unsortedVideoInThisStorage = [];
    var thisStoragePlaylist = {};
    
    if (filelib.fileExists(thisDir + "Video/")){
        //Video folder exists in this directory
        thisStoragePlaylist["StorageName"] = thisStorageName;
        var fileList = filelib.glob(thisDir + "Video/*");
        for (var j =0; j < fileList.length; j++){ 
            if (filelib.isDir(fileList[j])){
                //This is a directory. Scan this playlist content
                var playlistFilelist = filelib.aglob(fileList[j] + "/*.*")
                var playlistName = basename(fileList[j]);
                var thisPlaylistObject = {};
                thisPlaylistObject["Name"] = playlistName;
                thisPlaylistObject["Files"] = [];
                for (var k =0; k < playlistFilelist.length; k++){
                    //For each files in this folder
                    if (!filelib.isDir(playlistFilelist[k]) && validVideoFormat.indexOf(ext(playlistFilelist[k])) > -1 ){
                        //This is a video file 
                        thisPlaylistObject["Files"].push(buildFileObject(playlistFilelist[k]));
                    }
                }
                if (thisPlaylistObject["Files"].length  > 0){
                    playlistInThisStorage.push(thisPlaylistObject)
                }
            }else{
                //This is just a normal file. Add to unsorted files
                if (validVideoFormat.indexOf(ext(fileList[j])) > -1 ){
                    unsortedVideoInThisStorage.push(buildFileObject(fileList[j]))
                }
                
            }
            
        }
        //Push scan into results
        thisStoragePlaylist["PlayLists"] = playlistInThisStorage;
        thisStoragePlaylist["UnsortedVideos"] = unsortedVideoInThisStorage;
        playlist.push(thisStoragePlaylist);
        
    }
    
}

//Craete the user Video folder
filelib.mkdir("user:/Video");

//Scan the user root path
if (filelib.fileExists("user:/Video")){
    scanPathForVideo("user:/", "User")
}


//Scan each of the storage devices for video files
for (var i =0; i < storages.length; i++){
    var thisDir = storages[i].Uuid + ":/";
    var thisStorageName = storages[i].Name;
    scanPathForVideo(thisDir, thisStorageName)
}

sendJSONResp(JSON.stringify(playlist));