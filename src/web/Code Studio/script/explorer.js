/*
    Code Studio — explorer

    The project folder tree, its context menu and every file system
    operation reachable from it.
*/

/* ═══════════════════════════════════════════════════════════════════
   Icons
   ═══════════════════════════════════════════════════════════════════ */

var CS_SPECIAL_FOLDERS = ['src', 'lib', 'test', 'tests', 'spec', 'config', 'public', 'static',
    'assets', 'images', 'img', 'css', 'styles', 'js', 'scripts', 'components',
    'views', 'pages', 'templates', 'models', 'controllers', 'api', 'routes',
    'middleware', 'utils', 'helpers', 'vendor', 'node_modules', 'build',
    'dist', 'out', 'bin', 'docs', 'documentation', 'backend', 'frontend',
    'server', 'client', 'database', 'db', 'migrations', 'seeds'];

var CS_COLOURED_EXT = ['js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass',
    'less', 'json', 'xml', 'md', 'py', 'go', 'java', 'c', 'cpp', 'cs', 'php',
    'rb', 'rs', 'swift', 'sh', 'bash', 'sql', 'vue', 'agi', 'yaml', 'yml',
    'toml', 'ini', 'env', 'gitignore', 'dockerfile'];

function getFolderIconClass(folderName){
    var name = String(folderName).toLowerCase();
    return CS_SPECIAL_FOLDERS.indexOf(name) !== -1 ? name : "";
}

function getFileIconClass(ext){
    ext = String(ext).toLowerCase();
    return CS_COLOURED_EXT.indexOf(ext) !== -1 ? ("file-icon-" + ext) : "";
}

/* ═══════════════════════════════════════════════════════════════════
   Tree rendering
   ═══════════════════════════════════════════════════════════════════ */

function renderTreeEntries(entries){
    var folders = [];
    var files = [];

    (entries || []).forEach(function(entry){
        var filename = entry.Filename;
        var filepath = entry.Filepath;
        var ext = filename.split(".").pop();

        if (entry.IsDir){
            folders.push(
                '<div class="folderObjectWrapper" data-path="' + escapeHTMLText(filepath) + '" ' +
                     'data-name="' + escapeHTMLText(filename) + '" data-isdir="true" ' +
                     'ondragover="folderDragOver(event)" ondragleave="folderDragLeave(event)" ondrop="folderDrop(event)">' +
                    '<div class="row" data-path="' + escapeHTMLText(filepath) + '" data-name="' + escapeHTMLText(filename) + '" ' +
                         'data-isdir="true" title="' + escapeHTMLText(filepath) + '" ' +
                         'onclick="listfolder(this);" oncontextmenu="showFolderContextMenu(event, this);">' +
                        '<span class="caret"><i class="caret right icon"></i></span>' +
                        '<i class="folder icon folder-icon ' + getFolderIconClass(filename) + '"></i>' +
                        '<span class="name">' + escapeHTMLText(filename) + '</span>' +
                    '</div>' +
                '</div>');
        } else {
            files.push(
                '<div class="row" data-path="' + escapeHTMLText(filepath) + '" data-name="' + escapeHTMLText(filename) + '" ' +
                     'data-isdir="false" title="' + escapeHTMLText(filepath) + '" draggable="true" ' +
                     'ondragstart="directoryFileDrag(event)" ' +
                     'onclick="openFileViaDirectoryExplorer(this, event);" ' +
                     'oncontextmenu="showFolderContextMenu(event, this);">' +
                    '<span class="caret"></span>' +
                    '<i class="' + ao_module_utils.getIconFromExt(ext) + ' icon ' + getFileIconClass(ext) + '"></i>' +
                    '<span class="name">' + escapeHTMLText(filename) + '</span>' +
                '</div>');
        }
    });

    return folders.join("") + files.join("");
}

function openProjectFolder(filedata, rewriteHash = true, restoreSession = true){
    if (!filedata || filedata.length == 0) return;

    var folderpath = filedata[0].filepath;
    var foldername = filedata[0].filename;
    currentProjectFolder = folderpath;

    $("#openFolderTitle").text(foldername);
    $("#directoryExplorer").html('<div class="emptyhint">Loading&hellip;</div>');

    $.get("../system/file_system/listDir?dir=" + encodeURIComponent(folderpath), function(data){
        $("#directoryExplorer").html(renderTreeEntries(data));
        refreshGitStatus();
        pushRecentFolder(folderpath, foldername);
        //Bring back the tabs this project had open the last time round
        if (restoreSession) restoreProjectSession(folderpath);
    }).fail(function(){
        $("#directoryExplorer").html('<div class="emptyhint">Unable to read this folder.</div>');
    });

    if (rewriteHash){
        var currentState = getHashObject();
        currentState["folder"] = folderpath;
        writeHashObject(currentState);
    }

    updateFileStatusDisplay(getCurrentFocusedFileData() ? getCurrentFocusedFileData().filepath : null);
}

function closeProjectFolder(){
    currentProjectFolder = null;
    $("#openFolderTitle").text("No Folder Opened");
    $("#directoryExplorer").html(
        '<div class="emptyhint">No folder is open.' +
        '<button class="ui tiny button" onclick="openFolderWithSelector();">Open Folder</button></div>');

    var currentState = getHashObject();
    delete currentState["folder"];
    writeHashObject(currentState);

    $("#scmBadge").hide();
    $("#sbBranch").hide();
    $("#scmBody").html('<div class="emptyhint">Open a project folder to see its repository.</div>');
}

function listfolder(folderRow){
    var wrapper = $(folderRow).parent();
    var folderPath = $(folderRow).data("path");
    var existingList = wrapper.children(".dirlist");

    if (existingList.length == 0){
        wrapper.append('<div class="dirlist"></div>');
        $(folderRow).find(".caret i").attr("class", "caret down icon");
        $(folderRow).find(".folder.icon").addClass("open");

        $.get("../system/file_system/listDir?dir=" + encodeURIComponent(folderPath), function(data){
            wrapper.children(".dirlist").html(renderTreeEntries(data));
            refreshGitDecorations();
        });
        return;
    }

    //Already loaded — collapse or expand it
    if ($(folderRow).find(".caret .down").length > 0 || $(folderRow).find("i.caret.down").length > 0){
        existingList.slideUp("fast");
        $(folderRow).find(".caret i").attr("class", "caret right icon");
        $(folderRow).find(".folder.icon").removeClass("open");
    } else {
        existingList.slideDown("fast");
        $(folderRow).find(".caret i").attr("class", "caret down icon");
        $(folderRow).find(".folder.icon").addClass("open");
    }
}

function openFileViaDirectoryExplorer(object, event){
    $("#directoryExplorer .row").removeClass("selected");
    $(object).addClass("selected");
    openFile($(object).data("path"));
}

function refreshFolderTree(){
    if (!currentProjectFolder) return;
    openProjectFolder([{
        filename: $("#openFolderTitle").text(),
        filepath: currentProjectFolder
    }], false);
}

/* ═══════════════════════════════════════════════════════════════════
   Context menu
   ═══════════════════════════════════════════════════════════════════ */

function showFolderContextMenu(event, element){
    event.preventDefault();
    event.stopPropagation();

    selectedFolderItem = {
        element: element,
        path: $(element).data("path"),
        name: $(element).data("name"),
        isDir: String($(element).data("isdir")) === "true"
    };

    $("#directoryExplorer .row").removeClass("selected");
    $(element).addClass("selected");

    var items = [
        { label: "New File",   tip: "Ctrl+N", action: "newFileInFolder()" },
        { label: "New Folder", action: "newFolderInFolder()" },
        { divider: true },
        { label: "Open",           action: "openSelectedItem()", disabled: selectedFolderItem.isDir },
        { label: "Open to the Side", action: "openSelectedItemToSide()", disabled: selectedFolderItem.isDir },
        { divider: true },
        { label: "Rename", tip: "F2",  action: "renameSelectedItem()" },
        { label: "Delete", tip: "Del", action: "deleteSelectedItem()" },
        { divider: true },
        { label: "Compare With…", action: "compareSelectedItem()" },
        { divider: true },
        { label: "Copy Path", action: "copyFilePath()" },
        { label: "Reveal in File Manager", action: "revealInFileManager()" }
    ];

    showFloatingMenu("#folderContextMenu", items, event.clientX, event.clientY);
}

function showDirectoryExplorerContextMenu(event){
    if ($(event.target).attr("id") !== "directoryExplorer") return;
    if (!currentProjectFolder) return;

    event.preventDefault();
    event.stopPropagation();

    selectedFolderItem = {
        element: null,
        path: currentProjectFolder,
        name: $("#openFolderTitle").text(),
        isDir: true
    };

    var items = [
        { label: "New File",   action: "newFileInFolder()" },
        { label: "New Folder", action: "newFolderInFolder()" },
        { divider: true },
        { label: "Refresh Explorer", action: "refreshFolderTree()" },
        { label: "Forget Saved Tabs", action: "forgetProjectSession()" },
        { label: "Close Folder",     action: "closeProjectFolder()" }
    ];

    showFloatingMenu("#folderContextMenu", items, event.clientX, event.clientY);
}

function hideFolderContextMenu(){
    $("#folderContextMenu").hide();
}

function openSelectedItem(){
    if (!selectedFolderItem || selectedFolderItem.isDir) return;
    openFile(selectedFolderItem.path);
}

function openSelectedItemToSide(){
    if (!selectedFolderItem || selectedFolderItem.isDir) return;
    var path = selectedFolderItem.path;
    if (editors.length < 2){
        splitEditor();
        //The new group boots asynchronously — open once Monaco reports back
        setTimeout(function(){ openFile(path, true, editors[editors.length - 1]); }, 400);
    } else {
        openFile(path, true, editors[editors.length - 1]);
    }
}

function compareSelectedItem(){
    if (!selectedFolderItem) return;
    openTool("compare", undefined, {
        type: selectedFolderItem.isDir ? "folder" : "pick",
        left: selectedFolderItem.path,
        right: ""
    });
}

/* ═══════════════════════════════════════════════════════════════════
   File operations
   ═══════════════════════════════════════════════════════════════════ */

//Folder that a new item should be created in, based on the current selection
function targetFolderForNewItem(){
    var targetPath = currentProjectFolder;
    if (selectedFolderItem){
        if (selectedFolderItem.isDir){
            targetPath = selectedFolderItem.path;
        } else {
            var parts = selectedFolderItem.path.split("/");
            parts.pop();
            targetPath = parts.join("/");
        }
    }
    return targetPath;
}

function joinVirtualPath(folder, name){
    if (!folder.endsWith("/")) folder += "/";
    return folder + name;
}

function newFileInFolder(){
    if (!currentProjectFolder){
        newUntitledFile();
        return;
    }

    var filename = prompt("Enter new file name:", "newfile.txt");
    if (!filename || filename.trim() == "") return;

    var filepath = joinVirtualPath(targetFolderForNewItem(), filename.trim());
    ao_module_agirun("Code Studio/backend/fileOps.agi", { opr: "newFile", filepath: filepath }, function(result){
        if (result.error){
            alert("Failed to create file: " + result.error);
            return;
        }
        refreshFolderTree();
        openFile(filepath);
        setStatusMessage("checkmark", "File created");
    });
}

function newFolderInFolder(){
    if (!currentProjectFolder){
        alert("Open a project folder first.");
        return;
    }

    var foldername = prompt("Enter new folder name:", "NewFolder");
    if (!foldername || foldername.trim() == "") return;

    var folderpath = joinVirtualPath(targetFolderForNewItem(), foldername.trim());
    ao_module_agirun("Code Studio/backend/fileOps.agi", { opr: "newFolder", folderpath: folderpath }, function(result){
        if (result.error){
            alert("Failed to create folder: " + result.error);
            return;
        }
        refreshFolderTree();
        setStatusMessage("checkmark", "Folder created");
    });
}

function renameSelectedItem(){
    if (!selectedFolderItem) return;

    var newName = prompt("Enter new name:", selectedFolderItem.name);
    if (!newName || newName.trim() == "" || newName == selectedFolderItem.name) return;

    var oldPath = selectedFolderItem.path;
    var parts = oldPath.split("/");
    parts.pop();
    var newPath = parts.join("/") + "/" + newName.trim();

    ao_module_agirun("Code Studio/backend/fileOps.agi", { opr: "rename", oldpath: oldPath, newpath: newPath }, function(result){
        if (result.error){
            alert("Failed to rename: " + result.error);
            return;
        }
        refreshFolderTree();
        updateOpenTabsAfterRename(oldPath, newPath);
        setStatusMessage("checkmark", "Renamed");
    });
}

function deleteSelectedItem(){
    if (!selectedFolderItem) return;

    var itemType = selectedFolderItem.isDir ? "folder" : "file";
    if (!confirm("Are you sure you want to delete this " + itemType + "?\n" + selectedFolderItem.name)) return;

    ao_module_agirun("Code Studio/backend/fileOps.agi", { opr: "delete", filepath: selectedFolderItem.path }, function(result){
        if (result.error){
            alert("Failed to delete: " + result.error);
            return;
        }
        closeTabsWithPath(selectedFolderItem.path);
        refreshFolderTree();
        setStatusMessage("checkmark", "Deleted");
    });
}

function copyFilePath(){
    if (!selectedFolderItem) return;
    copyToClipboard(selectedFolderItem.path, function(copied){
        if (copied){
            setStatusMessage("copy", "Path copied to clipboard");
        } else {
            //Nothing reached the clipboard — at least let the user read the path
            prompt("Copy the path below:", selectedFolderItem.path);
        }
    });
}

function revealInFileManager(){
    if (!selectedFolderItem) return;
    var parts = selectedFolderItem.path.split("/");
    var filename = parts.pop();
    ao_module_openPath(parts.join("/"), filename);
}

function updateOpenTabsAfterRename(oldPath, newPath){
    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){
            if (!tab.filepath) return;
            if (tab.filepath === oldPath || tab.filepath.startsWith(oldPath + "/")){
                tab.filepath = tab.filepath.replace(oldPath, newPath);
                tab.filename = tab.filepath.split("/").pop();
            }
        });
    });
    renderAllTabs();
}

function closeTabsWithPath(path){
    editors.slice().forEach(function(entry){
        entry.tabs.slice().forEach(function(tab){
            if (!tab.filepath) return;
            if (tab.filepath === path || tab.filepath.startsWith(path + "/")){
                closeTabWithUUIDAndEditorID(tab.tabUUID, entry.uuid);
            }
        });
    });
}

function renderAllTabs(){
    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){
            var selector = '[uuid="' + tab.tabUUID + '"]';
            $(".tabs .item" + selector).attr("filepath", tab.filepath || "").attr("title", tab.filepath || tab.filename);
            $(".tabs .item" + selector + " .tabFilename, #openeditors .row" + selector + " .tabFilename").text(tab.filename);
        });
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Drag and drop inside the tree
   ═══════════════════════════════════════════════════════════════════ */

function folderDragOver(event){
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).addClass("drag-over");
}

function folderDragLeave(event){
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).removeClass("drag-over");
}

function folderDrop(event){
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).removeClass("drag-over");

    var sourcePath = event.dataTransfer.getData("filepath");
    var sourceFilename = event.dataTransfer.getData("filename");
    var destFolder = $(event.currentTarget).data("path");
    if (!sourcePath || !destFolder) return;

    var sourceParts = sourcePath.split("/");
    sourceParts.pop();
    if (sourceParts.join("/") === destFolder) return;    //same folder, nothing to do

    moveFileToFolder(sourcePath, sourceFilename, destFolder);
}

function directoryExplorerDrop(event){
    event.preventDefault();
    event.stopPropagation();
    $("#directoryExplorer").removeClass("drag-over");

    var sourcePath = event.dataTransfer.getData("filepath");
    var sourceFilename = event.dataTransfer.getData("filename");
    if (!sourcePath || !currentProjectFolder) return;

    moveFileToFolder(sourcePath, sourceFilename, currentProjectFolder);
}

function moveFileToFolder(sourcePath, sourceFilename, destFolder){
    ao_module_agirun("Code Studio/backend/fileOps.agi", {
        opr: "move",
        sourcepath: sourcePath,
        destfolder: destFolder
    }, function(result){
        if (result.error){
            alert("Failed to move: " + result.error);
            return;
        }
        refreshFolderTree();
        updateOpenTabsAfterRename(sourcePath, joinVirtualPath(destFolder, sourceFilename));
        setStatusMessage("checkmark", "Moved");
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Explorer keyboard shortcuts
   ═══════════════════════════════════════════════════════════════════ */

$(document).on("keydown", function(event){
    //Only act when the tree, not an editor or a text field, has the focus
    if ($(event.target).is("input, textarea")) return;
    if (!selectedFolderItem) return;
    if ($("#directoryExplorer .row.selected").length == 0) return;

    if (event.key === "F2"){
        event.preventDefault();
        renameSelectedItem();
    } else if (event.key === "Delete"){
        event.preventDefault();
        deleteSelectedItem();
    }
});

$(document).ready(function(){
    $("#directoryExplorer").attr("ondragover", "allowDrop(event)");
    $("#directoryExplorer").attr("ondrop", "directoryExplorerDrop(event)");
});
