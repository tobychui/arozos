/*
    specialview.js

    Registry for views that occupy the file area but are not directory
    listings - the trash bin is the first, and anything else that wants a
    sentinel path plus its own renderer registers here rather than adding
    another branch to listDirectory().

    A view registers itself at load time:

        registerSpecialView("%trashbin%", {
            icon: "trash",                  //FSIcons key drawn in the path bar
            labelKey: "trash/title",        //applocale key for the root label
            labelFallback: "Trash Bin",
            hideViewModes: true,            //grid/list/details make no sense here
            hidePropertiesPane: true,       //neither does the properties pane
            render: function(callback){ ... },
            search: function(keyword, caseSensitive){ ... }   //optional
        });

    A view that leaves out "search" simply keeps whatever it last drew when the
    user presses Enter in the search box, since handleSearch() has nothing to
    hand the keyword to and the server-side search cannot see these rows.

    listDirectory() then does the lookup and hands over, and updatePathDisplay()
    uses the icon and label instead of showing the raw sentinel.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

let fmSpecialViews = {};

/*
    Whether the properties pane was open before a special view hid it, so
    leaving the view can put it back rather than silently turning off something
    the user had switched on.
*/
let propertiesPaneHiddenBySpecialView = false;

function registerSpecialView(sentinelPath, config){
    fmSpecialViews[String(sentinelPath).toLowerCase()] = config;
}

/*
    Look up the view for a path. listDirectory pads a trailing slash onto
    everything it navigates to, so that is stripped before matching.
*/
function getSpecialView(path){
    if (path == undefined || path == null){
        return null;
    }
    let cleaned = String(path).trim().replace(/\/+$/, "").toLowerCase();
    let view = fmSpecialViews[cleaned];
    return view == undefined ? null : view;
}

function isSpecialViewPath(path){
    return getSpecialView(path) != null;
}

/*
    Chrome that only makes sense over a real directory listing. Called on every
    navigation, so entering and leaving are both handled from one place.
*/
function applySpecialViewChrome(view){
    let hideViewModes = view != null && view.hideViewModes === true;
    $(".fsViewToggle.fmStatusToggle").toggle(!hideViewModes);
    $("#fmSortBtn").toggle(!hideViewModes);

    //The tile size slider belongs to the grid view, which is gone too.
    //updateZoomControlVisibility() checks the special view itself, so it stays
    //hidden when the resize handler or a view mode change calls back into it.
    updateZoomControlVisibility();

    let hideProperties = view != null && view.hidePropertiesPane === true;
    $("#togglePropertiesViewBtn").toggle(!hideProperties);

    if (hideProperties){
        if (propertiesView){
            //Remember that this was the user's setting, not ours, so it can be
            //restored when they navigate back out
            propertiesPaneHiddenBySpecialView = true;
            togglePropertiesView($("#togglePropertiesViewBtn"));
        }
    }else if (propertiesPaneHiddenBySpecialView){
        propertiesPaneHiddenBySpecialView = false;
        if (!propertiesView){
            togglePropertiesView($("#togglePropertiesViewBtn"));
        }
    }

    updateSplitterVisibility();
    initWindowSizes(false);
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.registerSpecialView = registerSpecialView;
window.getSpecialView = getSpecialView;
window.isSpecialViewPath = isSpecialViewPath;
window.applySpecialViewChrome = applySpecialViewChrome;
