<?php
include '../auth.php';
function mv($var){
	if (isset($_POST[$var]) && $_POST[$var] != ""){
		return $_POST[$var];
	}else{
		return "";
	}
}

if (mv("tt") != "" && mv("tp") != "" && mv("tn") != "" && mv("user") != ""){
	$username = mv("user");
	$shortcutname = time();
	$filename = "files/" . $username . "/" . $shortcutname . ".shortcut";
	$targetType = mv("tt");
	if ($targetType == "module"){
		$iconPath = "../" . mv("tp") . "/img/";
		if (file_exists($iconPath . "desktop_icon.png")){
			$icon = mv("tp") . "/img/desktop_icon.png";
		}else{
			$icon = mv("tp") . "/img/function_icon.png";
		}
	}else if ($targetType == "script"){
		$icon = "Desktop/img/system_icon/script.png";
	}else if ($targetType == "foldershrct"){
		$icon = "Desktop/img/system_icon/folder-shortcut.png";
	}else if ($targetType == "url"){
		$url = mv("tp");
		$parse = parse_url($url);
		//favicon of the website 
		$icon = $parse['scheme'] . "://" . $parse['host'] . '/favicon.ico';
	}
	$newshortcut = fopen($filename, "w");
	$content = mv("tt") . PHP_EOL . mv("tn") . PHP_EOL . mv("tp") . PHP_EOL . $icon . PHP_EOL;
	fwrite($newshortcut, $content);
	fclose($newshortcut);
	echo 'DONE';
	exit();
}
?>
<html>
<head>
	<title>Create Shortcut</title>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<script src="../script/jquery.min.js"></script>
	<script src="../script/ao_module.js"></script>
</head>
<body>
<br>
<div id="sectionA" class="section">
<div class="ts container">
	<div class="ts header">
		Create Shortcut
		<div class="sub header">Select the type of shortcut you want to create.</div>
	</div>
</div>
<div class="ts grid">
    <div class="four wide column">
		<img class="ts link small image" src="img/system_icon/a-module.png" onClick="setType(0);">
	</div>
    <div class="four wide column">
		<img class="ts link small image" src="img/system_icon/webscript.png" onClick="setType(1);">
	</div>
	<div class="four wide column">
		<img class="ts link small image" src="img/system_icon/Directory.png" onClick="setType(2);">
	</div>
	<div class="four wide column">
		<img class="ts link small image" src="img/system_icon/Weburl.png" onClick="setType(3);">
	</div>
</div>

</div>

<div id="sectionB" class="section">
<div class="ts container">
	<div class="ts header">
		Create Module Shortcut
		<div class="sub header">Please select the module you want to make shortcut for.</div>
	</div>
</div>
<select id="moduleChoice" class="ts basic fluid dropdown">
	<?php
		$modules = glob("../*");
		foreach ($modules as $module){
			if ( is_dir($module) && file_exists($module . "/FloatWindow.php")){
				$moduleName = basename($module);
				if ($moduleName != "Desktop"){
					echo "<option>$moduleName</option>";
				}
				
			}
		}
	?>
</select>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="createModuleShortcut();">Create</div>
</div>

</div>

<div id="sectionC" class="section">
<div class="ts container">
	<div class="ts header">
		Create Script Shortcut
		<div class="sub header">Please enter the relative path (from ArOZ Online Root) of the script.<br>For example: script/helloworld.php</div>
	</div>
</div>
<div class="ts fluid underlined action input">
    <input id="scriptrelativepath" type="text" placeholder="Relative path of the script">
    <button class="ts icon button" onClick="selectFileUsingSelector();"><i class="folder open icon"></i></button>
</div>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="recordName();">Next</div>
</div>

</div>

<div id="sectionD" class="section">
<div class="ts container">
	<div class="ts header">
		Shortcut Name
		<div class="sub header">Please give a name for your shortcut.</div>
	</div>
</div>
<div class="ts fluid underlined input">
    <input id="scriptshortcutname" type="text" placeholder="Shortcut name">
</div>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="createScriptShortcut();">Create</div>
</div>

</div>

<div id="sectionE" class="section">
<div class="ts container">
	<div class="ts header">
		Create Folder Shortcut
		<div class="sub header">Please enter the relative path of the folder.<br>For example: Audio/uploads/</div>
	</div>
</div>
<div class="ts fluid underlined action input">
    <input id="folderrelativepath" type="text" placeholder="Relative path of the script">
    <button class="ts icon button" onClick="selectFileUsingSelector(1);"><i class="folder open icon"></i></button>
</div>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="recordFolderpath();">Next</div>
</div>
</div>

<div id="sectionF" class="section">
<div class="ts container">
	<div class="ts header">
		Folder Shortcut Name
		<div class="sub header">Please give a name for your shortcut.</div>
	</div>
</div>
<div class="ts fluid underlined input">
    <input id="displayfoldername" type="text" placeholder="Folder Shortcut Name">
</div>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="createfoldershortcut();">Create</div>
</div>

</div>

<div id="sectionG" class="section">
<div class="ts container">
	<div class="ts header">
		URL Shortcut
		<div class="sub header">Please enter a url for generating a shortcut.</div>
	</div>
</div>
<div class="ts fluid underlined input">
    <input id="urlshortcuttarget" type="text" placeholder="URL">
</div>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="updateToInterface(7);">Next</div>
</div>

</div>

<div id="sectionH" class="section">
<div class="ts container">
	<div class="ts header">
		URL Shortcut Name
		<div class="sub header">Please enter name for the shortcut</div>
	</div>
</div>
<div class="ts fluid underlined input">
    <input id="urlshortcutname" type="text" placeholder="URL Shortcut Name">
</div>
<div class="ts fluid bottom attached buttons">
    <div class="ts tiny primary button" onClick="createURLshortcut();">Create</div>
</div>

</div>

<script>
var currentStep = 0;
var targetType = "";
var targetPath = "";
var targetName = "";
var username = localStorage.getItem('ArOZusername');

//Update for allow selecting directory with file folder selector
function selectFileUsingSelector(mode = 0){
    //Open file selector, mode 0 = file, mode 1 = folder
    var uid = ao_module_utils.getRandomUID();
    if (mode == 0){
        if (ao_module_virtualDesktop){
            ao_module_openFileSelector(uid,"updateSelectedWebScript");
        }else{
            ao_module_openFileSelectorTab(uid,"../",undefined,undefined,updateSelectedWebScript);
        }
    }else{
        if (ao_module_virtualDesktop){
            ao_module_openFileSelector(uid,"updateSelectedFolderShortcut",undefined,undefined,undefined,"folder");
        }else{
            ao_module_openFileSelectorTab(uid,"../",undefined,"folder",updateSelectedFolderShortcut);
        }
    }
    
    
}

function updateSelectedFolderShortcut(filedata){
    result = JSON.parse(filedata);
	for (var i=0; i < result.length; i++){
		var filename = result[i].filename;
		var filepath = result[i].filepath;
		$("#folderrelativepath").val(filepath);
   }
}


function updateSelectedWebScript(filedata){
    result = JSON.parse(filedata);
	for (var i=0; i < result.length; i++){
		var filename = result[i].filename;
		var filepath = result[i].filepath;
		$("#scriptrelativepath").val(filepath);
   }
}



$(document).ready(function(){
	hideAllSection();
	$("#sectionA").show();
});
	
function recordName(){
	targetPath = $("#scriptrelativepath").val();
	currentStep = 5
	updateInterface();
}

function recordFolderpath(){
	targetPath = $("#folderrelativepath").val();
	currentStep = 6
	updateInterface();
}

function setType(val){
	if (val == 0){
		targetType = "module";
		currentStep = 1;
	}else if (val == 1){
		targetType = "script";
		currentStep = 2;
	}else if (val == 2){
		targetType = "foldershrct";
		currentStep = 3;
	}else if (val == 3){
		targetType = "url";
		currentStep = 4;
	}
	updateInterface();
}

function updateToInterface(val){
	currentStep = val;
	updateInterface();
}

function updateInterface(){
	hideAllSection();
	if (currentStep == 0){
		$("#sectionA").show();
	}else if (currentStep == 1){
		$("#sectionB").show();
	}else if (currentStep == 2){
		$("#sectionC").show();
	}else if (currentStep == 3){
		$("#sectionE").show();
	}else if (currentStep == 4){
		$("#sectionG").show();
	}else if (currentStep == 5){
		$("#sectionD").show();
	}else if (currentStep == 6){
		$("#sectionF").show();
	}else if (currentStep == 7){
		$("#sectionH").show();
	}
}

function createURLshortcut(){
	targetPath = $("#urlshortcuttarget").val();
	targetName = $("#urlshortcutname").val();
	createShortcut();
}

function hideAllSection(){
	$(".section").each(function(){
		$(this).hide();
	});
}

function createfoldershortcut(){
	targetName = $("#displayfoldername").val();
	createShortcut();
}

function createScriptShortcut(){
	targetName = $("#scriptshortcutname").val();
	createShortcut();
}

function createShortcut(){
	console.log(targetType,targetPath,targetName);
	$.post( "createShortcut.php", { tt: targetType, tp: targetPath, tn: targetName, user: username})
	  .done(function( data ) {
		console.log(data);
		window.location.href = "../SystemAOB/functions/killProcess.php";
	  });
}

function createModuleShortcut(){
	var targetModule = $("#moduleChoice option:selected").text();
	targetPath = targetModule;
	targetName = targetModule;
	createShortcut();
}

function closeWindow(){
	
}



</script>

</body>
</html>