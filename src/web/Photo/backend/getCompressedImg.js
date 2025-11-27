/*
    Compressed Image Retrieval Module
    Retrieves compressed images for display in the Photo application.
    
    This module compresses images to a maximum of 2048x2048 pixels
    while maintaining aspect ratio and returns as base64 data URL.
*/

requirelib("imagelib");

function main() {
    // Get the filepath from the request
    if (typeof(filepath) == "undefined") {
        sendJSONResp(JSON.stringify({
            error: "filepath parameter is required"
        }));
        return;
    }

    // Define max dimensions
    var maxWidth = 1024;
    var maxHeight = 1024;

    // Get original image dimensions
    var imgInfo = imagelib.getImageDimension(filepath);
    if (!imgInfo || !imgInfo[0] || !imgInfo[1]) {
        // If we can't get dimensions, return error
        sendJSONResp(JSON.stringify({
            error: "Cannot read image dimensions"
        }));
        return;
    }

    var originalWidth = imgInfo[0];
    var originalHeight = imgInfo[1];

    // Calculate new dimensions while maintaining aspect ratio
    var newWidth = originalWidth;
    var newHeight = originalHeight;

    if (originalWidth > maxWidth || originalHeight > maxHeight) {
        var widthRatio = maxWidth / originalWidth;
        var heightRatio = maxHeight / originalHeight;
        var ratio = Math.min(widthRatio, heightRatio);

        newWidth = Math.round(originalWidth * ratio);
        newHeight = Math.round(originalHeight * ratio);
    }

    // Determine output format from file extension
    var ext = filepath.split(".").pop().toLowerCase();
    var format = "jpeg";
    if (ext == "png") {
        format = "png";
    }

    // Resize the image and get base64 data URL
    try {
        var base64DataUrl = imagelib.resizeImageBase64(filepath, newWidth, newHeight, format);
        
        if (base64DataUrl) {
            // Return the base64 data URL as plain text
            sendResp(base64DataUrl);
        } else {
            sendJSONResp(JSON.stringify({
                error: "Failed to resize image"
            }));
        }
    } catch (error) {
        sendJSONResp(JSON.stringify({
            error: "Failed to compress image: " + error.toString()
        }));
    }
}

main();

