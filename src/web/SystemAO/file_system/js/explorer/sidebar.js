/*
    sidebar.js

    Left directory sidebar: system info and the user / storage root lists.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Get the system ID and ip address from the system id services
function initSystemInfo(){
    $.get("../../system/id/requestInfo",function(data){
        if (data.error !== undefined){
            msgbox("red remove", data.error);
        }else{
            systemUUID = data.SystemUUID;
        }
    });
}

//Initiate the sidebar contents 
function initRootDirs(){
    //Load user directories
    $.ajax({
        url:"../../system/file_system/listRoots?user=true",
        success: function(data){
            $("#userroot").html("");
            for (var i =0; i < data.length; i++){
                var thisRootObject = data[i];
                if (thisRootObject.IsDir == true && !(thisRootObject.Filename == ".cache" || thisRootObject.Filename == ".trash")){
                    //Files will not be listed in the root directory list
                    var specifcRootInfo = getUserRootIcons(thisRootObject.Filename);
                    var icon = specifcRootInfo[0];
                    var displayName = specifcRootInfo[1];
                    var vpath = thisRootObject.Filepath;
                    let art = getRootIconArt(thisRootObject.Filename);
                    $("#userroot").append(`<div class="dir item userrootfolder fsSideItem" filepath="${vpath}" type="folder" onclick="openthis(this);"><span class="fsSideIcon" style="color:${art[1]}">${art[0]}</span><span class="fsSideLabel">${displayName}</span></div>`);
                }
            }
        }   
    });

    //Load other storage devices
    $.ajax({
        url:"../../system/file_system/listRoots",
        success: function(data){
            $("#storageroot").html("");
            for (var i =0; i < data.length; i++){
                var thisRoot = data[i];
                var displayName = thisRoot.RootName;
                var rootPath = thisRoot.RootPath;
                $("#storageroot").append(`<div class="dir item vroot fsSideItem" filepath="${rootPath}" type="folder" rootname="${displayName}" onclick="openthis(this);"><span class="fsSideIcon" style="color:var(--fs-icon)">${FSIcons.drive}</span><span class="fsSideLabel">${displayName} (${rootPath})</span></div>`);
            }
            /*
                The trash bin and anything like it sit below the devices but are
                not devices: they are views, not mounted roots, so they come
                from the special view registry rather than from listRoots. The
                divider that separates the two kinds is part of that block.
            */
            $("#storageroot").append(renderSpecialViewSidebarEntries());

            highlightCurrentRoot();
        }
    });
}

function highlightCurrentRoot(){
    //Highlight the target vroot name on the side bar
    $(".vroot.active").removeClass("active");

    //A special view has no root path to match on, so it is handled up front
    let specialView = getSpecialView(currentPath);
    if (specialView != null){
        $(".fmSpecialSideItem").each(function(){
            if (getSpecialView($(this).attr("filepath")) === specialView){
                $(this).addClass("active");
            }
        });
        return;
    }
    $(".vroot").each(function(){
        let rootname = $(this).attr("filepath");
        if ((currentPath.toLowerCase()).startsWith((rootname.toLowerCase()))){
            //This is the root we are currently in
            $(this).addClass("active");
        }
    });
}


function getUserRootIcons(foldername){
    var icon = "folder open";
    var name = foldername;
    foldername = foldername.toLowerCase();
    if (foldername == "desktop"){
        icon = "computer";
        name = applocale.getString("sidebar/vroot/desktop", name);
    }else if (foldername == "document"){
        icon = "file text outline";
        name = applocale.getString("sidebar/vroot/document", name);
    }else if (foldername == "music" || foldername == "audio"){
        icon = "music";
        name = applocale.getString("sidebar/vroot/music", name);
    }else if (foldername == "photo" || foldername == "picture"){
        icon = "image";
        name = applocale.getString("sidebar/vroot/photo", name);
    }else if (foldername == "video" || foldername == "film"){
        icon = "video";
        name = applocale.getString("sidebar/vroot/video", name);
    }else if (foldername == "trash" || foldername == "bin" || foldername == "rubbish"){
        icon = "trash"
        name = applocale.getString("sidebar/vroot/trash", name);
    }else if (foldername == "download"){
        icon = "download"
        name = applocale.getString("sidebar/vroot/download", name);
    }else if (foldername == "www" || foldername == "web" || foldername == "mysite"){
        icon = "globe"
        name = applocale.getString("sidebar/vroot/web", name);
    }else if (foldername == "model"){
        icon = "cube"
        name = applocale.getString("sidebar/vroot/model", name);
    }else if (foldername == "appdata"){
        icon = "code"
        name = applocale.getString("sidebar/vroot/appdata", name);
    }
    return [icon, name];
}

$("#directorySidebar").on("click",function(evt){
    //Clear the button holding
    $(".fileObject.selected").removeClass("selected");
    shiftHold = false;
    ctrlHold = false;
    updateCtrlDisplay();

    if (renameMode){
        exitRenameModeWithConfirm();
    }
});


/*
    Drawn icon + colour for a user virtual root, matching the File Selector's
    sidebar. Falls back to a plain folder for anything unrecognised.
*/
function getRootIconArt(foldername){
    let key = String(foldername).toLowerCase();
    let map = {
        "desktop":  [FSIcons.desktop,  "#1a73e8"],
        "document": [FSIcons.document, "#1a73e8"],
        "music":    [FSIcons.music,    "#e8467c"],
        "audio":    [FSIcons.music,    "#e8467c"],
        "photo":    [FSIcons.image,    "#2aa3d4"],
        "picture":  [FSIcons.image,    "#2aa3d4"],
        "video":    [FSIcons.video,    "#8b5cf6"],
        "film":     [FSIcons.video,    "#8b5cf6"],
        "download": [FSIcons.download, "#1a73e8"],
        "trash":    [FSIcons.trash,    "#5f6368"],
        "www":      [FSIcons.globe,    "#0f9d94"],
        "web":      [FSIcons.globe,    "#0f9d94"],
        "model":    [FSIcons.cube,     "#7c4dff"],
        "appdata":  [FSIcons.code,     "#5f6368"]
    };
    return map[key] || [FSIcons.folder, "#f0b429"];
}
