/*
    Playlist.js

    List and manage the playlist

    database schema

    AirMusic playlist/USERNAME/{playlistname} --> JSON Stringify Object

    Song Objects
    [playbackpath, name, type (ext), filesize(Human readable)]

    Require paramters:
    opr = {root / list / add / remove}

    under list mode:
    playlistname = "playlistname"

    under add / remove
    playlistname = "playlistname"
    musicpath = "songpath"

*/

//Include common functions
includes("common.js")
requirelib("filelib");

function sendErrorResp(msg){
    sendJSONResp(JSON.stringify({
        error: msg
    }));
}

function playlistExists(name){
    var targetPlaylist = readDBItem("AirMusic", name);
    if (targetPlaylist == ""){
        return false
    }

    return true
}

function handlePlaylistRequest(){
    //Create table if not exists
    newDBTableIfNotExists("AirMusic");
    if (opr == "root"){
        //List the root of all playlist
        var playlists = listDBTable("AirMusic");
        var keys = Object.keys(playlists);
        var playlistInfo = [];
        for (var i =0; i < keys.length; i++){
            var thiskey = keys[i];
            if (thiskey.indexOf("playlist/" + USERNAME + "/") > -1){
                //This key contains the keyword "playlist/", this is a playlist object
                playlistInfo.push({
                    name: thiskey.split("/").pop(),
                    count: JSON.parse(playlists[thiskey]).length
                });
            }
        }
        sendJSONResp(JSON.stringify(playlistInfo));
    }else if (opr == "list"){
        //List a playlist given its name
        if (playlistname == undefined){
            sendErrorResp("Playlist name undefined");
            return
        }

        var playlistFullKey = "playlist/" + USERNAME + "/" + playlistname;
        //Check if playlist name exists
        if (!playlistExists(playlistFullKey)){
            sendErrorResp("Playlist not exists");
            return
        }

        //OK. Load and display the playlist information
        var songsInList = [];
        var targetPlaylist = readDBItem("AirMusic", playlistFullKey);
        targetPlaylist = JSON.parse(targetPlaylist);

        //Prase the results
        for (var i = 0; i < targetPlaylist.length; i++){
            var thisSong = targetPlaylist[i];
            if (filelib.fileExists(thisSong)){
                //Add it to the list
                //This section is used to handle songs in unmounted storage ppols
                var songInfo = thisSong.split("/").pop();
                songInfo = songInfo.split(".");
                var songName = songInfo[0];
                var songExt = songInfo[1];
                
                songsInList.push([
                    "/media?file=" + thisSong,
                    songName,
                    songExt,
                    bytesToSize(filelib.filesize(thisSong))
                ]);

            }
        }
        sendJSONResp(JSON.stringify(songsInList));


    }else if (opr == "add"){    
        //Adding a song base on its path from playlist
        if (playlistname == undefined || musicpath == undefined){
            sendErrorResp("Playlist name (playlistname) and music filepath (song) not defined");
            return
        }

        //Check if the path exists
        if (!filelib.fileExists(musicpath)){
            //File not exits. Reject 
            sendErrorResp("Given filepath not exists")
            return
        }

        //OK! Add it to the playlist
        var playlistFullKey = "playlist/" + USERNAME + "/" + playlistname;
        if (!playlistExists(playlistFullKey)){
            //Playlist not exists. Creates it
            writeDBItem("AirMusic", playlistFullKey, JSON.stringify([musicpath]));
        }else{
            //Playlist already exists. Extract and append to it
            var targetPlaylist = readDBItem("AirMusic", playlistFullKey);
            //Convert it to an array
            targetPlaylist = JSON.parse(targetPlaylist);
            //Check if this song already in playlist
            for (var i = 0; i < targetPlaylist.length; i++){
                if (targetPlaylist[i] == musicpath){
                    //Already in playlist. Return
                    sendResp("OK");
                    return;
                }
            }
            //Push the new filepath into it
            targetPlaylist.push(musicpath);
            //Convert it back to string
            targetPlaylist = JSON.stringify(targetPlaylist);
            //Write to database item
            writeDBItem("AirMusic", playlistFullKey, targetPlaylist);
        }

        //Reply OK
        sendResp("OK");
    }else if (opr == "remove"){
        //Removing a song from a playlist
        if (playlistname == undefined || musicpath == undefined){
            sendErrorResp("Playlist name (playlistname) and music filepath (song) not defined");
            return
        }

        var playlistFullKey = "playlist/" + USERNAME + "/" + playlistname;

        //Check if playlist exists
        if (!playlistExists(playlistFullKey)){
            sendErrorResp("Playlist not exists")
            return
        }

        //Remove this song from the playlist
        var targetPlaylist = readDBItem("AirMusic", playlistFullKey);
        targetPlaylist = JSON.parse(targetPlaylist);

        var newPlaylist = [];
        for (var i = 0; i < targetPlaylist.length; i++){
            var thisSongPath = targetPlaylist[i];
            if (thisSongPath != musicpath){
                //console.log(thisSongPath, musicpath);
                newPlaylist.push(thisSongPath);
            }
        }

        //Check if there are items in the playlist. IF not, remove it completely
        if (newPlaylist.length == 0){
            deleteDBItem("AirMusic", playlistFullKey);
        }else{
            //Write to database
            newPlaylist = JSON.stringify(newPlaylist);
            writeDBItem("AirMusic", playlistFullKey, newPlaylist);
        }
        sendResp("OK");
    }else{
        //Unknown operations
        sendErrorResp("Unknown operation type");
    }
}


//Execute main function
handlePlaylistRequest();
