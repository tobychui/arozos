/*
    search.js

    Search bar and type-to-jump "hot search".

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Clear all finished upload tasks
function toggleSearch(){
    //Start search mode
    $(".searchbar").show()
    initWindowSizes(true);

    $("#searhbtn").addClass("disabled");

    //Force videmode to list
    viewModeBeforeSearch = viewMode;
    viewMode = "list"
    $(".videmode.button").each(function(){
            $(this).addClass('disabled');
    });
    searchMode = true;

    //Adjust the css for mobile interface
    if (isMobile){
        $("#searchInput").parent().parent().css("width", window.innerWidth - 135 + "px");
    }

    //Clear current folderlist
    $("#folderList").show();
    $("#folderList").html(`<div class="ui basic segment">
        <div class="ui header themed">
            <i class="arrow up icon"></i> <span>${applocale.getString("func/search/typeToStart", "Type to Start Search")}</span>
            <div class="sub header" style="margin-top:12px;">${applocale.getString("func/search/tip1", "Type something in the search bar to start searching.")}<br>
                ${applocale.getString("func/search/tip2", `Start wildcard matching with "/" (slash) and your wildcard string (e.g. /*.mp3)`)}</div>
        </div>
    </div>`);
    $("#fileList").hide();
}

function hideSearchBar(skipFilelistRefresh = false){
    $(".searchbar").hide();
    initWindowSizes(true);
    $("#searchInput").val("");
    $("#searhbtn").removeClass("disabled");
    viewMode = viewModeBeforeSearch;
    $(".videmode.button").each(function(){
        if ($(this).attr("mode") != viewMode){
            $(this).removeClass('disabled');
        }
    });
    if (skipFilelistRefresh == false){
        listDirectory(currentPath);
    }
    searchMode = false;
}

//Handle case sensitive in keyword searching
function toggleCaseSensitive(btn){
    if ($(btn).hasClass("active")){
        $(btn).removeClass("active");
        searchCaseSensitive = false;
    }else{
        $(btn).addClass("active");
        searchCaseSensitive = true;
    }
    }

    function exitHotSearch(){
    hotSearchBuffer = "";
    hotSearchTimer = null;
    //Move the file to "selected" mode
    $(".hotSearchHighlight").addClass("selected");
    $(".hotSearchHighlight").removeClass("hotSearchHighlight");
}

function handleHotSearch(starting, offset){
    if (offset < 0){
        offset = 0;
    }

    starting = starting.toLowerCase();
    $(".hotSearchHighlight").removeClass("hotSearchHighlight");
    let files =  $(".fileObject");
    let matchingFiles = [];
    for (var i = 0; i < files.length; i++){
        let thisFile = files[i];
        if ($(thisFile).attr("filename") != undefined && $(thisFile).attr("filename").length > starting.length && $(thisFile).attr("filename").substr(0, starting.length).toLowerCase() == starting){
            matchingFiles.push(thisFile);
        }
    }

    //Loopback if offset overflow
    let newOffset = offset;
    if (offset > matchingFiles.length - 1){
        newOffset =offset % matchingFiles.length;
    }

    var targetHighlightingFile = matchingFiles[newOffset];
    $(targetHighlightingFile).addClass("hotSearchHighlight");
    scrollToFileLocation($(targetHighlightingFile));
    return;

}

function handleSearch(){
    var keyword = $("#searchInput").val();
    $("#folderList").html(`<div class="ui basic segment">
        <i class="loading spinner icon"></i> <span>Searching</span>
    </div>`);
    $("#fileList").hide();
    $("#fileList").html("");

    $.ajax({
        url: "../../system/file_system/search",
        data: {path: currentPath, keyword: keyword, casesensitive: searchCaseSensitive},
        success: function(data){
            if (data.error !== undefined){
                msgbox("red remove", applocale.getString("message/" + data.error, data.error));
                hideSearchBar();
            }else{
                //Render the filelist
                if (data.length == 0){
                    $("#folderList").show();
                    $("#folderList").html(`<div class="ui basic segment">
                        <div class="ui header">
                            <i class="question icon"></i> <span>${applocale.getString("message/noMatchResults","No Matching Results")}</span>
                            <div class="sub header">${applocale.getString("message/noMatchResultsDesc","The host return no matching results for your keyword")} "${keyword}". <br>${applocale.getString("message/noMatchResultsInst","Check your spelling and your wildcard characters.")}</div>
                        </div>
                    </div>`);
                }else{
                    renderDirectory(data);
                }
                
            }
        }, error: function(){
            $("#folderList").html(`<div class="ui basic segment">
            <div class="ui header">
                <i class="remove icon"></i> Search Error
                <div class="sub header">Search timeout</div>
            </div>
        </div>`);
        }
    })
}

function handleSearchBarPress(e){
    if (e.keyCode == 13 || e.key == "Enter"){
        e.preventDefault();
        handleSearch();
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.handleSearch = handleSearch;
window.handleSearchBarPress = handleSearchBarPress;
window.hideSearchBar = hideSearchBar;
window.toggleCaseSensitive = toggleCaseSensitive;
window.toggleSearch = toggleSearch;


/*
    The redesign shows the search box permanently in the nav row instead of a
    slide-down bar, so search is entered lazily on the first Enter rather than by
    a toggle button. Clearing the box and pressing Enter leaves search mode.
*/
function handleSearchFromPill(event){
    if (!(event.keyCode == 13 || event.key == "Enter")){
        return;
    }
    let keyword = $("#searchInput").val().trim();
    if (keyword == ""){
        if (searchMode){
            hideSearchBar();
        }
        return;
    }
    if (!searchMode){
        //Remember the view mode so hideSearchBar() can restore it
        viewModeBeforeSearch = viewMode;
        searchMode = true;
    }
    handleSearch();
}
