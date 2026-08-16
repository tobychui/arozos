/*
    pathbar.js

    Address bar, breadcrumb and directory navigation (back / parent / root / home).

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

// ============================== PATH SHORTCUT RESOLUTION ====================
var pathShortcuts = {
    "%appdata%": "user:/.appdata/",
};

function resolvePathShortcut(path){
    var lower = path.trim().toLowerCase();
    if (pathShortcuts[lower] !== undefined){
        return pathShortcuts[lower];
    }
    return path;
}

function previosPath(){
    //Remove the current directory from history
    if (viewHistory.length == 0){
        //This is already the first page
        return;
    }
    //Remember where we were so Forward can replay it
    forwardHistory.push(currentPath);
    var previousPath = viewHistory.pop();
    listDirectory(previousPath, undefined, false);
}

/*
    Forward is new in the redesign. viewHistory has always been a back-only
    stack, so Forward needs its own: previosPath() pushes onto it, and any
    navigation that is not a Back discards it (listDirectory clears it when
    recordUndo is true), which is what a browser does.
*/
function forwardPath(){
    if (forwardHistory.length == 0){
        return;
    }
    var nextPath = forwardHistory.pop();
    //Record the page we are leaving so Back still works afterwards
    viewHistory.push(currentPath);
    listDirectory(nextPath, undefined, false);
}


function parentDir(){
    //If under searchmode, parentDir go back to the currentPath
    if (searchMode){
        hideSearchBar();
        return;
    }
    //Check if there are any parent dir for this path
    if (checkIfParentDirExists(currentPath)){
        //There are parent path. Get it from currentPath
        pathInfo = currentPath.split("/");
        pathInfo.pop();
        var parentFolderName = pathInfo.pop();
        parentPath = pathInfo.join("/") + "/"
        
        //List the parentDir
        listDirectory(parentPath, function(){
            focusFileObject(parentFolderName);
        });
        
    }

}

function rootDir(){
    //Go to the root dir of the current path
    var rootDir = currentPath.split("/").shift();
    rootDir = rootDir + "/";
    listDirectory(rootDir);
}

function showEditCurrentPathInput(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    pathInputMode = true;
    $("#pathInputField").find("input").val(currentPath);
    $("#editPathBtn").hide();
    if (isMobile){
        $("#mobilePathDisplay").hide();
        $(".mobilePathDisplayWrapper").append($("#pathInputField"));
    }else{
        //Desktop
        $("#pathDisplayField").hide();
    }
    $("#pathInputField").show();
    $("#pathInputField").find("input").focus();
    
}

function handleOpenPathKeydown(e){
    if (e.key == "enter" | e.keyCode == 13){
        //Etner pressed
        openEnteredPath($("#pathInputField").find("button"));
    }
}

function openEnteredPath(object){
    var newPath = $(object).parent().find("input").val();
    //Filter out the path
    newPath = newPath.split("\\").join("/");
    listDirectory(newPath);
    hideManualOpenPathInput();

}

function hideManualOpenPathInput(){
    $("#pathInputField").hide();
    pathInputMode = false;
    if (isMobile){
        $("#mobilePathDisplay").show();
    }else{
        $("#pathDisplayField").show();
    }
    
    //Restore the edit btn
    $("#editPathBtn").show();
}

function checkIfParentDirExists(path){
    if (path.includes("/")){
        pathInfo = path.split("/");
        if (pathInfo[1] == ""){
            return false;
        }else{
            return true;
        }
    }else{
        return false;
    }
}

function openHomeDir(){
    listDirectory("user:/", function(){
        hideManualOpenPathInput();
        hideSearchBar();
    })
}

function updatePathDisplay(path){
    var pathInfo = path.split("/");
    var vdID = pathInfo[0];
    //As path always end with /, pop the empty pathinfo from array
    pathInfo.pop();
    var l = pathInfo.length;
    //Append the starting vdir
    $(".pathDisplay").html("");
    $(".pathDisplay").append(`<div class="section selectable" onclick="event.stopImmediatePropagation(); rootDir();"><i class="folder icon"></i> ${vdID}</div>`);
    $(".pathDisplay").append(`<div class="divider">/</div>`);
    let domPathChunks = [];
    let thisPath = vdID + "/";
    for(var i = 1; i < pathInfo.length; i++){
        let thisname = pathInfo[i];
        thisPath += thisname + "/";
        let pathHighlight = "";
        if (i < pathInfo.length - 1){
            pathHighlight = pathInfo[i + 1];
        }
        domPathChunks.push(`<div class="section selectable" onclick="event.stopImmediatePropagation(); listDirectoryAndHighlight('${thisPath}', '${pathHighlight}');">${shortenLongFoldername(thisname, 20)}</div>`);
    }

    let fullpath = domPathChunks.join(`<div class="divider">/</div>`);
    let targetDisplayDOM = $("#pathDisplayField");
    if (isMobile){
        targetDisplayDOM = $("#mobilePathDisplay");
    }
    $(targetDisplayDOM).append(`<div id="pre-render" class="measure">${fullpath}</div>`);
    let pathWidth = $("#pre-render").width();
    let pathFieldWidth = $(targetDisplayDOM).width();
    let counter = 0;

    //Check for a combination that just fit the path bar
    while(pathWidth > (pathFieldWidth - 80) && counter < l-2){
        //Drop the first segment, only keep last one in extreme cases
        domPathChunks.shift();
        fullpath = `<div class="section">...</div><div class="divider">/</div>` + domPathChunks.join(`<div class="divider">/</div>`);
        $("#pre-render").html(fullpath);
        pathWidth = $("#pre-render").width();
        counter++;
    }
    //Render the final address into a visiable field
    $("#pre-render").remove();
    $(targetDisplayDOM).append(fullpath);

    //Update the manual input field as well
    $("#pathInputField").find("input").val(path);
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.handleOpenPathKeydown = handleOpenPathKeydown;
window.openEnteredPath = openEnteredPath;
window.openHomeDir = openHomeDir;
window.parentDir = parentDir;
window.previosPath = previosPath;
window.rootDir = rootDir;
window.showEditCurrentPathInput = showEditCurrentPathInput;
