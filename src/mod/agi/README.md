# ArOZ Online JavaScript Gateway Interface (AGI)

AGI is the server-side JavaScript runtime used by ArozOS for module scripts (`.agi` / `.js`).
Scripts run in an Otto VM with sandboxed access to ArozOS functions.

This document is updated to match the current AGI implementation in `mod/agi/agi*.go`.

> **Maintainer note — keep Terminal in sync**
> The Terminal webapp ships an in-app API reference panel that is driven by a separate
> structured data file: **`src/web/Terminal/docs/api.json`**.
> Whenever this README is updated (new functions, changed signatures, new library, etc.)
> that file **must also be updated** to keep the in-app help accurate.
> The JSON mirrors this README's section structure — one object per library section,
> each with a `functions` array of `{ name, sig, desc, ret, example }` entries.

## AGI Version

- Runtime version: `3.0` (`AgiVersion` in `agi.go`)

## Quick Start

```javascript
// Basic response
sendResp("Hello from AGI");

// JSON response
sendJSONResp({ ok: true, time: Date.now() });

// Load a library
if (requirelib("filelib")) {
    var files = filelib.glob("user:/Desktop/*");
    sendJSONResp(files);
}
```

## Runtime Globals

### System globals

- `BUILD_VERSION`
- `INTERNAL_VERSION`
- `LOADED_MODULES`
- `LOADED_STORAGES`
- `__FILE__`
- `HTTP_RESP`
- `HTTP_HEADER`

### User globals

- `USERNAME`
- `USERICON`
- `USERQUOTA_TOTAL`
- `USERQUOTA_USED`
- `USER_VROOTS`
- `USER_MODULES`

### Detached-script globals (`execd` child)

- `BUILD_VERSION`: Current system build version
- `INTERNAL_VERSION`: Internal version number
- `LOADED_MODULES`: Array of loaded system modules
- `LOADED_STORAGES`: Array of available storage pools
- `__FILE__`: Current script file path
- `HTTP_RESP`: Response content (automatically set)
- `HTTP_HEADER`: Response content type (automatically set)
- `USERNAME`: Current user's username
- `USERICON`: Current user's icon path
- `USERQUOTA_TOTAL`: User's total storage quota
- `USERQUOTA_USED`: User's used storage quota
- `USER_VROOTS`: User's accessible virtual root paths
- `USER_MODULES`: User's accessible modules
- `EXECUTION_ID`: UUIDv4 that uniquely identifies this script invocation — useful for correlating log lines across concurrent executions
- `PARENT_DETACHED` (`true`)
- `PARENT_PAYLOAD` (string payload)

## Path Rules

- Use virtual paths such as `user:/`, `tmp:/`, `extuuid:/...`.
- Many library functions auto-resolve relative paths against the running script.
- Permission checks are enforced (`CanRead` / `CanWrite`).

## Core AGI Functions

### Response functions

#### `sendResp(content)`
Sets `HTTP_RESP`.

```javascript
sendResp("done");
```

#### `echo(content)`
Appends text to current `HTTP_RESP`.

```javascript
echo("Hello ");
echo("World");
```

#### `sendOK()`
Sets response to `ok`.

```javascript
sendOK();
```

#### `sendJSONResp(objectOrJsonString)`
Sets `HTTP_HEADER = application/json` and writes JSON response.

```javascript
sendJSONResp({ success: true, items: [1, 2, 3] });
```

### DB functions

#### `newDBTableIfNotExists(tableName)`
```javascript
newDBTableIfNotExists("my_table");
```

#### `DBTableExists(tableName)`
```javascript
if (DBTableExists("my_table")) sendOK();
```

#### `writeDBItem(tableName, key, value)`
```javascript
writeDBItem("my_table", "theme", "dark");
```

#### `readDBItem(tableName, key)`
```javascript
var v = readDBItem("my_table", "theme");
```

#### `listDBTable(tableName)`
Returns key-value object.

```javascript
var kv = listDBTable("my_table");
sendJSONResp(kv);
```

#### `deleteDBItem(tableName, key)`
```javascript
deleteDBItem("my_table", "theme");
```

#### `dropDBTable(tableName)`
```javascript
dropDBTable("my_table");
```

### Module and scheduling

#### `registerModule(jsonConfigString)`
Registers a module from JSON config.

```javascript
registerModule(JSON.stringify({
    Name: "MyApp",
    Desc: "Example module",
    Group: "Utilities",
    IconPath: "icon.png",
    Version: "1.0",
    StartDir: "index.html",
    SupportFW: true,
    LaunchFWDir: "index.html"
}));
```

#### `addNightlyTask(scriptPath)`
Adds a valid AGI script to nightly task list.

```javascript
addNightlyTask("MyApp/nightly.agi");
```

### Utility and flow

#### `includes(scriptName)`
Loads and executes another script relative to current script directory.

```javascript
includes("helpers.js");
```

#### `delay(ms)`
Sleeps for milliseconds.

```javascript
delay(500);
```

#### `exit()`
Stops script execution.

```javascript
if (!userIsAdmin()) exit();
```

#### `execd(scriptName, payload)`
Executes another script asynchronously.

```javascript
execd("worker.agi", JSON.stringify({ job: "thumbs" }));
```

#### Deprecated (kept for compatibility)

- `requirepkg(...)` -> deprecated in AGI v3
- `execpkg(...)` -> deprecated in AGI v3
- `decodeVirtualPath(...)` -> deprecated
- `decodeAbsoluteVirtualPath(...)` -> deprecated
- `encodeRealPath(...)` -> deprecated

### User/permission functions

#### `pathCanWrite(vpath)`
```javascript
if (pathCanWrite("user:/Documents")) sendOK();
```

#### `getUserPermissionGroup()`
Returns JSON string.

```javascript
var group = JSON.parse(getUserPermissionGroup());
```

#### `userIsAdmin()`
```javascript
if (!userIsAdmin()) sendResp("admin only");
```

#### `userExists(username)` (admin only)
```javascript
if (userExists("alice")) echo("exists");
```

#### `createUser(username, password, defaultGroup)` (admin only)
```javascript
createUser("alice", "StrongPass", "default");
```

#### `removeUser(username)` (admin only)
```javascript
removeUser("alice");
```

#### `editUser(...)`
Currently stubbed and always returns false.

## Loading Libraries

Use `requirelib(libName)`.

```javascript
requirelib("filelib");
```

Registered library IDs:

- `filelib`
- `imagelib`
- `http`
- `share`
- `iot`
- `appdata`
- `sysinfo`
- `ziplib` (includes 7z support via `ziplib.extract7zFile`, `ziplib.list7zFileContents`, etc.)
- `sqlite` (SQLite database access — not available on linux/mipsle or windows/arm/386)
- `llm` (OpenAI / Anthropic LLM chat: text & file based, with pricing & quota)
- `cnn` (CXNNAIO vision inference: classification, detection, segmentation, pose, oriented detection, face analysis)
- `office` (ArozOS Office suite: .pptx / .xlsx / .docx converters + native zip container pack/unpack)
- `ffmpeg` (only when ffmpeg exists on host)

Special case:

- `requirelib("websocket")` is injected only in HTTP request context.

## filelib API

Load:

```javascript
requirelib("filelib");
```

### `filelib.writeFile(vpath, content)`
```javascript
filelib.writeFile("user:/notes.txt", "hello");
```

### `filelib.readFile(vpath)`
```javascript
var t = filelib.readFile("user:/notes.txt");
```

### `filelib.deleteFile(vpath)`
```javascript
filelib.deleteFile("user:/notes.txt");
```

### `filelib.walk(vpath, mode)`
`mode`: `all`, `file`, `folder`

```javascript
var allFiles = filelib.walk("user:/", "file");
```

### `filelib.glob(pattern, sortMode)`
`sortMode` supports default and user modes from FS sort settings.

```javascript
var list = filelib.glob("user:/Desktop/*.jpg", "default");
```

### `filelib.aglob(pattern, sortMode)`
Advanced glob.

```javascript
var list = filelib.aglob("user:/Desktop/**/*.png", "default");
```

### `filelib.readdir(vpath, sortMode)`
Returns array of objects: `{Filename, Filepath, Ext, Filesize, Modtime, IsDir}`.

```javascript
var entries = filelib.readdir("user:/Desktop", "default");
```

### `filelib.filesize(vpath)`
```javascript
var size = filelib.filesize("user:/movie.mp4");
```

### `filelib.fileExists(vpath)`
```javascript
if (filelib.fileExists("user:/a.txt")) sendOK();
```

### `filelib.isDir(vpath)`
```javascript
if (filelib.isDir("user:/Desktop")) sendOK();
```

### `filelib.mkdir(vpath)`
```javascript
filelib.mkdir("user:/newfolder");
```

### `filelib.md5(vpath)`
```javascript
var hash = filelib.md5("user:/a.txt");
```

### `filelib.mtime(vpath, parseToUnix)`
`parseToUnix=true` returns Unix timestamp; otherwise formatted string.

```javascript
var ts = filelib.mtime("user:/a.txt", true);
```

### `filelib.rootName(vpath)`
Returns storage root display name.

```javascript
var root = filelib.rootName("user:/Desktop/a.txt");
```

## imagelib API

Load:

```javascript
requirelib("imagelib");
```

### `imagelib.getImageDimension(vpath)`
Returns `[width, height]`.

```javascript
var dim = imagelib.getImageDimension("user:/img.jpg");
```

### `imagelib.resizeImage(src, dest, width, height)`
```javascript
imagelib.resizeImage("user:/img.jpg", "user:/img_small.jpg", 800, 600);
```

### `imagelib.resizeImageBase64(src, width, height, format)`
Returns data URL string.

```javascript
var b64 = imagelib.resizeImageBase64("user:/img.jpg", 320, 240, "jpeg");
```

### `imagelib.cropImage(src, dest, x, y, width, height)`
```javascript
imagelib.cropImage("user:/img.jpg", "user:/crop.jpg", 10, 10, 200, 200);
```

### `imagelib.loadThumbString(vpath)`
Returns cached thumbnail base64 string.

```javascript
var thumb = imagelib.loadThumbString("user:/img.jpg");
```

### `imagelib.hasExif(vpath)`
```javascript
if (imagelib.hasExif("user:/img.jpg")) echo("has exif");
```

### `imagelib.getExif(vpath)`
Returns JSON string.

```javascript
var exif = JSON.parse(imagelib.getExif("user:/img.jpg"));
```

## http API

Load:

```javascript
requirelib("http");
```

### `http.get(url)`
```javascript
var body = http.get("https://example.com");
```

### `http.post(url, jsonString)`
```javascript
var body = http.post("https://example.com/api", JSON.stringify({a:1}));
```

### `http.head(url, headerKey)`
- Without `headerKey`: returns JSON string of all headers.
- With `headerKey`: returns JSON string of that header value.

```javascript
var headers = JSON.parse(http.head("https://example.com"));
```

### `http.getCode(url)`
Returns status code.

```javascript
var code = http.getCode("https://example.com");
```

### `http.download(url, destDirVpath, filenameOptional)`
Downloads into destination directory.

```javascript
http.download("https://example.com/a.zip", "user:/Downloads", "a.zip");
```

### `http.getb64(url)`
```javascript
var raw = http.getb64("https://example.com/logo.png");
```

### `http.redirect(targetUrl, statusCode)`
Default status code is `307` when omitted.

```javascript
http.redirect("https://example.com/new", 302);
```

## share API

Load:

```javascript
requirelib("share");
```

### `share.shareFile(vpath, timeoutSec)`
`timeoutSec=0` means no auto-expire.

```javascript
var uuid = share.shareFile("user:/report.pdf", 3600);
```

### `share.removeShare(shareUUID)`
```javascript
share.removeShare(uuid);
```

### `share.checkShareExists(shareUUID)`
```javascript
if (share.checkShareExists(uuid)) sendOK();
```

### `share.fileIsShared(vpath)`
```javascript
if (share.fileIsShared("user:/report.pdf")) sendOK();
```

### `share.getFileShareUUID(vpath)`
```javascript
var sid = share.getFileShareUUID("user:/report.pdf");
```

### `share.checkSharePermission(shareUUID)`
```javascript
var perm = share.checkSharePermission(uuid);
```

## iot API

Load:

```javascript
requirelib("iot");
```

### `iot.ready()`
```javascript
if (!iot.ready()) sendResp("iot unavailable");
```

### `iot.scan()`
Returns scanned device array.

```javascript
var devices = iot.scan();
```

### `iot.list()`
Returns cached device array.

```javascript
var devices = iot.list();
```

### `iot.connect(deviceId, username, password, token)`
```javascript
iot.connect("dev-1", "admin", "pass", "");
```

### `iot.status(deviceId)`
Returns parsed status object.

```javascript
var s = iot.status("dev-1");
```

### `iot.exec(deviceId, endpointName, payloadObject)`
Returns parsed result object or `false`.

```javascript
var resp = iot.exec("dev-1", "toggle", { value: true });
```

### `iot.disconnect(deviceId)`
```javascript
iot.disconnect("dev-1");
```

### `iot.iconTag(deviceId)`
```javascript
var tag = iot.iconTag("dev-1");
```

## appdata API (read-only web root access)

Load:

```javascript
requirelib("appdata");
```

### `appdata.readFile(relativePathFromWebRoot)`
```javascript
var conf = appdata.readFile("MyApp/config.json");
```

### `appdata.listDir(relativeDirFromWebRoot)`
Returns relative path array.

```javascript
var files = appdata.listDir("MyApp");
```

### `appdata.getModuleList()`
Returns parsed module list array.

```javascript
var mods = appdata.getModuleList();
```

## sysinfo API

Load:

```javascript
requirelib("sysinfo");
```

### `sysinfo.getCPUUsage()`
Returns CPU usage percent.

```javascript
var cpu = sysinfo.getCPUUsage();
```

### `sysinfo.getRAMUsage()`
Returns `{used, total, percent}`.

```javascript
var ram = sysinfo.getRAMUsage();
```

### `sysinfo.getNetworkUsage()`
Returns `{rxRate, txRate, rxTotal, txTotal}` in bytes / bytes per second.

```javascript
var net = sysinfo.getNetworkUsage();
```

### `sysinfo.getDiskInfo()`
Returns logical disk info array.

```javascript
var disks = sysinfo.getDiskInfo();
```

## ziplib API

Load:

```javascript
requirelib("ziplib");
```

### `ziplib.extractZipFile(src, destDir)`
```javascript
ziplib.extractZipFile("user:/a.zip", "user:/out/");
```

### `ziplib.createZipFile(sourcesArrayOrString, outputZip)`
```javascript
ziplib.createZipFile(["user:/a.txt", "user:/b.txt"], "user:/bundle.zip");
```

### `ziplib.createTarFile(sourcesArrayOrString, outputTar)`
```javascript
ziplib.createTarFile(["user:/folder"], "user:/bundle.tar");
```

### `ziplib.extractTarFile(srcTar, destDir)`
```javascript
ziplib.extractTarFile("user:/bundle.tar", "user:/out/");
```

### `ziplib.createTarGzFile(sourcesArrayOrString, outputTarGz)`
```javascript
ziplib.createTarGzFile(["user:/folder"], "user:/bundle.tar.gz");
```

### `ziplib.extractTarGzFile(srcTarGz, destDir)`
```javascript
ziplib.extractTarGzFile("user:/bundle.tar.gz", "user:/out/");
```

### `ziplib.createGzFile(srcFile, outputGz)`
```javascript
ziplib.createGzFile("user:/a.log", "user:/a.log.gz");
```

### `ziplib.extractGzFile(srcGz, outputFile)`
```javascript
ziplib.extractGzFile("user:/a.log.gz", "user:/a.log");
```

### `ziplib.isValidZipFile(vpath)`
Checks whether archive format is recognizable.

```javascript
var ok = ziplib.isValidZipFile("user:/a.zip");
```

### `ziplib.listZipFileContents(zipPath)`
Returns JSON tree string.

```javascript
var tree = JSON.parse(ziplib.listZipFileContents("user:/a.zip"));
```

### `ziplib.listZipFileDir(zipPath, dirPathInZip)`
Returns immediate child names array.

```javascript
var items = ziplib.listZipFileDir("user:/a.zip", "docs");
```

### `ziplib.getFileFromZip(zipPath, filePathInZip)`
Extracts one file to `tmp:/` and returns that virtual path.

```javascript
var tmp = ziplib.getFileFromZip("user:/a.zip", "docs/readme.txt");
```

### `ziplib.getCompressFileType(vpath)`
Returns one of `zip`, `7z`, `tar`, `tar.gz`, `gz`, `unknown`.

```javascript
var t = ziplib.getCompressFileType("user:/a.tgz");
```

### `ziplib.extractAnyFile(srcArchive, destDir)`
Auto-detects format and extracts.

```javascript
ziplib.extractAnyFile("user:/archive.any", "user:/out/");
```

### `ziplib.createAnyZipFile(sourcesArrayOrString, outputPath, format)`
`format`: `zip`, `tar`, `tar.gz` (`tgz`), `gz`.

```javascript
ziplib.createAnyZipFile(["user:/folder"], "user:/bundle.tar.gz", "tar.gz");
```

### 7z support (extensions on ziplib)

The following functions are registered alongside the standard ziplib functions and
operate on `.7z` archives. Load `ziplib` with `requirelib("ziplib")` as normal.

### `ziplib.extract7zFile(src, destDir)` → bool
Extracts all files from a 7z archive to `destDir`.

```javascript
requirelib("ziplib");
ziplib.extract7zFile("user:/archive.7z", "user:/out/");
```

### `ziplib.list7zFileDir(src, dirPathIn7z)` → string[]
Lists immediate children of a directory inside a 7z archive.
Directories are returned with a trailing `/`.

```javascript
requirelib("ziplib");
var items = ziplib.list7zFileDir("user:/archive.7z", "docs");
```

### `ziplib.list7zFileContents(src)` → string (JSON tree)
Returns the full contents of a 7z archive as a JSON tree (same schema as
`listZipFileContents`).

```javascript
requirelib("ziplib");
var tree = JSON.parse(ziplib.list7zFileContents("user:/archive.7z"));
```

### `ziplib.getFileFrom7z(src, filePathIn7z)` → string (vpath)
Extracts a single file from a 7z archive to `tmp:/` and returns its virtual path.

```javascript
requirelib("ziplib");
var tmp = ziplib.getFileFrom7z("user:/archive.7z", "docs/readme.txt");
```

### `ziplib.extractPartial7z(src, paths, destDir)` → bool
Extracts selected files or folders from a 7z archive.
`paths` may be a JS array or a JSON string array.
For folder selections the parent prefix is stripped; for file selections the file
is placed flat in `destDir` (matching `extractPartialZip` semantics).

```javascript
requirelib("ziplib");
ziplib.extractPartial7z("user:/archive.7z", ["docs/", "README.md"], "user:/out/");
```

### `ziplib.get7zFileInfo(src)` → string (JSON)
Returns metadata about a 7z archive:
`{ fileCount, dirCount, totalUncompressedSize, totalCompressedSize }`.
`totalCompressedSize` is always `0` because 7z uses solid compression.

```javascript
requirelib("ziplib");
var info = JSON.parse(ziplib.get7zFileInfo("user:/archive.7z"));
console.log(info.fileCount + " files, " + info.totalUncompressedSize + " bytes");
```

## sqlite API

Load:

```javascript
requirelib("sqlite");
```

> **Platform note:** the sqlite library is not available on `linux/mipsle`,
> `windows/arm`, or `windows/386` builds (excluded at compile time).

`sqlite.open()` returns a connection object. All SQL operations go through that
object. Connections are automatically closed when the script exits; you may also
call `db.close()` explicitly to release the handle early.

### `sqlite.open(vpath)` → db
Opens (or creates) a SQLite database file at the given virtual path.
Throws a `SQLiteError` on failure.

```javascript
requirelib("sqlite");
var db = sqlite.open("user:/.appdata/myapp/data.sqlite");
```

### `db.exec(sql, params)` → `{lastInsertId, rowsAffected}`
Executes a statement that does not return rows (INSERT, UPDATE, DELETE, CREATE …).
`params` is an optional JS array of bound values.

```javascript
db.exec("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)");
db.exec("INSERT INTO notes (body) VALUES (?)", ["Hello world"]);
```

### `db.query(sql, params)` → object[]
Executes a SELECT and returns all matching rows as an array of plain objects.

```javascript
var rows = db.query("SELECT * FROM notes WHERE id > ?", [0]);
rows.forEach(function(r) { console.log(r.id, r.body); });
```

### `db.queryRow(sql, params)` → object | null
Like `db.query()` but returns only the first row, or `null` if no rows matched.

```javascript
var row = db.queryRow("SELECT * FROM notes WHERE id = ?", [1]);
if (row) sendJSONResp(row);
```

### `db.tables()` → string[]
Returns the names of all user-created tables in the database.

```javascript
var tables = db.tables();
sendJSONResp(tables);
```

### `db.schema(tableName)` → object[]
Returns column metadata for the table as an array of
`{ cid, name, type, notnull, dflt_value, pk }` objects (from `PRAGMA table_info`).

```javascript
var cols = db.schema("notes");
sendJSONResp(cols);
```

### `db.close()` → bool
Closes the database connection and releases the handle.

```javascript
db.close();
```

### Full sqlite example

```javascript
requirelib("sqlite");

var db = sqlite.open("user:/.appdata/myapp/tasks.sqlite");
db.exec("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, done INTEGER DEFAULT 0)");

// Insert
var res = db.exec("INSERT INTO tasks (title) VALUES (?)", ["Buy milk"]);
console.log("new id:", res.lastInsertId);

// Query
var pending = db.query("SELECT * FROM tasks WHERE done = 0");
sendJSONResp(pending);

db.close();
```

## llm API

Load:

```javascript
requirelib("llm");
```

The `llm` library connects to any OpenAI-compatible or Anthropic endpoint
configured by an admin in **System Settings > AI Integration > AI Model**
(the settings tab and its `/system/aimodel/...` routes kept their original
"AI Model" name; only the requirelib identifier changed from `aimodel` to
`llm`). Per-model pricing and an optional token/cost quota are also defined
there. The wire-protocol logic (OpenAI / Anthropic request building and
response parsing) lives in the standalone `mod/aiservers/llm` Go package.

### `llm.chat(prompt, options)` → string
Sends a single-turn text prompt and returns the assistant's reply.
`options` is an optional object (see Options below).

```javascript
requirelib("llm");
var reply = llm.chat("What is the capital of France?");
sendResp(reply);
```

With a system prompt and model override:

```javascript
requirelib("llm");
var reply = llm.chat("Summarise this in one sentence.", {
    system: "You are a concise summariser.",
    model:  "gpt-4o-mini"
});
sendResp(reply);
```

### `llm.chatWithFile(prompt, files, options)` → string
Like `llm.chat()` but attaches one or more virtual-path files to the message.
Images are sent as base64 vision parts; text files are inlined as labelled text.
`files` may be a single vpath string or an array.

```javascript
requirelib("llm");
var reply = llm.chatWithFile(
    "Describe what you see in this image.",
    "user:/Photos/holiday.jpg"
);
sendResp(reply);
```

### `llm.request(messages, options)` → object
Low-level call. Accepts the full OpenAI-style messages array and returns the
raw response object (including `usage` and `choices`).

```javascript
requirelib("llm");
var resp = llm.request([
    { role: "system",    content: "You are helpful." },
    { role: "user",      content: "Hi!" },
    { role: "assistant", content: "Hello! How can I help?" },
    { role: "user",      content: "Tell me a joke." }
]);
sendResp(resp.choices[0].message.content);
```

### `llm.usage()` → object
Returns accumulated token / cost metrics across all models.

```javascript
requirelib("llm");
var u = llm.usage();
sendJSONResp(u);
// { totalTokens, totalCost, totalRequests, perModel: { ... }, currency, ... }
```

### `llm.models()` → object
Returns the configured default model name and a list of models that have
pricing entries defined in System Settings.

```javascript
requirelib("llm");
var m = llm.models();
sendJSONResp(m);
// { default: "gpt-4o", models: ["gpt-4o", "gpt-4o-mini", ...] }
```

### `llm.listModels()` → object
Queries the live endpoint for available models (does not consume tokens).

```javascript
requirelib("llm");
var m = llm.listModels();
sendJSONResp(m.models);
```

### `llm.fileParts(files)` → object[]
Converts virtual-path file(s) into OpenAI-style content parts that can be
embedded in a `messages` array for `llm.request()`.
Images become `image_url` data-URI parts; text files become `text` parts.

```javascript
requirelib("llm");
var parts = llm.fileParts(["user:/report.txt"]);
var resp  = llm.request([
    { role: "user", content: parts }
]);
sendResp(resp.choices[0].message.content);
```

### Options object

All functions that accept `options` support the following fields (all optional):

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Override the configured default model |
| `system` | string | System prompt (prepended as a `system` role message) |
| `endpoint` | string | Override the global endpoint URL |
| `apikey` | string | Override the global API key |
| `apiFormat` | string | Wire format: `"openai"` (default) or `"anthropic"` |
| `temperature` | number | Sampling temperature |
| `max_tokens` | number | Maximum tokens to generate |

## cnn API

Load:

```javascript
requirelib("cnn");
```

The `cnn` library connects to an external **CXNNAIO** vision-inference server
configured by an admin in **System Settings > AI Integration > CNN
Inference** (endpoint, optional bearer token, request timeout). Every
function reads its input image from a virtual file path (the calling user
must have read access); the returned object is the server's own response
envelope (`object`, `model`, `created`, `image`, `timing_ms`, `data`, ...),
so it matches the CXNNAIO API documentation field-for-field.

### `cnn.classify(file, options)` → object
Image classification (default model `mobilenet-v2`).

```javascript
requirelib("cnn");
var r = cnn.classify("user:/Photos/cat.jpg", { top_k: 3 });
sendJSONResp(r.data); // [{ label, index, score }, ...]
```

### `cnn.detect(file, options)` → object
Object detection (default model `yolo11n`).

```javascript
requirelib("cnn");
var r = cnn.detect("user:/Photos/street.jpg", { score_threshold: 0.3, render: true });
sendJSONResp(r.data);              // [{ label, class_id, score, box:{x1,y1,x2,y2} }, ...]
// r.rendered_image is a data URI PNG when render:true was set
```

### `cnn.segment(file, options)` → object
Instance segmentation (`yolo11n-seg`). Each item carries a per-instance,
box-cropped mask (`mask.data` is a base64 PNG).

### `cnn.pose(file, options)` → object
Pose estimation (`yolo11n-pose`), 17 COCO keypoints per detected person.

### `cnn.oriented(file, options)` → object
Oriented/rotated-box detection (`yolo11n-obb`), intended for aerial/top-down imagery.

### `cnn.faceDetect(file, options)` → object
Face detection (default model `ultraface-rfb-320`).

### `cnn.faceLandmarks(file, options)` → object
98-point facial landmarks (`pfld`). Set `options.cropped = true` to treat the
whole input image as one face crop instead of detecting faces first.

### `cnn.faceEmbedding(file, options)` → object
L2-normalized 128-d face embedding vector(s) (`mbv2facenet`).

### `cnn.faceAttributes(file, options)` → object
Gender attributes per face (`gender-mbv2-0.35`). Calls the server's
`/v1/faces/gender` route (the upstream API doc names this endpoint
`/v1/faces/attributes`, but the deployed server registers it as `gender`;
the response `object` field reads `"face.gender"`).

### `cnn.faceCompare(fileA, fileB, options)` → object
Compares two face photos/crops and returns their cosine similarity. Does not
support `options.async` (the server has no async variant for this endpoint).

```javascript
requirelib("cnn");
var r = cnn.faceCompare("user:/a.jpg", "user:/b.jpg", { threshold: 0.5 });
sendResp(r.similarity + " - " + (r.same ? "same person" : "different"));
```

### `cnn.analyze(file, tasks, options)` → object
Runs several tasks over one image in a single round trip. `tasks` is an
array (`"classify"`, `"detect"`, `"segment"`, `"pose"`, `"oriented"`,
`"faces"`, `"landmarks"`, `"attributes"`); `options` carries an optional
top-level `render`/`async` plus per-task parameter blocks keyed by task name.

```javascript
requirelib("cnn");
var r = cnn.analyze("user:/group.jpg", ["detect", "faces"], {
    render: true,
    detect: { score_threshold: 0.3 }
});
sendJSONResp(r.results.detect.data);
document_rendered = r.rendered_image; // data URI PNG
```

### `cnn.job(id)` → object
Polls an async job (see Async below). Returns
`{ id, object, status, created, result, error }` where `status` is one of
`"queued"`, `"running"`, `"succeeded"` or `"failed"`.

### `cnn.models()` → object
Live model registry from the configured server: `{ object, data: [{ id, object, task, classes, input }, ...] }`.

### `cnn.health()` → object
Live server health: `{ status, version, models_loaded, sessions, uptime_s }`.

### Async jobs

Every single-image function (`classify`, `detect`, `segment`, `pose`,
`oriented`, `faceDetect`, `faceLandmarks`, `faceEmbedding`,
`faceAttributes`, `analyze`) accepts `options.async = true`. When set, the
function returns immediately with a job object instead of blocking:

```javascript
requirelib("cnn");
var job = cnn.detect("user:/big.jpg", { async: true });
while (job.status === "queued" || job.status === "running") {
    delay(500);
    job = cnn.job(job.id);
}
sendJSONResp(job.status === "succeeded" ? job.result : job.error);
```

### Options object

All single-image functions accept the same `options` fields, using the
server's own field names so they match the CXNNAIO API documentation
directly (all optional):

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Override the server's default model for this task |
| `score_threshold` | number | Minimum confidence to keep (detect/seg/pose/oriented/faces) |
| `nms_threshold` | number | IoU suppression threshold (detect/seg/pose/oriented/faces) |
| `top_k` | number | Number of ranked results (classification) |
| `max_results` | number | Cap on returned items |
| `render` | bool | Also return an annotated PNG in `rendered_image` |
| `cropped` | bool | Treat the whole input image as one face crop (face endpoints) |
| `async` | bool | Submit as an async job instead of blocking (see Async jobs) |

`cnn.faceCompare` uses its own options shape instead: `model`, `threshold`,
`a_cropped`, `b_cropped`.

## office API

Converters between the ArozOS Office suite webapps (`src/web/Office/`) and
common office file formats. Backed by `mod/office` (pure Go, no external
dependencies). Word (.docx) and Excel (.xlsx) helpers will join this library
as the Docs and Sheets webapps mature.

Load:

```javascript
requirelib("office");
```

### `office.pptxToPresentation(srcVpath)`
Parse a PowerPoint `.pptx` file into the Slides document body schema (see
`src/web/Office/common/CONTRACT.md`). Returns the body as a **JSON string**,
or throws on failure. Embedded pictures are inlined as `data:` URLs; text
boxes, preset shapes, connector lines and tables map to their Slides object
types. Unsupported content (video, native charts, SmartArt) is skipped.

```javascript
requirelib("office");
var bodyJson = office.pptxToPresentation("user:/Desktop/deck.pptx");
sendJSONResp('{"body":' + bodyJson + '}');
```

### `office.presentationToPptx(bodyJson, destVpath)`
Build a `.pptx` from a serialized Slides body JSON string and write it to
`destVpath`. Returns `true` on success. Image objects must be inlined as
`data:` URLs and chart objects should carry a client-rendered PNG in
`props.png` (the Slides webapp does both automatically before calling).

```javascript
requirelib("office");
if (office.presentationToPptx(data, "user:/Desktop/out.pptx")){
    sendResp("OK");
}
```

### `office.xlsxToWorkbook(srcVpath)`
Parse an Excel `.xlsx` file into the Sheets document body schema. Returns
the body as a **JSON string**, or throws on failure. Handles values,
formulas (recalculated by the webapp), shared/inline strings, cell styles,
number formats, column widths / row heights, merged cells and frozen panes.
Charts, pivot tables and conditional formatting are skipped. Legacy binary
`.xls` is rejected with a message asking for `.xlsx`.

```javascript
requirelib("office");
var bodyJson = office.xlsxToWorkbook("user:/Desktop/report.xlsx");
sendJSONResp('{"body":' + bodyJson + '}');
```

### `office.workbookToXlsx(bodyJson, destVpath)`
Build a `.xlsx` from a serialized Sheets body JSON string and write it to
`destVpath`. Returns `true` on success. Formulas are written natively so
Excel recalculates them; webapp charts and filters are not exported.

```javascript
requirelib("office");
if (office.workbookToXlsx(data, "user:/Desktop/out.xlsx")){
    sendResp("OK");
}
```

### `office.docxToDocument(srcVpath)`
Parse a Word `.docx` file into the Docs document body schema. Returns the
body as a **JSON string**, or throws on failure. Handles paragraphs,
heading/title styles, alignment, inline formatting (bold/italic/underline/
strikethrough, color, size), hyperlinks, lists, tables, embedded images
(inlined as `data:` URLs), header/footer text and page geometry. Tracked
changes, footnotes and text boxes are ignored. Legacy binary `.doc` is
rejected with a message asking for `.docx`.

```javascript
requirelib("office");
var bodyJson = office.docxToDocument("user:/Desktop/report.docx");
sendJSONResp('{"body":' + bodyJson + '}');
```

### `office.documentToDocx(bodyJson, destVpath)`
Build a `.docx` from a serialized Docs body JSON string and write it to
`destVpath`. Returns `true` on success. Images must be inlined as `data:`
URLs (the Docs webapp does this automatically before calling).

```javascript
requirelib("office");
if (office.documentToDocx(data, "user:/Desktop/out.docx")){
    sendResp("OK");
}
```

### `office.packToFile(envelopeJson, destVpath)`
Write an Office suite native file (`.doca` / `.xlsa` / `.ppta`) as a **zip
container**: `document.json` plus deduplicated binary `assets/`. Media data
URLs and legacy `media?file=` links inside the envelope become embedded
assets, so the file stays portable when copied to another machine. Returns
`true` on success.

### `office.unpackFromFile(srcVpath)`
Read a native Office suite file and return its envelope **JSON string**
with embedded assets re-inlined as `data:` URLs. Legacy plain-JSON
documents pass through unchanged, so old files keep opening (and are
upgraded to the container format on their next save).

### `office.unpackToWorkdir(srcVpath, workdirBase)`
Read a native Office suite container and return its envelope **JSON string**
with binary assets extracted into `<workdirBase>/<doc-hash>/` and referenced
by `media?file=` links instead of inline base64 - so the JSON stays small
even for video-heavy documents (the Office webapps use
`user:/.appdata/Office/cache` as the working directory). Legacy plain-JSON
documents pass through unchanged.

```javascript
requirelib("office");
var envelope = office.unpackToWorkdir("user:/Documents/deck.ppta", "user:/.appdata/Office/cache");
sendJSONResp('{"envelope":' + envelope + '}');
```

## ffmpeg API

Load:

```javascript
requirelib("ffmpeg");
```

Note: library exists only when host has `ffmpeg` installed.

### `ffmpeg.convert(input, output, compression)`
Generic conversion.

```javascript
ffmpeg.convert("user:/in.mov", "user:/out.mp4", 0);
```

### `ffmpeg.audioConvert(input, output, sampleRate, progressFile)`
```javascript
ffmpeg.audioConvert("user:/in.wav", "user:/out.mp3", 44100, "tmp:/audio_progress.json");
```

### `ffmpeg.imageConvert(input, output, scaleFactor, compressionRate)`
```javascript
ffmpeg.imageConvert("user:/in.png", "user:/out.jpg", 0.5, 80);
```

### `ffmpeg.videoConvert(input, output, resolution, compressionRate, progressFile)`
```javascript
ffmpeg.videoConvert("user:/in.mp4", "user:/out.mp4", "720p", 55, "tmp:/video_progress.json");
```

### `ffmpeg.convertWithProgress(input, output, progressFile)`
```javascript
ffmpeg.convertWithProgress("user:/in.mp4", "user:/out.gif", "tmp:/conv_progress.json");
```

## websocket API

The websocket library upgrades the current HTTP connection to a WebSocket session.
It is only available in script paths reached via a live HTTP request context
(standard `InterfaceHandler` or token-handler routes — not `execd` children).

Load:

```javascript
requirelib("websocket");
```

> **Note on `delay()` after upgrade** — `websocket.upgrade()` replaces the global
> `delay()` with a message-pumping version. While the script sleeps inside `delay()`,
> any queued inbound frames are dispatched to `websocket.onMessage` (if set).
> `delay()` is therefore the natural yield point in event-driven loops.
> When `onMessage` is `null` the buffer is left untouched so that
> `available()` and `read()` can still see the frames.

---

### `websocket.upgrade(timeoutSec)` → `bool`

Upgrades the HTTP connection to WebSocket and starts the background frame reader.
The connection is closed automatically after `timeoutSec` seconds of idle time
(default `300`). Also installs the message-pumping `delay()` override.

Returns `false` if the upgrade fails.

```javascript
requirelib("websocket");
if (!websocket.upgrade(120)) exit();
```

---

### `websocket.send(text)` → `bool`

Sends a UTF-8 text frame to the client. Returns `false` if the connection is closed.

```javascript
websocket.send("Hello from server");
```

---

### `websocket.read(timeoutMs?)` → `string | null | false`

Reads the next inbound message from the internal buffer.

| Return value | Meaning |
|---|---|
| `string` | Message text |
| `null` | `timeoutMs` elapsed with no message; connection still open |
| `false` | Connection is closed |

`timeoutMs = 0` or omitted blocks indefinitely until a message arrives or the
connection closes.

```javascript
// Block until a message arrives or connection closes
var msg = websocket.read();

// Wait at most 5 s; returns null on timeout
var msg = websocket.read(5000);

if (msg === false) { /* connection closed */ }
if (msg === null)  { /* timed out, still open */ }
```

---

### `websocket.available()` → `number`

Returns the number of messages currently queued in the inbound buffer.
Non-blocking — safe to call on every iteration of a tight loop.

```javascript
if (websocket.available() > 0) {
    var msg = websocket.read();
}
```

---

### `websocket.isClosed()` → `bool`

Returns `true` when the WebSocket connection is no longer active.

```javascript
while (!websocket.isClosed()) {
    websocket.send("tick");
    delay(1000);
}
```

---

### `websocket.onMessage`

Assign a `function(msg)` callback to receive messages asynchronously.
The handler fires inside `delay()` on the script's own goroutine — Otto-safe, no
concurrent JS execution.

**Message object properties:**

| Property | Type | Description |
|---|---|---|
| `msg.data` | `string` | Text payload |
| `msg.timestamp` | `number` | Arrival time (Unix milliseconds) |
| `msg.type` | `number` | Frame type: `1` = text, `2` = binary |

```javascript
websocket.onMessage = function(msg) {
    console.log("Received at " + msg.timestamp + " ms: " + msg.data);
};
```

Set back to `null` to stop receiving callbacks and leave messages in the buffer:

```javascript
websocket.onMessage = null;
```

---

### `websocket.close()`

Sends a normal-closure frame and closes the connection.

```javascript
websocket.close();
```

---

### Pattern 1 — blocking read with optional timeout

Simplest pattern. `read(timeoutMs)` returns `null` on timeout so the loop can
send a keep-alive or do other work without blocking forever.

```javascript
requirelib("websocket");
if (!websocket.upgrade(120)) exit();

websocket.send("Connected. Commands: echo <text> | stop");

while (true) {
    var msg = websocket.read(30000); // wait up to 30 s

    if (msg === false) break;        // remote side closed
    if (msg === null)  {             // 30-second idle timeout
        websocket.send("Still here.");
        continue;
    }

    msg = msg.trim();
    if (msg === "stop") {
        websocket.send("Bye!");
        break;
    } else if (msg.indexOf("echo ") === 0) {
        websocket.send(msg.slice(5));
    } else if (msg !== "") {
        websocket.send("Unknown command: '" + msg + "'");
    }
}

websocket.close();
```

---

### Pattern 2 — `available()` polling (Arduino-style)

Use when you want to drain all queued frames in one shot each iteration, or when
the main loop body does other work regardless of incoming messages.

`onMessage` must be `null` (the default) so that `delay()` does **not** consume
frames behind your back.

```javascript
requirelib("websocket");
if (!websocket.upgrade(120)) exit();

websocket.send("available() polling mode.");

while (true) {
    if (websocket.isClosed()) break;

    var n = websocket.available();
    if (n > 0) {
        // Drain all waiting frames without blocking
        for (var i = 0; i < n; i++) {
            var msg = websocket.read(); // data already queued, returns immediately
            if (msg === false) break;
            msg = msg.trim();
            if (msg === "stop") {
                websocket.send("Bye!");
                websocket.close();
                break;
            }
            websocket.send("Echo: " + msg);
        }
    } else {
        delay(500); // sleep; buffer is untouched because onMessage is null
    }
}
```

---

### Pattern 3 — `onMessage` callback with `delay()` pump

Event-driven style. The callback fires inside `delay()` on the script goroutine.
Use a shared variable to hand data from the callback to the main loop.

```javascript
requirelib("websocket");
if (!websocket.upgrade(120)) exit();

websocket.send("onMessage mode. Commands: echo <text> | stop");

var lastMessage = "";

websocket.onMessage = function(msg) {
    // Runs on the script goroutine during delay() — safe to update shared state
    lastMessage = msg.data;
};

while (true) {
    if (lastMessage !== "") {
        var msg = lastMessage.trim();
        lastMessage = "";

        if (msg === "stop") {
            websocket.send("Bye!");
            break;
        } else if (msg.indexOf("echo ") === 0) {
            websocket.send(msg.slice(5));
        } else if (msg !== "") {
            websocket.send("Unknown command: '" + msg + "'");
        }
    }

    if (websocket.isClosed()) break;

    // delay() pumps the inbound channel and fires onMessage for each queued frame
    delay(100);
}

websocket.onMessage = null;
websocket.close();
```

## Scheduler Library (`scheduler`)

Load with: `requirelib("scheduler")`

Lets a webapp register, check, and remove background scheduled tasks on behalf of the signed-in user. Tasks call a script that lives inside the webapp's own folder — **not** in user virtual storage.

> **Prerequisite** — the user must have granted cron-job permission to this app first. The recommended flow is:
> 1. Check `scheduler.hasPermission()` in a backend `.agi` script.
> 2. If false, return a signal to the frontend so it can call `ao_module_requestSchedulerPermission()` to show the permission dialog.
> 3. After permission is granted, register the task from the backend.

### Scheduler Functions

#### `scheduler.hasPermission()` → `bool`

Returns `true` when the current user is allowed to create scheduled tasks.

```javascript
requirelib("scheduler");
if (!scheduler.hasPermission()) {
    sendResp("no_permission");
}
```

#### `scheduler.registered(taskName, appName)` → `bool`

Returns `true` when a task with the given name is already registered for this user+app combination.

```javascript
requirelib("scheduler");
if (scheduler.registered("MyApp_DailySync", "MyApp")) {
    sendResp("already_registered");
}
```

#### `scheduler.register(taskName, appName, intervalSecs [, description [, scriptName]])` → `bool`

Registers a new background task. Returns `true` on success.

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskName` | string | Unique task identifier (max 32 chars) |
| `appName` | string | Module folder name (must match `./web/<appName>/`) |
| `intervalSecs` | number | Execution interval in seconds |
| `description` | string | Optional human-readable description |
| `scriptName` | string | Script filename inside the app folder (default: `"cron.agi"`) |

```javascript
requirelib("scheduler");
var ok = scheduler.register("MyApp_DailySync", "MyApp", 86400, "Daily maintenance", "cron.agi");
if (!ok) {
    sendResp("register_failed");
}
```

#### `scheduler.unregister(taskName)` → `bool`

Removes a previously registered task. Returns `true` on success.

```javascript
requirelib("scheduler");
scheduler.unregister("MyApp_DailySync");
```

### Script Location

The cron script must reside inside the webapp's own web folder, **not** in user virtual storage:

```
./web/MyApp/
    init.agi          ← module registration
    index.html
    backend.agi       ← called by the frontend to register/query scheduler
    cron.agi          ← executed by the scheduler at each interval
```

The scheduler calls `cron.agi` with the permissions of the user who approved it, so all file-system and database operations are scoped to that user.

---

## Examples

### Background Scheduler (webapp backend)

A typical webapp has three files that work together to set up a background task.

**`./web/MyApp/backend.agi`** — called from the frontend via `ao_module_agirun`:

```javascript
requirelib("scheduler");

var APP  = "MyApp";           // matches ./web/MyApp/
var TASK = "MyApp_HourlySync";

var action = getPara("action");

if (action === "status") {
    // Report current scheduler state and persisted stats
    var TABLE = "MyApp/" + USERNAME;
    newDBTableIfNotExists(TABLE);
    var lastRun  = readDBItem(TABLE, "lastRun");
    var runCount = parseInt(readDBItem(TABLE, "runCount") || "0", 10);
    sendJSONResp({
        hasPermission: scheduler.hasPermission(),
        registered:    scheduler.registered(TASK, APP),
        lastRun:       lastRun  || null,
        runCount:      runCount
    });

} else if (action === "register") {
    if (!scheduler.hasPermission()) {
        sendResp("no_permission");
    } else if (scheduler.registered(TASK, APP)) {
        sendResp("already_registered");
    } else {
        var ok = scheduler.register(TASK, APP, 3600, "Hourly sync for MyApp");
        sendResp(ok ? "ok" : "error");
    }

} else if (action === "unregister") {
    scheduler.unregister(TASK);
    sendOK();

} else {
    sendJSONResp({error: "unknown action"});
}
```

**`./web/MyApp/cron.agi`** — executed by the scheduler at each interval:

```javascript
// Runs with the permissions of the user who approved the task.
// USERNAME, EXECUTION_ID and all standard globals are available.

var TABLE = "MyApp/" + USERNAME;
newDBTableIfNotExists(TABLE);

// Persist a timestamp and run counter for the frontend to display
writeDBItem(TABLE, "lastRun", new Date().toISOString());
var count = parseInt(readDBItem(TABLE, "runCount") || "0", 10);
writeDBItem(TABLE, "runCount", String(count + 1));

// EXECUTION_ID is a UUIDv4 unique to this invocation — appears in scheduler logs
console.log("MyApp tick [" + EXECUTION_ID + "] user=" + USERNAME + " run=" + (count + 1));

sendOK();
```

**`./web/MyApp/index.html`** — frontend snippet that requests permission and polls stats:

```html
<script src="../script/ao_module.js"></script>
<script>
var APP  = "MyApp";
var TASK = "MyApp_HourlySync";

function checkStatus() {
    ao_module_agirun("MyApp/backend.agi", {action: "status"}, function(data) {
        document.getElementById('last-run').textContent =
            data.lastRun ? new Date(data.lastRun).toLocaleString() : "Never";
        document.getElementById('run-count').textContent = data.runCount;
        if (!data.registered && data.hasPermission) {
            document.getElementById('btn-enable').style.display = '';
        }
    });
}

function enableScheduler() {
    ao_module_requestSchedulerPermission({
        appName:     APP,
        appIcon:     APP + "/img/icon.png",
        taskName:    TASK,
        scriptName:  "cron.agi",   // filename inside ./web/MyApp/
        interval:    3600,         // seconds
        description: "Hourly sync for MyApp."
    }, function(result) {
        if (result && result.allowed) checkStatus();
    });
}

checkStatus();
setInterval(checkStatus, 30000);
</script>
```

This documentation covers all available AGI APIs with practical examples. For more advanced usage, refer to the existing module implementations in the system.
## Notes and Caveats

- `requirelib("audio")` is registered in code but currently has no callable functions.
- `filelib` currently does not expose `writeBinaryFile` / `readBinaryFile` on the public `filelib` object.
- Most APIs return `false` or `null` on failure; many also raise AGI runtime errors.
- For admin-only APIs (`userExists`, `createUser`, `removeUser`), check `userIsAdmin()` first.
