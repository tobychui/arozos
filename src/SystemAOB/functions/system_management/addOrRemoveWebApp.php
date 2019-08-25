<?php
include '../../../auth.php';
?>
<?php
$AOBroot = "../../../";
$modules = glob("$AOBroot*");
$hideModules = ["SystemAOB"];
$webappList = [];
foreach ($modules as $webapp){
	if (is_dir($webapp) && in_array(str_replace($AOBroot,"",$webapp),$hideModules) == false){
		if (file_exists($webapp . "/index.php") || file_exists($webapp . "/index.html")){
			$emSupport = false;
			if (file_exists($webapp ."/embedded.php")){
				$emSupport = true;
			}
			$fwSupport = false;
			if (file_exists($webapp . "/FloatWindow.php")){
				$fwSupport = true;
			}
			$displayName = str_replace($AOBroot,"",$webapp);
			$description = "No description about this module has been written in the package.";
			if (file_exists($webapp . "/" . "description.txt")){
				$description = file_get_contents($webapp . "/" . "description.txt");
				if (strlen($description) >= 80) {
					$description = substr($description, 0, 75). " ... ";
				}
			}
			if (file_exists($webapp . "/img/small_icon.png")){
				$icon = $webapp . "/img/small_icon.png";
			}else{
				$icon = $webapp . "/img/function_icon.png";
			}
			array_push($webappList,[$displayName,$description,$icon,$webapp . "/",$emSupport,$fwSupport]);
		}
		
	}
	
}
//echo json_encode($webappList);

?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Add or Remove Web Apps
			<div class="sub header">All the installed WebApps are listed below. Please select your desired operations on the module.</div>
		</div>
	</div>
	List of WebApps
	<div class="ts container">
		<div class="ts bottom attached vertical menu">
		<a class="item" style="background-color:#cdffc1;" style="cursor:pointer;" onClick="$('#installMethod').slideToggle();"><i class="add square icon"></i>Click here to install new WebApp Modules</a>
		<div id="installMethod" class="ts attached segment" style="display:none;">
		<div class="ts breadcrumb">
			<div style="color:#0000EE;cursor:pointer;" class="section" onClick="redirectToPackageMenager();">Install via Package Manager</div> 
			<span class="divider">/</span> <a style="color:#0000EE;cursor:pointer;" class="section" href="../../../Upload%20Manager/upload_interface.php?target=Upload Manager&filetype=zip&embedded=true&finishing=moduleInstaller.php?rdt=aorw">Install via Upload</a><br>
		</div>
		</div>
		
		<?php
		$template = '<div class="item" onClick="selected(this);" moduleName="%MODULENAME%">
				<div class="ts comments">
					<div class="comment" style="cursor:pointer;">
						<div class="avatar">
							<img src="%PREVIEW%">
						</div>
						<div class="content">
							<a class="author">%MODULENAME%</a>
							<div class="text">%DESCRIPTION%</div>
						</div>
					</div>
				</div>
			</div>';
			
			foreach($webappList as $webapp){
				$box = str_replace("%PREVIEW%",$webapp[2],$template);
				$box = str_replace("%MODULENAME%",$webapp[0],$box);
				$box = str_replace("%DESCRIPTION%",$webapp[1],$box);
				echo $box;
			}
		
		
		?>
		</div>
	</div>
</div>
<div id="TrashStatus" class="ts segment">

</div>

<div id="uninstallMsg" style="display:none;">
<div class="ts breadcrumb">
<div id="getModuleSize" class="active section" style="display:inline;cursor:default;"></div> 
<span class="divider">/</span> <div style="color:#0000EE;cursor:pointer;" class="section" onClick="downloadThisModule();">Zip and Down</div> 
<span class="divider">/</span> <div style="color:#0000EE;cursor:pointer;" class="section" onClick="uninstallThisModule();">Uninstall</div><br>
</div>
</div>

<div>
</div>

<div id="msgbox" class="ts active bottom right snackbar" style="display:none;">
    <div class="content">
        Your request is processing now.
    </div>
</div>

<br><br>
<script>
var inVDI = !(!parent.isFunctionBar);
var lastSelectedObject="";
var underNaviEnv = !(!parent.underNaviEnv);
getTrashBinStatus();


function redirectToPackageMenager(){
	if (underNaviEnv){
		parent.callToSelectionID("packageman");
	}else{
		window.location.href = "../package_manager/";
	}
}

function getTrashBinStatus(){
	$.ajax({
	  url: "../file_system/filesize.php?file=../system_management/TrashBin",
	}).done(function(result) {
		$("#TrashStatus").html("Uninstalled WebApp backup size (Trash bin): " + result + " >> <a style='cursor:pointer;' onClick='cleanTrashBin();'>clean</a>");
	});
}

function cleanTrashBin(){
	if (confirm("This will clean all the uninstalled module backups and restoring any data from backups will be no longer possible.\n Are you sure?")){
		$.ajax({
		  url: "cleanTrashBin.php",
		}).done(function(result) {
			window.location.reload();
		});
	}
}

function selected(object){
	if (lastSelectedObject != ""){
		$(lastSelectedObject).css("border-style","solid");
		$(lastSelectedObject).css("border-width","0px");
		$(lastSelectedObject).css("border-color","#ffffff");
		$(lastSelectedObject).css("background-color","#ffffff");
	}
	$(object).css("border-style","solid");
	$(object).css("border-width","1px");
	$(object).css("border-color","#5998ff");
	$(object).css("background-color","#e2fdff");
	getModuleSize($(object).attr("moduleName"));
	$("#uninstallMsg").appendTo(object);
	$("#uninstallMsg").show();
	lastSelectedObject = object;
	$("#installMethod").slideUp();
}

function getModuleSize(moduleName){
	$.ajax({
	  url: "../file_system/filesize.php?file=../../../" + moduleName,
	}).done(function(result) {
		$("#getModuleSize").html("Disk space used: " + result);
	});
	
}

function uninstallThisModule(){
	if (lastSelectedObject != ""){
		var moduleName = $(lastSelectedObject).attr("moduleName");
		if (confirm("THIS ACTION CANNOT BE UNDONE.\n Confirm uninstalling WebApp '" + moduleName + "'?")){
			//Confirm uninstall
			$.ajax({
			  url: "moduleTrashBin.php?folder=../../../" + moduleName + "&foldername=" + moduleName,
			}).done(function(result) {
				if (result.includes("ERROR")){
					msgbox("Something went wrong during uninstalling this module.");
				}else{
					window.location.reload();
				}
			});
		}else{
			//Rejected uninstsall
			
		}
	}
	
}

function downloadThisModule(){
	if (lastSelectedObject != ""){
		var moduleName = $(lastSelectedObject).attr("moduleName");
		ZipFolderAndDownload(moduleName);
	}
}

function ZipFolderAndDownload(moduleName){
	msgbox("Module is compressing in the background.");
	$.ajax({
	  url: "../file_system/zipFolder.php?folder=../../../" + moduleName + "&foldername=" + moduleName,
	}).done(function(result) {
		if (result.includes("ERROR")){
			msgbox("Something went wrong in the compression.");
			console.log(result);
		}else{
			window.open("../file_system/export/" + result, "file download", ); 
		}
		
	});
}

function msgbox(message){
	$("#msgbox .content").html(message);
	$("#msgbox").hide().fadeIn().delay(3000).fadeOut();
}
</script>
</body>
</html>