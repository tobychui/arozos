/*
    openwith.js

    The "Open With" module picker dialog.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Whether the WebApps that did not register the selected file type are unfolded
var openWithShowingAll = false;

//OpenWith dialog
function openWith(){
    if ($(".selected.fileObject").length == 0){
        msgbox("question",applocale.getString("message/nofileSelected", "No file selected"));
        return;
    }

    //Group the module list by the extensions of what is selected, the same way
    //the standalone opener (defaultOpener.html) does
    var selectedExts = getSelectedFileExtensions();
    openWithShowingAll = false;
    $("#openWithSuggestedList").html(`<div class="item">
        <div class="content">
            <div class="header">${applocale.getString("opr/openwith/loading", "Loading...")}</div>
        </div>
    </div>`);
    $("#openWithOtherList").html("").hide();
    $("#openWithToggleRow").hide();

    //Get a list of modules and append it into the selection list
    $.get("../../system/modules/list",function(data){
        if (data.error !== undefined){
            console.log(data.error);
        }else{
            renderOpenWithModuleList(data, selectedExts);
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

//The extensions of everything currently selected, lowercased and deduplicated.
//Folders and extension-less files contribute nothing, so they simply end up
//with no suggested WebApp.
function getSelectedFileExtensions(){
    var exts = [];
    $(".selected.fileObject").each(function(){
        var filename = $(this).attr("filename");
        if (filename == undefined || filename.indexOf(".") < 0){
            return;
        }
        var thisExt = ("." + filename.split(".").pop()).toLowerCase();
        if (exts.indexOf(thisExt) < 0){
            exts.push(thisExt);
        }
    });
    return exts;
}

//A module is "suggested" when its init.agi registered any of these extensions
function moduleSupportsAnyExt(thisModule, exts){
    var supportedExt = thisModule.SupportedExt;
    if (exts.length == 0 || supportedExt == null || supportedExt.length == 0){
        return false;
    }
    for (var i = 0; i < supportedExt.length; i++){
        if (exts.indexOf(String(supportedExt[i]).toLowerCase()) >= 0){
            return true;
        }
    }
    return false;
}

//Module names and icon paths come from the server, so escape before html
function escapeOpenWithText(text){
    return String(text == undefined ? "" : text)
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;");
}

function renderOpenWithModuleRow(thisModule){
    var supportFW = `<div class="ui horizontal mini icon label"><i class="window restore outline icon"></i> ${applocale.getString("opr/openwith/floatWindow", "Floating Window")}</div>`;
    var supportEmb = `<div class="ui horizontal mini icon label"><i class="folder open icon"></i> ${applocale.getString("opr/openwith/embedded", "File Input")}</div>`;
    if (!thisModule.SupportFW){
        supportFW = "";
    }
    if (!thisModule.LaunchEmb){
        supportEmb = "";
    }
    var description = "";
    if (supportFW != "" || supportEmb != ""){
        description = `<div class="description">
                            ${supportFW}
                            ${supportEmb}
                        </div>`;
    }
    var launchInfo = encodeURIComponent(JSON.stringify(thisModule));
    return `<div class="item selectable openWithModule" launchInfo="${launchInfo}" onclick="selectOpenWithModule(this, event);" ondblclick="selectOpenWithModule(this, event); openWithSelectedModule();">
                    <img class="ui avatar image" src="../../${escapeOpenWithText(thisModule.IconPath)}">
                    <div class="content">
                        <div class="header">${escapeOpenWithText(thisModule.Name)}</div>
                        ${description}
                    </div>
                    <div class="tick"><i class="check circle icon"></i></div>
                </div>`;
}

function renderOpenWithModuleList(moduleList, selectedExts){
    var suggested = "";
    var others = "";
    for (var i = 0; i < moduleList.length; i++){
        var thisModule = moduleList[i];
        var thisRow = renderOpenWithModuleRow(thisModule);
        if (moduleSupportsAnyExt(thisModule, selectedExts)){
            suggested += thisRow;
        }else{
            others += thisRow;
        }
    }

    $("#openWithSuggestedList").html(suggested);
    $("#openWithOtherList").html(others);
    $("#openWithToggleRow").toggle(others != "");

    if (suggested == ""){
        //Nothing registered this file type, so folding the rest away would
        //leave an empty dialog: show everything straight away instead
        $("#openWithSuggestedLabel").hide();
        $("#openWithSuggestedList").html(`<div class="openWithEmptyNote">${applocale.getString("opr/openwith/noSuggestion", "No WebApp is registered for this file type")}</div>`);
        $("#openWithOtherList").show();
        setOpenWithShowingAll(true);
    }else{
        $("#openWithSuggestedLabel").show();
        $("#openWithOtherList").hide();
        setOpenWithShowingAll(false);
    }
}

//Only tracks the state and the toggle row wording: the caller decides whether
//the list appears at once or slides, so this never fights the animation
function setOpenWithShowingAll(showAll){
    openWithShowingAll = showAll;
    if (showAll){
        $("#openWithToggleLabel").text(applocale.getString("opr/openwith/showLess", "Hide other WebApps"));
        $("#openWithToggleIcon").attr("class", "caret down icon");
    }else{
        $("#openWithToggleLabel").text(applocale.getString("opr/openwith/showAll", "Other WebApps..."));
        $("#openWithToggleIcon").attr("class", "caret right icon");
    }
}

function toggleOpenWithOtherModules(){
    if (openWithShowingAll){
        $("#openWithOtherList").slideUp("fast");
        setOpenWithShowingAll(false);
    }else{
        $("#openWithOtherList").slideDown("fast");
        setOpenWithShowingAll(true);
    }
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
window.toggleOpenWithOtherModules = toggleOpenWithOtherModules;
