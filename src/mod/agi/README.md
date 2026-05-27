# ArOZ Online JavaScript Gateway Interface (AGI)

AGI is the server-side JavaScript runtime used by ArozOS for module scripts (`.agi` / `.js`).
Scripts run in an Otto VM with sandboxed access to ArozOS functions.

This document is updated to match the current AGI implementation in `mod/agi/agi*.go`.

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
- `ziplib`
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

Load:

```javascript
requirelib("websocket");
```

This library is only available in request handlers with active HTTP request/response context.

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

### Complete File Upload Handler
### `websocket.upgrade(timeoutSec)`
Upgrades current HTTP request to WebSocket. Default timeout is 300 seconds.

```javascript
if (!websocket.upgrade(300)) exit();
```

### `websocket.send(text)`
```javascript
websocket.send("hello client");
```

### `websocket.read()`
Returns incoming message string, or `false` when closed.

```javascript
var msg = websocket.read();
```

### `websocket.close()`
```javascript
websocket.close();
```

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
