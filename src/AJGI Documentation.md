# AJGI Documentation

## What is AJGI?
AJGI is the shortform of ArOZ Javascript Gateway Interface.
In simple words, you can add function to your system with JavaScript :)

## Usages
1. Put your js file inside web/* (e.g. ./web/Dummy/backend/test.js)
2. Load your script by calling / ajax request to ```/system/ajgi/interface?script={yourfile}.js```, (e.g. /system/ajgi/interface?script=Dummy/backend/test.js)
3. Wait for the reponse from the script by calling sendResp in the script

## Module Init Script
To initialize a module without a main.go function call, you can create a "init.agi" script in your module root under ./web/myModule where "myModule" is your module name.

To register the module, you can call to the "registerModule" function with JSON stringify module launch info following the following example JavaScript Object.

```
//Define the launchInfo for the module
var moduleLaunchInfo = {
	Name: "NotepadA",
	Desc: "The best code editor on ArOZ Online",
	Group: "Office",
	IconPath: "NotepadA/img/module_icon.png",
	Version: "1.2",
	StartDir: "NotepadA/index.html",
	SupportFW: true,
	LaunchFWDir: "NotepadA/index.html",
	SupportEmb: true,
	LaunchEmb: "NotepadA/embedded.html",
	InitFWSize: [1024, 768],
	InitEmbSize: [360, 200],
	SupportedExt: [".bat",".coffee",".cpp",".cs",".csp",".csv",".fs",".dockerfile",".go",".html",".ini",".java",".js",".lua",".mips",".md", ".sql",".txt",".php",".py",".ts",".xml",".yaml"]
}

//Register the module
registerModule(JSON.stringify(moduleLaunchInfo));

```

You might also create the database table in this section of the code. For example:

```
//Create database for this module
newDBTableIfNotExists("myModule")
```

## APIs

### Basics
#### Response to request
In order for the script to return something to the screen / caller as JSON / TEXT response, 
one of these functions has to be called.

```
sendResp(string)	=> Response header with text/plain header
sendJSONResp(json_string) => Response request with JSON header
```

Customize header:

You can also use customized header in return string as follow.

```
//Set Response header to html
HTTP_HEADER = "text/html; charset=utf-8";

//Send Response
sendResp("<p>你好世界！</p>");
```

#### Register Module to module list
You can call to the following function to register your module to the system module list. It is recommended that you register your module during the startup process (in the init.agi script located in your module root)

Example Usage: 
```
registerModule(JSON.stringify(moduleInfo));

```

Module Info defination
```
//DO NOT USE THIS IN CODE. THIS IS A DATATYPE REPRESENTATION ONLY
//PLEASE SEE THE INIT SECTION FOR A REAL OBJECT EXAMPLE
moduleInfo = {
	Name string					//Name of this module. e.g. "Audio"
	Desc string					//Description for this module
	Group string				//Group of the module, e.g. "system" / "media" etc
	IconPath string				//Module icon image path e.g. "Audio/img/function_icon.png"
	Version string				//Version of the module. Format: [0-9]*.[0-9][0-9].[0-9]
	StartDir string 			//Default starting dir, e.g. "Audio/index.html"
	SupportFW bool 				//Support floatWindow. If yes, floatWindow dir will be loaded
	LaunchFWDir string 			//This link will be launched instead of 'StartDir' if fw mode
	SupportEmb bool				//Support embedded mode
	LaunchEmb string 			//This link will be launched instead of StartDir / Fw if a file is opened with this module
	InitFWSize [int, int] 		//Floatwindow init size. [0] => Width, [1] => Height
	InitEmbSize [int, int]		//Embedded mode init size. [0] => Width, [1] => Height
	SupportedExt string_array 	//Supported File Extensions. e.g. ".mp3", ".flac", ".wav"
}
```

#### Print to STDOUT (console)
To print something for debug, you can print text directly to ArOZ Online Core terminal using

```
console.log("text");
```

It has the same effect as using fmt.Println in golang.

#### Delayed operations
For delayed / timer ticking operations like setTimeout or setInterval is currently not supported.

### Filepaths

Translate between realPath and virtualPath
```
decodeVirtualPath(virtualPath) => realPath
encodeRealPath(realPath) => virtualPath

```

Example:
```
console.log("Testing Multiline Javascript");

function getRealPath(path){
	return decodeVirtualPath(path);
}

sendJSONResp(JSON.stringify(getRealPath("user:/Desktop").split("/")));

```

### Permission Related
Get the permission of the current user

```
getUserPermissionGroup() => Return user permission group
userIsAdmin() => Check if user is admin. Return true or false only.
```

Example:
```
console.log("User Permission Checking");
var permissionGroup = getUserPermissionGroup();
if (userIsAdmin() == true){
	sendResp("This user is admin with group = " + permissionGroup);
}else{
	sendResp("This user not admin with group = " + permissionGroup);
}
```

### Database Access
To access the database in your script, you can call to the following functions
Please be ware that the database used in ArOZ Online System is a key-value database.
No SQL can be used in the db access.

```
newDBTableIfNotExists("myTable") => Create a new table with name "myTable"
dropDBTable("myTable") => Drop the "myTable" table
writeDBItem(tablename, key, value) => return true when succeed
readDBItem(tablename, key) => return value in string

```

Example:
```
console.log("Testing Database API");
if (newDBTableIfNotExists("testdb")){
	if (writeDBItem("testdb","message","Hello World")){
		//Test suceed. Set Response message to the message
		sendResp("Database access return value: " + readDBItem("testdb","message"));
		//Drop the table after testing
		dropDBTable("testdb");
		console.log("Testdb table dropped");
	}else{
		sendResp("Failed to write to db");
	}
	
}else{
	sendResp("Failed creating new db");
}

```

### File Read Write
To read or write a file, you can pass in the file's virtualPath and use the following APIs

```
writeFile(virtualFilepath, content) => return true/false when succeed / failed
readFile(virtualFilepath) => return content in string
```

Example:
```
console.log("File Read Write Test");
if (writeFile("user:/Desktop/test.txt","Hello World! This is a testing message to write")){
	//Write file succeed.
	var fileContent = readFile("user:/Desktop/test.txt");
	sendResp("File content: " + fileContent);
}else{
	SendResp("Failed to write file");
}
```

### Directory Listing
If you want to list a given directory, you can use the following APIs with given virtualPath
```
glob(globpath_string) => return fileList in array
aglob(path_string) => Using file system special Glob for scanning
readdir(path_string) => return filelist in array
```

*For glob function, wildcard are only supported in the filename instead of the whole path.*
```
//Valid glob path:
glob("user:/Desktop/*.mp3");

//Invalid glob path:
glob("user:/*/*.mp3");
```

Example glob:
```
var fileList = glob("user:/Desktop/*.mp3");
sendJSONResp(JSON.stringify(fileList));
```

Example readdir:
```
var fileList = readdir("user:/Desktop/");
sendJSONResp(JSON.stringify(fileList));
```

### File utils
Some helpful functions for handling files status
```
fileExists(virtualPath);	=> Return true / false
filesize(virtualPath);		=> Return filesize in bytes
isDir(virtualPath);         => Return true if the given path is a directory, false otherwise

```

Example:
```
console.log('Testing get filesize');

//Help function for converting byte to human readable format
function bytesToSize(bytes) {
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes == 0) return '0 Byte';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
   return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}


//Get all the files filesize on desktop
var fileList = glob("user:/Desktop/*.*");
var results = [];
for (var i =0; i < fileList.length; i++){
	var filename = fileList[i].split("/").pop();
	var fileSize = filesize(fileList[i]);
	results.push({
		filename: filename,
		filesize: bytesToSize(fileSize)
	});
	
}
sendJSONResp(JSON.stringify(results));
```

### Package / Library Related Functions
Require package for the current module 
```
requirepkg(package_name, requireComply) => [string, boolean]
requirelib(library name)                => [boolean]
```

Example
```
//This will "crash" the server if installation failed as requireComply=true
requirepkg("ffmpeg",true);
sendResp("FFMPEG installed");

//This will require the imagelib and return true on success load.
var loaded = requirelib("imagelib");
if (loaded){
    console.log("Library loaded");
}else{
    console.log("Library load failed");
}

```

## Libraries
External libraries are supported for extending the functionality of agi gateway script. 
Library native code functions must be created using _{libname}_{function name} and wrap inside an object
with the same name of the library name. Here is an example

```
//Defination
vm.Set("_imagelib_getImageDimension", func(call otto.FunctionCall) otto.Value {
//....

//End of initiation
vm.Run(`
    var imagelib = {};
    imagelib.getImageDimension = _imagelib_getImageDimension;
`);

```

### Image Processing Library
Get Image Dimension with virtual path
```
imagelib.getImageDimension(imagePath)   => [width, height]
```

Example

```
console.log("Image Properties Access Test");
//To test this, put a test.jpg on your desktop
var imagePath = "user:/Desktop/test.jpeg";

//Require the image library
var loaded = requirelib("imagelib");
if (loaded) {
    //Library loaded. Call to the functions
    var dimension = imagelib.getImageDimension(imagePath);
    sendJSONResp(JSON.stringify(dimension));
} else {
    console.log("Failed to load lib: imagelib");
}
```

Resize image to the given size
(Set width or height to 0 for auto scaling)

```
imagelib.resizeImage(srcPath, destPath, 200, 0);    => [boolean]
```

Example
```
console.log("Image Resizing Test");
//To test this, put a test.jpg on your desktop
var srcPath = "user:/Desktop/test.jpg";
var destPath = "user:/Desktop/output.jpg";

//Require the image library
var loaded = requirelib("imagelib");
if (loaded) {
    //Library loaded. Call to the functions
    var success = imagelib.resizeImage(srcPath, destPath, 200, 0);
	if (success){
		sendResp("OK")
	}else{
		sendResp("Failed to resize image");
	}
} else {
    console.log("Failed to load lib: imagelib");
}
```
