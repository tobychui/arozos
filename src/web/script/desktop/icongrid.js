/*
    ArozOS Desktop - Icon grid and selection

    The virtual grid the desktop icons sit on, icon placement, rubber band
    multi selection and single click selection.

    Part of desktop.html, see README.md in this folder for the load order.
*/

//Handle desktop file multi selection and dragging
$("#bgwrapper").on("mousedown", function(evt) {
    initMultiSelection(evt);
});
$("#bgwrapper").on("touchstart", function(evt) {
    initMultiSelection(evt);
});

$("body").on("mouseup", function(evt) {
    mainWindowMouseup(evt);
});
$("body").on("touchend", function(evt) {
    mainWindowMouseup(evt);
});

$("#selectionPanel").on("mouseup", function(event) {

});

function mainWindowMouseup(event) {
    if (event.pageX == multiSelectionStartPoint[0] && event.pageY == multiSelectionStartPoint[1]) {
        //Pressdown and up at the same location
        $(".launchIconWrapper.selected").removeClass("selected");
        endMultiSelection(event);
    } else {
        //Press down and up at different location
        endMultiSelection(event);
    }

    if (resizingWindow){
        //Resizing floatWindow out of the window bound (aka someone don't know how to resize a window correctly)
        resizingWindow = false;
        resizingEdgeID = 0;
        $("#fwdragpanel").hide();
        $("#tfwdragpanel").hide();
        $("#fwdragpanel, #tfwdragpanel").css("cursor", "");
        $('.floatWindow.topmost').css("pointer-events", "auto");
        $('.floatWindow.topmost').css("opacity", 1);
        $(resizingWindowTarget).find(".iframecover").hide();
        $(resizingWindowTarget).find(".iframewrapper").css('cursor', '');
    }

}

function initMultiSelection(event) {
    event.preventDefault();
    multiSelecting = true;
    hideAllContextMenus();
    $("#selectionPanel").css({
        left: event.pageX,
        top: event.pageY,
        width: 0,
        height: 0
    });
    $("#selectionPanel").show();
    multiSelectionStartPoint = [event.pageX, event.pageY];
}

function movingMultiSelectionArea(event) {
    event.preventDefault();
    var sx = multiSelectionStartPoint[0];
    var sy = multiSelectionStartPoint[1];
    var ex = event.pageX;
    var ey = event.pageY;

    var newleft = sx;
    if (ex < sx) {
        newleft = ex;
    }

    var newtop = sy;
    if (ey < sy) {
        newtop = ey;
    }

    var newWidth = Math.abs(sx - ex);
    var newHeight = Math.abs(sy - ey);
    $("#selectionPanel").css({
        left: newleft,
        top: newtop,
        width: newWidth,
        height: newHeight
    });

    //Select all the launch icon selected
    selectAllLaunchIconInRange(newleft, newleft + newWidth, newtop, newtop + newHeight);
}

function endMultiSelection(event) {
    event.preventDefault();
    multiSelecting = false;
    multiSelectionStartPoint = [-1, -1];
    $("#selectionPanel").hide();
}


function selectAllLaunchIconInRange(minX, maxX, minY, maxY) {
    //Select launch icons from its center point
    var xOffset = iconSize[0] / 2;
    var yOffset = iconSize[1] / 2;
    $(".launchIconWrapper.selected").removeClass("selected");
    $(".launchIcon").each(function() {
        //Calculate center point for this icon
        var thisX = $(this).offset().left + xOffset;
        var thisY = $(this).offset().top + yOffset;
        if (thisX > minX && thisX < maxX) {
            if (thisY > minY && thisY < maxY) {
                $(this).find(".launchIconWrapper").addClass("selected");
            }
        }
    });
}

//Allocate the given number of grids from desktop 
function gridPositionAllocate(posx, posy, numberOfGridNeeded=1){
    var gridMaxX = desktopGrids.length;
    var gridMaxY = desktopGrids[0].length;
    var targetLocation = findClosestGrid(posx, posy, false);
    var targetGridLocation = targetLocation[1];
    var previousEmptyGridPosition = targetGridLocation;
    var locations = [];

    for (var k =0; k < numberOfGridNeeded; k++){
        var thisLocation = JSON.parse(JSON.stringify(previousEmptyGridPosition));
        //Add k to y axis of the list.
        thisLocation[1] += k;
        if (thisLocation[1] >= gridMaxY){
                thisLocation[0]++;
                thisLocation[1] = 0;
        }
        if (thisLocation[1] >= gridMaxY && thisLocation[0] >= gridMaxX){
            //Desktop full. Force put to 0 0 
            thisLocation[0] = 0;
            thisLocation[1] = 0;
            break;
        }
        while (getObjectFromGridLocation(thisLocation[0], thisLocation[1]) !== undefined){
            thisLocation[1] += 1;
            if (thisLocation[1] >= gridMaxY){
                //Over the screen. Shift to the row on the right
                thisLocation[0]++;
                thisLocation[1] = 0;
            }

            if (thisLocation[1] >= gridMaxY && thisLocation[0] >= gridMaxX){
                //Desktop full. Force put to 0 0 
                thisLocation[0] = 0;
                thisLocation[1] = 0;
                break;
            }
        }
        previousEmptyGridPosition = JSON.parse(JSON.stringify(thisLocation))
        locations.push(thisLocation)
    }

    return locations
}

//Set the icon desktop location given filename, grid x and y
function setIconDesktopLocation(sourceFilename, gridIndexX, gridIndexY, callback = undefined) {
    $.ajax({
        url: "system/desktop/files",
        method: "POST",
        data: {"set": sourceFilename, "x": gridIndexX, "y": gridIndexY},
        success: function(data) {
            if (data.error !== undefined) {
                console.log(data.error);
            } else {
                if (callback !== undefined) {
                    callback();
                }
                removeDesktopIconDuplicates();
            }
        }
    });
}

//Pass in the object fullpath and return the icon object onscreen
function getObjectFromPath(path) {
    var object;
    $(".launchIcon").each(function() {
        if ($(this).attr("filepath") == path) {
            object = $(this);
        }
    });
    return object;
}

//Pass in the coordinate and check if there is another object at the same location
function getObjectFromLocation(x, y) {
    var object;
    $(".launchIcon").each(function() {
        if ($(this).position().left == x && $(this).position().top == y) {
            object = $(this);
        }
    });
    return object;
}

//Similar function to getObjectFromLocation but using grid coordinate instead of pixel coordinate
function getObjectFromGridLocation(gx, gy){
    if (desktopGrids[gx] == undefined){
        //X overflow
        return false;
    }
    var pos = JSON.parse(JSON.stringify(desktopGrids[gx][gy]));
    pos[0] = pos[0] + iconOffsetXY[0];
    pos[1] = pos[1] + iconOffsetXY[1];
    return getObjectFromLocation(pos[0],pos[1]);
}

//Find the clostest empty grid, prioirty given to y first then x
function findClostestEmptyGridLocation(x, y){
    //Reduce icon offset to the x y on screen coordinate
    x = x - iconOffsetXY[0];
    y = y - iconOffsetXY[1];
    //Get the grid index from absolute coordinate
    var currentGridLocation = getGridIndexFromLocation(x,y);
    //console.log(currentGridLocation);
    //Search for the next empty location
    var targetLocation = [[-1,-1],[-1,-1]];
    for (var i = currentGridLocation[0]; i < desktopGrids.length; i++){
        var yStart = 0;
        if (i == currentGridLocation[0]){
            yStart = currentGridLocation[1];
        }
        for (k = yStart; k < desktopGrids[i].length; k++){
            var thisLocation = JSON.parse(JSON.stringify(desktopGrids[i][k]));
            var offsetedLocation = [thisLocation[0], thisLocation[1]];
            var possibleDuplication = getObjectFromGridLocation(i,k);
            //console.log( [i,k], offsetedLocation, possibleDuplication)
            if (possibleDuplication === undefined){
                //This is an empty slot
                targetLocation = [offsetedLocation, [i,k]];
                return targetLocation;
            }
        }
    }
    return targetLocation;
}

//Convert location to grid index
function getGridIndexFromLocation(x,y){
    var gridIndex = [-1,-1];
    for (var i = 0; i < desktopGrids.length; i++){
        var thisXAxis = desktopGrids[i];
        if (thisXAxis[0][0] == x){
            //This x matches. Match y
            gridIndex[0] = i;
            for (var k = 0; k < thisXAxis.length; k++){
                var thisYAxis = thisXAxis[k];
                if (thisYAxis[1] == y){
                    gridIndex[1] = k;
                    return gridIndex;
                }
            }
        }
    }
    return gridIndex;
}

//Convert grid index to location
function getLocationFromGridIndex(x, y){
    var location = [-1,-1];

    //Calculate the usable grid on screen
    var iheight = 106;
    var iwidth = 70;
    var padding = 16;
    if (desktopIconSize == "small") {
        iheight = 82;
        iwidth = 50;
    } else if (desktopIconSize == "medium") {
        iheight = 106;
        iwidth = 70;
    } else if (desktopIconSize == "big") {
        iheight = 124;
        iwidth = 84;
    }

    var screenHeight = window.innerHeight;
    var screenWidth = window.innerWidth;

    var vc = Math.floor((screenHeight - 20 - padding) / iheight);
    var hc = Math.floor((screenWidth - padding) / iwidth);

    //Calculate the position of this icon on the grid
    var resultX = padding + iwidth * x + iconOffsetXY[0];
    var resultY = padding + iheight * y + iconOffsetXY[1];

    return [resultX, resultY];
}   


//Set allow overshoot to allow drop point to get closest grid with x / y > cursor posx /y
function findClosestGrid(x, y, allowOvershoot = true) {
    var minDx = window.innerWidth;
    var minDy = window.innerHeight;
    var finalLocation = [-1, -1];
    var gridLocation = [-1, -1];
    for (var i = 0; i < desktopGrids.length; i++) {
        for (var j = 0; j < desktopGrids[0].length; j++) {
            var thisGridLocation = desktopGrids[i][j];
            var dx = x - thisGridLocation[0];
            var dy = y - thisGridLocation[1];
            if (allowOvershoot) {
                if (Math.abs(dx) < minDx) {
                    minDx = Math.abs(x - thisGridLocation[0]);
                    finalLocation[0] = thisGridLocation[0];
                    gridLocation[0] = i;
                }
                if (Math.abs(dy) < minDy) {
                    minDy = Math.abs(y - thisGridLocation[1]);
                    finalLocation[1] = thisGridLocation[1];
                    gridLocation[1] = j;
                }
            } else {
                if (dx < minDx && dx > 0) {
                    minDx = Math.abs(x - thisGridLocation[0]);
                    finalLocation[0] = thisGridLocation[0];
                    gridLocation[0] = i;
                }
                if (dy < minDy && dy > 0) {
                    minDy = Math.abs(y - thisGridLocation[1]);
                    finalLocation[1] = thisGridLocation[1];
                    gridLocation[1] = j;
                }
            }

        }
    }
    return [finalLocation, gridLocation];
}

//Ask for confirmation before window close
//Update 16 Feb 2021: Disabled confirmation and use a new method of implementing this later
/*
function myConfirmation() {
    if (!loggingOut){
        return 'Your data might not been saved. Are you sure you want to quit?';
    }
}

window.onbeforeunload = myConfirmation;
*/

function iconClicked(object, evt) {
    if (renameMode){
        //Exit rename mode if icon is clicked during renaming
        if ($(object).find(".renameInput").length == 0){
            exitRenameMode();
        }

    }
    hideAllContextMenus();

    //The click's own modifier state wins over the tracked flag: Cmd on a
    //Mac, Ctrl elsewhere. Ctrl + click on a Mac is the right click, so it
    //selects like one instead of toggling
    if (evt != undefined && evt.type == "mousedown"){
        ctrlHold = isPrimaryModifierHeld(evt);
    }

    //Clicked on a launch icon.
    var alreadyHighlighted = $(object).find(".launchIconWrapper").hasClass("selected");
    if (alreadyHighlighted){
        //Already selected
        if (ctrlHold) {
            //Selection
            $(object).find(".launchIconWrapper").removeClass("selected");
        }
    }else{
        //Not selected yet
        if (ctrlHold) {
            //Add this into selection
            $(object).find(".launchIconWrapper").addClass("selected");
        }else{
            //Remove all others and select this
            $(".launchIconWrapper.selected").removeClass("selected");
            $(object).find(".launchIconWrapper").addClass("selected");
        }
    }
}
