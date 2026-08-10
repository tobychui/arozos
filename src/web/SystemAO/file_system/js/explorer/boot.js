/*
    boot.js

    Startup sequence. Loaded last.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Intiiation functions
$(document).ready(function(){
    $("#contextmenu").css("display", "hidden");
    
    //Function to complete initialization after applocale is ready
    function completeInitialization(){
        //Fill the nav row's [data-fsicon] placeholders with their drawn SVGs.
        //Runs before the first listing so the toolbar never flashes empty.
        FSIcons.inject(document);

        //Menu rows must stay single line even when the label carries a <br>
        flattenMenuLabels();

        //Multi-select only exists on touch devices, where a tap opens by default
        $("#fmMultiSelectItem").css("display", isMobile ? "flex" : "none");

        //Delegated drag/drop/dblclick for the file list. Bound once, not per render.
        bindFileListDelegates();

        //Restore the operation toolbar preference (shown unless turned off)
        loadPreference("file_explorer/oprbar", function(value){
            showOprBar = (value !== "false");
            applyOprBarVisibility();
        });

        //Restore the saved grid tile size
        loadPreference("file_explorer/gridZoom", function(value){
            let z = parseInt(value);
            if (!isNaN(z) && z >= 100 && z <= 170){
                gridZoom = z;
                $("#fmZoomSlider").val(z);
                $("#folderView").css("--fm-tile", z + "px");
            }
        });

        //Fetch module-registered extension icons once so the grid view can use them
        $.get("/system/modules/exticons", function(data) {
            if (typeof data === "string") { try { data = JSON.parse(data); } catch(e) {} }
            if (data && typeof data === "object") { extIconRegistry = data; }
        });

        initRootDirs();
        initSystemInfo();
        initUploadMode();
        $(".dropdown").dropdown();
        updateSortMenuState();
        updateSelectedObjectsCount();
        initWindowSizes(false);
        
        //Initialize view mode buttons
        updateViewmodeButtons();
        
        //Initialize system theme
        loadPreference("file_explorer/theme",function(data){
            if (data.error === undefined){
                if (data == "darkTheme"){
                    toggleDarkTheme();
                }else{
                    //White theme
                
                }
            }
        });

        //Initialize properties view
        if (localStorage.getItem("file_explorer/viewProperties") == "true"){
            $("#togglePropertiesViewBtn").click();
        }

        //Initialize directory views based on hash
        if (window.location.hash != ""){
            //Check if the hash is standard open protocol. If yes, translate it
            if (ao_module_loadInputFiles() === null){
                //Window location hash set. List the desire directory
                currentPath = window.location.hash.substring(1,window.location.hash.length);
                if (currentPath.substring(currentPath.length -1) != "/"){
                    currentPath = currentPath + "/";
                }
                currentPath = decodeURIComponent(currentPath);
                loadListModeFromDB(function(){
                    listDirectory(currentPath);
                });
                
            }else{
                //This is ao_module load file input. Handle the file opening
                var filelist = ao_module_loadInputFiles();
                if (filelist.length > 0){
                    filelist = filelist[0];
                    //Check if this is folder or file. Only opendir when it is folder
                    //Updates 27-12-2020: Open folder and highlight the file if it is file
                    if (filelist.filename.includes(".") == false){
                        //Try to open it and overwrite the hash to filesystem hash
                        loadListModeFromDB(function(){
                            listDirectory(filelist.filepath);
                        });
                    }else{
                        //File. Open its parent folder and highlight the target file if exists
                        var parentdir = filelist.filepath.split("/");
                        let focusFilename = JSON.parse(JSON.stringify(filelist.filename));
                        parentdir.pop();
                        parentdir = parentdir.join("/");
                        loadListModeFromDB(function(){
                            listDirectory(parentdir, function(){
                                if (focusFilename != ""){
                                    //Timeout to give the DOM time to render
                                    //DO NOT REPLACE THIS WITH listDirectoryAndHighlight
                                    //Additional delay are required on page load
                                    setTimeout(function(){
                                        focusFileObject(focusFilename);
                                    }, 300);
                                    
                                }
                            })
                        });
                    }
                }
            }
        }else{
            //Initialized directory views
            loadListModeFromDB(function(){
                listDirectory(currentPath);
            });
        }
    }
    
    if (applocale){
        //Applocale found. Do localization
        applocale.init("../locale/file_explorer.json", function(){
            applocale.translate();
            completeInitialization();
        });
    }else{
        //Applocale not found. Is this a trim down version of ArozOS?
        applocale = {
            getString: function(key, original){
                return original;
            }
        }
        completeInitialization();
    }

    if (isMobile){
        //Mobile css adjustment
        sideBarShown = false;
        $("#directorySidebar").hide();
        $("#directorySidebar").css("width",window.innerWidth + "px");
        $("body").css("overflow","hidden");
        $("#navibar").addClass("mobile");
        directorySidebarWidth = window.innerWidth;
        $("#folderView").css({
            "padding-right":"1em",
            "padding-left":"1em",
            "padding-top":"1em",
        });

        //Move the sort menu into the desktop address bar gap
        $(".viewportBtns").addClass("mobile");
        $(".addressBar").append($(".viewportBtns"));

        $(".desktopOnly").hide();
        $(".mobileOnly").show();
    }else{
        $(".mobileOnly").hide();
        $(".desktopOnly").show();
    }
    

    
    
    //Create a timer to check change in current folder
    setInterval(function(){
        if (enableAutoRefresh == false){
            return;
        }
        let currentPagePath = currentPath;
        getDirHash(function(hash){
            if (hash.error !== undefined){
                //Something went wrong. Ignore this request
                console.log(hash.error)
            }else{
                //Check if the hash match with the last hash && user is still on the same page
                if (hash != currentPathHash && currentPagePath == currentPath){
                    refreshList();
                    currentPathHash = hash;
                    if (currentPath == "user:/"){
                        //Reload the User root folder list
                        initRootDirs();
                    }
                }
            }

        });
    }, 5000);


    //Update the window sizes for special cases
    if (window.innerWidth < 620 && !isMobile){
        toggleSidebar(false);
    }
    initWindowSizes(false);
});

//Overwrite of the ao_module_close
function ao_module_close(){
    if (uploadPendingList.length > 0 || uploadingFileCount > 0){
        //There are pending upload item or uploading items
        //ask the user to confirm exit
        hideAllPopupWindows();
        showPopupWrapper();
        $("#confirmExit").transition("slide left in");
        return
    }
    //Exit window
    ao_module_closeHandler();
    }


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.ao_module_close = ao_module_close;   // desktop.html calls this on the float window close button
