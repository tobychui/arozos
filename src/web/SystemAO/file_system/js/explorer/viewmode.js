/*
    viewmode.js

    View mode + sort preference handling.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

    //Change the current view mode
    function changeViewMode(object){
        var targetMode = $(object).attr("mode");
        viewMode = targetMode;
        refreshList(undefined, true);
        updateViewmodeButtons();
        setPreference("file_explorer/listmode",targetMode)
    }

    //Toggle properties view
    //Setting will be save to this browser only
    function togglePropertiesView(object){
        propertiesView = !propertiesView;
        if (propertiesView){
            $("#propertiesView").show();
            $(object).addClass('active');
            localStorage.setItem("file_explorer/viewProperties", "true");

            if ($(".fileObject.selected").length >= 1){
                //Load the file properties
                let targetFile = getFileObjectFromFID(lastClickedFileID);
                if (targetFile == null){
                    targetFile = $(".fileObject.selected")[0];
                }
                let filepath = $(targetFile).attr("filepath");
                loadFileProperties(filepath);
            }
        }else{
            $("#propertiesView").hide();
            $(object).removeClass('active');
            localStorage.setItem("file_explorer/viewProperties", "false");
        }
    }

    //The tile size slider only applies to the thumbnail grid
function updateZoomControlVisibility(){
    $("#fmZoom").toggle(viewMode == "grid");
    initWindowSizes(false);
}

function updateViewmodeButtons(){
    updateZoomControlVisibility();
        $(".videmode").removeClass('disabled');
        $(".videmode").each(function(){
            if ($(this).attr("mode") == viewMode){
                $(this).addClass("disabled");
            }
        });
    }

    function loadListModeFromDB(callback = undefined){
            //Get list mode from storage
            loadPreference("file_explorer/listmode",function(data){
            if (data != "" && data.error === undefined){
                viewMode = data;
                updateViewmodeButtons();
            }

            if (callback !== undefined){
                callback();
            }
        });
    }

//Update sorting method for file listing
/*
    Apply a sort mode, persist it for this folder and re-list.

    The nav row's sort menu replaced the old <select>, but the stored vocabulary
    is unchanged (default / reverse / smallToLarge / largeToSmall / mostRecent /
    leastRecent / fileTypeAsce / fileTypeDesc / smart) so an older client reading
    the same preference still understands it.
*/
function setSortMode(mode){
    sortMode = mode;
    updateSortMenuState();
    closeSortMenu();

    $.ajax({
        url: "../../system/file_system/sortMode",
        method: "POST",
        data: {opr: "set", folder: currentPath, mode: sortMode},
        success: function(){
            refreshList();
        }
    });
}

//Tick the active mode in the sort menu
function updateSortMenuState(){
    $("#fmSortMenu .fmSortOption").each(function(){
        $(this).toggleClass("active", $(this).attr("data-sort") == sortMode);
    });
}

function toggleSortMenu(event){
    if (event != undefined){
        event.stopPropagation();
    }
    if ($("#fmSortMenu").hasClass("open")){
        closeSortMenu();
    }else{
        closeFileOprMenu();
        updateSortMenuState();
        $("#fmSortMenu").addClass("open");
        $("#fmSortBtn").addClass("active");
    }
}

function closeSortMenu(){
    $("#fmSortMenu").removeClass("open");
    $("#fmSortBtn").removeClass("active");
}

$(document).on("click", function(event){
    if ($(event.target).closest("#fmSortMenu, #fmSortBtn").length == 0){
        closeSortMenu();
    }
});

//Toggle preview windows size from small to large mode,
//set restoreDefault to true for force small interface
function togglePreviewWindowSize(restoreDefault = false){
    if ($("#propertiesView").hasClass("small") && restoreDefault == false){
        //Set it to big
        $("#propertiesView").css({
            "width": "500px",
            "min-width": "500px"
        });
        $("#propertiesView").removeClass("small").addClass("big");
        $("#propertiesView").find(".sizeToggle").html(`<i class="compress icon"></i>`);
        $("#propertiesView").find(".sizeToggle").attr("title", applocale.getString("sidebar/properties/shrink", "Shrink Properties Sidebar"));
    }else{
        //Set it to small
        $("#propertiesView").css({
            "width": "300px",
            "min-width": "300px"
        });
        $("#propertiesView").removeClass("big").addClass("small");
        $("#propertiesView").find(".sizeToggle").html(`<i class="expand icon"></i>`);
        $("#propertiesView").find(".sizeToggle").attr("title", applocale.getString("sidebar/properties/expand", "Expand Properties Sidebar"));
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.changeViewMode = changeViewMode;
window.togglePreviewWindowSize = togglePreviewWindowSize;
window.togglePropertiesView = togglePropertiesView;
window.setSortMode = setSortMode;
            window.toggleSortMenu = toggleSortMenu;
            window.updateSortMenuState = updateSortMenuState;
