/*
    Music Module

    Get File Information
    paramter: file
*/

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
 }


if (requirelib("filelib") == false){
    sendJSONResp(JSON.stringify({
        error: "Unable to load filelib"
    }));
}else{
    if (filepath.indexOf("/media?file=") !== -1){
        filepath = filepath.replace("/media?file=", "");
    }
    var vpath = decodeURIComponent(filepath);
    console.log(vpath)
    
    var results = [];
    
    var filename = vpath.split("/").pop();
    results.push(filename);
    results.push(vpath);
    
    var filesize = filelib.filesize(vpath);
    var humanReadableSize = bytesToSize(filesize);

    results.push(humanReadableSize);
    results.push(filesize);

    var modTime = filelib.mtime(vpath, false);
    results.push(modTime);

    sendJSONResp(JSON.stringify(results));
}


