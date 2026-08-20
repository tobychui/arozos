/*
    splitter.js

    Drag handles between the three panes of the main window: the quick access
    sidebar, the file list and the properties pane.

    The limits themselves are constants in js/explorer/state.js (FM_SIDEBAR_*,
    FM_PROPS_*, FM_MAIN_MIN_WIDTH) so they can be retuned in one place.

    Desktop only. The touch layout puts the sidebar over the file list as a
    drawer rather than beside it, so there is no boundary to drag.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function clampPaneWidth(width, min, max){
    if (max < min){
        //A window too narrow to honour both bounds: the floor wins, otherwise
        //the pane would collapse to nothing
        return min;
    }
    return Math.max(min, Math.min(max, Math.round(width)));
}

/*
    How wide the panes are allowed to get right now.

    The upper bounds are not fixed numbers: they also have to leave
    FM_MAIN_MIN_WIDTH for the file list, so on a narrow window the ceiling comes
    down rather than letting a drag squeeze the middle pane away.
*/
function sidebarWidthLimits(){
    let available = $("#mainWindow").width() - FM_MAIN_MIN_WIDTH -
                    ($("#propertiesView").is(":visible") ? $("#propertiesView").outerWidth() : 0);
    return {
        min: Math.round(FM_SIDEBAR_MAX_WIDTH * FM_SIDEBAR_MIN_RATIO),
        max: Math.min(FM_SIDEBAR_MAX_WIDTH, available)
    };
}

function propertiesWidthLimits(){
    let available = $("#mainWindow").width() - FM_MAIN_MIN_WIDTH -
                    (sideBarShown ? $("#directorySidebar").outerWidth() : 0);
    return {
        min: FM_PROPS_MIN_WIDTH,
        max: Math.min(FM_PROPS_MAX_WIDTH, available)
    };
}

/*
    Both setters write width and min-width together: the panes carry a min-width
    in the stylesheet to stop flexbox shrinking them, and leaving it behind would
    silently pin the pane at its old size on the way down.
*/
function setSidebarWidth(width){
    let limits = sidebarWidthLimits();
    directorySidebarWidth = clampPaneWidth(width, limits.min, limits.max);
    $("#directorySidebar").css({
        "width": directorySidebarWidth + "px",
        "min-width": directorySidebarWidth + "px"
    });
    return directorySidebarWidth;
}

function setPropertiesWidth(width){
    let limits = propertiesWidthLimits();
    let applied = clampPaneWidth(width, limits.min, limits.max);
    $("#propertiesView").css({
        "width": applied + "px",
        "min-width": applied + "px"
    });
    return applied;
}

/*
    Pointer events rather than mousedown/mousemove: setPointerCapture keeps the
    drag alive when the cursor crosses the embedded share iframe or leaves the
    window, which a document level mousemove listener does not.
*/
function bindPaneSplitter(handleID, options){
    let handle = document.getElementById(handleID);
    if (handle == null){
        return;
    }

    handle.addEventListener("pointerdown", function(evt){
        if (evt.button != 0){
            return;
        }
        //Stops the drag from selecting text across the panes
        evt.preventDefault();

        let startX = evt.clientX;
        let startWidth = options.getWidth();
        /*
            Capture is an optimisation, not a requirement - the listeners below
            are on the handle itself. It throws if the pointer is no longer
            active by the time this runs, which must not abort the drag.
        */
        try { handle.setPointerCapture(evt.pointerId); } catch(e) {}
        handle.classList.add("dragging");
        //Suppresses hover effects and text selection everywhere for the drag
        $("body").addClass("fmResizing");

        function onMove(e){
            options.setWidth(startWidth + (e.clientX - startX) * options.direction);
        }

        function onEnd(){
            try { handle.releasePointerCapture(evt.pointerId); } catch(e) {}
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onEnd);
            handle.removeEventListener("pointercancel", onEnd);
            handle.classList.remove("dragging");
            $("body").removeClass("fmResizing");
            //The file list re-flows its columns and tile density from its width
            initWindowSizes(false);
        }

        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onEnd);
        handle.addEventListener("pointercancel", onEnd);
    });
}

function initPaneSplitters(){
    if (isMobile){
        //The sidebar is a full width drawer here, not a column beside the list
        $(".fmSplitter").hide();
        return;
    }

    bindPaneSplitter("fmSidebarSplitter", {
        direction: 1,   //dragging right widens the sidebar
        getWidth: function(){ return $("#directorySidebar").outerWidth(); },
        setWidth: setSidebarWidth
    });

    bindPaneSplitter("fmPropsSplitter", {
        direction: -1,  //dragging right narrows the properties pane
        getWidth: function(){ return $("#propertiesView").outerWidth(); },
        setWidth: setPropertiesWidth
    });

    updateSplitterVisibility();
}

/*
    A handle only means something with a pane on both sides of it, so each one
    follows the pane it resizes. Called whenever either pane is toggled.
*/
function updateSplitterVisibility(){
    if (isMobile){
        return;
    }
    /*
        sideBarShown rather than :visible for the sidebar - it is hidden through
        a slide transition, so straight after a toggle the element still reports
        as visible while the state flag is already correct.
    */
    $("#fmSidebarSplitter").toggle(sideBarShown);
    $("#fmPropsSplitter").toggle($("#propertiesView").is(":visible"));
}

/*
    Re-clamp after the window itself changes size: a pane that was legal at the
    old width can be over its ceiling at the new one.
*/
function reclampPaneWidths(){
    if (isMobile){
        return;
    }
    if (sideBarShown){
        setSidebarWidth($("#directorySidebar").outerWidth());
    }
    if ($("#propertiesView").is(":visible")){
        setPropertiesWidth($("#propertiesView").outerWidth());
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.setPropertiesWidth = setPropertiesWidth;
window.setSidebarWidth = setSidebarWidth;
window.updateSplitterVisibility = updateSplitterVisibility;
