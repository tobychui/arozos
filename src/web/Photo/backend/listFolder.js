var loadedfile = requirelib("filelib");
if (!loadedfile) {
    console.log("Failed to load lib filelib, terminated.");
}

var folderList = filelib.glob("user:/Photo/Photo/storage/*");
var arr = [];
//add uploads folder
var img = ChooseFirstImage("user:/Photo/Photo/uploads/");
arr.push({ VPath: "user:/Photo/Photo/uploads/", Foldername: "uploads", img: img })

for (var i = 0; i < folderList.length; i++) {
    if (filelib.isDir(folderList[i])) {
        img = ChooseFirstImage(folderList[i]);
        arr.push({ VPath: folderList[i] + "/", Foldername: folderList[i].split("/").pop(), img: img })
    }
}

function ChooseFirstImage(folder) {
    var fileList = filelib.glob(folder + "/*.*");
    for (var i = 0; i < fileList.length; i++) {
        if (!filelib.isDir(fileList[i])) { //Well I don't had isFile, then use !isDir have same effect.
            var subFilename = fileList[i].split(".").pop().toLowerCase();
            if (["jpg", "jpeg", "gif", "png"].indexOf(subFilename) >= 0) {
                return "/media/?file=" + fileList[i];
            }
        }
    }
    return "/Photo/img/desktop_icon.png";
}

sendJSONResp(JSON.stringify(arr))