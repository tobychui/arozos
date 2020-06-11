<?php
include '../auth.php';

function mv($var){
	if (isset($_GET[$var]) && $_GET[$var] != ""){
		return $_GET[$var];
	}
	return "";
}

$dragInFilepath = "";
$dragInFilename = "";
if (mv("filepath") != "" && mv("filename") != ""){
	$dragInFilepath =  mv("filepath");
	$dragInFilename =  mv("filename");
}

//Check if the filepath consistis of extDiskAccess.php script. If yes, filter the filename to get the last part only
if (strpos($dragInFilepath, "extDiskAccess.php?file=") !== false){
	$dragInFilepath = explode("=",$dragInFilepath);
	array_shift($dragInFilepath);
	$dragInFilepath = implode("=",$dragInFilepath);
}
?>
<html>
<head>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.8, maximum-scale=0.8"/>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
<title>FFmpeg Wrapper for ArOZ Online</title>
<style>
    .FFmpegStatus{
        padding:8px;
        border-bottom:1px solid #999999;
    }
    body{
        padding-top:0px !important;
        background-color:white;
    }
    @supports (backdrop-filter: none) {
		body {
			background: rgba(255, 255, 255, 0.9);
			backdrop-filter: blur(8px);
		}
	}
    .topMenu{
        padding-top:0px !important; 
        border-bottom: 1px solid #999999;
        overflow-x: auto;
    }
    .selectableMenuItems{
        padding: 8px;
        display:inline-block !important;
        cursor:pointer;
        border-bottom:3px solid transparent;
    }
    .selectableMenuItems.enabled:hover{
        background-color:#f0f0f0;
        border-bottom:3px solid #999999;
    }
    .mainArea{
        padding-top:10px;
        
    }
    .convertionList{
        width:100%;
        padding-left:12px;
        padding-right: 12px;
        border-right: 1px solid #cfcfcf;
    }
    .selectable{
        cursor:pointer;
        padding-left: 5px !important;
		border:1px solid transparent;
    }
    .selectable:hover{
        background-color:#f0f0f0;
		border:1px solid #999999 !important;
    }
    .selectable.item{
        padding-top:5px !important;
        border: 1px solid transparent;
    }
    .content{
        overflow-y: auto;
    }
    .filelist{
        padding: 5px !important;
        margin-right:30px !important;
        border: 1px solid transparent !important;
        border-bottom: 1px solid #999999 !important;
        cursor: pointer;
    }
    .filelist:hover{
        background-color:#f0f0f0;
		border:1px solid #999999 !important;
    }
    .selectedFile{
        background-color:#f0f0f0;
		border:1px solid #999999 !important;
    }
    .selectedConvertTarget{
        background-color:#f0f0f0;
		border:1px solid #999999 !important;
    }
    .status{
        display:inline;
    }
    .selectableMenuItems.disabled{
        color: #a3a3a3;
        cursor: not-allowed !important;
    }
	.converting{
		background-color:#d3e4ff;
	}
	.convertDone{
		background-color:#d1ffd3;
	}
	#settingMenu{
	    position:fixed;
	    left:30px;
	    right:30px;
	    top:30px;
	    max-height:80%;
	}
</style>
</head>
<body>
<div id="headerNav" class="ts pointing secondary menu">
    <a class="item" href="../"><</a>
    <a class="active item"><i class="refresh icon"></i>FFmpeg Factory</a>
</div>
<div class="topMenu">
    <div id="addFileBtn" class="selectableMenuItems enabled" onClick="openFileSelection(this);"><i class="plus icon"></i>Add Files</div>
    <div class="selectableMenuItems enabled" onClick="openFileLocation();"><i class="folder open icon"></i>Browse File Location</div>
    <div class="selectableMenuItems enabled" onClick="startQueue();"><i class="play icon"></i>Start Queue</div>
    <div class="selectableMenuItems enabled" onClick="stopQueue();"><i class="stop icon"></i>Stop Queue</div>
    <div class="selectableMenuItems enabled" onClick="viewCommand();"><i class="code icon"></i>View Command</div>
    <div class="selectableMenuItems enabled" onClick="showSettingMenu();"><i class="setting icon"></i>Settings</div>
</div>
<div class="FFmpegStatus">
	<?php
	    $arrowIcon = "<i class='caret right icon'></i>";
		if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
			if (file_exists('ffmpeg-4.0.2-win32-static\bin\ffmpeg.exe')){
				echo $arrowIcon . " ✅ FFmpeg found with path: ffmpeg-4.0.2-win32-static\bin\ ffmpeg.exe";
			}else{
				echo $arrowIcon . ' ❌FFmpeg not found. Please download and place your ffmpeg 4.0.2 32bit binary at: ffmpeg-4.0.2-win32-static\bin\ffmpeg.exe';
			}
		} else {
			$osname = shell_exec("lsb_release -a | grep Distributor");
			$osname = trim(array_pop(explode(":",$osname)));
			$osRelease = shell_exec("lsb_release -a | grep Release");
			$osRelease = trim(array_pop(explode(":",$osRelease)));
			if (strpos($osname,"Ubuntu") !== false){
				$result = shell_exec("whereis ffmpeg");
			}else if(strpos($osname,"Debian") !== false && strpos($osRelease,"10") !== false){
			    //Debian 10
			    $result = shell_exec("whereis ffmpeg");
			}else if(strpos($osname,"Raspbian") !== false && strpos($osRelease,"10") !== false){
			    //Raspbian 10, based on Debian 10
			    $result = shell_exec("whereis ffmpeg");
			}else{
				$result = shell_exec("whereis avconv");
			}
			$path = explode(":",$result)[1];
			if (trim($path) != ""){
    			    //path found
    			    echo $arrowIcon . " ✅ FFmpeg found with path: "  . $path;
			    }else{
			    //path not found.
    			    echo $arrowIcon . "❌ FFmpeg not found.  Click <a href='quick_install.php' target='_blank'>here</a> to install via apt-get install. (Automatic script)";
			    }
		}
	?>
</div>
<div class="ts stackable grid mainArea">
    <div class="six wide column">
        <div class="convertionList" >
            <details class="ts accordion" open>
                <summary>
                    <i class="dropdown icon"></i> <i class="record icon"></i>Video
                </summary>
                <div class="content fileFormatSelector">
                    <div class="ts relaxed divided list">
						<?php
							$template = '<div class="item selectable" onClick="selectTargetFormat(this);" ondblClick="openSelectFiles(this);" cmd="%COMMAND%"><i class="file video outline icon"></i>%FILEEXT%</div>';
							$supportedFormats = [];
							if (file_exists("config/v2v.config")){
								$content = file_get_contents("config/v2v.config");
								$content = explode("\n",$content);
								foreach ($content as $item){
									$item = explode(",",$item);
									$box = $template;
									$box = str_replace("%FILEEXT%",$item[0],$box);
									$box = str_replace("%COMMAND%",base64_encode($item[1]),$box);
									echo $box;
								}	
							}
							//$template = '<div class="item selectable"><i class="file video outline icon"></i></div>';

						?>
                    </div>
                </div>
            </details>
            <details class="ts accordion">
                <summary>
                    <i class="dropdown icon"></i> <i class="music icon"></i>Music
                </summary>
                <div class="content fileFormatSelector">
                    <div class="ts relaxed divided list">
                        <?php
							$template = '<div class="item selectable" onClick="selectTargetFormat(this);" ondblClick="openSelectFiles(this);" cmd="%COMMAND%"><i class="file audio outline icon"></i>%FILEEXT%</div>';
							$supportedFormats = [];
							if (file_exists("config/v2a.config")){
								$content = file_get_contents("config/v2a.config");
								$content = explode("\n",$content);
								foreach ($content as $item){
									$item = explode(",",$item);
									$box = $template;
									$box = str_replace("%FILEEXT%",$item[0],$box);
									$box = str_replace("%COMMAND%",base64_encode($item[1]),$box);
									echo $box;
								}	
							}
							//$template = '<div class="item selectable"><i class="file video outline icon"></i></div>';

						?>
                    </div>
                </div>
            </details>
            <details class="ts accordion">
                <summary>
                    <i class="dropdown icon"></i> <i class="file image outline icon"></i>Pictures
                </summary>
                <div class="content fileFormatSelector">
				 <div class="ts relaxed divided list">
                    <?php
							$template = '<div class="item selectable" onClick="selectTargetFormat(this);" ondblClick="openSelectFiles(this);" cmd="%COMMAND%"><i class="file image outline icon"></i>%FILEEXT%</div>';
							$supportedFormats = [];
							if (file_exists("config/i2i.config")){
								$content = file_get_contents("config/i2i.config");
								$content = explode("\n",$content);
								foreach ($content as $item){
									$item = explode(",",$item);
									$box = $template;
									$box = str_replace("%FILEEXT%",$item[0],$box);
									$box = str_replace("%COMMAND%",base64_encode($item[1]),$box);
									echo $box;
								}	
							}
							//$template = '<div class="item selectable"><i class="file video outline icon"></i></div>';

						?>
                </div>
            </details>
            <details class="ts accordion">
                <summary>
                    <i class="dropdown icon"></i> <i class="object ungroup icon"></i>Others
                </summary>
                <div class="content fileFormatSelector">
                    <div class="ts relaxed divided list">
                    <?php
						$template = '<div class="item selectable" onClick="selectTargetFormat(this);" ondblClick="openSelectFiles(this);" cmd="%COMMAND%"><i class="exchange icon"></i>%FILEEXT%</div>';
						$supportedFormats = [];
						if (file_exists("config/other.config")){
							$content = file_get_contents("config/other.config");
							$content = explode("\n",$content);
							foreach ($content as $item){
								$item = explode(",",$item);
								$box = $template;
								$box = str_replace("%FILEEXT%",$item[0],$box);
								$box = str_replace("%COMMAND%",base64_encode($item[1]),$box);
								echo $box;
							}	
						}
						//$template = '<div class="item selectable"><i class="file video outline icon"></i></div>';

					?>
					 </div>
                </div>
            </details>
        </div>
    </div>
    <div class="ten wide column" ondrop="drop(event)" ondragover="allowdrag(event)">
        <div id="convertPendingList" class="ts list">
            
        </div>
    </div>
</div>
<div id="settingMenu">
    <div class="ts raised segment">
        <div class="ts header">
            <i class="setting icon"></i>Conversion Settings
            <div class="sub header">Please adjust the following settings according to your Host devices specification.</div>
        </div>
        <div class="ts list">
            <div class="item"><i class="caret right icon"></i>Simultaneous Conversion File Counts</div>
            <div class="item">
                <select id="simFileCount" class="ts basic tiny dropdown" onChange="updateSimFiles(this);">
                    <option>1</option>
                    <option>2</option>
                    <option>3</option>
                    <option>4</option>
                    <option>8</option>
                    <option>ALL</option>
                </select>
            </div>
            <div class="item" style="font-size: 90%;"><small>Do not use "ALL" options unless your host is a dual CPU Xeon Server</small></div>
            <div class="item"><i class="caret right icon"></i>Allow Codec Copy Options (FFmpeg Expert Only)</div>
            <div class="item" onChange="">
                <select id="allowCodecCopy" class="ts basic tiny dropdown" onChange="updateAllowCodecCopy(this);">
                    <option>false</option>
                    <option>true</option>
                </select>
            </div>
              <div class="item" style="font-size: 90%;"><small>Codec Copy Error might crash the system. Please use with your own risk.</small></div>
        </div>
        <div id="data_importFilepath" style="display:none;"><?php echo $dragInFilepath; ?></div>
        <div id="data_importFilename" style="display:none;"><?php echo $dragInFilename; ?></div>
        <br><br>
        <ins><i class="save icon"></i>All changes will be saved automatically in localStorage.</ins>
    </div>
    <button class="ts top right corner close button" onClick="$('#settingMenu').hide();"></button>
</div>
<br><br><br><br>
<script>
var inVDI = !(!parent.isFunctionBar);
var importFilepath = $("#data_importFilepath").text().trim().replace("../",""); //Trim away the first ../ as Desktop drag in have problems like this
var importFilename = $("#data_importFilename").text().trim();
var convertionTarget = "unset";
var currenetCommand = "";
var waitingFormatSelect = false;
var convertPendingFiles = {}; 
var transcodeRecord = [];
var username = localStorage.getItem("ArOZusername");
var settings = [1,false];
var processingQueue = false;

//Defined the possible conversions
// 1. Video to video or audio
// 2. Audio to audio
// 3. Image to image
var allowType = {video:["video","audio"],audio:["audio"],image:["image"]};
//File extension defination
var extTypeDefination = {mp3: "audio",wav: "audio", aac: "audio", flac: "audio", ogg:"audio", m4a: "audio", wma: "audio", webm: "video", mkv: "video", flv: "video", avi: "video", mov: "video", wmv: "video", rmvb: "video", mp4: "video", m4v: "video", "3gp": "video",jpg: "image", png: "image", jpeg: "image", tiff: "image", gif: "image", bmp: "image", txt: "other",md: "other",docx:"other",xlsx:"other",pptx:"other",ppt:"other",doc:"other",xls:"other",js:"other",php:"other",html:"other",pdf:"other",zip:"other",rar:"other","7z":"other",shortcut: "other"};

if (inVDI){
	$("#headerNav").hide();
	$("body").css("padding-top","10px");
}
ao_module_setWindowIcon("exchange");
ao_module_setWindowTitle("FFmpeg Factory");
ao_module_setGlassEffectMode();
ao_module_setWindowSize(1150,640);
clearTmp();
loadSettingValues();
var template = '<div class="filelist item" onClick="selectFile(this);" filename="{FILENAME}" filepath="{FILEPATH}" cmd="{COMMAND}">\
                <i class="clock icon" style="display:inline;"></i>\
                <div class="content"  style="display:inline;">\
                    <div class="header">{FILENAME} <div class="status">({CONVERSIONTYPE})</div></div>\
                    <div class="description">>> <a class="convertButton" onClick="convertThis(this);"><i class="refresh icon"></i>Convert</a> / <a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove</a></div>\
                </div>\
                </div>';

function showSettingMenu(){
    $("#settingMenu").show();
}

function allowdrag(evt){
    evt.preventDefault();
}

function drop(evt){
    evt.preventDefault();
    /*
    if (evt.dataTransfer.getData("filepath") !== ""){
        var rawfp = evt.dataTransfer.getData("filepath");
        var rawfn = evt.dataTransfer.getData("filename");
        var filepaths = JSON.parse(rawfp);
        var filenames = JSON.parse(rawfn);

        //For each filepaths and filenames,parse them to the input filename and filepath format
        var files = [];
        for(var i =0; i < filepaths.length; i++){
            let newfo = {"filepath":filepaths[i], "filename":filenames[i]};
            files.push(newfo);
        }

        waitForUserSelectFileExtension(JSON.stringify(files));
    }
    */
    var files = ao_module_utils.getDropFileInfo(evt);
    waitForUserSelectFileExtension(JSON.stringify(files));
}

function startQueue(){
    $(".FFmpegStatus").html('<i class="refresh icon"></i> Conversion Started');
    if(!processingQueue){
       processingQueue = true;
       processQueue();
    }
}

function processQueue(){
    if (!processQueue){
        return;
    }
    var workingJobs = 0; 
    var simFileCount = getSimFileCountRecord();
    var convertingPending = 0;
    if (simFileCount !== "ALL"){
        simFileCount = parseInt(simFileCount);
    }
    workingJobs = $(".filelist.item.converting").length;
    $(".filelist.item").each(function(){
       if ($(this).hasClass("converting") == false && $(this).hasClass("convertDone") == false){
           //This task is currently a pending task, continue with the processing
           if (simFileCount == "ALL" && processingQueue){
               //Start all task without caring about the load
               startConversion($(this).attr("filename"),$(this).attr("filepath"),$(this).attr("cmd"),$(this));
           }else if (processingQueue){
               //Only start until the pendingJob reached the max simFileCount no
               //console.log(workingJobs,simFileCount);
               if (workingJobs < simFileCount){
                   //There are still rooms to add some files. Add job to queue
                   startConversion($(this).attr("filename"),$(this).attr("filepath"),$(this).attr("cmd"),$(this));
                   workingJobs++;
               }else{
                   //Files that are convert pending but no room for this conversion cycle
                   convertingPending++;
               }
           }
       }
    });
    if (convertingPending > 0){
       setTimeout(processQueue,3000);
    }else{
        //All files finished converting. Set the processQueue back to false.
        processQueue = false;
         $(".FFmpegStatus").html('<i class="checkmark icon"></i>Conversion list ended. Conversions should be finished in a few moment.');
    }
}

function stopQueue(){
    processingQueue = false;
    $(".FFmpegStatus").html('<i class="refresh icon"></i> Conversion Stopped');
}

function loadSettingValues(){
    var simFileCount = getSimFileCountRecord();
    $("#simFileCount").val(simFileCount).change();
    var allowCodecCopy = getAllowCodecCopy();
    $("#allowCodecCopy").val(allowCodecCopy).change();
    settings[0] = parseInt(simFileCount);
    settings[1] = (allowCodecCopy == "true");
}

function updateSimFiles(object){
    switch(object.selectedIndex){
        case 0:
            //1 file
            setSimFileCountRecord(1);
            settings[0] = 1;
            break;
        case 1:
            //2 files
            setSimFileCountRecord(2);
            settings[0] = 2;
            break;
        case 2:
            //3 files
            setSimFileCountRecord(3);
            settings[0] = 3;
            break;
        case 3:
            //4 
            setSimFileCountRecord(4);
            settings[0] = 4;
            break;
        case 4:
            //8 files
            setSimFileCountRecord(8);
            settings[0] = 8;
            break;
        case 5:
            //All files
            setSimFileCountRecord("ALL");
            settings[0] = "ALL";
            break;
    }
}

function updateAllowCodecCopy(object){
    switch(object.selectedIndex){
        case 0:
            setAllowCodecCopy("false");
            settings[1] = false;
            break;
        case 1:
            setAllowCodecCopy("true");
            settings[1] = true;
            break;
    }
    updateCodecCopyStatus();
}

function getAllowCodecCopy(){
    var value = ao_module_getStorage("FFmpegFactory","allowCodecCopy");
    if (value == null){
        return "false";
    }else{
        return value;
    }
}

function setAllowCodecCopy(val){
    ao_module_saveStorage("FFmpegFactory","allowCodecCopy",val);
}


function getSimFileCountRecord(){
    var value = ao_module_getStorage("FFmpegFactory","simConvFileCount");
    if (value == null){
        return 1;
    }else{
        return value;
    }
}

function setSimFileCountRecord(val){
    ao_module_saveStorage("FFmpegFactory","simConvFileCount",val);
}

$(document).ready(function(){
    $("#settingMenu").hide();
    //Load previous on-going tasks if there are any
    $.get("loadPreviousTasks.php",function(data){
        for (var i =0; i < data.length; i++){
            var box = $(template);
            var cmd = data[i][3];
            var logCode = data[i][0];
            var filepath = getInputFileLocationFromCMD(cmd);
            box.find(".header").text(data[i][2]);
            box.attr("cmd",cmd);
            box.find(".description").text("Loading on-going tasks from log files...");
            box.addClass("converting");
            box.attr("filepath",filepath.replace("../",""));
            $("#convertPendingList").append(box);
            let convertingFile = ["",cmd,box,logCode];
            transcodeRecord[logCode] = data[i][4];
            setTimeout(function(){monitorFileProgress(convertingFile);},3000);
        }
    });
    if (importFilename != "" && importFilepath != ""){
        //There are imported file selection. Activate the file conversion process and allow users to choose what target to convert
        waitForUserSelectFileExtension(JSON.stringify([{filepath:importFilepath,filename:importFilename}]));
    }
    //Remove all codec copy if codec copy is set to false
    updateCodecCopyStatus();
});

function updateCodecCopyStatus(){
    if (settings[1] == false){
       $(".selectable").each(function(){
            if ($(this).html().includes("codec copy")){
                $(this).addClass("disabled");
            }
        }); 
    }else{
       $(".selectable").each(function(){
            if ($(this).html().includes("codec copy")){
                $(this).removeClass("disabled");
            }
        });  
    }
}

function openFileSelection(object){
    //Add file is pressed. Ask the user for selecting files and then ask them to select the target conversion type.
    if ($(object).hasClass("disabled") == false){
        if (inVDI){
            ao_module_newfw("SystemAOB/functions/file_system/fileSelector.php?allowMultiple=true","Starting file selector","spinner","FFmpegFactoryFileSelector",1180,645,ao_module_getLeft() + 30,ao_module_getTop() + 30,undefined,undefined,ao_module_windowID,"waitForUserSelectFileExtension");
        }else{
            //Opening a file selection window under non-VDI mode
            rid = "FFmpegFactoryFileSelectorWithoutExtension";
            ao_module_openFileSelectorTab(rid,"../",true,"file",waitForUserSelectFileExtension);
        }
        
    }
}

function waitForUserSelectFileExtension(files){
    //Ask the user to pick a file extension from the list for conversion
    convertPendingFiles = files;
    waitingFormatSelect = true;
    disableAllButtons();
    $(".FFmpegStatus").text("Please select a file extension from the left menu for conversion.");
    convertionTarget = "unset";
    currenetCommand = "";
    $(".selectable").each(function(){
        $(this).removeClass("selectedConvertTarget");
    });
}

function disableAllButtons(){
    $(".selectableMenuItems").each(function(){
        $(this).removeClass('enabled').addClass("disabled");
    });
}

function convertThis(object){
	var filename = ($(object).parent().parent().parent().attr("filename"));
	var filepath = ($(object).parent().parent().parent().attr("filepath"));
	var cmd = ($(object).parent().parent().parent().attr("cmd"));
	var targetFileObject = $(object).parent().parent().parent();
	startConversion(filename,filepath,cmd,targetFileObject);
}

function startConversion(filename,filepath,cmd,targetFileObject){
	$.get( "ffmpeg.php?command=" + cmd + "&filepath=" + filepath, function( data ) {
		if (data.includes("ERROR") == false){
			//Start file monitoring
			var logCode = data.split(",")[1];
			var exportFilepath = getDoneFilenameFromCMD(cmd);
			var displayText = $(targetFileObject).find(".header").text().trim();
			let convertingFile = [exportFilepath,cmd,targetFileObject,logCode];
			$(targetFileObject).find(".description").text("Starting conversion process...");
			transcodeRecord[logCode] = "pending";
			generateAsyncInfoFile(displayText,cmd,logCode);
			setTimeout(function(){monitorFileProgress(convertingFile);},3000);
			$(targetFileObject).removeClass("selectedFile").addClass("converting");
		}else{
			//Something happened
			alert(data);
			console.log("[FFmpeg Factory] Something went wrong. " + data);
		}
	});
}

function generateAsyncInfoFile(displayText,cmd,logCode){
    displayText = JSON.stringify(displayText);
    cmd = JSON.stringify(cmd);
    $.get("generateAsyncInfoFile.php?displayText=" + displayText + "&cmd=" + cmd + "&logCode=" + logCode,function(data){
        console.log("[FFmpeg Factory] Generate Async Information File >> " + data);
    });
}

function monitorFileProgress(fileObject){
	var filepath = fileObject[0];
	var GUIobject = fileObject[2];
	var logCode = fileObject[3];
	var previosTranscodeRecord = transcodeRecord[logCode];
	$.ajax({
		url: "chkProgress.php?logCode=" + logCode,
		success: function(data){
			if (data.includes("DONE") == true){
		    //Check if the conversion is DONE on Window Hosts
			$(GUIobject).removeClass("converting").addClass("convertDone");
			$(GUIobject).find(".description").html("Conversion Done /" + '<a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove from List</a>');
			$(GUIobject).find("i").removeClass("clock").addClass("checkmark");
			removeFinishedTaskLogFiles(logCode);
		}else if (data.includes("ERROR")){
			//The log file is gone
			console.log(data);
			$(GUIobject).find(".description").text("Unknown Error Occured.");
		}else{
		    //console.log(data.trim(),previosTranscodeRecord.trim());
		    if (data.trim() != previosTranscodeRecord.trim()){
		        //This record is different from the previous returned result --> The task is still running!
		        transcodeRecord[logCode] = data.trim();
		        $(GUIobject).find(".description").text(data);
    			setTimeout(function(){
    				monitorFileProgress(fileObject);
    			},3000);
		    }else{
		        //This record is the same as the previous returned result --> The task has been completed.
		        $(GUIobject).removeClass("converting").addClass("convertDone");
			    $(GUIobject).find(".description").html("Conversion Done /" + '<a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove from List</a>');
			    $(GUIobject).find("i").removeClass("clock").addClass("checkmark");
			    removeFinishedTaskLogFiles(logCode);
		    }
			
		}
		},
		error: function(){
			//Assume the conversion has already be done.
			$(GUIobject).css("background-color","#ffcccc");
			$(GUIobject).find(".description").text("Timeout while trying to retrieve conversion information. / ").append('<a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove</a>');
			removeFinishedTaskLogFiles(logCode);
		},
	   timeout: 30000 //in milliseconds, 30 secounds by default
	});
	
	/*
	$.get( "chkProgress.php?logCode=" + logCode, function( data ) {
		if (data.includes("DONE") == true){
		    //Check if the conversion is DONE on Window Hosts
			$(GUIobject).removeClass("converting").addClass("convertDone");
			$(GUIobject).find(".description").html("Conversion Done /" + '<a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove from List</a>');
			$(GUIobject).find("i").removeClass("clock").addClass("checkmark");
			removeFinishedTaskLogFiles(logCode);
		}else if (data.includes("ERROR")){
			//The log file is gone
			console.log(data);
			$(GUIobject).find(".description").text("Unknown Error Occured.");
		}else{
		    //console.log(data.trim(),previosTranscodeRecord.trim());
		    if (data.trim() != previosTranscodeRecord.trim()){
		        //This record is different from the previous returned result --> The task is still running!
		        transcodeRecord[logCode] = data.trim();
		        $(GUIobject).find(".description").text(data);
    			setTimeout(function(){
    				monitorFileProgress(fileObject);
    			},3000);
		    }else{
		        //This record is the same as the previous returned result --> The task has been completed.
		        $(GUIobject).removeClass("converting").addClass("convertDone");
			    $(GUIobject).find(".description").html("Conversion Done /" + '<a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove from List</a>');
			    $(GUIobject).find("i").removeClass("clock").addClass("checkmark");
			    removeFinishedTaskLogFiles(logCode);
		    }
		    
			
		}
		
	});
	*/
}

function removeFinishedTaskLogFiles(logCode){
    $.get("removeLogfile.php?logCode=" + logCode,function(data){
        
    });
}

function getInputFileLocationFromCMD(cmd){
	if (cmd == "no-data"){
		return "no-data";
	}
    var realcmd = atob(cmd);
    var data = realcmd.split(" ");
    for (var i = 0; i < data.length; i++){
        if (data[i] == "-i"){
            //This is the input flag, the next one should be the file path
            return data[i + 1].split('"').join(""); 
        }
    }
}

function getDoneFilenameFromCMD(cmd){
	var realcmd = atob(cmd);
	var filename = realcmd.split(" ").pop(); //Pop the filename from the cmd
	filename = filename.split('"').join(""); //Remove all " in the string
	return filename;
}

function enableAllButtons(){
    $(".selectableMenuItems").each(function(){
        $(this).removeClass('disabled').addClass("enabled");
    });
}

function fillInformation(domtemplate,keyword,newvalue){
    return domtemplate.split("{" + keyword + "}").join(newvalue);
}

function getExt(filename){
    return filename.split(".").pop();
}

function addFileFromSelector(data){
    generateFileListFromFileDataObject(data);
    $(".FFmpegStatus").text("Conversion Pending. Press Start Queue to start converting the listed files.");
}

function openFileLocation(){
    $(".filelist").each(function(){
        if ($(this).hasClass("selectedFile")){
            var filepath = $(this).attr("filepath");
            var fileDir = filepath.split("/");
            fileDir.pop();
            fileDir = fileDir.join("/");
            if (inVDI){
                ao_module_openPath(fileDir,undefined,undefined,ao_module_getLeft() + 30,ao_module_getTop() + 30) 
            }else{
				window.open("../SystemAOB/functions/file_system/index.php?controlLv=2&subdir=" + fileDir);
			}
        }
    });
}

function viewCommand(){
    $(".filelist").each(function(){
        if ($(this).hasClass("selectedFile")){
            //Fix pending
           alert("ffmpeg " + atob($(this).attr('cmd')));
        }
    });    
}

function base64encode(str) {
  let encode = encodeURIComponent(str).replace(/%([a-f0-9]{2})/gi, (m, $1) => String.fromCharCode(parseInt($1, 16)))
  return btoa(encode)
}

function base64decode(str) {
  let decode = atob(str).replace(/[\x80-\uffff]/g, (m) => `%${m.charCodeAt(0).toString(16).padStart(2, '0')}`)
  return decodeURIComponent(decode)
}


function generateFileListFromFileDataObject(fileData){
    result = JSON.parse(fileData);
    for (var i=0; i < result.length; i++){
        //For each result, generate an DOM element for them
        var box = template;
        box = fillInformation(box,"FILEPATH",result[i].filepath);
        box = fillInformation(box,"FILENAME",result[i].filename);
        var ext = getExt(result[i].filename);
        var command = atob(currenetCommand);
        var relativeFilepath = result[i].filepath;
        if (relativeFilepath.substring(0,1) != "/"){
            //Relative path to AOR
            relativeFilepath = "../" + relativeFilepath
        }else{
            //Relative path to Root (i.e. /media/....)
            
        }
        command = fillInformation(command,"filepath",relativeFilepath);
        command = fillInformation(command,"filename",relativeFilepath.replace("." + ext,""));
        //console.log(base64encode(command));
        box = fillInformation(box,"COMMAND",base64encode(command))
        box = fillInformation(box,"CONVERSIONTYPE",ext + " >> " + convertionTarget.toLowerCase());
        $("#convertPendingList").append($(box));
        checkIfConversionMakeSense(ext,convertionTarget,result[i].filepath);
    }
}

function checkIfConversionMakeSense(ext, target, filepath){
        ext = ext.toLowerCase();
        if (target.includes("(")){
            target = target.split("(")[0];
        }else{
            target = target;
        }
        target = target.toLowerCase();
        if (extTypeDefination.hasOwnProperty(ext) && extTypeDefination.hasOwnProperty(target)){
            var mime = extTypeDefination[target];
            var sourcemime = extTypeDefination[ext];
            var normalConv = allowType[sourcemime];
            if (normalConv.includes(mime) == false){
                //This operation might not be valid
                $(".filelist").each(function(){
                    if ($(this).attr("filepath") == filepath){
                        //This is the item which it might have some problem
                        $(this).css("background-color","#ffcccc");
                        $(this).find(".description").text("Conversion from " + ext + " to " + target + " is not valid. / ").append('<a class="removeButton" onClick="removeThis(this);"><i class="trash outline icon"></i>Remove</a>');
                    }
                });
            }
        }else{
            //Some undefined extension found in the comparasion. Lets ignore it and see what happens
        }
        
}

var rid,fileAwait,windowObject;

function clearTmp(){
    //This function clear up the localStorage variable stuck in the localStorage
    ao_module_removeTmp("FFmpegFactoryFileSelectorWithExtension");
    ao_module_removeTmp("FFmpegFactoryFileSelectorWithoutExtension");
}

function openSelectFiles(object){
    //When the user double click on the file extensions, allow them to select files for converting to this extension
    convertionTarget = $(object).text().trim();
    if (inVDI){
        //Opening file selection window
        ao_module_newfw("SystemAOB/functions/file_system/fileSelector.php?allowMultiple=true","Starting file selector","spinner","FFmpegFactoryFileSelector",1180,645,ao_module_getLeft() + 30,ao_module_getTop() + 30,undefined,undefined,ao_module_windowID,"addFileFromSelector");
    }else{
        //Opening a file selection window under non-VDI mode
        rid = "FFmpegFactoryFileSelectorWithExtension";
        ao_module_openFileSelectorTab(rid,"../",true,"file",addFileFromSelector);
    }
}

function selectTargetFormat(object){
    if (waitingFormatSelect == false){
        $(".selectable").each(function(){
            $(this).removeClass("selectedConvertTarget");
        });
        $(object).addClass("selectedConvertTarget");
        convertionTarget = $(object).text().trim();
        currenetCommand = $(object).attr("cmd");
    }else{
        //User has selected files. Now selected file extension
        waitingFormatSelect = false;
        $(".selectable").each(function(){
            $(this).removeClass("selectedConvertTarget");
        });
        $(object).addClass("selectedConvertTarget");
        convertionTarget = $(object).text().trim();
        currenetCommand = $(object).attr("cmd");
        //Add all the file to list
        generateFileListFromFileDataObject(convertPendingFiles);
        //Resetting all controls
        convertPendingFiles = {};
        enableAllButtons();
        $(".FFmpegStatus").text("Conversion Pending. Press Start Queue to start converting the listed files.");
    }
}

function selectFile(object){
    $(".selectedFile").each(function(){
        $(this).removeClass("selectedFile");
    });
    $(object).addClass('selectedFile');
}

function removeThis(object){
    $(object).parent().parent().parent().remove();
}

$(document).ready(function(){
	$(".fileFormatSelector").css("height",window.innerHeight * 0.4);
});

$(".accordion").on('click',function(){
   $(".accordion").not(this).removeAttr("open");
   $(this).find(".content").css("height",window.innerHeight * 0.4);
});

$( window ).resize(function() {
   $(".accordion").each(function(){
	   if ($(this).attr("open")){
		   $(this).find(".content").css("height",window.innerHeight * 0.4);
	   }
   });
});

</script>
</body>
</html> 