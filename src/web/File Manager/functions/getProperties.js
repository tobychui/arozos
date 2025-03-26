if (!requirelib("filelib")) {
    console.log("Filelib import failed");
    sendResp("Filelib import failed");
}

// Parse basic info
var basename = path.split('/').pop();
var parts = path.split('/');
parts.pop();
var virtualDirname = parts.join('/');

// Parse Ext
var ext = '.' + (basename.split('.').pop() || '');

// Get info with filelib
var filesize = filelib.filesize(path);
var isDirectory = filelib.isDir(path);
var lastModTime = filelib.mtime(path, false);
var lastModUnix = filelib.mtime(path, true);

// Result object
var result = {
    VirtualPath: path,
    Basename: basename,
    VirtualDirname: virtualDirname,
    Ext: ext,
    MimeType: "MimeType unsupported",
    Filesize: filesize,
    Permission: "Permission unsupported",
    LastModTime: lastModTime,
    LastModUnix: lastModUnix,
    IsDirectory: isDirectory,
    Owner: "Owner unsupported"
};

// Return JSON
sendJSONResp(result);