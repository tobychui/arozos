/*
    ArozOS Desktop - Desktop state

    Global variables shared by every desktop script: wallpaper, icons,
    float windows, selection, key state, list menu, upload limits and the
    browser / device detection flags.

    Part of desktop.html, see README.md in this folder for the load order.
*/

/*
ArOZ Online Desktop Interface

This script maintain the usability of the desktop environment.
This is not identical to the previous Desktop environment used in ArOZ Online BETA.
*/

//System environment variables
var isDesktopMode = true;
var loggingOut = false;

//Desktop background related
var desktopThemeList = []; //Storing the list of background installed
var currentBackgroundList = []; //Current list of background files
var currentUserTheme = ""; //The theme for current user. 
var backgroundCrossfadeInterval = 30000; //Time between the crossfade of each background image
var nextSlideshowIndex = 0; //The next background image index to be shown
var backgroundIntervalCounter; //The interval object for background changer
var desktopThemeColor = ""; //The current desktop theme color, which renders to the status bar and suchs

//Module-registered extension icons (ext without dot → web-root-relative path)
var extIconRegistry = {};

//Desktop icon realted
var desktopIconSize = "medium"; //Size of desktop icons. Allow {small / medium / big}
var desktopIconPack = "default"; //Desktop icon pack to be used. Located under desktop/file_icon/{pack-name}
var desktopGrids = []; //Reference virtual grid for icons on desktop
var iconSize = []; //Defined the icon size for the desktop icons
var desktopFileList = []; //Temperature storage of desktop filenames
var startDragRelatuve = []; //Relative location of where the icon being start dragging
var iconOffsetXY = [-10,-10];  //Pixel to offset for the icon location

//Float window related
var focusedWindow;
const maxWindowCount = 100;
var movingWindow = false;
var resizingWindow = false;
var resizingEdgeID = 0; //Resizing edge. {0, 1, 2, 3, 4, 5, 6} => None, Right, Right Bottom Corner, Bottom, Left Bottom Corner, Left, TOp
var stackedFloatWindowListShown = false;

//Laucnh icon related
var multiSelecting = false;
var multiSelectionStartPoint = [-1, -1];
var clickDownOffset = [-1, -1];
var renameMode = false;
var operationTargetLaunchIcon;
var currentMousePosition = [-1, -1];

//Document key bindings
var ctrlHold = false;
var shiftHold = false;

//ListMenu Related Paramters
var moduleInstalled = [];
var listMenuShown = false;
//Module groups listed under each list menu category. Groups of retired
//categories (Download, Files) and Internet still land somewhere sensible
//for third party modules; any other group goes to Other.
var listMenuCategories = {
    "Media": ["Media"],
    "Office": ["Office"],
    "Network": ["Network", "Internet", "Download"],
    "Engineering": ["Engineering"],
    "Development": ["Development"],
    "System": ["System Tools", "System Settings"],
    "Utilities": ["Utilities", "Files"]
};

//Context Menu variables
var menuStartLocation = [0, 0];

//Input Method Editor objects
window.ime = {
    handler: null,
    focus: null
};

//Upload related
let uploadFileChunkSize = 1024 * 512; //512KB per chunk in low memory upload
let largeFileCutoffSize = 8192 * 1024 * 1024; //Any file larger than this size is consider "large file", default to 8GB
let postUploadModeCutoff = 25 * 1048576; //25MB, files smaller than this will upload using POST Mode
let uploadWindowSize = 8 * 1024 * 1024; //Bytes of chunks kept in flight per upload connection (see script/chunkupload.js)
const CHUNK_TIMEOUT_MS = 30000; //30s without any server ack (once everything queued has been sent) before resending the oldest chunk
const MAX_CHUNK_RETRIES = 3;    //Maximum retries without any progress before marking the upload failed

//Others
var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var daysNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var hostInfo = {};
var userInfo = {};
var powerman = false;
var downloadMode = false;
var lowMemoryMode = true;

//Browser and device detection
var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
var isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
var isMacOS = (navigator.appVersion.indexOf("Mac")!=-1);
if (isMacOS) document.documentElement.classList.add("isMacOS"); // dock.css: the backdrop blur fails on macOS browsers
var isTouchScreen = window.matchMedia("(any-pointer: coarse)").matches;
