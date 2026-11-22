/*
    ArozOS Desktop - Launcher

    The panel the dock's launcher button opens. It replaced the two column
    start menu: a search field on top, a row of category pills and a grid of
    apps, rising from the dock above its launcher button and never covering
    the whole screen.

    Search filters while typing (names first, then module folders) across
    modules and container apps. The caret stays in the search field: the
    arrow keys move a selection through the grid, Enter opens the selected
    app (the first hit while searching), Tab walks the categories, Escape
    clears the search and then closes the launcher.

    Kept from the old start menu, because other code uses them: the ids
    #listMenu, #listMenuItem and #searchBar, and toggleListMenu,
    hideListMenu, initModuleList (also called through parent. by other
    pages), isLaunchableModule, listMenuCategoryOf, openModuleFromMenu,
    openContainerAppFromMenu, listMenuItemDragStart and
    listMenuContainerAppDragStart (dragging a tile onto the desktop makes a
    shortcut, onto the dock pins it).

    Part of desktop.html, see README.md in this folder for the load order.
*/

var launcherCategory = "All";          //Selected category pill
var launcherContainersEnabled = false; //The host runs container apps
var launcherContainerApps = [];        //Container apps the user may open
var launcherSelected = -1;             //Index of the selected tile, -1 for none

//Category pills in display order: category, locale key
var LAUNCHER_CATEGORIES = [
    ["All", "listmenu/catergory/all"],
    ["Media", "listmenu/catergory/media"],
    ["Office", "listmenu/catergory/office"],
    ["Network", "listmenu/catergory/network"],
    ["Engineering", "listmenu/catergory/engineering"],
    ["Development", "listmenu/catergory/development"],
    ["System", "listmenu/catergory/system"],
    ["Utilities", "listmenu/catergory/utils"],
    ["Container Apps", "listmenu/catergory/containerApps"],
    ["Other", "listmenu/catergory/other"]
];

/*
    Modules
*/

function initModuleList() {
    $.ajax({
        url: "system/modules/list",
        success: function(data) {
            moduleInstalled = data;
            launcherRender();
            launcherRenderShortcuts();
            dockModulesLoaded();
            checkFileSystemAccess();

            //Hide the system setting button if access is denied
            var allowSettingAccess = false;
            moduleInstalled.forEach(thismod => {
                if (thismod.Name == "System Setting"){
                    allowSettingAccess = true;
                }
            });
            if (!allowSettingAccess){
                $("#settingButton").hide();
            }
        }
    });
    launcherRefreshContainerApps();
}

//Container Apps only exist as a category on hosts that can run containers.
//Fetched on every open, so apps an administrator just published show up
function launcherRefreshContainerApps(){
    $.get("system/appproxy/apps", function(data) {
        launcherContainersEnabled = (data && data.error === undefined && data.Containers === true);
        launcherContainerApps = (launcherContainersEnabled && Array.isArray(data.Apps)) ? data.Apps : [];
        launcherRender();
    }).fail(function() {
        launcherContainersEnabled = false;
        launcherContainerApps = [];
    });
}

//Interface Modules (Desktop, Dashboard, ...) are what the user boots into, not apps
//to launch, and modules without a StartDir can only be opened with a file
function isLaunchableModule(moduleInfo) {
    return moduleInfo["StartDir"] != "" && moduleInfo["Group"] != "Interface Module";
}

//Return the list menu category a module group is listed under
function listMenuCategoryOf(group) {
    var g = (group || "").trim().toLowerCase();
    for (var category in listMenuCategories) {
        var groups = listMenuCategories[category];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].toLowerCase() == g) {
                return category;
            }
        }
    }
    return "Other";
}

//Every app the launcher can show: launchable modules, then container apps
function launcherItems(){
    var items = [];
    (moduleInstalled || []).forEach(function(mod){
        if (!isLaunchableModule(mod)){
            return;
        }
        items.push({
            kind: "module",
            name: mod.Name,
            icon: mod.IconPath != "" ? mod.IconPath : "img/system/service.png",
            category: listMenuCategoryOf(mod.Group),
            folders: String(mod.StartDir).toLowerCase().split("/")
        });
    });
    launcherContainerApps.forEach(function(app){
        items.push({
            kind: "app",
            name: app.Name,
            icon: app.Icon || "ContainerApps/img/app.svg",
            category: "Container Apps",
            folders: [String(app.Slug || "").toLowerCase()],
            slug: app.Slug
        });
    });
    return items;
}

function launcherQuery(){
    return String($("#searchBar").val() || "").trim().toLowerCase();
}

//The apps of the selected category, or the search hits: names containing the
//text first, then apps one of whose start page folders is exactly the text
function launcherVisibleItems(){
    var query = launcherQuery();
    var items = launcherItems();
    if (query != ""){
        var byName = [];
        var byFolder = [];
        var folderQuery = query.split(" ").join("_");
        items.forEach(function(item){
            if (item.name.toLowerCase().indexOf(query) >= 0){
                byName.push(item);
            }else if (item.folders.includes(query) || item.folders.includes(folderQuery)){
                byFolder.push(item);
            }
        });
        return byName.concat(byFolder);
    }
    return items.filter(function(item){
        return launcherCategory == "All" || item.category == launcherCategory;
    });
}

/*
    Rendering
*/

function launcherRender(){
    launcherRenderPills();
    launcherRenderGrid();
}

//Categories with no app are left out
function launcherRenderPills(){
    var counts = {};
    launcherItems().forEach(function(item){
        counts[item.category] = (counts[item.category] || 0) + 1;
    });
    if (launcherCategory != "All" && !counts[launcherCategory]){
        launcherCategory = "All";
    }
    var searching = launcherQuery() != "";
    var bar = $("#launcherCategories").empty();
    LAUNCHER_CATEGORIES.forEach(function(entry){
        var category = entry[0];
        if (category != "All" && !counts[category]){
            return;
        }
        var selected = !searching && category == launcherCategory;
        var pill = $('<div class="launcherPill" role="tab"></div>');
        pill.attr({"data-category": category, "aria-selected": selected ? "true" : "false"});
        pill.text(applocale.getString(entry[1], category));
        pill.toggleClass("selected", selected);
        bar.append(pill);
    });
}

function launcherTile(item){
    var tile = $('<div class="launcherTile" role="gridcell" draggable="true"><img draggable="false"><span class="name"></span></div>');
    tile.find("img").attr("src", item.icon).one("error", function(){
        $(this).attr("src", "img/system/service.png");
    });
    tile.find(".name").text(item.name);
    tile.attr({"title": item.name, "kind": item.kind});
    if (item.kind == "app"){
        tile.attr({"appslug": item.slug, "appname": item.name, "ondragstart": "listMenuContainerAppDragStart(event,this);"});
    }else{
        tile.attr({"module": item.name, "ondragstart": "listMenuItemDragStart(event,this);"});
    }
    return tile;
}

function launcherRenderGrid(){
    var grid = $("#listMenuItem").empty();
    var items = launcherVisibleItems();
    items.forEach(function(item){
        grid.append(launcherTile(item));
    });
    var searching = launcherQuery() != "";
    if (items.length == 0){
        var message = searching ? applocale.getString("launcher/noResults", "No apps match your search") : applocale.getString("launcher/noApps", "No apps in this category");
        grid.append($('<div class="launcherEmpty"></div>').text(message));
    }
    grid.scrollTop(0);
    //While searching the first hit is selected, so Enter opens it
    launcherSelect(searching && items.length > 0 ? 0 : -1);
}

/*
    Selection
*/

function launcherSelect(index){
    var tiles = $("#listMenuItem .launcherTile");
    tiles.removeClass("selected");
    if (index < 0 || tiles.length == 0){
        launcherSelected = -1;
        return;
    }
    launcherSelected = Math.max(0, Math.min(index, tiles.length - 1));
    var tile = tiles.eq(launcherSelected).addClass("selected");
    tile[0].scrollIntoView({block: "nearest"});
}

//Tiles per row of the grid, as laid out right now
function launcherColumns(){
    var tiles = $("#listMenuItem .launcherTile");
    if (tiles.length == 0){
        return 1;
    }
    var top = tiles[0].offsetTop;
    var count = 0;
    tiles.each(function(){
        if (this.offsetTop != top){
            return false;
        }
        count++;
    });
    return Math.max(1, count);
}

function launcherSelectCategory(category){
    launcherCategory = category;
    $("#searchBar").val("");
    launcherRender();
}

function launcherCycleCategory(direction){
    var pills = $("#launcherCategories .launcherPill");
    if (pills.length == 0){
        return;
    }
    var index = pills.index(pills.filter(".selected"));
    index = (index + direction + pills.length) % pills.length;
    launcherSelectCategory(pills.eq(index).attr("data-category"));
    pills = $("#launcherCategories .launcherPill.selected");
    if (pills.length > 0){
        pills[0].scrollIntoView({block: "nearest", inline: "nearest"});
    }
}

function launcherKeydown(event){
    var tiles = $("#listMenuItem .launcherTile");
    var columns = launcherColumns();
    switch (event.key){
        case "ArrowDown":
            event.preventDefault();
            if (launcherSelected < 0){
                launcherSelect(0);
            }else if (launcherSelected + columns < tiles.length){
                launcherSelect(launcherSelected + columns);
            }
            break;
        case "ArrowUp":
            event.preventDefault();
            if (launcherSelected >= 0){
                //Up from the first row goes back to the search text
                launcherSelect(launcherSelected - columns >= 0 ? launcherSelected - columns : -1);
            }
            break;
        case "ArrowRight":
            if (launcherSelected >= 0){
                event.preventDefault();
                launcherSelect(launcherSelected + 1);
            }
            break;
        case "ArrowLeft":
            if (launcherSelected >= 0){
                event.preventDefault();
                launcherSelect(launcherSelected - 1);
            }
            break;
        case "Enter":
            event.preventDefault();
            var index = launcherSelected >= 0 ? launcherSelected : 0;
            if (index < tiles.length){
                launcherOpenTile(tiles[index]);
            }
            break;
        case "Tab":
            event.preventDefault();
            launcherCycleCategory(event.shiftKey ? -1 : 1);
            break;
        case "Escape":
            event.preventDefault();
            if ($("#accountPanel").is(":visible")){
                launcherHideAccountPanel();
            }else if ($("#searchBar").val() != ""){
                $("#searchBar").val("");
                launcherRender();
            }else{
                hideListMenu();
            }
            break;
    }
}

/*
    Opening apps
*/

function launcherOpenTile(tile){
    if ($(tile).attr("kind") == "app"){
        openContainerAppFromMenu(tile);
    }else{
        openModuleFromMenu(tile);
    }
    hideListMenu();
}

function openContainerAppFromMenu(object) {
    openContainerAppShortcut({
        ShortcutName: $(object).attr("appname"),
        ShortcutPath: $(object).attr("appslug"),
        ShortcutImage: $(object).find("img").first().attr("src")
    });
}

/*
    Footer shortcuts next to the power button. The user picks them in System
    Settings > Desktop & Themes > Start Menu (SystemAO/desktop/settings/
    startmenu.html, which keeps its own copy of the ids and folder names):
    the desktop preference "startmenu-shortcuts" is a JSON list of ids, unset
    means File Manager and System Setting. An app shows only when the user
    may open it, a folder only when the home folder holds one of its names
    (any case). The home folder is only listed while a folder is chosen.
*/
var LAUNCHER_SHORTCUT_PREF = "startmenu-shortcuts";
var LAUNCHER_SHORTCUT_DEFAULT = ["filemanager", "settings"];
var LAUNCHER_SHORTCUTS = [
    {id: "document", folders: ["Document", "Documents"], icon: "file alternate", label: ["launcher/documents", "Documents"]},
    {id: "download", folders: ["Download", "Downloads"], icon: "download", label: ["launcher/downloads", "Downloads"]},
    {id: "music", folders: ["Music"], icon: "music", label: ["launcher/music", "Music"]},
    {id: "photo", folders: ["Photo", "Photos", "Picture", "Pictures"], icon: "image", label: ["launcher/pictures", "Pictures"]},
    {id: "video", folders: ["Video", "Videos"], icon: "film", label: ["launcher/videos", "Videos"]},
    {id: "filemanager", module: "File Manager", icon: "folder", label: ["launcher/fileManager", "File Manager"]},
    {id: "settings", module: "System Setting", icon: "setting", label: ["launcher/settings", "Settings"]}
];
var launcherShortcutIds = LAUNCHER_SHORTCUT_DEFAULT.slice();
var launcherHomeFolders = {}; //lower case name -> folder name in user:/, from the last listing

function launcherShortcutByID(id){
    return LAUNCHER_SHORTCUTS.find(function(sc){
        return sc.id == id;
    });
}

function initLauncherShortcuts(){
    $.ajax({
        url: "system/desktop/preference",
        method: "POST",
        data: {preference: LAUNCHER_SHORTCUT_PREF},
        success: function(data){
            var list = null;
            if (typeof data == "string" && data != ""){
                try {
                    list = JSON.parse(data);
                } catch (ex) {
                    list = null;
                }
            }
            launcherSetShortcuts(list);
        },
        error: function(){
            launcherSetShortcuts(null);
        }
    });
}

//Show these shortcuts (a list of ids; anything else means the default).
//Also called by the Start Menu settings page.
function launcherSetShortcuts(ids){
    if (!Array.isArray(ids)){
        ids = LAUNCHER_SHORTCUT_DEFAULT;
    }
    launcherShortcutIds = ids.filter(function(id){
        return launcherShortcutByID(id) != undefined;
    });
    launcherRenderShortcuts();
    launcherRefreshHomeFolders();
}

//The folder of user:/ a folder shortcut opens, "" when there is none
function launcherShortcutFolder(sc){
    for (var i = 0; i < sc.folders.length; i++){
        var name = launcherHomeFolders[sc.folders[i].toLowerCase()];
        if (name != undefined){
            return "user:/" + name;
        }
    }
    return "";
}

function launcherRefreshHomeFolders(){
    var wantsFolder = launcherShortcutIds.some(function(id){
        return launcherShortcutByID(id).folders != undefined;
    });
    if (!wantsFolder){
        return;
    }
    $.ajax({
        url: "system/file_system/listDir",
        method: "POST",
        data: {dir: "user:/"},
        success: function(data){
            if (!Array.isArray(data)){
                //An empty home folder (null) or an error
                data = [];
            }
            var folders = {};
            data.forEach(function(file){
                if (file && file.IsDir && typeof file.Filename == "string"){
                    folders[file.Filename.toLowerCase()] = file.Filename;
                }
            });
            launcherHomeFolders = folders;
            launcherRenderShortcuts();
        }
    });
}

function launcherRenderShortcuts(){
    var box = $("#listMenu .launcherShortcuts");
    box.empty();
    LAUNCHER_SHORTCUTS.forEach(function(sc){
        if (launcherShortcutIds.indexOf(sc.id) < 0){
            return;
        }
        var path = "";
        if (sc.module){
            var mod = getModuleInfoFromName(sc.module);
            if (!mod || !isLaunchableModule(mod)){
                return;
            }
        }else{
            path = launcherShortcutFolder(sc);
            if (path == ""){
                return;
            }
        }
        var label = applocale.getString(sc.label[0], sc.label[1]);
        var button = $('<div class="launcherShortcut" role="button"><i class="icon"></i></div>');
        button.find("i").addClass(sc.icon);
        button.attr({"data-id": sc.id, "title": label, "aria-label": label});
        if (path != ""){
            button.attr("data-path", path);
        }
        box.append(button);
    });
}

function launcherOpenShortcut(button){
    var sc = launcherShortcutByID($(button).attr("data-id"));
    if (sc == undefined){
        return;
    }
    hideListMenu();
    if (sc.module){
        openModule(sc.module);
    }else{
        openFolder($(button).attr("data-path"));
    }
}

function openModuleFromMenu(object) {
    var moduleName = $(object).attr("module");
    openModule(moduleName);
}

function listMenuItemDragStart(ev, el) {
    ev.stopPropagation();
    var name  = $(el).attr("module");
    var icon  = $(el).find("img").first().attr("src");
    ev.dataTransfer.effectAllowed = "copy";
    ev.dataTransfer.setData("moduledragtype", "module");
    ev.dataTransfer.setData("modulename",     name);
    ev.dataTransfer.setData("moduleicon",     icon);
    // Clear file-drag fields so existing drop logic ignores this event
    ev.dataTransfer.setData("filepath",  "");
    ev.dataTransfer.setData("filename",  "");
    ev.dataTransfer.setData("filedata",  "");
}

function listMenuContainerAppDragStart(ev, el) {
    ev.stopPropagation();
    ev.dataTransfer.effectAllowed = "copy";
    ev.dataTransfer.setData("moduledragtype", "app");
    ev.dataTransfer.setData("modulename",     $(el).attr("appname"));
    ev.dataTransfer.setData("moduleslug",     $(el).attr("appslug"));
    ev.dataTransfer.setData("moduleicon",     $(el).find("img").first().attr("src"));
    ev.dataTransfer.setData("filepath",  "");
    ev.dataTransfer.setData("filename",  "");
    ev.dataTransfer.setData("filedata",  "");
}

/*
    Showing and hiding
*/

//Above the dock's launcher button, kept on screen and smaller on small screens
function launcherPlace(){
    var panel = $("#listMenu");
    var margin = 8;
    var width = Math.min(660, window.innerWidth - margin * 2);
    var height = Math.min(580, window.innerHeight - getReservedBottom() - margin * 2);
    panel.css({width: width, height: height});
    var left = margin;
    var launcher = $("#dockLauncherBtn");
    if (launcher.length > 0){
        left = launcher.offset().left - 10;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    panel.css("left", left);
}

function launcherOpen(){
    hideToolPanel();
    $("#searchBar").val("");
    launcherCategory = "All";
    launcherRender();
    $(".launcherUsername").text(userInfo.Username || "");
    $("#listMenu").stop(true, true).fadeIn(120);
    launcherPlace();
    //A chosen folder may have been made or removed since the last opening
    launcherRefreshHomeFolders();
    $("#dockLauncherBtn").addClass("pressed");
    listMenuShown = true;
    setTimeout(function(){
        $("#searchBar").trigger("focus");
    }, 0);
    launcherRefreshContainerApps();
}

function toggleListMenu() {
    if ($("#listMenu").is(":visible")){
        hideListMenu();
    }else{
        launcherOpen();
    }
}

function hideListMenu() {
    listMenuShown = false;
    $("#dockLauncherBtn").removeClass("pressed");
    launcherHideAccountPanel();
    if (contextMenuAnchor != null && $(contextMenuAnchor).closest("#listMenu").length > 0){
        //The power menu goes with the launcher
        contextMenuHideOnly();
    }
    if ($("#listMenu").is(":visible")) {
        $("#searchBar").trigger("blur");
        $("#listMenu").stop(true, true).fadeOut(100);
    }
}

/*
    Account panel: the signed in user, the other accounts stored in this
    browser (switch to one, add one, sign them all out) and Logout. The
    server's own status and settings live in the tray's quick access panel.
*/
function launcherToggleAccountPanel(){
    if ($("#accountPanel").is(":visible")){
        launcherHideAccountPanel();
        return;
    }
    contextMenuHideOnly();
    listAllStoredAccounts();
    $("#accountPanel").stop(true, true).show();
    $("#listMenu .launcherUser").addClass("open");
}

function launcherHideAccountPanel(){
    $("#listMenu .launcherUser").removeClass("open");
    $("#accountPanel").stop(true, true).hide();
}

/*
    Context menus: a tile, and the power button of the footer
*/

function launcherBuildContextMenu(tile){
    var menu = $("#contextmenu");
    var kind = $(tile).attr("kind");
    var payload = {
        kind: kind,
        name: kind == "app" ? $(tile).attr("appname") : $(tile).attr("module"),
        slug: $(tile).attr("appslug") || "",
        icon: $(tile).find("img").attr("src")
    };
    addContextMenuItem(menu, lcontex("Open"), undefined, "launcherMenuOpen", false, {payload: payload});
    addContextMenuItem(menu, lcontex("Open in New Tab"), undefined, "launcherMenuNewTab", false, {payload: payload});
    addContextMenuSeperator(menu);
    if (kind != "app"){
        var pinned = Array.isArray(dockPinnedModules) && dockPinnedModules.indexOf(payload.name) >= 0;
        addContextMenuItem(menu, lcontex(pinned ? "Remove from Dock" : "Keep in Dock"), undefined, pinned ? "launcherMenuUnpin" : "launcherMenuPin", false, {payload: payload});
    }
    addContextMenuItem(menu, lcontex("Add to Desktop"), undefined, "launcherMenuAddToDesktop", false, {payload: payload});
    return true;
}

function launcherMenuOpen(target, event){
    var item = getContextMenuPayload(target);
    hideAllContextMenus();
    hideListMenu();
    if (item.kind == "app"){
        openContainerAppShortcut({ShortcutName: item.name, ShortcutPath: item.slug, ShortcutImage: item.icon});
    }else{
        openModule(item.name);
    }
}

function launcherMenuNewTab(target, event){
    var item = getContextMenuPayload(target);
    hideAllContextMenus();
    hideListMenu();
    if (item.kind == "app"){
        openContainerAppShortcut({ShortcutName: item.name, ShortcutPath: item.slug, ShortcutImage: item.icon}, true);
        return;
    }
    var mod = getModuleInfoFromName(item.name);
    if (mod){
        window.open(mod.StartDir);
    }
}

function launcherMenuPin(target, event){
    dockPinModule(getContextMenuPayload(target).name);
    hideAllContextMenus();
}

function launcherMenuUnpin(target, event){
    dockUnpinModule(getContextMenuPayload(target).name);
    hideAllContextMenus();
}

//A desktop shortcut, as dropping the tile on the desktop makes, in the first free slot
function launcherMenuAddToDesktop(target, event){
    var item = getContextMenuPayload(target);
    hideAllContextMenus();
    $.ajax({
        url: "system/desktop/createShortcut",
        method: "POST",
        data: {
            stype: item.kind == "app" ? "app" : "module",
            stext: item.name,
            spath: item.kind == "app" ? item.slug : item.name,
            sicon: item.icon
        },
        success: function(data){
            if (data.error !== undefined){
                showNotificationToast(item.name, data.error, "medium");
                return;
            }
            refresh(undefined, false);
        }
    });
}

function launcherShowPowerMenu(button){
    var menu = $("#contextmenu");
    if (menu.is(":visible") && contextMenuAnchor === button){
        //A second click on the power button closes its menu
        contextMenuHideOnly();
        return;
    }
    hideAllContextMenus();
    menu.html("");
    addContextMenuItem(menu, applocale.getString("quickAccess/logout", "Logout"), undefined, "launcherMenuLogout", false);
    if (powerman){
        addContextMenuSeperator(menu);
        addContextMenuItem(menu, applocale.getString("quickAccess/restart", "Restart"), undefined, "launcherMenuRestart", false);
        addContextMenuItem(menu, applocale.getString("quickAccess/poweroff", "Power Off"), undefined, "launcherMenuShutdown", false, {danger: true});
    }
    menu.show();
    placeContextMenu(0, 0);
    //Above the button, right edges aligned: it sits in the launcher's bottom right corner
    var rect = button.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.right - menu.outerWidth(), window.innerWidth - menu.outerWidth() - 8));
    var top = Math.max(8, rect.top - menu.outerHeight() - 6);
    menu.css({left: left, top: top});
    contextMenuAnchor = button;
}

function launcherMenuLogout(target, event){
    hideAllContextMenus();
    hideListMenu();
    logout();
}

function launcherMenuRestart(target, event){
    hideAllContextMenus();
    hideListMenu();
    restart();
}

function launcherMenuShutdown(target, event){
    hideAllContextMenus();
    hideListMenu();
    shutdown();
}

/*
    Events (bound by initDesktop)
*/
function hookLaunchMenuEvents(){
    $("#listMenu").attr("aria-label", applocale.getString("dock/launcher", "Apps"));
    var powerLabel = applocale.getString("launcher/power", "Power");
    $("#listMenu .launcherPower").attr({"title": powerLabel, "aria-label": powerLabel});

    var search = $("#searchBar");
    search.off(".launcher");
    search.on("input.launcher", function(){
        launcherRender();
    });
    search.on("keydown.launcher", function(event){
        launcherKeydown(event);
        //Typing here must not reach the desktop's key bindings (input.js):
        //Ctrl+V would paste files onto the desktop, Enter open the selected icons
        event.stopPropagation();
    });
    search.on("keyup.launcher keypress.launcher", function(event){
        event.stopPropagation();
    });

    $("#launcherCategories").off(".launcher").on("click.launcher", ".launcherPill", function(){
        launcherSelectCategory($(this).attr("data-category"));
        $("#searchBar").trigger("focus");
    }).on("wheel.launcher", function(event){
        //A vertical wheel scrolls the row of pills sideways
        var delta = event.originalEvent.deltaY;
        if (delta != 0){
            this.scrollLeft += delta;
            event.preventDefault();
        }
    });

    $("#listMenuItem").off(".launcher").on("click.launcher", ".launcherTile", function(){
        launcherOpenTile(this);
    }).on("mousemove.launcher", ".launcherTile", function(){
        //The pointer takes over from the keyboard selection
        if (launcherSelected >= 0 && !$(this).hasClass("selected")){
            launcherSelect(-1);
        }
    });

    $("#listMenu .launcherUser").off(".launcher").on("click.launcher", function(){
        launcherToggleAccountPanel();
    });
    $("#addAccountButton").off(".launcher").on("click.launcher", function(){
        hideListMenu();
        openSwitchAccountPanel();
    });
    $("#signoutAllButton").off(".launcher").on("click.launcher", function(){
        logoutAllAccounts();
    });
    $("#accountLogoutButton").off(".launcher").on("click.launcher", function(){
        hideListMenu();
        logout();
    });
    //A press elsewhere in the launcher closes the account panel
    $("#listMenu").off("mousedown.launcher").on("mousedown.launcher", function(event){
        if ($(event.target).closest("#accountPanel, .launcherUser").length == 0){
            launcherHideAccountPanel();
        }
    });
    $("#listMenu .launcherShortcuts").off(".launcher").on("click.launcher", ".launcherShortcut", function(){
        launcherOpenShortcut(this);
    });
    $("#listMenu .launcherPower").off(".launcher").on("click.launcher", function(event){
        event.stopPropagation();
        launcherShowPowerMenu(this);
    });
}

//A press anywhere outside the launcher (or a click into a window) closes it
document.addEventListener("mousedown", function(event){
    if (!$("#listMenu").is(":visible")){
        return;
    }
    if ($(event.target).closest("#listMenu, #dockLauncherBtn, #contextmenu, #subcontextmenu").length == 0){
        hideListMenu();
    }
}, true);

$(window).on("blur", function(){
    hideListMenu();
});

$(window).on("resize", function(){
    if ($("#listMenu").is(":visible")){
        launcherPlace();
    }
});

//Escape closes the launcher wherever the focus is (the search field handles its own)
document.addEventListener("keydown", function(event){
    if (event.key == "Escape" && $("#listMenu").is(":visible") && event.target.id != "searchBar"){
        hideListMenu();
    }
});
