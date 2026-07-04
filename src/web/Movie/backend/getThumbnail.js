/*
    Movie App - Thumbnail Getter
    Returns base64-encoded thumbnail for a file or folder.

    POST params:
        file  – virtual path to a file or folder

    Returns: raw base64 string, or JSON {error: "..."}
*/

includes("common.js");
requirelib("filelib");
requirelib("imagelib");

function main() {
    if (!file || file === "undefined" || file.length === 0) {
        sendJSONResp(JSON.stringify({ error: "Missing required parameter: file" }));
        return;
    }

    if (!filelib.fileExists(file)) {
        sendJSONResp(JSON.stringify({ error: "Path not found: " + file }));
        return;
    }

    var thumb = imagelib.loadThumbString(file);
    if (thumb !== false && thumb !== null && thumb.length > 0) {
        sendResp(thumb);
    } else {
        sendJSONResp(JSON.stringify({ error: "No thumbnail available" }));
    }
}

main();
