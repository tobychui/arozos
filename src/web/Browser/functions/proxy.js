/*
    proxy.js
    This script help proxy text content of the requested page and render them locally
*/

//Get the target webpage body
requirelib("http");
var websiteContent = http.get(url);
var protocol = url.substring(0, url.indexOf("/") + 2);
var domain = url.substring(url.indexOf("/") + 2).split("/").shift();
rootURL = protocol + domain;


var currentDirUrl = url;
currentDirUrl = currentDirUrl.split("?")[0];
var lastSegment = currentDirUrl.split("/").pop();
if (lastSegment.indexOf(".") >= 0){
    //Contain filename. Pop the filename as well
    currentDirUrl = currentDirUrl.split("/");
    currentDirUrl.pop();
    currentDirUrl = currentDirUrl.join("/");
}

//Replace the src path with remote domain path
var srcChunks = websiteContent.split('src="');
var patchedSrcChunks = [srcChunks[0]];
for (var i = 1; i < srcChunks.length; i++){
    var thisChunk = srcChunks[i];
    if (thisChunk.substr(0,1) == "/"){
        //Inject the root URL in front
        patchedSrcChunks.push(rootURL + thisChunk);
    }else if (thisChunk.trim().substr(0,4) != "http" && thisChunk.trim().substr(0,5) != "data:"){
        //Inject the current dir into it
        patchedSrcChunks.push(currentDirUrl + "/" + thisChunk);
    }else{
        patchedSrcChunks.push(thisChunk);
    }
}
websiteContent = patchedSrcChunks.join('src="');

//Replace css url("xxx") if exists
websiteContent = websiteContent.split('url("/').join("{url_root_dummy}");
websiteContent = websiteContent.split('url("').join('url("' + currentDirUrl + "/");
websiteContent = websiteContent.split('{url_root_dummy}').join('url("/' + rootURL + "/");

var hrefChunks = websiteContent.split('href="');
var patchedHrefChunks = [hrefChunks[0]];
for (var j = 1; j < hrefChunks.length; j++){
    var thisChunk = hrefChunks[j];
    if (thisChunk.substr(0,1) == "/"){
        //Inject the root URL in front
        patchedHrefChunks.push(rootURL + thisChunk);
    }else if (thisChunk.trim().substr(0,4) != "http"){
        //Inject the current dir into it
        patchedHrefChunks.push(currentDirUrl + "/" + thisChunk);
    }else{
        patchedHrefChunks.push(thisChunk);
    }
}
websiteContent = patchedHrefChunks.join('href="');

//Replace href with redirection code
var htmlSegmentChunks = websiteContent.split(" ");
var chunksToBeReplaced = [];
for (var i = 0; i < htmlSegmentChunks.length; i++){
    var thisSegment = htmlSegmentChunks[i].trim();
    if (thisSegment.substring(0, 5) == "href="){
        //Process the segment and trim out only the href="xxx" part
        var cutPosition = thisSegment.lastIndexOf('"');
        thisSegment = thisSegment.substring(0, cutPosition + 1)
        if (thisSegment.trim().length > 6){
            chunksToBeReplaced.push(thisSegment);
            //console.log("SEGMENT:", thisSegment, thisSegment.trim().length);
        }
    }
}

for (var k= 0; k < chunksToBeReplaced.length; k++){
    var thisSegment = chunksToBeReplaced[k];
    thisSegment = thisSegment.replace('href="', "parent.loadWebsite(\"")
    thisSegment = thisSegment + ");"
    thisSegment = thisSegment.split("\"").join("'");
    thisSegment = "onclick=\"" + thisSegment + "\"";
    

    //Check if this is css / style files. If yes, bypass it
    var expectedFileExtension = thisSegment.trim().substring(thisSegment.lastIndexOf("."), thisSegment.length -4);
    if (expectedFileExtension == ".css" || expectedFileExtension == ".js" || thisSegment.indexOf(".css") >= 0){
        continue;
    }
    //console.log("REPLACING", chunksToBeReplaced[k], thisSegment);
    websiteContent = websiteContent.replace(chunksToBeReplaced[k], thisSegment);
}



//console.log(websiteContent);
sendResp(websiteContent);