/*
    ArozOS Desktop - Context menu

    The right click menu of the desktop, desktop icons, float window title
    bars and taskbar buttons, plus its sub menus (new item, wallpaper, icon
    size) and the helpers that build menu items.

    Part of desktop.html, see README.md in this folder for the load order.
*/

// ======================= CONTEXT MENU =============================

window.addEventListener("contextmenu",
    function(e) {
        e.preventDefault();
        e.stopPropagation();
        var clickTarget = $(e.target);
        hideAllContextMenus();
        showMenu = false;
        $("#contextmenu").html("");
        if (clickTarget.hasClass("launchIcon") || clickTarget.hasClass("launchIconImage") || clickTarget.hasClass("launchIconText")) {
            //Click on an object on destkop
            if (clickTarget.hasClass("launchIcon") == false) {
                clickTarget = $(clickTarget).parent().parent();
            }
            if (!ctrlHold && !$(clickTarget).find(".launchIconWrapper").hasClass("selected")){
                $(".launchIconWrapper.selected").removeClass("selected");
            }
            //Select this object
            $(clickTarget).find(".launchIconWrapper").addClass("selected");
            var objectType = $(clickTarget).attr("type");
            operationTargetLaunchIcon = $(clickTarget);
            //Check if selected more than one object
            if ($(".launchIconWrapper.selected").length > 1){
                    //When the user selected more than one item on desktop
                    addContextMenuItem($("#contextmenu"), lcontex('Open'), undefined, "openIconViaMenu", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Open With'), "<i class='caret right icon'></i>", "handleOpenWith", true);
                    //addContextMenuItem($("#contextmenu"), 'Share', "<i class='caret right icon'></i>", "handleFileShare", true);
                    addContextMenuSeperator($("#contextmenu"));
                    addContextMenuItem($("#contextmenu"), lcontex('Download in Zip'), "<i class='download icon'></i>", "downloadFile", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Copy'), "<i class='copy icon'></i>", "handleCopyOperation", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Cut'), "<i class='cut icon'></i>", "handleCutOperation", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Delete'), "<i class='trash icon'></i>", "handleFileDelete", false);
                    addContextMenuSeperator($("#contextmenu"));
                    addContextMenuItem($("#contextmenu"), lcontex('Properties'), undefined, "openObjectProperty", false);

            }else{
                //When the user only selected one item
                if (objectType == "file") {
                    addContextMenuItem($("#contextmenu"), lcontex('Open'), undefined, "openIconViaMenu", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Open With'), "<i class='caret right icon'></i>", "handleOpenWith", true);
                    addContextMenuItem($("#contextmenu"), lcontex('Share'), "<i class='caret right icon'></i>", "handleFileShare", true);
                    addContextMenuSeperator($("#contextmenu"));
                    addContextMenuItem($("#contextmenu"), lcontex('Download'), "<i class='download icon'></i>", "downloadFile", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Copy'), "<i class='copy icon'></i>", "handleCopyOperation", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Cut'), "<i class='cut icon'></i>", "handleCutOperation", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Rename'), undefined, "handleRename", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Delete'), "<i class='trash icon'></i>", "handleFileDelete", false);
                    addContextMenuSeperator($("#contextmenu"));
                    addContextMenuItem($("#contextmenu"), lcontex('Properties'), undefined, "openObjectProperty", false);

                } else if (objectType == "folder") {
                    addContextMenuItem($("#contextmenu"), lcontex('Open'), undefined, "openIconViaMenu", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Zip here'), "<i class='zip icon'></i>", "handleZipFolder", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Share'), "<i class='caret right icon'></i>", "handleFileShare", true);
                    addContextMenuSeperator($("#contextmenu"));
                    addContextMenuItem($("#contextmenu"), lcontex('Download as Zip'), "<i class='download icon'></i>", "downloadFile", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Copy'), "<i class='copy icon'></i>", "handleCopyOperation", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Cut'), "<i class='cut icon'></i>", "handleCutOperation", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Rename'), undefined, "handleRename", false);
                    addContextMenuItem($("#contextmenu"), lcontex('Delete'), "<i class='trash icon'></i>", "handleFileDelete", false);
                    addContextMenuSeperator($("#contextmenu"));
                    addContextMenuItem($("#contextmenu"), lcontex('Properties'), undefined, "openObjectProperty", false);
                } else if (objectType == "shortcut") {
                    var fd = JSON.parse(decodeURIComponent($(clickTarget).attr("filedata")));
                    console.log(fd);
                    if (fd.ShortcutType == "module"){
                        //Public WebApp
                        addContextMenuItem($("#contextmenu"), lcontex('Open'), undefined, "openIconViaMenu", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Open in New Tab'), "<i class='external icon'></i>", "openWebAppInNewTab", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Rename'), undefined, "handleRename", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Delete'), "<i class='trash icon'></i>", "handleFileDelete", false);
                        addContextMenuSeperator($("#contextmenu"));
                        addContextMenuItem($("#contextmenu"), lcontex('Edit Shortcut'), "<i class='edit icon'></i>", "openShortcutEditor", false);

                    }else if (fd.ShortcutType == "folder"){
                        //Folder
                        addContextMenuItem($("#contextmenu"), lcontex('Open'), undefined, "openIconViaMenu", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Open File Location'), "<i class='folder open icon'></i>", "handleShortcutFolderOpen", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Rename'), undefined, "handleRename", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Delete'), "<i class='trash icon'></i>", "handleFileDelete", false);
                        addContextMenuSeperator($("#contextmenu"));
                        addContextMenuItem($("#contextmenu"), lcontex('Edit Shortcut'), "<i class='edit icon'></i>", "openShortcutEditor", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Properties'), undefined, "openObjectProperty", false);

                    }else{
                        addContextMenuItem($("#contextmenu"), lcontex('Open'), undefined, "openIconViaMenu", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Open in New Tab'), "<i class='external icon'></i>", "openURLShortcutInNewTab", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Rename'), undefined, "handleRename", false);
                        addContextMenuItem($("#contextmenu"), lcontex('Delete'), "<i class='trash icon'></i>", "handleFileDelete", false);
                        addContextMenuSeperator($("#contextmenu"));
                        addContextMenuItem($("#contextmenu"), lcontex('Edit Shortcut'), "<i class='edit icon'></i>", "openShortcutEditor", false);
                    }


                }else{
                    console.log("Opening context menu on unknown type: ", objectType);
                }
            }
            showMenu = true;

        } else if (clickTarget.hasClass("backgroundFrame") || ((isSafari || (isMacOS && isChrome)) && $(clickTarget).attr("id") == "selectionPanel")) {
            //Click on the background. Load background context menu.
            addContextMenuItem($("#contextmenu"), lcontex('New'), "<i class='caret right icon'></i>", "newitemmenu", true);
            addContextMenuItem($("#contextmenu"), lcontex('Refresh'), "<i class='refresh icon'></i>", "handleMenuRefresh", false);
            addContextMenuItem($("#contextmenu"), lcontex('Open File Manager'), undefined, "openfm", false);
            if (checkFileInClipboard()){
                addContextMenuItem($("#contextmenu"), lcontex('Paste Here'), "<i class='paste icon'></i>", "handlePasteOperation", false);
            }
            addContextMenuItem($("#contextmenu"), lcontex('Personalization'), "<i class='paint brush icon'></i>", "personalization", false);
            addContextMenuItem($("#contextmenu"), lcontex('Background'), "<i class='caret right icon'></i>", "background", true);
            addContextMenuItem($("#contextmenu"), lcontex('Icon Size'), "<i class='caret right icon'></i>", "listIconsize", true);
            addContextMenuItem($("#contextmenu"), lcontex('Toggle FullScreen'), "<i class='expand  icon'></i>", "fullscreen", false);
            addContextMenuItem($("#contextmenu"), lcontex('Exit'), undefined, "logout", false);
            showMenu = true;
        }else if (clickTarget.hasClass("fwdragger") || (clickTarget.hasClass("title") && clickTarget.parent().hasClass("fwdragger"))){
            //Click on the floatWindow object 
            addContextMenuItem($("#contextmenu"), lcontex('Open in New Tab'), "<i class='external icon'></i>", "openSelectedFloatWindowInNewTab", false);
            addContextMenuItem($("#contextmenu"), lcontex('Refresh'), "<i class='refresh icon'></i>", "refreshSelectedFloatWindow", false);
            addContextMenuSeperator($("#contextmenu"));
            addContextMenuItem($("#contextmenu"), lcontex('Minimize'), "<i class='window minimize icon'></i>", "minimizeSelectedFloatWindow", false);

            if ($(clickTarget).parent().hasClass("fixedsize") == false && $(clickTarget).parent().parent().hasClass("fixedsize") == false){
                //This FloatWindow is resizable
                console.log($(clickTarget).parent());
                if ($(clickTarget).parent().attr("max") !== undefined && $(clickTarget).parent().attr("max") == "true"){
                    addContextMenuItem($("#contextmenu"), lcontex('Restore'), "<i class='window window restore icon'></i>", "maximizeSelectedFloatWindow", false);
                }else{
                    addContextMenuItem($("#contextmenu"), lcontex('Maximize'), "<i class='window maximize icon'></i>", "maximizeSelectedFloatWindow", false);
                }

            }
            addContextMenuItem($("#contextmenu"), lcontex('Close'), "<i class='remove icon'></i>", "closeSelectedFloatWindow", false);
            showMenu = true;
        } else if ($(clickTarget).hasClass("floatWindowButton") || $(clickTarget).parent().hasClass("floatWindowButton")){
            if ($(clickTarget).parent().hasClass("floatWindowButton")){
                clickTarget = $(clickTarget).parent();
            }
            //Get the ID list of this button group
            var originalIDlist = JSON.parse(decodeURIComponent($(clickTarget).attr('windowIDGroup')));
            var buttonGroupName = $(clickTarget).attr('group');
            var displayText = lcontex('Close');
            if (originalIDlist.length > 1){
                //More than 1 window
                displayText = lcontex('Close All');
            }

            addContextMenuItem($("#contextmenu"), displayText, "<i class='remove icon'></i>", `closeWindowGroup('${buttonGroupName}');`, false);
            showMenu = true;
        }



        if (showMenu){
            //Toggle context menu
            $("#contextmenu").show();
            var startX = e.pageX;
            var startY = e.pageY;
            if (e.pageX > window.innerWidth / 2){
                startX = e.pageX - $("#contextmenu").width();
            }
            if (e.pageY > window.innerHeight / 2){
                startY = e.pageY -  $("#contextmenu").height();
            }
            $("#contextmenu").css({
                left: startX,
                top: startY
            });
            menuStartLocation = [e.pageX, e.pageY];
        }
    }
, true);

//Localize context menu items using applocale
function lcontex(key){
    if (applocale){
        return applocale.getString("contextmenu/" + key, key);
    }else{
        return key;
    }
}

function handleMenuRefresh() {
    //This function is here to remove the object and event passed in from menu pressed object
    refresh();
}

/*
    This function is used to generate menu items for context menu.
    Options example
    {
        payload: {
            //Some JSON based payload here
        }
    }
*/

function addContextMenuItem(target, keyword, hotkey = undefined, functionName, containSubMenu = false, options=undefined) {
    var itemClass = "item";
    if (containSubMenu) {
        itemClass = "item submenu";
    }

    var payload = "";
    if (options != undefined && options.payload != undefined){ 
        payload = encodeURIComponent(JSON.stringify(options.payload));
    }

    if (hotkey !== undefined) {
        target.append(`<div class="${itemClass}" onclick="${functionName}(this,event);" payload="${payload}">
                ${keyword}
                <span class="description">${hotkey}</span>
            </div>`);
    } else {
        target.append(`<div class="${itemClass}"  onclick="${functionName}(this,event);" payload="${payload}">
                ${keyword}
            </div>`);
    }
}

function getContextMenuPayload(object){
    var encodedPayload = $(object).attr("payload");
    if (encodedPayload != ""){
        return JSON.parse(decodeURIComponent(encodedPayload));
    }else{
        return null;
    }
}

function listIconsize(target, event) {
    $("#subcontextmenu").html("");
    var smallCheckmark = undefined;
    var mediumCheckmark = undefined;
    var bigCheckmark = undefined;
    if (desktopIconSize == "small") {
        smallCheckmark = "<i class='checkmark icon'></i>";
    }
    if (desktopIconSize == "medium") {
        mediumCheckmark = "<i class='checkmark icon'></i>";
    }

    if (desktopIconSize == "big") {
        bigCheckmark = "<i class='checkmark icon'></i>";
    }
    addContextMenuItem($("#subcontextmenu"), lcontex("Small"), smallCheckmark, "setDesktopIconSize", false, {payload: "small"});
    addContextMenuItem($("#subcontextmenu"), lcontex("Medium"), mediumCheckmark, "setDesktopIconSize", false, {payload: "medium"});
    addContextMenuItem($("#subcontextmenu"), lcontex("Big"), bigCheckmark, "setDesktopIconSize", false, {payload: "big"});
    showSubContextMenu(target);
}

function setDesktopIconSize(target, evt) {
    var targetSize = $(target).attr("payload");
    targetSize = JSON.parse(decodeURIComponent(targetSize));
    if (["small", "medium", "big"].includes(targetSize)) {
        desktopIconSize = targetSize;
    }
    refresh();
    setStorage("iconsize", desktopIconSize);
    hideAllContextMenus();
}

function addContextMenuSeperator(target) {
    $(target).append(`<div class="ui divider"></div>`);
}

function addContextMenuTitle(target, title){
    $(target).append(`<div class="header">
        ${title}
    </div>`);
}

function background(target, evt) {
    $("#subcontextmenu").html('<div class="item"><i class="loading spinning icon"></i> Loading</div>');
    $.get("system/desktop/theme", function(data) {
        $("#subcontextmenu").html("");
        for (var i = 0; i < data.length; i++) {
            if (currentUserTheme == data[i].Theme) {
                addContextMenuItem($("#subcontextmenu"), data[i].Theme, "<i class='checkmark icon'></i>", "setTheme", false);
            } else {
                addContextMenuItem($("#subcontextmenu"), data[i].Theme, undefined, "setTheme", false);
            }

        }
    });
    showSubContextMenu(target);
}

//Set theme from button click
function setTheme(target, evt) {
    var theme = $(target).text().trim();
    setDesktopTheme(theme);
    hideAllContextMenus();
}

function personalization() {
    newFloatWindow({
        url: "SystemAO/system_setting/index.html#" + encodeURIComponent(JSON.stringify({group: "Desktop", name: "Wallpaper"})),
        appicon: "SystemAO/desktop/img/personalization.png",
        width: 1200,
        height: 580,
        title: "System Settings"
    });
    hideAllContextMenus();
}

//New item menus.
function newitemmenu(target, event) {
    $("#subcontextmenu").html("");
    //Append the new folder option first
    addContextMenuItem($("#subcontextmenu"), lcontex('Folder'), "<i class='folder icon'></i>", "newfolder", true);
    addContextMenuItem($("#subcontextmenu"), lcontex('Shortcut'), "<i class='external icon'></i>", "newshortcut", true);
    addContextMenuItem($("#subcontextmenu"), lcontex('Upload'), "<i class='cloud upload icon'></i>", "upload", true);
    addContextMenuSeperator($("#subcontextmenu"));
    requestCSRFToken(function(token){
        $.ajax({
            url: "system/file_system/newItem",
            data: {csrft: token},
            success: function(data){
                for (var i = 0; i < data.length; i++) {
                    var thisNewFile = data[i];
                    var icon = ao_module_utils.getIconFromExt(thisNewFile.Ext);
                    addContextMenuItem($("#subcontextmenu"), `<i class="${icon} icon" ext="${thisNewFile.Ext}"></i> ${thisNewFile.Desc}`, undefined, "newitem");
                }
                //Show sub-context menu
                showSubContextMenu(target);
            }
        })
    });
}

function showSubContextMenu(target) {
    $("#subcontextmenu").show();
    var targetLeft = $("#contextmenu").offset().left + $("#contextmenu").width() + 2;
    var targetTop = $(target).offset().top - 1;
    if (targetLeft +  $("#subcontextmenu").width() > window.innerWidth){
        //Overflow. Swtich to the left side of the menu
        targetLeft = $("#contextmenu").offset().left - $("#subcontextmenu").width() - 2;
    }
    $("#subcontextmenu").css({
        left: targetLeft,
        top: targetTop
    });

}

function hideAllContextMenus() {
    $("#subcontextmenu").hide();
    $("#contextmenu").hide()
    $("#quickAccessPanel").fadeOut("fast");
    $("#backgroundTaskPanel").slideUp("fast");
}
