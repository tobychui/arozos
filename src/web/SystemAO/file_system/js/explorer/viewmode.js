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

    function updateViewmodeButtons(){
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
function updateSortingMethods(){
    var method = $("#sortingMethodSelector").val();
    sortMode = method;

    //Save it to server side
    $.ajax({
        url: "../../system/file_system/sortMode",
        method: "POST",
        data: {opr: "set", folder: currentPath, mode: sortMode},
        success: function(data){
            refreshList();
        }
    });
}

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
window.updateSortingMethods = updateSortingMethods;
