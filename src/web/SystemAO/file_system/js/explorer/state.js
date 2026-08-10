/*
    state.js

    All module-level state for the File Manager.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

let directorySidebarWidth = 250; //Width of the sidebar
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
const MAX_CHUNK_RETRIES = 3;    //Maximum retries per individual chunk before failing the upload

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
