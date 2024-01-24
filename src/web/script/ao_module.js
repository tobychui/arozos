/*
    ArOZ Online Module Javascript Wrapper

    This is a wrapper for module developers to access system API easier and need not to dig through the source code.
    Basically: Write less do more (?)
    WARNING! SOME FUNCTION ARE NOT COMPATIBILE WITH PREVIOUS VERSION OF AO_MODULE.JS.
    PLEASE REFER TO THE SYSTEM DOCUMENTATION FOR MORE INFORMATION.

    *** Please include this javascript file with relative path instead of absolute path.
    E.g. ../script/ao_module.js (OK)
           /script/ao_module.js (NOT OK)
*/
var ao_module_virtualDesktop = false;
try{
    ao_module_virtualDesktop = !(!parent.isDesktopMode);
}catch(ex){
    //Running ArozOS inside iframe for some reason
    console.log("CORS Access Error. Entering compatibility mode with virtual desktop mode disabled.");
}

var ao_root = null;
//Get the current windowID if in Virtual Desktop Mode, return false if VDI is not detected
var ao_module_windowID = false;
var ao_module_parentID = false;
var ao_module_callback = false;
var ao_module_ime = false;
if (ao_module_virtualDesktop)ao_module_windowID = $(window.frameElement).parent().parent().attr("windowId");
if (ao_module_virtualDesktop)ao_module_parentID = $(window.frameElement).parent().parent().attr("parent");
if (ao_module_virtualDesktop)ao_module_callback = $(window.frameElement).parent().parent().attr("callback");
if (ao_module_virtualDesktop)ao_module_parentURL = $(window.frameElement).parent().find("iframe").attr("src");
ao_root = ao_module_getAORootFromScriptPath();

/*
    Event bindings
    The following events are required for ao_module to operate normally 
    under Web Desktop Mode. 
*/

document.addEventListener("DOMContentLoaded", function() {
    if (ao_module_virtualDesktop){
        if (parent.window.ime == null){
            return;
        }
        //Add window focus handler
        document.addEventListener("mousedown", function(event) {
            //When click on this document, focus this
            ao_module_focus();

            if (event.target.tagName == "INPUT" || event.target.tagName == "TEXTAREA"){

            }else{
                if (parent.window.ime.focus != null){
                    if (ao_module_ime){
                        //This is clicking on ime windows. Do not change focus
                    }else{
                        parent.window.ime.focus = null;
                    }
                }
            }
        }, true);
    
        //Add IME registration handler
        var inputFields = document.querySelectorAll("input,textarea");
        for (var i = 0; i < inputFields.length; i++){
            if ($(inputFields[i]).attr("type") != undefined){
                var thisType = $(inputFields[i]).attr("type");
                if ((thisType == "text" || thisType =="search" || thisType =="url")){
                    //Supported types of input
                    ao_module_bindCustomIMEEvents(inputFields[i]);
                }else{
                    //Not supported type of inputs

                }
            }else{
                //text area
                ao_module_bindCustomIMEEvents(inputFields[i]);
            }
        }
    }
    /*
     //Load html2canvas
     if ($){
        $.getScript(ao_root + "script/html2canvas.min.js", function() {
            console.log("Html2canvas loaded")
        });
    }
    */
});

/*
    Startup Section Script
    
    These functions handle the startup of an ao_module and adapt them into the
    standard arozos desktop eco-system api
*/

//Function handle to bind custom IME events
function ao_module_bindCustomIMEEvents(object){
    parent.bindObjectToIMEEvents(object);
}

function ao_module_screenshot(callback){
    html2canvas(document.querySelector("body")).then(screenshot => {
        return callback(screenshot);
    });
}

//Get the ao_root from script includsion path
function ao_module_getAORootFromScriptPath(){
    var possibleRoot = "";
    $("script").each(function(){
        if (this.hasAttribute("src") && $(this).attr("src").includes("ao_module.js")){
            var tmp = $(this).attr("src");
            tmp = tmp.split("script/ao_module.js");
            possibleRoot = tmp[0];
        }
    });
    return possibleRoot;
}

//Get the input filename and filepath from the window hash paramter
function ao_module_loadInputFiles(){
    try{
        if (window.location.hash.length == 0){
            return null;
        }
        var inputFileInfo = window.location.hash.substring(1,window.location.hash.length);
        inputFileInfo = JSON.parse(decodeURIComponent(inputFileInfo));

        if (inputFileInfo.length == 0){
            return null;
        }
        return inputFileInfo
    }catch{
        return null;
    }
}

//Set the ao_module window to fixed size (not allowing resize)
function ao_module_setFixedWindowSize(){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowResizePolicy(ao_module_windowID, false);
}

//Restore a float window to be resizble
function ao_module_setResizableWindowSize(){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowResizePolicy(ao_module_windowID, true);
}

//Update the window size of the given float window object
function ao_module_setWindowSize(width, height){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowSize(ao_module_windowID, width, height)
}

//Update the floatWindow title
function ao_module_setWindowTitle(newTitle){
    if (!ao_module_virtualDesktop){
        document.title = newTitle;
        return;
    }
    parent.setFloatWindowTitle(ao_module_windowID, newTitle);
}   

//Set new window theme, default dark, support {dark/white}
function ao_module_setWindowTheme(newtheme="dark"){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowTheme(ao_module_windowID, newtheme);
}   

//Check if there are any windows with the same path. 
//If yes, replace its hash content and reload to the new one and close the current floatWindow
function ao_module_makeSingleInstance(){
    $(window.parent.document).find(".floatWindow").each(function(){
        if ($(this).attr("windowid") == ao_module_windowID){
            return
        }
        var currentPath = window.location.pathname;
        if ("/" + $(this).find("iframe").attr('src').split("#").shift() == currentPath){
            //Another instance already running. Replace it with the current path
            $(this).find("iframe").attr('src', window.location.pathname.substring(1) + window.location.hash);
            $(this).find("iframe")[0].contentWindow.location.reload();
            //Move the other instant to top
            var targetfw = parent.getFloatWindowByID($(this).attr("windowid"))
            parent.MoveFloatWindowToTop(targetfw);
            //Close the instance
            ao_module_close();
            return true
        }
    });
    return false
}

//Use for cross frame communication, example: 
//let targetOpeningInstances = ao_module_getInstanceByPath("NotepadA/index.html")
function ao_module_getInstanceByPath(matchingPath){
    let targetInstance = "";
    $(window.parent.document).find(".floatWindow").each(function(){
        if ($(this).attr("windowid") == ao_module_windowID){
            return
        }
        let thisfwPath = $(this).find("iframe").attr('src').split("#").shift();
        if (thisfwPath == matchingPath){
            targetInstance = $(this).attr("windowid");
        }
    });

    if (targetInstance == ""){
        return null;
    }
        
    return parent.getFloatWindowByID(targetInstance);
}


//Close the current window
function ao_module_close(){
    ao_module_closeHandler();
}

//Close handler for WebApp special handling of ao_module_close()
function ao_module_closeHandler(){
    if (!ao_module_virtualDesktop){
        window.close('','_parent','');
        window.location.href = ao_root + "SystemAO/closeTabInsturction.html";
        return;
    }
    parent.closeFwProcess(ao_module_windowID);
}

//Focus this floatWindow
function ao_module_focus(){
    parent.MoveFloatWindowToTop(parent.getFloatWindowByID(ao_module_windowID));
}

//Set the floatWindow to top most mode
function ao_module_setTopMost(){
    parent.PinFloatWindowToTopMostMode(parent.getFloatWindowByID(ao_module_windowID));
}

//Unset the floatWindow top most mode
function ao_module_unsetTopMost(){
    parent.UnpinFloatWindowFromTopMostMode(parent.getFloatWindowByID(ao_module_windowID));
}

//Popup a file selection window for uplaod
function ao_module_selectFiles(callback, fileType="file", accept="*", allowMultiple=false){
    var input = document.createElement('input');
    input.type = fileType;
    input.multiple = allowMultiple;
    input.accept = accept;
    input.onchange = e => { 
        var files = e.target.files; 
        callback(files);
    }
    input.click();
}

//Open a path with File Manager, optional highligh filename
function ao_module_openPath(path, filename=undefined){
    //Trim away the last / if exists
    if (path.substr(path.length - 1, 1) == "/"){
        path = path.substr(0, path.length - 1);
    }

    if (filename == undefined){
        if (ao_module_virtualDesktop){
            parent.newFloatWindow({
                url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(path),
                appicon: "SystemAO/file_system/img/small_icon.png",
                width:1080,
                height:580,
                title: "File Manager"
            });
        }else{
            window.open(ao_root + "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(path))
        }
    }else{
        var fileObject = [{
            filepath: path + "/" + filename,
            filename: filename,
        }];
        if (ao_module_virtualDesktop){
            parent.newFloatWindow({
                url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(JSON.stringify(fileObject)),
                appicon: "SystemAO/file_system/img/small_icon.png",
                width:1080,
                height:580,
                title: "File Manager"
            });
        }else{
            window.open(ao_root + "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(JSON.stringify(fileObject)))
        }
    }

   
}

//Open a particular tab using System Setting module. Require 
//1) Setting Group
//2) Setting Name
function ao_module_openSetting(group, name){
    var requestObject = {
        group: group,
        name: name
    }

    requestObject = encodeURIComponent(JSON.stringify(requestObject));
    var openURL = "SystemAO/system_setting/index.html#" + requestObject;
    if (ao_module_virtualDesktop){
        ao_module_newfw({
            url: openURL,
            width: 1080,
            height: 580,
            appicon: "SystemAO/system_setting/img/small_icon.png",
            title: "System Setting"
        });
    }else{
        window.open(ao_root + openURL)
    }
}


/*
    ao_module_newfw(launchConfig) => Create a new floatWindow object from the given paramters

    Most basic usage: (With auto assign UID, size and location)
    ao_module_newfw({
        url: "Dummy/index.html",
        title: "Dummy Module",
        appicon: "Dummy/img/icon.png"
    });

    Example usage that involve all configs:
    ao_module_newfw({
        url: "Dummy/index.html",
        uid: "CustomUUID",
        width: 1024,
        height: 768,
        appicon: "Dummy/img/icon.png",
        title: "Dummy Module",
        left: 100,
        top: 100,
        parent: ao_module_windowID,
        callback: "childCallbackHandler"
    });
*/
function ao_module_newfw(launchConfig){
    if (launchConfig["parent"] == undefined){
        launchConfig["parent"] = ao_module_windowID;
    }
    if (ao_module_virtualDesktop){
        parent.newFloatWindow(launchConfig);
    }else{
        window.open(ao_root + launchConfig.url);
    }
}

/*
    File Selector

    Open a file selector and return selected item back to the current window
    Tips: Unlike the beta version, you can use this function in both Virtual Desktop Mode and normal mode.

    Possible selection type:
    type => {file / folder / all / new}

    Example usage: 
    ao_module_openFileSelector(fileSelected, "user:/Desktop", "file",true);

    function fileSelected(filedata){
        for (var i=0; i < filedata.length; i++){
            var filename = filedata[i].filename;
            var filepath = filedata[i].filepath;
            //Do something here
        }
    }

    If you want to create a new file or folder object, you can use the following options paramters
    option = {
        defaultName: "newfile.txt",            //Default filename used in new operation
        fnameOverride: "myfunction",           //For those defined with window.myfunction
        filter: ["mp3","aac","ogg","flac","wav"] //File extension filter
    }
*/
var ao_module_fileSelectionListener;
var ao_module_fileSelectorWindow;
function ao_module_openFileSelector(callback,root="user:/", type="file",allowMultiple=false, options=undefined){
    var initInfo = {
        root: root,
        type: type,
        allowMultiple: allowMultiple,
        listenerUUID: "",
        options: options
    }
    var initInfoEncoded = encodeURIComponent(JSON.stringify(initInfo))
    if (ao_module_virtualDesktop){
        var callbackname = callback.name;
        if (typeof(options) != "undefined" && typeof(options.fnameOverride) != "undefined"){
            callbackname = options.fnameOverride;
        }
        console.log(callbackname);
        parent.newFloatWindow({
            url: "SystemAO/file_system/file_selector.html#" + initInfoEncoded,
            width: 700,
            height: 440,
            appicon: "SystemAO/file_system/img/selector.png",
            title: "Open",
            parent: ao_module_windowID,
            callback: callbackname
        });
    }else{
        //Create a return listener base on localStorage
        let listenerUUID = "fileSelector_" + new Date().getTime();
        ao_module_fileSelectionListener = setInterval(function(){
            if (localStorage.getItem(listenerUUID) === undefined || localStorage.getItem(listenerUUID)=== null){
                //Not ready
            }else{
                //File ready!
                var selectedFiles = JSON.parse(localStorage.getItem(listenerUUID));
                console.log("Removing Localstorage Item " + listenerUUID);
                
                localStorage.removeItem(listenerUUID); 
                setTimeout(function(){
                    localStorage.removeItem(listenerUUID); 
                },500);
                if(selectedFiles == "&&selection_canceled&&"){
                    //Selection canceled. Returm empty array
                    callback([]);
                }else{
                    //Files Selected
                    callback(selectedFiles);
                }
                
                clearInterval(ao_module_fileSelectionListener);
                ao_module_fileSelectorWindow.close();
            }
        },1000);

        //Open the file selector in a new tab
        initInfo.listenerUUID = listenerUUID;
        initInfoEncoded = encodeURIComponent(JSON.stringify(initInfo))
        ao_module_fileSelectorWindow = window.open(ao_root + "SystemAO/file_system/file_selector.html#" + initInfoEncoded,);
    }
}

//Check if there is parent to callback
function ao_module_hasParentCallback(){
    if (ao_module_virtualDesktop){
        //Check if parent callback exists
        var thisFw;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == ao_module_windowID){
                thisFw = $(this);
            }
        });
        var parentWindowID = thisFw.attr("parent");
        var parentCallback = thisFw.attr("callback");
        if (parentWindowID == "" || parentCallback == ""){
            //No parent window defined
            return false;
        }

        //Check if parent windows is alive
        var parentWindow = undefined;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == parentWindowID){
                parentWindow = $(this);
            }
        });
        if (parentWindow == undefined){
            //parent window not exists
            return false;
        }

        //Parent callback is set and ready to callback
        return true;
    }else{
        return false
    }
}

//Callback to parent with results
function ao_module_parentCallback(data=""){
    if (ao_module_virtualDesktop){
        var thisFw;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == ao_module_windowID){
                thisFw = $(this);
            }
        });
        var parentWindowID = thisFw.attr("parent");
        var parentCallback = thisFw.attr("callback");
        if (parentWindowID == "" || parentCallback == ""){
            //No parent window defined
            console.log("Undefined parent window ID or callback name");
            return false;
        }
        var parentWindow = undefined;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == parentWindowID){
                parentWindow = $(this);
            }
        });
        if (parentWindow == undefined){
            //parent window not exists
            console.log("Parent Window not exists!")
            return false;
        }
        $(parentWindow).find('iframe')[0].contentWindow.eval(parentCallback + "(" + JSON.stringify(data) + ");")

        //Focus the parent windows
        parent.MoveFloatWindowToTop(parentWindow);
        return true;
    }else{
        console.log("[ao_module] WARNING! Invalid call to parentCallback under non-virtualDesktop mode");
        return false;
    }
}


function ao_module_agirun(scriptpath, data, callback, failedcallback = undefined, timeout=0){
    $.ajax({
        url: ao_root + "system/ajgi/interface?script=" + scriptpath,
        method: "POST",
        data: data,
        success: function(data){
            if (typeof(callback) != "undefined"){
                callback(data);
            }
        },
        error: function(){
            if (typeof(failedcallback) != "undefined"){
                failedcallback();
            }
        },
        timeout: timeout
    });
}

function ao_module_uploadFile(file, targetPath, callback=undefined, progressCallback=undefined, failedcallback=undefined) {
    let url = ao_root + 'system/file_system/upload'
    let formData = new FormData()
    let xhr = new XMLHttpRequest()
    formData.append('file', file);
    formData.append('path', targetPath);

    xhr.open('POST', url, true);

    xhr.upload.addEventListener("progress", function(e) {
        if (progressCallback !== undefined){
            progressCallback((e.loaded * 100.0 / e.total) || 100);
        }
    });

    xhr.addEventListener('readystatechange', function(e) {
        if (xhr.readyState == 4 && xhr.status == 200) {
            if (callback !== undefined){
                callback(e.target.response);
            }
        }
        else if (xhr.readyState == 4 && xhr.status != 200) {
            if (failedcallback !== undefined){
                failedcallback(xhr.status);
            }
        }
    })

    xhr.send(formData);
}


/*
    ao_module_storage, allow key-value storage per module settings. 
    WARNING: NOT CROSS USER READ-WRITABLE
    
    ao_module_storage.setStorage(moduleName, configName,configValue);
    ao_module_storage.loadStorage(moduleName, configName);
*/
class ao_module_storage {
    static setStorage(moduleName, configName,configValue){
    	$.ajax({
    	  type: 'GET',
    	  url: ao_root + "system/file_system/preference",
    	  data: {key: moduleName + "/" + configName,value:configValue},
    	  success: function(data){},
    	  async:true
    	});
    	return true;
    }
    
    static loadStorage(moduleName, configName, callback=undefined){
        var result = "";
        if (callback == undefined){
            //Do not use async
            $.ajax({
                type: 'GET',
                url: ao_root + "system/file_system/preference",
                data: {key: moduleName + "/" + configName},
                success: function(data){
                        if (data.error !== undefined){
                            result = "";
                        }else{
                            result = data;
                        }
                    },
                error: function(data){result = "";},
                async:false,
                timeout: 3000
            });
              return result;
        }else{
            //Use sync method
            $.ajax({
                type: 'GET',
                url: ao_root + "system/file_system/preference",
                data: {key: moduleName + "/" + configName},
                success: function(data){
                        if (data.error !== undefined){
                            callback("");
                        }else{
                            callback(data);
                        }
                    },
                error: function(evt){
                    callback("");
                },
                timeout: 30000
            });
        }
    	
    	
    }
}

class ao_module_codec{
	//Decode umfilename into standard filename in utf-8, which umfilename usually start with "inith"
	//Example: ao_module_codec.decodeUmFilename(umfilename_here);
    static decodeUmFilename(umfilename){
		if (umfilename.includes("inith")){
			var data = umfilename.split(".");
			if (data.length == 1){
				//This is a filename without extension
				data = data[0].replace("inith","");
				var decodedname = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(data));
				if (decodedname != "false"){
					//This is a umfilename
					return decodedname;
				}else{
					//This is not a umfilename
					return umfilename;
				}
			}else{
				//This is a filename with extension
				var extension = data.pop();
				var filename = data[0];
				filename = filename.replace("inith",""); //Javascript replace only remove the first instances (i.e. the first inith in filename)
				var decodedname = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(filename));
				if (decodedname != "false"){
					//This is a umfilename
					return decodedname + "." + extension;
				}else{
					//This is not a umfilename
					return umfilename;
				}
			}
			
		}else{
			//This is not umfilename as it doesn't have the inith prefix
			return umfilename;
		}
	}
	
	//Encode filename to UMfilename
	//Example: ao_module_codec.encodeUMFilename("test.stl");
	static encodeUMFilename(filename){
	    if (filename.substring(0,5) != "inith"){
	        //Check if the filename include extension. 
	        if (filename.includes(".")){
	            //Filename with extension. pop it out first.
	            var info = filename.split(".");
	            var ext = info.pop();
	            var filenameOnly = info.join(".");
	            var encodedFilename = "inith" + ao_module_codec.decode_utf8(ao_module_codec.bin2hex(filenameOnly)) + "." + ext;
	            return encodedFilename;
	        }else{
	            //Filename with no extension. Convert the whole name into UMfilename
	            var encodedFilename = "inith" + ao_module_codec.decode_utf8(ao_module_codec.bin2hex(filename));
	            return encodedFilename;
	        }
	    }else{
	        //This is already a UMfilename. return the raw filename.
	        return filename;
	    }
	}
	
	//Decode hexFoldername into standard foldername in utf-8, return the original name if it is not a hex foldername
	//Example: ao_module_codec.decodeHexFoldername(hexFolderName_here);
	static decodeHexFoldername(folderName, prefix=true){
	    var decodedFoldername = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(folderName));
		if (decodedFoldername == "false"){
			//This is not a hex encoded foldername
			decodedFoldername = folderName;
		}else{
			//This is a hex encoded foldername
			if (prefix){
			    	decodedFoldername = "*" + decodedFoldername;
			}else{
			    	decodedFoldername =decodedFoldername;
			}
		}
		return decodedFoldername;
	}
    
    //Encode foldername into hexfoldername
    //Example: ao_module_codec.encodeHexFoldername("test");
    static encodeHexFoldername(folderName){
        var encodedFilename = "";
        if (ao_module_codec.decodeHexFoldername(folderName) == folderName){
            //This is not hex foldername. Encode it
            encodedFilename = ao_module_codec.decode_utf8(ao_module_codec.bin2hex(folderName));
        }else{
            //This folder name already encoded. Return the original value
            encodedFilename = folderName;
        }
        
        return encodedFilename;
    }
    static hex2bin(s){
      var ret = []
      var i = 0
      var l
      s += ''
      for (l = s.length; i < l; i += 2) {
        var c = parseInt(s.substr(i, 1), 16)
        var k = parseInt(s.substr(i + 1, 1), 16)
        if (isNaN(c) || isNaN(k)) return false
        ret.push((c << 4) | k)
      }
    
      return String.fromCharCode.apply(String, ret)
    }
    
    static bin2hex(s){
         var i
          var l
          var o = ''
          var n
          s += ''
          for (i = 0, l = s.length; i < l; i++) {
            n = s.charCodeAt(i)
              .toString(16)
            o += n.length < 2 ? '0' + n : n
          }
          return o
    }
    
    static decode_utf8(s) {
      return decodeURIComponent(escape(s));
    }
}


/**
    ArOZ Online Module Utils for quick deploy of ArOZ Online WebApps

    ao_module_utils.objectToAttr(object); //object to DOM attr
    ao_module_utils.attrToObject(attr); //DOM attr to Object
    ao_module_utils.getRandomUID(); //Get random UUID from timestamp
    ao_module_utils.getIconFromExt(ext); //Get icon tag from file extension
    ao_module_utils.stringToBlob(text, mimetype="text/plain") //Convert string to blob
    ao_module_utils.blobToFile(blob, filename, mimetype="text/plain") //Convert blob to file
    ao_module_utils.getDropFileInfo(dropEvent); //Get the filepath and filename list from file explorer drag drop
    ao_module_utils.readFileFromFileObject(fileObject, successCallback, failedCallback=undefined) //Read file object as text
    ao_module_utils.durationConverter(seconds) //Convert duration in seconds to Days / Hours / Minutes / Seconds
    ao_module_utils.formatBytes(byte, decimals); //Format file byte size to human readable size
    ao_module_utils.timeConverter(unix_timestamp); //Get human readable timestamp 
    ao_module_utils.getWebSocketEndpoint() //Build server websocket endpoint root, e.g. wss://192.168.1.100:8080/
    ao_module_utils.formatBytes(bytes, decimalPlace=2) //Convert and rounds bytes into KB, MB, GB or TB
**/
class ao_module_utils{
    
    //Two simple functions for converting any Javascript object into string that can be put into the attr value of an DOM object
    static objectToAttr(object){
       return encodeURIComponent(JSON.stringify(object));
    }
    
    static attrToObject(attr){
        return JSON.parse(decodeURIComponent(attr));
    }
    
    //Get a random id for a new floatWindow, use with var uid = ao_module_utils.getRandomUID();
    static getRandomUID(){
        return new Date().getTime();
    }

    static stringToBlob(text, mimetype="text/plain"){
        var blob = new Blob([text], { type: mimetype });
        return blob
    }

    static blobToFile(blob, filename, mimetype="text/plain"){
        var file = new File([blob], filename, {type: mimetype});
        return file
    }
    
    //Get the icon of a file with given extension (ext), use with ao_module_utils.getIconFromExt("ext");
    static getIconFromExt(ext){
        var ext = ext.toLowerCase().trim();
        var iconList={
            md:"file text outline",
            txt:"file text outline",
            pdf:"file pdf outline",
            doc:"file word outline",
            docx:"file word outline",
            odt:"file word outline",
            xlsx:"file excel outline",
            ods:"file excel outline",
            ppt:"file powerpoint outline",
            pptx:"file powerpoint outline",
            odp:"file powerpoint outline",
            jpg:"file image outline",
            png:"file image outline",
            jpeg:"file image outline",
            gif:"file image outline",
            odg:"file image outline",
            psd:"file image outline",
            zip:"file archive outline",
            '7z':"file archive outline",
            rar:"file archive outline",
            tar:"file archive outline",
            mp3:"file audio outline",
            m4a:"file audio outline",
            flac:"file audio outline",
            wav:"file audio outline",
            aac:"file audio outline",
            mp4:"file video outline",
            webm:"file video outline",
            php:"file code outline",
            html:"file code outline",
            htm:"file code outline",
            js:"file code outline",
            css:"file code outline",
            xml:"file code outline",
            json:"file code outline",
            csv:"file code outline",
            odf:"file code outline",
            bmp:"file image outline",
            rtf:"file text outline",
            wmv:"file video outline",
            mkv:"file video outline",
            ogg:"file audio outline",
            stl:"cube",
            obj:"cube",
            "3ds":"cube",
            fbx:"cube",
            collada:"cube",
            step:"cube",
            iges:"cube",
            gcode:"cube",
            shortcut:"external square",
            opus:"file audio outline",
            agi: "file code outline",
            apscene:"cubes"
        };
        var icon = "";
        if (ext == ""){
            icon = "folder outline";
        }else{
            icon = iconList[ext];
            if (icon == undefined){
                icon = "file outline"
            }
        }
        return icon;
	}
	
	//Get the drop file properties {filepath: xxx, filename: xxx} from file drop events from file exploere
	static getDropFileInfo(dropEvent){
		if (dropEvent.dataTransfer.getData("filedata") !== ""){
			var filelist = dropEvent.dataTransfer.getData("filedata");
			filelist = JSON.parse(filelist);
			return filelist;
		}
        return null;
    }

    static readFileFromFileObject(fileObject, successCallback, failedCallback=undefined){
        let reader = new FileReader();
        reader.readAsText(fileObject);
        reader.onload = function() {
            successCallback(reader.result);
        };
        reader.onerror = function() {
            if (failedCallback != undefined){
                failedCallback(reader.error);
            }else{
                console.log(reader.error);
            }
        };

    }

    static durationConverter(seconds){
        var days = Math.floor(seconds / 86400);
        seconds -= days * 86400;
        var hours = Math.floor(seconds / 3600) % 24;
        seconds -= hours * 3600;
        var minutes = Math.floor(seconds / 60) % 60;
        seconds -= minutes * 60;
        var seconds = seconds % 60;

        var resultDuration = "";
        if (days > 0){
            resultDuration += days + " Day";
            if (days > 1){
                resultDuration+= "s"
            }
            resultDuration += " "
        }

        if (hours > 0){
            resultDuration += hours + " Hour"
            if (hours > 1){
                resultDuration += "s"
            }
            resultDuration += " "
        }

        if (minutes > 0){
            resultDuration += minutes + " Minute"
            if (minutes > 1){
                resultDuration += "s"
            }
            resultDuration += " "
        }

        if (seconds > 0){
            resultDuration += seconds + " Second"
            if (seconds > 1){
                resultDuration += "s"
            }
            resultDuration += " "
        }
        
        return resultDuration;
    }

    static timeConverter(UNIX_timestamp){
        var a = new Date(UNIX_timestamp * 1000);
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var year = a.getFullYear();
        var month = months[a.getMonth()];
        var date = a.getDate();
        var hour = a.getHours().toString().padStart(2, "0");
        var min = a.getMinutes().toString().padStart(2, "0");
        var sec = a.getSeconds().toString().padStart(2, "0");
        var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
        return time;
    }

    static getWebSocketEndpoint(){
        let protocol = "wss://";
        if (location.protocol !== 'https:') {
            protocol = "ws://";
        }
        let port = window.location.port;
        if (window.location.port == ""){
            if (location.protocol !== 'https:') {
                port = "80";
            }else{
                port = "443";
            }
            
        }
        let wsept = (protocol + window.location.hostname + ":" + port);
        return wsept;
    }
    
    static formatBytes(a,b=2){if(0===a)return"0 Bytes";const c=0>b?0:b,d=Math.floor(Math.log(a)/Math.log(1024));return parseFloat((a/Math.pow(1024,d)).toFixed(c))+" "+["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"][d]}
}

/*
    Backend Programming Logic

    These code are design to use with ao_backend.js for wrapping
    AGI programming gateway content
*/

function ao_module_backend(){
    return {
        timeout: 500,
        start: function(libraryPath){
            this.libpath = libraryPath;
    
            //Initialize the parent objects
            this.appdata.parent = this;
            this.file.parent = this;
            this.http.parent = this;
        },
        _agi_run: function(data, callback, failedcallback = undefined){
                    $.ajax({
                        url: ao_root + "system/ajgi/interface?script=" + this.libpath,
                        method: "POST",
                        data: data,
                        success: function(data){
                            if (typeof(callback) != "undefined"){
                                callback(data);
                            }
                        },
                        error: function(){
                            if (typeof(failedcallback) != "undefined"){
                                failedcallback();
                            }
                            console.log("Request failed");
                        },
                        timeout: this.timeout
                    })
                },
        appdata: {
            readFile: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "appdata.readFile",
                    filepath: filepath
                }, callback)
            },
            listDir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "appdata.listDir",
                    filepath: filepath
                }, callback)
            },
        },
        file: {
            writeFile: function(filepath, content, callback=undefined){
                this.parent._agi_run({
                    opr: "file.writeFile",
                    filepath: filepath,
                    content: content,
                }, callback)
            },
            readFile: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.readFile",
                    filepath: filepath
                }, callback)
            },
            deleteFile: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.deleteFile",
                    filepath: filepath
                }, callback)
            },
            readdir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.readdir",
                    filepath: filepath
                }, callback)
            },
            walk: function(filepath, mode="all", callback=undefined){
                this.parent._agi_run({
                    opr: "file.walk",
                    filepath: filepath,
                    mode: mode,
                }, callback)
            },
            glob: function(wildcard, sort="user", callback=undefined){
                this.parent._agi_run({
                    opr: "file.glob",
                    wildcard: wildcard,
                    sort: sort,
                }, callback)
            },
            aglob: function(wildcard, sort="user", callback=undefined){
                this.parent._agi_run({
                    opr: "file.aglob",
                    wildcard: wildcard,
                    sort: sort,
                }, callback)
            },
            filesize: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.filesize",
                    filepath: filepath
                }, callback)
            },
            fileExists: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.fileExists",
                    filepath: filepath
                }, callback)
            },
            isDir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.isDir",
                    filepath: filepath
                }, callback)
            },
            mkdir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.mkdir",
                    filepath: filepath
                }, callback)
            },
            mtime: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.mtime",
                    filepath: filepath
                }, callback)
            },
            rootName: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.rootName",
                    filepath: filepath
                }, callback)
            }
        },
        http: {
            get: function(targetURL, callback=undefined){
                this.parent._agi_run({
                    opr: "http.get",
                    targetURL: targetURL
                }, callback)
            },
            post: function(targetURL, postdata="", callback=undefined){
                this.parent._agi_run({
                    opr: "http.post",
                    targetURL: targetURL,
                    postdata: postdata
                }, callback)
            },
            head: function(targetURL, header="", callback=undefined){
                this.parent._agi_run({
                    opr: "http.head",
                    targetURL: targetURL,
                    header: header
                }, callback)
            },
            download: function(targetURL, saveDir="tmp:/", saveFilename="", callback=undefined){
                if (saveFilename == ""){
                    saveFilename = targetURL.split("/").pop();
                    saveFilename = decodeURIComponent(saveFilename);
                }

                this.parent._agi_run({
                    opr: "http.download",
                    targetURL: targetURL,
                    saveDir: saveDir,
                    saveFilename: saveFilename
                }, callback)
            },
        }
    }
}

