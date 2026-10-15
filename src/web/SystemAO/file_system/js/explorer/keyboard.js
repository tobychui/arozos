/*
    keyboard.js

    Global keyboard shortcuts and arrow-key navigation.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Keyboard hotkey events
$(document).keydown(function(event){
    if ($(':focus').is("input")){
        //Do not block operations on input fields.
        if (event.which == 27){
            //Cancel the operation
            if (searchMode){
                //Exit search mode
                hideSearchBar();
            }else if (pathInputMode){
                //Path input mode. Hide the path input
                hideManualOpenPathInput();
            }
        }
        return;
    }

    //Trust the modifier state on the event itself: the modifier's own keydown
    //may have gone to another frame (e.g. the desktop around this window)
    if (hasPrimaryModifier(event)){
        ctrlHold = true;
    }

    if(isPrimaryModifierKey(event)){
        ctrlHold = true;
        updateCtrlDisplay();
    }else if (event.which == 16){
        shiftHold = true;
        updateCtrlDisplay();
    }else if (event.which == 67 && ctrlHold == true){
        //Ctrl + C
        if (!$(".popup").is(":visible")){
            if ($(lastClickedElement).closest("#propertiesView").length > 0){
                //Inside the file properties View
                return;
            }
            event.preventDefault();
            copy();
        } 
    }else if (event.which == 88 && ctrlHold == true){
        //Ctrl + X
        if (!$(".popup").is(":visible")){
            if ($(lastClickedElement).closest("#propertiesView").length > 0){
                //Inside the file properties View
                return;
            }
            event.preventDefault();
            cut();
        }
    }else if (event.which == 65 && ctrlHold == true){
        //Ctrl + A
        if ($(lastClickedElement).closest("#propertiesView").length > 0){
            //Inside the file properties View
            return;
        }
        event.preventDefault();
        $(".fileObject").addClass("selected");
        updateSelectedObjectsCount();
    }else if (event.which == 78 && shiftHold == true){
        //Shift + N, Open new file manager window with current path
        event.preventDefault();
        openPathInNewWindow(currentPath);

    }else if (event.which == 86 && ctrlHold == true){
        if (!$(".popup").is(":visible")){
            if ($(lastClickedElement).closest("#propertiesView").length > 0){
                //Inside the file properties View
                return;
            }
            paste();
        } 
    }else if (event.which == 46 && shiftHold == true){
        //Shift + delete
        forceDelete();
    }else if (event.which == 46){
        //Delete
        deleteFile();
    }else if (event.which == 8 && isMacOS && ctrlHold == true){
        //Mac keyboards have no Delete key: Cmd + Backspace moves to trash and
        //Cmd + Option + Backspace deletes immediately, as in Finder
        event.preventDefault();
        if (event.altKey){
            forceDelete();
        }else{
            deleteFile();
        }
    }else if (event.which == 38){
        //Up Arrow
        if ($(".popup:visible").length == 0){
            //No popup visiable
            if (ctrlHold == true){
                //Parenet path
                parentDir();
            }else{
                //Select the file on the upper
                selectPreviousFile(event);
            }
        }
    }else if (event.which == 40){
        //Down arrow
        if ($(".popup:visible").length == 0){
            //No popup visiable
            if (isMacOS && ctrlHold == true){
                //Cmd + Down opens the selection, as in Finder
                event.preventDefault();
                if ($(".fileObject.selected").length > 0){
                    openViaButton();
                }
            }else{
                selectNextFile(event);
            }
        }
    }else if (event.which == 39){
        //Right arrow
        if ($(".popup:visible").length == 0 && viewMode == "grid"){
            //No popup visiable and grid mode
            selectRightFile(event);
        }
    }else if (event.which == 37){
        //Left arrow
        if ($(".popup:visible").length == 0 && viewMode == "grid"){
            //No popup visiable and grid mode
            selectLeftFile(event);
        }
    }else if (event.which == 13){
        //Enter key
        if ($(".fileObject.selected").length > 0){
            openViaButton();
        }else if ($(".fileObject.hotSearchHighlight").length > 0 && $(".fileObject.selected").length == 0){
            //Hot search selection mode

        }
    }else if (event.which == 27){
        //Esc key
        hideAllPopupWindows();
        $(".fileObject.selected").removeClass("selected");

    }else{
        //Handle generic file search by consecutive typing. Only plain printable
        //keys count: a browser shortcut (Cmd + R, Cmd + L ...) or a lone
        //modifier must not wipe the selection or end up in the search buffer
        if (event.key == undefined || event.key.length != 1 || event.ctrlKey || event.metaKey || event.altKey){
            return;
        }
        if (hotSearchTimer != null){
            clearTimeout(hotSearchTimer);
        }
        $(".fileObject.selected").removeClass("selected");
        hotSearchTimer = setTimeout(function(){
            exitHotSearch();
        }, 1000);

        if (hotSearchBuffer.length > 0 && event.key == hotSearchBuffer.substr(hotSearchBuffer.length - 1, 1)){
            //Jump to next result
            hotSearchOffsetIndex++;
        }else{
            hotSearchOffsetIndex = 0;
            hotSearchBuffer+= event.key;
        }
        
        handleHotSearch(hotSearchBuffer, hotSearchOffsetIndex);
    }
});

$(document).keyup(function(event){
    if(isPrimaryModifierKey(event)){
        if (!stickyMultiSelect){
            ctrlHold = false;
        }
        updateCtrlDisplay();
    }else if (event.which == 16){
        shiftHold = false;
        updateCtrlDisplay();
    }
});

/*
    A modifier released while this window is not focused never sends its keyup
    here - most often Cmd + Tab on a Mac (or Alt + Tab), which would otherwise
    leave every later click adding to the selection. Mobile multi-select also
    lives in ctrlHold, so it is left alone.
*/
$(window).on("blur", function(){
    if (isMobile){
        return;
    }
    if (ctrlHold || shiftHold){
        ctrlHold = false;
        shiftHold = false;
        updateCtrlDisplay();
    }
});

function selectNextFile(e){
    e.preventDefault();
    //Check if there are no selection. If yes, select the first file object
    if ($(".fileObject.selected").length == 0 && $(".fileObject").length > 0){
        //Select the first file object
        $($(".fileObject")[0]).addClass("selected");
        return
    }else if ( $(".fileObject").length == 0){
        //No file in this folder
        return
    }

    //Already contain selected file on the interface. Seleect it
    var baseObject = $($(".fileObject.selected")[0]);
    if ($(".fileObject.selected").length > 1){
        $(".fileObject.selected").removeClass("selected");
    }
    if (viewMode == "list" || viewMode == "details"){
        //Select the next file
        var nextObject = $(".fileObject").eq( $(".fileObject").index( $(baseObject) ) + 1 );
        if (nextObject.length > 0){
            nextObject.addClass("selected");
            scrollToFileObject(nextObject);
            $(baseObject).removeClass("selected");
        }
    }else if (viewMode == "grid"){
        var colobj = getFileObjectInTheSameCol(baseObject);
        var nextObject = baseObject;
        for (var i = 0; i < colobj.length; i++){
            if ($(colobj[i]).hasClass("selected") && i != colobj.length - 1){
                nextObject = colobj[i + 1];
            }
        }

        $(baseObject).removeClass("selected");
        nextObject.addClass("selected");
        scrollToFileObject(nextObject);
    }

    if (propertiesView){
        let selectedFile = $(".fileObject.selected")[0];
        let filepath = $(selectedFile).attr('filepath');
        loadFileProperties(filepath);
    }
    
}

function selectPreviousFile(e){
    e.preventDefault();
    //Check if there are no selection. If yes, select the first file object
    if ($(".fileObject.selected").length == 0 && $(".fileObject").length > 0){
        //Select the first file object
        $($(".fileObject")[$(".fileObject").length - 1]).addClass("selected");
        return
    }else if ( $(".fileObject").length == 0){
        //No file in this folder
        return
    }

    var baseObject = $($(".fileObject.selected")[0]);
    if ($(".fileObject.selected").length > 1){
        $(".fileObject.selected").removeClass("selected");
    }
    if (viewMode == "list" || viewMode == "details"){
        //Select the previous file
        if ($(".fileObject").index( $(baseObject) ) -1 < 0){
            return;
        }
        var previousObject = $(".fileObject").eq( $(".fileObject").index( $(baseObject) ) -1 );
        if (previousObject.length > 0){
            previousObject.addClass("selected");
            scrollToFileObject(previousObject);
            $(baseObject).removeClass("selected");
        }
        
    
    }else if (viewMode == "grid"){
        var colobj = getFileObjectInTheSameCol(baseObject);
        var prevObj = baseObject;
        for (var i = 0; i < colobj.length; i++){
            if ($(colobj[i]).hasClass("selected") && i > 0){
                prevObj = colobj[i - 1];
            }
        }

        $(baseObject).removeClass("selected");
        prevObj.addClass("selected");
        scrollToFileObject(prevObj);
    }

    if (propertiesView){
        let selectedFile = $(".fileObject.selected")[0];
        let filepath = $(selectedFile).attr('filepath');
        loadFileProperties(filepath);
    }
}

function scrollToFileObject(fileObject){
    if (viewMode == "grid"){
        $('#folderView').scrollTop($(fileObject)[0].offsetTop - ($("#directorySidebar").height()/2 - 340));
    }else{
        $('#folderView').scrollTop($(fileObject)[0].offsetTop - ($("#directorySidebar").height()/2 - 140));
    }
}

//Grid mode left right opr
function selectLeftFile(e){
    e.preventDefault();
    if (viewMode != "grid"){
        return;
    }

    if ($(".fileObject.selected").length == 0 && $(".fileObject").length > 0){
        //Select the first file object
        $($(".fileObject")[$(".fileObject").length - 1]).addClass("selected");
        return
    }else if ( $(".fileObject").length == 0){
        //No file in this folder
        return
    }

    var baseObject = $($(".fileObject.selected")[0]);
    if ($(".fileObject").index( $(baseObject) ) -1 < 0){
        return;
    }
    var previousObject = $(".fileObject").eq( $(".fileObject").index( $(baseObject) ) -1 );
    if (previousObject.length > 0){
        previousObject.addClass("selected");
        scrollToFileObject(previousObject);
        $(baseObject).removeClass("selected");
    }

    if (propertiesView){
        let selectedFile = $(".fileObject.selected")[0];
        let filepath = $(selectedFile).attr('filepath');
        loadFileProperties(filepath);
    }
}

function selectRightFile(e){
    e.preventDefault();
    if (viewMode != "grid"){
        return;
    }
    
    if ($(".fileObject.selected").length == 0 && $(".fileObject").length > 0){
        //Select the first file object
        $($(".fileObject")[0]).addClass("selected");
        return
    }else if ( $(".fileObject").length == 0){
        //No file in this folder
        return
    }

    var baseObject = $($(".fileObject.selected")[0]);
    var nextObject = $(".fileObject").eq( $(".fileObject").index( $(baseObject) ) + 1 );
    if (nextObject.length > 0){
        nextObject.addClass("selected");
        scrollToFileObject(nextObject);
        $(baseObject).removeClass("selected");
    }

    if (propertiesView){
        let selectedFile = $(".fileObject.selected")[0];
        let filepath = $(selectedFile).attr('filepath');
        loadFileProperties(filepath);
    }
}

//Functions for getting file objects in the same collume
function getFileObjectInTheSameCol(baseFileObject){
    if (viewMode != "grid"){
        return;
    }

    var baseOffset = $(baseFileObject).offset().left;
    var fileObjectInTheSameCol = [];
    $(".fileObject").each(function(){
        if ($(this).offset().left == baseOffset){
            let thisFileObject = $(this);
            fileObjectInTheSameCol.push(thisFileObject);
        }
    });

    return fileObjectInTheSameCol;

}

/*
    Shortcut hints are written for Ctrl in the markup. On a Mac they read the
    way the system menus do: Cmd glyph + key, and Cmd + Backspace for Delete.
*/
function applyPlatformShortcutLabels(){
    if (!isMacOS){
        return;
    }
    $(".fsMenuShortcut, #contextmenu .description").each(function(){
        let label = $(this).text().trim();
        if (label == "Del"){
            $(this).text("\u2318\u232B");
        }else if (/^Ctrl \+ /.test(label)){
            $(this).text(label.replace(/^Ctrl \+ /, "\u2318"));
        }
    });
}
applyPlatformShortcutLabels();
