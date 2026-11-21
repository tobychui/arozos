/*
    ArozOS Desktop - Keyboard and pointer bindings

    Document level key bindings (delete, enter, copy / cut / paste,
    escape), modifier key tracking and the last known pointer position.

    Part of desktop.html, see README.md in this folder for the load order.
*/

// ======================= DOCUMENT KEY BINDING =====================
/*
    The multi-select / shortcut modifier is Cmd on a Mac and Ctrl
    elsewhere. Cmd reports keyCode 91 / 93 in Chrome and Safari and 224
    in Firefox.
*/
function isPrimaryModifierKey(event){
    let keycode = event.which || event.keyCode;
    if (isMacOS){
        return event.key == "Meta" || keycode == 91 || keycode == 93 || keycode == 224;
    }
    return event.key == "Control" || keycode == 17;
}

function isPrimaryModifierHeld(event){
    return isMacOS ? !!event.metaKey : !!event.ctrlKey;
}

//Typing in a text field must never act on the selected desktop icons
function isTypingTarget(target){
    return $(target).is("input, textarea, select, [contenteditable='true']");
}

document.addEventListener('keydown', function(event) {
    let keycode = event.which || event.keyCode;
    if (isPrimaryModifierHeld(event)){
        ctrlHold = true;
    }
    if (isPrimaryModifierKey(event)) {
        //Pressdown of Ctrl (Cmd on a Mac) key
        ctrlHold = true;
    } else if (keycode == "16") {
        //Pressdown of Shift key
        shiftHold = true;
    }else if (keycode == "27"){
        //Cancel all floatwindow events and key events
        $("#fwdragpanel").hide();
        $("#tfwdragpanel").hide();
        $(".floatWindow").find(".iframecover").hide();
        movingWindow = false;
        resizingWindow = false;
        resizingEdgeID = 0;
        multiSelecting = false;
        ctrlHold = false;
        shiftHold = false;
    }else if (keycode == "46" || (keycode == "8" && isMacOS && ctrlHold)){
        //Delete key, or Cmd + Backspace on a Mac (no Delete key there)

        if (renameMode || isTypingTarget(event.target)){
            //Deleting content in textarea. Ignore delte action
            return true
        }
        var deleteFilelist = [];
        var deleteFilenameList = [];
        $(".launchIconWrapper.selected").each(function(){
            var fileObject = $(this).parent();
            var fd = JSON.parse(decodeURIComponent((fileObject).attr("filedata")));
            deleteFilelist.push(fd.Filepath);
            deleteFilenameList.push(fd.Filename)
        });

        //Prase the filelist and pass to trash module
        console.log(deleteFilelist);
        generateCSRFToken(function(csrftoken){
            $.ajax({
                url: "system/file_system/fileOpr",
                method:"POST",
                data: {opr: "recycle", src: JSON.stringify(deleteFilelist), csrft: csrftoken},
                success: function(data){
                    if (data.error !== undefined){
                        alert(data.error);
                    }else{
                        //Delete the file's desktop location
                        deleteFilenameList.forEach(file => {
                            $.ajax({
                                url: "system/desktop/files",
                                data: {del: file},
                                success: function(data){
                                    if (data.error !== undefined){
                                        console.log(data.error);
                                    }
                                    refresh(undefined, true);
                                }
                            });
                        });
                    }
                }
            });
        });




    }else if (keycode == "112" ){
        //Enter key
        if (!renameMode){
            //Open selected object by emulating double click
            $(".launchIconWrapper.selected").each(function(){
                var object = $(this).parent();
                iconDoubleClicked(object);
            });

        }else if (renameMode){
            event.preventDefault();
            event.stopImmediatePropagation();
            exitRenameMode();
        }

    }else if (keycode == "67" && ctrlHold){
        //Ctrl + C, copy
        handleCopyOperation();
     }else if (keycode == "88" && ctrlHold){
        //Ctrl + X, cut
        handleCutOperation();
    }else if (keycode == "86" && ctrlHold){
        //Ctrl + V, Paste
        handlePasteOperation();
    }else{
        //console.log(event.which);
    }
});

$(document).on("mousemove", function(event){
    currentMousePosition = [event.clientX, event.clientY];
});

$(document).keyup(function(event) {
    let keycode = event.which || event.keyCode;
    if (isPrimaryModifierKey(event)) {
        ctrlHold = false;
    }else if (keycode == "16") {
        shiftHold = false;
    }else if (keycode == "27"){
        //ESC key, stop all floatWindow operations
        console.log("%c[Desktop] Dragging function killed. Restarting all dragging elements.", 'color: #e64747');
        movingWindow = false;
        resizingWindow = false;
        event.preventDefault();
    }else if (keycode == "13"){
        //Enter key. open the selected object if exists
        $(".launchIconWrapper.selected").each(function(){
            console.log($(this).parent());
            iconDoubleClicked($(this).parent(), event);
        })
    }
});

//A modifier released while the desktop is not focused (Cmd + Tab, or
//inside a float window's iframe) never sends its keyup here
$(window).on("blur", function(){
    ctrlHold = false;
    shiftHold = false;
});

$("#bgwrapper").on("mouseup", function(event) {
    //Deselect all selected icons
    event.preventDefault();
    event.stopImmediatePropagation();
    mainWindowMouseup(event);

});
