/*
    icons.js

    Inline SVG badges for the file rows of the file operation dialog.
    Drawn locally instead of pulled from an icon font so the badge can carry
    the file type colour, see file_operation.html.
*/

var fileOperationIconCategories = {
    video: ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "mpg", "mpeg", "3gp", "ts"],
    image: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico", "tif", "tiff", "heic", "psd"],
    audio: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus", "mid", "midi"],
    archive: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "iso"],
    document: ["txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "csv"],
    code: ["js", "ts", "html", "css", "json", "xml", "go", "py", "java", "c", "cpp", "h", "php", "sh", "yaml", "yml"]
};

var fileOperationIconColors = {
    video: "#2f80ed",
    image: "#8e5bd0",
    audio: "#e07b39",
    archive: "#c9a227",
    document: "#4a90a4",
    code: "#3aa06a",
    folder: "#e0a92b",
    file: "#7a8593"
};

/*
    getFileCategory(filename, isFolder)

    Resolve a filename into one of the categories above. Unknown extensions
    fall back to the generic "file" category.
*/
function getFileCategory(filename, isFolder) {
    if (isFolder) {
        return "folder";
    }
    var ext = String(filename || "").split(".").pop().toLowerCase();
    for (var category in fileOperationIconCategories) {
        if (fileOperationIconCategories[category].indexOf(ext) != -1) {
            return category;
        }
    }
    return "file";
}

/*
    renderStackedBadge(state)

    The badge of a row that stands in for a whole pile of files at once, drawn
    as a few sheets stacked on top of each other. Finished operations fall back
    to the same result badges a single file gets, see renderFileBadge.
*/
function renderStackedBadge(state) {
    if (state == "completed" || state == "error" || state == "cancelled") {
        return renderFileBadge("", state, false);
    }

    var color = fileOperationIconColors.file;
    return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect x="6" y="2" width="22" height="24" rx="4" fill="' + color + '" opacity="0.35"></rect>' +
        '<rect x="4" y="4" width="22" height="24" rx="4" fill="' + color + '" opacity="0.6"></rect>' +
        '<rect x="2" y="6" width="22" height="24" rx="4" fill="' + color + '"></rect>' +
        '<path d="M7 13 h12 M7 17.5 h12 M7 22 h7" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"></path>' +
        '</svg>';
}

/*
    renderFileBadge(filename, state, isFolder)

    Return the SVG markup of the badge shown at the left of a file row.
    state is one of: ongoing / pending / completed / error / cancelled.
*/
function renderFileBadge(filename, state, isFolder) {
    if (state == "completed") {
        return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<circle cx="16" cy="16" r="13" fill="#21ba45"></circle>' +
            '<path d="M10 16.4 L14.3 20.6 L22 12.6" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '</svg>';
    }

    if (state == "error") {
        return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<circle cx="16" cy="16" r="13" fill="#db2828"></circle>' +
            '<path d="M11.5 11.5 L20.5 20.5 M20.5 11.5 L11.5 20.5" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"></path>' +
            '</svg>';
    }

    if (state == "cancelled") {
        return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<circle cx="16" cy="16" r="12.2" fill="none" stroke="#8b97a5" stroke-width="2.2"></circle>' +
            '<path d="M11 11 L21 21" fill="none" stroke="#8b97a5" stroke-width="2.2" stroke-linecap="round"></path>' +
            '</svg>';
    }

    var category = getFileCategory(filename, isFolder);
    var color = fileOperationIconColors[category];
    var glyph = "";
    switch (category) {
        case "video":
            glyph = '<path d="M13 11.4 L21.4 16 L13 20.6 Z" fill="#ffffff"></path>';
            break;
        case "image":
            glyph = '<circle cx="12.4" cy="12.6" r="1.9" fill="#ffffff"></circle>' +
                '<path d="M9 21.4 L14.2 15.6 L17.4 19.1 L19.6 16.7 L23 21.4 Z" fill="#ffffff"></path>';
            break;
        case "audio":
            glyph = '<path d="M19.8 9.4 L14 11.1 V19 a2.5 2.5 0 1 0 1.7 2.3 V14 l4.1-1.2 Z" fill="#ffffff"></path>';
            break;
        case "archive":
            glyph = '<path d="M9.5 12.6 h13 v9.4 h-13 Z" fill="#ffffff"></path>' +
                '<path d="M9.5 12.6 L11.6 9.6 h8.8 l2.1 3" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"></path>' +
                '<path d="M14.4 16.2 h3.2" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round"></path>';
            break;
        case "folder":
            glyph = '<path d="M9 11.6 h4.6 l1.5 1.9 h8 v9.1 h-14 Z" fill="#ffffff"></path>';
            break;
        case "code":
            glyph = '<path d="M13.6 12.4 L9.6 16 L13.6 19.6 M18.4 12.4 L22.4 16 L18.4 19.6" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>';
            break;
        default:
            glyph = '<path d="M11.4 9.4 h6.6 l4 4 v9.2 h-10.6 Z" fill="#ffffff"></path>' +
                '<path d="M18 9.4 v4 h4" fill="none" stroke="' + color + '" stroke-width="1.4" stroke-linejoin="round"></path>';
    }

    return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect x="2" y="2" width="28" height="28" rx="7" fill="' + color + '"></rect>' +
        glyph +
        '</svg>';
}
