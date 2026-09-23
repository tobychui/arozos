/*
    dialog.js

    Helpers shared by the File Manager dialog windows (file properties, the
    "open with" picker and the version history manager).

    Everything here is presentation only: theme selection, the file type icon,
    size formatting and the toast. Nothing in this file talks to the file
    system - the pages own their own requests.
*/

//Match the theme the File Manager is currently using
function dlgInitTheme(callback){
    $.get(ao_root + "system/file_system/preference?key=file_explorer/theme", function(data){
        if (data != undefined && data.error === undefined && data == "darkTheme"){
            $("body").removeClass("whiteTheme").addClass("darkTheme");
        }else{
            $("body").removeClass("darkTheme").addClass("whiteTheme");
        }
        if (typeof(callback) == "function"){
            callback();
        }
    }).fail(function(){
        //Preference unreachable: the light theme is the safer default as the
        //float window frame is drawn light as well
        $("body").addClass("whiteTheme");
        if (typeof(callback) == "function"){
            callback();
        }
    });
}

//The dialogs render server supplied names and paths, so escape before
//they are dropped into a template string
function dlgEscape(text){
    return String(text == undefined || text == null ? "" : text)
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;");
}

function dlgBytesToSize(bytes){
    var sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes == 0){
        return "0 Byte";
    }
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + " " + sizes[i];
}

/*
    File type colours

    The glyph alone makes every file look the same at a glance, which is the
    one thing the icon is there to prevent. The colour carries the file family
    and the glyph carries the detail.
*/
function dlgGetTypeColor(ext){
    var colorList = {
        image: "#00897b", audio: "#8e24aa", video: "#e53935", archive: "#f57c00",
        code: "#1a73e8", text: "#5f6368", pdf: "#d93025", word: "#1a73e8",
        excel: "#0f9d58", powerpoint: "#e8710a", model: "#7b1fa2", db: "#7c4dff"
    };

    var families = {
        image: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "psd", "tiff", "ico"],
        audio: ["mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "mid"],
        video: ["mp4", "mkv", "webm", "avi", "mov", "wmv", "flv"],
        archive: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz"],
        code: ["js", "css", "html", "htm", "php", "go", "py", "java", "c", "cpp", "h", "json", "xml", "yaml", "yml", "agi", "sh", "bat"],
        text: ["txt", "md", "log", "csv", "rtf"],
        pdf: ["pdf"],
        word: ["doc", "docx", "odt", "doca"],
        excel: ["xls", "xlsx", "ods", "xlsxa"],
        powerpoint: ["ppt", "pptx", "odp", "ppa"],
        model: ["stl", "obj", "3ds", "fbx", "step", "iges", "gcode"],
        db: ["db", "sqlite", "sqlite3", "sql"]
    };

    for (var family in families){
        if (families[family].indexOf(ext) >= 0){
            return colorList[family];
        }
    }
    return "#5f6368";
}

/*
    A drawn sheet of paper with a folded corner, tinted by file family, with
    the Semantic UI glyph for the type sitting on it.

    Drawn rather than picked from an icon font so that the folded corner reads
    the same at every size and in both themes; see the emoji / icon rule in
    CLAUDE.md.
*/
function dlgFileIconHTML(basename, isDirectory){
    if (isDirectory){
        return '<div class="dlgFileIcon">' +
            '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M4 12a3 3 0 0 1 3-3h11l4 5h19a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#f6c445"></path>' +
            '<path d="M4 18a3 3 0 0 1 3-3h34a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#fbd571"></path>' +
            '</svg></div>';
    }

    var ext = "";
    if (String(basename).indexOf(".") >= 0){
        ext = String(basename).split(".").pop().toLowerCase();
    }

    var tint = dlgGetTypeColor(ext);
    var glyph = "file outline";
    if (typeof(ao_module_utils) != "undefined" && ext != ""){
        glyph = ao_module_utils.getIconFromExt(ext);
    }

    //A few families the shared extension table has no glyph for
    var extraGlyphs = {
        db: "database", sqlite: "database", sqlite3: "database", sql: "database",
        exe: "cog", dll: "cog", iso: "disc", svg: "file image outline",
        webp: "file image outline", ttf: "font", otf: "font", woff: "font"
    };
    if (extraGlyphs[ext] != undefined){
        glyph = extraGlyphs[ext];
    }

    return '<div class="dlgFileIcon">' +
        '<svg viewBox="0 0 48 60" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M6 4a3 3 0 0 1 3-3h20l13 13v42a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="#ffffff" stroke="' + tint + '" stroke-opacity="0.35" stroke-width="1.5"></path>' +
        '<path d="M29 1l13 13H32a3 3 0 0 1-3-3z" fill="' + tint + '" fill-opacity="0.3"></path>' +
        '<rect x="13" y="27" width="22" height="22" rx="6" fill="' + tint + '"></rect>' +
        '</svg>' +
        '<i class="' + dlgEscape(glyph) + ' icon" style="color:#ffffff;"></i>' +
        '</div>';
}

//Stack of sheets, for a multiple item selection
function dlgMultiIconHTML(){
    return '<div class="dlgFileIcon">' +
        '<svg viewBox="0 0 48 60" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M2 10a3 3 0 0 1 3-3h18l11 11v36a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#dfe3e8"></path>' +
        '<path d="M12 4a3 3 0 0 1 3-3h18l11 11v40a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3z" fill="#ffffff" stroke="#9aa0a6" stroke-width="1.5"></path>' +
        '<path d="M33 1l11 11h-8a3 3 0 0 1-3-3z" fill="#9aa0a6" fill-opacity="0.4"></path>' +
        '</svg></div>';
}

var dlgToastTimer = null;
function dlgToast(message){
    var toast = $("#dlgToast");
    if (toast.length == 0){
        $("body").append('<div id="dlgToast" class="dlgToast"></div>');
        toast = $("#dlgToast");
    }
    toast.text(message).stop(true, true).fadeIn(120);
    if (dlgToastTimer != null){
        clearTimeout(dlgToastTimer);
    }
    dlgToastTimer = setTimeout(function(){
        toast.fadeOut(200);
    }, 2600);
}

//Copy without the clipboard API, which browsers only expose on secure origins
//and ArozOS is very often reached over plain http on a LAN address
function dlgCopyToClipboard(text){
    var helper = $('<textarea style="position:fixed; left:-9999px; top:0px;"></textarea>');
    $("body").append(helper);
    helper.val(text);
    helper[0].select();
    var succeed = false;
    try{
        succeed = document.execCommand("copy");
    }catch(ex){
        succeed = false;
    }
    helper.remove();
    return succeed;
}
