/*
ArOZ Online Module API wrapper

This script is used for wrapping all the API that can be called by the ArOZ Online Module under VDI mode.
For faster development, please include this script into your module and call through this script.
Or otherwise, you can call directly to the ArOZ Online System via GET / POST request. 

<!> Warning! This script require jQuery to work. 
Although some functions might not require jquery, it is still recommended. You can include the jquery file from
AOR/script/jquery.min.js

Toby Chui @ IMUS Laboratory, All Right Reserved
*/

//Check if current module is called in Virtal Desktop Mode
var ao_module_virtualDesktop = !(!parent.isFunctionBar);

//Get the current windowID if in Virtual Desktop Mode, return false if VDI is not detected
var ao_module_windowID = false;
if (ao_module_virtualDesktop)ao_module_windowID = $(window.frameElement).parent().attr("id");

//Set the current FloatWindow with specified icon
function ao_module_setWindowIcon(icon){
	if (ao_module_virtualDesktop){
		parent.setWindowIcon(ao_module_windowID + "",icon);
		return true;
	}
	return false;
}

//Set the current FloatWindow with specified title tag
function ao_module_setWindowTitle(title){
	if (ao_module_virtualDesktop){
		parent.changeWindowTitle(ao_module_windowID + "",title);
		return true;
	}
	return false;
}

//Set the current FloatWindow to GlassEffect Window (Cannot switch back to origianl mode)
function ao_module_setGlassEffectMode(){
	if (ao_module_virtualDesktop){
		parent.setGlassEffectMode(ao_module_windowID + "");
		return true;
	}
	return false;
}

//Set the current FloatWindow to Fixed Size Window (Non-resizable), default Resizable
function ao_module_setFixedWindowSize(){
	if (ao_module_virtualDesktop){
		parent.setWindowFixedSize(ao_module_windowID + "");
		return true;
	}
	return false;
}

//Set the current FloatWindow size (width, height)
function ao_module_setWindowSize(w,h){
	if (ao_module_virtualDesktop){
		parent.setWindowPreferdSize(ao_module_windowID + "",w,h);
		return true;
	}
	return false;
}

//Close the current window
function ao_module_close(){
	if (ao_module_virtualDesktop){
		parent.closeWindow(ao_module_windowID);
		return true;
	}
	return false;
}

//Get the windows that is running the given module name and return an id list for floatWindow
function ao_module_getProcessID(modulename){
	if (ao_module_virtualDesktop){
		return parent.getWindowFromModule(modulename);
	}
	return false;
}

//Crashed
function ao_module_declareCrash(crashmsg){
	return false;
}

//Open an ArOZ Online Path with the given targetPath from ArOZ Online Root
/**
For example, if you want to open the folder: 
"AOR/Audio/uploads/"
Then you can call this function as follow:
ao_module_openPath("Audio/uploads");
**/
function ao_module_openPath(targetPath,width=1080,height=580,posx=undefined,posy=undefined){
	if (ao_module_virtualDesktop){
		parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&subdir=" + targetPath, "Loading", "folder open outline",Math.floor(Date.now() / 1000),width,height,posx,posy);
		return true;
	}
	return false;
}

//Open an ArOZ Online File with the given targetPath and filename (display name) from ArOZ Online Root
/**
For example, if you want to open the file: 
"AOR/Desktop/files/admin/helloworld.txt"
Then you can call this function as follow:

ao_module_openFile("Desktop/files/admin/helloworld.txt","helloworld.txt");

The targetpath can be something different from the filename (display name). For example, an encoded file with path:
"Desktop/files/TC/inithe38090e5b08fe9878ee5b48ee4babae38091546f75686f754d4144202d20546f75686f752026204e69746f72692047657420446f776e2120282b6c797269632920e380904844e38091205b373230705d.mp4"
can be opened with filename 
"【小野崎人】TouhouMAD - Touhou %26 Nitori Get Down! (+lyric) 【HD】 [720p].mp4" with the following command:

ao_module_openFile("Desktop/files/TC/inithe38090e5b08fe9878ee5b48ee4babae38091546f75686f754d4144202d20546f75686f752026204e69746f72692047657420446f776e2120282b6c797269632920e380904844e38091205b373230705d.mp4","【小野崎人】TouhouMAD - Touhou %26 Nitori Get Down! (+lyric) 【HD】 [720p].mp4");

**/
function ao_module_openFile(targetPath,filename){
	if (ao_module_virtualDesktop){
		parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare",0,0,-10,-10);
		return true;
	}
	return false;
}


//Open a FloatWindow
/**
Example 1: opening the Memo index with the following code:
ao_module_newfw('Memo/index.php','Memo','sticky note outline','memoEmbedded',475,700);

Example 2: opening the Memo index with minimal parameter:
ao_module_newfw('Memo/index.php','Memo','sticky note outline','memoEmbedded');

Reminder:
- If you open multiple windows with the same UID, the previous one will be overwritten and reload to the latest page.
- windowname parameter must not contain chars that cannot be put inside an id field (e.g. "&", "." etc)
- For a list of icons, please reference https://tocas-ui.com/elements/icon/
**/
function ao_module_newfw(src,windowname,icon,uid,sizex = undefined,sizey = undefined,posx = undefined,posy = undefined,fixsize = undefined,glassEffect = undefined){
	if (ao_module_virtualDesktop){
		parent.newEmbededWindow(src,windowname,icon,uid,sizex,sizey,posx,posy,fixsize,glassEffect);
		return true;
	}
	return false;
}

//Request fullscreen access from VDI module
function ao_module_fullScreen(){
	if (ao_module_virtualDesktop){
		parent.openFullscreen();
		return true;
	}
	return false;
}

//Get the basic information of the floatWindows (including the width, height, left and top value)
function ao_module_getWidth(){
	return parent.document.getElementById(ao_module_windowID).offsetWidth;
}

function ao_module_getHeight(){
	return parent.document.getElementById(ao_module_windowID).offsetHeight;
}

function ao_module_getLeft(){
	return parent.document.getElementById(ao_module_windowID).getBoundingClientRect().left;
}

function ao_module_getTop(){
	return parent.document.getElementById(ao_module_windowID).getBoundingClientRect().top;
}

//Showing msgbox at the notification side bar
/**
For example, the most basic use of this command will be: 
ao_module_msgbox("This is a demo message from the aroz online module.","Hello World");

You can add more object to the message including HTML tags in msg and title, and redirection path for opening the target etc.
If auto close = false, the side bar will not get hidden after 4 seconds.
**/
function ao_module_msgbox(warningMsg,title="",redirectpath="",autoclose=true){
	if (ao_module_virtualDesktop){
		parent.msgbox(warningMsg,title,redirectpath,autoclose);
		return true;
	}
	return false;
}

//Focus this floatWindow and bring it to the front
/**
This function bring the current floatWindow content to the front of all FloatWindows.
Please use this only in urgent / warning information. This might bring interuption to user's operation and making them unhappy.
**/
function ao_module_focus(){
	parent.focusFloatWindow(ao_module_windowID);
}


//Return the object in which the main interface iframe (The most backgound iframe. Mostly Desktop when you are using VDI mode. But you can change it if required).
function ao_module_callToInterface(){
	return parent.callToInterface();
}


/**
REMINDER
When your module require save and loading data from localStorage, we recommend using the naming method as follow.
[ModuleName]_[Username]_[Properties].
For example, you are developing a new "MusicMixer" Module and want to store the "songList" properties for user "Admin". Then the recommended localStorage syntax will be:
MusicMixer_Admin_songList
Example:
ao_module_getStorage("MusicMixer_Admin_songList");
ao_module_saveStorage("MusicMixer_Admin_songList","{some JSON string here}");
**/
//Load something from localStorage with given tag
function ao_module_getStorage(moduleName,username,itemname){
    moduleName = moduleName.split("_").join("-");
    username = username.split("_").join("-");
    itemname = itemname.split("_").join("-");
	return localStorage.getItem(moduleName + "_" + username + "_" + itemname);
}
//Save something into localStoarge with give tag and value
function ao_module_saveStorage(moduleName,username,itemname,value){
    moduleName = moduleName.split("_").join("-");
    username = username.split("_").join("-");
    itemname = itemname.split("_").join("-");
	localStorage.setItem(moduleName + "_" + username + "_" + itemname, value);
	return true;
}

//Check if the storage exists on this browser or not
function ao_module_checkStorage(id){
	if (typeof(Storage) !== "undefined") {
		return true;
	} else {
		return false;
	}
}

/**
Screenshot related functions
This function make use of the html2canvas JavaScript library. For license and author, please refer to the html2canvas.js head section.

target value are used to defined the operation after the screenshot.
default / newWindow --> Open screenshot in new window
dataurl --> return data url of the image as string
canvas --> return the canvas object
**/
//Updates Removed Screenshot feature due to waste of resources
/**
//Take a screenshot from module body
function ao_html2canvas_screenshot(target="newWindow",callback){
	if (typeof html2canvas != undefined){
		html2canvas(document.body).then(function(canvas) {
			if (target == "newWindow"){
				window.open(canvas.toDataURL("image/png"), '_blank');
				return true;
			}else if (target == "dataurl"){
				callback(canvas.toDataURL("image/png"));
			}else if (target == "canvas"){
				callback(canvas);
			}else{
				window.open(canvas.toDataURL("image/png"), '_blank');
				return true;
			}
		});
	}else{
		return false;
	}
}

function ao_html2canvas_getPreview(w,h){
	if (typeof html2canvas != undefined){
		html2canvas(document.body,{width: w,height: h}).then(function(canvas) {
			parent.updatePreview(canvas);
		});
	}else{
		return false;
	}
}
**/

