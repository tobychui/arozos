/*
    ui.js

    Window layout, sidebar toggles, theme, toast messages and popup chrome.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Preference setting and loading functions.
function setPreference(key, value){
    $.ajax({
        url:"../../system/file_system/preference?key=" + key + "&value=" + value,
        success: function(data){
            if (data.error !== undefined){
            }
        }
    });
}

function loadPreference(key, callback){
    $.get("../../system/file_system/preference?key=" + key,function(data){
        callback(data);
    });
}

// ============================== WINDOW RESIZE FUNCTIONS =====================

/*
    Everything whose size is derived from the viewport, in one place.

    This has to be re-runnable rather than something that only happens on the
    first render: the file area's column density and the mobile sidebar width
    are computed from measured widths, so after a rotation they are all still
    describing the previous orientation.
*/
function applyResponsiveLayout(){
    if (isMobile){
        //Derived from the viewport at load time, so it is stale after a rotate
        directorySidebarWidth = window.innerWidth;
        $("#directorySidebar").css("width", window.innerWidth + "px");
    }else{
        //A pane width that was legal before can be over its ceiling now
        reclampPaneWidths();
    }

    //Column dropping and tile density key off the file area's own width, which
    //a rotation changes without anything re-rendering the list
    updateListDensity();
    updateZoomControlVisibility();
    initWindowSizes(false);

    if (!isMobile && window.innerWidth < 620 && sideBarShown == true){
        toggleSidebar(false);
    }else if (!isMobile && window.innerWidth > 650 && sideBarShown == false){
        toggleSidebar(false);
    }

    //Resize the share iframe
    resizeShareIframe()

    //Resize the path display content
    if (!pathInputMode){
        updatePathDisplay(currentPath);
    }
}

/*
    Mobile browsers report the old innerWidth/innerHeight for a frame or two
    after a rotation, so a single pass on the event lays the panes out against
    the orientation that is going away. Run once immediately to keep the resize
    responsive, then again once the metrics have settled.
*/
function scheduleResponsiveLayout(){
    applyResponsiveLayout();
    clearTimeout(responsiveLayoutTimer);
    responsiveLayoutTimer = setTimeout(applyResponsiveLayout, 250);
}

$(window).on("resize", scheduleResponsiveLayout);

/*
    orientationchange fires on phones where a resize sometimes does not, and
    visualViewport catches the browser chrome collapsing on scroll - which
    changes the usable height without a window resize event.
*/
window.addEventListener("orientationchange", scheduleResponsiveLayout);
if (window.visualViewport != undefined){
    window.visualViewport.addEventListener("resize", scheduleResponsiveLayout);
}

function toggleMobileSidebar(show=undefined, callback=undefined){
    if(show == true){
        $("#mobileNaviBar").stop().finish().show();
    }else if (show == false){
        $("#mobileNaviBar").stop().finish().hide();
    }else{
        $("#mobileNaviBar").toggle();
    }

    if (callback != undefined){
        setTimeout(callback, 300);
    }
}

function toggleSidebar(useAnimation=true){
    //Fixing desktop bugs on showing the sidebar
    if (isMobile){
        if (sideBarShown){
            $("#directorySidebar").hide();
        }else{
            $("#directorySidebar").show();
        }
        
    }else{
        if (sideBarShown){
            $("#directorySidebar").stop().finish().transition("slide right out", function(){
                $("#directorySidebar").hide();
            });
        }else{
            $("#directorySidebar").stop().finish().transition("slide right in", function(){
                $("#directorySidebar").show();
            });
        }
    }
    
    sideBarShown = !sideBarShown;
    updateSplitterVisibility();
    initWindowSizes(useAnimation);
}

function initWindowSizes(animate=true){
    var h = $("#navibar").css("height");
    /*
        outerHeight, not height: .height() returns the content box and leaves out
        the nav bar's 2px bottom border, which pushed everything below it 2px
        past the window edge. The status bar sits below #mainWindow in normal
        flow, so its height has to come out of the panes above it too.
    */
    var hint = $("#navibar").outerHeight();
    var statusHeight = $("#fmStatusBar").is(":visible") ? $("#fmStatusBar").outerHeight() : 0;
    var windowHeight = window.innerHeight - hint - statusHeight;
    if (sideBarShown){
        //Resize the sidebar 
        $("#directorySidebar").css("top",h);
        $("#directorySidebar").css("width",directorySidebarWidth);
        $("#directorySidebar").css("height",windowHeight + "px");
        //Resize the file viewer
        $("#folderView").css("top",h);
        $("#folderView").css("height",windowHeight + "px");
    }else{
        $("#folderView").css("top",h);
        if (animate){
            $("#folderView").stop().finish().animate({
                left:'0px',
                width:(window.innerWidth - 2 + "px")
            },200);
        }else{
            $("#folderView").css({
                left:'0px',
                width:(window.innerWidth - 2 + "px")
            });
        }
        $("#folderView").css("height",windowHeight + "px");
    }

    $("#propertiesView").css("height", windowHeight + "px");
}

/*
    Paints the theme classes/icons only - no preference save, no broadcast.
    Shared by the toolbar toggle button (below) and by the live-sync listener
    in boot.js that reacts to the desktop's own theme switch, so a change
    triggered from elsewhere doesn't loop back into another broadcast.
*/
function applyTheme(theme){
    var isDark = (theme == "dark" || theme == "darkTheme");
    if (isDark){
        $("body").removeClass("whiteTheme").addClass("darkTheme");
        currentTheme = "darkTheme";
        $("#darkthemebtn").attr("class","sun icon");
        $("#darkthemebtn").parent().removeClass("inverted");
        $("#darkthemebtn").css("color", "#3d3f47");
        $(".dropdown").addClass("inverted");
        $("#mobileNaviBar").addClass("inverted");
    }else{
        $("body").removeClass("darkTheme").addClass("whiteTheme");
        currentTheme = "whiteTheme";
        $("#darkthemebtn").attr("class","moon icon");
        $("#darkthemebtn").parent().addClass("inverted");
        $(".dropdown").removeClass("inverted");
        $("#mobileNaviBar").removeClass("inverted");
        $("#darkthemebtn").css("color", "#dadada");
    }
}

function toggleDarkTheme(){
    var goingWhite = $(".darkTheme").length > 0;
    var newTheme = goingWhite ? "whiteTheme" : "darkTheme";
    applyTheme(newTheme);
    setPreference("file_explorer/theme", newTheme);

    //If in vdi mode, update desktop's listMenu as well
    if (ao_module_virtualDesktop){
        parent.initTheme(newTheme);
    } else {
        // Standalone: notify other open tabs via localStorage
        try { localStorage.setItem('ao_system_theme', JSON.stringify({theme: goingWhite ? 'light' : 'dark', ts: Date.now()})); } catch(e) {}
    }
}

/*
    Toast

    Call sites pass a semantic-ui icon class as the first argument, and that
    string is the only signal available for whether something went wrong - the
    failure paths all use a red or warning glyph. Rather than touch 43 call
    sites, the class is matched here.
*/
function msgboxIsError(icon){
    return /(^|\s)(red|remove|caution|exclamation|warning|ban)(\s|$)/.test(icon);
}

function msgbox(icon, text, delay=3000){
    let box = $("#msgbox");
    box.find(".msgboxText").text(text);
    box.find("i").attr("class", icon + " icon");
    box.toggleClass("error", msgboxIsError(icon));

    clearTimeout(msgboxTimer);
    box.css("display", "flex");
    //Force a reflow between display and the class, otherwise the browser
    //collapses both into one style resolution and the transition never runs
    void box[0].offsetWidth;
    box.addClass("visible");

    msgboxTimer = setTimeout(hideMsgBox, delay);
}

function hideMsgBox(){
    clearTimeout(msgboxTimer);
    let box = $("#msgbox");
    box.removeClass("visible");
    //Take it out of the layer once faded. Driven by a timer rather than
    //transitionend, which never fires if the element is hidden mid-fade.
    msgboxTimer = setTimeout(function(){
        if (!box.hasClass("visible")){
            box.css("display", "none");
        }
    }, 200);
}

    

$(".popupWrapper").on("click",function(){
    hideAllPopupWindows();
});

function hideAllPopupWindows(){
    $(".popup:visible").transition('slide left out');
    $(".popupWrapper").fadeOut(100);
    $('body').css("overflow","");
    if($("#shareFile").is(":visible")){
        $("#shareFileEmbedded").attr("src", "");
    }
}

function showPopupWrapper(){
    //Every dialog goes through here, so this is the one place that has to know
    //the transfer panel shares the corner it is about to cover
    collapseUploadPanelForDialog();
    $(".popupWrapper").fadeIn('fast');
    $('body').css("overflow","hidden");
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.hideAllPopupWindows = hideAllPopupWindows;
window.hideMsgBox = hideMsgBox;     // the toast's close button
window.toggleDarkTheme = toggleDarkTheme;
window.applyTheme = applyTheme;
window.toggleMobileSidebar = toggleMobileSidebar;
window.toggleSidebar = toggleSidebar;


/* ---------------------------------------------------------------------- */
/*  Toolbar overflow menu                                                  */
/* ---------------------------------------------------------------------- */
/*
    Holds everything the old icon strip used to carry. Per-item actions live in
    the right click menu; this is the rest.
*/
function toggleFileOprMenu(event){
    if (event != undefined){
        event.stopPropagation();
    }
    if ($("#fmMoreMenu").hasClass("open")){
        closeFileOprMenu();
    }else{
        //Only one nav menu open at a time
        if (typeof closeSortMenu == "function"){
            closeSortMenu();
        }
        updateOprMenuRelevance();
        $("#fmMoreMenu").addClass("open");
        $("#fmMoreBtn").addClass("active");
    }
}

function closeFileOprMenu(){
    $("#fmMoreMenu").removeClass("open");
    $("#fmMoreBtn").removeClass("active");
}

//Run a menu action and dismiss the menu
function runFileOpr(fn){
    closeFileOprMenu();
    if (typeof fn === "function"){
        fn();
    }
}

$(document).on("click", function(event){
    if ($(event.target).closest("#fmMoreMenu, #fmMoreBtn").length == 0){
        closeFileOprMenu();
    }
});


/* ---------------------------------------------------------------------- */
/*  Classic file operation toolbar                                         */
/* ---------------------------------------------------------------------- */
/*
    The toolbar and the overflow menu expose the same actions, so only one of
    them should carry them at a time: with the toolbar visible the duplicated
    entries are hidden from the menu, leaving just the things the toolbar has no
    room for (select all, theme, sorting, and this toggle).

    The preference is stored server side under file_explorer/oprbar so it follows
    the user between browsers. Mobile always hides the bar - that layout has its
    own arrangement and the bar does not fit it.
*/
function applyOprBarVisibility(){
    let visible = showOprBar && !isMobile;
    $("#fileOprBar").toggle(visible);
    $("#fmToolbarToggle").toggleClass("checked", showOprBar);
    syncOprMenuDuplicates();
    initWindowSizes(false);
}

/*
    Hide an overflow menu entry only while the toolbar is actually offering that
    same action on screen.

    This is measured rather than assumed, because the toolbar collapses as the
    window narrows: whole button groups drop out to avoid wrapping to a second
    row. A static "the toolbar covers these" list would then leave those actions
    unreachable from either place.
*/
function syncOprMenuDuplicates(){
    let offered = {};
    if ($("#fileOprBar").is(":visible")){
        $("#fileOprBar [data-opr]").each(function(){
            if ($(this).is(":visible")){
                offered[$(this).attr("data-opr")] = true;
            }
        });
    }

    $("#fmMoreMenu [data-opr]").each(function(){
        let dup = offered[$(this).attr("data-opr")] === true;
        //An entry shows only if the toolbar is not already offering it AND it
        //can actually do something with the current selection / clipboard
        let unusable = $(this).hasClass("fmOprUnusable");
        $(this).toggle(!dup && !unusable);
    });

    tidyMenuSeparators();
}

/*
    Hide separators that no longer divide anything. As toolbar entries are hidden
    from the menu, whole blocks between two separators can disappear and leave
    stacked or dangling rules behind.

    A separator earns its place only if a visible item sits both above and below
    it, and only the first of a consecutive run is kept.
*/
function tidyMenuSeparators(){
    let children = $("#fmMoreMenu").children().toArray();

    //Reset so a previously hidden separator can come back
    $("#fmMoreMenu .fsMenuSep").show();

    /*
        Do not use :visible here. This runs while the menu itself is closed, and
        jQuery reports every descendant of a hidden element as invisible - which
        made each separator look like a leading one and hid them all. The
        element's own computed display is what matters.
    */
    let shown = function(el){
        return window.getComputedStyle(el).display != "none";
    };

    let seenItemAbove = false;
    let lastShownSep = null;
    for (let i = 0; i < children.length; i++){
        let el = children[i];
        if ($(el).hasClass("fsMenuSep")){
            if (!seenItemAbove || lastShownSep != null){
                //Leading, or directly after another separator
                $(el).hide();
            }else{
                lastShownSep = el;
            }
            continue;
        }
        if (shown(el)){
            seenItemAbove = true;
            lastShownSep = null;
        }
    }

    //Anything still marked as the last separator has no visible item under it
    if (lastShownSep != null){
        $(lastShownSep).hide();
    }
}

function toggleFileOprBar(){
    showOprBar = !showOprBar;
    applyOprBarVisibility();
    setPreference("file_explorer/oprbar", showOprBar ? "true" : "false");
    closeFileOprMenu();
}


//The toolbar collapses at breakpoints, so what it offers changes with the window
$(window).on("resize", function(){
    syncOprMenuDuplicates();
});


/*
    Hide menu entries that cannot act right now: most operations need a
    selection, and Paste needs something on the clipboard.

    This applies to the overflow menu only. The large toolbar buttons keep their
    old behaviour of staying put and doing nothing, because a toolbar that
    reflows every time the selection changes is worse than one with a few
    inert buttons.
*/
var OPR_NEEDS_SELECTION = ["open", "openwith", "copy", "cut", "rename", "delete",
                           "download", "share", "fileinfo"];

function updateOprMenuRelevance(){
    let hasSelection = $(".fileObject.selected").length > 0;
    let hasClipboard = (typeof clipboard != "undefined") && clipboard.length > 0;

    $("#fmMoreMenu [data-opr]").each(function(){
        let opr = $(this).attr("data-opr");
        let usable = true;
        if (OPR_NEEDS_SELECTION.indexOf(opr) >= 0){
            usable = hasSelection;
        }else if (opr == "paste"){
            usable = hasClipboard;
        }
        $(this).toggleClass("fmOprUnusable", !usable);
    });

    //Re-run the toolbar de-duplication so hidden-by-relevance entries are
    //accounted for, then tidy the separators around whatever is left
    syncOprMenuDuplicates();
}


/*
    Some operation labels carry a <br> so the wide toolbar button can render on
    two lines ("New<br>Folder"). applocale injects the string as HTML, so the
    same label wraps inside the overflow menu where a menu row must stay on one
    line. Swap those breaks for a space once, after localisation has run.
*/
function flattenMenuLabels(){
    $("#fmMoreMenu .fsMenuItem br, #fmSortMenu .fsMenuItem br").replaceWith(" ");
}
