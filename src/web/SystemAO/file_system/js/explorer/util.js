/*
    util.js

    Small dependency-free helpers. Loaded first: state.js calls lscheck() at eval time.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

    //CRC32 lookup table and helpers for chunk/file integrity verification
    const crc32Table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c;
        }
        return t;
    })();
    //Update a running CRC32 state with new bytes (does not finalize)
    function crc32UpdateState(state, bytes) {
        for (let i = 0; i < bytes.length; i++)
            state = (state >>> 8) ^ crc32Table[(state ^ bytes[i]) & 0xFF];
        return state;
    }
    //Compute standalone CRC32 of a Uint8Array and return hex string
    function crc32Hex(bytes) {
        return ((crc32UpdateState(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
    }

    //Thumbnail base64 sniffing now lives in shared/filethumb.js as
    //FileThumb.thumbExtFromBase64 / FileThumb.base64ToDataURL


    function shortenLongFoldername(name, maxchar = 20){
        var resultname = name;
        if (name.length > maxchar){
            //Shorten it
            var offset = parseInt((maxchar - 2) / 2);
            resultname = name.substr(0, offset) + "..." + name.substr(name.length - offset)
        }

        return resultname
    }

    function getExtFromPath(path){
        if (path.includes(".") == false){
            return "";
        }
        return path.split(".").pop();
    }

    //Check if localstorage is availble
    function lscheck(){
        var test = 'test';
        try {
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch(e) {
            return false;
        }
    }

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100, 2) / 100 + ' ' + sizes[i];
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

//Handle keydown of enter on certain input boxes
function handleEnterKeyDown(event, handler){
    if (event.which == 13){
        handler();
    }
}

//Generate a download link and press it
function generateDownloadFromURL(url, filename){
    let a = document.createElement('a')
    a.href = url;
    a.download = filename;
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
}

/*
    Integration functions
*/

//Request CSRF token before any file operation API Calls for better security
function requestCSRFToken(callback){
    $.ajax({
        url: "../../system/csrf/new",
        success: function(token){
            callback(token);
        }
    })
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.handleEnterKeyDown = handleEnterKeyDown;
