/*
    Musicify Backend - Common Utilities
    Include via: includes("common.js")
*/

function isMusicFile(filename) {
    var ext = filename.split('.').pop().toLowerCase();
    var supported = ["mp3", "flac", "wav", "ogg", "aac", "webm", "m4a", "opus", "wma"];
    for (var i = 0; i < supported.length; i++) {
        if (ext === supported[i]) return true;
    }
    return false;
}

function isHiddenFile(filepath) {
    var name = filepath.split("/").pop();
    return name.charAt(0) === '.';
}

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

function getBasename(filepath) {
    var name = filepath.split("/").pop();
    var parts = name.split(".");
    if (parts.length > 1) parts.pop();
    return parts.join(".");
}

function getExt(filepath) {
    return filepath.split('.').pop().toLowerCase();
}

function getMusicRoots() {
    var roots = filelib.glob("/");
    var musicRoots = [];
    for (var i = 0; i < roots.length; i++) {
        var musicPath = roots[i] + "Music/";
        if (!filelib.fileExists(musicPath)) {
            filelib.mkdir(musicPath);
        }
        musicRoots.push(musicPath);
    }
    return musicRoots;
}

function buildSongEntry(filepath) {
    var size = filelib.filesize(filepath);
    return {
        filepath: filepath,
        name: getBasename(filepath),
        ext: getExt(filepath),
        filesize: size,
        hsize: bytesToSize(size),
        mtime: filelib.mtime(filepath, false)
    };
}
