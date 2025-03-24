if (!requirelib("filelib")) {
    console.log("Filelib import failed");
    sendResp("Filelib import failed");
}

if (!requirelib("share")) {
    console.log("Share import failed");
    sendResp("Share import failed");
}

// Get file info
var files = filelib.readdir(dir);

// Sort
var sortedPaths = filelib.aglob(dir + "*", "user");

var fileMap = {};
files.forEach(function(file) {
    fileMap[file.Filepath] = file;
});

var sortedFiles = [];
sortedPaths.forEach(function(filepath) {
    if (fileMap.hasOwnProperty(filepath)) {
        sortedFiles.push(fileMap[filepath]);
        delete fileMap[filepath];
    }
});

for (var remainingPath in fileMap) {
    if (fileMap.hasOwnProperty(remainingPath)) {
        sortedFiles.push(fileMap[remainingPath]);
    }
}

files = sortedFiles;

// Bytes to size
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

// Add more for compatibility
for (var i = 0; i < files.length; i++) {
    var file = files[i];

    file.Displaysize = bytesToSize(file.Filesize);

    file.IsShared = share.fileIsShared(file.Filepath);

    if (file.Ext === ".shortcut") {
        try {
            var content = filelib.readFile(file.Filepath);
            var lines = content.split('\n').slice(0, 4); // 取前4行
            file.Shortcut = {
                Type: lines[0].trim(),
                Name: lines[1].trim(),
                Path: lines[2].trim(),
                Icon: lines[3].trim()
            };
        } catch (e) {
            file.Shortcut = null;
        }
    } else {
        file.Shortcut = null;
    }

    delete file.Ext;

}


sendJSONResp(JSON.stringify(files));
