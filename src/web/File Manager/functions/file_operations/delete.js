if (!requirelib("filelib")) {
    sendJSONResp({error: "Unable to load filelib"});
}

// Get the paths
var paths = JSON.parse(pathsParam);

// FIXME: Deleting folders are not aupported by filelib

// Do the deletion
var failedPaths = [];
paths.forEach(function(path) {
    if (!filelib.deleteFile(path)) {
        failedPaths.push(path);
    }
});

// Return result
if (failedPaths.length > 0) {
    sendJSONResp({
        error: "Failed to remove: " + failedPaths
    });
}