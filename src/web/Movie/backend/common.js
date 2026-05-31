/*
    Movie App - Common Configuration
    If the app folder is renamed, update APP_NAME below and all paths
    will automatically adjust everywhere this file is included via requirepkg().
*/

// ── App identity ─────────────────────────────────────────────────────────────
var APP_NAME      = "Movie";
var BACKEND_PATH  = APP_NAME + "/backend/";

// ── Server API endpoints (relative from any page in this app) ────────────────
var MEDIA_API     = "../media";               // ?file=<vpath>  streams a file
var TRANSCODE_API  = "../media/transcode";            // ?file
var AGI_INTERFACE = "../system/ajgi/interface?script=";

// ── Script paths (used when calling ao_module_agirun from the frontend) ──────
var SCRIPT_GET_LIBRARY   = BACKEND_PATH + "getLibrary.js";
var SCRIPT_GET_EPISODES  = BACKEND_PATH + "getEpisodes.js";
var SCRIPT_GET_THUMBNAIL = BACKEND_PATH + "getThumbnail.js";
var SCRIPT_LIST_FOLDER   = BACKEND_PATH + "listFolder.js";
var SCRIPT_GET_MOVIE_INFO = BACKEND_PATH + "getMovieInfo.js";
var SCRIPT_GET_WATCHTIME  = BACKEND_PATH + "getWatchTime.js";
var SCRIPT_SET_WATCHTIME  = BACKEND_PATH + "setWatchTime.js";

// ── Scanner settings ─────────────────────────────────────────────────────────
var VALID_VIDEO_FORMATS = ["mp4", "webm", "ogg", "mkv", "avi", "mov", "m4v", "wmv", "flv", "rmvb", "ts"];
var SKIP_ROOT_PREFIXES  = ["tmp:/", "trash:/"];    // roots to skip entirely
var VIDEO_FOLDER_NAME   = "Video";                 // expected folder inside each root
var MOVIE_FOLDER_NAMES  = ["movie", "movies"];     // folder names (case-insensitive) treated as movie containers
var ANIME_FOLDER_NAMES  = ["anime"];               // folder names (case-insensitive) treated as anime containers
