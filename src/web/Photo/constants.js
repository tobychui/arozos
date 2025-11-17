/*
    Photo Module Constants
    Shared constants across all Photo module scripts
*/

// RAW image format extensions supported by the Photo module
// Must match backend RawImageFormats in src/mod/filesystem/metadata/metadata.go
const RAW_IMAGE_EXTENSIONS = ['arw', 'cr2', 'dng', 'nef', 'raf', 'orf'];

// Check if a file is a RAW image format
function isRawImage(filename) {
    var ext = filename.split('.').pop().toLowerCase();
    return RAW_IMAGE_EXTENSIONS.includes(ext);
}
