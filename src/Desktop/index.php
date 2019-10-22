<?php
include_once '../auth.php';
?>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Virtual Desktop Interface</title>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<script src="script/jquery-1.12.4.js"></script>
	<script src="script/jquery-ui.js"></script>
	<style>
	
	.selectedApp {
		background:rgba(255,255,255,0.5) !important;
		border-color: white;
		border-top:1px dotted #fff;
		border-bottom:1px dotted #fff;
		border-left:1px dotted #fff;
		border-right:1px dotted #fff;
	}
	
	.launchIcon{
		width:70px; 
		height:auto;
		position:fixed;
		cursor: pointer;
		text-shadow: -1px 0 black, 0 1px black, 1px 0 black, 0 -1px black;	
		color: white; 
		font-size: 90%;
		word-break: break-all;
		text-overflow: ellipsis;
		-webkit-line
		-clamp: 2; /* number of lines to show */
		-webkit-box-orient: vertical;
		line-height: 16px;
		min-height:80px;
		max-height:118px;
		overflow-y:hidden;
		overflow-x: hidden;
		font-variant-numeric: tabular-nums lining-nums;
		border: 1px solid transparent;
		border-radius: 3px;
	}
	

	.launchIcon:hover{
		background:rgba(255,255,255,0.2);
	}

	.fileDescription {
		width:200px;
		/*height:50px;*/
		position:fixed;
		z-index:10;
		background:rgba(255,255,255,0.8);
		border-color: #abacad;
		border: 1px solid;
		padding: 10px;
		box-shadow: 1px 1px #3a3a3a;
		padding:2px;
		word-wrap: break-word;
	}

	.non_selectable {
		-webkit-user-select: none; /* Chrome/Safari */        
		-moz-user-select: none; /* Firefox */
		-ms-user-select: none; /* IE10+ */
	}

	.fileSelector {
		position:fixed;
		z-index:10;
		background:rgba(52,114,229,0.4);
		border:1px solid #3472e5;
		border-width:1px;
		border-style:solid;
		border-color:#3472e5;
	}

	.leftClickMenu{
		position:fixed;
		z-index:99;
	}
	
	#lcm {
		padding-bottom:10px;
	}
	
	#lcm .item{
		height:auto;
		padding-top:5px !important;
		padding-bottom:5px !important;
		font-size:90%;
		border: 1px solid transparent;
	}
	
	#rcm {
		padding-bottom:5px;
	}
	
	#rcm .item{
		height:auto;
		padding-top:5px !important;
		padding-bottom:5px !important;
		font-size:90%;
		border: 1px solid transparent;
	}
	
	.hovering{
		background-color: rgb(226, 253, 255);
		border: 1px solid rgb(89, 152, 255) !important;
	}
	
	.selectedMenu{
		background-color: rgb(226, 253, 255);
		border: 1px solid rgb(89, 152, 255) !important;
	}
	
	.chooseFolderDialog{
		position:fixed;
		z-index:103;
		height:300;
		width:240;
		font-size:90%;
		border: 1px solid transparent;
		background-color:#f0f0f0 !important;
		border-radius: 0px !important;
		padding-top:1px;
		overflow-y:hidden;
	}
	
	.menubox{
		padding-bottom: 2px;
		padding-left: 16px;
		padding-right: 16px;
		padding-top: 1px;
		height:auto;
		color: rgb(90,90,90);
		font-size:90%;
		border: 1px solid transparent;
		cursor: pointer;
	}
	
	.displaybox{
		padding-bottom: 2px;
		padding-left: 16px;
		padding-right: 16px;
		padding-top: 1px;
		height:auto;
		color: rgb(90,90,90);
		font-size:90%;
		border: 1px solid transparent;
		background-color:#dbdbdb;
	}
	
	.menubox:hover{
		background-color: rgb(226, 253, 255);
		border: 1px solid rgb(89, 152, 255) !important;
	}
	
	.renamebox{
		background-color:#f0f0f0;
		border: 1px solid #303030;
		width:70px;
		word-wrap: break-word;
		position:absolute;
		left:0px;
		overflow-wrap: break-word;
		overflow: hidden;
	}
	
	.renameboxfolder{
		background-color:#f0f0f0;
		border: 1px solid #303030;
		width:70px;
		word-wrap: break-word;
		position:absolute;
		top:58px;
		left:0px;
		overflow-wrap: break-word;
		overflow: hidden;
	}
	</style>
</head>

<body style="background-color:black;">
<img id="dbg1" src="img/bg/init.jpg" style="position:fixed;background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
		z-index:-1;
		height: 100%; min-width:100%;"></img>

<img id="dbg2" src="img/bg/init.jpg" style="position:fixed;background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
		z-index:-2;
		height: 100%; min-width:100%;"></img>

<div id="pictureFrame" style="position:fixed;background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
		z-index:0;
		height: 100%; min-width:100%;
		-webkit-user-select: none; /* Chrome/Safari */        
		-moz-user-select: none; /* Firefox */
		-ms-user-select: none; /* IE10+ */"></div>



<!-- Desktop Icon Sections-->

<div class="launchIcon" style="left:10px; top: 10px;" align="center" path="Desktop" targetType="module" uid="MyHost">
<img class="ts image non_selectable" src="img/system_icon/MyHost.png" style="cursor: pointer;">
My Host
</div>


<!-- This is where the magic happens-->
<div id="fileDescriptor" class="fileDescription" style="font-size: 80%;display:none;z-index:101;">Now Loading...</div>
<div id="fileSelector" class="fileSelector" style="color:white;display:none;"></div>
<div id="folderChoose" class="chooseFolderDialog ts contextmenu">
	<div id="fchead" class="contextmenu" style="width:100%;display:inline;position:absolute;top:0;left:0;height:25px;">
	
	</div>
	<div id="fclist" class="contextmenu" style="width:100%;display:inline;position:absolute;top:25px;left:0;height:250px;overflow-y:auto;">
		<div class="displaybox">
			Title
		</div>
		<div class="menubox">
			Dummy
		</div>
	</div>
	<div id="fcbottom" class="contextmenu" style="width:100%;display:inline;position:absolute;top:275;left:0;height:25px;">
		<button class="ts mini primary button" style="height:25px;padding-top:2px;padding-bottom:2px;border-radius: 0px !important;" onClick="moveFileToCurrentDirectory();">MOVE HERE</button>
		<button class="ts mini basic button" style="height:25px;padding-top:2px;padding-bottom:2px;border-radius: 0px !important;position:absolute;right:0px;" onClick="newfolderInFolderChooseMenu();"><i class="icons"><i class="folder icon"></i><i class="corner add icon"></i></i></button>
	</div>
</div>
<div id="leftClick" class="leftClickMenu">
<div id="lcm" class="ts contextmenu" style="position:fixed;top:0;left:0;z-index:99;border-radius: 0px;background-color:#f0f0f0;">
    <div class="item">
        N/A
    </div>
</div>
<div id="rcm" class="ts contextmenu" style="position:fixed;top:0;left:0;z-index:99;border-radius: 0px;background-color:#f0f0f0;">
    <div class="item">
        N/A
    </div>
</div>
</div>
<!-- Notification bar-->
<div id="notification" class="ts active bottom right snackbar" style="bottom:45px;display:none;background-color:#353535;">
    <div id="notificationText" class="content">
        Notification balloon
    </div>
</div>

<!-- Setting section -->
<div style="display:none;">
	<input id="forceFocus" type="text" name="focusTool"></input>
	<div id="setting_sessionUsername"><?php echo $_SESSION['login'];?></div>
</div>
</body>

<script>
var bgNumber = 0;
var bgPhrase = 0;
var focusedOnItem = false;
var selectedObject = [];
var maxBgNumber = 1;
var showDetailTime = 1500; //Time required for hovering over a launch icon and show its info
var VDI = !(!parent.isFunctionBar);
var lastMousePos = { x: -1, y: -1};
var currentMousePos = { x: -1, y: -1 };
var multiSelectionDragDropLocations = [];
var dragging = false;
var theme = "default";
var debug = true;
var desktopFiles = [];
var desktopFileNames = [];
var desktopFileLocations = [];
var desktopEmptyPositions = [];
var username = localStorage.getItem('ArOZusername'); //Or use the session login username if needed, but due to multi desktop support, it is not recommended
var privateBrowsing = false;
if (username === undefined){
	//Force using session username if under private browsing mode
	username = session_username; 
	privateBrowsing = true;
	parent.msgbox("No permission to write to localStorage. Some functions might not work under the current borwser permission settings.","<i class='privacy icon'></i>Private Browsing");
}
var session_username = $("#setting_sessionUsername").text().trim();
var highlighting = false;
var nextSlot=[10,110];
var openWithModuleList = [];
var currentMovetoFolder = "";
var iconList={md:"file text outline",txt:"file text outline",pdf:"file pdf outline",doc:"file word outline",docx:"file word outline",xlsx:"file excel outline",ppt:"file powerpoint outline",pptx:"file powerpoint outline",jpg:"file image outline",png:"file image outline",jpeg:"file image outline",gif:"file image outline",zip:"file archive outline",'7z':"file archive outline",rar:"file archive outline",mp3:"file audio outline",m4a:"file audio outline",flac:"file audio outline",wav:"file audio outline",aac:"file audio outline",mp4:"file video outline",webm:"file video outline",php:"file code outline",js:"file code outline",css:"file code outline",bmp:"file image outline",rtf:"file text outline",wmv:"file video outline",mkv:"file video outline",ogg:"file audio outline",stl:"cube",obj:"cube","3ds":"cube",fbx:"cube",collada:"cube",step:"cube",iges:"cube",gcode:"cube",opus:"file audio outline",odt:"file word outline"};
var iconPositions = [];
var moveOverwrite = false;
var renaming = false;
var previousName = "";
var copyingFiles = 0;
var bgfileformat = "jpg";
var preventRefresh = false;
var newItemList = [];
var launchIconMaxHeight = 103;//Pixel

initUserDesktop(showNotification,"<i class='checkmark icon'></i> Your Desktop is ready to use.");
initLaunchIconEvents();
addDraggingEvents();
addContextMenuEvents();


/**
Desktop theme preference load from Localstorage
**/
if (localStorage.getItem("desktop-theme-" + username.replace(/\W/g, '')) !== null){
	theme = localStorage.getItem("desktop-theme-" + username.replace(/\W/g, ''));
}

if (username != session_username){
	parent.msgbox("This is an alternative desktop environment to your original desktop. Don't mix them up!<br><i class='user icon'></i>Sub-Desktop: " + username + "<br><i class='user icon'></i>Owner: " + session_username,"<i class='desktop icon'></i>Sub-Desktop Started");
}
$(document).ready(function(){
	console.log('%c [info] Welcome to ArOZ Online Virtual Desktop Mode!', 'color: #82e8ff');
	console.log('%c [info] Please beware not to copy and paste anything from the internet to this console as this might bring damage to your system.', 'color: #82e8ff');
	if (VDI == false && debug == false){
		//When initiate, if detected the functional bar is not activated, force it to activate
		//This statment only activate if debug mode is false.
		window.location.href = "../function_bar.php#Desktop/";
	}
	GetBGCount(true); //Init bg after getting the bgfileformat
	setInterval(ChangeBG, 30000);
	setInterval(updateDesktopFiles, 5000);
	showNotification("<i class='loading circle notched icon'></i> We are preparing your Desktop...");
	GetNewItemList();
	/*
	$("#dbg1").error(function () { 
		$(this).fadeOut('fast');
	});

	$("#dbg2").error(function () { 
		$(this).fadeOut('fast');
	});
	*/

});

/**
Desktop init / rendering code
This section of code request destop files from the linux kernel / DOS (via PHP of course :P )
Adding the related drag events and handler
**/


function GetNewItemList(){
	//Check what items can be created via the new menu in the context menu
	$.get( "newItem.php", function(data) {
		newItemList = data;
	});
}

function updateDesktopFiles(){
	//As some other modules might create / remove files from the desktop, it is better to check if the desktop need update after some period of time
	//Default value will be 10s
	var returnedFileList = [];
	$.get( "desktopFileLoader.php?username=" + username, function(data) {
		if (Array.isArray(data) == false && data.substring(0, 5) == "ERROR"){
			showNotification("<i class='help icon'></i> Desktop file Synchronization");
		}else if (data == ""){
			//PHP returns nothing, mostly due to Windows Filename encoding error.
		}else{
			returnedFileList = returnedFileList.concat(data[0]);
		}
		if (arraysEqual(desktopFiles,returnedFileList)){
			//All the files are the same as before, keep the current desktop file list
		}else{
			//Something is different. Update the desktop
			if (preventRefresh == false){
				RefreshDesktop();
			}else{
				//Some operation performing in progress. Skip this refresh
			}
			
		}
	});
}

function initUserDesktop(callback = null,callbackvar = "",callbackSeq = 0){
	//If callbackSeq = 0, the call back will be performed after the desktop init. Or if = 1, the callback is called before desktop icon init
	desktopFiles = [];
	desktopFileNames = [];
	desktopFileLocations = [];
	desktopEmptyPositions = [];
	//showNotification("<i class='loading spinner icon'></i> Desktop environment initializing...");
	$.ajax({
		url: "desktopFileLoader.php?username=" + username,
		success: function(data){
				if (Array.isArray(data) == false && data.substring(0, 5) == "ERROR"){
					showNotification(data);
				}else{
					desktopFiles = desktopFiles.concat(data[0]); //All the raw filenames 
					desktopFileNames = desktopFileNames.concat(data[1]); //All decoded filenames
					desktopFileLocations = desktopFileLocations.concat(data[2]); //All desktop file locations
					calculateEmptyDesktopSlots();
					if (callbackSeq == 0){
						updateDesktopGraphic();
					}
				}
				if (callback != null){
					if (callbackvar == ""){
						callback();
					}else{
						callback(callbackvar);
					}
				}
				if (callbackSeq == 1){
					updateDesktopGraphic();
				}
			},
		timeout: 10000,
		error: function(jqXHR, textStatus, errorThrown) {
				parent.msgbox("Your desktop is unable to load due to host system encoding issue. We are trying to fix the issue.","<i class='caution sign icon'></i> Critial Error!",undefined,false);
				$.get("fixWinDesktop.php",function(data){
					if (data.includes("ERROR") == false){
						parent.msgbox("Your desktop is fixed and the corrupted file is moved to recover/ folder on your desktop. Click the link below to refresh.","<i class='checkmark sign icon'></i> Recovery Completed","{reload}",false);
					}else{
						alert("Unable to recover. See console.log for more information.");
					}
				});
			}
		}
	   );
	/*
	$.get( "desktopFileLoader.php?username=" + username, function(data) {
		if (Array.isArray(data) == false && data.substring(0, 5) == "ERROR"){
			showNotification(data);
		}else{
			desktopFiles = desktopFiles.concat(data[0]); //All the raw filenames 
			desktopFileNames = desktopFileNames.concat(data[1]); //All decoded filenames
			desktopFileLocations = desktopFileLocations.concat(data[2]); //All desktop file locations
			calculateEmptyDesktopSlots();
			if (callbackSeq == 0){
				updateDesktopGraphic();
			}
		}
		if (callback != null){
			if (callbackvar == ""){
				callback();
			}else{
				callback(callbackvar);
			}
		}
		if (callbackSeq == 1){
			updateDesktopGraphic();
		}
	});
	*/
	$.get( "loadAllModule.php", function( data ) {
		openWithModuleList = data;
		
	});
	
}

function calculateEmptyDesktopSlots(){
	//Precalculate all the empty slots on the desktop environment
	var screenWidth = $(window).width();
	var screenHeight = $(window).height() || window.innerHeight;
	//Get usable space 
	screenWidth = screenWidth - 10; 
	screenHeight = screenHeight - 10;
	for (var w = 10; w < screenWidth; w+=80){
		for (var h = 10; h < screenHeight; h+=100){
			desktopEmptyPositions.push([w,h]);
		}
	}
	
	//Copy an array from the file location list so we can sort it
	let desktopFileLocationsClone = Array.from(desktopFileLocations);
	//Append the location of MyHost into the list
	var myHostLocation = [10,10];
	$(".launchIcon").each(function(){
		if ($(this).attr("uid") == "MyHost"){
			myHostLocation = [$(this).offset().left,$(this).offset().top];
		}
	});
	//Convert the list from array of string to int
	for (var k =0; k < desktopFileLocationsClone.length; k++){
		var testPos = parseInt(desktopFileLocationsClone[k][0]);
		if (isNaN(testPos) == false){
			desktopFileLocationsClone[k] = [parseInt(desktopFileLocationsClone[k][0]),parseInt(desktopFileLocationsClone[k][1])];
		}else{
			desktopFileLocationsClone.splice(k,1);
			k--;
		}
	}
	desktopFileLocationsClone.push(myHostLocation);
	desktopFileLocationsClone.sort(function(a,b){
		if (parseInt(a[0]) != parseInt(b[0])){
			return parseInt(a[0]) > parseInt(b[0])
		}else{
			return parseInt(a[1]) > parseInt(b[1])
		}
	});
	//Compare the array using line sweeping algorithm (This only takes O(n + m) time!!!)
	var a =0;
	for (var i = 0; i < desktopFileLocationsClone.length;i++){
		for (a = a;a < desktopEmptyPositions.length;a++){
			if (desktopEmptyPositions[a][0] == desktopFileLocationsClone[i][0] && desktopEmptyPositions[a][1] == desktopFileLocationsClone[i][1]){
				desktopEmptyPositions.splice(a,1);
				break;
			}
		}
	}
}

function cleanDesktop(){
	$(".launchIcon").each(function(){
		$(this).remove();
		desktopFiles=[];
	});
}

function updateDesktopGraphic(){
	//Place all the files on the desktop
	for(var i = 0; i < desktopFiles.length;i++){
		var ext = getFileExt(desktopFiles[i]);
		var pos = desktopFileLocations[i];
		var decodedFilename = desktopFileNames[i];
		if (ext == "shortcut"){
			//This is a shortcut for module
			createShortcutIcon(desktopFiles[i],pos);
		}else if (ext == desktopFiles[i]){
			//This is a folder but returned as a file by php (Which kinda make sense as folder is a kind of file I guess?)
			createFolderIcon(desktopFiles[i],pos,decodedFilename);
		}else{
			//This is a file
			placeFileicon(desktopFiles[i],decodedFilename,pos);
		}
		
	}
	
	
}

function filenameClearnUp(){
	//Clearning up the filename as some of them might not need to have word-break: break-all
	$(".launchIcon").each(function(){
		var filename = ($(this).text().trim());
		if (filename.includes(" ") && filename.length < 20 && $(this).attr('targettype') == 'module'){
			$(this).css("word-break","normal");
		}
	});
}

function placeFileicon(rawname,displayName,pos){
	//Updated adapter for replacing the old multi AJAX request method to reduce the request number
	createDesktopIcon(displayName,rawname,pos)
	//console.log("[info]Placing desktop icon: " + displayName + " at " + pos[0] + "," + pos[1]);
}


function decodeFilename(filename,callback){
	$.ajax("../SystemAOB/functions/file_system/um_filename_decoder.php?filename=" + filename).done(function(data) {
		callback(data,filename)
	  })
}

function setIconsLocation(){
	$.ajax({url: "desktopInfo.php?username="+username+"&act=load", success: function(data){
       if (!data.includes("ERROR")){
		   iconPositions = data;
		   for (var i =0; i < iconPositions.length;i++){
			   var uid = iconPositions[i][0];
			   var posx = iconPositions[i][1];
			   var posy = iconPositions[i][2];
			   moveObjectWithUID(uid,posx,posy);
		   }
	   }else{
		   showNotification(data);
	   }
    }});
}

function moveObjectWithUID(uid,x,y){
	$(".launchIcon").each(function() {
		if ($(this).attr("uid").includes(uid)){
			$(this).css("left",x);
			$(this).css("top",y);
		}
	});
}

function RefreshDesktop(){
	hideAllContextMenu();
	if (preventRefresh){
	    //Updated 7-5-2019: Refresh has been overwritten by other process. Do not refresh the desktop now.
	    return;
	}
	var MyHostPos = [];
	$(".launchIcon").each(function(){
		if ($(this).attr("uid") == "MyHost"){
			MyHostPos = [$(this).position().left,$(this).position().top];
		}
	});
	//Try to keep the "MyHost" location at its original place
	if (MyHostPos[0] == 10 && MyHostPos[1] == 10){
		nextSlot=[10,110];
	}else{
		nextSlot=[10,10];
	}
	initUserDesktop(cleanAllIcons,"",1);
}

function cleanAllIcons(notification){
	$(".launchIcon").each(function(){
		if ($(this).attr("uid") != "MyHost" && $(this).attr("uid").includes(".shortcut") == false){
			$(this).remove();
		}
	});
}

function createFolderIcon(foldername,pos,decodedname=""){
	var targetType = "folder";
	var path = "Desktop/files/" + username + "/" + foldername;
	var displayName = foldername;
	if (decodedname != ""){
		displayName = decodedname;
	}
	if (pos == "" || pos[0] == undefined){
		while (checkCollide(nextSlot[0],nextSlot[1]) || checkIfSpaceAlreadyOccupiedByShortcut(nextSlot[0],nextSlot[1])){
			assignNextSlot(true);
		}
		setFileDesktopPositionFromFilename(foldername,nextSlot[0],nextSlot[1]);
		var html = '<div class="launchIcon" style="left:'+nextSlot[0]+'px; top: '+nextSlot[1]+'px;" align="center" path="'+path+'" targetType="' + targetType + '"  uid="'+ foldername +'" foldername="'+displayName+'"><img class="ts image non_selectable" src="img/system_icon/folder.png" style="cursor: pointer;margin-top:-15px;" onload="adjustLaunchIconHeight(this);">'+displayName+'</div>';
		assignNextSlot();
		initLaunchIconEvents();		
		addDraggingEvents();
		addContextMenuEvents();
		
	}else{
		var html = '<div class="launchIcon" style="left:'+pos[0]+'px; top: '+pos[1]+'px;" align="center" path="'+path+'" targetType="' + targetType + '"  uid="'+ foldername +'" foldername="'+displayName+'"><img class="ts image non_selectable" src="img/system_icon/folder.png" style="cursor: pointer;margin-top:-15px;" onload="adjustLaunchIconHeight(this);">'+displayName+'</div>';	
	}
	$(html).appendTo("body");
	initLaunchIconEvents();
	addDraggingEvents();
	addContextMenuEvents();
}

//The following event handler was added to the desktop to handle folder name overflow out of its container
function adjustLaunchIconHeight(object){
	var threshold = launchIconMaxHeight; //In pixel
	var target = $(object).parent();
	if(target.height() >= threshold){
		//This folder name require shortening
		var displayText = target.text().trim();
		var html = target.html().replace(displayText,"");
		target.html(html + displayText.substring(0,displayText.length - 5) + "...");
	}
}

function createDesktopIcon(filename,rawname,pos){
	//Filename is the decoded filename under upload manager scheme
	//while the rawname is the original filename stored on the system
	var icon = getIconFromPath(filename);
	//console.log(filename,rawname);
	var targetType = "file";
	var iconName = filename;
	var path = rawname;
	var moduleIcon = icon;
	if (filename.length > 17){
		var shortenedName = filename.substring(0,16) + "...";
	}else{
		var shortenedName = filename;
	}
	if (pos == "" || pos[0] == undefined){
		var newLocation = desktopEmptyPositions.shift();
		//Save the file location without refreshing
		setFileDesktopPositionFromFilename(rawname,newLocation[0],newLocation[1],undefined,undefined,true);
		appendToCurrentFileLocationList(filename,newLocation);
		assignNextSlot(true);
		var html = '<div class="launchIcon" style="left:'+newLocation[0]+'px; top: '+newLocation[1]+'px;padding-top:10px;" align="center" path="'+path+'" targetType="'+targetType+'" filename="'+iconName+'" uid="'+rawname+'"><i class="big '+moduleIcon+' icon"></i><div>'+shortenedName+'</div></div>';
		initLaunchIconEvents();
		addDraggingEvents();
		addContextMenuEvents();
	}else{
		var html = '<div class="launchIcon" style="left:'+pos[0]+'px; top: '+pos[1]+'px;padding-top:10px;" align="center" path="'+path+'" targetType="'+targetType+'" filename="'+iconName+'" uid="'+rawname+'"><i class="big '+moduleIcon+' icon"></i><div>'+shortenedName+'</div></div>';
	}
	$("body").append(html);
	initLaunchIconEvents();
	addDraggingEvents();
	addContextMenuEvents();
	var target = getObjectWithUID(rawname);
	if ($(target).height() >= launchIconMaxHeight - 7){
		//This launchIcon is too high!
		var displayText = $(target).text().trim();
		var html = $(target).html().replace(displayText,"");
		$(target).html(html + displayText.substring(0,displayText.length - 5) + "...");
		//console.log($(target).height(),$(target).text());
	}
}

function appendToCurrentFileLocationList(filename,pos){
	//Find the position of file in the filename list
	for (var i = 0; i < desktopFileNames.length; i++){
		if (desktopFileNames[i] == filename){
			desktopFileLocations[i] = pos;
		}
	}
}

function getIconFromPath(filename){
	var ext = getFileExt(filename);
	var icon = iconList[ext];
	if (ext == filename){
		//As there is not possible to split a "." with the current filename approach, the whole filename return when the array is pop
		icon = "folder";
		return icon;
	}
	if (icon == undefined){
		//Try to use lower case instead
		ext = ext.toLowerCase();
		icon = iconList[ext];
	}
	if (icon == undefined){
		//If the icon is still undefined, just use file outline
		icon = "file outline";
	}
	return icon;
}

function createShortcutIcon(filename,position){
	$.get( "loadShortcut.php?username=" + username + "&shortcutPath=" + filename, function(data) {
		if (data.includes("ERROR") == false){
			//If there exists this icon already (i.e. Reload desktop), remove it before appending the updated one
			$(".launchIcon").each(function(){
				if ($(this).attr("uid") == filename){
					$(this).remove();
				}
			});
			//Create the new icon on the desktop
			var targetType = data[0].trim();
			var iconName = data[1].trim();
			var path = data[2].trim();
			var moduleIcon = data[3].trim();
			var acceptFileType = data[4].trim();
			//Prepare to append new icon to desktop
			var iconpath = "../" + moduleIcon;
			if (moduleIcon.includes("http://") || moduleIcon.includes("https://") || moduleIcon.includes("/media/")){
				iconpath = moduleIcon;
			}
			if (position == "" || position[0] === undefined){
				while (checkCollide(nextSlot[0],nextSlot[1]) || checkIfSpaceAlreadyOccupiedByShortcut(nextSlot[0],nextSlot[1])){
					//console.log(checkCollide(nextSlot[0],nextSlot[1]),checkIfSpaceAlreadyOccupiedByShortcut(nextSlot[0],nextSlot[1]),nextSlot)
					assignNextSlot(true);
				}
				setFileDesktopPositionFromFilename(filename,nextSlot[0],nextSlot[1]);
				//var html = '<div class="launchIcon" style="left:'+nextSlot[0]+'px; top: '+nextSlot[1]+'px;" align="center" path="'+path+'" targetType="' + targetType + '" acceptFileExt="'+acceptFileType+'" uid="'+filename+'"><img class="ts image non_selectable" src="'+iconpath+'" style="cursor: pointer;width:68px;height:68px;">'+iconName+'</div>';
				position = $.extend(true, [], nextSlot);
				assignNextSlot(true);
			}
            
            if (targetType == "url"){
			    var html = '<div class="launchIcon" style="left:'+position[0]+'px; top: '+position[1]+'px;" align="center" path="'+path+'" targetType="' + targetType + '" acceptFileExt="'+acceptFileType+'" uid="'+filename+'"><img class="ts image non_selectable" src="'+iconpath+'" style="cursor: pointer;width:68px;padding:8px;">'+iconName+'</div>';	
		    }else if (targetType == "foldershrct"){
		        //margin-top:-15px;
		        var html = '<div class="launchIcon" style="left:'+position[0]+'px; top: '+position[1]+'px;" align="center" path="'+path+'" targetType="' + targetType + '" acceptFileExt="'+acceptFileType+'" uid="'+filename+'"><img class="ts image non_selectable" src="'+iconpath+'" style="cursor: pointer;width:68px;height:68px;margin-top:-15px;">'+iconName+'</div>';	
		    }else{
			    var html = '<div class="launchIcon" style="left:'+position[0]+'px; top: '+position[1]+'px;" align="center" path="'+path+'" targetType="' + targetType + '" acceptFileExt="'+acceptFileType+'" uid="'+filename+'"><img class="ts image non_selectable" src="'+iconpath+'" style="cursor: pointer;width:68px;height:68px;">'+iconName+'</div>';	
			}
            
            
			$("body").append(html);
			initLaunchIconEvents();
			addDraggingEvents();
			addContextMenuEvents();
			
		}else{
			showNotification("Desktop Shortcut Initializing Error. <br>" + data);
		}
	});
}

function assignNextSlot(preventShortcut = false, skipPosition=[-1,-1]){
	//Check if there is any icon that is already in this position
	var nextX = nextSlot[0];
	var nextY = nextSlot[1];
	//This file can overlap on top of shortcuts
	if (preventShortcut){
		while(checkCollide(nextX,nextY) || checkIfSpaceAlreadyOccupiedByShortcut(nextX,nextY) || (nextX == skipPosition[0] && nextY == skipPosition[1])){
			var nextX = nextSlot[0];
			var nextY = nextSlot[1] + 100;
			var sh = $(document).height();
			if (nextY > sh - 110){
				nextX += 80;
				nextY = 10;
			}
			nextSlot = [nextX,nextY];
		}
	}else{
		while(checkCollide(nextX,nextY) == true  || (nextX == skipPosition[0] && nextY == skipPosition[1])){
			var nextX = nextSlot[0];
			var nextY = nextSlot[1] + 100;
			var sh = $(document).height();
			if (nextY > sh - 110){
				nextX += 80;
				nextY = 10;
			}
			nextSlot = [nextX,nextY];
		}
	}
	
}

function checkIfSpaceAlreadyOccupiedByShortcut(x,y){
	for (var i = 0; i < desktopFileLocations.length;i++){
		if (desktopFileLocations[i][0] == x && desktopFileLocations[i][1] == y && desktopFileNames[i].includes(".shortcut")){
			return true;
		}
	}
	return false;
}

function checkCollide(x,y,object=null){
	var collide = false;
	$(".launchIcon").each(function(){
		if (x == $(this).position().left && y == $(this).position().top){
			if ($(this).attr("uid") != $(object).attr("uid")){
				collide = true;
			}
		}
		
	});
	return collide;
}


function getFileExt(filename){
	return filename.split('.').pop();
}

var dragStartLocation = [];
var dragEndLocation = [];
var dragLastLocation = [];
//Create drag events for all the launchIcon on Desktop
function addDraggingEvents(){
	//Add in line:  grid: [ 80, 100 ], for grid dragging movement
	$( ".launchIcon" ).draggable({
	   distance: 30,
	   opacity: 0.7,
	   zIndex: 100,
	   containment: "body",
	   start: function( event, ui ) {},
	   stop: function( event, ui ) {},
	   drag: function( event, ui ) {}
	});

	$( ".launchIcon" ).off("dragstart").on( "dragstart", function( event, ui ) {
		dragStartLocation = [event.clientX,event.clientY];
		dragStartLocation = roundToClosestGrid(dragStartLocation);
		preventRefresh = true;
		dragLastLocation = [event.clientX,event.clientY];
	});

	$( ".launchIcon" ).off("dragstop").on( "dragstop", function( event, ui ) {
		dragEndLocation = [event.clientX,event.clientY];
		dragEndLocation = roundToClosestGrid(dragEndLocation);
		var dragOnTop = checkCollide(dragEndLocation[0],dragEndLocation[1],this);
		//DragOnTop allows file to be drag drop into module (to open) or folder to moveEnd
		if (dragOnTop == true){
			//Try to see what it has been drag drop onto
			//Tips: newfw(url,title,icon,uid,1080,580);
			var anotherObject = getAnotherObjectOnTheSamePlace(dragEndLocation[0],dragEndLocation[1],this);
			if (anotherObject != false && $(this).attr("targetType") == "file"){
				var targetType = $(anotherObject).attr("targetType");
				if (targetType == "module" && $(anotherObject).attr("uid") != "MyHost"){
					var filepath = "../Desktop/files/" + username + "/" + $(this).attr("uid");
					var filename = $(this).attr("filename");
					var modulePath = $(anotherObject).attr("path") + "?filepath=" + filepath + "&filename=" + filename;
					newfw(modulePath,filename,getIconFromPath($(this).attr("uid")),$(anotherObject).attr("path").replace(".","_").replace(" ","_"));
					//Moving the icon back to its original position
					$(this).css({top: dragStartLocation[1], left: dragStartLocation[0]});
					RefreshDesktop();
				}else if (targetType == "folder"){
					//Check if there are multiple file selected. If yes, move them as well.
					if ($(".selectedApp").length > 1){
            	        //Multi selection of desktop objects
            	        var filepath = "Desktop/files/" + username + "/" +$(anotherObject).attr("uid");
            	        var uids = [];
            	        selectedObject = [];
            	        currentMovetoFolder = filepath;
            	        let uid = $(this).attr("uid");
        				selectedObject.push($(this));
        				uids.push(uid);
            	        $(".selectedApp").not(this).each(function(){
            	            let uid = $(this).attr("uid");
            	            //console.log(uid);
        					selectedObject.push($(this));
        					uids.push(uid);
            	        });
            	        //Updated 7-5-2019: Prevent file icon flashed during the moving process, refresh is disabled during the files being moved.
            	        preventRefresh = true; 
            	        moveFileToCurrentDirectory();
            	        selectedObject = [];
            	        for (var i =0; i < uids.length; i++){
            	            if (i != uids.length -1){
            	                removeDesktopPosition(uids[i]);
            	            }else{
            	                removeDesktopPosition(uids[i],true);
            	            }
            	        }
        			}else{
        			    //Otherwise only move one object
        			    var filepath = "Desktop/files/" + username + "/" +$(anotherObject).attr("uid");
    					var filename = $(this).attr("filename");
    					var uid = $(this).attr("uid");
    					//Use the moveFileTo API for moving files to the directory
    					selectedObject = [];
    					selectedObject.push($(this));
    					currentMovetoFolder = filepath;
    					//Updated 7-5-2019: Prevent file icon flashed during the moving process, refresh is disabled during the files being moved.
    					preventRefresh = true;
    					moveFileToCurrentDirectory();
    					selectedObject = [];
    					removeDesktopPosition(uid,true); //Remove and then reset preventRefresh
        			}
					//Refreshing the desktop files after finish
					RefreshDesktop();
				}else if (targetType == "foldershrct"){
					//Moving files to desktop shortcut files
					var filepath = $(anotherObject).attr("path");
					var filename = $(this).attr("filename");
					var uid = $(this).attr("uid");
					//Use the moveFileTo API for moving files to the directory
					selectedObject = [];
					selectedObject.push($(this));
					currentMovetoFolder = filepath;
					preventRefresh = true;
					moveFileToCurrentDirectory();
					selectedObject = [];
					removeDesktopPosition(uid);
					preventRefresh = false;
					//Refreshing the desktop files after finish
					RefreshDesktop();
				}else if (targetType == "module" && $(anotherObject).attr("uid") == "MyHost"){
					showNotification('Σ( ° △ °)?? Huh?');
					$(this).css({top: dragStartLocation[1], left: dragStartLocation[0]});
				}else{
					//Literally dragging one file on top of another file
					//Swap places between two objects
					var newPos = [$(anotherObject).css("top"),$(anotherObject).css("left")];
					$(anotherObject).css({top: dragStartLocation[1], left: dragStartLocation[0]});
					$(this).css({top: newPos[0], left: newPos[1]});
					saveDesktopPosition(this);
					saveDesktopPosition(anotherObject);
				}
				//RefreshDesktop();
			}else if (anotherObject != false && $(this).attr("targetType") == "folder"){
				//If user drag a folder onto something else
				if ($(anotherObject).attr("targetType") == "folder"){
					//Move this folder into the anotherObject directory
					var targetFolderPath = $(anotherObject).attr("uid");
					var thisFolderPath = JSON.stringify("../../../" + $(this).attr("path"));
					var hex = $(this).attr("uid") == $(this).attr("foldername");
					if (hex){
						hex = "true";
					}else{
						hex = "false";
					}
					
					var moveFullPath = JSON.stringify(targetFolderPath);
					let movingObject = $(this);
					//renameFile start from root path.
					console.log("[Desktop] Folder drag into folder function work in progress");
					$(this).css({top: dragStartLocation[1], left: dragStartLocation[0]});
					return;
					
				}
			}else{
				//Unknown drag operation. Cancel it and move the folder / module back to its original position
				$(this).css({top: dragStartLocation[1], left: dragStartLocation[0]});
			}
		}else{
			dragEndLocation = [event.clientX,event.clientY];
			dragEndLocation = roundToClosestGrid(dragEndLocation);
			$(this).css({top: dragEndLocation[1], left: dragEndLocation[0]});
			saveDesktopPosition(this);
			//If this dragging action involve more than one files
			if ($(".selectedApp").length > 1){
    	        //Multi selection of desktop objects
    	        $(".selectedApp").not(this).each(function(){
    	            thisLocation = [$(this).offset().left + 35, $(this).offset().top + 45];
    	            thisEndLocation = roundToClosestGrid(thisLocation);
    	            $(this).css({top: thisEndLocation[1], left: thisEndLocation[0]});
    	            saveDesktopPosition(this);
    	            delete thisLocation;
    	            delete thisEndLocation;
    	        });
			}
		}
		preventRefresh = false;
	});

	$( ".launchIcon" ).on( "drag", function( event, ui ) {
		if ($(".selectedApp").length > 1){
	        //Multi selection of desktop objects
	        $(".selectedApp").not(this).each(function(){
	            var dx = event.clientX - dragLastLocation[0];
	            var dy = event.clientY - dragLastLocation[1];
	                $(this).css('left',"+=" + dx);
	                $(this).css('top',"+=" + dy);
	        });
	       dragLastLocation = [event.clientX,event.clientY];
	    }
	});
	

}

function getAnotherObjectOnTheSamePlace(x,y,object){
	var object = false;
	$(".launchIcon").each(function(){
		if (x == $(this).position().left && y == $(this).position().top){
			if ($(this).attr("uid") != $(object).attr("uid")){
				object = this;
			}
		}
		
	});
	return object;
}

/**
Context Menu Append related functions
This section of code create the context menu of the desktop environment
**/

function addContextMenuEvents(){
	//Function to handle launchIcon being clicked and show lcm
	//Incase you want to know what is LCM, it stands for Left Clicked Menu :)
	//The lcm will show by default page context menu handler, this function is only for changing its content
	$( ".launchIcon" ).contextmenu(function() {
		if (selectedObject.length > 1){
			//Multiple objects are selected
			clearRightClickMenu();
			appendToRightClickMenu("Open","openSelectedObject");
			appendToRightClickMenu("Zip here","zipToHere");
			appendToRightClickMenu("Move  <i class='caret right icon' style='right:0;position:absolute'></i>","openMoveToSelectionMenu");
			appendToRightClickMenu("divider");
			appendToRightClickMenu("Download in zip<i class='download icon' style='right:0;position:absolute'></i>","downloadFromURL");
			appendToRightClickMenu("Make Copies","copyFiles");
			appendToRightClickMenu("Delete","confirmDelete");
			appendToRightClickMenu("divider");
			appendToRightClickMenu("Properties","showProperties");
		}else{
			//Only one object is selected. Target that object for generating the menu
			var path = $(this).attr("path");
			var type = $(this).attr("targetType");
			if (type == "module"){
				//If the right clicked icon is a module, then show module menu list
				if ( $(this).attr("uid") == "MyHost"){
					//MyHost is a special icon in which it needed to have a seperated menu
					clearRightClickMenu();
					appendToRightClickMenu("Open","openSelectedObject");
					appendToRightClickMenu("Open Shortcut Location","openShortcutLocation");
					appendToRightClickMenu("divider");
					appendToRightClickMenu("Open Trash Bin <i class='trash icon' style='right:0;position:absolute'></i>","showTrashBin");
					appendToRightClickMenu("System Settings <i class='setting outline icon' style='right:0;position:absolute'></i>","openSystemSetting");
					//appendToRightClickMenu("Power Options <i class='power icon' style='right:0;position:absolute'></i>","");
					appendToRightClickMenu("divider");
					appendToRightClickMenu("Host Info <i class='server icon' style='right:0;position:absolute'></i>","showProperties");
				}else{
					clearRightClickMenu();
					appendToRightClickMenu("Open","openSelectedObject");
					appendToRightClickMenu("Open Shortcut Location","openShortcutLocation");
					appendToRightClickMenu("divider");
					appendToRightClickMenu("Delete","confirmDelete");
					appendToRightClickMenu("Rename","rename");
					appendToRightClickMenu("divider");
					appendToRightClickMenu("Properties","showProperties");
				}
				
			}else if (type == "file"){
				//If the right clicked icon is a file, then show file menu list
				clearRightClickMenu();
				appendToRightClickMenu("Open","openSelectedObject");
				appendToRightClickMenu("Open with <i class='caret right icon' style='right:0;position:absolute'></i>","showOpenWithMenu");
				appendToRightClickMenu("Share <i class='external icon' style='right:0;position:absolute'></i>","share");
				appendToRightClickMenu("Move <i class='caret right icon' style='right:0;position:absolute'></i>","openMoveToSelectionMenu");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Download <i class='download icon' style='right:0;position:absolute'></i>","downloadFromURL");
				appendToRightClickMenu("Make a Copy","copyFiles");
				appendToRightClickMenu("Rename","rename");
				appendToRightClickMenu("Delete","confirmDelete");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Properties","showProperties");
			}else if (type == "folder"){
				var foldername = selectedObject[0].attr("foldername");
				clearRightClickMenu();
				appendToRightClickMenu("Open","openSelectedObject");
				//appendToRightClickMenu("Send to zip","");
				appendToRightClickMenu("Zip here","zipToHere");
				//appendToRightClickMenu("Upload to " + foldername,"");
				appendToRightClickMenu("Move  <i class='caret right icon' style='right:0;position:absolute'></i>","openMoveToSelectionMenu");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Download in zip<i class='download icon' style='right:0;position:absolute'></i>","downloadFromURL");
				appendToRightClickMenu("Make a Copy","copyFiles");
				appendToRightClickMenu("Rename","rename");
				appendToRightClickMenu("Delete","confirmDelete");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Properties","showProperties");
			}else if (type == "foldershrct" || type == "script" || type == "url"){
				clearRightClickMenu();
				appendToRightClickMenu("Open","openSelectedObject");
				appendToRightClickMenu("Move  <i class='caret right icon' style='right:0;position:absolute'></i>","openMoveToSelectionMenu");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Rename","rename");
				appendToRightClickMenu("Delete","confirmDelete");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Properties","showProperties");
				
			}else{
				clearRightClickMenu();
				appendToRightClickMenu("Open","openSelectedObject");
				appendToRightClickMenu("Move  <i class='caret right icon' style='right:0;position:absolute'></i>","openMoveToSelectionMenu");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Delete","confirmDelete");
				appendToRightClickMenu("divider");
				appendToRightClickMenu("Properties","showProperties");
			}
		}

	});
	
	$("#lcm .item").hover(function(){
		$(this).addClass("hovering");
	},function(){
		$(this).removeClass("hovering");
	});
	
	
}

function loadDesktopContextMenu(){
	//If the right clicked target is the background instead
	clearRightClickMenu();
	appendToRightClickMenu("New  <i class='caret right icon' style='right:0;position:absolute'></i>","newItem");
	appendToRightClickMenu("Refresh <i class='refresh right icon' style='right:0;position:absolute'></i>","RefreshDesktopWithNotification");
	appendToRightClickMenu("Open File Explorer","openDesktopAsFolder");
	appendToRightClickMenu("Download from URL","downloadToDesktop");
	appendToRightClickMenu("Upload to Desktop","desktopUploadTips");
	appendToRightClickMenu("divider");
	appendToRightClickMenu("Desktop Transfer <i class='exchange right icon' style='right:0;position:absolute'></i>","stateTransfer");
	appendToRightClickMenu("Personalization <i class='paint brush icon' style='right:0;position:absolute'></i>","openThemeSelector");
	appendToRightClickMenu("Background <i class='caret right icon' style='right:0;position:absolute'></i>","loadBackgroundTheme");
	appendToRightClickMenu("Toggle FullScreen  <i class='maximize right icon' style='right:0;position:absolute'></i>","fullScreenMode");
	appendToRightClickMenu("Exit Virtual Desktop","extvdi");
	
}

function openThemeSelector(){
	newfw("Desktop/themeSelector.php","Personalization - Theme Color","eyedropper","desktopThemeSelector",640,460,window.innerWidth/2 - 320,window.innerHeight/2 - 230,false,false);
	hideAllContextMenu();
}

function stateTransfer(){
	newfw("Desktop/stateTransfer.php","Desktop State Transfer","desktop","desktopStateTransfer",390,590,window.innerWidth/2 - 195,window.innerHeight/2 - 295,false,false);
	hideAllContextMenu();
}

function RefreshDesktopWithNotification(){
	RefreshDesktop();
	showNotification("<i class='refresh icon'></i> Desktop Refreshed");
}

function extvdi(){
	window.top.location.href = "../index.php";
}

function share(){
	hideAllContextMenu();
	var target = selectedObject[0];
	var filename = target.attr("uid");
	var filepath = "../../../Desktop" + "/files/" + username + "/" + filename;
	var filename = target.attr("filename");
	//window.open("../SystemAOB/functions/file_system/download.php?file_request=" + filepath + "&filename=" + JSON.stringify(filename));
	var url = "../QuickSend/index.php?share=" + window.location.href + "../SystemAOB/functions/file_system/download.php?file_request=" + filepath + "&filename=" + JSON.stringify(filename);
	window.open(url.replace("&","<and>"));
}

function desktopUploadTips(){
	hideAllContextMenu();
	parent.msgbox("Drag and drop the file(s) you want to upload to the browser for uploading to the Virtual Desktop Environment.","<i class='desktop icon'></i>Virtual Desktop Tips");
}

function openSystemSetting(){
	hideAllContextMenu();
	newfw("System Settings/index.php","System Settings","setting","system_setting",1300,650,50,50);
}

/**
View desktop as folder in file explorer
**/
function openDesktopAsFolder(){
	hideAllContextMenu();
	var uid = Math.round((new Date()).getTime() / 1000);
	var url = "SystemAOB/functions/file_system/index.php?controlLv=2&finishing=embedded&subdir=Desktop/files/" + username;
	var title = "Desktop" + " - Folder View";
	var icon = "folder open";
	newfw(url,title,icon,uid,1080,580,undefined,undefined,true,true);
}

/**
New item menu on Desktop
**/
function newItem(btnobject){
clearAdvanceMenu();
	var toppos = $(btnobject).position().top + $(btnobject).parent().position().top;
	$(btnobject).addClass("selectedMenu");
	appendToAdvanceMenu("Folder <i class='folder open icon' style='right:0;position:absolute'></i>","newFolderOnDesktop");
	appendToAdvanceMenu("Shortcut <i class='external icon' style='right:0;position:absolute'></i>","showNewShortcutCreationUtitlties");
	appendToAdvanceMenu("divider");
	for (var i = 0; i < newItemList.length; i++){
		appendToAdvanceMenu("<i class='" + newItemList[i][2] + " icon'></i> " + newItemList[i][0],"createNewItem('" + newItemList[i][1] +"');");
	}
	launchAdvanceMenu(toppos);
}

function createNewItem(ext){
	let gridPosition = roundToClosestGrid([$("#lcm").position().left,$("#lcm").position().top]);
	hideAllContextMenu();
	$.get( "newItem.php?ext=" + ext + "&username=" + username, function(data) {
		if (data.includes("ERROR") == false){
			console.log(data.trim(),gridPosition[0],gridPosition[1]);
			setFileDesktopPositionFromFilename(data.trim(),gridPosition[0],gridPosition[1],RefreshDesktop);
		}else{
			//Something goes wrong
			parent.msgbox("Error occured while creating a new file on Desktop environment.<br>" + data,"<i class='desktop icon'></i>Desktop Error");
		}
	});
}
/**
New Objects (not menu, item creation) on Desktop
**/
function newFolderOnDesktop(){
	var path = "../../../Desktop/" + "files/" + username + "/";
	var foldername = "Folder";
	let gridPosition = roundToClosestGrid([$("#lcm").position().left,$("#lcm").position().top]);
	var count = 1;
	hideAllContextMenu();
	while (checkIfFolderNameExists(foldername)){
		foldername = "Folder(" + count + ")";
		count++;
	}
	$.post( "../SystemAOB/functions/file_system/newFolder.php",{folder:path,hex:false,foldername:foldername}, function(data) {
		if (data.includes("ERROR") == false){
			setFileDesktopPositionFromFilename(foldername,gridPosition[0],gridPosition[1],newObjectHandler,foldername);
		}else{
			showNotification("Error occured while creating a new folder.");
		}
		delete gridPosition;
	});
}

function newObjectHandler(objectuid){
	setTimeout(function(){
		$(".launchIcon").each(function(){
			var uid = $(this).attr("uid");
			if (uid == objectuid){
				selectedObject = [];
				selectedObject.push($(this));
				rename();
			}
		});
	}, 100);
	
}

function checkIfFolderNameExists(foldername){
	var exists = false;
	$(".launchIcon").each(function(){
		var targetType = $(this).attr("targetType");
		if (targetType == "folder"){
			if ($(this).attr("foldername") == foldername){
				exists = true;
			}
		}
	});
	return exists;
}

function showNewShortcutCreationUtitlties(){
	hideAllContextMenu();
	var shortcutCreatorURL = "Desktop/createShortcut.php?username=" + username;
	newfw(shortcutCreatorURL,"Shortcut Creation Utilities","external square","ShortCutCreator",500,400,undefined,undefined,false);
}

/**
Download from URL and Upload to Desktop related functions
**/

function downloadToDesktop(){
	var gridPosition = roundToClosestGrid([$("#lcm").position().left,$("#lcm").position().top]);
	hideAllContextMenu();
	console.log(gridPosition);
	var url = prompt("Please enter an URL to download", "");
	if (url == null || url == "") {
		showNotification("<i class='remove icon'></i>Download Cancelled");
		return;
	}else{
		$.post("downloadToDesktop.php?username=" + username,{requesturl: JSON.stringify(url)}).done(function(data){
			if (data.includes("ERROR")){
				showNotification('<i class="remove icon"></i>' + data);
			}else{
				var filename = data[0];
				setFileDesktopPositionFromFilename(filename,gridPosition[0],gridPosition[1],RefreshDesktop);
				showNotification("<i class='checkmark icon'></i> Download Completed");
			}
		});
	}
	
}


/**
Remove or delete file related functions
**/
function confirmDelete(bypass = false) {
	//If bypass is passed in as true, it will not ask for confirm delete
	hideAllContextMenu();
	var message = "";
	if (selectedObject.length > 1){
		message = "Are you sure you want to send " + selectedObject.length + " item(s) to Trash Bin?";
	}else{
		var targetType = selectedObject[0].attr("targetType");
		var object = selectedObject[0];
		if (targetType == "file"){
			message = "Are you sure you want to send '" + object.attr("filename") + "' to Trash Bin?";
		}else if (targetType == "folder"){
			message = "Are you sure you want to send folder '" + object.attr("foldername") + "' to Trash Bin?";
		}else if (targetType == "module" || targetType == "foldershrct"){
			message = "Are you sure you want to remove shortcut to " + object.attr("path");
		}else{
			message = "Are you sure you want to remove object " + object.attr("uid");
		}
		 
	}

	if (bypass == true || confirm(message) == true){
		var fileList = [];
		//Tidy up the information and prepare to send them to PHP handler
		for(var i =0; i < selectedObject.length; i++){
			//For each removed item, there will be a uuid which points to a special location of the file in trashbin.
			var uuid = guid();
			var filename = selectedObject[i].attr("uid"); //UID is the same as original filename in this case
			var fileType = selectedObject[i].attr("targetType");
			var displayName = "";
			if (fileType == "file"){
				displayName = selectedObject[i].attr("filename");
			}else if (fileType == "folder"){
				displayName = selectedObject[i].attr("foldername");
			}else{
				displayName = selectedObject[i].attr("uid");
			}
			fileList.push([uuid,filename,displayName]);
			removeDesktopPosition(filename);
		}
		$.post("trashBin.php?username=" + username,{filelist: JSON.stringify(fileList)}).done(function(data){
			if (data.includes("ERROR")){
				showNotification('<i class="remove icon"></i>' + data);
			}else{
				showNotification('<i class="trash icon"></i> File(s) moved to Trash Bin');
				for(var i =0; i < selectedObject.length; i++){
					//Shortcut is actually cleared up in the backstage but cannot update GUI via refresh. Icon will be cleared in this loop.
					var targetType = selectedObject[i].attr("targetType");
					if (targetType == "module"){
						selectedObject[i].remove();
					}
					
				}
				RefreshDesktop();
			}
		});
	}else{
		
	}
   
}

function guid() {
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
Rename related functions
**/

function rename(){
	//This function only allow one object to be renamed at the same time
	hideAllContextMenu();
	var target = selectedObject[0];
	var type = target.attr("targetType");
	var position = [target.offset().left,target.offset().top];
	if (type == "file"){
		var originalFilename = target.attr("filename");
		previousName = [target.attr("uid"),originalFilename,position];
		target.html(target.html().replace(target.text(),'<textarea class="textplace renamebox" onkeydown="auto_grow(this);" type="text" style="z-index:16">'+originalFilename +'</textarea>'));
	}else if (type == "folder"){
		var originalFilename = target.attr("foldername");
		previousName = [target.attr("uid"),originalFilename,position];
		target.html(target.html().replace(target.text(),'<textarea class="textplace renameboxfolder" onkeydown="auto_grow(this);" type="text" style="z-index:16">'+originalFilename +'</textarea>'));
	}else{
		var originalFilename = target.text();
		let preview = target.find("img")[0];
		previousName = [target.attr("uid"),originalFilename,position];
		target.text("");
		target.html(preview);
		target.append('<textarea class="textplace renameboxfolder" onkeydown="auto_grow(this);" type="text" style="z-index:16">'+originalFilename +'</textarea>');
	}
	
	target.css("z-index",50); //The z-index setting need not to be reset as the whole page reset after rename.
	var textareaobject = target.find('textarea')[0];
	auto_grow(textareaobject);
	setInputSelection(textareaobject,0,originalFilename.lastIndexOf("."))
	renaming = true;
	textareaobject.focus();
	$(target.find('textarea')[0]).off().on('keydown',function(event) {
		if (event.keyCode === 13) {
			event.preventDefault();
			confirmRename($(this).val());
		}
	});
	initLaunchIconEvents(true);
	addDraggingEvents();
	addContextMenuEvents();
	
}

function setInputSelection(input, startPos, endPos) {
    input.focus();
    if (typeof input.selectionStart != "undefined") {
        input.selectionStart = startPos;
        input.selectionEnd = endPos;
    } else if (document.selection && document.selection.createRange) {
        // IE branch
        input.select();
        var range = document.selection.createRange();
        range.collapse(true);
        range.moveEnd("character", endPos);
        range.moveStart("character", startPos);
        range.select();
    }
}

function auto_grow(element) {
    element.style.height = "5px";
    element.style.height = (element.scrollHeight) + 14 + "px";
}

function confirmRename(newname){
	if (newname == "" || newname == previousName[1]){
		RefreshDesktop(); //Cencel rename process as nothing is entered in the rename textarea
	}else{
		//Rename the file to the set filename
		$(".launchIcon").each(function(){
			if ($(this).attr("uid") == previousName[0]){
				$(this).find('textarea').remove();
				$(this).append(newname);
			}
		});
		//Actually doing the rename job in the background so it looks faster on the user's browser
		$.post("renameDesktopFile.php?username=" + username,{filename: JSON.stringify(previousName[0]),newfilename: JSON.stringify(newname)}).done(function(data){
			if (data.includes("ERROR")){
				showNotification('<i class="remove icon"></i>' + data);
				RefreshDesktop();
			}else{
				var pos = previousName[2];
				removeDesktopPosition(previousName[0]);
				setFileDesktopPositionFromFilename(data,pos[0],pos[1],RefreshDesktop);
				showNotification("<i class='checkmark icon'></i> File / Folder renamed");
			}
		});
	}
	renaming = false;
	
}

/**
Move functions related menu items and functions
**/
function openMoveToSelectionMenu(btnobject){
	clearAdvanceMenu();
	var toppos = $(btnobject).position().top + $(btnobject).parent().position().top;
	$("#lcm .item").each(function(){
		$(this).removeClass("selectedMenu");
	});
	$(btnobject).addClass("selectedMenu");
	//Overwrite Mode: Overwrite everything, including remove files that is not exists in source directory
	//Skip mode: If file exists, skip moving this file
	appendToAdvanceMenu("Move Skip <i class='caret right icon movefilemenuitem' style='right:0;position:absolute'></i>","moveSkip");
	appendToAdvanceMenu("Move Overwrite <i class='caret right icon movefilemenuitem' style='right:0;position:absolute'></i>","moveWithOverwrite");
	appendToAdvanceMenu("Move Skip (Ext.Storage) <i class='caret right icon movefilemenuitem' style='right:0;position:absolute'></i>","moveSkipExternal");
	appendToAdvanceMenu("Move Overwrite (Ext.Storage) <i class='caret right icon movefilemenuitem' style='right:0;position:absolute'></i>","moveWithOverwriteExternal");
	launchAdvanceMenu(toppos);
}


function moveWithPath(startPath,overwrite = false){
	moveOverwrite = overwrite;
	currentMovetoFolder = "";
	setFolderChooseMenuPath(startPath);
	$("#fchead").html('<div class="displaybox">Loading</div>');
	$("#fclist").html("");
	
}

function clearMoveSelectionHighlight(){
	$(".movefilemenuitem").each(function(){
		var object = $(this).parent();
		object.removeClass("selectedMenu");
	});
}

function moveWithOverwrite(btnobject){
	var toppos = $(btnobject).offset().top - 1; 
	var leftpos = $(btnobject).offset().left + $(btnobject).parent().width();
	clearMoveSelectionHighlight();
	$(btnobject).addClass("selectedMenu");
	moveWithPath("Desktop/files/" + username,true);
	launchDirectoryChooser([leftpos,toppos]);
}


function moveSkip(btnobject){
	var toppos = $(btnobject).offset().top - 1; 
	var leftpos = $(btnobject).offset().left + $(btnobject).parent().width();
	clearMoveSelectionHighlight();
	$(btnobject).addClass("selectedMenu");
	moveWithPath("Desktop/files/" + username);
	launchDirectoryChooser([leftpos,toppos]);
}

function moveSkipExternal(btnobject){
	var toppos = $(btnobject).offset().top - 1; 
	var leftpos = $(btnobject).offset().left + $(btnobject).parent().width();
	clearMoveSelectionHighlight();
	$(btnobject).addClass("selectedMenu");
	moveWithPath("/media");
	launchDirectoryChooser([leftpos,toppos]);
}

function moveWithOverwriteExternal(btnobject){
	var toppos = $(btnobject).offset().top - 1; 
	var leftpos = $(btnobject).offset().left + $(btnobject).parent().width();
	clearMoveSelectionHighlight();
	$(btnobject).addClass("selectedMenu");
	moveWithPath("/media",true);
	launchDirectoryChooser([leftpos,toppos]);
}

function proceedToNextPath(object){
	var rawname = $(object).attr("rawname");
	var filename = $(object).text();
	setFolderChooseMenuPath(rawname,filename);
}

/**
Folder creation functions releated to the MoveTo Menu
**/
function newfolderInFolderChooseMenu(){
	$("#fchead").html("");
	$("#fclist").html("");
	$("#fchead").append("<div style='display:inline;cursor:pointer;' onClick='refreshFolderMenu();'><i class='arrow left icon'></i></div>");
	$("#fchead").append('<div class="ts tiny input" style="height:25px;border-radius: 0px !important;"><input id="newfoldername" class="textplace" type="text" placeholder="Untitled Folder" style="border-radius: 0px !important;"></div>');
	$("#fchead").append('<button class="ts mini primary button" style="height:25px;padding-top:2px;padding-bottom:2px;border-radius: 0px !important;" onClick="createNewFolder();"><i class="check icon"></i></button>');
	$("#newfoldername").focus();
}

function createNewFolder(){
	var foldername = $("#newfoldername").val();
	if (foldername == ""){
		foldername = "Untiled Folder";
	}
	$.post("moveFilesTo.php?act=newFolder&path=" + currentMovetoFolder,{foldername: JSON.stringify(foldername)}).done(function(data){
        if (data.includes("ERROR")){
			showNotification(data);
		}else{
			refreshFolderMenu();
		}
    });
}

//Move the selected item(s) to the the selected directory
function moveFileToCurrentDirectory(){
	var objects = selectedObject;
	for(var i = 0; i < objects.length;i++){
		var targetPath = currentMovetoFolder;
		if (targetPath == ""){
			targetPath = "/";
		}
		var fileList = [];
		for(var i=0; i <selectedObject.length;i++){
			fileList.push(selectedObject[i].attr("uid"));
		}
		if (moveOverwrite){
			$.post("moveFilesTo.php?act=moveFilesOverwrite&path=" + currentMovetoFolder + "&username=" + username,{filelist: JSON.stringify(fileList)}).done(function(data){
				if (data.includes("ERROR") == false){
					//console.log(data);
					showNotification("<i class='checkmark icon'></i> "  + (data[0] + data[1]) + " file(s) moved with " + data[1] + " file(s) overwritten.");
					for(var i =0; i < data[2].length;i++){
						removeDesktopPosition(data[2][i]);
					}
					RefreshDesktop();
				}else{
					showNotification(data);
				}
				
			});
		}else{
			$.post("moveFilesTo.php?act=moveFiles&path=" + currentMovetoFolder + "&username=" + username,{filelist: JSON.stringify(fileList)}).done(function(data){
				if (data.includes("ERROR") == false){
					//console.log(data);
					showNotification("<i class='checkmark icon'></i> " + +data[0] + " file(s) moved and " + data[1] + " file(s) skipped.");
					for(var i =0; i < data[2].length;i++){
						removeDesktopPosition(data[2][i]);
					}
					RefreshDesktop();
				}else{
					showNotification(data);
				}
				
			});
		}
	}
}

function refreshFolderMenu(){
	setFolderChooseMenuPath("");
}

//Update the current path of the folder choose menu
function setFolderChooseMenuPath(path = null,foldername = ""){
	clearDirectoryChooser();
	appendToFolderChooseMenu("<div style='width:100%;' align='center'>Waiting for Remote Filesystem</div>","");
	appendToFolderChooseMenu("<div style='width:100%;' align='center'><i class='loading spinner icon'></i></div>","");
	if (path == null){
		//Reverse one path backward
		currentMovetoFolder = dirname(currentMovetoFolder);
	}else if (path == ""){
		path == "./";
	}else{
		currentMovetoFolder = currentMovetoFolder + "/" + path;
	}
	currentMovetoFolder = currentMovetoFolder.replace("//","/");
	$.ajax({
		url:"getPaths.php?path=" + currentMovetoFolder,  
		success:function(data) {
			clearDirectoryChooser();
			if (data.includes("ERROR")){
				$("#fchead").html('<div class="displaybox"><i class="folder outline icon"></i>' + currentMovetoFolder + '</div>');
				if (currentMovetoFolder.includes("/media")){
					$("#fclist").append('<div class="menubox"><i class="usb icon"></i>No drive mounted</div>');
				}else{
					$("#fclist").append('<div class="menubox"><i class="remove icon"></i>Directory not exists</div>');
				}
			}else{
				if (currentMovetoFolder == ""){
					var showpath = '<i class="home icon"></i>aor/';
				}else if (foldername != ""){
					var showpath = '<i class="folder icon"></i>' + foldername;
				}else{
					var showpath = '<i class="folder icon"></i>' + currentMovetoFolder.split("/").pop();
				}
				$("#fchead").html('<div class="displaybox">'+showpath+'</div>');
				if (currentMovetoFolder != "" && currentMovetoFolder != "/media"){
					$("#fclist").append('<div class="menubox" onClick="setFolderChooseMenuPath();"><i class="arrow left icon"></i> Parent Directory</div>');
				}
				for(var i =0; i < data.length; i++){
					$("#fclist").append('<div class="menubox" onClick="proceedToNextPath(this);" rawname="' +data[i][0] + '"><i class="folder outline icon"></i>'+data[i][1]+'</div>');
				}
			}
		}
	});
	
}

function launchDirectoryChooser(pos){
	var x = pos[0];
	var y = pos[1];
	var sw = $("#folderChoose").width();
	var sh = $("#folderChoose").height();
	//Check if launching the menu on the right will overflow or not
	if (x + sw > $(window).width()){
	    //width overflow. Moving the menu to the left of the parent menu
	    x = $("#rcm").offset().left - sw;
	}
	var windowHeight = $(window).height() || window.innerHeight;
	if (y + sh > windowHeight){
	    //height overflow. Moving the menu upward to fit
	    y = y + 25 - sh;
	}
	$("#folderChoose").css("left",x);
	$("#folderChoose").css("top",y);
	$("#folderChoose").show();
}

function clearDirectoryChooser(){
	$("#fclist").html("");
}


/**
Utilities functions for general usage and quick settings
**/
//If download is pressed (This handle all events on page including file, folder and multi select download
function downloadFromURL(){
	hideAllContextMenu();
	if (selectedObject.length > 1){
		var fileList = [];
		for(var i=0; i <selectedObject.length;i++){
			fileList.push(selectedObject[i].attr("uid"));
		}
		showNotification("<i class='archive icon'></i> Zipping started on " + selectedObject.length + " files.");
		$.post("createZip.php?mode=zipWindow&username=" + username,{filelist: JSON.stringify(fileList)}).done(function(data){
			//console.log(data);
			downloadURI(data[0],data[1]);
		});
	}else{
		//Download Single File
		var object = selectedObject[0];
		var targetType = $(object).attr("targetType");
		if (targetType == "file"){
			//If the download target is a single file
			var filename = object.attr("filename");
			var url = "files/" + username + "/" + object.attr("uid");
			downloadURI(url,filename);
		}else if (targetType == "folder"){
			//If the download target is a single folder, we need to zip it before downloading
			var filename = object.attr("uid");
			var path = object.attr("path");
			//As zipping required at least one file / folder inside folder, this is used to check if this folder contain file or folder
			$.ajax({
				url:"recursiveScanDir.php?relativePath=../" + path,  
				success:function(data) {
					if (data.includes("ERROR")){
						showNotification("ERROR. Unable to access this folder.");
					}else{
						if (data.length >= 1){
							showNotification("<i class='archive icon'></i> Zipping started on " + filename);
							var fileList = [];
							for(var i=0; i <selectedObject.length;i++){
								fileList.push(selectedObject[i].attr("uid"));
							}
							$.post("createZip.php?mode=zipWindow&username=" + username,{filelist: JSON.stringify(fileList)}).done(function(data){
								//console.log(data);
								downloadURI(data[0],data[1]);
							});
							//Removed due to slow speed and not effecent
							/* $.ajax({
								url:"../SystemAOB/functions/file_system/zipFolder.php?folder=../../../" + path + "/",  
								success:function(data) {
									if (data.includes("ERROR") == false){
										var zippedFilename = data;
										downloadURI("../SystemAOB/functions/file_system/export/" + data,filename + ".zip");
									}else{
										if (data.includes("font size='1'")){
											showNotification("[!?] Server script has crashed.");
										}else{
											showNotification(data);
										}
										
									}
								
							}
							}); */
						}else{
							showNotification("<i class='remove icon'></i> There is no file to zip inside this folder.");
						}
					}
					
				}
			});

		}
		
	}
}

function zipToHere(){
	//Zip the selected items here
	hideAllContextMenu();
	var fileList = [];
	for(var i=0; i <selectedObject.length;i++){
		fileList.push(selectedObject[i].attr("uid"));
	}
	showNotification("<i class='archive icon'></i> Zipping " + selectedObject.length + " files to Desktop.");
	if (selectedObject.length == 1 && selectedObject[0].attr("targetType") == "folder"){
		var filename = selectedObject[0].attr("foldername");
		$.post("createZip.php?mode=zipTo&username=" + username + "&target=" + "files/" + username + "/",{filelist: JSON.stringify(fileList),filename: filename}).done(function(data){
			if (data.includes("ERROR") == false){
				RefreshDesktop();
			}else{
				showNotification(data);
			}
			
		});
	}else{
		$.post("createZip.php?mode=zipTo&username=" + username + "&target=" + "files/" + username + "/",{filelist: JSON.stringify(fileList)}).done(function(data){
			console.log(data);
		});
	}
	
}

//Append function for Folder choosing menu
function appendToFolderChooseMenu(text,callback){
	if (text == "divider"){
		var divider = '<div class="divider"></div>';
		$("#fclist").append(divider);
	}else if (callback == ""){
		var template = '<div class="menubox">'+text+'</div>';
		$("#fclist").append(template);
	}else{
		if (callback.includes("(") == false && callback.includes("(") == false){
			var template = '<div class="menubox" onClick="'+callback+'(this);">'+text+'</div>';
		}else{
			var template = '<div class="menubox" onClick="'+callback+';">'+text+'</div>';
		}
		$("#fclist").append(template);
	}
}

/**
Background update and setting functions
**/

//Change background option is selected
function loadBackgroundTheme(btnobject){
	clearAdvanceMenu();
	var toppos = $(btnobject).position().top + $(btnobject).parent().position().top;
	$(btnobject).addClass("selectedMenu");
	appendToAdvanceMenu("<div style='width:100%;' align='center'><i class='spinner loading icon'></i></div>","");
	 $.ajax({url: "getBackgroundThemes.php", success: function(result){
        if (result.includes("ERROR") == false){
			clearAdvanceMenu();
			for (var i=0; i < result.length;i++){
				var icon = "";
				if (result[i][0] == theme){
					icon = "<i class='check circle outline icon' style='right:0;position:absolute'></i>";
				}
				appendToAdvanceMenu(result[i][0] + icon,"setBackgroundTheme('" +  result[i][0] +"')");
			} 
			launchAdvanceMenu(toppos);
		}else{
			clearAdvanceMenu();
			appendToAdvanceMenu(result,"");
		}
    }});
	launchAdvanceMenu(toppos);
}

function setBackgroundTheme(themename){
	hideAllContextMenu();
	theme = themename;
	GetBGCount(true);
	localStorage.setItem("desktop-theme-" + username.replace(/\W/g, ''), themename);
	showNotification("<i class='checkmark icon'></i> Background changed.");
	bgNumber = 0;
	bgPhrase = 0;
	ChangeBG();
}

/**
Open with -> function menu
**/
function showOpenWithMenu(btnobject){
	//This menu is only shown when one file is selected, no need to do forloop check
	$("#folderChoose").hide();
	var object = selectedObject[0];
	var toppos = $(btnobject).position().top + $(btnobject).parent().position().top;
	$("#lcm .item").each(function(){
		$(this).removeClass("selectedMenu");
	});
	$(btnobject).addClass("selectedMenu");
	clearAdvanceMenu();
	appendToAdvanceMenu("Default","openWithDefaultOpener");
	appendToAdvanceMenu("New Tab <i class='external icon' style='right:0;position:absolute'></i>","openFileinNewTab");
	appendToAdvanceMenu("divider","");
	for(var i =0; i < openWithModuleList.length;i++){
		if (openWithModuleList[i][2] == true){
			var basename = openWithModuleList[i][0].split("/").pop();
			appendToAdvanceMenu(basename,"openWithSelectedModule('"+basename+"')");
		}
	}
	launchAdvanceMenu(toppos);
	
}

function openWithSelectedModule(moduleName){
	hideAllContextMenu();
	var filename = selectedObject[0].attr("uid");
	//filename = filename.split("&").join("%26");
	filename = encodeURIComponent(filename);
	//As this will launch module from their root path, this have to be relative to its location
	var url = "../Desktop/files/" + username + "/" + filename;
	var displayName = encodeURIComponent(selectedObject[0].attr("filename"));
	parent.newEmbededWindow(moduleName + "/embedded.php?filepath=" + url + "&filename=" + displayName,'Initializing','',(filename + "-ow_" + moduleName).hashCode());
	//This uid ensure that the file can be opened by different module while each module only open one instance.
	
}

function openWithDefaultOpener(){
	hideAllContextMenu();
	launchDesktopIcon(selectedObject[0]);
}

/**
Copy related functions
**/
function copyFiles(){
	hideAllContextMenu();
	for(var i =0;i < selectedObject.length;i++){
		var thisLaunchIcon = selectedObject[i];
		var fileType = thisLaunchIcon.attr("targetType");
		var filename = thisLaunchIcon.attr("uid");
		var foldername = "Desktop/files/" + username + "/";
		var fullFilename = foldername + filename;
		if (fileType == "file"){
			let thisfilename = thisLaunchIcon.attr("filename");
			 $.ajax({
				type: "GET",
				url: "../SystemAOB/functions/file_system/copy.php?from=../../../" + fullFilename + "&target=../../../" + fullFilename,
				success: function (response) {
					if (response.includes("ERROR") == false){
						copyingFiles--;
						if (copyingFiles == 0){
							setTimeout(function(){ RefreshDesktop(); }, 500);
						}
					}else{
					    console.log(response);
						showNotification("<i class='remove icon'></i>" + "Something goes wrong when copying " + thisfilename);
					}
					
				}
			});
			copyingFiles++;
		}else if (fileType == "folder"){
			let thisfilename = thisLaunchIcon.attr("foldername");
			$.ajax({
				type: "GET",
				url: "../SystemAOB/functions/file_system/copy_folder.php?from=../../../" + fullFilename + "&target=../../../" + fullFilename,
				success: function (response) {
					if (response.includes("ERROR") == false){
						copyingFiles--;
						if (copyingFiles == 0){
							setTimeout(function(){ RefreshDesktop(); }, 500);
						}
					}else{
						showNotification("<i class='remove icon'></i>" + "Something goes wrong when copying " + thisfilename);
					}
				}
			});
			copyingFiles++;
		}else if (fileType == "module"){
			//Shortcut copy request will be rejected
		}
	}
}


function openFileinNewTab(){
	hideAllContextMenu();
	var filename = selectedObject[0].attr("uid");
	var url = "files/" + username + "/" + filename;
	showNotification("<i class='checkmark icon'></i> File opened in New tab.");
	window.open(url);
}

function hideAllContextMenu(){
	$("#lcm").hide();
	$("#rcm").hide();
	$("#folderChoose").hide();
}

function clearAdvanceMenu(){
	$("#rcm").html("");
}

function appendToAdvanceMenu(text,callback){
	if (text == "divider"){
		var divider = '<div class="divider"></div>';
		$("#rcm").append(divider);
	}else if (callback == ""){
		var template = '<div class="item">'+text+'</div>';
		$("#rcm").append(template);
	}else{
		if (callback.includes("(") == false && callback.includes("(") == false){
			var template = '<div class="item" onClick="'+callback+'(this);">'+text+'</div>';
		}else{
			var template = '<div class="item" onClick="'+callback+';">'+text+'</div>';
		}
		$("#rcm").append(template);
	}
}

function launchAdvanceMenu(top = 0){
	if (top == 0){
		top = $("#lcm").position().top;
	}
	var rt = $("#lcm").offset().left + $("#lcm").outerWidth();
	if (rt + $("#rcm").width() > $(window).width()){
		rt =  $("#lcm").position().left - $("#rcm").width();
	}
	if (top + $("#rcm").height() > window.innerHeight){
		top = top - $("#rcm").height();
	}
	$("#rcm").css("left",rt);
	$("#rcm").css("top",top);
	$("#rcm").show();
	
	$("#rcm .item").hover(function(){
		$(this).addClass("hovering");
	},function(){
		$(this).removeClass("hovering");
	});
}

function openShortcutLocation(){
	hideAllContextMenu();
	//This function will only be available under single object selection mode
	var targetModule = selectedObject[0].attr("path");
	var targetType = selectedObject[0].attr("targetType");
	if (targetType == "module"){
		var uid = Math.round((new Date()).getTime() / 1000);
		var url = "SystemAOB/functions/file_system/index.php?controlLv=2&finishing=embedded&subdir=" + targetModule;
		var title = targetModule + " - Folder View";
		var icon = "folder open";
		newfw(url,title,icon,uid,1080,580);
	}
	
}

function showTrashBin(){
	hideAllContextMenu();
	var hostURL = "Desktop/trashBinInterface.php?username=" + username;
	newfw(hostURL,"Trash Bin","trash","TrashBin",850,500,50,0,undefined,true);
}

function showProperties(){
	var scrollOpen = false;
	var wh = $(document).height();
	//console.log(wh);
	if (selectedObject.length > 1){
		scrollOpen = true;
		var openPos = [0,0];
	}else{
		var openPos = [undefined,undefined];
	}
	
	for(var i =0; i < selectedObject.length;i++){
		var targetType = selectedObject[i].attr("targetType");
		if ( targetType == "file"){
			var filename = selectedObject[i].attr("filename");
			newfw("Desktop/properties.php?filename=" + username + "/" + selectedObject[i].attr("uid"),filename.shorten(20,false) + " - Properties" , "notice",selectedObject[i].attr("uid").split(".").join("_").split(" ").join("_") + "_properties",365,475,openPos[0],openPos[1],false,true);
			
		}else if (targetType == "module" || targetType == "foldershrct" || targetType == "script" || targetType == "url"){
			var uid = selectedObject[i].attr("uid");
			if (uid == "MyHost"){
				//This will show the Host Properties instead of the shortcut properties
				var hostURL = "SystemAOB/functions/system_statistic/index.php";
				newfw(hostURL,"Host Server","disk outline","MyHost",650,750,undefined,undefined,undefined,true,true);
				
			}else{
				newfw("Desktop/properties.php?filename=" + username + "/" + selectedObject[i].attr("uid"),selectedObject[i].attr("uid").shorten(20,false) + " - Properties" , "notice",uid.replace(".","_").replace(" ","_") + "_properties",365,475,openPos[0],openPos[1],false,true);
			}
		}else if (targetType == "folder"){
			var filename = selectedObject[i].attr("uid");
			newfw("Desktop/properties.php?filename=" + username + "/" + selectedObject[i].attr("uid"),filename.shorten(20,false) + " - Properties" , "notice",selectedObject[i].attr("uid").split(".").join("_").split(" ").join("_") + "_properties",365,475,openPos[0],openPos[1],false,true);
		}
		
		if (scrollOpen){
			openPos = [openPos[0] + 100, openPos[1] + 100];
			if (openPos[1] > wh){
				openPos[1] = 0;
			}
		}
		
	}
	hideAllContextMenu();
}

String.prototype.shorten =
     function( n, useWordBoundary ){
         if (this.length <= n) { return this; }
         var subString = this.substr(0, n-1);
         return (useWordBoundary 
            ? subString.substr(0, subString.lastIndexOf(' ')) 
            : subString) + "…";
      };

function clearRightClickMenu(){
	$("#lcm").html("");
}

function openSelectedObject(){
	hideAllContextMenu();
	var interval = 1000;
	for(var i =0; i < selectedObject.length;i++){
		var thisLaunchObject = selectedObject[i];
		setTimeout(launchDesktopIcon, interval,thisLaunchObject);
		interval+=1000;
	}
}

function appendToRightClickMenu(text,callback = "console.log"){
	if (text == "divider"){
		var divider = '<div class="divider"></div>';
		$("#lcm").append(divider);
	}else{
		var template = '<div class="item" onClick="'+callback+'(this);">'+text+'</div>';
		$("#lcm").append(template);
	}
}

function fullScreenMode(){
	parent.openFullscreen();
	hideAllContextMenu();
}

function removeDesktopPosition(uid, resetPreventRefresh = false){
	$.ajax({url: "desktopInfo.php?username="+username+"&act=rmv&uid=" + uid, success: function(data){
		if (data.includes("DONE")){
		   //Remove from backend finished. Remove the item on the front end
		   var removalTarget = getObjectWithUID(uid);
		   removalTarget.remove();
		}else{
		   showNotification(data);
		}
		if (resetPreventRefresh){
		   preventRefresh = false;
		}
	}});
}


function saveDesktopPosition(object,remove=false){
	var uid = $(object).attr("uid");
	var posx = $(object).position().left;
	var posy = $(object).position().top;
	if (remove){
		$.ajax({url: "desktopInfo.php?username="+username+"&act=rmv&uid=" + uid, success: function(data){
		   if (data.includes("DONE")){
			   //Ok and no need to do anything
		   }else{
			   showNotification(data);
		   }
		}});
	}else{
		$.ajax({url: "desktopInfo.php?username="+username+"&act=set&uid=" + uid + "&x=" + posx + "&y=" + posy , success: function(data){
		   if (data.includes("DONE")){
			   //Ok and no need to do anything
		   }else{
			   showNotification(data);
		   }
		}});
	}
	
}

function GetBGCount(init = false){
	$.get( "countBG.php?theme=" + theme, function(data) {
		maxBgNumber = data[0];
		bgfileformat = data[1];
		if (init){
			bgPhrase = 0;
			bgNumber = 0;
			InitBG();
		}
	});
}



function InitBG(){
	$('#dbg2').attr('src', 'img/bg/' + theme + "/" + bgNumber + '.' + bgfileformat);
	$('#dbg1').delay(1000).fadeTo('slow', 0,function(){
		$('#dbg1').attr('src', 'img/bg/' + theme + "/" + bgNumber + '.' + bgfileformat);
	});
}

function ChangeBG(){
	if (maxBgNumber == 1 && bgPhrase == 0){
		//There is only one background. No need switching
		return;
	}
	if (bgPhrase == 0){
		//dbg1 is on top of dbg2
		$('#dbg1').fadeTo('slow', 0, function()
		{
			$('#dbg1').css('z-index','-2');
			$('#dbg2').css('z-index','-1');
		}).delay(1000).fadeTo('slow', 1,function(){
			$('#dbg1').attr('src', 'img/bg/' + theme + "/" + bgNumber + '.' + bgfileformat);
		});
		bgPhrase++;
	}else{
		//dbg2 is on top of dbg1
		$('#dbg2').fadeTo('slow', 0, function()
		{
			$('#dbg2').css('z-index','-2');
			$('#dbg1').css('z-index','-1');
		}).delay(1000).fadeTo('slow', 1,function(){
			$('#dbg2').attr('src', 'img/bg/' + theme + "/" + bgNumber + '.' + bgfileformat);
		});
		bgPhrase = 0;
	}
	bgNumber++;
	if (bgNumber >= maxBgNumber){
		bgNumber = 0;
	}
}



$("#pictureFrame").mousedown(function( e ) {
	if (renaming == true){
		var newfilename = selectedObject[0].find("textarea").val();
		confirmRename(newfilename);
		return;
	}
	if ($(e.traget).hasClass("textplace") == false){
		e.preventDefault();
	}
  if (selectedObject != []){
	  resetSelectedApps();
	  /**
	  for (var i=0; i < selectedObject.length;i++){
		  selectedObject[i].removeClass("selectedApp");
	  }
	  selectedObject = [];
	  **/
	  highlighting = true;
  }

});



$( "#pictureFrame" ).dblclick(function( e ) {
  e.preventDefault();
});



$(document).on("mousedown touchstart",function(event) {
	if ($(event.target).hasClass("textplace") == false){
		event.preventDefault();
	}
	
	if (event.type != "click"){
		//If this event is triggered by touchstart
		if ($(event.target).attr("id") == "pictureFrame"){
			//If pictureFrame is clicked, load up Desktop menu
			loadDesktopContextMenu();
		}
	}

    switch (event.which) {
        case 1:
            //Left mouse click
			if ($(event.target).hasClass("textplace") == false){
				//Added this part to prevent dragging blue square on top of rename dialog
				dragging = true;
				var isCtrlPressed = event.ctrlKey;
				lastMousePos = { x: event.pageX, y: event.pageY};
				//Deselect in multi selection mode
				var isLaunchIcon = $(event.target).hasClass("launchIcon") || $(event.target).parent().hasClass("launchIcon");
				var target = $(event.target);
				if($(event.target).hasClass("contextmenu") || $(event.target).parent().hasClass("contextmenu") || $(event.target).parent().parent().hasClass("contextmenu")){
					//Clicking on the contextmenu, do not hide the Left Click Menu (Although it is a right click menu?)
					//That multi layer of parents prevent onclick over icons (<i></i>) tags, not pleasant to look but it works
					addContextMenuEvents();
				}else{
					if (selectedObject != [] && isCtrlPressed == false && isLaunchIcon == false){
					for (var i=0; i < selectedObject.length;i++){
							selectedObject[i].removeClass("selectedApp");
						}
						selectedObject = [];
					}
					hideAllContextMenu();
				}
			}
            break;
        case 2:
            //Middle mouse click
            break;
        case 3:
            //Right mouse click
			//Open context menu as the same time select the thing behind
			if ($(event.target).attr('id') == "pictureFrame"){
				loadDesktopContextMenu();
			}
			hideAllContextMenu();
            break;
        default:
            //Touch screen, pretend to be right click --> copy the section from case 1
			if ($(event.target).hasClass("textplace") == false){
				//Added this part to prevent dragging blue square on top of rename dialog
				dragging = true;
				var isCtrlPressed = event.ctrlKey;
				lastMousePos = { x: event.pageX, y: event.pageY};
				//Deselect in multi selection mode
				var isLaunchIcon = $(event.target).hasClass("launchIcon") || $(event.target).parent().hasClass("launchIcon");
				var target = $(event.target);
				if($(event.target).hasClass("contextmenu") || $(event.target).parent().hasClass("contextmenu") || $(event.target).parent().parent().hasClass("contextmenu")){
					//Clicking on the contextmenu, do not hide the Left Click Menu (Although it is a right click menu?)
					//That multi layer of parents prevent onclick over icons (<i></i>) tags, not pleasant to look but it works
					addContextMenuEvents();
				}else{
					if (selectedObject != [] && isCtrlPressed == false && isLaunchIcon == false){
					for (var i=0; i < selectedObject.length;i++){
							selectedObject[i].removeClass("selectedApp");
						}
						selectedObject = [];
					}
					hideAllContextMenu();
				}
			}
            break;
    }
	$("#fileDescriptor").hide();
});

function remove(array, element) {
    const index = array.indexOf(element);
    array.splice(index, 1);
}


function initLaunchIconEvents(offmode = false){
	var mousedownPos = [];
	var mouseupPos = [];
	filenameClearnUp();
	
	//Bind in new one
	//This is not the best solution for solving the "not able to click inside the text area" problem but currently this is the only way
	if (offmode == true){
		$(".launchIcon").off().on("mousedown",function(event) {
			if ($(event.traget).hasClass("textplace") == false){
				event.preventDefault();
				highlighting = false;
				if (event.which == 1){
					hideAllContextMenu();
					mousedownPos = [event.clientX, event.clientY];
				}
				var isCtrlPressed = event.ctrlKey;
				if (isCtrlPressed && $(this).hasClass("selectedApp")){
					//This app is already selected and the current action is deselecting it
					$(this).removeClass("selectedApp");
					remove(selectedObject,$(this));
				}else if (isCtrlPressed && $(this).hasClass("selectedApp") == false){
					//This app is not yet selected and we want to add it to the selectedObject list
					 selectedObject.push($(this));
					 $(this).addClass("selectedApp");
				}else{
					//Click on any icon without Ctrl held down, deselect everything and select the latest one only
				}
			}
		
		});

		$(".launchIcon").off().on("mouseup",function(event) {
			if ($(event.traget).hasClass("textplace") == false){
				var isCtrlPressed = event.ctrlKey;
				mouseupPos = [event.clientX, event.clientY];
				if (isCtrlPressed == false && event.which == 1 && mousedownPos[0] == mouseupPos[0] && mousedownPos[1] == mouseupPos[1]){
					for (var i =0; i < selectedObject.length;i++){
						selectedObject[i].removeClass("selectedApp");
					}
					selectedObject = [];
					selectedObject.push($(this));
					$(this).addClass("selectedApp");
				}else if (selectedObject.length == 0 && event.which == 3){
					//Right click on an item
					//There is nothing selected yet, select the current item and apply context menu
					selectedObject.push($(this));
					$(this).addClass("selectedApp");
					addContextMenuEvents();
				}else if (selectedObject.length == 1 && event.which == 3){
					selectedObject[0].removeClass("selectedApp");
					selectedObject=[];
					selectedObject.push($(this));
					$(this).addClass("selectedApp");
				}
			}
			
		});
	}else{
		$(".launchIcon").on("mousedown",function(event) {
			if ($(event.traget).hasClass("textplace") == false){
				event.preventDefault();
				highlighting = false;
				if (event.which == 1){
					hideAllContextMenu();
					mousedownPos = [event.clientX, event.clientY];
				}
				var isCtrlPressed = event.ctrlKey;
				if (isCtrlPressed && $(this).hasClass("selectedApp")){
					//This app is already selected and the current action is deselecting it
					let object = $(this);
					setTimeout(function(){
						if (object.hasClass("selectedApp") == true){
							object.removeClass("selectedApp");
							remove(selectedObject,object);
							delete object;
						}
					},getRandomInt(100,500));
					
				}else if (isCtrlPressed && $(this).hasClass("selectedApp") == false){
					//This app is not yet selected and we want to add it to the selectedObject list
					let object = $(this);
					setTimeout(function(){
						if (object.hasClass("selectedApp") == false){
							//As multiple events might get triggered, this prevent multi-actioning
							object.addClass("selectedApp");
							selectedObject.push(object);
							delete object;
						}
						//Garbage Collection
					},getRandomInt(100,500));
				}else{
					//Click on any icon without Ctrl held down, deselect everything and select the latest one only
				}
			}
		
		});

		$(".launchIcon").on("mouseup",function(event) {
			if ($(event.traget).hasClass("textplace") == false){
				//event.preventDefault();
				var isCtrlPressed = event.ctrlKey;
				mouseupPos = [event.clientX, event.clientY];
				if (isCtrlPressed == false && event.which == 1 && mousedownPos[0] == mouseupPos[0] && mousedownPos[1] == mouseupPos[1]){
					for (var i =0; i < selectedObject.length;i++){
						selectedObject[i].removeClass("selectedApp");
					}
					selectedObject = [];
					selectedObject.push($(this));
					$(this).addClass("selectedApp");
				}else if (selectedObject.length == 0 && event.which == 3){
					//There is nothing selected yet, select the current item and apply context menu
					selectedObject.push($(this));
					$(this).addClass("selectedApp");
					addContextMenuEvents();
				}else if (selectedObject.length == 1 && event.which == 3){
					selectedObject[0].removeClass("selectedApp");
					selectedObject=[];
					selectedObject.push($(this));
					$(this).addClass("selectedApp");
				}
			}
			
		});
	}
	
	
	//Double Click on a launch icon, launching it if possible.
	$(".launchIcon").off("dblclick").on("dblclick",function(e){
		launchDesktopIcon($(this));
		
	});
	
	//File description box
	$(".launchIcon").hover(function() {
	var modulePath = $(this).attr("path");
	var targetType = $(this).attr("targetType");
	var filename = "";
	if (targetType == "file"){
		filename = $(this).attr("filename")
	}
	if (targetType == "folder"){
		filename = $(this).attr("foldername")
	}
	if (targetType == "url"){
		filename = $(this).text().trim();
	}
    if (!timeoutId) {
        timeoutId = window.setTimeout(function() {
		timeoutId = null; // EDIT: added this line
		if (targetType == "module"){
			LoadDescription(modulePath, UpdateDesc);
		}else if (targetType == "file"){
			loadFileInformation(filename,modulePath,UpdateDesc);
		}else if (targetType == "folder"){
			loadFolderInformation(filename,modulePath,UpdateDesc);
		}else if (targetType == "url"){
			loadURLInformation(filename,modulePath,UpdateDesc);
		}
		$('#fileDescriptor').css('left',currentMousePos.x + 10);
		$('#fileDescriptor').css('top',currentMousePos.y + 10);
       }, showDetailTime);
    }
},
function () {
    if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
		//$('#fileDescriptor').hide();
    }
    else {
		$('#fileDescriptor').hide();
    }
});
}

function launchDesktopIcon(object){
	if (!VDI){
		showNotification("<i class='remove icon'></i> This Desktop Interface can only be used with FloatWindow support.");
		return;
	}
	var launchType = object.attr("targetType");
	if (launchType == "module"){
		modulePath = object.attr("path");
		launchModule(modulePath);
	}else if (launchType == "script"){
		var scriptpath = object.attr("path");
		var scriptname = object.attr("uid").split(".")[0];
		var uid = Math.round((new Date()).getTime() / 1000);
		newfw(scriptpath,scriptname,"code",uid);
	}else if (launchType == "foldershrct"){
		var path = object.attr("path");
		path = path.replace("&","%26");
		openFolderInFW(path);
	}else if (launchType == "file"){
		var path = object.attr("path");
		var filename = object.attr("filename");
		filename = filename.replace("&","%26"); //Replace the & from the url as it is not possible to launch with & in url path
		var fileLocation = "Desktop/files/" + username + "/" + path;
		openFileInFW(fileLocation,filename);
	}else if (launchType == "folder"){
		var path = object.attr("path");
		path = path.replace("&","%26");
		openFolderInFW(path);
	}else if (launchType == "url"){
		var path = object.attr("path");
		path = path.replace("&","%26");
		window.open(path);
	}
}



$(document).mousemove(function(event) {
	event.preventDefault();
	currentMousePos = {x: event.pageX, y: event.pageY}
	if (dragging == true && highlighting == true){
		//Dragging over the desktop but not moving icons
		$('#fileSelector').show();
		//currentMousePos = {x: event.pageX, y: event.pageY}
		//$('#fileSelector').html(event.pageX + " " + event.pageY);
		var selectorPos = {x: lastMousePos.x, y:lastMousePos.y};
		if (lastMousePos.x > currentMousePos.x){
			selectorPos.x = currentMousePos.x + 1;
		}
		if (lastMousePos.y > currentMousePos.y){
			selectorPos.y = currentMousePos.y + 1;
		}
		//Creating the selection rectangle area in blue
		var selectorWidth = Math.abs(currentMousePos.x - lastMousePos.x);
		var selectorHeight = Math.abs(currentMousePos.y - lastMousePos.y);
		$('#fileSelector').offset({left: selectorPos.x , top: selectorPos.y});
		$('#fileSelector').height(selectorHeight);
		$('#fileSelector').width(selectorWidth);

		//Select all the icons in range
		var selectorLeft = $('#fileSelector').offset().left;
		var selectorTop = $('#fileSelector').offset().top;
		var newSelectedObject = [];
		var selectedIDList = [];
		$('.launchIcon').each(function(i, obj) {
			//Check if the icon is in range of the selection area
			var xcenter = $(this).offset().left + 35;
			var ycenter = $(this).offset().top + 45;
			if ( selectorLeft < xcenter && selectorTop < ycenter && (selectorLeft + selectorWidth) > xcenter && (selectorTop + selectorHeight) > ycenter){
				//console.log($(this).attr("id") + " " + xcenter + " " + ycenter);
				newSelectedObject.push($(this));
			}
		});
		resetSelectedApps();
		for (var i=0; i < newSelectedObject.length;i++){
			selectIconWithID(newSelectedObject[i]);
		}
	}

});



function resetSelectedApps(){
	/**
	for (var i=0; i < selectedObject.length;i++){
		selectedObject[i].removeClass("selectedApp");
	}
	**/
	$(".selectedApp").each(function(){
		$(this).removeClass("selectedApp");
	});
	selectedObject=[];
}



function selectIconWithID(object){
	object.addClass("selectedApp");
	selectedObject.push(object);
}



$(parent).click(function(){
	dragging = false;
	$('#fileSelector').hide();
});



$(document).mouseup(function(event) {
	if ($(event.traget).hasClass("textplace") == false){
		event.preventDefault();
		switch (event.which) {
			case 1:
				//Left mouse click
				dragging = false;
				$('#fileSelector').hide();
				multiSelectionDragDropLocations = [];
				break;
			case 2:
				//Middle mouse click
				break;
			case 3:
				//Right mouse click
				//console.log("Right Click pressed")
				//Moved the handler to "window.addEventListener('contextmenu'..."
				break;
			default:
				break;
			
		}
	}
});



window.addEventListener('contextmenu', function(event) { 
	//if right click is pressed on the window
  event.preventDefault();
  addContextMenuEvents();
  var left = event.clientX;
  var top = event.clientY;
  if (event.clientX + $("#lcm").width() > $( window ).width()){
	  left = $( window ).width() - $("#lcm").width();
  }
  //For some amazing reason, firefox do not support $(window).height(), so window.innerHeight is used
  if (event.clientY + $("#lcm").height() > window.innerHeight){
	  top = event.clientY - $("#lcm").height();
  }
  $("#lcm").css("left",left);
  $("#lcm").css("top",top);
  $("#lcm").show();
}, false);


function launchModule(modulePath){
	if (VDI){
		parent.LaunchFloatWindowFromModule(modulePath,true);
	}else{
		//This should not happens as this must be entered via function bar mode
		alert("ERROR! Functional bar launching API not found.");
	}
}


//Open file in float window mode
function openFileInFW(targetPath,filename){
	//console.log(targetPath,filename);
	parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare",0,0,-10,-10,undefined,undefined,undefined,undefined,true);
}

//Open folder in float window mode
function openFolderInFW(targetPath){
	if (!VDI){
		showNotification("<i class='remove icon'></i> This Desktop Interface can only be used with FloatWindow support.");
		return;
	}
	parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&subdir=" + targetPath, "Loading", "folder open outline",Math.floor(Date.now() / 1000),1080,580,undefined,undefined,true,false);
}

//Open a bare bone float Window
function newfw(src,windowname,icon,uid,sizex,sizey,posx = undefined,posy = undefined,fixsize = undefined,tran = undefined){
	//Example
	//newEmbededWindow('Memo/index.php','Memo','sticky note outline','memoEmbedded',475,700);
	if (!VDI){
		showNotification("<i class='remove icon'></i> This Desktop Interface can only be used with FloatWindow support.");
		return;
	}
	parent.newEmbededWindow(src,windowname,icon,uid,sizex,sizey,posx,posy,fixsize,tran);
}

//Print out the module description when hover on launch icon for a few second
var timeoutId;

//Update and show the description tag
function UpdateDesc(data){
	$('#fileDescriptor').html(data);
	$('#fileDescriptor').show();
}


function loadFileInformation(displayname,rawname,callback){
	if (displayname != rawname){
		var data = "<i class='file icon'></i>" + displayname + "<br>(" + rawname + ")";
	}else{
		var data = displayname;
	}
	callback(data);
}

function loadFolderInformation(displayname,rawname,callback){
	if (displayname != rawname){
		var data = "<i class='folder open icon'></i>" + displayname + "<br>(" + rawname + ")";
	}else{
		var data = displayname;
	}
	callback(data);
}

function loadURLInformation(displayname,targetURL,callback){
	var data = "<i class='external icon'></i>" + displayname + "<br>(" + targetURL + ")";
	callback(data);
}

//Load description from module with callback

function LoadDescription(module, callBack){
	$.get( "getDes.php?module=" + module, function( data ) {
		callBack("<i class='tag icon'></i>" + data);
	});
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



//Main key press handler for the whole page
$(parent, "body:parent", document, "body", "#pictureFrame", "*").on("keydown",async function(e) {
	var isCtrlPressed = e.ctrlKey;
	var isShiftPressed = e.shiftKey;
	//console.log("Pressed: " + e.which + " Ctrl: " + isCtrlPressed);
	var keyCode = e.keyCode || e.which;
	if(keyCode == 13) {
		if (renaming == false){
			e.preventDefault();
			//As during the renaming process, the enter is used for confirm rename
			for(var i=0; i < selectedObject.length; i++){
				//console.log(selectedObject[i].attr("id"));
				//Open all the selected webapps
				launchDesktopIcon(selectedObject[i]);
				await sleep(1000);
			}
		}
	}
	
	if (keyCode == 46){
		//Delete key is pressed
		e.preventDefault();
		if (selectedObject.length > 0){
			if (isShiftPressed){
				confirmDelete(true);
			}else{
				confirmDelete();
			}
			
		}
	}
	
	if (keyCode == 97){
	  //Ctrl A, select all
	  if (isCtrlPressed){
		  e.preventDefault();
		  selectedObject = [];
		  $(".launchIcon").each(function(){
			  $(this).addClass("selectedApp");
			  selectedObject.push($(this));
		  });
	  }

	}
	
	if (keyCode == 121){

	}
});

/*
$(document).on("keydown",function(e){
	console.log(e.keyCode);
	
});
*/

function showNotification(text){
	$("#notification").finish().stop().clearQueue().hide();
	$("#notificationText").html(text);
	$("#notification").fadeIn('slow').delay(2500).fadeOut('slow');
}



$('#pictureFrame').on(
    'dragover',
    function(e) {
        e.preventDefault();
        e.stopPropagation();
    }
)
$('#pictureFrame').on(
    'dragenter',
    function(e) {
        e.preventDefault();
        e.stopPropagation();
    }
)
$('#pictureFrame').on('drop',function(e){
        if(e.originalEvent.dataTransfer){
            if(e.originalEvent.dataTransfer.files.length) {
                e.preventDefault();
                e.stopPropagation();
                /*UPLOAD FILES HERE*/
				var dragX = e.pageX, dragY = e.pageY;
				//console.log(dragX + " , " + dragY);
                upload(e.originalEvent.dataTransfer.files,[dragX,dragY]);
            }   
        }
    }
);

function roundToClosestGrid(pos){
	var posx = pos[0];
	var posy = pos[1];
	var newx = 0;
	var newy = 0;
	var grid = [80.0,100.0]
	if(posx > 0)
        newx = Math.ceil(posx/grid[0]) * grid[0];
    else if( posx < 0)
        newx = Math.floor(posx/grid[0]) * grid[0];
    else
        newx = posx;
	
	if(posy > 0)
        newy = Math.ceil(posy/grid[1]) * grid[1];
    else if( posy < 0)
        newy = Math.floor(posy/grid[1]) * grid[1];
    else
        newy = posy;
	
	return [newx - 70,newy - 90];
}

//or saveDesktopPositionFromUID
function setFileDesktopPositionFromFilename(rawname,posx,posy,callback = null,callbackvar = "",holdRefresh=false){
	var uid = rawname;
	var posx = posx;
	var posy = posy;
	$.ajax({url: "desktopInfo.php?username="+username+"&act=set&uid=" + uid + "&x=" + posx + "&y=" + posy , success: function(data){
       if (data.includes("DONE")){
		   var oprcallback;
		   if (callback != null){
			   if (callbackvar != ""){
				   oprcallback = callback(callbackvar);
			   }else{
				   oprcallback = callback();
			   }
		   }
		   if (!holdRefresh){
			   updateDesktopFiles(oprcallback);
		   }
		   
	   }else{
		   showNotification(data);
	   }
	   
    }});
}

function upload(files,pos){
	showNotification("<i class='upload icon'></i>Upload Started");
	pos = roundToClosestGrid(pos);
	outboundingCount = 0;
	
	for (var i = 0, f; f = files[i]; i++) { // iterate in the files dropped
        if (!f.type && f.size % 4096 == 0){
			showNotification("<i class='caution sign icon'></i> Folder upload is not supported yet.");
			return;
		}
    }
	
	for(var i =0; i < files.length;i++){
		var thisfile = files[i];
		var filename = thisfile.name;
		filename = b64EncodeUnicode(filename);
		//console.log(filename);
		file_obj = thisfile;
		if(file_obj != undefined) {
			var form_data = new FormData(); 
			let position = getSlotOffsetSince(pos,i);
			//Create a upload dummy for the file
			let uid = (new Date()).getTime();
			var template = '<div class="launchIcon" targettype="duumy" uid="' + uid + '" style="left:' + position[0] + 'px; top: ' + position[1] + 'px;padding-top:22px;" align="center"><i class="icons"><i class="loading spinner icon"></i><i class="big file outline icon"></i></i><div style="padding-top:10px;">Uploading</div></div>';
			//Prepare to post files to server side
			$("body").append(template);
			form_data.append('file', file_obj);
			$.ajax({
				type: 'POST',
				url: 'dragDropUploader.php?username=' + username + "&filename=" + filename,
				position: position,
				contentType: false,
				processData: false,
				data: form_data,
				success:function(response) {
					if (response.includes("ERROR") == false){
						generateIconFromUplaodFile(response,position);
					}else{
						showNotification("<i class='caution sign icon'></i> Upload failed due to server side error.");
						console.log(response);
						if (LaunchIconExists(uid)){
							getObjectWithUID(uid).html('<i class="icons"><i class="remove icon"></i><i class="big file outline icon"></i></i><div style="padding-top:10px;">Upload<br>Error</div>').delay(3000).fadeOut(2000, function() { $(this).remove(); });
						}
					}
					delete position;
				}
			});
		}
	}
}

var outboundingCount = 0;
function getSlotOffsetSince(pos,i){
	var px = pos[0];
	var py = pos[1];
	py = py + (100 * i);
	var sh = $(document).height();
	if (py > sh - 110){
		px += 80;
		py = 10 + (100 * (i-outboundingCount));
	}else{
		outboundingCount++;
	}
	return [px,py];
}

function LaunchIconExists(uid){
	//Check if the icon with uid already exists on this desktop
	var found = false;
	$(".launchIcon").each(function(){
		if ($(this).attr("uid") == uid.toString().trim()){
			found = true;
		}
	});
	return found;
}

function getObjectWithUID(uid){ //Or #get div with uid #getDivWithUID
	var target = null;
	$(".launchIcon").each(function(){
		if ($(this).attr("uid") == uid.toString().trim()){
			target = $(this);
		}
	});
	return target;
}


function generateIconFromUplaodFile(response,iconPosition){
	console.log(response,iconPosition);
	if (response.substring(0,5) == "ERROR"){
		console.log("Uplaod Error. Response from server side: " + response);
		showNotification(response);
	}else{
		var rawFilename = response;
		var pos = iconPosition;
		showNotification("<i class='checkmark icon'></i>Upload Completed");
		setFileDesktopPositionFromFilename(response,pos[0],pos[1]);
	}
}

/**
Functional functions for data / sting processing
**/

String.prototype.hashCode = function() {
    var hash = 0;
    if (this.length == 0) {
        return hash;
    }
    for (var i = 0; i < this.length; i++) {
        var char = this.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

function b64EncodeUnicode(str) {
    // first we use encodeURIComponent to get percent-encoded UTF-8,
    // then we convert the percent encodings into raw bytes which
    // can be fed into btoa.
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
            return String.fromCharCode('0x' + p1);
    }));
}

function arraysEqual(arr1, arr2) {
	//Check if two array length is the same. If yes, check if two array contain the element of each other.
	//Two array need not to be exactly the same (in the sense of order)
    if(arr1.length !== arr2.length)
        return false;
    return(arr1.every(elem => arr2.indexOf(elem) > -1));
}

$(window).bind('beforeunload', function(){
	return 'There might be unsaved data. Confirm exit?';
});

function dirname(path) {
  return path.replace(/\\/g, '/').replace(/\/[^/]*\/?$/, '')
}

function downloadURI(uri, name){
    var file_path = uri;
	var a = document.createElement('A');
	a.href = file_path;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

</script>
</html>