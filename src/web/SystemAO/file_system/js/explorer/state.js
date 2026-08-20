/*
    state.js

    All module-level state for the File Manager.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

let directorySidebarWidth = 250; //Width of the sidebar

/*
    Pane splitter limits (see js/explorer/splitter.js)

    The quick access sidebar opens at its widest and is only ever dragged
    narrower, so its default and its maximum are the same number. Its floor is
    expressed as a fraction of that maximum rather than as its own pixel value,
    so changing the maximum keeps the two in proportion.

    The properties pane is free to go either way between its own two bounds.
    FM_MAIN_MIN_WIDTH is what stops either drag from squeezing the file list
    itself down to nothing on a narrow window.
*/
const FM_SIDEBAR_MAX_WIDTH = 250;   //also the default width
const FM_SIDEBAR_MIN_RATIO = 1 / 3; //narrowest the sidebar may be dragged
const FM_PROPS_DEFAULT_WIDTH = 300;
const FM_PROPS_MIN_WIDTH = 220;
const FM_PROPS_MAX_WIDTH = 620;
const FM_MAIN_MIN_WIDTH = 320;      //the file list never shrinks past this
let sideBarShown = true; //Indicate if sidebar is shown
let currentTheme = "whiteTheme"; //Default theme
let viewMode = "list"; //Viewmode, support {list, grid, detail}
let sortMode = "default"; //Sortmode, support {default, reverse, smallToLarge, largeToSmall, mostRecent, leastRecent}
let currentPath = "user:/"
let showOprBar = true;               //Classic file operation toolbar, persisted server side
let gridZoom = 170;                  //Grid tile width in px (100-170), driven by the status bar slider
let viewHistory = [];
let forwardHistory = [];             //Paths popped by Back, replayed by Forward. Cleared on any other navigation. //View history
let currentFilelist = []; //The current file list in the currentPath
let currentPathHash = "";   //The folder content hash
let enableAutoRefresh = true; //Enable directory updates on file change
let filesIconTheme = "default";

//File operations
let clipboard = []; //System clipboard
let cutMode = false; //If set to true, this is cut mode. Else copy mode
let useLocalstorage = lscheck();
let overwriteMode = "keep"; //Overwrite mode, support {skip, overwrite, keep}
let thumbLoader = null;              //Handle from FileThumb.loadThumbnails, cancelled on navigation
let pathInputMode = false;
let renameMode = false;

//Searching related
let searchCaseSensitive = false;
let viewModeBeforeSearch = "list";
let searchMode = false;
let hotSearchBuffer = "";
let hotSearchTimer = null;
let hotSearchOffsetIndex = 0;
let propertiesView = false; //Enable viewing properties on the right sidebar

//Keypress listeners
let stickyMultiSelect = false;      //Mobile multi-select stays on until the user turns it off
let ctrlHold = false;
let shiftHold = false;
let lastClickedElement = undefined;

/*
    Mobile double tap tracking.

    Touch browsers do not fire a reliable dblclick on these rows, so the gesture
    is timed here instead. Kept per file id so two quick taps on different items
    are never mistaken for a double tap on one.
*/
let lastTapFileID = null;
let lastTapTime = 0;
const MOBILE_DOUBLE_TAP_MS = 350;

//Upload related
let uploadingFileCount = 0;
let maxConcurrentUpload = 4; //Maxmium number of oncurrent upload
let uploadPendingList = []; //Upload pending queue for mass upoad
let uploadRetryMap = new Map(); //taskUUID -> {file, targetDir} for WebSocket upload retry
let lowMemoryMode = true;   //Upload with low memory mode channel
let largeFileCutoffSize = 8192 * 1024 * 1024; //Any file larger than this size is consider "large file", default to 8GB
let uploadFileChunkSize = 1024 * 512; //512KB, 4MB not working quite well on slow network
let postUploadModeCutoff = 25 * 1048576; //25MB, files smaller than this will upload using POST Mode
const CHUNK_TIMEOUT_MS = 30000; //30s timeout waiting for server "next" ack before retrying a chunk

/*
    Heartbeat interval while an upload is paused. Comfortably under the 60s idle
    timeout most reverse proxies default to, so a pause left running overnight
    does not quietly lose its connection.

    The matching server side limits are uploadPauseTimeout and
    uploadPauseCloseCode in src/file_system.go - a pause left longer than the
    server's timeout is cancelled there and closed with that code.
*/
const UPLOAD_PAUSE_PING_MS = 20000;
const UPLOAD_PAUSE_TIMEOUT_CLOSE_CODE = 4001;
const MAX_CHUNK_RETRIES = 3;    //Maximum retries per individual chunk before failing the upload

/*
    Transfer panel state (see js/explorer/uploadui.js)

    uploadTaskInfo holds everything the panel needs to draw a row that the DOM
    cannot cheaply answer for us - byte counts, the running speed estimate the
    "time left" label is derived from, and the task state. Keyed by task UUID.

    uploadTransferMap holds the live transfer handles so the per-row button and
    "Cancel all" can actually stop a transfer: {abort, pause, resume, pausable}.
    Only tasks currently in flight have an entry.
*/
let uploadTaskInfo = new Map();
let uploadTransferMap = new Map();
//Panel collapsed to the #fmUploadListBtn in the status bar; a new task expands it
let uploadPanelCollapsed = false;
const MAX_FINISHED_UPLOAD_ROWS = 60; //Trim completed rows past this to keep mass uploads responsive

/*
    The task list follows the transfer that is currently in flight, so a long
    queue does not leave the user staring at finished rows. Scrolling by hand
    wins for a while - yanking the list back under someone who is reading it is
    worse than letting the active row drift off screen.
*/
let uploadListUserScrolledAt = 0;
/*
    The scroll offset this code last set itself, so the scroll handler can tell
    its own scrolling from the user's. Deliberately a position rather than a
    "the next event is mine" flag: scrollTop can be assigned without producing
    any movement (it is already clamped at the end of the list), which fires no
    event and would leave such a flag stuck - swallowing the user's next scroll.
*/
let uploadListAutoScrollTop = -1;
const UPLOAD_FOLLOW_PAUSE_MS = 5000; //How long a manual scroll suspends following

//Pending auto-dismiss for the toast, so a new message replaces the old timer
let msgboxTimer = null;

//Deferred second layout pass after a resize / rotation (see applyResponsiveLayout)
let responsiveLayoutTimer = null;

//Module-registered extension icons (ext without dot → web-root-relative path)
var extIconRegistry = {};

//File Sharing related
let shareEditingObject = "";

//System Information

//Browser detection
let isMobile = window.mobilecheck();
let isChromium = window.chrome;
let isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
let isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
let isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

//Bind onclicke events for fileObjects
var lastClickedFileID = 0;
