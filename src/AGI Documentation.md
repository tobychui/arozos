# AJGI Documentation

## What is AJGI?
AJGI is the shortform of ArOZ Javascript Gateway Interface.
In simple words, you can add function to your system with JavaScript :)

## Usages
1. Put your js / agi file inside web/* (e.g. ./web/Dummy/backend/test.js)
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

### System Functions
System Functions are AGI functions that can be called anytime (system startup / scheduled task and user request tasks)
The following variables and functions are categorized as system functions.

#### CONST
```
BUILD_VERSION
INTERNVAL_VERSION
LOADED_MODULES
LOADED_STORAGES
```
#### VAR
```
HTTP_RESP
HTTP_HEADER (Default: "text/plain")
```

You can set HTTP_RESP with HTTP_HEADER to create custom response headers.
For example, you can serve an HTML file using agi gateway
```
HTTP_RESP = "<html><body>Hello World</body></html>";
HTTP_HEADER = "text/html";
```

#### Response Handlers
```
sendResp("Any string");
sendJSONResp(JSON.stringify({text: "Hello World"));	//aka send Resp with JSON header

```

#### Database Related
```
newDBTableIfNotExists("tablename");
dropDBTable("tablename");
writeDBItem("tablename", "key", "value");
readDBItem("tablename", "key");
listDBTable("tablename"); //Return key value array
deleteDBItem("tablename", "key");
```

#### Register and Packages
```
registerModule(JSON.stringify(moduleLaunchInfo)); //See moduleLaunchInfo in the sections above
requirepkg("ffmpeg");
execpkg("ffmpeg",'-i "files/users/TC/Desktop/群青.mp3" "files/users/TC/Desktop/群青.flac'); //ffmpeg must be required() before use

```

### User Functions
Users function are function group that only be usable when the interface is started from a user request.

#### CONST
```
USERNAME
```

#### Filepath Virutalization
```
decodeVirtualPath("user:/Desktop");
encodeRealPath("files/users/User/Desktop");
```

#### Permission Related
```
getUserPermissionGroup();
userIsAdmin(); => Return true / false
```

#### Library requirement
You can request other library to be loaded and have extra functions to work with files / images.
```
requirelib("filelib");
```

### filelib
filelib is the core library for users to interact with the local filesystem.

To use any of the library, the agi script must call the requirelib before calling any filelib functions. Example as follows.
```

if (!requirelib("filelib")){
	console.log("Filelib import failed");
}else{
	console.log(filelib.fileExists("user:/Desktop/"));
}
```

#### Filelib functions
```
	filelib.writeFile("user:/Desktop/test.txt", "Hello World"); 		//Write to file
	filelib.readFile("user:/Desktop/test.txt");							//Read from file
	filelib.readdir("user:/Desktop/"); 									//List all subdirectories within this directory
	filelib.walk("user:/Desktop/"); 									//Recursive scan dir and return all files and folder in subdirs
	filelib.glob("user:/Desktop/*.jpg");
	filelib.aglob("user:/Desktop/*.jpg");
	filelib.filesize("user:/Desktop/test.jpg");
	filelib.fileExists("user:/Desktop/test.jpg");
	filelib.isDir("user:/Desktop/NewFolder/");
	filelib.md5("user:/Desktop/test.jpg");
	filelib.mkdir("user/Desktop/NewFolder");	
	filelib.mtime("user:/Desktop/test.jpg"); 							//Get modification time, return unix timestamp
	filelib.rname("user:/Deskop"); 										//Get Rootname, return "User"
```


### ImageLib Functions
A basic image handling library to process images
```
imagelib.getImageDimension("user:/Desktop/test.jpg"); 									//return {width, height}
imagelib.resizeImage("user:/Desktop/input.png", "user:/Desktop/output.png", 500, 300); 	//Resize input.png to 500 x 300 pixal and write to output.png
```

