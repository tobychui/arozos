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

## Application Examples
See web/UnitTest/backend/*.js for more information on how to use AGI in webapps.

For subservice, see subservice/demo/agi/ for more examples.


### Access From Frontend
To access server functions from front-end (e.g. You are building a serverless webapp on top of arozos), you can call to the ao_module.js function for running an agi script located under ```./web``` directory. You can find the ao_module.js wrapper under ```./web/script/```

Here is an example extracted from Music module for listing files nearby the openeing music file.

./web/Music/embedded.html
```
ao_module_agirun("Music/functions/getMeta.js", {
	file: encodeURIComponent(playingFileInfo.filepath)
}, function(data){
	songList = data;
	for (var i = 0; i < data.length; i++){
		//Do something here
	}
});


```

./web/Music/functions/getMeta.js
```
//Define helper functions
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
 }

//Main Logic
if (requirelib("filelib") == true){
    //Get the filename from paramters
    var openingFilePath = decodeURIComponent(file);
    var dirname = openingFilePath.split("/")
    dirname.pop()
    dirname = dirname.join("/");

    //Scan nearby files
    var nearbyFiles = filelib.aglob(dirname + "/*") //aglob must be used here to prevent errors for non-unicode filename
    var audioFiles = [];
    var supportedFormats = [".mp3",".flac",".wav",".ogg",".aac",".webm",".mp4"];
    //For each nearby files
    for (var i =0; i < nearbyFiles.length; i++){
        var thisFile = nearbyFiles[i];
        var ext = thisFile.split(".").pop();
        ext = "." + ext;
        //Check if the file extension is in the supported extension list
        for (var k = 0; k < supportedFormats.length; k++){
            if (filelib.isDir(nearbyFiles[i]) == false && supportedFormats[k] == ext){
                var fileExt = ext.substr(1);
                var fileName = thisFile.split("/").pop();
                var fileSize = filelib.filesize(thisFile);
                var humanReadableFileSize = bytesToSize(fileSize);

                var thisFileInfo = [];
                thisFileInfo.push(fileName);
                thisFileInfo.push(thisFile);
                thisFileInfo.push(fileExt);
                thisFileInfo.push(humanReadableFileSize);
                
                audioFiles.push(thisFileInfo);
                break;
            }
        }
    }
    sendJSONResp(JSON.stringify(audioFiles));
}

```

### Access from Subservice Backend
It is also possible to access the AGI gateway from subservice backend.
You can include aroz library from ```./subservice/demo/aroz``` . The following is an example extracted from demo subservice that request access to your desktop filelist.

```
package main
import (
	aroz "your/package/name/aroz"
)

var handler *aroz.ArozHandler

//...

func main(){
	//Put other flags here

	//Start subservice pipeline and flag parsing (This function call will also do flag.parse())
	handler = aroz.HandleFlagParse(aroz.ServiceInfo{
		Name: "Demo Subservice",
		Desc: "A simple subservice code for showing how subservice works in ArOZ Online",			
		Group: "Development",
		IconPath: "demo/icon.png",
		Version: "0.0.1",
		//You can define any path before the actualy html file. This directory (in this case demo/ ) will be the reverse proxy endpoint for this module
		StartDir: "demo/home.html",			
		SupportFW: true, 
		LaunchFWDir: "demo/home.html",
		SupportEmb: true,
		LaunchEmb: "demo/embedded.html",
		InitFWSize: []int{720, 480},
		InitEmbSize: []int{720, 480},
		SupportedExt: []string{".txt",".md"},
	});

	//Start Web server with handler.Port
	http.ListenAndServe(handler.Port, nil)
}


//Access AGI Gateway from Golang
func agiGatewayTest(w http.ResponseWriter, r *http.Request){
	//Get username and token from request
	username, token := handler.GetUserInfoFromRequest(w,r)
	log.Println("Received request from: ", username, " with token: ", token)

	//Create an AGI Call that get the user desktop files
	script := `
		if (requirelib("filelib")){
			var filelist = filelib.glob("user:/Desktop/*")
			sendJSONResp(JSON.stringify(filelist));
		}else{
			sendJSONResp(JSON.stringify({
				error: "Filelib require failed"
			}));
		}
	`

	//Execute the AGI request on server side
	resp,err := handler.RequestGatewayInterface(token, script)
	if err != nil{
		//Something went wrong when performing POST request
		log.Println(err)
	}else{
		//Try to read the resp body
		bodyBytes, err := ioutil.ReadAll(resp.Body)
		if err != nil{
			log.Println(err)
			w.Write([]byte(err.Error()))
			return
		}
		resp.Body.Close()

		//Relay the information to the request using json header
		//Or you can process the information within the go program
		w.Header().Set("Content-Type", "application/json")
		w.Write(bodyBytes)

	}
}

```



## APIs

### Basics
#### Response to request
In order for the script to return something to the screen / caller as JSON / TEXT response, 
one of these functions has to be called.

```
sendResp(string)	=> Response header with text/plain header
sendJSONResp(json_string) => Response request with JSON header

//Since v1.119
sendJSONResp(object) => Overload function, allow the same API to send Javascript object directly without the need for manual stringify using JSON.stringify
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

Synchronized delay (or blocking delay) can be used with the delay function (ms)

```
delay(5000);
```

For async delayed / timer ticking operations like setTimeout or setInterval is currently not supported.

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

#### Structure & OOP
```
includes("hello world.js"); //Include another js / agi file within the current running one, return false if failed
```

### User Functions
Users function are function group that only be usable when the interface is started from a user request.

#### CONST
```
USERNAME
USERICON
USERQUOTA_TOTAL
USERQUOTA_USED

//Since AGI 1.3
USER_VROOTS
USER_MODULES //Might return ["*"] for admin permission
```

#### Filepath Virtualization
```
decodeVirtualPath("user:/Desktop"); //Convert virtual path (e.g. user:/Desktop) to real path (e.g. ./files/user/username/Desktop)
decodeAbsoluteVirtualPath("user:/Desktop"); //Same as decodeVirtualPath but return in absolute path instead of relative path from the arozos binary root
encodeRealPath("files/users/User/Desktop"); //Convert realpath into virtual path
```

#### Permission Related
```
getUserPermissionGroup();
userIsAdmin(); => Return true / false
```

#### User Creation, Edit and Removal
All the command in this section require administrator permission. To check if user is admin, use ``` userIsAdmin() ```.

```
userExists(username);
createUser(username, password, defaultGroup);	//defaultGroup must be one of the permission group that exists in the system
removeUser(username); //Return true if success, false if failed
```

#### Library requirement
You can request other library to be loaded and have extra functions to work with files / images.
```
requirelib("filelib");
```



#### Include other script files

You can also include another js file to load shared code between scripts

```
includes("hello world.js")
```



### Execute tasks in another routine

You can use the execd function to execute something that is long pulling after the main thread returned the results of the current calculation.

```
 execd("execd.js", "Payload to child")
```

To check if the current script is being executed as routine process, check for the following variable.

```
if (typeof PARENT_DETACHED == 'undefined'){
    //This is parent
}else if (PARENT_DETACHED == true){
    //This is child
}
```

To get the payload in child routine, get the following variable (Default: empty string)

```
PARENT_PAYLOAD
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
	filelib.deleteFile("user:/Desktop/test.txt"); 						//Delete a file by given path
	filelib.readdir("user:/Desktop/"); 									//List all subdirectories within this directory
	filelib.walk("user:/Desktop/"); 									//Recursive scan dir and return all files and folder in subdirs
	filelib.glob("user:/Desktop/*.jpg", "smallToLarge");
	filelib.aglob("user:/Desktop/*.jpg", "user");
	filelib.filesize("user:/Desktop/test.jpg");
	filelib.fileExists("user:/Desktop/test.jpg");
	filelib.isDir("user:/Desktop/NewFolder/");
	filelib.md5("user:/Desktop/test.jpg");
	filelib.mkdir("user/Desktop/NewFolder");	
	filelib.mtime("user:/Desktop/test.jpg", true); 							//Get modification time, return unix timestamp. Set the 2nd paramter to false for human readble format
	filelib.rname("user:/Deskop"); 										//Get Rootname, return "User"
```

##### Special sorting mode for glob and aglob

For glob and aglob, developer can pass in the following sorting modes (case sensitive)

- default
- reverse
- smallToLarge
- largeToSmall
- mostRecent
- leastRecent
- smart (Added in v1.119, AGI only, for sorting filename containing digits with no zero pads)

```
//Example for sorting the desktop files to largeToSmall
filelib.aglob("user:/Desktop/*", "largeToSmall");
```

To use the user default option which user has set in File Manager WebApp, pass in "user". Default sorting method is "default"

```
//Example of using user's selected mode
filelib.aglob("user:/Desktop/*.jpg", "user");
```

### appdata

An API for access files inside the web folder. This API only provide read only functions. Include the appdata lib as follows.

```
requirelib("appdata");
```

#### appdata functions

```
appdata.readFile("UnitTest/appdata.txt"); //Return false (boolean) if read failed
appdata.listDir("UnitTest/backend/"); //Return a list of files in JSON string
```



### imagelib

A basic image handling library to process images. Allowing basic image resize,
get image dimension and others (to be expanded)


```
//Include the library
requirelib("imagelib");
```

#### ImageLib functions
```
imagelib.getImageDimension("user:/Desktop/test.jpg"); 									//return [width, height]
imagelib.resizeImage("user:/Desktop/input.png", "user:/Desktop/output.png", 500, 300); 	//Resize input.png to 500 x 300 pixal and write to output.png
imagelib.loadThumbString("user:/Desktop/test.jpg"); //Load the given file's thumbnail as base64 string, return false if failed
imagelib.cropImage("user:/Desktop/test.jpg", "user:/Desktop/out.jpg",100,100,200,200)); 
//Classify an image using neural network, since v1.119
imagelib.classify("tmp:/classify.jpg", "yolo3"); 

```

#### Crop Image Options

```
Crop the given image with the following arguemnts: 

1) Input file (virtual path)
2) Output file (virtual path, will be overwritten if exists)
3) Position X
4) Position Y
5) Crop With
6) Crop Height

return true if success, false if failed
```



#### AI Classifier Options (since v1.119)

**ImageLib AI Classifier requires darknet to operate normally. If your ArozOS is a trim down version or using a host architecture that ArozOS did not ship with a valid darknet binary executable in ```system/neuralnet/``` folder, this will always return```false```.**

```
Classify allow the following classifier options

1) default / darknet19
2) yolo3
```

The output of the classifier will output the followings

```
Name (string, the name of object detected)
Percentage (float, the confidence of detection)
Positions (integer array, the pixel location of the detected object in left, top, width, height sequence)
```

Here is an example code for parsing the output, or you can also directly throw it into the JSON stringify and process it on frontend

```javascript
 var results = imagelib.classify("tmp:/classify.jpg"); 
    var responses = [];
    for (var i = 0; i < results.length; i++){
        responses.push({
            "object": results[i].Name,
            "confidence": results[i].Percentage,
            "position_x": results[i].Positions[0],
            "position_y": results[i].Positions[1],
            "width": results[i].Positions[2],
            "height": results[i].Positions[3]
        });
    }
```



### http

A basic http function group that allow GET / POST / HEAD / Download request to other web resources

```
//Include the library
requirelib("http");
```

#### http functions
```
http.get("http://example.com/api/"); //Create a get request, return the respond body
http.post("http://localhost:8080/system/file_system/listDir", JSON.stringify({
    dir: "user:/Desktop",
    sort: "default"
}));	//Create a POST request with JSON payload
http.head("http://localhost:8080/", "Content-Type"); //Get the header field "Content-Type" from the requested url, leave 2nd paramter empty to return the whole header in JSON string
http.download("http://example.com/music.mp3", "user:/Desktop", "(Optional) My Music.mp3")

```

### websocket

websocket library provide request upgrade from normal HTTP request to WebSocket connections. 

```
//Include the library
requirelib("websocket");
```

#### websocket functions

```
websocket.upgrade(10); //Timeout value in integer, return false if failed
var recv = websocket.read(); //Blocking websocket listen
websocket.send("Hello World"); //Send websocket to client (web UI)
websocket.close(); //Close websocket connection
```



#### Usage Example

Font-end

```
function getWSEndpoint(){
    //Open opeartion in websocket
    let protocol = "wss://";
    if (location.protocol !== 'https:') {
    protocol = "ws://";
    }
    wsControlEndpoint = (protocol + window.location.hostname + ":" + window.location.port);
    return wsControlEndpoint;
}
            
let socket = new WebSocket(getWSEndpoint() + "/system/ajgi/interface?script=UnitTest/special/websocket.js");

socket.onopen = function(e) {
	log("✔️ Socket Opened");
};

socket.onmessage = function(event) {
	log(`✔️ Received: ${event.data}`);
};

socket.onclose = function(event) {
    if (event.wasClean) {
    log(`📪 Connection Closed Cleanly code=${event.code} reason=${event.reason}`);
    } else {
    // e.g. server process killed or network down
    // event.code is usually 1006 in this case
    log(`❌ Connection Closed Unexpectedly`);
    }
};

socket.onerror = function(error) {
	log(`❌ ERROR! ${error.message}`);
};
```

Backend example (without error handling). See the UnitTest/special/websocket.js for example with error handling.

```

function setup(){
    //Require the WebSocket Library
    requirelib("websocket");
    websocket.upgrade(10);
    console.log("WebSocket Opened!")
    return true;
}

function waitForStart(){
    websocket.send("Type something to start test");
    var recv = websocket.read();
    console.log(recv);
}

function loop(i){
    websocket.send("Hello World: " + i);

    //Wait for 1 second before next send
    delay(1000);
}

function closing(){
    //Try to close the WebSocket connection
    websocket.close();
}

//Start executing the script
if (setup()){
    waitForStart();
    for (var i = 0; i < 10; i++){
        loop(i);
    }
    closing();
}else{
    console.log("WebSocket Setup Failed.")
}

```

### iot

The iot library provide access to the iot hardware control endpoints (or endpoints for short) in a much easier to use abstraction. 

```
//Include the library
requirelib("iot");
```



#### iot functions

```
iot.ready() //Return the iot manager status. Return true if ready, false otherwise.
iot.scan() //Force the iot manager to scan nearby iot devices
iot.list() //List nearby iot device, might be cached. 
iot.connect(devid) //Connect to a given device using device id
iot.disconnect(devid) //Disconnect a given device using device id
iot.status(devid) //Get the status of an iot device given its device ID, ID can be accessed using DeviceUUID key form an iot device object.
iot.exec(devid, epname, payload); //Execute iot command using device id, endpoint name and payload (object).
iot.iconTag(devid) //Get the device icon name from the device id

```

#### Example Return from iot.list() or iot.scan()

```
[
   {
      "ControlEndpoints":[
         {
            "Desc":"Toggle the power of the smart switch",
            "Max":0,
            "Min":0,
            "Name":"Toggle Power",
            "Regex":"",
            "RelPath":"ay?o=1",
            "Steps":0,
            "Type":"none"
         }
      ],
      "DeviceUUID":"84:F3:EB:3C:C7:F9",
      "Handler":{ 
      	//hidden fields 
      },
      "IPAddr":"192.168.0.177",
      "Manufacturer":"Sonoff",
      "Model":"Sonoff S2X Smart Switch",
      "Name":"Lights",
      "Port":80,
      "RequireAuth":false,
      "RequireConnect":false,
      "Status":{
         "Power":"ON"
      },
      "Version":""
   }
]

```





#### Usage Example

The following code do not handle errors. Please see iot.exec.js for a full example.

```
if (iot.ready() == true){
	//Get device list from the iot manager
	var deviceList = iot.list();
	
	//Assume the first device is the one we want to control
	var thisDevice = deviceList[0];
	
	//Assume the first endpoint is the one we want to execute
	var targetEndpoint = thisDevice.ControlEndpoints[0];
	
	//Connect to the iot device
	iot.connect(thisDevice.DeviceUUID);
	
	//Execute the endpoint and get response from iot device
	var results = iot.exec(thisDevice.DeviceUUID, targetEndpoint.Name, {});
	
	//Disconnect the iot device after use
	iot.disconnect(thisDevice.DeviceUUID);
	
	if (results == false){
		console.log("Something went wrong");
	}else{
		console.log("It works!" + JSON.stringify(results))
	}
}



```

For detailed example for other functions, see the js file located at ```UnitTest/backend/iot.*.js```

### Share

The share API allow access to the ArozOS share interface and generate UUID based on the shared file.

```
requirelib("share");
```

#### share functions

```
share.shareFile("user:/Desktop/test.pptx", 300); //File virtual path and timeout in seconds, return UUID of share
share.getFileShareUUID("user:/Desktop/test.pptx"); //Get the share UUID of a given file, return null if not shared
share.fileIsShared("user:/Desktop/test.pptx"); //Return true / false
share.checkShareExists(shareUUID); //Return true / false
share.checkSharePermission(shareUUID); //Return the share permission of shares (anyone / signedin / samegroup), return null if shareUUID invalid.
share.removeShare(shareUUID);
```

#### Share Timeout

For ```shareFile``` timeout value, **if set to 0 or unset, it will default to "forever"**. Hence, the share will not be automatically removed after timeout 

Please also note that the share timeout is done by the AGI gateway system runtime. Hence, if you have shutdown / reset your ArozOS within the set period of time, your share **will not get automatically removed after the system startup again**.

