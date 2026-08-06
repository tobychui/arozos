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
    if(event.which==17 || event.which == 91){
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
            selectNextFile(event);
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
        //Handle generic file search by consecutive typing
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
    if(event.which==17 || event.which == 91){
        ctrlHold = false;
        updateCtrlDisplay();
    }else if (event.which == 16){
        shiftHold = false;
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
