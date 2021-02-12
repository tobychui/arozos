/*
    Manga Cafe scan mangas

    This script will scan all vroots with Picture/Manga/ directories
*/

//Require filelib
requirelib("filelib");

//Make Manga folder if not exists
if (!filelib.fileExists("user:/Photo/Manga")){
    filelib.mkdir("user:/Photo/Manga")
}


//Scan all roots for other manga
var rootList = filelib.glob("/")
var scannedTitles = [];
for (var i =0; i < rootList.length; i++){
    var thisRoot = rootList[i];
    if (filelib.fileExists(thisRoot + "Photo/Manga")){
        var titleList = filelib.aglob(thisRoot + "Photo/Manga/*");
        for (var k =0; k < titleList.length; k++){
            var thisFileObject = titleList[k];
            //Only scan this if this is a directory and it is not start with "."
            if (filelib.isDir(thisFileObject) && thisFileObject.split("/").pop().substr(0, 1) != "."){
                //This should be manga title. Get its chapter count
                var chaptersInThisTitle = filelib.aglob(thisFileObject + "/*");
                var foldersInTitle = [];
                var chapterCount = 0;
                for (var j = 0; j < chaptersInThisTitle.length; j++){
                    var basename = chaptersInThisTitle[j].split("/").pop();
                    if (filelib.isDir(chaptersInThisTitle[j]) && basename.substring(0,1) != "."){
                        chapterCount++;
                        foldersInTitle.push(chaptersInThisTitle[j]);
                    }
                }

                //Check if title image exists. If not, use ch1 image 1
                var titleImagePath = ""
                if (filelib.fileExists(thisFileObject + "/title.png")){
                    titleImagePath = thisFileObject + "/title.png"
                }else{
                    //Get the first image from the first chapter
                    var firstChapterFolder = foldersInTitle[0];
                    var firstChapterImagaes = filelib.aglob(firstChapterFolder + "/*.jpg");
                    titleImagePath = firstChapterImagaes[0];
                }

                //Get the starting chapter
                var startChapter = foldersInTitle[0];

                //Prase the return output, src folder, chapter count and title image path
                scannedTitles.push([thisFileObject, chapterCount, titleImagePath, startChapter]);
            }
        }
    }
}

sendJSONResp(JSON.stringify(scannedTitles));