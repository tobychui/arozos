<?php
include '../../../auth.php';
?>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.8, maximum-scale=0.8"/>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>File Selector</title>
    <link rel="stylesheet" href="../../../script/tocas/tocas.css">
	<script src="../../../script/tocas/tocas.js"></script>
	<script src="../../../script/jquery.min.js"></script>
	<style>
	.item {
		cursor: pointer;
		
	}
	</style>
</head>
<body>
<?php
$path = "";
$status = 1;
$target = "file";
$directOpenFile = false;
$returnPath = "../../../";
$finishing = "";

if (isset($_GET['path'])){
	if (file_exists("../../../" . $_GET['path'])){
		$path = "../../../" . $_GET['path'];
	}else{
		$path = "PATH NOT FOUND";
		$status = 0;
	}
}else{
	$path = "UNDEFINED DIRECTORY";
	$status = 0;
}

if (isset($_GET['target']) && $_GET['target'] == 'folder'){
	$target = "folder";
}else{
	$target = "file";
}

if (isset($_GET['moduleName']) && $_GET['moduleName'] != ""){
	//The module that the system should return to. If you open this module in fw mode this will get overwritten and this fw will close automatically if cancel is pressed.
	$returnPath = $_GET['moduleName'];
}

if (isset($_GET['finishing']) && $_GET['finishing'] != ""){
	//The handler where the selected file is returned to in ?filename="xxxxx" format
	$finishing = $_GET['finishing'];
}

if (is_file($path)){
	//Open the file
	$directOpenFile = true;
}
?>
<div class="ts icon message">
    <i class="folder open icon"></i>
    <div class="content">
        <div class="header">Select a <?php echo $target;?></div>
        <p id="currentPath"><?php 
		if (strpos($path,"../../../") !== false){
			echo str_replace("../../../","AOR",$path);
		}else{
			echo $path;
		}
		
		
		?></p>
    </div>
</div>
<?php if ($status == 0){ exit(0);}?>
<div class="ts segmented list">
<?php
	$files = glob("$path/*");
	$filePath = [];
	$folderPath = [];
	foreach ($files as $file){
		if (is_dir($file)){
			array_push($folderPath,$file);
		}
		if (is_file($file)){
			array_push($filePath,$file);
		}
	}
	echo ' <div class="item" defaultcolor=""><i class="chevron left icon"></i>../</div>';
	foreach ($folderPath as $object){
		echo ' <div class="item" defaultcolor=""><i class="folder outline icon"></i>'.str_replace($path . "/","",$object).'</div>';
	}
	
	foreach ($filePath as $object){
		if (strpos($object,"inith") !== false){
			$ext = pathinfo($object, PATHINFO_EXTENSION);
			$filename = str_replace("." . $ext,"",str_replace("inith","",basename($object)));
			$filename = hex2bin($filename);
			$decodedName = $filename . "." . $ext;
			$bgcolor = "rgb(216, 240, 255)";
		}else{
			$decodedName = str_replace($path . "/","",$object);
			$bgcolor = "";
		}
		echo ' <div class="item" defaultcolor="'.$bgcolor.'" filename="'.str_replace($path . "/","",$object).'" style="background-color:'.$bgcolor.';"><i class="file outline icon"></i>'.$decodedName.'</div>';
	}

?>
</div>
<div id="bottombar" style="  position: fixed;z-index: 100; bottom: 0; left: 0;width: 100%; background-color:#353535;height:60px; padding-right: 30px;padding-top: 10px;padding-left: 10px;">
	<div style="float:left;width:200px;color:white;display:inline;">
	Selected File:
	<p id="selectedItemName" style="display:inline;">No selected file / folder</p>
	</div>
	<div id="confirmBtn" class="ts separated buttons" style="float:right;display:inline;position:fixed;right:30px;">
		<div class="ts buttons">
		<button class="ts button" onClick="CancelAction();">Cancel</button>
		<div class="or" data-text="Or"></div>
		<button class="ts positive button"  onClick="ConfirmSelection();">Open</button>
		</div>
	</div>
</div>
<br><br><br><br>
<script>
var currentPath = "<?php echo $path;?>";
var directOpenFile = <?php echo $directOpenFile ? 'true' : 'false'; ?>;
var isFunctionBar = !(!parent.isFunctionBar);
var selectedFile = "";
var selectType = "<?php echo $target?>";
var actionPaths = ["<?php echo $returnPath;?>","<?php echo $finishing;?>"];

$(document).ready(function(){
	if (directOpenFile == true){
		var filename = currentPath.split("/").splice(-1,1);
		if (currentPath.includes("../../../")){
				currentPath = currentPath.replace("../../../","");
		}
		if (isFunctionBar){
			parent.newEmbededWindow("index.php?controlLv=2&mode=file&dir=" + currentPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare",0,0);
		}else{
			window.open("index.php?controlLv=2&mode=file&dir=" + currentPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare");
		}
		
	}
	if (isFunctionBar){
		$("#bottombar").css("bottom","10px");
		$("#confirmBtn").css("bottom","23px");
	}
});

function CancelAction(){
	if (isFunctionBar){
		//Call the killProcess script from FWs to kill itself
		window.location.href = "../killProcess.php";
	}else{
		//Go back to the pre-defined return path or AOB root index if not defined.
		window.location.href = actionPaths[0];
	}
}

function ConfirmSelection(){
	var finishingPath = actionPaths[0] + "/" + actionPaths[1];
	if (finishingPath.includes("?")){
		//The original php path already exists a varable, append to it with &filename=
		window.location.href = finishingPath + "&filename=" + selectedFile;
	}else{
		//The original php script do not have any defined variable, go with ?filename=
		window.location.href = finishingPath + "?filename=" + selectedFile;
	}
}


$( ".item" ).hover(
  function() {
    $(this).addClass("selected");
	if ($(this).attr("defaultcolor") != ""){
		$(this).css("background-color","#1e7fcb");
	}
  }, function() {
    $(this).removeClass("selected");
	if ($(this).attr("defaultcolor") != ""){
		$(this).css("background-color",$(this).attr("defaultcolor"));
	}
	
  }
);

$(".item").click(function(e){
	e.preventDefault();
	var divContent = $(this).text();
	if (divContent != "../"){
		//It is not the back button
		if (selectType == "folder"){
			//Select folder
			if($(this).html().includes("file outline") == false){
				$("#selectedItemName").text("/" + divContent);
				selectedFile = currentPath.replace("../../../","") + "/" + divContent;
			}
			
		}else{
			//Select files
			if($(this).html().includes("file outline")){
				$("#selectedItemName").text(divContent);
				var filename = $(this).attr("filename");
				targetPath = currentPath.replace("../../../","") + "/" + filename;
				selectedFile = targetPath;
			}
		}
	}
});


$( ".item" ).dblclick(function(e){
	e.preventDefault();
	var divContent = $(this).text();
	if (divContent == "../"){
		//Go back one page
		if (currentPath.substring(1,currentPath.length - 1).includes("/") == false || currentPath == "/"){
			return;
		}
		currentPath = currentPath.split('\\').join("/");
		currentPath = currentPath.replace("/" + currentPath.split("/").splice(-1,1).join("/"),"");
		if (currentPath.includes("../../../")){
				redirectpath = currentPath.replace("../../../","");
		}else{
			redirectpath = currentPath;
		}
		window.location.href = "fileSelector.php?path=" + redirectpath + "&target=" + selectType + "&moduleName=" + actionPaths[0] + "&finishing=" +　actionPaths[1];
	}else{
		//Redirect to new page
		if ($(this).html().includes("file outline")){
			//This is a file, open it
			var filename = $(this).attr("filename");
			targetPath = currentPath + "/" + filename;
			if (targetPath.includes("/var/www/html")){
				//Quick fix for something I have no idea what is happening...
				var indexOfhtml = targetPath.indexOf("/var/www/html");
				targetPath = targetPath.substring(indexOfhtml,targetPath.length - indexOfhtml + 2);
			}
			if (targetPath.includes("../../../")){
				redirectpath = targetPath.replace("../../../","");
			}else{
				redirectpath = targetPath;
			}
			
			if (isFunctionBar){
				parent.newEmbededWindow("index.php?controlLv=2&mode=file&dir=" + redirectpath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare",undefined,undefined,0,0);
			}else{
				window.open("index.php?controlLv=2&mode=file&dir=" + redirectpath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare");
			}
		}else{
			//This is a folder, open it
			if (currentPath.includes("../../../")){
				redirectpath = currentPath.replace("../../../","");
			}else{
				redirectpath = currentPath;
			}
			window.location.href = "fileSelector.php?path=" + redirectpath + "/" + divContent + "&target=" + selectType + "&moduleName=" + actionPaths[0] + "&finishing=" + actionPaths[1];
		}
		
	}
  });
  
</script>
</body>
</html>