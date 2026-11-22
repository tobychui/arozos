/*
    ArozOS Desktop - Dock and tray

    The dock at the bottom centre of the screen and the tray at the bottom
    right, which together replace the old full width taskbar.

    Dock, left to right, with a divider before every section that shows:

        launcher | open apps .......... | pinned | trash

    The dock is at least half the screen wide; a spacer keeps the launcher
    and open apps at its left end and the pinned items and trash at its right.

    An app item stands for one group of windows: the windows of one module
    (matched by URL, see dockModuleForURL), of one container app, or, for
    windows that belong to neither, the grouping the old taskbar used
    (dockLegacyGroup). A pinned item keeps its place and shows dots while it
    has windows; an item that is not pinned leaves the dock with its last
    window. Pins are a per user desktop preference ("dock-pinned"): module
    names, plus folders, web links and container apps (see dockPinKey), which
    can be dropped onto the dock from the desktop or a File Manager window.

    Item attributes and state classes:
        group          "module:<name>", "app:<slug>", "folder:<path>",
                       "url:<url>" or the legacy group string
        module         the module name, "" for windows of no module
        windowIDGroup  URI encoded JSON list of the window ids it holds
        .running       at least one window (one dot)
        .multi         two or more windows (two dots)
        .active        holds the focused, visible window (accent pill)
        .pinned        sits in the pinned section

    windows.js reaches the dock only through dockAddWindow,
    dockRemoveWindow, dockUpdateFocus and dockWindowTitleChanged.

    Tray: background tasks, the user avatar (quick access panel) and the
    clock (notification and calendar panel).

    Part of desktop.html, see README.md in this folder for the load order.
*/

var DOCK_PINNED_PREF = "dock-pinned";
var DOCK_DEFAULT_PINNED = []; //File Manager and System Setting sit in the launcher footer instead
var DOCK_ICON_MAX = 36; //--dt-dock-icon of the chosen size, read back by setStartMenuLayout
var DOCK_ICON_MIN = 30;
var DOCK_TRASH_EMPTY = "img/desktop/dock/trash_empty.svg";
var DOCK_TRASH_FULL = "img/desktop/dock/trash_full.svg";
var DOCK_TRASH_PATH = "%trashbin%";
var DOCK_FALLBACK_ICON = "img/system/service.png";

var dockPinnedModules = null; //Pinned module names, null until the preference is loaded
var dockModulesReady = false; //moduleInstalled has been loaded
var dockTrashTimer = null;

/*
    Clock
*/

//Keep the clock updated
setInterval(function(){
    updateClockTime();
},5000);
updateClockTime();
function updateClockTime(){
    var d = new Date();
    var hours = d.getHours();
    var ampm = hours >= 12 ? "PM" : "AM";
    var displayHour = hours % 12;
    if (displayHour == 0){
        displayHour = 12;
    }
    var display = `<div class="time">${zeropad(displayHour,2)}:${zeropad(d.getMinutes(),2)} ${ampm}</div>
        <div class="date">${d.getDate()} ${monthNames[d.getMonth()].substr(0, 3)} ${d.getFullYear()}</div>`;

    if ($(".notification.object").length > 0){
        //Unread notifications: a dot on the clock
        display += `<span class="trayBadge"></span>`;
    }
    $(".clock").html(display);
    var largedate = monthNames[d.getMonth()] + " " + d.getDate() + " " + d.getFullYear()
    $("#largedate").text(largedate);
    var dow = daysNames[d.getDay()];
    $("#dayofweek").text(dow);
}

/*
    Layout
*/

//Height kept free at the bottom of the screen for the dock, in px
function getReservedBottom(){
    var value = parseFloat(getComputedStyle(document.body).getPropertyValue("--dt-reserved-bottom"));
    return isNaN(value) ? 62 : value;
}

//Show a section, and the divider in front of it, only when it holds something
function dockRefreshLayout(){
    var hasRunning = $("#dockRunning .dockItem.appItem").length > 0;
    var hasPinned = $("#dockPinned .dockItem").length > 0;
    var hasTrash = !$("#dockTrashSection").hasClass("unavailable");
    $("#dockRunning, #dockDividerRunning").toggle(hasRunning);
    $("#dockPinned, #dockDividerPinned").toggle(hasPinned);
    $("#dockTrashSection, #dockDividerTrash").toggle(hasTrash);
    resizeAllFloatWindowButtons();
}

/*
    Fit the dock next to the tray. It is at least half the screen wide, the
    spacer pushing pinned apps and the trash to its right end, and sits in
    the middle of the screen while it clears the tray there. When its icons
    do not fit there, it moves into the space left of the tray, then its
    icons shrink down to DOCK_ICON_MIN, and the open apps that still do not
    fit move into the "more" item at the end of the open apps section.
    (Named after the old taskbar function, which other code still calls.)
*/
function resizeAllFloatWindowButtons() {
    var dock = document.getElementById("navimenu");
    if (dock == null){
        return;
    }
    dock.style.removeProperty("--dt-dock-icon");
    dock.style.removeProperty("left");
    dock.classList.remove("offCentre");
    $("#dockRunning .dockItem.overflowed").removeClass("overflowed");
    $("#dockMore").removeClass("shown");
    //Measure what the icons themselves need, without the minimum width
    dock.style.minWidth = "0px";

    var gap = 12;
    var trayWidth = $("#dockTray").outerWidth() || 0;
    var half = Math.round(window.innerWidth / 2);
    var alignLeft = document.body.classList.contains("dockAlignLeft");
    var middleRoom = window.innerWidth - 2 * (trayWidth + gap * 2);
    if (!alignLeft && dock.offsetWidth <= middleRoom){
        //Fits in the middle without touching the tray
        dock.style.minWidth = Math.max(0, Math.min(half, middleRoom)) + "px";
        return;
    }

    var room = window.innerWidth - trayWidth - gap * 3;
    var size = DOCK_ICON_MAX;
    var minSize = Math.min(DOCK_ICON_MIN, DOCK_ICON_MAX - 6);
    while (dock.offsetWidth > room && size > minSize){
        size -= 2;
        dock.style.setProperty("--dt-dock-icon", size + "px");
    }
    if (dock.offsetWidth > room){
        $("#dockMore").addClass("shown");
        var items = $("#dockRunning .dockItem.appItem").get();
        for (var i = items.length - 1; i >= 0 && dock.offsetWidth > room; i--){
            $(items[i]).addClass("overflowed");
        }
    }

    dock.style.minWidth = Math.max(0, Math.min(half, room)) + "px";
    if (alignLeft){
        //Already at the left edge (dock.css)
        return;
    }
    //Centre it in the space left of the tray
    var left = Math.max(gap, (window.innerWidth - trayWidth - gap * 2 - dock.offsetWidth) / 2);
    dock.classList.add("offCentre");
    dock.style.left = left + "px";
}

/*
    Window groups
*/

//Page path relative to the desktop, without hash or query, e.g. "Photo/index.html"
function dockCleanPath(url){
    if (url == undefined || url == null || url === ""){
        return "";
    }
    var path = String(url).split("#")[0].split("?")[0];
    try {
        var parsed = new URL(path, window.location.href);
        if (parsed.origin != window.location.origin){
            return "";
        }
        var base = new URL(".", window.location.href).pathname;
        path = parsed.pathname;
        if (path.indexOf(base) == 0){
            path = path.substring(base.length);
        }
    } catch (ex) {
        return "";
    }
    return path.replace(/^\/+/, "");
}

/*
    The module a window belongs to, "" if none. A page that is one of a
    module's start pages wins; otherwise the module whose folder holds the
    page, the deepest folder first. The shared SystemAO folder itself claims
    nothing, only its sub folders do (SystemAO/file_system is File Manager).
*/
function dockModuleForURL(url){
    var path = dockCleanPath(url);
    if (path == "" || !Array.isArray(moduleInstalled)){
        return "";
    }
    var dir = path.substring(0, path.lastIndexOf("/"));
    var best = "";
    var bestScore = -1;
    moduleInstalled.forEach(function(mod){
        [mod.StartDir, mod.LaunchFWDir, mod.LaunchEmb].forEach(function(entry){
            var entryPath = dockCleanPath(entry);
            if (entryPath == ""){
                return;
            }
            var score = -1;
            if (entryPath == path){
                score = 100000;
            }else{
                var entryDir = entryPath.substring(0, entryPath.lastIndexOf("/"));
                if (entryDir == "" || entryDir == "SystemAO"){
                    return;
                }
                if (dir == entryDir || dir.indexOf(entryDir + "/") == 0){
                    score = entryDir.length;
                }
            }
            if (score > bestScore){
                bestScore = score;
                best = mod.Name;
            }
        });
    });
    return best;
}

//The grouping of the old taskbar, for windows that belong to no module
function dockLegacyGroup(url, uuid){
    var groupInfo = String(url).split("/");
    var group = groupInfo.length == 1 ? groupInfo[0] : groupInfo.slice(0, -1).join("/");

    //File system windows and utilities group by their page
    if (url.includes("SystemAO/file_system/")){
        group = url.split("/").pop().split(".").join("_");
    }else if (url.includes("SystemAO/utilities/")){
        group = url.split("/").pop().split(".").join("_");
        if (group.includes("#")){
            group = group.split("#")[0];
        }
    }

    //Other SystemAO windows are never grouped
    if (group.split("/").shift() == "SystemAO"){
        group = group + "#" + uuid;
    }
    return group;
}

function dockWindowIDs(item){
    var raw = $(item).attr("windowIDGroup");
    if (raw == undefined || raw == ""){
        return [];
    }
    try {
        return JSON.parse(decodeURIComponent(raw)).map(String);
    } catch (ex) {
        return [];
    }
}

function dockSetWindowIDs(item, list){
    $(item).attr("windowIDGroup", encodeURIComponent(JSON.stringify(list)));
    $(item).toggleClass("running", list.length > 0);
    $(item).toggleClass("multi", list.length > 1);
}

function dockFindItem(group){
    return $("#navimenu .dockItem.appItem").filter(function(){
        return $(this).attr("group") === group;
    }).first();
}

function dockCreateItem(group, moduleName, icon, label){
    var item = $('<div class="dockItem appItem appearing"><img class="dockIcon" draggable="false"></div>');
    item.attr({
        "group": group,
        "module": moduleName,
        "data-label": label
    });
    dockSetWindowIDs(item, []);
    item.find("img").attr("src", icon).one("error", function(){
        $(this).attr("src", DOCK_FALLBACK_ICON);
    });
    item.one("animationend", function(){
        item.removeClass("appearing");
    });
    return item;
}

function dockModuleIcon(moduleName, fallback){
    var mod = getModuleInfoFromName(moduleName);
    if (mod && mod.IconPath != undefined && mod.IconPath != ""){
        return mod.IconPath;
    }
    return fallback || DOCK_FALLBACK_ICON;
}

//The slug of a container app window (/app/<slug>/...), "" for other windows
function dockContainerAppSlug(url){
    try {
        var target = new URL(url, window.location.href);
        var match = /^\/app\/([^\/]+)/.exec(target.pathname);
        if (target.origin == window.location.origin && match){
            return decodeURIComponent(match[1]);
        }
    } catch (ex) {}
    return "";
}

//A new float window opened (called by newFloatWindow)
function dockAddWindow(uuid, url, icon, title){
    uuid = String(uuid);
    var moduleName = dockModuleForURL(url);
    var appSlug = moduleName == "" ? dockContainerAppSlug(url) : "";
    var group;
    if (moduleName != ""){
        group = "module:" + moduleName;
    }else if (appSlug != ""){
        //Container app windows group by app, and join the app's pinned icon
        group = "app:" + appSlug;
    }else if (dockFindItem("url:" + url).length > 0){
        //The window of a pinned web link
        group = "url:" + url;
    }else{
        group = dockLegacyGroup(url, uuid);
    }
    var item = dockFindItem(group);
    if (item.length == 0){
        var itemIcon = moduleName != "" ? dockModuleIcon(moduleName, icon) : icon;
        item = dockCreateItem(group, moduleName, itemIcon, moduleName != "" ? moduleName : title);
        item.insertBefore("#dockMore");
    }
    dockSetWindowIDs(item, dockWindowIDs(item).concat([uuid]));
    //newFloatWindow focused the window before it was on the dock
    dockUpdateFocus();
    dockRefreshLayout();
}

//A float window closed (called by closeFwProcess)
function dockRemoveWindow(windowID){
    windowID = String(windowID);
    var item = findFloatWindowButtonWithID(windowID);
    if (item == undefined){
        return;
    }
    var remaining = dockWindowIDs(item).filter(function(id){
        return id != windowID;
    });
    dockSetWindowIDs(item, remaining);
    if (remaining.length == 0 && !item.hasClass("pinned")){
        item.remove();
    }
    dockUpdateFocus();
    dockRefreshLayout();
}

//A window changed its title: items of no module are labelled by their first window
function dockWindowTitleChanged(windowID){
    var item = findFloatWindowButtonWithID(String(windowID));
    if (item == undefined || item.attr("module") != "" || item.hasClass("pinned")){
        return;
    }
    var ids = dockWindowIDs(item);
    if (ids.length > 0){
        item.attr("data-label", getFloatWindowTitleByID(ids[0]));
    }
}

//Mark the item holding the focused window, if that window is on screen
function dockUpdateFocus(){
    $("#navimenu .dockItem.active").removeClass("active");
    if (focusedWindow == undefined || $(focusedWindow).length == 0){
        return;
    }
    var fw = $(focusedWindow)[0];
    if (!document.body.contains(fw) || $(fw).css("display") == "none"){
        return;
    }
    var item = findFloatWindowButtonWithID(String($(fw).attr("windowId")));
    if (item != undefined){
        item.addClass("active");
    }
}

//The dock item holding a window, or undefined
function findFloatWindowButtonWithID(windowID) {
    var found = undefined;
    $("#navimenu .dockItem.appItem").each(function() {
        if (dockWindowIDs(this).includes(String(windowID))) {
            found = $(this);
            return false;
        }
    });
    return found;
}

//Close every window of a dock item
function closeWindowGroup(groupName){
    var item = dockFindItem(groupName);
    dockWindowIDs(item).forEach(function(fwid){
        closeFloatWindowViaID(fwid);
    });
}

/*
    Window list (several windows behind one item, or the "more" item)
*/

function dockHideWindowList(){
    $("#stackedWindowList").hide().removeAttr("anchor");
    $("#navimenu .dockItem.listOpen").removeClass("listOpen");
    stackedFloatWindowListShown = false;
}

function dockShowWindowList(anchor, windowIDs){
    var list = $("#stackedWindowList");
    list.empty();
    var focusedID = (focusedWindow != undefined) ? String($(focusedWindow).attr("windowId")) : "";
    windowIDs.forEach(function(id){
        var row = $('<div class="stackedWindowButton" onclick="bringFloatWindowToFrontByFWB(this,event);" ontouchstart="bringFloatWindowToFrontByFWB(this,event);">' +
            '<img draggable="false"><span class="title"></span>' +
            '<div class="closebtn" onclick="closeFWviaFWB(this,event);"><i class="close icon"></i></div></div>');
        row.attr("windowId", id);
        row.find("img").attr("src", getFloatWindowIconByID(id));
        row.find(".title").text(getFloatWindowTitleByID(id));
        var fw = getFloatWindowByID(id);
        if (fw == undefined || $(fw).css("display") == "none"){
            row.addClass("minimized");
        }else if (id == focusedID){
            row.addClass("focused");
        }
        list.append(row);
    });

    $("#navimenu .dockItem.listOpen").removeClass("listOpen");
    $(anchor).addClass("listOpen");
    list.attr("anchor", $(anchor).attr("group") || $(anchor).attr("id"));
    list.show();
    var center = $(anchor).offset().left + $(anchor).outerWidth() / 2;
    var left = center - list.outerWidth() / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - list.outerWidth() - 8));
    list.css("left", left);
    stackedFloatWindowListShown = true;
}

//Handle focus through a row of the window list
function bringFloatWindowToFrontByFWB(object, event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    var targetWFID = $(object).attr("windowId");
    var targetFW = getFloatWindowByID(targetWFID);
    if (targetFW == undefined){
        //fw not found
        return;
    }
    $(targetFW).fadeIn(100);
    MoveFloatWindowToTop(targetFW);
    dockUpdateFocus();
    dockHideWindowList();
}

//Close a window through the close button of its row in the window list
function closeFWviaFWB(object, event=null) {
    if (event != null){
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    var targetWFID = $(object).parent().attr("windowId");
    var targetFW = getFloatWindowByID(targetWFID);
    if (targetFW == undefined){
        //fw not found
        return;
    }
    closeFloatWindow(targetFW.find(".close"), event);
    $(object).parent().remove();
    if ($("#stackedWindowList").find(".stackedWindowButton").length == 0) {
        //No window left in the list. Close it as well.
        dockHideWindowList();
    }
}

/*
    Clicks
*/

$("#navimenu").on("click touchstart", ".dockItem", function(event){
    event.preventDefault();
    event.stopImmediatePropagation();
    dockItemClicked($(this));
});

function dockItemClicked(item){
    hideAllContextMenus();
    var role = item.attr("data-role");
    if (role == "launcher"){
        dockHideWindowList();
        toggleListMenu();
        return;
    }
    hideListMenu();

    if (role == "trash"){
        dockHideWindowList();
        dockOpenTrash();
        return;
    }

    //A second click on the item whose list is open closes the list
    var anchorKey = item.attr("group") || item.attr("id");
    if (stackedFloatWindowListShown && $("#stackedWindowList").attr("anchor") == anchorKey){
        dockHideWindowList();
        return;
    }

    if (role == "more"){
        var hiddenWindows = [];
        $("#dockRunning .dockItem.overflowed").each(function(){
            hiddenWindows = hiddenWindows.concat(dockWindowIDs(this));
        });
        dockShowWindowList(item, hiddenWindows);
        return;
    }

    var ids = dockWindowIDs(item);
    if (ids.length == 0){
        //A pinned app, folder or link without a window: open it
        dockHideWindowList();
        if (item.attr("module")){
            openModule(item.attr("module"));
        }else{
            var pin = dockFindPin(item.attr("group"));
            if (pin != undefined){
                dockOpenPin(pin);
            }
        }
        return;
    }

    if (ids.length > 1){
        dockShowWindowList(item, ids);
        return;
    }

    //One window: bring it to the front, or minimize it when it already is
    dockHideWindowList();
    var targetFW = getFloatWindowByID(ids[0]);
    if (targetFW == undefined){
        return;
    }
    if (FloatWindowIsTopped(targetFW) && $(targetFW).css("display") != "none"){
        $(targetFW).fadeOut(100, dockUpdateFocus);
    }else{
        $(targetFW).fadeIn(100);
        MoveFloatWindowToTop(targetFW);
        dockUpdateFocus();
    }
    if (checkIfFloatWindowOutsideWindowArea(targetFW)){
        resetFloatWindowPosition(targetFW);
    }
}

/*
    Pinned apps, folders and links

    The preference is a list. A string is a module name (the original
    format, and still what most entries are); an object pins something else:
        {type: "folder", path, name, icon}          opens in the File Manager
        {type: "url", url, name, icon, openIn, ...}  a web link shortcut
        {type: "app", slug, name, icon}             a container app
    The dock item of an entry has the group returned by dockPinKey.
*/

function dockPinKey(pin){
    if (typeof pin == "string"){
        return pin != "" ? "module:" + pin : "";
    }
    if (pin == null || typeof pin != "object"){
        return "";
    }
    if (pin.type == "folder" && pin.path){
        return "folder:" + pin.path;
    }
    if (pin.type == "url" && pin.url){
        return "url:" + pin.url;
    }
    if (pin.type == "app" && pin.slug){
        return "app:" + pin.slug;
    }
    return "";
}

function dockFindPin(key){
    if (!Array.isArray(dockPinnedModules)){
        return undefined;
    }
    return dockPinnedModules.find(function(pin){
        return dockPinKey(pin) == key;
    });
}

function dockPinIcon(pin){
    if (pin.icon){
        return pin.icon;
    }
    if (pin.type == "folder"){
        return "img/desktop/system_icon/folder.svg";
    }
    if (pin.type == "app"){
        return "ContainerApps/img/app.svg";
    }
    return DOCK_FALLBACK_ICON;
}

function dockOpenPin(pin){
    if (typeof pin == "string"){
        openModule(pin);
    }else if (pin.type == "folder"){
        openFolder(pin.path);
    }else if (pin.type == "url"){
        openURLShortcut({
            ShortcutPath: pin.url,
            ShortcutName: pin.name,
            ShortcutImage: pin.icon,
            ShortcutOpenIn: pin.openIn,
            ShortcutTitle: pin.title,
            ShortcutWidth: pin.width,
            ShortcutHeight: pin.height
        });
    }else if (pin.type == "app"){
        openContainerAppShortcut({ShortcutName: pin.name, ShortcutPath: pin.slug, ShortcutImage: pin.icon});
    }
}

function dockLoadPinned(){
    getStorage(DOCK_PINNED_PREF, function(data){
        var list = null;
        if (typeof data == "string" && data != ""){
            try {
                list = JSON.parse(data);
            } catch (ex) {
                list = null;
            }
        }
        if (!Array.isArray(list)){
            //Nothing saved yet: the default pinned apps
            list = DOCK_DEFAULT_PINNED.slice();
        }
        dockPinnedModules = list.filter(function(pin){
            return dockPinKey(pin) != "";
        });
        dockRenderPinned();
    });
}

//moduleInstalled is ready (called by initModuleList)
function dockModulesLoaded(){
    dockModulesReady = true;
    dockRenderPinned();
}

/*
    Put the pinned section in the order of the preference. Modules the user
    cannot open (removed, or no permission) are skipped but stay in the
    preference, so they come back if access returns.
*/
function dockRenderPinned(){
    if (!dockModulesReady || dockPinnedModules == null){
        return;
    }
    var wanted = dockPinnedModules.filter(function(pin){
        if (typeof pin == "string"){
            var mod = getModuleInfoFromName(pin);
            return mod && isLaunchableModule(mod);
        }
        return dockPinKey(pin) != "";
    });
    var wantedKeys = wanted.map(dockPinKey);

    $("#dockPinned .dockItem").each(function(){
        if (wantedKeys.indexOf($(this).attr("group")) < 0){
            $(this).removeClass("pinned");
            if (dockWindowIDs(this).length > 0){
                $(this).insertBefore("#dockMore");
            }else{
                $(this).remove();
            }
        }
    });

    wanted.forEach(function(pin){
        var group = dockPinKey(pin);
        var item = dockFindItem(group);
        if (item.length == 0){
            if (typeof pin == "string"){
                item = dockCreateItem(group, pin, dockModuleIcon(pin), pin);
            }else{
                item = dockCreateItem(group, "", dockPinIcon(pin), pin.name || "");
            }
        }
        item.addClass("pinned");
        $("#dockPinned").append(item);
    });

    //The trash opens in the File Manager
    $("#dockTrashSection").toggleClass("unavailable", !getModuleInfoFromName("File Manager"));
    dockUpdateFocus();
    dockRefreshLayout();
}

function dockSavePinned(){
    setStorage(DOCK_PINNED_PREF, JSON.stringify(dockPinnedModules));
}

//Pin a module (by name), folder, link or container app; see dockPinKey
function dockPin(pin){
    var key = dockPinKey(pin);
    if (key == ""){
        return;
    }
    if (typeof pin == "string"){
        var mod = getModuleInfoFromName(pin);
        if (!mod || !isLaunchableModule(mod)){
            return;
        }
    }
    if (dockPinnedModules == null){
        dockPinnedModules = DOCK_DEFAULT_PINNED.slice();
    }
    if (dockFindPin(key) == undefined){
        dockPinnedModules.push(pin);
        dockSavePinned();
    }
    dockRenderPinned();
}

function dockUnpinKey(key){
    if (dockPinnedModules == null){
        return;
    }
    dockPinnedModules = dockPinnedModules.filter(function(pin){
        return dockPinKey(pin) != key;
    });
    dockSavePinned();
    dockRenderPinned();
}

function dockPinModule(name){
    dockPin(name);
}

function dockUnpinModule(name){
    dockUnpinKey("module:" + name);
}

/*
    Pins from things dropped on the dock: folders and shortcuts from the
    desktop, folders from a File Manager window. Files are not pinned.
*/
function dockPinFromDesktopIcon(icon){
    var fd;
    try {
        fd = JSON.parse(decodeURIComponent($(icon).attr("filedata")));
    } catch (ex) {
        return null;
    }
    var image = $(icon).find(".launchIconImage").attr("src");
    var type = $(icon).attr("type");
    if (type == "folder"){
        return {type: "folder", path: fd.Filepath, name: fd.Filename, icon: image};
    }
    if (type != "shortcut"){
        return null;
    }
    var target = fd.ShortcutPath;
    if (fd.ShortcutType == "module"){
        //A shortcut of the old Trash Bin app: the trash already has its own place on the dock
        return target == "Trash Bin" ? null : target;
    }else if (fd.ShortcutType == "folder"){
        var special = getSpecialPathInfo(target);
        if (special != null && special.recycleOnDrop){
            //The trash already has its own place on the dock
            return null;
        }
        return {type: "folder", path: target, name: fd.ShortcutName, icon: image};
    }else if (fd.ShortcutType == "url"){
        return {type: "url", url: target, name: fd.ShortcutName, icon: image, openIn: fd.ShortcutOpenIn,
            title: fd.ShortcutTitle, width: fd.ShortcutWidth, height: fd.ShortcutHeight};
    }else if (fd.ShortcutType == "app"){
        return {type: "app", slug: target, name: fd.ShortcutName, icon: image};
    }
    return null;
}

//A path dragged from a File Manager window: pinned when the server says it is a folder
function dockPinFolderPath(path, name){
    $.ajax({
        url: "system/file_system/getProperties",
        method: "POST",
        data: {path: path},
        success: function(data){
            if (data && data.error === undefined && data.IsDirectory === true){
                var folderName = name || String(path).split("/").filter(function(part){ return part != ""; }).pop() || path;
                dockPin({type: "folder", path: path, name: folderName, icon: "img/desktop/system_icon/folder.svg"});
            }
        }
    });
}

function dockPinDropped(dt){
    var list = [];
    try {
        list = JSON.parse(dt.getData("filedata") || "[]");
    } catch (ex) {
        list = [];
    }
    if (!Array.isArray(list) || list.length == 0){
        var single = dt.getData("filepath");
        list = single ? [{filepath: single, filename: dt.getData("filename")}] : [];
    }
    var fromDesktop = dt.getData("desktopflag") == "true";
    list.forEach(function(entry){
        if (!entry || !entry.filepath){
            return;
        }
        var icon = fromDesktop ? $(".launchIcon").filter(function(){
            return $(this).attr("filepath") === entry.filepath;
        }).first() : $();
        if (icon.length > 0){
            var pin = dockPinFromDesktopIcon(icon);
            if (pin != null){
                dockPin(pin);
            }
            return;
        }
        dockPinFolderPath(entry.filepath, entry.filename);
    });
}

/*
    Trash
*/

function dockOpenTrash(){
    openFolder(DOCK_TRASH_PATH);
}

function dockSetTrashFull(full){
    $("#dockTrash").toggleClass("full", full);
    $("#dockTrash img").attr("src", full ? DOCK_TRASH_FULL : DOCK_TRASH_EMPTY);
    //An open trash menu follows: nothing to empty, nothing to click
    $("#contextmenu .item.emptyTrash").toggleClass("disabled", !full);
}

//Delete everything in the trash for good (the user confirmed it in the trash menu)
function dockEmptyTrash(){
    $.get("system/file_system/clearTrash", function(data){
        if (data && data.error !== undefined){
            ssAlert({title: lcontex("Empty Trash Bin"), text: data.error});
        }
        dockRefreshTrash();
    }).fail(function(){
        dockRefreshTrash();
    });
}

/*
    Ask before emptying the trash inside the trash menu itself, instead of a
    dialog in the middle of the screen: the confirm row opens right where the
    pointer already is. The menu stays anchored above the trash icon.
    fromKeyboard puts the keyboard focus on Cancel, the safe choice.
*/
var dockEmptyTrashAskedAt = 0;
function dockShowEmptyTrashConfirm(fromKeyboard){
    var menu = $("#contextmenu");
    dockEmptyTrashAskedAt = Date.now();
    contextMenuHideSub();
    menu.empty();
    var ask = $('<div class="menuConfirm"></div>');
    ask.append($('<div class="menuConfirmTitle"></div>').text(applocale.getString("dock/emptyTrash/title", "Empty the trash bin?")));
    ask.append($('<div class="menuConfirmText"></div>').text(applocale.getString("dock/emptyTrash/text", "Everything in the trash bin is deleted permanently. This cannot be undone.")));
    menu.append(ask);
    addContextMenuSeperator(menu);
    var cancel = addContextMenuItem(menu, escapeNotificationText(applocale.getString("dock/emptyTrash/cancel", "Cancel")), undefined, "dockMenuCancelEmptyTrash", false);
    addContextMenuItem(menu, lcontex("Empty Trash Bin"), undefined, "dockMenuConfirmEmptyTrash", false, {
        danger: true,
        disabled: !$("#dockTrash").hasClass("full")
    }).addClass("emptyTrash");
    contextMenuRefreshLayout(menu);
    dockPlaceContextMenu($("#dockTrash"));
    if (fromKeyboard){
        contextMenuSetHot(cancel[0]);
    }
}

/*
    Pick the empty or full trash icon. trashState stops at the first trashed
    item; a server without it (built before the dock) gets asked for the full
    listing instead, so the icon is never stuck on empty.
*/
function dockRefreshTrash(){
    $.get("system/file_system/trashState").done(function(data){
        if (data != undefined && typeof data.HasItems == "boolean"){
            dockSetTrashFull(data.HasItems);
        }else{
            dockRefreshTrashFromListing();
        }
    }).fail(dockRefreshTrashFromListing);
}

function dockRefreshTrashFromListing(){
    $.get("system/file_system/listTrash").done(function(data){
        dockSetTrashFull(Array.isArray(data) && data.length > 0);
    });
}

/*
    Files trashed in a window (File Manager, the trash view) do not tell the
    desktop. Check again when the pointer comes back to the desktop from a
    window, at most every few seconds; the minute timer catches the rest.
*/
var dockTrashLastCheck = 0;
$(window).on("focus", function(){
    var now = Date.now();
    if (now - dockTrashLastCheck > 5000){
        dockTrashLastCheck = now;
        dockRefreshTrash();
    }
});

/*
    Drag and drop: launcher entries, desktop folders and shortcuts, and
    folders from a File Manager window dropped on the dock are pinned;
    desktop icons dropped on the trash are moved to the trash
*/

$("#navimenu").on("dragover", function(event){
    event.preventDefault();
    var target = $(event.target).closest(".dockItem");
    $("#navimenu .dockItem.dropTarget").not(target).removeClass("dropTarget");
    if (target.attr("data-role") == "trash"){
        target.addClass("dropTarget");
    }
    $("#navimenu").addClass("dragOver");
});

$("#navimenu").on("dragleave", function(event){
    if ($(event.originalEvent.relatedTarget).closest("#navimenu").length == 0){
        $("#navimenu").removeClass("dragOver");
        $("#navimenu .dropTarget").removeClass("dropTarget");
    }
});

$("#navimenu").on("drop", function(event){
    event.preventDefault();
    event.stopPropagation();
    $("#navimenu").removeClass("dragOver");
    $("#navimenu .dropTarget").removeClass("dropTarget");
    var dt = event.originalEvent.dataTransfer;
    if (dt == undefined){
        return;
    }
    if (dt.getData("moduledragtype") == "module"){
        var name = dt.getData("modulename");
        if (name != ""){
            dockPinModule(name);
        }
        hideListMenu();
        return;
    }
    var target = $(event.target).closest(".dockItem");
    if (target.attr("data-role") == "trash"){
        if (dt.getData("desktopflag") == "true"){
            recycleDroppedFiles(collectDropSources(dt.getData("filepath")));
        }
        return;
    }
    dockPinDropped(dt);
});

/*
    Context menu of a dock item (called by the desktop context menu handler).
    Returns false when the item has no menu.
*/
function dockBuildContextMenu(item){
    var menu = $("#contextmenu");
    var role = item.attr("data-role");
    if (role == "trash"){
        addContextMenuItem(menu, lcontex("Open"), undefined, "dockMenuOpenTrash", false);
        addContextMenuSeperator(menu);
        addContextMenuItem(menu, lcontex("Empty Trash Bin"), undefined, "dockMenuEmptyTrash", false, {
            danger: true,
            disabled: !item.hasClass("full")
        }).addClass("emptyTrash");
        //The icon may be a minute behind: check, the row follows (dockSetTrashFull)
        dockRefreshTrash();
        return true;
    }
    if (role != undefined){
        return false;
    }

    var moduleName = item.attr("module") || "";
    var ids = dockWindowIDs(item);
    ids.forEach(function(id){
        addContextMenuItem(menu, escapeNotificationText(getFloatWindowTitleByID(id)), undefined, "dockMenuFocusWindow", false, {payload: id});
    });

    var mod = moduleName != "" ? getModuleInfoFromName(moduleName) : false;
    if (mod && isLaunchableModule(mod)){
        if (ids.length > 0){
            addContextMenuSeperator(menu);
        }
        addContextMenuItem(menu, lcontex(ids.length > 0 ? "New Window" : "Open"), undefined, "dockMenuNewWindow", false, {payload: moduleName});
        if (item.hasClass("pinned")){
            addContextMenuItem(menu, lcontex("Remove from Dock"), undefined, "dockMenuUnpin", false, {payload: moduleName});
        }else{
            addContextMenuItem(menu, lcontex("Keep in Dock"), undefined, "dockMenuPin", false, {payload: moduleName});
        }
    }

    var group = item.attr("group") || "";
    if (moduleName == ""){
        if (item.hasClass("pinned")){
            //A pinned folder, link or container app
            if (ids.length > 0){
                addContextMenuSeperator(menu);
            }
            addContextMenuItem(menu, lcontex(ids.length > 0 ? "New Window" : "Open"), undefined, "dockMenuOpenPin", false, {payload: group});
            addContextMenuItem(menu, lcontex("Remove from Dock"), undefined, "dockMenuUnpinKey", false, {payload: group});
        }else if (group.indexOf("app:") == 0){
            //An open container app can be kept in the dock
            if (ids.length > 0){
                addContextMenuSeperator(menu);
            }
            addContextMenuItem(menu, lcontex("Keep in Dock"), undefined, "dockMenuPinApp", false, {payload: {
                type: "app",
                slug: group.substring(4),
                name: item.attr("data-label") || "",
                icon: item.find("img").attr("src")
            }});
        }
    }

    if (ids.length > 0){
        addContextMenuSeperator(menu);
        addContextMenuItem(menu, lcontex(ids.length > 1 ? "Close All" : "Close"), undefined, "dockMenuCloseGroup", false, {payload: group});
    }
    return true;
}

function dockMenuOpenPin(target, event){
    var pin = dockFindPin(getContextMenuPayload(target));
    hideAllContextMenus();
    if (pin != undefined){
        dockOpenPin(pin);
    }
}

function dockMenuUnpinKey(target, event){
    dockUnpinKey(getContextMenuPayload(target));
    hideAllContextMenus();
}

function dockMenuPinApp(target, event){
    dockPin(getContextMenuPayload(target));
    hideAllContextMenus();
}

//Put the open context menu above a dock item, centred on it
function dockPlaceContextMenu(item){
    var menu = $("#contextmenu");
    //Measure away from the screen edge: there wrapping text makes the menu taller
    menu.css({left: 0, top: 0});
    var itemRect = $(item)[0].getBoundingClientRect();
    var dockTop = $("#navimenu")[0].getBoundingClientRect().top;
    var left = itemRect.left + itemRect.width / 2 - menu.outerWidth() / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - menu.outerWidth() - 8));
    menu.css({
        left: left,
        top: Math.max(8, dockTop - menu.outerHeight() - 8)
    });
}

function dockMenuFocusWindow(target, event){
    var fw = getFloatWindowByID(getContextMenuPayload(target));
    if (fw != undefined){
        $(fw).fadeIn(100);
        MoveFloatWindowToTop(fw);
        dockUpdateFocus();
    }
    hideAllContextMenus();
}

function dockMenuNewWindow(target, event){
    openModule(getContextMenuPayload(target));
    hideAllContextMenus();
}

function dockMenuPin(target, event){
    dockPinModule(getContextMenuPayload(target));
    hideAllContextMenus();
}

function dockMenuUnpin(target, event){
    dockUnpinModule(getContextMenuPayload(target));
    hideAllContextMenus();
}

function dockMenuCloseGroup(target, event){
    closeWindowGroup(getContextMenuPayload(target));
    hideAllContextMenus();
}

function dockMenuOpenTrash(target, event){
    dockOpenTrash();
    hideAllContextMenus();
}

function dockMenuEmptyTrash(target, event){
    //A click carries a pointer position, Enter on the row does not
    var fromKeyboard = event == undefined || event.detail === 0;
    dockShowEmptyTrashConfirm(fromKeyboard);
}

function dockMenuConfirmEmptyTrash(target, event){
    //The confirm row opens under the pointer: the second click of a double
    //click on Empty Trash Bin must not answer the question
    if ((event && event.detail > 1) || Date.now() - dockEmptyTrashAskedAt < 400){
        return;
    }
    hideAllContextMenus();
    dockEmptyTrash();
}

function dockMenuCancelEmptyTrash(target, event){
    hideAllContextMenus();
}

/*
    Start (called by initDesktop)
*/
//Server health from the quick access panel's status card (qaRenderHealth in quickaccess.js):
//0 good, 1 warning, 2 failing. Only a problem puts a dot on the tray's server icon
function setTrayServerStatus(level){
    $("#trayStatus").toggleClass("warning", level == 1).toggleClass("error", level >= 2);
}

/*
    Tray panels: background tasks, quick access, notifications and calendar.
    One is open at a time, and a press anywhere else, a click into a window
    (the page loses focus) or Escape closes it.
*/
var TRAY_PANELS = ["#backgroundTaskPanel", "#quickAccessPanel", ".notificationbar"];
var trayLastToggle = {panel: null, time: 0};

//A tap fires touchstart (or touchend) and then click on the same button:
//count it once, or the panel would open and close again at once
function trayToggleAllowed(panel){
    var now = Date.now();
    if (trayLastToggle.panel == panel && now - trayLastToggle.time < 450){
        return false;
    }
    trayLastToggle = {panel: panel, time: now};
    return true;
}

//Close every tray panel, except the one given (a selector of TRAY_PANELS)
function trayClosePanels(except){
    TRAY_PANELS.forEach(function(selector){
        if (selector != except && $(selector).is(":visible")){
            $(selector).stop(true, true).fadeOut(120);
        }
    });
}

function trayPanelOpen(){
    return TRAY_PANELS.some(function(selector){
        return $(selector).is(":visible");
    });
}

document.addEventListener("mousedown", trayOutsidePress, true);
document.addEventListener("touchstart", trayOutsidePress, true);
function trayOutsidePress(event){
    if (!trayPanelOpen()){
        return;
    }
    //The tray buttons toggle their own panel; dialogs a panel opened keep it
    if ($(event.target).closest(TRAY_PANELS.join(", ") + ", #dockTray, #contextmenu, #subcontextmenu, .ss-dialog-back").length > 0){
        return;
    }
    trayClosePanels();
}

$(window).on("blur", function(){
    trayClosePanels();
});

document.addEventListener("keydown", function(event){
    if (event.key == "Escape" && trayPanelOpen()){
        trayClosePanels();
    }
});

/*
    Start menu layout, set in System Settings > Desktop & Themes > Start Menu
    (SystemAO/desktop/settings/startmenu.html). Three desktop preferences,
    each removed when set back to its default:
    - startmenu-align: "left" or "center" (default), where the dock sits;
      the launcher opens above its button, so it follows;
    - startmenu-iconsize: "tiny", "small" (default), "medium" or "large",
      the dock's icons, and with them the dock and tray height and the strip
      kept free for them (body.dockIcons* in base.css);
    - startmenu-appiconsize: "small" (default), "medium" or "large", the app
      icons in the launcher (body.appIcons* in launcher.css).
    The settings page calls setStartMenuLayout in this desktop, and a
    desktop in another tab hears of it through localStorage
    (desktop/startMenuChanged).
*/
var START_MENU_PREFS = {
    align: {key: "startmenu-align", values: ["left", "center"], fallback: "center"},
    iconSize: {key: "startmenu-iconsize", values: ["tiny", "small", "medium", "large"], fallback: "small"},
    appIconSize: {key: "startmenu-appiconsize", values: ["small", "medium", "large"], fallback: "small"}
};
var startMenuLayout = {align: "center", iconSize: "small", appIconSize: "small"};

//Apply a layout; fields left out keep their current value
function setStartMenuLayout(layout){
    layout = layout || {};
    Object.keys(START_MENU_PREFS).forEach(function(field){
        var spec = START_MENU_PREFS[field];
        if (layout[field] === undefined){
            return;
        }
        startMenuLayout[field] = spec.values.indexOf(layout[field]) >= 0 ? layout[field] : spec.fallback;
    });

    var reservedBefore = getReservedBottom();
    var body = $("body");
    var capital = function(text){
        return text.charAt(0).toUpperCase() + text.substring(1);
    };
    body.toggleClass("dockAlignLeft", startMenuLayout.align == "left");
    //Small is the size base.css and launcher.css start from
    body.removeClass("dockIconsTiny dockIconsMedium dockIconsLarge");
    if (startMenuLayout.iconSize != "small"){
        body.addClass("dockIcons" + capital(startMenuLayout.iconSize));
    }
    body.removeClass("appIconsMedium appIconsLarge");
    if (startMenuLayout.appIconSize != "small"){
        body.addClass("appIcons" + capital(startMenuLayout.appIconSize));
    }

    var icon = parseFloat(getComputedStyle(document.body).getPropertyValue("--dt-dock-icon"));
    DOCK_ICON_MAX = isNaN(icon) ? 36 : icon;
    dockRefreshLayout();
    if (getReservedBottom() != reservedBefore && typeof redrawDesktopGrids == "function"){
        //The icon grid counts its rows from the strip kept for the dock
        redrawDesktopGrids();
    }
    if ($("#listMenu").is(":visible") && typeof launcherPlace == "function"){
        launcherPlace();
    }
}

function initStartMenuLayout(){
    var fields = Object.keys(START_MENU_PREFS);
    var layout = {};
    var pending = fields.length;
    fields.forEach(function(field){
        $.ajax({
            url: "system/desktop/preference",
            method: "POST",
            data: {preference: START_MENU_PREFS[field].key},
            success: function(data){
                layout[field] = (typeof data == "string" && data != "") ? data : START_MENU_PREFS[field].fallback;
            },
            error: function(){
                layout[field] = START_MENU_PREFS[field].fallback;
            },
            complete: function(){
                pending--;
                if (pending == 0){
                    setStartMenuLayout(layout);
                }
            }
        });
    });

    window.addEventListener("storage", function(e){
        if (e.key !== "desktop/startMenuChanged" || !e.newValue){
            return;
        }
        try {
            var change = JSON.parse(e.newValue);
            if (change.layout){
                setStartMenuLayout(change.layout);
            }
            if (change.shortcuts !== undefined && typeof launcherSetShortcuts == "function"){
                //The footer shortcuts of the launcher (launcher.js)
                launcherSetShortcuts(change.shortcuts);
            }
        } catch (err) {}
    });
}

function dockInit(){
    $("#trayStatus").attr("title", applocale.getString("tray/status", "System status"));
    $("#backgroundtaskBtn").attr("title", applocale.getString("tray/tasks", "Background tasks"));
    $("#dockLauncherBtn").attr("data-label", applocale.getString("dock/launcher", "Apps"));
    $("#dockTrash").attr("data-label", applocale.getString("dock/trash", "Trash Bin"));
    $("#dockMore").attr("data-label", applocale.getString("dock/more", "More windows"));
    dockLoadPinned();
    dockRefreshTrash();
    if (dockTrashTimer == null){
        dockTrashTimer = setInterval(dockRefreshTrash, 60000);
    }
    dockRefreshLayout();
}
