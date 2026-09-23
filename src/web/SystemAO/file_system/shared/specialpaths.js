/*
    specialpaths.js

    The list of sentinel paths that stand in for a view rather than a real
    directory - %trashbin% and anything that joins it later.

    Two very different places need to agree on this list:

        the desktop      to draw a shortcut pointing at one, and to know that
                         dropping files onto it is not a move into a folder
        the File Manager to draw the same shortcut in a file listing, and to
                         decide what its own sidebar and path bar do

    The File Manager's own js/explorer/specialview.js is the richer registry -
    it also holds renderers, toolbars and search handlers - but the desktop
    cannot load that: it would drag in the whole explorer. So the small part
    both sides need lives here, and specialview.js reads its icon and label from
    it rather than repeating them.

    Icon paths are relative to the web root, because that is where the desktop
    is served from. A page deeper in the tree prefixes them itself - see
    specialPathIconFrom().
*/

var AROZ_SPECIAL_PATHS = {
    "%trashbin%": {
        icon: "SystemAO/file_system/trashbin_img/desktop_icon.svg",
        labelKey: "trash/title",
        labelFallback: "Trash Bin",
        /*
            Files dragged onto it are recycled rather than moved. Declared here
            because the desktop has to know before it decides what a drop on
            the shortcut means, and it cannot see the File Manager's registry.
        */
        recycleOnDrop: true
    }
};

/*
    Look up a sentinel path. Accepts what any of the callers happen to be
    holding: a trailing slash from listDirectory, a different case from a
    hand-typed path bar entry, or a shortcut file written by an older build.
*/
function getSpecialPathInfo(path) {
    if (path == undefined || path == null) {
        return null;
    }
    var cleaned = String(path).trim().replace(/\/+$/, "").toLowerCase();
    var info = AROZ_SPECIAL_PATHS[cleaned];
    return info == undefined ? null : info;
}

function isSpecialPath(path) {
    return getSpecialPathInfo(path) != null;
}

/*
    The icon for a sentinel path, as seen from a page at the given depth.

    @param prefix  what to put in front of the web root relative path - "" from
                   the desktop, "../../" from inside SystemAO/file_system/
    Returns null when the path is not special, so a caller can fall through to
    whatever icon it would otherwise have used.
*/
function specialPathIconFrom(path, prefix) {
    var info = getSpecialPathInfo(path);
    if (info == null) {
        return null;
    }
    return (prefix == undefined ? "" : prefix) + info.icon;
}

if (typeof window !== "undefined") {
    window.AROZ_SPECIAL_PATHS = AROZ_SPECIAL_PATHS;
    window.getSpecialPathInfo = getSpecialPathInfo;
    window.isSpecialPath = isSpecialPath;
    window.specialPathIconFrom = specialPathIconFrom;
}
