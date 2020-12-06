/*
    Manga Cafe - Get Manga Information

    This script get the information of the reading manga title
    Require paramter: folder
*/

requirelib("filelib");
requirelib("imagelib");

var targetFolder = decodeURIComponent(folder) + "/";
var tmp = decodeURIComponent(folder).split("/"); 
var chapterName = tmp.pop();
var parentFolder = tmp.join("/");
var title = [tmp.pop(), chapterName];

//Scan the manga content, process the image if nessary
var pages = filelib.aglob(targetFolder + "*");
var validPages = [];
for (var i = 0; i < pages.length; i++){
    var thisPage = pages[i];
    var basename = thisPage.split("/").pop().split("."); basename.pop(); basename = basename.join(".");
    var ext = thisPage.split(".").pop();
    if (!filelib.isDir(thisPage) && (ext == "png" || ext == "jpg") && !(basename.indexOf("-left") > 0 || basename.indexOf("-right") > 0 )){
        //Check if it is 2 connected page. If yes, split it into two page, left and write
        var dimension = imagelib.getImageDimension(thisPage);
        var width = dimension[0];
        var height = dimension[1];
        if (width > height){
            //Check if cached split image exists
            var pathdata = thisPage.split("/");
            var filename = pathdata.pop();
            var dirname = pathdata.join("/");
            var basename = filename.split(".");
            var ext = basename.pop();
            basename = basename.join(".");

            var targetLeft = dirname + "/" + basename + "-left." + ext;
            var targetRight = dirname + "/" + basename + "-right." + ext;

            if (filelib.fileExists(targetLeft) && filelib.fileExists(targetRight)){
                //Serve the previous cropped files
                
            }else{
                //Cut and serve
                imagelib.cropImage(thisPage, targetLeft,0,0,width/2,height)
                imagelib.cropImage(thisPage, targetRight,width/2,0,width/2,height)
            }
           
            validPages.push(targetRight);
            validPages.push(targetLeft);
        }else{
            //This is a valid page. Serve it
            validPages.push(thisPage);
        }
        
        
    }
}

//Search for other chapter links
var otherChapterCandidate = filelib.aglob(parentFolder + "/*");
var otherChapters = [];
for (var i =0; i < otherChapterCandidate.length; i++){
    var basename = otherChapterCandidate[i].split('/').pop();
    if (filelib.isDir(otherChapterCandidate[i]) && basename.substring(0,1) != "."){
        otherChapters.push(otherChapterCandidate[i]);
    }
}

var info = {
    title: title,
    pages: validPages,
    dir: targetFolder,
    otherChapterDir: otherChapters,
}

//Process the image file.
sendJSONResp(JSON.stringify(info));