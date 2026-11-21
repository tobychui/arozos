/*
    ArozOS Desktop - Context menu

    The right click menu of the desktop, desktop icons, float window title
    bars and dock items, plus its sub menus (new item, wallpaper, icon size)
    and the helpers that build them.

    Building a menu (text rows; icons only where they are the information,
    such as item types and applications):
        addContextMenuItem(menu, label, hotkey, functionName, isSubMenu, options)
            options: payload, icon (Semantic UI icon name), image (url),
                     shortcut (text), checked, danger, disabled
            The hotkey argument is kept for old callers: only a "checkmark"
            in it still means something (checked). Icons are shown only
            when asked for through options.icon / options.image.
        addContextMenuSeperator(menu), addContextMenuTitle(menu, title)

    A row runs `functionName(this, event)` on click; a sub menu row runs the
    builder named by functionName through contextMenuOpenSub, which fills
    #subcontextmenu and calls showSubContextMenu(row). Sub menus open on
    hover too, and the arrow keys, Enter and Escape drive both menus.

    Part of desktop.html, see README.md in this folder for the load order.
*/

// ======================= CONTEXT MENU =============================

window.addEventListener("contextmenu",
    function(e) {
        e.preventDefault();
        e.stopPropagation();
        var clickTarget = $(e.target);
        var dockMenuItem = null;
        var menu = $("#contextmenu");
        hideAllContextMenus();
        showMenu = false;
        menu.html("");
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
                addContextMenuItem(menu, lcontex('Open'), undefined, "openIconViaMenu", false);
                addContextMenuItem(menu, lcontex('Open With'), undefined, "handleOpenWith", true);
                addContextMenuSeperator(menu);
                contextMenuEditRows(menu, true, false);
                addContextMenuSeperator(menu);
                addContextMenuItem(menu, lcontex('Download in Zip'), undefined, "downloadFile", false);
                addContextMenuSeperator(menu);
                addContextMenuItem(menu, lcontex('Properties'), undefined, "openObjectProperty", false);

            }else{
                //When the user only selected one item
                if (objectType == "file") {
                    addContextMenuItem(menu, lcontex('Open'), undefined, "openIconViaMenu", false);
                    addContextMenuItem(menu, lcontex('Open With'), undefined, "handleOpenWith", true);
                    addContextMenuSeperator(menu);
                    contextMenuEditRows(menu, true, true);
                    addContextMenuSeperator(menu);
                    addContextMenuItem(menu, lcontex('Share'), undefined, "handleFileShare", true);
                    addContextMenuItem(menu, lcontex('Download'), undefined, "downloadFile", false);
                    addContextMenuSeperator(menu);
                    addContextMenuItem(menu, lcontex('Properties'), undefined, "openObjectProperty", false);

                } else if (objectType == "folder") {
                    addContextMenuItem(menu, lcontex('Open'), undefined, "openIconViaMenu", false);
                    addContextMenuItem(menu, lcontex('Zip here'), undefined, "handleZipFolder", false);
                    addContextMenuSeperator(menu);
                    contextMenuEditRows(menu, true, true);
                    addContextMenuSeperator(menu);
                    addContextMenuItem(menu, lcontex('Share'), undefined, "handleFileShare", true);
                    addContextMenuItem(menu, lcontex('Download as Zip'), undefined, "downloadFile", false);
                    addContextMenuSeperator(menu);
                    addContextMenuItem(menu, lcontex('Properties'), undefined, "openObjectProperty", false);
                } else if (objectType == "shortcut") {
                    var fd = JSON.parse(decodeURIComponent($(clickTarget).attr("filedata")));
                    if (fd.ShortcutType == "module"){
                        //Public WebApp
                        addContextMenuItem(menu, lcontex('Open'), undefined, "openIconViaMenu", false);
                        addContextMenuItem(menu, lcontex('Open in New Tab'), undefined, "openWebAppInNewTab", false);
                        addContextMenuSeperator(menu);
                        contextMenuEditRows(menu, false, true);
                        addContextMenuSeperator(menu);
                        addContextMenuItem(menu, lcontex('Edit Shortcut'), undefined, "openShortcutEditor", false);

                    }else if (fd.ShortcutType == "folder"){
                        //Folder
                        addContextMenuItem(menu, lcontex('Open'), undefined, "openIconViaMenu", false);
                        addContextMenuItem(menu, lcontex('Open File Location'), undefined, "handleShortcutFolderOpen", false);
                        addContextMenuSeperator(menu);
                        contextMenuEditRows(menu, false, true);
                        addContextMenuSeperator(menu);
                        addContextMenuItem(menu, lcontex('Edit Shortcut'), undefined, "openShortcutEditor", false);
                        addContextMenuItem(menu, lcontex('Properties'), undefined, "openObjectProperty", false);

                    }else{
                        addContextMenuItem(menu, lcontex('Open'), undefined, "openIconViaMenu", false);
                        addContextMenuItem(menu, lcontex('Open in New Tab'), undefined, "openURLShortcutInNewTab", false);
                        addContextMenuSeperator(menu);
                        contextMenuEditRows(menu, false, true);
                        addContextMenuSeperator(menu);
                        addContextMenuItem(menu, lcontex('Edit Shortcut'), undefined, "openShortcutEditor", false);
                    }
                }else{
                    console.log("Opening context menu on unknown type: ", objectType);
                }
            }
            showMenu = true;

        } else if (clickTarget.hasClass("backgroundFrame") || ((isSafari || (isMacOS && isChrome)) && $(clickTarget).attr("id") == "selectionPanel")) {
            //Click on the background. Load background context menu.
            addContextMenuItem(menu, lcontex('New'), undefined, "newitemmenu", true);
            if (checkFileInClipboard()){
                addContextMenuItem(menu, lcontex('Paste Here'), undefined, "handlePasteOperation", false, {shortcut: menuShortcut("V")});
            }
            addContextMenuItem(menu, lcontex('Refresh'), undefined, "handleMenuRefresh", false);
            addContextMenuSeperator(menu);
            addContextMenuItem(menu, lcontex('Open File Manager'), undefined, "openfm", false);
            addContextMenuItem(menu, lcontex('Personalization'), undefined, "personalization", false);
            addContextMenuItem(menu, lcontex('Background'), undefined, "background", true);
            addContextMenuItem(menu, lcontex('Icon Size'), undefined, "listIconsize", true);
            addContextMenuSeperator(menu);
            addContextMenuItem(menu, lcontex('Toggle FullScreen'), undefined, "fullscreen", false);
            addContextMenuItem(menu, lcontex('Exit'), undefined, "logout", false);
            showMenu = true;
        }else if (clickTarget.hasClass("fwdragger") || (clickTarget.hasClass("title") && clickTarget.parent().hasClass("fwdragger"))){
            //Click on the floatWindow object
            addContextMenuItem(menu, lcontex('Open in New Tab'), undefined, "openSelectedFloatWindowInNewTab", false);
            addContextMenuItem(menu, lcontex('Refresh'), undefined, "refreshSelectedFloatWindow", false);
            addContextMenuSeperator(menu);
            addContextMenuItem(menu, lcontex('Minimize'), undefined, "minimizeSelectedFloatWindow", false);

            if ($(clickTarget).parent().hasClass("fixedsize") == false && $(clickTarget).parent().parent().hasClass("fixedsize") == false){
                //This FloatWindow is resizable
                if ($(clickTarget).parent().attr("max") !== undefined && $(clickTarget).parent().attr("max") == "true"){
                    addContextMenuItem(menu, lcontex('Restore'), undefined, "maximizeSelectedFloatWindow", false);
                }else{
                    addContextMenuItem(menu, lcontex('Maximize'), undefined, "maximizeSelectedFloatWindow", false);
                }

            }
            addContextMenuSeperator(menu);
            addContextMenuItem(menu, lcontex('Close'), undefined, "closeSelectedFloatWindow", false);
            showMenu = true;
        } else if ($(clickTarget).closest("#listMenu .launcherTile").length > 0){
            //Launcher tile: open, new tab, dock, desktop (launcher.js)
            showMenu = launcherBuildContextMenu($(clickTarget).closest(".launcherTile"));
        } else if ($(clickTarget).closest("#navimenu .dockItem").length > 0){
            //Dock item: its windows, open / pin / unpin and close (dock.js)
            dockHideWindowList();
            dockMenuItem = $(clickTarget).closest(".dockItem");
            showMenu = dockBuildContextMenu(dockMenuItem);
        }

        if (showMenu){
            //Show the menu at the pointer, kept on screen
            menu.show();
            placeContextMenu(e.clientX, e.clientY);
            if (dockMenuItem != null){
                //Dock menus open above the dock, not over it
                dockPlaceContextMenu(dockMenuItem);
            }
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
    Menu building
*/

//A keyboard shortcut as this platform writes it, e.g. Ctrl+C or the Mac command key
function menuShortcut(key){
    if (key == "Delete"){
        return isMacOS ? "⌘⌫" : "Del";
    }
    return isMacOS ? "⌘" + key : "Ctrl+" + key;
}

/*
    The editing rows of a desktop icon menu, always in this order: Cut, Copy
    (with their shortcuts), Rename, Delete (red on hover). Plain text rows:
    an icon-only toolbar was tried and dropped, names read faster.
*/
function contextMenuEditRows(menu, withClipboard, withRename){
    if (withClipboard){
        addContextMenuItem(menu, lcontex('Cut'), undefined, "handleCutOperation", false, {shortcut: menuShortcut("X")});
        addContextMenuItem(menu, lcontex('Copy'), undefined, "handleCopyOperation", false, {shortcut: menuShortcut("C")});
    }
    if (withRename){
        addContextMenuItem(menu, lcontex('Rename'), undefined, "handleRename", false);
    }
    addContextMenuItem(menu, lcontex('Delete'), undefined, "handleFileDelete", false, {shortcut: menuShortcut("Delete"), danger: true});
}

/*
    This function is used to generate menu items for context menu.
    Options example
    {
        payload: {
            //Some JSON based payload here
        },
        icon: "folder outline",     //only where an icon helps
        shortcut: "Ctrl+V",
        checked: true
    }
*/
function addContextMenuItem(target, keyword, hotkey = undefined, functionName, containSubMenu = false, options=undefined) {
    options = options || {};
    var item = $('<div class="item clickable" role="menuitem"><span class="label"></span></div>');
    item.find(".label").html(keyword);

    var payload = "";
    if (options.payload != undefined){
        payload = encodeURIComponent(JSON.stringify(options.payload));
    }
    item.attr("payload", payload);

    if (options.icon){
        item.addClass("withIcon").prepend($('<i class="menuIcon icon"></i>').addClass(options.icon));
    }else if (options.image){
        item.addClass("withIcon").prepend($('<img class="menuIcon" draggable="false">').attr("src", options.image));
    }

    if (containSubMenu) {
        item.addClass("submenu").attr({"data-fn": functionName, "onclick": "contextMenuOpenSub(this,event);"});
        item.append('<i class="menuChevron chevron right icon"></i>');
    } else {
        item.attr("onclick", functionName + "(this,event);");
        if (options.shortcut){
            item.append($('<span class="shortcut"></span>').text(options.shortcut));
        }
        var checked = options.checked === true || (typeof hotkey == "string" && hotkey.indexOf("checkmark") >= 0);
        if (checked){
            item.addClass("checked").append('<i class="menuCheck check icon"></i>');
        }
    }
    item.toggleClass("danger", options.danger === true);
    item.toggleClass("disabled", options.disabled === true);
    $(target).append(item);
    return item;
}

function getContextMenuPayload(object){
    var encodedPayload = $(object).attr("payload");
    if (encodedPayload != undefined && encodedPayload != ""){
        return JSON.parse(decodeURIComponent(encodedPayload));
    }else{
        return null;
    }
}

function addContextMenuSeperator(target) {
    $(target).append(`<div class="menuDivider"></div>`);
}

function addContextMenuTitle(target, title){
    $(target).append($('<div class="header"></div>').html(title));
}

/*
    Placement
*/

//Rows line up when only some of them carry an icon
function contextMenuRefreshLayout(menu){
    $(menu).toggleClass("withIcons", $(menu).find(".item.withIcon").length > 0);
}

//Open the menu at a point, flipping left / up when it would leave the screen
function placeContextMenu(x, y){
    var menu = $("#contextmenu");
    contextMenuRefreshLayout(menu);
    var margin = 8;
    var width = menu.outerWidth();
    var height = menu.outerHeight();
    var left = x;
    var top = y;
    if (left + width > window.innerWidth - margin){
        left = x - width;
    }
    if (top + height > window.innerHeight - margin){
        top = y - height;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    menu.css({left: left, top: top});
}

var contextMenuSubOwner = null;   //The row whose sub menu is showing
var contextMenuHoverTimer = null;
var contextMenuFocusSubPending = false; //Keyboard opened a sub menu: focus its first row once filled
var contextMenuSwallowKey = null; //A key the menu handled on keydown, whose keyup must not reach the desktop

function showSubContextMenu(target) {
    contextMenuSubOwner = $(target)[0];
    $("#contextmenu .open").removeClass("open");
    $(target).addClass("open");
    $("#subcontextmenu").show();
    placeSubContextMenu();
}

//Beside the main menu, its first row level with the row that opened it
function placeSubContextMenu(){
    var sub = $("#subcontextmenu");
    if (!sub.is(":visible") || contextMenuSubOwner == null || !document.body.contains(contextMenuSubOwner)){
        return;
    }
    contextMenuRefreshLayout(sub);
    var margin = 8;
    var mainRect = $("#contextmenu")[0].getBoundingClientRect();
    var rowRect = contextMenuSubOwner.getBoundingClientRect();
    var width = sub.outerWidth();
    var height = sub.outerHeight();
    var left = mainRect.right + 2;
    if (left + width > window.innerWidth - margin){
        //No room on the right: open on the left side of the menu
        left = mainRect.left - width - 2;
    }
    left = Math.max(margin, left);
    var top = rowRect.top - 6;
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    sub.css({left: left, top: top});
}

//Sub menus are often filled after an AJAX call: place them again once they are
new MutationObserver(function(){
    placeSubContextMenu();
    contextMenuFocusSubFirst();
}).observe(document.getElementById("subcontextmenu"), {childList: true});

//Run the builder of a sub menu row, unless its sub menu is already showing
function contextMenuOpenSub(row, event){
    clearTimeout(contextMenuHoverTimer);
    if (contextMenuSubOwner === row && $("#subcontextmenu").is(":visible")){
        return;
    }
    var builder = window[$(row).attr("data-fn")];
    if (typeof builder == "function"){
        builder(row, event);
    }
}

function contextMenuHideSub(){
    $("#subcontextmenu").hide();
    $("#contextmenu .open").removeClass("open");
    contextMenuSubOwner = null;
    contextMenuFocusSubPending = false;
}

//Close the menus only (hideAllContextMenus also closes the tray panels)
function contextMenuHideOnly(){
    clearTimeout(contextMenuHoverTimer);
    contextMenuHideSub();
    $("#contextmenu").hide();
    $("#contextmenu .hot, #subcontextmenu .hot").removeClass("hot");
    contextMenuAnchor = null;
}

/*
    A press anywhere outside the menus closes them: the desktop, the dock,
    the tray, a panel. contextMenuAnchor is the button that opened the menu
    (the launcher's power button); a press on it is left to its own click,
    which toggles the menu. A press inside a window never reaches this page:
    the window blur below closes the menus then.
*/
var contextMenuAnchor = null;
function contextMenuOutsidePress(event){
    if (!$("#contextmenu").is(":visible")){
        return;
    }
    if ($(event.target).closest("#contextmenu, #subcontextmenu").length > 0){
        return;
    }
    if (contextMenuAnchor != null && $(event.target).closest(contextMenuAnchor).length > 0){
        return;
    }
    contextMenuHideOnly();
}
document.addEventListener("mousedown", contextMenuOutsidePress, true);
document.addEventListener("touchstart", contextMenuOutsidePress, true);

/*
    Pointer
*/

function contextMenuSetHot(element){
    var menu = $(element).closest("#contextmenu, #subcontextmenu");
    menu.find(".hot").not(element).removeClass("hot");
    $(element).addClass("hot");
}

//Keyboard focus: leaving the row of the open sub menu closes that sub menu
function contextMenuKeyHot(element){
    if (element == undefined){
        return;
    }
    contextMenuSetHot(element);
    if (contextMenuSubOwner != null && element !== contextMenuSubOwner && $(element).closest("#contextmenu").length > 0){
        contextMenuHideSub();
    }
}

$("#contextmenu").on("mouseenter", ".item", function(){
    var row = this;
    contextMenuSetHot(row);
    clearTimeout(contextMenuHoverTimer);
    if ($(row).hasClass("submenu")){
        //Open a sub menu after a short rest on its row
        if (contextMenuSubOwner !== row){
            contextMenuHoverTimer = setTimeout(function(){
                if ($(row).hasClass("hot")){
                    contextMenuOpenSub(row);
                }
            }, 160);
        }
    }else if (contextMenuSubOwner != null && contextMenuSubOwner !== row){
        //Another row: close the open sub menu unless the pointer is on its way there
        contextMenuHoverTimer = setTimeout(function(){
            if ($(row).hasClass("hot")){
                contextMenuHideSub();
            }
        }, 300);
    }
});

$("#subcontextmenu").on("mouseenter", function(){
    clearTimeout(contextMenuHoverTimer);
});

$("#subcontextmenu").on("mouseenter", ".item", function(){
    contextMenuSetHot(this);
});

$("#contextmenu, #subcontextmenu").on("mouseleave", ".item", function(){
    $(this).removeClass("hot");
});

//Menus close when the desktop loses focus (a click into a window), resizes or scrolls
$(window).on("blur resize", function(){
    contextMenuHideOnly();
});
window.addEventListener("wheel", function(event){
    if ($(event.target).closest("#contextmenu, #subcontextmenu").length == 0){
        contextMenuHideOnly();
    }
}, {passive: true});

/*
    Keyboard: Up / Down move (wrapping around), Right / Enter open a sub
    menu, Left / Escape close it, Enter runs a row, Escape closes the menu.
*/

function contextMenuNavRows(menu){
    return $(menu).find(".item").not(".disabled").filter(":visible");
}

function contextMenuMove(menu, direction){
    var rows = contextMenuNavRows(menu);
    if (rows.length == 0){
        return;
    }
    var index = rows.index($(menu).find(".hot").first());
    var next;
    if (index < 0){
        next = direction > 0 ? 0 : rows.length - 1;
    }else{
        next = (index + direction + rows.length) % rows.length;
    }
    contextMenuKeyHot(rows.eq(next)[0]);
}

function contextMenuFocusSubFirst(){
    if (!contextMenuFocusSubPending){
        return;
    }
    var first = contextMenuNavRows("#subcontextmenu").first();
    if (first.length > 0){
        contextMenuSetHot(first[0]);
        contextMenuFocusSubPending = false;
    }
}

function contextMenuOpenSubFromKeyboard(row){
    contextMenuFocusSubPending = true;
    if (contextMenuSubOwner === row && $("#subcontextmenu").is(":visible")){
        contextMenuFocusSubFirst();
        return;
    }
    contextMenuOpenSub(row);
    contextMenuFocusSubFirst();
}

//Returns true when the key was used by the menu
function contextMenuHandleKey(key){
    var sub = $("#subcontextmenu");
    var inSub = sub.is(":visible") && sub.find(".hot").length > 0;
    var menu = inSub ? sub : $("#contextmenu");
    var current = menu.find(".hot").first();
    switch (key){
        case "ArrowDown":
            contextMenuMove(menu, 1);
            return true;
        case "ArrowUp":
            contextMenuMove(menu, -1);
            return true;
        case "ArrowRight":
            if (!inSub && current.hasClass("submenu")){
                contextMenuOpenSubFromKeyboard(current[0]);
            }
            return true;
        case "ArrowLeft":
            if (inSub){
                var owner = contextMenuSubOwner;
                contextMenuHideSub();
                if (owner != null){
                    contextMenuKeyHot(owner);
                }
            }
            return true;
        case "Enter":
        case " ":
            if (current.length == 0){
                return true;
            }
            if (!inSub && current.hasClass("submenu")){
                contextMenuOpenSubFromKeyboard(current[0]);
            }else{
                current[0].click();
            }
            return true;
        case "Escape":
            if (inSub){
                var subOwner = contextMenuSubOwner;
                contextMenuHideSub();
                if (subOwner != null){
                    contextMenuKeyHot(subOwner);
                }
            }else{
                hideAllContextMenus();
            }
            return true;
    }
    return false;
}

//Capture phase, so the desktop's own key bindings (input.js) never see these keys
window.addEventListener("keydown", function(event){
    if (!$("#contextmenu").is(":visible")){
        return;
    }
    if (contextMenuHandleKey(event.key)){
        event.preventDefault();
        event.stopImmediatePropagation();
        contextMenuSwallowKey = event.key;
    }
}, true);

window.addEventListener("keyup", function(event){
    if (contextMenuSwallowKey != null && event.key == contextMenuSwallowKey){
        //Enter on a menu row must not also open the selected desktop icons
        event.preventDefault();
        event.stopImmediatePropagation();
        contextMenuSwallowKey = null;
    }
}, true);

/*
    Sub menus of the desktop menu
*/

function listIconsize(target, event) {
    $("#subcontextmenu").html("");
    addContextMenuItem($("#subcontextmenu"), lcontex("Small"), undefined, "setDesktopIconSize", false, {payload: "small", checked: desktopIconSize == "small"});
    addContextMenuItem($("#subcontextmenu"), lcontex("Medium"), undefined, "setDesktopIconSize", false, {payload: "medium", checked: desktopIconSize == "medium"});
    addContextMenuItem($("#subcontextmenu"), lcontex("Big"), undefined, "setDesktopIconSize", false, {payload: "big", checked: desktopIconSize == "big"});
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

function background(target, evt) {
    $("#subcontextmenu").html('<div class="item disabled"><i class="loading spinner icon"></i><span class="label">Loading</span></div>');
    $.get("system/desktop/theme", function(data) {
        $("#subcontextmenu").html("");
        for (var i = 0; i < data.length; i++) {
            addContextMenuItem($("#subcontextmenu"), escapeNotificationText(data[i].Theme), undefined, "setTheme", false, {checked: currentUserTheme == data[i].Theme});
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

//New item menus. Every row names a kind of item, so each one has its icon
function newitemmenu(target, event) {
    $("#subcontextmenu").html("");
    addContextMenuItem($("#subcontextmenu"), lcontex('Folder'), undefined, "newfolder", false, {icon: "folder outline"});
    addContextMenuItem($("#subcontextmenu"), lcontex('Shortcut'), undefined, "newshortcut", false, {icon: "linkify"});
    addContextMenuItem($("#subcontextmenu"), lcontex('Upload'), undefined, "upload", false, {icon: "cloud upload"});
    requestCSRFToken(function(token){
        $.ajax({
            url: "system/file_system/newItem",
            data: {csrft: token},
            success: function(data){
                if (Array.isArray(data) && data.length > 0){
                    addContextMenuSeperator($("#subcontextmenu"));
                }
                for (var i = 0; i < data.length; i++) {
                    var thisNewFile = data[i];
                    var icon = ao_module_utils.getIconFromExt(thisNewFile.Ext);
                    addContextMenuItem($("#subcontextmenu"), escapeNotificationText(thisNewFile.Desc), undefined, "newitem", false, {icon: icon, payload: thisNewFile.Ext});
                }
            }
        })
    });
    showSubContextMenu(target);
}

function hideAllContextMenus() {
    contextMenuHideOnly();
    $("#quickAccessPanel").fadeOut("fast");
    $("#backgroundTaskPanel").slideUp("fast");
}
