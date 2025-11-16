requirelib("imagelib");

function main() {
    if (imagelib.hasExif(filepath)) {
        var exifData = JSON.parse(imagelib.getExif(filepath));
        sendJSONResp(JSON.stringify(exifData));
    } else {
        sendJSONResp(JSON.stringify({}));
    }
}

main();
