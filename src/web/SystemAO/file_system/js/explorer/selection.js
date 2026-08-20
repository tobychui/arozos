/*
    selection.js

    File object selection, multi-select and the right-click context menu.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function bindFileObjectEvents(){
    $(".fileObject").off("click").on("click",function(evt){
        if (isMobile){
            //There are no context menu in mobile
            //Stop event propagation to document.click event
            evt.stopImmediatePropagation();
        }
        if (renameMode && $(this).find(".renameinput").length == 0){
            exitRenameModeWithConfirm();
            return;
        }else if (renameMode){
            //Stop the click event propagating to the #fileViewer on-click exit event
            evt.stopImmediatePropagation();
        }

        /*
            Double tap on a phone.

            Two taps land as two independent clicks, so the gesture is timed
            here. In multi-select the two taps select and deselect again, which
            leaves the selection exactly as it was - so the pair can simply be
            treated as "open" once the second one arrives.
        */
        let isSecondTap = false;
        if (isMobile){
            let thisFileID = $(this).attr("fileid");
            let now = Date.now();
            isSecondTap = (lastTapFileID === thisFileID &&
                           (now - lastTapTime) < MOBILE_DOUBLE_TAP_MS);
            lastTapFileID = thisFileID;
            //Reset rather than extend, so a triple tap is not two double taps
            lastTapTime = isSecondTap ? 0 : now;
        }

        if (ctrlHold == true){
            if ($(this).hasClass("selected")){
                $(this).removeClass("selected");

                //Deselecting the last item normally ends multi-select, but when
                //the user switched it on deliberately it stays on until they
                //switch it off again
                if ($(".fileObject.selected").length == 0 && !stickyMultiSelect){
                    exitMultiSelectMode();
                }
            }else{
                $(this).addClass("selected");
                if (propertiesView){
                    let filepath =  $(this).attr("filepath");
                    loadFileProperties(filepath);
                }
            }
            
            lastClickedFileID = parseInt($(this).attr("fileid"));

            /*
                Tapping twice opens the file even while multi-select is on -
                otherwise there is no way to open anything without first leaving
                the mode. Folders keep tap-to-select here: navigating away would
                throw away the selection the user is building.
            */
            if (isSecondTap && isMobile && $(this).attr("type") == "file"){
                updateSelectedObjectsCount();
                openthis(this, evt);
                return;
            }
        }else if (shiftHold == true){
            //Select everything in range lastClicked to this
            var thisFileID = $(this).attr("fileid");
            let start = parseInt(thisFileID);
            let end = parseInt(lastClickedFileID);
            if (start > end){
                start = parseInt(lastClickedFileID);
                end = parseInt(thisFileID);
            }
            //Select all fileObject in range.
            $(".fileObject").each(function(){
                let currentItemFileID = $(this).attr('fileid');
                currentItemFileID = currentItemFileID - 0;
                if (currentItemFileID >= start && currentItemFileID <= end){
                    $(this).addClass("selected");
                }
            });
        }else if(!ctrlHold && isMobile){
            //If on mobile, click means open (only on not muilti selection mode)
            evt.preventDefault();
            evt.stopImmediatePropagation();

            //A single tap already opened this on the first of the two taps;
            //acting again would launch the app a second time
            if (isSecondTap){
                return;
            }

            openthis(this,evt);

            //Deselect everything if in multi-select mode
            if (ctrlHold){
                ctrlHold = false;
                updateCtrlDisplay();
            }
            return
        }else{
            //Nothing is pressed. Deselect everything and add this only
            $(".fileObject.selected").removeClass("selected");
            $(this).addClass("selected");
            lastClickedFileID = $(this).attr("fileID");

            if (propertiesView){
                loadFileProperties($(this).attr("filepath"));
            }
        }

        updateSelectedObjectsCount();
    });

    //Bind right click select on items
    $(".fileObject").off("mousedown").on("mousedown",function(evt){
        if (evt.which == 3){
            //Right click on this file
            if ($(this).hasClass('selected') == false){
                $(".fileObject.selected").removeClass("selected");
                $(this).addClass("selected");
            }
            
        }
    });

    //This function calculate and offset the context menu to not go out of the window area
    function calculateContextMenuOffsets(evt){
        var defaultLeftPost = evt.pageX + "px";
        var defaultTopPost =evt.pageY + "px";
        
        if (evt.pageX > window.innerWidth / 2){
            defaultLeftPost = evt.pageX - $("#contextmenu").width();
            
            if (defaultLeftPost < 0){
                //over the left boundary
                defaultLeftPost = 0;
            }
            defaultLeftPost = defaultLeftPost + "px";
        }else{

            if (evt.pageX + $("#contextmenu").width() > window.innerWidth){
                //Over the right boundary
                defaultLeftPost = window.innerWidth - $("#contextmenu").width();
                defaultLeftPost = defaultLeftPost + "px";
            }
        }

        if (evt.pageY > window.innerHeight / 2){
            defaultTopPost = evt.pageY - $("#contextmenu").height();

            if (defaultTopPost < 0){
                //over the top boundary
                defaultTopPost = 0;
            }
            defaultTopPost = defaultTopPost + "px"
            
        }else{
            if (evt.pageY + $("#contextmenu").height() > window.innerHeight){
                //Over the lower boundary
                defaultTopPost =  window.innerHeight - $("#contextmenu").height();
                defaultTopPost = defaultTopPost + "px"
            }
        }
        
        $("#contextmenu").css({
            left: defaultLeftPost,
            top: defaultTopPost
        });

    }  

    //Rightclick on a file object
    $(".fileObject").off("contextmenu").on("contextmenu", function(evt){
        evt.preventDefault();
        if (isMobile){
            //Firefox Mobile. Fix select with context menu not working bug
            var selectedObject = $(evt.target);
            
            if ($(selectedObject).hasClass("fileObject")){
                if (!ctrlHold){
                    $(".fileObject.selected").removeClass("selected");
                }
                $(selectedObject).addClass("selected");
            }else{
                //Uptrace 5 layers for fileObject
                for (var i = 0; i < 5; i++){
                    if ($(selectedObject).hasClass("fileObject") == false){
                        selectedObject = $(selectedObject).parent();
                    }else{
                        break;
                    }
                }

                if (!ctrlHold){
                    $(".fileObject.selected").removeClass("selected");
                }
                $(selectedObject).addClass("selected");
            }

            if (propertiesView){
                let filepath = $(selectedObject).attr("filepath");
                loadFileProperties(filepath);
            }

            //Enable multi-select mode
            ctrlHold = true;
            updateCtrlDisplay();
            return;
        }

        //Show all options by defaults
        $("#contextmenu").find(".item").show();
        $("#contextmenu").find(".vroothide").show();
        $("#contextmenu").find(".noSelectionOnly").hide();
        $("#contextmenu").find(".vrootonly").hide();
        $("#contextmenu").find(".zipFileOnly").hide();

        //Hide general menu options for single / multiple
        if ($(".fileObject.selected").length > 1){
            //Multiple object selected
            $(".singleObjectOnly").addClass("disabled");
            $(".singleObjectOnlyHide").hide();
            console.log("Hiding");
        }else{
            //Single object
            $(".singleObjectOnly").removeClass("disabled");
            $(".singleObjectOnlyHide").show();
        }

        //Check if this is folder or file. Replace the suitable selections
        if ($(this).attr("type") == "folder"){
            //Use folder mode
            $("#contextmenu").find(".folderonly").show();
            $("#contextmenu").find(".fileonly").hide();
        }else{ 
            //Use file mode
            $("#contextmenu").find(".folderonly").hide();
            $("#contextmenu").find(".fileonly").show();
        }
        console.log($(this).attr("type"));

        if (searchMode == true){
            $("#contextmenu").find(".shareonly").show();
        }else{
            $("#contextmenu").find(".shareonly").hide();
        }

        $("#contextmenu").addClass("visible");
        //Handle CSS offset of the contextmenu
        if ($("#contextmenu").offset().top < 0){
            $("#contextmenu").css("top","0px");
        }else if($("#contextmenu").offset().top + $("#contextmenu").height() > window.innerHeight){
            $("#contextmenu").css("top",window.innerHeight - $("#contextmenu").height() + "px");
        }

        if (isMobile){
            $("#contextmenu").find(".mobileonly").show();
        }else{
            $("#contextmenu").find(".mobileonly").hide();
        }

        $(".fileObject.selected").each(function(){
            if ($(this).attr("filename").split(".").pop().toLowerCase() == "zip"){
                $(".zipFileOnly").show();
            }
        });

        calculateContextMenuOffsets(evt);

        //Disable scroll on folderView
        //$("#folderView").addClass("fixscroll");
    });

    //Right click on empty space of the file selector
    $("#folderView").off("contextmenu").on("contextmenu", function(e){
        if ($(e.target).attr("id") == "folderView" || $(e.target).attr("id") == "fileList" || $(e.target).attr("id") == "folderList" || $(e.target).is("table") || $(e.target).is("th")){
            //Context menu on the empty space of the folder / file list
            e.preventDefault();
            $("#contextmenu").find(".item").hide();
            $("#contextmenu").find(".noSelectionOnly").show();
            $("#contextmenu").find(".allowNoSelection").show();
            $("#contextmenu").find(".vroothide").show();
            $("#contextmenu").find(".zipFileOnly").hide();

            //Calculate the position of the context menu
            calculateContextMenuOffsets(e);

            //Show context menu
            $("#contextmenu").addClass("visible");
            //Handle CSS offset of the contextmenu
            if ($("#contextmenu").offset().top < 0){
                $("#contextmenu").css("top","0px");
            }else if($("#contextmenu").offset().top + $("#contextmenu").height() > window.innerHeight){
                $("#contextmenu").css("top",window.innerHeight - $("#contextmenu").height() + "px");
            }
        }
    });

    //Handle right click on storage roots
    $("#storageroot").off("contextmenu").on("contextmenu", function(e){
        /*
            Resolve the row from whatever was actually right clicked. The sidebar
            rows now wrap their icon and label in spans (and the icon is an inline
            SVG), so e.target is usually a descendant rather than the .dir.item
            itself - the old "if it is an <i>, step up one level" check no longer
            reached it and the menu never opened.
        */
        let row = $(e.target).closest(".dir.item")[0];
        if (row != undefined){
            e.target = row;
        }

        $("#storageroot").find(".dir.item").each(function(){
            if ($(this).attr("rootname") != undefined){
                $(this).removeClass("active");
            }
        });

        if ($(e.target).attr("rootname") != undefined){
            //Correct one. Show vroot functions
            e.preventDefault();
            var rootname = $(e.target).attr("rootname");
            $(e.target).addClass("active");
            $("#contextmenu").find(".item").hide();
            $("#contextmenu").find(".vroothide").hide();
            $("#contextmenu").find(".vrootonly").show();

            //Show context menu
            calculateContextMenuOffsets(e);

            $("#contextmenu").addClass("visible");
            //Handle CSS offset of the contextmenu
            if ($("#contextmenu").offset().top < 0){
                $("#contextmenu").css("top","0px");
            }else if($("#contextmenu").offset().top + $("#contextmenu").height() > window.innerHeight){
                $("#contextmenu").css("top",window.innerHeight - $("#contextmenu").height() + "px");
            }
        }
    });

    $(document).on("click",function(evt){
        $(".contextmenu").removeClass("visible");
        //Record what has been clicked
        lastClickedElement = evt.target;
    });
}

//Update the selected items display count
function updateSelectedObjectsCount(){
    let total = $(".fileObject").length;
    let selected = $(".fileObject.selected").length;

    $("#selectInfo").text(total + " " + applocale.getString("status/items", "items") +
        (selected > 0 ? "  |  " + selected + " " + applocale.getString("status/selected", "selected") : ""));

    //Sum the byte sizes already emitted onto each file row
    let bytes = 0;
    $(".fileObject.selected").each(function(){
        let v = parseInt($(this).attr("filesize"));
        if (!isNaN(v) && v > 0){
            bytes += v;
        }
    });
    $("#fmSelectionSize").text(bytes > 0 ? FileThumb.formatBytes(bytes) : "");
    updateMultiSelectDisplay();
}

/*
    Check marks are a multi-select affordance, not a selection indicator: a plain
    click just highlights the row. They appear once the user is actually picking
    several things - ctrl/shift held on desktop, multi-select toggled on mobile,
    or more than one item already selected.
*/
function updateMultiSelectDisplay(){
    let multi = ctrlHold || shiftHold || $(".fileObject.selected").length > 1;
    $("#folderView").toggleClass("fmMultiSelect", multi);
}

$("#folderView").on("click", function(){
    if (pathInputMode){
        hideManualOpenPathInput();
    }

    if (renameMode && $(".renameinput").length > 0){
        exitRenameModeWithConfirm();
        return;
    }
})

function getFileObjectFromFID(fid){
    var targetFileObject = null;
    $(".fileObject").each(function(){
        if ($(this).attr("fileid") == fid){
            targetFileObject = $(this);
        }
    });
    return targetFileObject;
}

function exitMultiSelectMode(){
    if (stickyMultiSelect){
        //Held open by the Multi-select menu toggle
        return;
    }
    if (ctrlHold){
        ctrlHold = false;
        updateCtrlDisplay();
    }
}

function toggleCtrl(){
    ctrlHold = !ctrlHold;
    updateCtrlDisplay();
}

function selectAll(){
    $(".fileObject").addClass("selected");
    updateSelectedObjectsCount();
}

function clearSelection(){
    $('.fileObject.selected').removeClass("selected");
    updateSelectedObjectsCount();

    if (ctrlHold){
        //Deselect everything, also exit multi-select mode
        ctrlHold = false;
        updateCtrlDisplay();
    }
}

function updateCtrlDisplay(){
    updateMultiSelectDisplay();
    if (isMobile){
        //Change color of the navibar based on selection mode
        if (ctrlHold){
            $("#navibar").addClass("ctrl");
        }else{
            $("#navibar").removeClass("ctrl");
        }
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.clearSelection = clearSelection;
window.exitMultiSelectMode = exitMultiSelectMode;
window.selectAll = selectAll;
window.toggleCtrl = toggleCtrl;


/* ---------------------------------------------------------------------- */
/*  Delegated file list events                                             */
/* ---------------------------------------------------------------------- */
/*
    Drag, drop and double click used to be inline on* attributes written into
    every row template. They are delegated here instead, bound once against
    #folderView, so the templates stay pure markup and re-rendering the listing
    cannot leave handlers behind.

    Selection (click / mousedown / contextmenu) is still bound per render by
    bindFileObjectEvents() - moving that too would mean rewriting the context
    menu in the same step.
*/
function bindFileListDelegates(){
    let view = $("#folderView");

    view.on("dragstart", ".fileObject", function(event){
        onFileObjectDragStart(this, event.originalEvent || event);
    });

    view.on("dblclick", ".fileObject", function(event){
        openthis(this, event.originalEvent || event, true);
    });

    view.on("dragover", ".fileObject[type='folder']", function(event){
        allowDrop(event.originalEvent || event);
    });

    view.on("drop", ".fileObject[type='folder']", function(event){
        dropToFolder(event.originalEvent || event);
    });

    //Sortable column headers in details view
    $("#fmListHeader").on("click", ".fmSortable", function(){
        sortByColumn($(this).attr("data-sortkey"));
    });
}

//Status bar tile zoom. Grid only; re-renders so tiles pick up the new width.
function setGridZoom(value){
    gridZoom = parseInt(value);
    $("#folderView").css("--fm-tile", gridZoom + "px");
    if (viewMode == "grid"){
        $(".fileObject.card").css("width", gridZoom + "px");
    }
    setPreference("file_explorer/gridZoom", gridZoom);
}


/*
    Mobile multi-select.

    A plain tap on a phone opens the item, so there is otherwise no way to select
    anything - which also left every selection-based action in the overflow menu
    permanently unavailable. Turning this on makes taps select instead: tapping an
    unselected item selects it, tapping a selected one deselects it, and folders
    are selected rather than opened. It stays on until switched off.
*/
function toggleMobileMultiSelect(){
    stickyMultiSelect = !stickyMultiSelect;
    ctrlHold = stickyMultiSelect;

    if (!stickyMultiSelect){
        $(".fileObject.selected").removeClass("selected");
    }

    updateCtrlDisplay();
    updateSelectedObjectsCount();
    $("#fmMultiSelectItem").toggleClass("checked", stickyMultiSelect);
    closeFileOprMenu();
}
