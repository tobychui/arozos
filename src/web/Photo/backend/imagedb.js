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

// Hidden path: any dot-prefixed segment, e.g. the ArozOS ".metadata/.cache"
// thumbnail folders that the file manager generates inside every browsed
// directory, or AppleDouble "._*" files. These are caches — never user
// photos — and the Photo UI hides dot-folders from browsing, so the indexer
// must skip them too or cached thumbnails pollute search and date grouping.
function db_isHiddenPath(filepath) {
    var parts = ("" + filepath).split("/");
    // parts[0] is the vroot ("user:"), which is never dot-prefixed.
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].charAt(0) === ".") {
            return true;
        }
    }
    return false;
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

    // User-assigned star ratings (0-5). Kept in a *separate* table keyed by the
    // virtual path so it survives a photos-table rebuild / schema bump / full
    // re-index — those only ever drop & repopulate the derived `photos` cache,
    // never the user's own ratings.
    db.exec(
        "CREATE TABLE IF NOT EXISTS photo_ratings (" +
        "filepath TEXT PRIMARY KEY NOT NULL," +
        "rating INTEGER NOT NULL," +          // 1..5 (a 0 rating is stored as "no row")
        "updated_at INTEGER" +                // unix sec the rating was last set
        ")"
    );
}

/* ------------------------------------------------------------------ *
 *  User-assigned star ratings
 * ------------------------------------------------------------------ */

// Clamp an arbitrary input to an integer in the 0..5 star range.
function db_clampRating(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) {
        return 0;
    }
    if (n < 0) {
        return 0;
    }
    if (n > 5) {
        return 5;
    }
    return n;
}

// Return the star rating (0 = unrated) for a single photo.
function db_getRating(db, filepath) {
    if (db == null || !filepath) {
        return 0;
    }
    var row = db.queryRow("SELECT rating FROM photo_ratings WHERE filepath = ?", [filepath]);
    if (row && row.rating) {
        return db_clampRating(row.rating);
    }
    return 0;
}

// Set (or, when rating <= 0, clear) the star rating for a single photo.
// Returns the stored rating (0 when cleared).
function db_setRating(db, filepath, rating) {
    if (db == null || !filepath) {
        return 0;
    }
    var r = db_clampRating(rating);
    if (r <= 0) {
        db.exec("DELETE FROM photo_ratings WHERE filepath = ?", [filepath]);
        return 0;
    }
    db.exec(
        "INSERT INTO photo_ratings (filepath, rating, updated_at) VALUES (?,?,?) " +
        "ON CONFLICT(filepath) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at",
        [filepath, r, Math.floor(Date.now() / 1000)]
    );
    return r;
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

// Append one numeric range condition to a category list. Each token contributes
// its own {min,max}; ranges within a category are OR-ed together at build time.
function pushRange(filter, field, r) {
    if (!r) {
        return;
    }
    var hasMin = r.min !== null && r.min !== undefined && !isNaN(r.min);
    var hasMax = r.max !== null && r.max !== undefined && !isNaN(r.max);
    if (!hasMin && !hasMax) {
        return;
    }
    if (!filter[field]) {
        filter[field] = [];
    }
    filter[field].push({ min: hasMin ? r.min : null, max: hasMax ? r.max : null });
}

// Append one date range condition to a category list (OR-ed at build time).
function pushDate(filter, field, r) {
    if (!r) {
        return;
    }
    var hasMin = r.min !== null && r.min !== undefined;
    var hasMax = r.max !== null && r.max !== undefined;
    if (!hasMin && !hasMax) {
        return;
    }
    if (!filter[field]) {
        filter[field] = [];
    }
    filter[field].push({ min: hasMin ? r.min : null, max: hasMax ? r.max : null });
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
function pushMonth(filter, mnum) {
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

// Every category is a list. Within a category the values are OR-ed; across
// categories they are AND-ed (see buildWhere). `raw` is the single boolean
// exception (a shorthand that expands into the RAW extensions).
function newFilter() {
    return {
        text: [], filename: [], ext: [], raw: false,
        model: [], make: [], lens: [], orientation: [], month: [],
        iso: [], aperture: [], focal: [], mp: [], width: [], height: [],
        taken: [], modified: [], rating: []
    };
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
        pushRange(filter, "aperture", { min: parseFloat(fm[1]), max: parseFloat(fm[1]) });
        return;
    }

    // 50mm (focal length shorthand)
    var fmm = lower.match(/^(\d+(?:\.\d+)?)mm$/);
    if (colon < 0 && fmm) {
        pushRange(filter, "focal", { min: parseFloat(fmm[1]), max: parseFloat(fmm[1]) });
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
        filter.orientation.push(lower);
        return;
    }
    if (colon < 0 && isMonthName(lower)) {
        pushMonth(filter, monthNameToNum(lower));
        return;
    }
    if (colon < 0 && /^\d{4}$/.test(lower)) {
        pushDate(filter, "taken", parseDateRange(lower));
        return;
    }

    if (colon > 0) {
        switch (key) {
            case "iso":
                pushRange(filter, "iso", parseRange(val));
                return;
            case "rating":
            case "stars":
            case "star":
                pushRange(filter, "rating", parseRange(val.replace(/\*/g, "")));
                return;
            case "f":
            case "aperture":
            case "fnumber":
                pushRange(filter, "aperture", parseRange(val.replace(/^\//, "")));
                return;
            case "focal":
            case "fl":
                pushRange(filter, "focal", parseRange(val.replace(/mm$/i, "")));
                return;
            case "mp":
            case "megapixels":
                pushRange(filter, "mp", parseRange(val));
                return;
            case "width":
            case "w":
                pushRange(filter, "width", parseRange(val));
                return;
            case "height":
            case "h":
                pushRange(filter, "height", parseRange(val));
                return;
            case "model":
            case "camera":
                filter.model.push(val);
                return;
            case "make":
            case "brand":
                filter.make.push(val);
                return;
            case "lens":
                filter.lens.push(val);
                return;
            case "ext":
            case "type":
                filter.ext.push(val.toLowerCase().replace(/^\./, ""));
                return;
            case "name":
            case "filename":
                filter.filename.push(val);
                return;
            case "orientation":
                filter.orientation.push(val.toLowerCase());
                return;
            case "month":
                var monthVals = val.split(",");
                for (var mvi = 0; mvi < monthVals.length; mvi++) {
                    pushMonth(filter, monthNameToNum(monthVals[mvi]));
                }
                return;
            case "taken":
            case "date":
            case "year":
                pushDate(filter, "taken", parseDateRange(val));
                return;
            case "modified":
            case "mtime":
                pushDate(filter, "modified", parseDateRange(val));
                return;
            case "before":
                pushDate(filter, "taken", { min: null, max: parseDateToUnix(val, true) });
                return;
            case "after":
                pushDate(filter, "taken", { min: parseDateToUnix(val, false), max: null });
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
// String fields accept a single value or an array (OR-ed within the category).
function applyExplicitFilters(filter, f) {
    if (!f || typeof f !== "object") {
        return;
    }
    function pushStrings(field, v) {
        if (v === undefined || v === null) {
            return;
        }
        var list = Array.isArray(v) ? v : [v];
        for (var k = 0; k < list.length; k++) {
            filter[field].push("" + list[k]);
        }
    }
    pushStrings("filename", f.filename);
    pushStrings("model", f.model);
    pushStrings("make", f.make);
    pushStrings("lens", f.lens);
    if (f.orientation) {
        var orients = Array.isArray(f.orientation) ? f.orientation : [f.orientation];
        for (var o = 0; o < orients.length; o++) {
            filter.orientation.push(("" + orients[o]).toLowerCase());
        }
    }
    if (f.raw) {
        filter.raw = true;
    }
    if (Array.isArray(f.ext)) {
        for (var i = 0; i < f.ext.length; i++) {
            filter.ext.push(("" + f.ext[i]).toLowerCase().replace(/^\./, ""));
        }
    }
    var ranges = ["iso", "aperture", "focal", "mp", "width", "height", "rating"];
    for (var r = 0; r < ranges.length; r++) {
        var rv = f[ranges[r]];
        if (rv) {
            var rlist = Array.isArray(rv) ? rv : [rv];
            for (var ri = 0; ri < rlist.length; ri++) {
                pushRange(filter, ranges[r], rlist[ri]);
            }
        }
    }
    if (f.taken) {
        var tlist = Array.isArray(f.taken) ? f.taken : [f.taken];
        for (var ti = 0; ti < tlist.length; ti++) {
            pushDate(filter, "taken", tlist[ti]);
        }
    }
    if (f.modified) {
        var mlist = Array.isArray(f.modified) ? f.modified : [f.modified];
        for (var mi = 0; mi < mlist.length; mi++) {
            pushDate(filter, "modified", mlist[mi]);
        }
    }
    if (f.month) {
        var fmonths = Array.isArray(f.month) ? f.month : [f.month];
        for (var fmi = 0; fmi < fmonths.length; fmi++) {
            pushMonth(filter, monthNameToNum(fmonths[fmi]));
        }
    }
}

// Wrap a list of OR-ed fragments as a single AND clause (parenthesised if >1).
function pushOrGroup(clauses, fragments) {
    if (!fragments.length) {
        return;
    }
    clauses.push(fragments.length > 1 ? "(" + fragments.join(" OR ") + ")" : fragments[0]);
}

// OR group of LIKE conditions on a NOT NULL column (e.g. filename_lc).
function addLikeGroup(clauses, args, col, list) {
    if (!list || !list.length) {
        return;
    }
    var ors = [];
    for (var i = 0; i < list.length; i++) {
        ors.push(col + " LIKE ?");
        args.push("%" + ("" + list[i]).toLowerCase() + "%");
    }
    pushOrGroup(clauses, ors);
}

// OR group of LIKE conditions on a nullable column.
function addNullableLikeGroup(clauses, args, col, list) {
    if (!list || !list.length) {
        return;
    }
    var ors = [];
    for (var i = 0; i < list.length; i++) {
        ors.push("LOWER(IFNULL(" + col + ",'')) LIKE ?");
        args.push("%" + ("" + list[i]).toLowerCase() + "%");
    }
    pushOrGroup(clauses, ors);
}

// Equality OR group expressed as IN (...).
function addInGroup(clauses, args, col, list) {
    if (!list || !list.length) {
        return;
    }
    var ph = [];
    for (var i = 0; i < list.length; i++) {
        ph.push("?");
        args.push(list[i]);
    }
    clauses.push(col + " IN (" + ph.join(",") + ")");
}

// OR group of numeric/date ranges. Each {min,max} becomes
// "(col >= min AND col <= max)"; the ranges within one category are OR-ed.
function addRangeGroup(clauses, args, col, list) {
    if (!list || !list.length) {
        return;
    }
    var ors = [];
    for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r) {
            continue;
        }
        var parts = [];
        if (r.min !== null && r.min !== undefined) {
            parts.push(col + " >= ?");
            args.push(r.min);
        }
        if (r.max !== null && r.max !== undefined) {
            parts.push(col + " <= ?");
            args.push(r.max);
        }
        if (!parts.length) {
            continue;
        }
        ors.push(parts.length > 1 ? "(" + parts.join(" AND ") + ")" : parts[0]);
    }
    pushOrGroup(clauses, ors);
}

// Build the parameterised WHERE clause + args for a structured filter.
// Within a category multiple values are OR-ed; categories are AND-ed together.
function buildWhere(filter) {
    var clauses = [];
    var args = [];
    var i;

    // Free text: OR across terms, each term matching any of several columns.
    if (filter.text && filter.text.length) {
        var textOrs = [];
        for (i = 0; i < filter.text.length; i++) {
            var term = "%" + filter.text[i].toLowerCase() + "%";
            textOrs.push("(filename_lc LIKE ? OR LOWER(IFNULL(camera_model,'')) LIKE ?" +
                " OR LOWER(IFNULL(lens_model,'')) LIKE ? OR LOWER(IFNULL(camera_make,'')) LIKE ?)");
            args.push(term, term, term, term);
        }
        pushOrGroup(clauses, textOrs);
    }

    addLikeGroup(clauses, args, "filename_lc", filter.filename);
    addNullableLikeGroup(clauses, args, "camera_model", filter.model);
    addNullableLikeGroup(clauses, args, "camera_make", filter.make);
    addNullableLikeGroup(clauses, args, "lens_model", filter.lens);
    addInGroup(clauses, args, "orientation", filter.orientation);

    // Extensions (plus the RAW shorthand) are all OR-ed through a single IN.
    var extList = (filter.ext || []).slice();
    if (filter.raw) {
        for (i = 0; i < RAW_EXTENSIONS.length; i++) {
            if (extList.indexOf(RAW_EXTENSIONS[i]) < 0) {
                extList.push(RAW_EXTENSIONS[i]);
            }
        }
    }
    addInGroup(clauses, args, "ext", extList);

    // Calendar months (matched across all years), OR-ed via IN.
    if (filter.month && filter.month.length) {
        var mph = [];
        for (i = 0; i < filter.month.length; i++) {
            mph.push("?");
            args.push(filter.month[i]);
        }
        clauses.push("CAST(strftime('%m', taken_date, 'unixepoch') AS INTEGER) IN (" + mph.join(",") + ")");
    }

    addRangeGroup(clauses, args, "iso", filter.iso);
    addRangeGroup(clauses, args, "aperture", filter.aperture);
    addRangeGroup(clauses, args, "focal_length", filter.focal);
    addRangeGroup(clauses, args, "megapixels", filter.mp);
    addRangeGroup(clauses, args, "width", filter.width);
    addRangeGroup(clauses, args, "height", filter.height);
    addRangeGroup(clauses, args, "taken_date", filter.taken);
    addRangeGroup(clauses, args, "modified_date", filter.modified);
    // Rating lives in the joined photo_ratings table; unrated photos count as 0.
    addRangeGroup(clauses, args, "IFNULL(photo_ratings.rating, 0)", filter.rating);

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
