requirelib("filelib")
includes("imagedb.js")


function getExt(filename){
    return filename.split(".").pop();
}

function isImage(filename){
    var ext = getExt(filename);
    ext = ext.toLowerCase();
    if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "webp" ||
        isRawImage(filename)){
        return true;
    }
    return false;
}

function isRawImage(filename){
    var ext = getExt(filename);
    ext = ext.toLowerCase();
    return (ext == "arw" || ext == "cr2" || ext == "dng" || ext == "nef" || ext == "raf" || ext == "orf");
}

function getBasename(filename){
    var parts = filename.split("/");
    var name = parts[parts.length - 1];
    var nameParts = name.split(".");
    nameParts.pop();
    return nameParts.join(".");
}

function filterDuplicates(files){
    // Create a map to store files by their basename
    var fileMap = {};

    for (var i = 0; i < files.length; i++){
        var filepath = files[i];
        var basename = getBasename(filepath);
        var isRaw = isRawImage(filepath);

        if (!fileMap[basename]){
            fileMap[basename] = {
                raw: null,
                jpg: null
            };
        }

        if (isRaw){
            fileMap[basename].raw = filepath;
        } else {
            fileMap[basename].jpg = filepath;
        }
    }

    // Build result array, prioritizing RAW over JPG
    var result = [];
    for (var basename in fileMap){
        var entry = fileMap[basename];
        if (entry.raw){
            // If RAW exists, use it (ignore JPG)
            result.push(entry.raw);
        } else if (entry.jpg){
            // Otherwise use JPG
            result.push(entry.jpg);
        }
    }

    return result;
}

function isHiddenFile(filepath){
    var filename = filepath.split("/").pop();
    if (filename.substring(0, 1) == "."){
        return true;
    }else{
        return false;
    }
}

function folderContainSubFiles(filepath){
    var results = filelib.aglob(filepath + "/*", "smart");
    if (results.length > 0){
        return true;
    }
    return false;
}

function dirname(filepath){
    var tmp = filepath.split("/");
    tmp.pop();
    return tmp.join("/");
}


function main(){
    //Get the sort method from agi input
    if (typeof(sort) == "undefined"){
        sort = "smart";
    }

    //Scan the folder
    var results = filelib.aglob(folder, sort);

    //Sort the files
    var files = [];
    var folders = [];
    for (var i = 0; i < results.length; i++){
        var thisFile = results[i];
        if (filelib.isDir(thisFile)){
            if (!isHiddenFile(thisFile) && folderContainSubFiles(thisFile)){
                folders.push(thisFile);
            }

        }else{
            // Hidden dot-files (e.g. AppleDouble "._IMG.jpg" sidecars) are
            // cache/system artifacts, not photos — same rule as for folders.
            if (isImage(thisFile) && !isHiddenFile(thisFile)){
                files.push(thisFile);
            }
        }
    }

    // Filter out JPG duplicates when RAW files exist
    files = filterDuplicates(files);

    // Year / Month grouping must follow the EXIF shoot time, not the file's
    // last-modified time. The per-user photo index (imagedb.js) already stores
    // taken_date = EXIF DateTimeOriginal for every indexed photo, so resolve it
    // with one folder-scoped query instead of decoding EXIF per file per request.
    var takenMap = {};
    var db = openIndexDB();
    if (db != null) {
        // `folder` is the request wildcard ("user:/Photo/*"); its dirname is the
        // folder being listed, which is exactly how the index keys its rows.
        var rows = db.query("SELECT filepath, taken_date FROM photos WHERE folder = ?", [dirname(folder)]);
        for (var ri = 0; ri < rows.length; ri++) {
            if (rows[ri].taken_date) {
                takenMap[rows[ri].filepath] = rows[ri].taken_date;
            }
        }
        db.close();
    }

    // Add filesize + dates to each file. taken_date (unix seconds, from EXIF)
    // drives the Year / Month grid sections; mtime is the fallback for photos
    // the background indexer has not reached yet.
    var filesWithSize = [];
    for (var i = 0; i < files.length; i++){
        var filepath = files[i];
        var filesize = filelib.filesize(filepath);
        var mtime = filelib.mtime(filepath, true);
        if (mtime === false){
            mtime = 0;
        }
        filesWithSize.push({
            filepath: filepath,
            filesize: filesize,
            mtime: mtime,
            taken_date: takenMap[filepath] || null
        });
    }

    sendJSONResp(JSON.stringify([folders, filesWithSize]));
}

main();