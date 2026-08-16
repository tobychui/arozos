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
    var oprConfig = {
        opr: "zip",
        src: zippingFiles,
        dest: currentPath,
        overwriteMode: "overwrite",
        callbackWindowID: ao_module_windowID,
        callbackFunction: `callRefresh("${currentPath}")`
    }
    var configHash = encodeURIComponent(JSON.stringify(oprConfig));
    var title = applocale.getString("opr/zip/zipping","Zipping ") +  zippingFiles.length;
    if (fileList.length > 1){
        title += applocale.getString("opr/zip/files", " files");
    }else{
        title += applocale.getString("opr/zip/file"," file");
    }

    if (!ao_module_virtualDesktop){
        window.open("file_operation.html#" + configHash);
    }else{
        parent.newFloatWindow({
            url: "SystemAO/file_system/file_operation.html#" + configHash,
            width: 400,
            height: 220,
            appicon: "SystemAO/file_system/img/selector.png",
            title: title
        });
    }

    
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

    //Unzip and open them to tmp:/
    var oprConfig = {
        opr: "unzip",
        src: unzippingFiles,
        dest: currentPath,
        overwriteMode: "overwrite",
        callbackWindowID: ao_module_windowID,
        callbackFunction: `callRefresh("${currentPath}")`
    }

    //Render the dialog title name
    var configHash = encodeURIComponent(JSON.stringify(oprConfig));
    var title = applocale.getString("opr/zip/unzipping","Unzipping ") + unzippingFiles.length;
    if (unzippingFiles.length > 1){
        title += applocale.getString("opr/zip/files", " files");
    }else{
        title += applocale.getString("opr/zip/file"," file");
    }


    if (!ao_module_virtualDesktop){
        window.open("file_operation.html#" + configHash);
    }else{
        parent.newFloatWindow({
            url: "SystemAO/file_system/file_operation.html#" + configHash,
            width: 400,
            height: 220,
            appicon: "SystemAO/file_system/img/selector.png",
            title: title,
        });
    }

}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.unzipHere = unzipHere;
window.zipFile = zipFile;
