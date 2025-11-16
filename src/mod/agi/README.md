# ArOZ Online JavaScript Gateway Interface (AGI)

The ArOZ Online JavaScript Gateway Interface (AGI) allows developers to create server-side scripts using JavaScript that can interact with the ArOZ Online system. AGI scripts run in a sandboxed Otto JavaScript VM environment, providing access to system functions while maintaining security.

## Getting Started

### Basic AGI Script Structure

```javascript
// Send a simple response
sendResp("Hello, World!");

// Send JSON response
sendJSONResp({message: "Hello", status: "success"});

// Send OK response
sendOK();
```

### Loading Libraries

```javascript
// Load required libraries
if (requirelib("filelib") == true) {
    // File operations are now available
    var content = filelib.readFile("user:/example.txt");
}
```

## Global Variables

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

## Core Functions

### Response Functions

#### `sendResp(content)`
Sends a response to the client.

```javascript
sendResp("Operation completed successfully");
```

#### `echo(content)`
Appends content to the response.

```javascript
echo("Hello ");
echo("World!"); // Response: "Hello World!"
```

#### `sendOK()`
Sends a simple "ok" response.

```javascript
sendOK(); // Response: "ok"
```

#### `sendJSONResp(object)`
Sends a JSON response.

```javascript
sendJSONResp({
    status: "success",
    data: [1, 2, 3]
});
```

### Database Functions

#### `newDBTableIfNotExists(tableName)`
Creates a new database table if it doesn't exist.

```javascript
if (newDBTableIfNotExists("myapp_settings")) {
    echo("Table created successfully");
}
```

#### `DBTableExists(tableName)`
Checks if a database table exists.

```javascript
if (DBTableExists("user_preferences")) {
    echo("Table exists");
}
```

#### `writeDBItem(tableName, key, value)`
Writes a key-value pair to a database table.

```javascript
writeDBItem("settings", "theme", "dark");
```

#### `readDBItem(tableName, key)`
Reads a value from a database table.

```javascript
var theme = readDBItem("settings", "theme");
if (theme) {
    echo("Current theme: " + theme);
}
```

#### `listDBTable(tableName)`
Lists all key-value pairs in a table.

```javascript
var settings = listDBTable("settings");
echo(JSON.stringify(settings));
```

#### `deleteDBItem(tableName, key)`
Deletes a key-value pair from a table.

```javascript
deleteDBItem("settings", "old_key");
```

#### `dropDBTable(tableName)`
Drops an entire database table.

```javascript
dropDBTable("temporary_data");
```

### Module Management

#### `registerModule(jsonConfig)`
Registers a module with the system.

```javascript
var moduleConfig = {
    Name: "MyApp",
    Desc: "My custom application",
    Group: "Utilities",
    IconPath: "MyApp/icon.png",
    Version: "1.0",
    StartDir: "MyApp/index.html",
    SupportFW: true,
    LaunchFWDir: "MyApp/index.html",
    SupportEmb: true,
    LaunchEmb: "MyApp/embedded.html",
    InitFWSize: [800, 600],
    InitEmbSize: [400, 300],
    SupportedExt: [".txt", ".md"]
};

registerModule(JSON.stringify(moduleConfig));
```

#### `addNightlyTask(scriptPath)`
Adds a script to run nightly.

```javascript
addNightlyTask("MyApp/tasks/backup.js");
```

## User Management Functions

### Permission Functions

#### `pathCanWrite(virtualPath)`
Checks if the current user can write to a path.

```javascript
if (pathCanWrite("user:/documents/")) {
    echo("Can write to documents folder");
}
```

#### `getUserPermissionGroup()`
Gets the current user's permission group information.

```javascript
var groupInfo = JSON.parse(getUserPermissionGroup());
echo("User group: " + groupInfo.name);
```

#### `userIsAdmin()`
Checks if the current user is an administrator.

```javascript
if (userIsAdmin()) {
    echo("User is admin");
}
```

### User Account Functions

#### `userExists(username)`
Checks if a user exists (admin only).

```javascript
if (userExists("john_doe")) {
    echo("User exists");
}
```

#### `createUser(username, password, defaultGroup)`
Creates a new user account (admin only).

```javascript
if (createUser("newuser", "password123", "users")) {
    echo("User created successfully");
}
```

#### `removeUser(username)`
Removes a user account (admin only).

```javascript
if (removeUser("olduser")) {
    echo("User removed successfully");
}
```

### Script Execution

#### `execd(scriptPath, payload)`
Executes another script asynchronously with optional payload.

```javascript
execd("MyApp/worker.js", "process_data");
```

## File Library (`filelib`)

Load with: `requirelib("filelib")`

### File Operations

#### `filelib.writeFile(virtualPath, content)`
Writes content to a file.

```javascript
filelib.writeFile("user:/notes.txt", "Hello, World!");
```

#### `filelib.readFile(virtualPath)`
Reads content from a file.

```javascript
var content = filelib.readFile("user:/notes.txt");
echo(content);
```

#### `filelib.deleteFile(virtualPath)`
Deletes a file.

```javascript
filelib.deleteFile("user:/temp.txt");
```

### Directory Operations

#### `filelib.mkdir(virtualPath)`
Creates a directory.

```javascript
filelib.mkdir("user:/newfolder");
```

#### `filelib.readdir(virtualPath, sortMode)`
Lists directory contents.

```javascript
var files = filelib.readdir("user:/documents", "name");
// Returns array of file objects
```

### File Information

#### `filelib.fileExists(virtualPath)`
Checks if a file exists.

```javascript
if (filelib.fileExists("user:/config.json")) {
    echo("Config file exists");
}
```

#### `filelib.isDir(virtualPath)`
Checks if path is a directory.

```javascript
if (filelib.isDir("user:/documents")) {
    echo("Is a directory");
}
```

#### `filelib.filesize(virtualPath)`
Gets file size in bytes.

```javascript
var size = filelib.filesize("user:/largefile.zip");
echo("File size: " + size + " bytes");
```

#### `filelib.mtime(virtualPath)`
Gets file modification time.

```javascript
var mtime = filelib.mtime("user:/document.txt");
echo("Modified: " + mtime);
```

#### `filelib.md5(virtualPath)`
Calculates MD5 hash of a file.

```javascript
var hash = filelib.md5("user:/important.doc");
echo("MD5: " + hash);
```

### File Searching

#### `filelib.walk(virtualPath, mode)`
Recursively walks a directory.

```javascript
// List all files recursively
var allFiles = filelib.walk("user:/documents", "file");

// List all directories recursively
var allDirs = filelib.walk("user:/documents", "folder");

// List everything
var everything = filelib.walk("user:/documents", "all");
```

#### `filelib.glob(pattern)`
Finds files matching a pattern.

```javascript
var txtFiles = filelib.glob("user:/documents/*.txt");
```

#### `filelib.aglob(pattern)`
Finds files with advanced pattern matching.

```javascript
var jsFiles = filelib.aglob("user:/**/*.js");
```

## Image Library (`imagelib`)

Load with: `requirelib("imagelib")`

### Image Information

#### `imagelib.getImageDimension(imagePath)`
Gets image dimensions.

```javascript
var dimensions = imagelib.getImageDimension("user:/photo.jpg");
// Returns: {width: 1920, height: 1080}
```

#### `imagelib.hasExif(imagePath)`
Checks if image has EXIF data.

```javascript
if (imagelib.hasExif("user:/photo.jpg")) {
    echo("Image has EXIF data");
}
```

#### `imagelib.getExif(imagePath)`
Extracts EXIF data from image.

```javascript
var exif = JSON.parse(imagelib.getExif("user:/photo.jpg"));
echo("Camera: " + exif.Make);
```

### Image Processing

#### `imagelib.resizeImage(inputPath, outputPath, width, height)`
Resizes an image.

```javascript
imagelib.resizeImage("user:/photo.jpg", "user:/photo_small.jpg", 800, 600);
```

#### `imagelib.cropImage(inputPath, outputPath, x, y, width, height)`
Crops an image.

```javascript
imagelib.cropImage("user:/photo.jpg", "user:/photo_crop.jpg", 100, 100, 500, 500);
```

#### `imagelib.loadThumbString(imagePath, size)`
Generates a base64 thumbnail.

```javascript
var thumbnail = imagelib.loadThumbString("user:/photo.jpg", 200);
echo("<img src='data:image/jpeg;base64," + thumbnail + "' />");
```

## HTTP Library (`http`)

Load with: `requirelib("http")`

### HTTP Requests

#### `http.get(url)`
Makes a GET request.

```javascript
var response = http.get("https://api.example.com/data");
echo(response);
```

#### `http.post(url, jsonData)`
Makes a POST request with JSON data.

```javascript
var data = JSON.stringify({name: "John", age: 30});
var response = http.post("https://api.example.com/users", data);
```

#### `http.head(url)`
Makes a HEAD request.

```javascript
var headers = http.head("https://example.com");
```

### Advanced HTTP Functions

#### `http.download(url, savePath)`
Downloads a file from URL.

```javascript
http.download("https://example.com/file.zip", "user:/downloads/file.zip");
```

#### `http.getb64(url)`
Gets response as base64.

```javascript
var b64data = http.getb64("https://example.com/image.png");
```

#### `http.getCode(url)`
Gets HTTP status code.

```javascript
var statusCode = http.getCode("https://example.com");
if (statusCode == 200) {
    echo("Site is up");
}
```

#### `http.redirect(url, statusCode)`
Redirects the client to another URL.

```javascript
http.redirect("https://example.com/newpage", 302);
```

## Share Library (`share`)

Load with: `requirelib("share")`

### File Sharing

#### `share.shareFile(virtualPath, timeout)`
Shares a file and returns share UUID.

```javascript
var shareId = share.shareFile("user:/document.pdf", 3600); // 1 hour timeout
echo("Share URL: /share/" + shareId);
```

#### `share.removeShare(shareUUID)`
Removes a file share.

```javascript
share.removeShare("share-uuid-here");
```

### Share Information

#### `share.checkShareExists(shareUUID)`
Checks if a share exists.

```javascript
if (share.checkShareExists("share-uuid")) {
    echo("Share exists");
}
```

#### `share.fileIsShared(virtualPath)`
Checks if a file is shared.

```javascript
if (share.fileIsShared("user:/document.pdf")) {
    echo("File is shared");
}
```

#### `share.getFileShareUUID(virtualPath)`
Gets the share UUID for a file.

```javascript
var shareId = share.getFileShareUUID("user:/document.pdf");
if (shareId) {
    echo("Share ID: " + shareId);
}
```

#### `share.checkSharePermission(shareUUID)`
Gets share permission level.

```javascript
var permission = share.checkSharePermission("share-uuid");
// Returns permission level (read/write/etc)
```

## IoT Library (`iot`)

Load with: `requirelib("iot")`

### Device Discovery

#### `iot.scan()`
Scans for available IoT devices.

```javascript
var devices = iot.scan();
// Returns array of device objects
```

#### `iot.list()`
Lists cached IoT devices.

```javascript
var devices = iot.list();
```

### Device Control

#### `iot.connect(deviceId, username, password, token)`
Connects to an IoT device.

```javascript
if (iot.connect("device123", "admin", "password", "")) {
    echo("Connected to device");
}
```

#### `iot.disconnect(deviceId)`
Disconnects from an IoT device.

```javascript
iot.disconnect("device123");
```

#### `iot.exec(deviceId, endpoint, payload)`
Executes a command on an IoT device.

```javascript
var result = iot.exec("device123", "set_temperature", {value: 25});
```

#### `iot.status(deviceId)`
Gets device status.

```javascript
var status = iot.status("device123");
```

### Utility Functions

#### `iot.ready()`
Checks if IoT system is ready.

```javascript
if (iot.ready()) {
    echo("IoT system ready");
}
```

#### `iot.iconTag(deviceId)`
Gets device icon tag.

```javascript
var iconTag = iot.iconTag("device123");
```

## Appdata Library (`appdata`)

Load with: `requirelib("appdata")`

### Read-Only Web Data Access

#### `appdata.readFile(relativePath)`
Reads a file from the web root.

```javascript
var config = appdata.readFile("MyApp/config.json");
var configObj = JSON.parse(config);
```

#### `appdata.listDir(relativePath)`
Lists contents of a web directory.

```javascript
var files = JSON.parse(appdata.listDir("MyApp/templates"));
for (var i = 0; i < files.length; i++) {
    echo("File: " + files[i]);
}
```

## FFmpeg Library (`ffmpeg`)

Load with: `requirelib("ffmpeg")`

### Media Conversion

#### `ffmpeg.convert(inputPath, outputPath, compression)`
Converts media files using FFmpeg.

```javascript
// Convert video to different format
ffmpeg.convert("user:/video.mp4", "user:/video.webm", 0);

// Convert with compression
ffmpeg.convert("user:/audio.wav", "user:/audio.mp3", 5);
```

## WebSocket Library (`websocket`)

Load with: `requirelib("websocket")`

### WebSocket Connection

#### `websocket.upgrade(timeout)`
Upgrades HTTP connection to WebSocket.

```javascript
if (websocket.upgrade(300)) { // 5 minute timeout
    echo("WebSocket upgraded");
}
```

#### `websocket.send(message)`
Sends a message through WebSocket.

```javascript
websocket.send("Hello from server!");
```

#### `websocket.read()`
Reads a message from WebSocket.

```javascript
var message = websocket.read();
if (message) {
    echo("Received: " + message);
}
```

#### `websocket.close()`
Closes the WebSocket connection.

```javascript
websocket.close();
```

## Serverless Functions

These functions are available when AGI scripts are called via HTTP requests.

### Request Information

#### `REQ_METHOD`
HTTP request method.

```javascript
echo("Request method: " + REQ_METHOD);
```

### Parameter Access

#### `getPara(key)`
Gets a GET parameter.

```javascript
var username = getPara("username");
if (username) {
    echo("Hello, " + username);
}
```

#### `postPara(key)`
Gets a POST parameter.

```javascript
var password = postPara("password");
```

#### `readBody()`
Reads the raw request body.

```javascript
var rawData = readBody();
var data = JSON.parse(rawData);
```

## Error Handling

AGI scripts should handle errors appropriately:

```javascript
try {
    var content = filelib.readFile("user:/file.txt");
    if (content === false) {
        sendJSONResp({error: "File not found"});
    } else {
        sendJSONResp({content: content});
    }
} catch (e) {
    sendJSONResp({error: "Script error: " + e.message});
}
```

## Security Considerations

- All file operations are sandboxed to user-accessible paths
- Database operations are restricted to non-reserved tables
- User management functions require admin privileges
- External HTTP requests should be validated
- File uploads should check size limits and types

## Examples

### Complete File Upload Handler

```javascript
// Load required libraries
requirelib("filelib");

// Get uploaded file info from POST parameters
var filename = postPara("filename");
var filedata = postPara("filedata");

if (filename && filedata) {
    // Decode base64 data
    var decodedData = atob(filedata);
    
    // Save to user directory
    var savePath = "user:/uploads/" + filename;
    if (filelib.writeFile(savePath, decodedData)) {
        sendJSONResp({
            status: "success",
            message: "File uploaded successfully",
            path: savePath
        });
    } else {
        sendJSONResp({
            status: "error",
            message: "Failed to save file"
        });
    }
} else {
    sendJSONResp({
        status: "error",
        message: "Missing filename or filedata"
    });
}
```

### User Settings Manager

```javascript
// Load file library
requirelib("filelib");

// Create settings table if not exists
newDBTableIfNotExists("user_settings");

// Handle different actions
var action = getPara("action");

if (action === "get") {
    var key = getPara("key");
    var value = readDBItem("user_settings", key);
    sendJSONResp({value: value});
    
} else if (action === "set") {
    var key = postPara("key");
    var value = postPara("value");
    writeDBItem("user_settings", key, value);
    sendJSONResp({status: "saved"});
    
} else if (action === "list") {
    var settings = listDBTable("user_settings");
    sendJSONResp(settings);
    
} else {
    sendJSONResp({error: "Invalid action"});
}
```

This documentation covers all available AGI APIs with practical examples. For more advanced usage, refer to the existing module implementations in the system.