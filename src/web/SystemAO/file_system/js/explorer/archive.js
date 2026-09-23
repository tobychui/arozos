/*
    archive.js

    Zip and unzip, delegated to file_operation.html.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function zipFile(){
    $(".popup").fadeOut('fast');
    var zippingFiles = [];
    $(".fileObject.selected").each(function(){
        var filepath = $(this).attr("filepath");
        zippingFiles.push(filepath);
    });


    //Request to create a zip file, named with the parent dir name
    ao_module_startFileOperation({
        opr: "zip",
        src: zippingFiles,
        dest: currentPath,
        overwriteMode: "overwrite",
        callbackWindowID: ao_module_windowID,
        callbackFunction: `callRefresh("${currentPath}")`
    });
}

function unzipHere(){
    $(".popup").fadeOut('fast');

    //Get a list of zip files selected
    var unzippingFiles = [];
    $(".fileObject.selected").each(function(){
        var filepath = $(this).attr("filepath");
        if ((filepath.split(".").pop()).toLowerCase() == "zip"){
            unzippingFiles.push(filepath);
        }
    });

    if(unzippingFiles.length == 0){
        msgbox("red remove", applocale.getString("opr/zip/nozipfile", "No zip file selected"));
        return;
    }

    //Start unzip progress

    //Extract the archives into the folder the user is looking at
    ao_module_startFileOperation({
        opr: "unzip",
        src: unzippingFiles,
        dest: currentPath,
        overwriteMode: "overwrite",
        callbackWindowID: ao_module_windowID,
        callbackFunction: `callRefresh("${currentPath}")`
    });
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.unzipHere = unzipHere;
window.zipFile = zipFile;
