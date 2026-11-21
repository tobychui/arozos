/*
    ArozOS Desktop - List menu (start menu)

    The start menu: module categories, container apps, search and
    dragging an entry onto the desktop.

    Part of desktop.html, see README.md in this folder for the load order.
*/

// ===================== LIST MENU EVENTS FUNCTIONS ===============

function toggleListMenu() {
    hideToolPanel()
    $("#listMenu").fadeToggle("fast", function(){
        if ($("#listMenu").is(":visible")) {
            listMenuShown = true;
        } else {
            listMenuShown = false;
        }
    });
}

function hideListMenu() {
    if (listMenuShown) {
        $("#listMenu").fadeOut("fast");
        listMenuShown = false;
    }
}

function initModuleList() {
    $.ajax({
        url: "system/modules/list",
        success: function(data) {
            moduleInstalled = data;
            listModulesType("All");
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

    //Container Apps only exist as a category on hosts that can run containers
    $.get("system/appproxy/apps", function(data) {
        if (data && data.error === undefined && data.Containers === true) {
            $("#containerAppsGroup").show();
        } else {
            $("#containerAppsGroup").hide();
        }
    }).fail(function() {
        $("#containerAppsGroup").hide();
    });
}

function hookLaunchMenuEvents(){
    $(".groupType").off("click touchstart").on("click touchstart",function(){
        moduleTypeButtonClicked(this);
    });
    $(".poweroption").off("click touchstart").on("click touchstart",function(){
        logout();
    });
}

function moduleTypeButtonClicked(object) {
    var groupType = $(object).attr("group");
    listModulesType(groupType);
    $(".groupType.selected").removeClass("selected");
    $(object).addClass("selected");
    $("#searchResults").slideUp('fast');
    $("#searchBar").val("");
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

//List the published container apps the user may open. Fetched on every
//open so apps an administrator just published show up at once
function listContainerApps() {
    $("#listMenuItem").html("");
    $.get("system/appproxy/apps", function(data) {
        if ($(".groupType.selected").attr("group") != "Container Apps") {
            //The user moved on to another category meanwhile
            return;
        }
        $("#listMenuItem").html("");
        var apps = (data && data.error === undefined && data.Apps) ? data.Apps : [];
        apps.forEach(function(app) {
            generateContainerAppListMenuItem(app);
        });
        if (apps.length == 0) {
            $("#listMenuItem").html(`<div class="item module"><span><img src="img/system/not found.png">No container app found</span></div>`);
        }
    });
}

function generateContainerAppListMenuItem(app) {
    var item = $(`<div class="item module" draggable="true"
                ondragstart="listMenuContainerAppDragStart(event,this);"
                onclick="openContainerAppFromMenu(this);" ontouchstart="openContainerAppFromMenu(this);">
                <span><img></img><span class="containerAppName"></span></span>
            </div>`);
    //Names and icons are set as data so an app name is never parsed as HTML
    item.attr("appslug", app.Slug).attr("appname", app.Name);
    item.find("img").attr("src", app.Icon || "ContainerApps/img/app.svg");
    item.find(".containerAppName").text(app.Name);
    $("#listMenuItem").append(item);
}

function openContainerAppFromMenu(object) {
    openContainerAppShortcut({
        ShortcutName: $(object).attr("appname"),
        ShortcutPath: $(object).attr("appslug"),
        ShortcutImage: $(object).find("img").first().attr("src")
    });
}

function listModulesType(groupType) {
    var listingItems = [];
    if (groupType == "Container Apps") {
        listContainerApps();
        return;
    }
    if (groupType == "All") {
        //List all of the items
        for (var i = 0; i < moduleInstalled.length; i++) {
            if (isLaunchableModule(moduleInstalled[i])) {
                listingItems.push(moduleInstalled[i]);
            }
        }
    } else {
        //List the modules whose group falls under the given category (Other
        //collects every group no category claims)
        for (var i = 0; i < moduleInstalled.length; i++) {
            if (listMenuCategoryOf(moduleInstalled[i]["Group"]) == groupType && isLaunchableModule(moduleInstalled[i])) {
                listingItems.push(moduleInstalled[i]);
            }
        }
    }

    //List the item to the listmenu
    $("#listMenuItem").html("");
    for (var i = 0; i < listingItems.length; i++) {
        var thisModule = listingItems[i];
        generateListMenuItem(thisModule);
    }
    if (listingItems.length == 0) {
        $("#listMenuItem").html(`<div class="item module"><span><img src="img/system/not found.png">No WebApp found</span></div>`)
    }
}

//Given a module information and generate a selectable item in the list menu
function generateListMenuItem(thisModule) {
    var icon = thisModule["IconPath"];
    if (icon == "") {
        //Use default system icon
        icon = "img/system/service.png";
    }
    var name = thisModule["Name"];
    var startdir = thisModule["StartDir"];
    var fwsupport = "false";
    if (thisModule["SupportFW"]) {
        fwsupport = "true";
    }
    $("#listMenuItem").append(`<div class="item module" module="${name}" startdir="${startdir}" fw="${fwsupport}"
                draggable="true"
                ondragstart="listMenuItemDragStart(event,this);"
                onclick="openModuleFromMenu(this);" ontouchstart="openModuleFromMenu(this);">
                <span>
                    <img src="${icon}"></img>
                    ${name}
                </span>
            </div>`);
}

function searchModule(event) {
    if (event.which == 13) {
        var keyword = $("#searchBar").val().toLowerCase();
        var results = [];
        var lessAccurateResults = [];
        $(".groupType.selected").removeClass("selected");
        $("#searchResults").addClass("selected").slideDown('fast');
        //Load all search results
        for (var i = 0; i < moduleInstalled.length; i++) {
            var thisModule = moduleInstalled[i];
            if (!isLaunchableModule(thisModule)){
                continue;
            }
            var pathInfo = thisModule["StartDir"].split("/");
            for (var j = 0; j < pathInfo.length; j++) {
                pathInfo[j] = pathInfo[j].toLowerCase();
            }
            if (thisModule["Name"].toLowerCase().includes(keyword)) {
                results.push(thisModule);
            } else if (pathInfo.includes(keyword.toLowerCase()) || pathInfo.includes(keyword.split(" ").join("_").toLowerCase())) {
                lessAccurateResults.push(thisModule);
            }
        }
        results = results.concat(lessAccurateResults);
        //Append the results to list
        $("#listMenuItem").html("");
        for (var i = 0; i < results.length; i++) {
            generateListMenuItem(results[i]);
        }

        if (results.length == 0) {
            //Append a custom no results div to the content
            $("#listMenuItem").append(` <div class="item">
                <span>
                    <img src="img/system/not found.png"></img>
                    No Result
                </span>
            </div>`);
        }
    }
}

function openModuleFromMenu(object) {
    var moduleName = $(object).attr("module");
    openModule(moduleName);
}

// Fired when the user starts dragging a list-menu app item onto the desktop
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

//Dragging a container app out of the list menu pins it as an "app" shortcut
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
