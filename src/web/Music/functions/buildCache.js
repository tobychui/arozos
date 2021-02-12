/*
    AirMusic 

    Cache builder
    This script build the music bank ALL SONG caching and store it in db
*/

//Include the common library
var succ = includes("common.js")
if (succ == false){
    console.log("Failed to load common.js");
}

//Require the filelib
requirelib("filelib");

//Generate the Music Directory
var musicDis = [];

//Make the user's root music folder if not exists
if (filelib.fileExists("user:/Music/") == false){
    filelib.mkdir("user:/Music/");
}

//Scan all music directories
var rootDirs = filelib.glob("/");
for (var i = 0; i < rootDirs.length; i++){
    var thisRoot = rootDirs[i];
    musicDis.push(thisRoot);
}

function buildCache(){
    //Create db if not exists
    newDBTableIfNotExists("AirMusic");

     //Do the scanning
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

     //Save it as cache
     writeDBItem("AirMusic", "cache", JSON.stringify(songData));


     sendResp("OK");
}

buildCache();