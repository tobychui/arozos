/*
    imagedb.js

    Photo index database helper library for the ArozOS Photo module.

    This is a *shared* library (loaded via includes("imagedb.js")). It provides
    everything the search / indexing backend scripts need:

      - The per-user SQLite photo-index schema + open/migrate helper
      - Photo metadata extraction (file name, resolution, dates, EXIF shooting
        parameters) via the AGI imagelib / filelib libraries
      - Incremental upsert / lookup helpers used by indexPhotos.js
      - The iOS-style free-text query parser + parameterised SQL builder shared
        by searchPhotos.js and searchSuggest.js
      - Exclude-folder configuration (also consumed by exclude.js)

    The index is stored per-user at INDEX_DB_PATH, so a user only ever sees their
    own photos. The index is a derived cache of the file system: it can always be
    rebuilt from scratch, which is why a schema-version bump simply drops & rebuilds.

    NOTE: AGI scripts run on the Otto VM (ECMAScript 5.1). Keep this file ES5 —
    no let/const, arrow functions, or template literals.

    Requires (provided by this file): sqlite, filelib, imagelib
*/

requirelib("sqlite");
requirelib("filelib");
requirelib("imagelib");

// Per-user SQLite index location. The sqlite lib creates parent dirs on open.
var INDEX_DB_PATH = "user:/.appdata/photo/photoindex.db";

// Bump when the schema below changes; openIndexDB() will rebuild the cache.
var SCHEMA_VERSION = 1;

// Image / RAW extension sets (kept in sync with constants.js + listFolder.js).
var IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "arw", "cr2", "dng", "nef", "raf", "orf"];
var RAW_EXTENSIONS = ["arw", "cr2", "dng", "nef", "raf", "orf"];

/* ------------------------------------------------------------------ *
 *  Small path helpers
 * ------------------------------------------------------------------ */

function db_getExt(filename) {
    var parts = ("" + filename).split(".");
    if (parts.length < 2) {
        return "";
    }
    return parts.pop().toLowerCase();
}

function db_isImageFile(filename) {
    return IMAGE_EXTENSIONS.indexOf(db_getExt(filename)) >= 0;
}

function db_isRawImage(filename) {
    return RAW_EXTENSIONS.indexOf(db_getExt(filename)) >= 0;
}

function db_basename(filepath) {
    return ("" + filepath).split("/").pop();
}

function db_dirname(filepath) {
    var t = ("" + filepath).split("/");
    t.pop();
    return t.join("/");
}

/* ------------------------------------------------------------------ *
 *  Schema + open/migrate
 * ------------------------------------------------------------------ */

function ensureSchema(db) {
    db.exec(
        "CREATE TABLE IF NOT EXISTS photos (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "filepath TEXT UNIQUE NOT NULL," +   // virtual path, e.g. user:/Photo/a.jpg
        "filename TEXT NOT NULL," +
        "filename_lc TEXT NOT NULL," +       // lowercased name for case-insensitive search
        "ext TEXT," +                        // lowercase extension without dot
        "folder TEXT," +                     // parent folder virtual path
        "filesize INTEGER," +                // bytes
        "width INTEGER," +                   // pixels
        "height INTEGER," +                  // pixels
        "megapixels REAL," +                 // width*height / 1e6
        "orientation TEXT," +                // landscape | portrait | square
        "taken_date INTEGER," +              // unix sec, EXIF DateTimeOriginal (fallback mtime)
        "modified_date INTEGER," +           // unix sec, file modification time
        "camera_make TEXT," +
        "camera_model TEXT," +
        "lens_model TEXT," +
        "focal_length REAL," +               // mm
        "aperture REAL," +                   // f-number
        "shutter REAL," +                    // exposure time in seconds
        "shutter_label TEXT," +              // human readable, e.g. 1/250
        "iso INTEGER," +
        "has_exif INTEGER DEFAULT 0," +
        "indexed_at INTEGER" +               // unix sec this row was (re)indexed
        ")"
    );

    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_filename_lc ON photos(filename_lc)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_taken ON photos(taken_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_modified ON photos(modified_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_model ON photos(camera_model)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_iso ON photos(iso)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_ext ON photos(ext)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_folder ON photos(folder)");

    db.exec("CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT)");
}

function metaGet(db, key, fallback) {
    var row = db.queryRow("SELECT value FROM index_meta WHERE key = ?", [key]);
    if (row && row.value !== undefined && row.value !== null) {
        return row.value;
    }
    return fallback;
}

function metaSet(db, key, value) {
    db.exec(
        "INSERT INTO index_meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, "" + value]
    );
}

// Open (creating if needed), run migrations and return the connection (or null).
// Returns null when the SQLite library is unavailable (e.g. the few build
// targets without a modernc C-runtime port), so callers degrade gracefully
// instead of throwing.
function openIndexDB() {
    if (typeof sqlite === "undefined" || !sqlite || typeof sqlite.open !== "function") {
        return null;
    }
    var db = sqlite.open(INDEX_DB_PATH);
    if (db == null) {
        return null;
    }
    ensureSchema(db);

    var current = parseInt(metaGet(db, "schema_version", "0")) || 0;
    if (current !== SCHEMA_VERSION) {
        // The index is a derived cache, so a forward bump simply rebuilds it.
        if (current !== 0 && current < SCHEMA_VERSION) {
            db.exec("DROP TABLE IF EXISTS photos");
            ensureSchema(db);
        }
        metaSet(db, "schema_version", SCHEMA_VERSION);
    }
    return db;
}

/* ------------------------------------------------------------------ *
 *  EXIF parsing helpers
 *
 *  imagelib.getExif() returns a map whose values are mostly JSON-encoded
 *  strings, e.g. Make => "\"Canon\"" and FNumber => "\"28/10\"". We normalise
 *  each value by attempting a JSON.parse, then interpret it as string/number.
 *  This mirrors the proven parsing already used in photo.js.
 * ------------------------------------------------------------------ */

function exifRaw(exif, key) {
    if (!exif || exif[key] === undefined || exif[key] === null) {
        return undefined;
    }
    var v = exif[key];
    if (typeof v === "string") {
        try {
            v = JSON.parse(v);
        } catch (e) {
            /* keep the raw string */
        }
    }
    return v;
}

function exifFirst(v) {
    if (Array.isArray(v)) {
        return v.length ? v[0] : undefined;
    }
    return v;
}

// Parse an EXIF rational/number: "28/10" => 2.8, "100" => 100
function exifToNumber(v) {
    if (v === undefined || v === null) {
        return null;
    }
    if (typeof v === "number") {
        return v;
    }
    var s = ("" + v).trim();
    if (s.indexOf("/") >= 0) {
        var p = s.split("/");
        if (p.length === 2) {
            var num = parseFloat(p[0]);
            var den = parseFloat(p[1]);
            if (!isNaN(num) && !isNaN(den) && den !== 0) {
                return num / den;
            }
        }
    }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
}

function exifNumber(exif, key) {
    return exifToNumber(exifFirst(exifRaw(exif, key)));
}

function exifString(exif, key) {
    var v = exifFirst(exifRaw(exif, key));
    if (v === undefined || v === null) {
        return null;
    }
    var s = ("" + v).trim();
    return s.length ? s : null;
}

function exifInt(exif, key) {
    var n = exifNumber(exif, key);
    return n === null ? null : Math.round(n);
}

// "2023:11:05 14:30:00" => unix seconds (interpreted as UTC for stable ranges).
function exifDateToUnix(s) {
    if (!s) {
        return null;
    }
    var m = ("" + s).match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) {
        return null;
    }
    var t = Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
        parseInt(m[4]), parseInt(m[5]), parseInt(m[6]));
    if (isNaN(t)) {
        return null;
    }
    return Math.floor(t / 1000);
}

function shutterLabel(seconds) {
    if (seconds === null || seconds === undefined || seconds <= 0) {
        return null;
    }
    if (seconds < 1) {
        return "1/" + Math.round(1 / seconds);
    }
    return (Math.round(seconds * 10) / 10) + "s";
}

/* ------------------------------------------------------------------ *
 *  Metadata extraction
 * ------------------------------------------------------------------ */

// Build the full metadata row for a single image file. modifiedUnix / filesize
// can be supplied to avoid duplicate stat calls during a walk.
function extractPhotoMeta(filepath, modifiedUnix, filesize) {
    var filename = db_basename(filepath);
    var ext = db_getExt(filename);

    if (modifiedUnix === undefined || modifiedUnix === null) {
        modifiedUnix = filelib.mtime(filepath, true);
        if (modifiedUnix === false) {
            modifiedUnix = null;
        }
    }
    if (filesize === undefined || filesize === null) {
        filesize = filelib.filesize(filepath);
    }

    var meta = {
        filepath: filepath,
        filename: filename,
        filename_lc: filename.toLowerCase(),
        ext: ext,
        folder: db_dirname(filepath),
        filesize: filesize || 0,
        width: null,
        height: null,
        megapixels: null,
        orientation: null,
        taken_date: modifiedUnix || null,
        modified_date: modifiedUnix || null,
        camera_make: null,
        camera_model: null,
        lens_model: null,
        focal_length: null,
        aperture: null,
        shutter: null,
        shutter_label: null,
        iso: null,
        has_exif: 0,
        indexed_at: Math.floor(Date.now() / 1000)
    };

    // Resolution (best effort; RAW may fail here and fall back to EXIF below).
    try {
        var dim = imagelib.getImageDimension(filepath);
        if (dim && dim[0] && dim[1]) {
            meta.width = dim[0];
            meta.height = dim[1];
        }
    } catch (e) {
        /* ignore — fall back to EXIF dimensions */
    }

    // EXIF: shooting parameters, taken date and possibly resolution.
    var exif = null;
    try {
        if (imagelib.hasExif(filepath)) {
            exif = JSON.parse(imagelib.getExif(filepath));
        }
    } catch (e) {
        exif = null;
    }

    if (exif && typeof exif === "object") {
        meta.has_exif = 1;

        if (!meta.width || !meta.height) {
            var w = exifInt(exif, "PixelXDimension");
            var h = exifInt(exif, "PixelYDimension");
            if (w && h) {
                meta.width = w;
                meta.height = h;
            }
        }

        var taken = exifDateToUnix(exifString(exif, "DateTimeOriginal")) ||
            exifDateToUnix(exifString(exif, "DateTimeDigitized")) ||
            exifDateToUnix(exifString(exif, "DateTime"));
        if (taken) {
            meta.taken_date = taken;
        }

        meta.camera_make = exifString(exif, "Make");
        meta.camera_model = exifString(exif, "Model");
        meta.lens_model = exifString(exif, "LensModel");
        meta.focal_length = exifNumber(exif, "FocalLength");
        meta.aperture = exifNumber(exif, "FNumber");

        var expTime = exifNumber(exif, "ExposureTime");
        if (expTime !== null) {
            meta.shutter = expTime;
            meta.shutter_label = shutterLabel(expTime);
        }
        meta.iso = exifInt(exif, "ISOSpeedRatings");
    }

    // Derived geometry fields.
    if (meta.width && meta.height) {
        meta.megapixels = Math.round((meta.width * meta.height) / 1000000 * 10) / 10;
        if (meta.width > meta.height) {
            meta.orientation = "landscape";
        } else if (meta.width < meta.height) {
            meta.orientation = "portrait";
        } else {
            meta.orientation = "square";
        }
    }

    return meta;
}

// Insert or update one photo row keyed by its (unique) virtual path.
function upsertPhoto(db, m) {
    db.exec(
        "INSERT INTO photos (filepath, filename, filename_lc, ext, folder, filesize," +
        " width, height, megapixels, orientation, taken_date, modified_date," +
        " camera_make, camera_model, lens_model, focal_length, aperture, shutter," +
        " shutter_label, iso, has_exif, indexed_at)" +
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)" +
        " ON CONFLICT(filepath) DO UPDATE SET" +
        " filename=excluded.filename, filename_lc=excluded.filename_lc, ext=excluded.ext," +
        " folder=excluded.folder, filesize=excluded.filesize, width=excluded.width," +
        " height=excluded.height, megapixels=excluded.megapixels, orientation=excluded.orientation," +
        " taken_date=excluded.taken_date, modified_date=excluded.modified_date," +
        " camera_make=excluded.camera_make, camera_model=excluded.camera_model," +
        " lens_model=excluded.lens_model, focal_length=excluded.focal_length," +
        " aperture=excluded.aperture, shutter=excluded.shutter, shutter_label=excluded.shutter_label," +
        " iso=excluded.iso, has_exif=excluded.has_exif, indexed_at=excluded.indexed_at",
        [m.filepath, m.filename, m.filename_lc, m.ext, m.folder, m.filesize,
            m.width, m.height, m.megapixels, m.orientation, m.taken_date, m.modified_date,
            m.camera_make, m.camera_model, m.lens_model, m.focal_length, m.aperture, m.shutter,
            m.shutter_label, m.iso, m.has_exif, m.indexed_at]
    );
}

/* ------------------------------------------------------------------ *
 *  Photo roots + exclude folders
 * ------------------------------------------------------------------ */

// Photo library roots (mirrors backend/listRoots.js): every real (non-virtual)
// storage that has a /Photo folder, plus the user's home Photo folder.
function getPhotoRoots() {
    var roots = [];
    var seen = {};
    for (var i = 0; i < USER_VROOTS.length; i++) {
        var r = USER_VROOTS[i];
        if (r.Filesystem === "virtual") {
            continue;
        }
        var p = r.UUID + ":/Photo";
        if (!seen[p] && filelib.fileExists(p)) {
            roots.push(p);
            seen[p] = true;
        }
    }
    if (!seen["user:/Photo"] && filelib.fileExists("user:/Photo")) {
        roots.push("user:/Photo");
    }
    return roots;
}

// Exclude list is stored as a JSON array string in index_meta. Each entry is a
// path fragment; any file whose path contains "/<fragment>/" is skipped.
function getExcludeFolders() {
    var db = openIndexDB();
    if (db == null) {
        return "[]";
    }
    var raw = metaGet(db, "exclude_folders", "[]");
    db.close();
    return raw;
}

function setExcludeFolders(folders) {
    var db = openIndexDB();
    if (db == null) {
        return;
    }
    var arr = folders;
    if (typeof folders === "string") {
        try {
            arr = JSON.parse(folders);
        } catch (e) {
            arr = [];
        }
    }
    if (!Array.isArray(arr)) {
        arr = [];
    }
    metaSet(db, "exclude_folders", JSON.stringify(arr));
    db.close();
}

function parseExcludeList(raw) {
    try {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            return arr;
        }
    } catch (e) {
        /* ignore */
    }
    return [];
}

function isExcluded(filepath, excludeList) {
    if (!excludeList || !excludeList.length) {
        return false;
    }
    var p = "/" + filepath + "/";
    for (var i = 0; i < excludeList.length; i++) {
        var frag = ("" + excludeList[i]).replace(/^\/+|\/+$/g, "");
        if (frag.length === 0) {
            continue;
        }
        if (p.indexOf("/" + frag + "/") >= 0) {
            return true;
        }
    }
    return false;
}

/* ------------------------------------------------------------------ *
 *  Query parsing (iOS-style free text) + SQL builder
 * ------------------------------------------------------------------ */

// Numeric range token: ">800", "<1600", "800-3200", "800..3200", "100".
function parseRange(s) {
    s = ("" + s).trim();
    var m;
    if ((m = s.match(/^>=?\s*(.+)$/))) {
        return { min: parseFloat(m[1]), max: null };
    }
    if ((m = s.match(/^<=?\s*(.+)$/))) {
        return { min: null, max: parseFloat(m[1]) };
    }
    if ((m = s.match(/^(.+?)\.\.(.+)$/))) {
        return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
    }
    if ((m = s.match(/^([0-9.]+)-([0-9.]+)$/))) {
        return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
    }
    var v = parseFloat(s);
    if (isNaN(v)) {
        return null;
    }
    return { min: v, max: v };
}

// Date token => unix seconds. endOfDay pads to the *end* of the given period
// (end of year / month / day) so "2023", "2023-06" and "2023-06-15" all bound
// their period correctly regardless of how many days the month has.
function parseDateToUnix(s, endOfDay) {
    s = ("" + s).trim();
    var m = s.match(/^(\d{4})(?:[\-\/](\d{1,2}))?(?:[\-\/](\d{1,2}))?$/);
    if (!m) {
        return null;
    }
    var y = parseInt(m[1]);
    var hasMonth = m[2] !== undefined;
    var hasDay = m[3] !== undefined;
    var mo = hasMonth ? parseInt(m[2]) - 1 : 0;
    var d = hasDay ? parseInt(m[3]) : 1;

    if (!endOfDay) {
        var t0 = Date.UTC(y, mo, d, 0, 0, 0);
        return isNaN(t0) ? null : Math.floor(t0 / 1000);
    }
    // End of the specified period: start of the next period minus one second.
    var t;
    if (!hasMonth) {
        t = Date.UTC(y + 1, 0, 1, 0, 0, 0) - 1000;        // end of year
    } else if (!hasDay) {
        t = Date.UTC(y, mo + 1, 1, 0, 0, 0) - 1000;       // end of month
    } else {
        t = Date.UTC(y, mo, d, 23, 59, 59);               // end of day
    }
    return isNaN(t) ? null : Math.floor(t / 1000);
}

function parseDateRange(s) {
    s = ("" + s).trim();
    var m;
    if ((m = s.match(/^>=?\s*(.+)$/))) {
        return { min: parseDateToUnix(m[1], false), max: null };
    }
    if ((m = s.match(/^<=?\s*(.+)$/))) {
        return { min: null, max: parseDateToUnix(m[1], true) };
    }
    if ((m = s.match(/^(.+?)\.\.(.+)$/))) {
        return { min: parseDateToUnix(m[1], false), max: parseDateToUnix(m[2], true) };
    }
    var single = parseDateToUnix(s, false);
    if (single === null) {
        return null;
    }
    return { min: single, max: parseDateToUnix(s, true) };
}

function mergeRange(filter, field, r) {
    if (!r) {
        return;
    }
    if (!filter[field]) {
        filter[field] = { min: null, max: null };
    }
    if (r.min !== null && r.min !== undefined && !isNaN(r.min)) {
        filter[field].min = r.min;
    }
    if (r.max !== null && r.max !== undefined && !isNaN(r.max)) {
        filter[field].max = r.max;
    }
}

function mergeDate(filter, field, r) {
    if (!r) {
        return;
    }
    if (!filter[field]) {
        filter[field] = { min: null, max: null };
    }
    if (r.min !== null && r.min !== undefined) {
        filter[field].min = r.min;
    }
    if (r.max !== null && r.max !== undefined) {
        filter[field].max = r.max;
    }
}

var MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];
var MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"];

// Whether a bare word is a month name / abbreviation (not a number).
function isMonthName(s) {
    s = ("" + s).trim().toLowerCase();
    return MONTH_NAMES.indexOf(s) >= 0 || MONTH_ABBR.indexOf(s) >= 0;
}

// Month name / abbreviation / number => 1..12, or null.
function monthNameToNum(s) {
    s = ("" + s).trim().toLowerCase();
    var i = MONTH_NAMES.indexOf(s);
    if (i >= 0) {
        return i + 1;
    }
    i = MONTH_ABBR.indexOf(s);
    if (i >= 0) {
        return i + 1;
    }
    var n = parseInt(s);
    if (!isNaN(n) && n >= 1 && n <= 12) {
        return n;
    }
    return null;
}

// Month is a calendar-month filter (matches across all years). Stored as a list
// so several months can be OR-ed together (handy with a tags input).
function mergeMonth(filter, mnum) {
    if (!mnum || mnum < 1 || mnum > 12) {
        return;
    }
    if (!filter.month) {
        filter.month = [];
    }
    if (filter.month.indexOf(mnum) < 0) {
        filter.month.push(mnum);
    }
}

function newFilter() {
    return { text: [], ext: [] };
}

// Split a query string into tokens, honouring `key:"quoted value"` and "quoted".
function tokenizeQuery(q) {
    var tokens = [];
    var re = /(\w+):"([^"]*)"|"([^"]*)"|(\S+)/g;
    var m;
    while ((m = re.exec(q)) !== null) {
        if (m[1] !== undefined) {
            tokens.push(m[1] + ":" + m[2]);
        } else if (m[3] !== undefined) {
            tokens.push(m[3]);
        } else {
            tokens.push(m[4]);
        }
    }
    return tokens;
}

function classifyToken(filter, token) {
    var lower = token.toLowerCase();
    var colon = token.indexOf(":");
    var key = "";
    var val = "";
    if (colon > 0) {
        key = token.substring(0, colon).toLowerCase();
        val = token.substring(colon + 1);
    }

    // f/2.8 or f2.8 (aperture shorthand)
    var fm = lower.match(/^f\/?(\d+(?:\.\d+)?)$/);
    if (colon < 0 && fm) {
        mergeRange(filter, "aperture", { min: parseFloat(fm[1]), max: parseFloat(fm[1]) });
        return;
    }

    // 50mm (focal length shorthand)
    var fmm = lower.match(/^(\d+(?:\.\d+)?)mm$/);
    if (colon < 0 && fmm) {
        mergeRange(filter, "focal", { min: parseFloat(fmm[1]), max: parseFloat(fmm[1]) });
        return;
    }

    if (colon < 0 && lower.charAt(0) === ".") {
        filter.ext.push(lower.substring(1));
        return;
    }
    if (colon < 0 && IMAGE_EXTENSIONS.indexOf(lower) >= 0) {
        filter.ext.push(lower);
        return;
    }
    if (colon < 0 && lower === "raw") {
        filter.raw = true;
        return;
    }
    if (colon < 0 && (lower === "landscape" || lower === "portrait" || lower === "square")) {
        filter.orientation = lower;
        return;
    }
    if (colon < 0 && isMonthName(lower)) {
        mergeMonth(filter, monthNameToNum(lower));
        return;
    }
    if (colon < 0 && /^\d{4}$/.test(lower)) {
        mergeDate(filter, "taken", parseDateRange(lower));
        return;
    }

    if (colon > 0) {
        switch (key) {
            case "iso":
                mergeRange(filter, "iso", parseRange(val));
                return;
            case "f":
            case "aperture":
            case "fnumber":
                mergeRange(filter, "aperture", parseRange(val.replace(/^\//, "")));
                return;
            case "focal":
            case "fl":
                mergeRange(filter, "focal", parseRange(val.replace(/mm$/i, "")));
                return;
            case "mp":
            case "megapixels":
                mergeRange(filter, "mp", parseRange(val));
                return;
            case "width":
            case "w":
                mergeRange(filter, "width", parseRange(val));
                return;
            case "height":
            case "h":
                mergeRange(filter, "height", parseRange(val));
                return;
            case "model":
            case "camera":
                filter.model = val;
                return;
            case "make":
            case "brand":
                filter.make = val;
                return;
            case "lens":
                filter.lens = val;
                return;
            case "ext":
            case "type":
                filter.ext.push(val.toLowerCase().replace(/^\./, ""));
                return;
            case "name":
            case "filename":
                filter.filename = val;
                return;
            case "orientation":
                filter.orientation = val.toLowerCase();
                return;
            case "month":
                var monthVals = val.split(",");
                for (var mvi = 0; mvi < monthVals.length; mvi++) {
                    mergeMonth(filter, monthNameToNum(monthVals[mvi]));
                }
                return;
            case "taken":
            case "date":
            case "year":
                mergeDate(filter, "taken", parseDateRange(val));
                return;
            case "modified":
            case "mtime":
                mergeDate(filter, "modified", parseDateRange(val));
                return;
            case "before":
                mergeDate(filter, "taken", { min: null, max: parseDateToUnix(val, true) });
                return;
            case "after":
                mergeDate(filter, "taken", { min: parseDateToUnix(val, false), max: null });
                return;
            default:
                filter.text.push(token);
                return;
        }
    }

    // Plain free-text term.
    filter.text.push(token);
}

// Parse a free-text query string into a structured filter object.
function parseSearchQuery(q) {
    var filter = newFilter();
    if (!q) {
        return filter;
    }
    var tokens = tokenizeQuery("" + q);
    for (var i = 0; i < tokens.length; i++) {
        classifyToken(filter, tokens[i]);
    }
    return filter;
}

// Merge an explicit structured filter object (from the UI) onto a parsed one.
function applyExplicitFilters(filter, f) {
    if (!f || typeof f !== "object") {
        return;
    }
    if (f.filename) {
        filter.filename = f.filename;
    }
    if (f.model) {
        filter.model = f.model;
    }
    if (f.make) {
        filter.make = f.make;
    }
    if (f.lens) {
        filter.lens = f.lens;
    }
    if (f.orientation) {
        filter.orientation = ("" + f.orientation).toLowerCase();
    }
    if (f.raw) {
        filter.raw = true;
    }
    if (Array.isArray(f.ext)) {
        for (var i = 0; i < f.ext.length; i++) {
            filter.ext.push(("" + f.ext[i]).toLowerCase().replace(/^\./, ""));
        }
    }
    var ranges = ["iso", "aperture", "focal", "mp", "width", "height"];
    for (var r = 0; r < ranges.length; r++) {
        if (f[ranges[r]]) {
            mergeRange(filter, ranges[r], f[ranges[r]]);
        }
    }
    if (f.taken) {
        mergeDate(filter, "taken", f.taken);
    }
    if (f.modified) {
        mergeDate(filter, "modified", f.modified);
    }
    if (f.month) {
        var fmonths = Array.isArray(f.month) ? f.month : [f.month];
        for (var fmi = 0; fmi < fmonths.length; fmi++) {
            mergeMonth(filter, monthNameToNum(fmonths[fmi]));
        }
    }
}

function addRangeClause(clauses, args, col, r) {
    if (!r) {
        return;
    }
    if (r.min !== null && r.min !== undefined) {
        clauses.push(col + " >= ?");
        args.push(r.min);
    }
    if (r.max !== null && r.max !== undefined) {
        clauses.push(col + " <= ?");
        args.push(r.max);
    }
}

// Build the parameterised WHERE clause + args for a structured filter.
function buildWhere(filter) {
    var clauses = [];
    var args = [];
    var i;

    if (filter.text && filter.text.length) {
        for (i = 0; i < filter.text.length; i++) {
            var term = "%" + filter.text[i].toLowerCase() + "%";
            clauses.push("(filename_lc LIKE ? OR LOWER(IFNULL(camera_model,'')) LIKE ?" +
                " OR LOWER(IFNULL(lens_model,'')) LIKE ? OR LOWER(IFNULL(camera_make,'')) LIKE ?)");
            args.push(term, term, term, term);
        }
    }
    if (filter.filename) {
        clauses.push("filename_lc LIKE ?");
        args.push("%" + filter.filename.toLowerCase() + "%");
    }
    if (filter.ext && filter.ext.length) {
        var ph = [];
        for (i = 0; i < filter.ext.length; i++) {
            ph.push("?");
            args.push(filter.ext[i].toLowerCase());
        }
        clauses.push("ext IN (" + ph.join(",") + ")");
    }
    if (filter.raw) {
        var rph = [];
        for (i = 0; i < RAW_EXTENSIONS.length; i++) {
            rph.push("?");
            args.push(RAW_EXTENSIONS[i]);
        }
        clauses.push("ext IN (" + rph.join(",") + ")");
    }
    if (filter.model) {
        clauses.push("LOWER(IFNULL(camera_model,'')) LIKE ?");
        args.push("%" + filter.model.toLowerCase() + "%");
    }
    if (filter.make) {
        clauses.push("LOWER(IFNULL(camera_make,'')) LIKE ?");
        args.push("%" + filter.make.toLowerCase() + "%");
    }
    if (filter.lens) {
        clauses.push("LOWER(IFNULL(lens_model,'')) LIKE ?");
        args.push("%" + filter.lens.toLowerCase() + "%");
    }
    if (filter.orientation) {
        clauses.push("orientation = ?");
        args.push(filter.orientation);
    }
    if (filter.month && filter.month.length) {
        var mph = [];
        for (i = 0; i < filter.month.length; i++) {
            mph.push("?");
            args.push(filter.month[i]);
        }
        clauses.push("CAST(strftime('%m', taken_date, 'unixepoch') AS INTEGER) IN (" + mph.join(",") + ")");
    }

    addRangeClause(clauses, args, "iso", filter.iso);
    addRangeClause(clauses, args, "aperture", filter.aperture);
    addRangeClause(clauses, args, "focal_length", filter.focal);
    addRangeClause(clauses, args, "megapixels", filter.mp);
    addRangeClause(clauses, args, "width", filter.width);
    addRangeClause(clauses, args, "height", filter.height);
    addRangeClause(clauses, args, "taken_date", filter.taken);
    addRangeClause(clauses, args, "modified_date", filter.modified);

    return { clause: clauses.length ? clauses.join(" AND ") : "1=1", args: args };
}

function buildOrderBy(sort) {
    switch (sort) {
        case "taken_asc":
            return "taken_date ASC";
        case "taken_desc":
            return "taken_date DESC";
        case "modified_asc":
            return "modified_date ASC";
        case "modified_desc":
            return "modified_date DESC";
        case "name_asc":
            return "filename_lc ASC";
        case "name_desc":
            return "filename_lc DESC";
        case "size_asc":
            return "filesize ASC";
        case "size_desc":
            return "filesize DESC";
        case "mp_desc":
            return "megapixels DESC";
        case "mp_asc":
            return "megapixels ASC";
        default:
            return "taken_date DESC";
    }
}
