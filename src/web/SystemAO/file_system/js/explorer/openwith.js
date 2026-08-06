/*
    openwith.js

    The "Open With" module picker dialog.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//OpenWith dialog
function openWith(){
    if ($(".selected.fileObject").length == 0){
        msgbox("question",applocale.getString("message/nofileSelected", "No file selected"));
        return;
    }
    //Get a list of modules and append it into the selection list
    $.get("../../system/modules/list",function(data){
        if (data.error !== undefined){
            console.log(data.error);
        }else{
            $("#openWithModuleList").html("");
            for (var i =0; i < data.length; i++){
                var thisModule = data[i];
                var supportFW = `<div class="ui horizontal mini icon label"><i class="window restore outline icon"></i> ${applocale.getString("opr/openwith/floatWindow", "Floating Window")}</div>`;
                var supportEmb = `<div class="ui horizontal mini icon label"><i class="folder open icon"></i> ${applocale.getString("opr/openwith/embedded", "File Input")}</div>`;
                if (!thisModule.SupportFW){
                    supportFW = "";
                }
                if (!thisModule.LaunchEmb){
                    supportEmb = "";
                }
                var launchInfo = encodeURIComponent(JSON.stringify(thisModule));
                $("#openWithModuleList").append(`<div class="item selectable openWithModule" launchInfo="${launchInfo}" onclick="selectOpenWithModule(this, event);" ondblclick="selectOpenWithModule(this, event); openWithSelectedModule();">
                    <img class="ui avatar image" src="../../${thisModule.IconPath}">
                    <div class="content" style="padding-left:12px;">
                        <div class="header">${thisModule.Name}</div>
                        <div class="description">
                            ${supportFW}
                            ${supportEmb}
                        </div>
                    </div>
                </div>`);
            }
        }
    });
    $(".openWithModule.popupbuttons").addClass("disabled");
    
    hideAllPopupWindows();
    if (!ao_module_virtualDesktop){
        $("#openWith").find(".vdonly").hide();
    }
    showPopupWrapper();
    $("#openWith").transition("slide left in");

}

//Functions for handling open with module selection and file opening
function selectOpenWithModule(object, event){
    event.preventDefault();
    $(".openWithModule.popupbuttons").removeClass("disabled");
    $(".openWithModule.selected").removeClass("selected");
    $(object).addClass("selected");
}

function openWithSelectedModule(btn){
    if ($(btn).hasClass("disabled")){
        return false;
    }
    var targetModuleInfo = JSON.parse(decodeURIComponent($(".openWithModule.selected").attr("launchInfo")));
    var targetObjects = $(".selected.fileObject");

    //Phrase launch mode from the module info
    var launchURL = targetModuleInfo.StartDir
    var launchSize = [undefined, undefined];
    var iconPath = targetModuleInfo.IconPath;
    var title = targetModuleInfo.Name;
    if (targetModuleInfo.SupportEmb){
        //Launch with embedded mode
        launchURL = targetModuleInfo.LaunchEmb;
        if (targetModuleInfo.InitEmbSize !== null){
            launchSize = targetModuleInfo.InitEmbSize
        }
        
    }else if (targetModuleInfo.SupportFW){
        //Launch with floatWindow mode
        launchURL = targetModuleInfo.LaunchFWDir;
        if (targetModuleInfo.InitFWSize !== null){
            launchSize = targetModuleInfo.InitFWSize
        }
    }else if (targetModuleInfo.StartDir !== ""){
        //Launch with default mode

    }else{
        msgbox("red remove",applocale.getString("message/moduleNotSupport", "This module has no endpoint for opening a file."));
        return;
    }   

    //Parse the filelist
    var filelist = [];
    $(targetObjects).each(function(){
        var filename = $(this).attr("filename");
        var filepath = $(this).attr("filepath");
        filelist.push({
            filename: filename,
            filepath: filepath
        });
    });

    fileHash = encodeURIComponent(JSON.stringify(filelist));
    if (ao_module_virtualDesktop){
        //Open the target module in a new fw
        parent.newFloatWindow({
            url: launchURL + "#" + fileHash,
            width: launchSize[0],
            height: launchSize[1],
            appicon: iconPath,
            title: title
        });
    }else{
        //Redirect current window to the target module
        window.location.href = "../../" + launchURL + "#" + fileHash;
    }

    hideAllPopupWindows();
}

function openFileWithModuleInNewTab(btn){
    if ($(btn).hasClass("disabled")){
        return false;
    }
    var targetModuleInfo = JSON.parse(decodeURIComponent($(".openWithModule.selected").attr("launchInfo")));
    var targetObjects = $(".selected.fileObject");

    //Parse the filelist
    var filelist = [];
    $(targetObjects).each(function(){
        var filename = $(this).attr("filename");
        var filepath = $(this).attr("filepath");
        filelist.push({
            filename: filename,
            filepath: filepath
        });
    });

    //Directly passing the file information to the startdir
    fileHash = encodeURIComponent(JSON.stringify(filelist));

    if (targetModuleInfo.StartDir == ""){
        //Not a module supporting fw mode
        if (targetModuleInfo.SupportEmb == true && targetModuleInfo.LaunchEmb != ""){
            window.open("../../" + targetModuleInfo.LaunchEmb + "#" + fileHash);
        }
    }else{
        window.open("../../" + targetModuleInfo.StartDir + "#" + fileHash);
    }
    
    hideAllPopupWindows();
}

function openRawFileInFloatWindow(btn){
    //Directly open this (or more than one) files / folder in floatWindow
    var targetObjects = $(".selected.fileObject");
    $(targetObjects).each(function(){
        if ($(this).attr("type") == "file"){
            var launchURL = "media?file=" + $(this).attr('filepath');
            parent.newFloatWindow({
                url: launchURL,
                appicon: "img/system/file.png",
                title: $(this).attr('filename'),
                "background-color": "#1f1f1f"
            });
        }else if ($(this).attr("type") == "folder"){
            var launchURL = "SystemAO/file_system/file_explorer.html#" + $(this).attr("filepath");
            parent.newFloatWindow({
                url: launchURL,
                appicon: "SystemAO/file_system/img/small_icon.png",
                title: "File Manager - "  + $(this).attr('filename'),
            });
        }else{
            //Not supported openeing type.
            console.log("Failed to open file " + $(this).attr('filepath') + " . WIP")
        }
    });
    hideAllPopupWindows();
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.openFileWithModuleInNewTab = openFileWithModuleInNewTab;
window.openRawFileInFloatWindow = openRawFileInFloatWindow;
window.openWith = openWith;
window.openWithSelectedModule = openWithSelectedModule;
window.selectOpenWithModule = selectOpenWithModule;
