/*
    ArozOS Desktop - Float window moving and resizing

    Mouse and touch handling of float windows: dragging, resizing on every
    edge, docking to the left / right half of the screen, and the event
    hooks for the title bar buttons and taskbar buttons.

    Part of desktop.html, see README.md in this folder for the load order.
*/

// ===================== FLOAT WINDOWS EVENTS =====================

function hookFloatWindowEvents() {
    //Handle floatWindow mouse drag events
    $(".fwdragger").off("mousedown").on("mousedown", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        fwdown($(this).parent(), evt);
    });
    $(".fwdragger").off("mousemove").on("mousemove", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        fwmove($(this).parent(), evt);

        //Add cusor change on resizble position reach
        let hoverOffset = [event.pageX - $(this).offset().left, event.pageY - $(this).offset().top];
        if (hoverOffset[1] <= 3 && !$(this).parent().hasClass("fixedsize")){
            $(this).addClass("resizbleCursor");
            if (hoverOffset[0] < 15) {
                $(this).css("cursor", "nw-resize");
            } else if (hoverOffset[0] > $(this).parent().width() - 15) {
                $(this).css("cursor", "ne-resize");
            } else {
                $(this).css("cursor", "");
            }
        }else{
            $(this).removeClass("resizbleCursor");
            $(this).css("cursor", "");
        }
    });
    $(".fwdragger").off("mouseup").on("mouseup", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        fwup($(this).parent(), evt);
    });

    $(".fwdragger").off("touchstart").on("touchstart", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        fwdown($(this).parent(), evt);
        let fwMaxiButton = $(this).parent().find(".maxToogleButton").parent()[0]
        doubleTouchHandler(this, evt, function(){
            toggleMax(fwMaxiButton, evt);
        });
    });

    $(".fwdragger").off("touchmove").on("touchmove", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        fwmove($(this).parent(), evt);
    });

    $(".fwdragger").off("touchend").on("touchend", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        fwup($(this).parent(), evt);
    });

    $(".fwdragger").off("dblclick").on("dblclick", function(evt) {
        //Activate full screen
        evt.preventDefault();
        evt.stopImmediatePropagation();
        //Emulate keypress on maximize btn
        toggleMax($(this).parent().find(".maxToogleButton").parent()[0], evt);
    });

    //Floatwindow operations for touch devices
    $(".maxtoggle").off("touchstart").on("touchstart",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        toggleMax(this, evt);
    });

    $(".mintoggle").off("touchstart").on("touchstart",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        min(this, evt);
    });

    $(".closetoggle").off("touchstart").on("touchstart",function(evt){
        // If touch is within the 3px top-edge zone, let fwdragger handle corner resize
        var fwTop = $(this).closest(".floatWindow").offset().top;
        if (evt.pageY - fwTop <= 3 && !$(this).closest(".floatWindow").hasClass("fixedsize")) {
            return;
        }
        evt.preventDefault();
        evt.stopImmediatePropagation();
        closeFloatWindow(this,evt);
    });

    $(".dockleft").off("touchstart").on("touchstart",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        dockWindowToLeft($(this).parent().parent().parent());
    });

    $(".dockright").off("touchstart").on("touchstart",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        dockWindowToRight($(this).parent().parent().parent());
    });

    //floatWindow events for mouse
    $(".maxtoggle").off("mousedown").on("mousedown",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        toggleMax(this, evt);
    });

    $(".mintoggle").off("mousedown").on("mousedown",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        min(this, evt);
    });

    $(".closetoggle").off("mousedown").on("mousedown",function(evt){
        // If the click lands in the 10px top-edge zone, let the event bubble to
        // fwdragger so it can detect and start a top-corner resize instead
        var fwTop = $(this).closest(".floatWindow").offset().top;
        if (resizingWindow && evt.pageY - fwTop <= 10 && !$(this).closest(".floatWindow").hasClass("fixedsize")) {
            return;
        }
        evt.preventDefault();
        evt.stopImmediatePropagation();
        closeFloatWindow(this,evt);
    });


    $(".closetoggle").off("mouseup").on("mouseup",function(evt){
        // If the mouse up lands in the 10px top-edge zone, let the event bubble to
        // fwdragger so it can detect and start a top-corner resize instead
        var fwTop = $(this).closest(".floatWindow").offset().top;
        if (resizingWindow && evt.pageY - fwTop <= 10 && !$(this).closest(".floatWindow").hasClass("fixedsize")) {
            // Stop resizing and restore cursor to default if mouse up on close button while resizing from top edge
            mainWindowMouseup(evt);
            return;
        }
    });


    $(".dockleft").off("mousedown").on("mousedown",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        dockWindowToLeft($(this).parent().parent().parent());
    });

    $(".dockright").off("mousedown").on("mousedown",function(evt){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        dockWindowToRight($(this).parent().parent().parent());
    });

    //Focus cover: bring a background window forward. The cover hides once
    //the window is focused so the next click reaches the page inside
    $(".focuscover").off("mousedown touchstart").on("mousedown touchstart", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        var fw = $(this).closest(".floatWindow");
        MoveFloatWindowToTop(fw);
        updateFloatWindowFocusCovers();
        hideAllContextMenus();
    });

    //Float Window events for resizing
    $(".iframewrapper").off("mousedown").on("mousedown", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        resizeDown($(this).parent(), evt);
    });

    $(".iframewrapper").off("mousemove").on("mousemove", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        if (resizingWindow == true) {
            //Resizeing Move
            resizeMove($(this).parent(), evt);
        } else {
            //Dragdropping move
            fwmove($(this).parent(), evt);
        }

    });

    $(".iframewrapper").off("mouseup").on("mouseup", function(evt) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        resizeUp($(this).parent(), evt);
    });


    $(".iframewrapper").off("mouseover").on("mouseover", function(evt) {
        var object = $(this).parent();
        if ($(object).hasClass("fixedsize")) {
            return false;
        }
        var dx = event.pageX - $(object).find(".iframewrapper").offset().left;
        var dy = event.pageY - $(object).offset().top;
        if (dx < 10 && dy > $(object).height() - 10) {
            //Left Bottom Corner
            $(".iframewrapper").attr("class", "iframewrapper leftCorner");
        } else if (dx > $(object).width() - 10 && dy > $(object).height() - 10) {
            //Right Bottom Corner
            $(".iframewrapper").attr("class", "iframewrapper rightCorner");
        } else if (dx < 10) {
            //Dragging left edge
            $(".iframewrapper").attr("class", "iframewrapper widthHover");
        } else if (dx > $(object).width() - 10) {
            //Dragging right edge
            $(".iframewrapper").attr("class", "iframewrapper widthHover");
        } else if (dy > $(object).height() - 10) {
            //Bottom Edge
            $(".iframewrapper").attr("class", "iframewrapper heighHover");
        } else {
            //???
            $(".iframewrapper").attr("class", "iframewrapper");
        }
    });

    //Hook events on the floatWindow button
    $(".floatWindowButton").off("click touchstart").on("click touchstart", function(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        $("#stackedWindowList").css("left", $(this).offset().left);
        //Generate the stackedWindowList
        var windowIdList = JSON.parse(decodeURIComponent($(this).attr("windowidgroup")));
        if (windowIdList.length == 1) {
            //There are only one window in this group. 

            //Focus that floatWindow if it is in the back
            var targetFW = getFloatWindowByID(windowIdList[0]);
            if (FloatWindowIsTopped(targetFW) && !($(targetFW).css('display') == 'none')){
                //Top Window. Hide it
                $(targetFW).fadeOut(100);
            }else{
                //Bring it to front
                $(targetFW).fadeIn(100);
                MoveFloatWindowToTop(targetFW);
                stackedFloatWindowListShown = false;
            }

            if (checkIfFloatWindowOutsideWindowArea(targetFW)){
                //This floatWindow is outside of the display area.
                resetFloatWindowPosition(targetFW);
            }
            $("#stackedWindowList").hide();
        } else {
            //Get icon for each windows and build the list objects
            $("#stackedWindowList").html("");
            for (var i = 0; i < windowIdList.length; i++) {
                var iconURL = getFloatWindowIconByID(windowIdList[i]);
                var title = getFloatWindowTitleByID(windowIdList[i]);
                $("#stackedWindowList").append(`<div class="stackedWindowButton item clickable" windowId="${windowIdList[i]}" onclick="bringFloatWindowToFrontByFWB(this,event);"  ontouchstart="bringFloatWindowToFrontByFWB(this,event);"><span><img src="${iconURL}"></img>${title}</span><div class="closebtn" onclick="closeFWviaFWB(this,event);"><img src="img/system/close.png"></img></div></div>`);
            }
            $("#stackedWindowList").show();
            stackedFloatWindowListShown = true;
        }

    });
}

//Handle floatWindow resize events
let resizingWindowTarget;
let resizingMinX = 0;
let minxWidth = 120;
let minHeight = 100;

//Minimum size of a floatWindow: the legacy floor above, raised by the
//window's optional minWidth / minHeight (newFloatWindow config or
//ao_module_setWindowMinSize) but never beyond the screen size
function getFloatWindowMinSize(object){
    var w = parseInt($(object).attr("minwidth")) || 0;
    var h = parseInt($(object).attr("minheight")) || 0;
    return [
        Math.max(minxWidth, Math.min(w, window.innerWidth)),
        Math.max(minHeight, Math.min(h, window.innerHeight))
    ];
}

function resizeDown(object, event) {
    if (object.length > 1){
        object = object[0];
    }
    if ($(object).hasClass("fixedsize")) {
        return false;
    }

    //Mouse down, start resizing
    resizingWindow = true;
    resizingWindowTarget = object;
    resizingMinX = $(object).offset().left + $(object).width() - getFloatWindowMinSize(object)[0];
    MoveFloatWindowToTop(object);
    if ($(object).hasClass("topmost")){
        //Top most windows
        $("#tfwdragpanel").show();
    }else{
        //Normal Windows
        $('.floatWindow.topmost').css("pointer-events", "none");
        $('.floatWindow.topmost').css("opacity", 0.7);
        $("#fwdragpanel").show();
    }


    $(object).find(".iframecover").show();

    //Check which edge is the user dragging
    var dx = event.pageX - $(object).find(".iframewrapper").offset().left;
    var dy = event.pageY - $(object).offset().top;

    if (dx < 10 && dy > $(object).height() - 10) {
        //Left Bottom Corner
        resizingEdgeID = 4;
        $(object).find(".iframewrapper").css('cursor', 'sw-resize');
    } else if (dx > $(object).width() - 10 && dy > $(object).height() - 10) {
        //Right Bottom Corner
        resizingEdgeID = 2;
        $(object).find(".iframewrapper").css('cursor', 'se-resize');
    } else if (dx < 10) {
        //Dragging left edge
        resizingEdgeID = 5;
        $(object).find(".iframewrapper").css('cursor', 'w-resize');
    } else if (dx > $(object).width() - 10) {
        //Dragging right edge
        resizingEdgeID = 1;
        $(object).find(".iframewrapper").css('cursor', 'w-resize');
    } else if (dy > $(object).height() - 10) {
        //Bottom Edge
        resizingEdgeID = 3;
        $(object).find(".iframewrapper").css('cursor', 's-resize');
    }

    //For upper edge, see fwdown() handler
}

function resizeMove(object, event) {
    var posX = event.pageX;
    var posY = event.pageY;
    var minSize = getFloatWindowMinSize(object);
    var minxWidth = minSize[0];
    var minHeight = minSize[1];
    //Dragging the top edge moves the top, so stop it where a window
    //with a minimum height reaches it instead of sliding the window
    //(windows without one keep the legacy behavior)
    var maxTop = Infinity;
    if ($(object).attr("minheight") !== undefined) {
        maxTop = $(object).offset().top + $(object).height() - minHeight;
    }

    if (resizingWindow == true && resizingEdgeID != 0) {
        if (resizingEdgeID == 1) {
            //Width = posX - floatWindow width + 2 (for border width)
            var newWidth = posX - $(object).offset().left + 2;
            $(object).css("width", Math.max(newWidth, minxWidth));
        } else if (resizingEdgeID == 2) {
            var newWidth = posX - $(object).offset().left + 2;
            var newHeight = posY - $(object).offset().top + 2;
            $(object).css({
                width: Math.max(newWidth, minxWidth),
                height: Math.max(newHeight, minHeight)
            });
        } else if (resizingEdgeID == 3) {
            var newHeight = posY - $(object).offset().top + 2;
            $(object).css("height", Math.max(newHeight,minHeight));
        } else if (resizingEdgeID == 4) {
            var newWidth = $(object).offset().left - posX + $(object).width();
            var newHeight = posY - $(object).offset().top + 2;

            if (newWidth < minxWidth){
                posX = resizingMinX;
            }

            $(object).css({
                width: Math.max(newWidth, minxWidth),
                height: Math.max(newHeight, minHeight),
                left: posX
            });
        } else if (resizingEdgeID == 5) {
            var newWidth = $(object).offset().left - posX + $(object).width();
            if (newWidth < minxWidth){
                posX = resizingMinX;
            }

            $(object).css({
                width: Math.max(newWidth, minxWidth),
                left: posX
            });
        } else if (resizingEdgeID == 6){
            var newHeight = $(object).height() - (posY - $(object).offset().top) + 2;
            $(object).css({
                "top": Math.min(posY - 2, maxTop),
                "height": Math.max(newHeight,minHeight),
            });
        } else if (resizingEdgeID == 7){
            // Top-left corner: resize height from top + width from left
            var newHeight = $(object).height() - (posY - $(object).offset().top) + 2;
            var newWidth = $(object).offset().left - posX + $(object).width();
            var newLeft = posX;
            if (newWidth < minxWidth) {
                newLeft = $(object).offset().left + $(object).width() - minxWidth;
                newWidth = minxWidth;
            }
            $(object).css({
                "top": Math.min(posY - 2, maxTop),
                "height": Math.max(newHeight, minHeight),
                "left": newLeft,
                "width": newWidth
            });
        } else if (resizingEdgeID == 8){
            // Top-right corner: resize height from top + width from right
            var newHeight = $(object).height() - (posY - $(object).offset().top) + 2;
            var newWidth = posX - $(object).offset().left + 2;
            $(object).css({
                "top": Math.min(posY - 2, maxTop),
                "height": Math.max(newHeight, minHeight),
                "width": Math.max(newWidth, minxWidth)
            });
        }
    }
}

function resizeUp(object, event) {
    resizingWindow = false;
    resizingEdgeID = 0;
    $("#fwdragpanel").hide();
    $("#tfwdragpanel").hide();
    $('.floatWindow.topmost').css("pointer-events", "auto");
    $('.floatWindow.topmost').css("opacity", 1);

    $(object).find(".iframecover").hide();
    $(object).find(".iframewrapper").css('cursor', '');
    //Force minmium width and height on any floatWindow objects
    if ($(object).width() < 120) {
        $(object).css("width", "120px");
    }
    if ($(object).height() < 120) {
        $(object).css("height", "120px");
    }
    resizingWindowTarget = undefined;

    $(".topmost").show();

}

//Hook body mousemove assistant events
$("body").on("mousemove", function(evt) {
    if (focusedWindow !== undefined && movingWindow == true) {
        fwmove(focusedWindow, evt);
    } else if (focusedWindow !== undefined && resizingWindow == true) {
        resizeMove(focusedWindow, evt);
    } else if (multiSelecting == true) {
        movingMultiSelectionArea(evt);
    }
});

//Hook body clicke vents
$("body").on("click", function(evt) {
    if (stackedFloatWindowListShown == true) {
        //Hide the stacked Float Window list if it is shown
        $("#stackedWindowList").hide();
        stackedFloatWindowListShown = false;
    }

    if (renameMode == true){
        //Exit rename mode if the target is not on the editing launchIcon
        //console.log(evt.target);
        var isBackground = false;
        if ($(evt.target).attr("id") && $(evt.target).attr("id").length >= 4 &&  $(evt.target).attr("id").substr(0, 3) == "dbg"){
            isBackground = true;
        }
        if ($(evt.target).is("body") || isBackground){
            //End rename mode
            exitRenameMode();
        }
    }
});

//Please pass in the floatWindow object instead of the dragger
function fwdown(object, event) {
    event = mapEventFromTouch(event);

    //Hide all contenxt menus
    hideAllContextMenus();

    //Move the window to the top layer
    MoveFloatWindowToTop(object);

    //Show the background drag panel
    if ($(object).hasClass("topmost")){
        $("#tfwdragpanel").show();
    }else{

        $('.floatWindow.topmost').css("pointer-events", "none");
        $('.floatWindow.topmost').css("opacity", 0.7);
        $("#fwdragpanel").show();
    }


    //Get the relative click offset of the down event
    clickDownOffset = [event.pageX - $(object).offset().left, event.pageY - $(object).offset().top];
    if (clickDownOffset[1] <= 3 && !$(object).hasClass("fixedsize")){
        //Resizing Top Edge (with corner detection)
        resizingWindow = true;
        resizingWindowTarget = $(object);
        if (clickDownOffset[0] < 10) {
            resizingEdgeID = 7; // top-left corner
            $("#fwdragpanel, #tfwdragpanel").css("cursor", "nw-resize");
        } else if (clickDownOffset[0] > $(object).width() - 10) {
            resizingEdgeID = 8; // top-right corner
            $("#fwdragpanel, #tfwdragpanel").css("cursor", "ne-resize");
        } else {
            resizingEdgeID = 6; // top edge
        }
    }else{
        //Moving Window
        movingWindow = true;

    }
    $(object).find(".iframecover").show();

} 

function fwmove(object, event) {
    event = mapEventFromTouch(event);
    if (movingWindow == true) {
        //Check if the object is maximized. If yes, minimized it
        if ($(object).attr("max") == "true") {
            var originalSize = JSON.parse(decodeURIComponent($(object).attr("orgsize")));
            $(object).attr("max", "false");
            $(object).attr("orgsize", "");
            //Calculate new left right offsets
            var clickRatio = event.pageX / window.innerWidth;
            var newLeft = event.pageX - (clickRatio * originalSize[0]);
            originalSize
            $(object).css({
                width: originalSize[0],
                height: originalSize[1],
                left: newLeft,
                right: "auto",
                top: event.Y - 2
            });
            clickDownOffset[0] = clickRatio * originalSize[0];
            clickDownOffset[1] = 2;
            //Restore the maximize icon
            $(object).find(".maxToogleButton").attr('src', "img/system/max.svg");
            $(object).find(".dockright").removeClass("disabled");
            $(object).find(".dockleft").removeClass("disabled");
        }

        let fwNoResize = $(object).hasClass("fixedsize");
        if (event.pageX < 20 && !fwNoResize) {
            //Show dock to left indicator
            $("#fwdockLeftIndicator").show();
            $("#fwdockRightIndicator").hide();
        } else if (event.pageX > window.innerWidth - 20 && !fwNoResize) {
            //Show dock to right indicator
            $("#fwdockLeftIndicator").hide();
            $("#fwdockRightIndicator").show();
        }else{
            //hide both indicator
            $("#fwdockRightIndicator").hide();
            $("#fwdockLeftIndicator").hide();
        }

        $(object).css("left", event.pageX - clickDownOffset[0]);
        $(object).css("top", event.pageY - clickDownOffset[1]);
    } else if (resizingWindow && (resizingEdgeID == 6 || resizingEdgeID == 7 || resizingEdgeID == 8)){
        resizeMove($(object), event);
    }
}

//Dock the window object to left
function dockWindowToLeft(object){
    if ($(object).hasClass("fixedsize")){
        //This windows do now allow resizing
        return;
    }
    var originalSize = [$(object).width(), $(object).height(), $(object).offset().left, $(object).offset().top];
    $(object).attr("orgsize", encodeURIComponent(JSON.stringify(originalSize)));
    $(object).css({
        width: "50%",
        height: "calc(100% - 36px)",
        left: "0px",
        right: "auto",
        top: "0px"
    });
    $(object).attr("max", "true");
    $(object).find(".maxToogleButton").attr('src', "img/system/restore.svg");
    $(object).find(".dockright").addClass("disabled");
    $(object).find(".dockleft").addClass("disabled");
}

//Dock the window object to right
function dockWindowToRight(object){
    if ($(object).hasClass("fixedsize")){
        //This windows do now allow resizing
        return;
    }
    var originalSize = [$(object).width(), $(object).height(), $(object).offset().left, $(object).offset().top];
    $(object).attr("orgsize", encodeURIComponent(JSON.stringify(originalSize)));
    $(object).css({
        width: "50%",
        height: "calc(100% - 36px)",
        right: "0px",
        left: "auto",
        top: "0px"
    });
    $(object).attr("max", "true");
    $(object).find(".maxToogleButton").attr('src', "img/system/restore.svg");
    $(object).find(".dockright").addClass("disabled");
    $(object).find(".dockleft").addClass("disabled");
}

function fwup(object, event) {
    event = mapEventFromTouch(event);
    if (movingWindow) {
        $("#fwdragpanel").hide();
        $("#tfwdragpanel").hide();
        $('.floatWindow.topmost').css("pointer-events", "auto");
        $('.floatWindow.topmost').css("opacity", 1);

        $(object).find(".iframecover").hide();
        movingWindow = false;

        //Float Window Snapping Logic
        //Check if the window location is drag to the edge of the screen. If yes, toggle half screen fullscreen
        //Not need to check for if max because it must be minimized during drag move
        var dockMode = false;
        if (event.pageX < 20) {
            //Dock to left
            dockWindowToLeft(object);
        } else if (event.pageX > window.innerWidth - 20) {
            //Dock to right
            dockWindowToRight(object);
        }

        $("#fwdockRightIndicator").hide();
        $("#fwdockLeftIndicator").hide();
    }else if (resizingWindow && (resizingEdgeID == 6 || resizingEdgeID == 7 || resizingEdgeID == 8)){
        // Top edge (6), top-left corner (7), top-right corner (8)
        resizeUp($(object), event);
    }
}
