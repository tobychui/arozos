/*
    shared.js

    "Shared with me": the files and folders other users shared with this one,
    browsed as the share:/ drive instead of one share link page at a time.

    The drive is a real directory tree as far as the File Manager is
    concerned - the server lists, searches, opens and copies it like any other
    (mod/filesystem/abstractions/sharefs). What it adds here is knowing what
    each shared item allows, so only the operations that can work are offered:

        /system/file_system/share/sharedWithMe  -> [SharedItemInfo]

    lists the items at the drive root with their permissions. Every path on
    the drive starts with the item it belongs to ("share:/Photos/2024/a.jpg"
    is inside "Photos"), so one lookup by the first segment answers for any
    file below it.

    Nothing on the drive can be renamed, deleted, moved, uploaded into or
    shared again: the files belong to their owners, and the server refuses all
    of it (the drive is read only). Copying and downloading follow the share's
    "allow download" setting. Uploading into a folder shared for editing, and
    downloading a folder whose content the owner hid, still happen on the
    share link page, which "Open share page" brings up.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
    Loaded before trash.js so its sidebar entry sits above the trash bin.
*/

//The sentinel the sidebar entry and desktop shortcut hold, and the drive it names
const SHARE_VPATH = "%share%";
const SHARE_ROOT = "share:/";

/*
    Item name -> SharedItemInfo from the last listing. null until the first
    one arrives; the menus then allow only what never depends on an item.
*/
let sharedItems = null;
let sharedItemsRequest = null;

function isSharePath(path){
    return getDriveView(path) === getSpecialView(SHARE_VPATH);
}

//The name of the shared item a path on the drive belongs to, "" for the root
function sharedItemNameOf(path){
    let rest = String(path).trim().substring(SHARE_ROOT.length);
    return rest.split("/")[0];
}

function sharedItemOf(path){
    if (sharedItems == null || !isSharePath(path)){
        return null;
    }
    let item = sharedItems[sharedItemNameOf(path)];
    return item == undefined ? null : item;
}

/*
    Fetch what each item allows. Concurrent callers share one request; the
    callback runs either way, with whatever is known by then.
*/
function loadSharedItems(callback){
    if (sharedItemsRequest == null){
        sharedItemsRequest = $.get("../../system/file_system/share/sharedWithMe").done(function(data){
            if (Array.isArray(data)){
                let items = {};
                data.forEach(function(item){
                    items[item.Name] = item;
                });
                sharedItems = items;
            }
        }).always(function(){
            sharedItemsRequest = null;
        });
    }
    sharedItemsRequest.always(function(){
        if (typeof callback === "function"){
            callback();
        }
    });
}

/*
    The rules. paths are the selected files, or empty for the directory
    itself (right click on empty space, the toolbar with nothing selected).
*/
function sharedDriveAllows(opr, paths){
    let targets = (paths != undefined && paths.length > 0) ? paths : [currentPath];
    let items = targets.map(sharedItemOf);
    let allItems = items.length > 0 && items.every(function(item){ return item != null; });

    switch (opr){
        //Looking around works everywhere on the drive
        case "open":
        case "openwith":
        case "refresh":
        case "home":
        case "fileinfo":
        case "dirinfo":
        case "shortcut":
            return true;

        //Taking a copy is the owner's call, item by item
        case "copy":
        case "download":
            return allItems && items.every(function(item){ return item.CanDownload; });

        //The link page of one item: its zip download and uploads live there
        case "sharepage":
            return allItems && items.length == 1 && items[0].ShareUUID != "";
    }

    //cut, paste, rename, delete, upload, newfile, newfolder, zip, unzip, share
    return false;
}

//Why sharedDriveAllows() said no, for driveViewBlocks()
function sharedDriveRefusal(opr){
    if (opr == "copy" || opr == "download"){
        let item = sharedItemOf(currentPath);
        if (item == null && $(".fileObject.selected").length > 0){
            item = sharedItemOf($(".fileObject.selected").first().attr("filepath"));
        }
        if (item != null && !item.CanDownload){
            return applocale.getString("message/share/noDownload",
                "The owner of this item does not allow downloading it");
        }
    }
    return applocale.getString("message/share/readOnly",
        "Files shared with you are read only");
}

/*
    Open the share link page of the selected item (or of the folder on screen),
    where a folder shared for editing takes uploads and one whose listing is
    hidden can still be downloaded as a zip.
*/
function openSharedItemPage(){
    let path = currentPath;
    if ($(".fileObject.selected").length > 0){
        path = $(".fileObject.selected").first().attr("filepath");
    }
    let item = sharedItemOf(path);
    if (item == null || item.ShareUUID == ""){
        return;
    }
    //A float window on the desktop, a new tab otherwise
    ao_module_newfw({
        url: "share/" + encodeURIComponent(item.ShareUUID),
        width: 1080,
        height: 640,
        appicon: "SystemAO/file_system/img/share.svg",
        title: item.Name
    });
}

/*
    Shown instead of a listing when a folder's owner hid its content. The
    server refuses the listing either way; this says why and offers the link
    page, which can still download the folder as a zip.
*/
function renderSharedFolderHidden(item){
    $("#fileList").hide();
    let html = '<div class="fmPathError">' +
        '<div class="fmPathErrorIcon">' + FSIcons.sharedWithMe + '</div>' +
        '<div class="fmPathErrorTitle">' + escapeHTMLText(applocale.getString("share/hidden/title", "This folder's content is hidden")) + '</div>' +
        '<div class="fmPathErrorDesc">' + escapeHTMLText(applocale.getString("share/hidden/desc",
            "{owner} shared this folder without showing what is inside. It may still be downloaded from its share page.").replace("{owner}", item.Owner)) + '</div>' +
        '<div class="fmPathErrorActions">';
    if (item.ShareUUID != ""){
        html += '<button class="fmPathErrorBtn primary" onclick="openSharedItemPage();">' +
            escapeHTMLText(applocale.getString("contextmenu/sharepage", "Open Share Page")) + '</button>';
    }
    html += '<button class="fmPathErrorBtn" onclick="listDirectory(SHARE_ROOT);">' +
        escapeHTMLText(applocale.getString("share/title", "Shared with me")) + '</button>' +
        '</div></div>';
    $("#folderList").show().html(html);
    //Nothing is listed, so the status bar should not count the last folder
    updateSelectedObjectsCount();
}

//An empty drive root says what would appear there, rather than nothing at all
function renderSharedEmpty(path){
    if (sharedItemNameOf(path) != ""){
        return;
    }
    $("#fileList").hide();
    $("#folderList").show().html('<div class="fmPathError">' +
        '<div class="fmPathErrorIcon">' + FSIcons.sharedWithMe + '</div>' +
        '<div class="fmPathErrorTitle">' + escapeHTMLText(applocale.getString("share/empty/title", "Nothing is shared with you yet")) + '</div>' +
        '<div class="fmPathErrorDesc">' + escapeHTMLText(applocale.getString("share/empty/desc",
            "Files and folders other users share with you, or with a group you are in, appear here.")) + '</div>' +
        '</div>');
}

/*
    Called by listDirectory() for every path on the drive, before the listing
    goes out. Refreshes what the items allow - a share can change while the
    window is open - and reports whether the listing should go ahead.
*/
function prepareSharedListing(path, proceed){
    loadSharedItems(function(){
        if (currentPath != path){
            //The user moved on while this was loading
            return;
        }
        let item = sharedItemOf(path);
        if (item != null && item.IsFolder && !item.CanBrowse){
            renderSharedFolderHidden(item);
            applyDriveViewToolbar();
            return;
        }
        applyDriveViewToolbar();
        proceed();
    });
}


/*
    Registration

    Before trash.js registers the trash bin, so this entry comes first in the
    sidebar - right above the bin.
*/
registerSpecialView(SHARE_VPATH, {
    icon: "sharedWithMe",
    labelKey: "share/title",
    labelFallback: "Shared with me",
    sidebar: true,
    root: SHARE_ROOT,
    allows: sharedDriveAllows,
    refusal: sharedDriveRefusal,
    prepare: prepareSharedListing,
    empty: renderSharedEmpty
});


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.openSharedItemPage = openSharedItemPage;
window.isSharePath = isSharePath;
