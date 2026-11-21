/*
    ArozOS Desktop - Float windows

    The float window manager: creating windows (newFloatWindow) and their
    taskbar button, focus and z-order, minimize / maximize / close, top
    most windows, size and title setters used by ao_module.js, and the
    window actions of the title bar context menu.

    Part of desktop.html, see README.md in this folder for the load order.
*/

//Close FloatWindow via fwid
function closeFloatWindowViaID(fwid){
    var thisFW = getFloatWindowByID(fwid);
    closeFloatWindow(thisFW.find(".close"), null);
}

//Check if the given floatWindow DOM object is located outside the screen area.
function checkIfFloatWindowOutsideWindowArea(targetFW, checkForCompletelyOutside=true){
    let fwTop = $(targetFW).offset().top;
    let fwLeft = $(targetFW).offset().left;
    let fwBottom = $(targetFW).offset().left + $(targetFW).width();
    let fwRight = $(targetFW).offset().top + $(targetFW).height();

    //Check for floatWindow complete
    if (checkForCompletelyOutside){
        if (fwBottom < 0 || fwTop > window.innerHeight + 1){
            return true;
        }else if (fwRight < 0 || fwLeft > window.innerWidth + 1){
            return true;
        }
        return false;
    }else{
        //Check if any edge of the fw is outside of the document window
        if (fwTop < 0 || fwBottom > window.innerHeight + 1){
            return true;
        }else if (fwLeft < 0 || fwRight > window.innerWidth + 1){
            return true;
        }

        return false;
    }
}

//Reset the given floatWindow object position on screen
function resetFloatWindowPosition(targetFW, center=true){
    if (center == true){
        //Calculate the corner position of the target
        var newTop = window.innerHeight/2 - $(targetFW).height()/2;
        var newLeft = window.innerWidth/2 - $(targetFW).width()/2;
        $(targetFW).css({
            left: newLeft,
            top: newTop,
        });
    }else{
        //Reset to origin + 10
        $(targetFW).css({
            left: 10,
            top: 10,
        });
    }
}

//Handle floatWindow min, max and close
function min(object, event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type == "mousedown" && event.which != 1) {
        //Ignore right mouse down
        return;
    }
    var fw = $(object).parent().parent().parent();
    $(fw).fadeOut(100, dockUpdateFocus);
}

function toggleMax(object, event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    event = mapEventFromTouch(event);
    if (event.type == "mousedown" && event.which != 1) {
        //Ignore right mouse down
        return;
    }
    if ($(object).css('display') == 'none'){
        //This windows do not allow resizing. 
        return;
    }
    var fw = $(object).parent().parent().parent();
    var maxedAlready = $(fw).attr('max');
    MoveFloatWindowToTop(fw);
    //Add transition animation
    $(fw).css({
        "transition": "width 0.3s ease-out,  height 0.3s ease-out, top 0.3s ease-out, left 0.3s ease-out"
    });

    //Remove transition animation after complete wth 50ms buffer
    setTimeout(function(){
        $(fw).css({
        "transition": ""
        });
    }, 350);

    if (maxedAlready == "true") {
        //Resize to original
        console.log($(fw));
        var originalSize = JSON.parse(decodeURIComponent($(fw).attr("orgsize")));

        $(fw).attr("max", "false");
        $(fw).attr("orgsize", "");
        $(fw).css({
            width: originalSize[0],
            height: originalSize[1],
            left: originalSize[2],
            top: originalSize[3]
        });
        $(fw).find(".maxToogleButton").attr('src', "img/system/max.svg");
        $(fw).find(".dockright").removeClass("disabled");
        $(fw).find(".dockleft").removeClass("disabled");
    } else {
        //Maxmize
        var originalSize = [$(fw).width(), $(fw).height(), $(fw).offset().left, $(fw).offset().top];
        $(fw).attr("orgsize", encodeURIComponent(JSON.stringify(originalSize)));
        $(fw).css({
            width: "100%",
            height: "calc(100% - var(--dt-reserved-bottom))",
            left: "0px",
            top: "0px"
        });
        $(fw).attr("max", "true");
        $(fw).find(".maxToogleButton").attr('src', "img/system/restore.svg");
        $(fw).find(".dockright").addClass("disabled");
        $(fw).find(".dockleft").addClass("disabled");
    }
}

function closeFloatWindow(object, event=null) {
    if (event != null){
        if (event.type == "mousedown" && event.which != 1) {
            //Ignore right mouse down on close buttons
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    if ($(object).is("img")) {
        object = $(object).panret();
    }
    var fw = $(object).parent().parent().parent();
    var contentWindow = $(fw).find("iframe")[0].contentWindow;
    try {
        if (contentWindow.ao_module_close === undefined) {
            //This module do not use ao_module wrapper. Close it directly.
            closeFwProcess($(fw).attr("windowId"));
        } else {
            //Pass the closing events to the window itself
            contentWindow.ao_module_close();
        }
    } catch (ex) {
        //Problems of closing floatWindow. Force closing.
        closeFwProcess($(fw).attr("windowId"));
    }

    //Find the btn object that contains the windowID
    var closingWindowID = $(fw).attr("windowId");
    dockHideWindowList();
    resizeAllFloatWindowButtons();
    hideAllContextMenus();
}

function closeFwProcess(windowID) {
    //Close the floatwindow process
    $(".floatWindow").each(function() {
        if ($(this).attr("windowId") == windowID) {
            $(this).remove();
        }
    });

    //Remove the window from its dock item as well
    dockRemoveWindow(windowID);
}

function PinFloatWindowToTopMostMode(object){
    if ($(".floatwindow.topmost").length >= 100){
        //Cannot add more topmost fw
        console.log("Max number of top most floatWindow reached")
        return
    }
    //Move the current fw to top, its z index is now 101
    MoveFloatWindowToTop(object);
    var windowID = $(object).attr("windowId");
    console.log("[Desktop] Pinning window ID: " + windowID)
    //Move this to fixed layer position
    $(object).addClass("topmost");
    $(object).css("z-index", 501);
}

function UnpinFloatWindowFromTopMostMode(object){
    $(object).removeClass("topmost");
    if (focusedWindow == object){
        focusedWindow = undefined;
        $(object).css("z-index", 1);
    }

    MoveFloatWindowToTop(object);
}

function FloatWindowIsTopped(object){
    if ($(object).attr("windowId") == $(focusedWindow).attr("windowId")) {
        //Top Window
        return true;
    }

    return false;
}

function MoveFloatWindowToTop(object) {
    var windowID = $(object).attr("windowId");
    var windowZindex = $(object).css("z-index");
    //Shift down all floatWindows that has z-index higher than this window by 2
    if (windowID == $(focusedWindow).attr("windowId")) {
        //This window already at the top
        return;
    }

    if ($(focusedWindow).hasClass("topmost") && $(object).hasClass("topmost")){
        //The previous focused windows is topmost. Move it to layer 500
        $(focusedWindow).css("z-index", 500);
        $(".floatWindow.topmost").each(function(){
            var thisWindowZIndex = $(this).css("z-index");
            if (parseInt(thisWindowZIndex) > parseInt(windowZindex)) {
                if ($(this).attr("windowId") != windowID) {
                    $(this).css("z-index", thisWindowZIndex - 1);
                }
            }
        });
    }else if ($(focusedWindow).hasClass("topmost") && !$(object).hasClass("topmost")){
        //The previous focused windows is topmost but the current one is not.
        //No need to move the top most windows but need to move every 101 windows to 100
        $(".floatWindow:not(.topmost)").each(function(){
            if ($(this).css("z-index") == 101){
                $(this).css("z-index", 100);
            }
        });

    }else if (!$(focusedWindow).hasClass("topmost") && $(object).hasClass("topmost")){
        //The previous focused window is normal but now focusing on top most windows.
        $(".floatWindow.topmost").each(function(){
            if ($(this).css("z-index") == 501){
                $(this).css("z-index", 500);
            }
        });

    }else{
        //The previous focused windows is normal windows. Move it to 100
        $(focusedWindow).css("z-index", 100);

        //Shift all the other windows down
        $(".floatWindow").each(function() {
            if ($(this).hasClass("topmost")){
                return;
            }
            var thisWindowZIndex = $(this).css("z-index");
            if (parseInt(thisWindowZIndex) > parseInt(windowZindex)) {
                if ($(this).attr("windowId") != windowID) {
                    $(this).css("z-index", thisWindowZIndex - 1);
                    //console.log($(this).attr("windowId"), $(this).css("z-index"));
                }
            }
        });
    }

    if ($(object).hasClass("topmost")){
        //The new windows is a topmost window
        $(object).css("z-index", 501);
    }else{
        $(object).css("z-index", 101);
    }


    focusedWindow = $(object);
    updateFloatWindowFocusCovers();

    //Check if this div is hidden. If yes, fade it in.
    if ($(object).is(":hidden")) {
        $(object).fadeIn(100);
    }
    dockUpdateFocus();

    //Focus on the top most floatWindow
    var iframe = focusedWindow.find("iframe")[0];
    iframe.contentWindow.focus();

}

//Check if a floatWindow URL points to a container app (reverse proxied under /app/<slug>/)
function isContainerAppURL(url){
    try {
        var target = new URL(url, window.location.href);
        return target.origin == window.location.origin && /^\/app\/[^\/]+/.test(target.pathname);
    } catch (ex) {
        return false;
    }
}

//Show the focus cover on every covered floatWindow except the focused one.
//Pages without ao_module.js cannot report clicks back to the desktop, so the
//cover catches the first click on a background window and brings it forward
function updateFloatWindowFocusCovers(){
    var focusedID = $(focusedWindow).attr("windowId");
    $(".floatWindow.focuscovered").each(function(){
        var isFocused = (focusedID !== undefined && $(this).attr("windowId") == focusedID);
        $(this).find(".focuscover").css("display", isFocused ? "none" : "block");
    });
}

function newFloatWindow(config, callback=undefined) {
    //Check if the number of floatWindow already reaching its maxmium
    if ($(".floatWindow").length > maxWindowCount){
        console.log("Max number of floatWindow reached.");
        return;
    }
    //Generate new floatwindow startup config from object
    var url = defaultOrKey(config, "about:blank", "url");
    var uuid = defaultOrKey(config, (new Date()).getTime(), "uid");
    var width = defaultOrKey(config, 854, "width");
    var height = defaultOrKey(config, 480, "height");
    var moduleIcon = defaultOrKey(config, "img/system/favicon.png", "appicon");
    var title = defaultOrKey(config, "New floatWindow", "title");
    var left = defaultOrKey(config, 100, "left");
    var top = defaultOrKey(config, 100, "top");
    var parentWindowID = defaultOrKey(config, "", "parent");
    var callbackFunctionName = defaultOrKey(config, "", "callback");
    var bgcolor = defaultOrKey(config, "", "background-color");
    var needFocusCover = defaultOrKey(config, false, "focuscover") || isContainerAppURL(url);
    //Optional minimum size. Unset keeps the legacy 120 x 100 floor
    var fwMinWidth = parseInt(defaultOrKey(config, 0, "minWidth")) || 0;
    var fwMinHeight = parseInt(defaultOrKey(config, 0, "minHeight")) || 0;
    if (width < fwMinWidth) {
        width = fwMinWidth;
    }
    if (height < fwMinHeight) {
        height = fwMinHeight;
    }

    //Encode function name
    callbackFunctionName = encodeURIComponent(callbackFunctionName);

    //Validate paramters
    if (width > window.innerWidth) {
        width = window.innerWidth;
    }
    //New windows open above the dock, like maximized ones
    var availableHeight = window.innerHeight - getReservedBottom();
    if (height > availableHeight) {
        height = availableHeight;
    }
    if (left + width > window.innerWidth) {
        left = 0;
    }
    if (top + height > availableHeight) {
        top = 0;
    }

    //Check if the location already cotain any window
    while (floatWindowLocationDuplicated(left, top)) {
        left += 30;
        top += 30;
    }

    //Check if the opening require a overwrite on background color
    var backgroundStyle = "";
    if (bgcolor !== ""){
        backgroundStyle = `background-color: ${bgcolor};`;
    }

    //Check if the theme color is applied. If yes, generate the floatWindow with overwritten theme color
    var overWriteThemeColor = "";
    var overWriteIframeWrapperBorderStyle = "";
    if (desktopThemeColor != ""){
        var overWriteBackgroundColor = hexToRgbA(desktopThemeColor, 0.25);
        overWriteThemeColor = `background-color: ${overWriteBackgroundColor}`;
        overWriteIframeWrapperBorderStyle = `border-left: 3px solid ${overWriteBackgroundColor};
            border-right: 3px solid ${overWriteBackgroundColor};
            border-bottom: 3px solid ${overWriteBackgroundColor};
            backdrop-filter: blur(5px);`
    }

    //Updates 2022-06-24: Added touch screen docking buttons
    let dockButtons = `<div class="buttons dockleft">
        <img src="img/system/dleft.svg"></img>
    </div>
    <div class="buttons dockright">
        <img src="img/system/dright.svg"></img>
    </div>`;
    if (!isTouchScreen){
        dockButtons = "";
    }
    //Append the floatWindow into the body
    $("body").append(`<div class="floatWindow${needFocusCover?" focuscovered":""}" windowId="${uuid}" parent="${parentWindowID}" callback="${callbackFunctionName}" style="z-index:0; width:${width}px; height:${height}px; left:${left}px; top:${top}px;${backgroundStyle}">
        <div class="controls fwdragger themeColorSolid" style="${overWriteThemeColor}">
            <img class="moduleicon" src="${moduleIcon}"></img>
            <div class="title">${title}</div>
            <div class="fwcontrol">
                ${dockButtons}
                <div class="buttons mintoggle" style="margin-left: 1em;">
                    <img src="img/system/min.svg"></img>
                </div>
                <div class="buttons maxtoggle">
                    <img class="maxToogleButton" src="img/system/max.svg"></img>
                </div>
                <div class="buttons closetoggle close">
                    <img src="img/system/close.svg"></img>
                </div>
            </div>
        </div>
        <div class="iframewrapper" style="${overWriteIframeWrapperBorderStyle}">
            <iframe src="${url}" allowfullscreen="true"></iframe>
            <div class="iframecover"></div>
            ${needFocusCover?'<div class="focuscover"></div>':''}
        </div>
    </div>`);
    var newWindowObject = getFloatWindowByID(uuid);
    applyFloatWindowMinSize(newWindowObject, fwMinWidth, fwMinHeight);
    //console.log(newWindowObject);
    MoveFloatWindowToTop(newWindowObject);

    //Put the window on the dock (dock.js groups it with the module it belongs to)
    dockAddWindow(uuid, url, moduleIcon, title);
    hookFloatWindowEvents();

    if (callback !== undefined){
        callback(uuid);
    }
}


function floatWindowLocationDuplicated(left, top) {
    var duplicated = false;
    $(".floatWindow").each(function() {
        if ($(this).offset().left == left && $(this).offset().top == top) {
            duplicated = true;
        }
    });
    return duplicated;
}

function getFloatWindowByID(id) {
    var targetWindow = undefined;
    $(".floatWindow").each(function() {
        if ($(this).attr("windowId") == id) {
            targetWindow = $(this);
        }
    });
    return targetWindow;
}

function getFloatWindowIconByID(id) {
    var targetIconURL = "img/system/favicon.png";
    $(".floatWindow").each(function() {
        if ($(this).attr("windowId") == id) {
            //This window ID matched the target fw
            targetIconURL = $(this).find(".moduleicon").attr('src');
        }
    });
    return targetIconURL;
}

function getFloatWindowTitleByID(id) {
    var title = "";
    $(".floatWindow").each(function() {
        if ($(this).attr("windowId") == id) {
            //This window ID matched the target fw
            title = $(this).find(".title").text();
        }
    });
    return title;
}

function setFloatWindowResizePolicy(targetFWId, resizble = true) {
    var targetfw = getFloatWindowByID(targetFWId);
    if (resizble) {
        $(targetfw).find(".maxtoggle").show();
        if (isTouchScreen){
            $(targetfw).find(".dockleft").show();
            $(targetfw).find(".dockright").show();
        }
        $(targetfw).removeClass("fixedsize");
    } else {
        $(targetfw).find(".maxtoggle").hide();
        if (isTouchScreen){
            $(targetfw).find(".dockleft").hide();
            $(targetfw).find(".dockright").hide();
        }
        $(targetfw).addClass("fixedsize");
    }
}

function setFloatWindowSize(targetFWId, newWidth, newHeight) {
    var targetfw = getFloatWindowByID(targetFWId);
    $(targetfw).css({
        height: newHeight,
        width: newWidth
    });
}

//Set (or clear with 0) the minimum size of a floatWindow
function setFloatWindowMinSize(targetFWId, minWidth, minHeight) {
    var targetfw = getFloatWindowByID(targetFWId);
    if (targetfw == undefined || targetfw.length == 0) {
        return;
    }
    applyFloatWindowMinSize(targetfw, minWidth, minHeight);
    if ($(targetfw).attr("max") == "true") {
        //Maximized or docked: the layout already fills the screen
        return;
    }
    //Grow a window that is currently smaller than its new minimum,
    //keeping it on screen
    var minSize = getFloatWindowMinSize(targetfw);
    var newWidth = Math.max($(targetfw).width(), minSize[0]);
    var newHeight = Math.max($(targetfw).height(), minSize[1]);
    var offset = $(targetfw).offset();
    $(targetfw).css({
        width: newWidth,
        height: newHeight,
        left: Math.max(0, Math.min(offset.left, window.innerWidth - newWidth)),
        top: Math.max(0, Math.min(offset.top, window.innerHeight - newHeight))
    });
}

//Store the minimum size and enforce it in CSS as well, so every other
//way of sizing the window (setFloatWindowSize, docking) respects it
function applyFloatWindowMinSize(targetfw, minWidth, minHeight) {
    minWidth = parseInt(minWidth) || 0;
    minHeight = parseInt(minHeight) || 0;
    if (minWidth > 0) {
        $(targetfw).attr("minwidth", minWidth).css("min-width", "min(" + minWidth + "px, 100vw)");
    } else {
        $(targetfw).removeAttr("minwidth").css("min-width", "");
    }
    if (minHeight > 0) {
        $(targetfw).attr("minheight", minHeight).css("min-height", "min(" + minHeight + "px, 100vh)");
    } else {
        $(targetfw).removeAttr("minheight").css("min-height", "");
    }
}

function setFloatWindowTitle(targetFWId, newTitle) {
    var targetfw = getFloatWindowByID(targetFWId);
    $(targetfw).find(".title").text(newTitle);
    dockWindowTitleChanged(targetFWId);

}

function setFloatWindowTheme(fwid, theme="dark"){
    var targetFW = getFloatWindowByID(fwid);
    if (theme == "dark"){
        $(targetFW).removeClass("white");
    }else if (theme == "white"){
        $(targetFW).addClass("white");
    }
}

//Float Window context menu
function getFocusedFloatWindowID(){
    var targetFloatWindowId = "";
    $(".floatWindow").each(function() {
        var thisWindowZIndex = $(this).css("z-index");
        if (parseInt(thisWindowZIndex) == 101){
            targetFloatWindowId =  $(this).attr("windowid");
        }
    }); 
    return targetFloatWindowId;
}

function getFocusedFloatWindow(){
    var focusedFwId = getFocusedFloatWindowID();
    if (focusedFwId != ""){
        var fw = getFloatWindowByID(focusedFwId);
        return fw;
    }else{
        return undefined;
    }
}

function refreshSelectedFloatWindow(target, event){
   var fw = getFocusedFloatWindow();
   if (fw != undefined){
       $(fw).find("iframe")[0].contentWindow.location.reload();
   }
   hideAllContextMenus();
}

function maximizeSelectedFloatWindow(target, event){
    var fw = getFocusedFloatWindow();
    if (fw != undefined){
        toggleMax($(fw).find(".buttons.maxtoggle"),event);
    }
    hideAllContextMenus();
}

function minimizeSelectedFloatWindow(target, event){
    var fw = getFocusedFloatWindow();
    if (fw != undefined){
        min($(fw).find(".buttons.mintoggle"),event);
    }
    hideAllContextMenus();
}

function openSelectedFloatWindowInNewTab(){
    var fw = getFocusedFloatWindow();
    if (fw != undefined){
        try{
            var currentURL = $(fw).find("iframe")[0].contentWindow.location;
            window.open(currentURL);
        }catch(ex){
            //Maybe CORS. Try to get it from window's parent properties
            let parentURL = $(fw).attr("parent");
            if (parentURL != undefined){
                window.open(parentURL);
            }else{
                console.log("Unable to access iframe object")
            }
        }

    }
    hideAllContextMenus();
}

function closeSelectedFloatWindow(target, event){
    var fw = getFocusedFloatWindow();
    if (fw != undefined){
        closeFloatWindow($(fw).find(".buttons.closetoggle"),event);
    }
    hideAllContextMenus();
}
