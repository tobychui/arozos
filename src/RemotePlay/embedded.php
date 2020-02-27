<?php
include_once("../auth.php");
if(!file_exists("data")){
	mkdir("data",0777,true);
}
if (isset($_GET['fp']) && isset($_GET['rid'])){
	$rid = $_GET['rid'];
	$rid = explode(",",$rid)[0];
	file_put_contents("data/" . $rid . ".inf","fopen," . $_GET['fp']);
	echo "DONE";
	exit(0);
}

function check_file_is_audio( $tmp ) 
{
    $allowed = array(
        'audio/mpeg', 'audio/x-mpeg', 'audio/mpeg3', 'audio/x-mpeg-3', 'audio/aiff', 
        'audio/mid', 'audio/x-aiff', 'audio/x-flac', 'audio/x-mpequrl','audio/midi', 'audio/x-mid', 
        'audio/x-midi','audio/wav','audio/x-wav','audio/xm','audio/x-aac','audio/basic',
        'audio/flac','audio/mp4','audio/x-matroska','audio/ogg','audio/s3m','audio/x-ms-wax',
        'audio/xm', 'image/jpeg', 'video/mp4', 'image/png', 'image/svg'
    );
    
    // check REAL MIME type
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $type = finfo_file($finfo, $tmp );
    finfo_close($finfo);
    
    // check to see if REAL MIME type is inside $allowed array
    if( in_array($type, $allowed) ) {
        return true;
    } else {
        return false;
    }
}

//Check if the file exists and it is audio file.
$valid = true;
$external = false;
if(isset($_GET['filepath']) && file_exists($_GET['filepath'])){
	//This file exists.
	$filename = $_GET['filepath'];
	$filepath = $filename;
}else if (isset($_GET['filepath']) && strpos($_GET['filepath'],"extDiskAccess.php?file=") !== false){
	//This file is imported from external storage.
	$external = true;
	$filename = $_GET['filepath'];
	$filepath = array_pop(explode("=",$_GET['filepath']));
}else{
	$valid = false;
}

if (isset($_GET['filename'])){
	$displayName =  $_GET['filename'];
}else{
	$displayName =  basename($filename);
}
if (!check_file_is_audio($filepath)){
	//This is not an audio file
	$valid = false;
}
if(!$valid){
	die("Error. There are problems with the selected files.");
}
?>
<html>
<head>
	<link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	<script src="../script/jquery.min.js"></script>
	<script src="../script/ao_module.js"></script>
	<link rel="manifest" href="manifest.json">
	<style>
		body{
			background-color:#0c0c0c;
			color:white;
		}
		.white{
			color:white !important;
		}
	</style>
	
</head>
<body>
<br>
<div class="ts container" style="color:white;">
	<h5 class="ts header">
		<i class="white feed icon"></i>
		<div class="white content">
			Send to RemotePlay
			<div class="white sub header">Request Remote Device to play a file</div>
		</div>
	</h5>
	<hr>
	<p class="white">Target RemotePlay ID</p>
	<div class="ts floating dropdown labeled icon button" style="padding: 0px;padding-right: calc(0.22em + 1em + .78571em * 2) !important;padding-left: 0em !important;background-color: black;color:white;height: 39.97px;width:100%">
					<div class="text" style="width:100%">
						<div class="ts fluid input" style="right 1px;bottom:1px">
							<input type="text" style="border-top-right-radius: 0px;border-bottom-right-radius: 0px;background-color: black;color: white!important;border-color: white!important;border-right:0px" placeholder="RemotePlay ID" id="remoteID_tb">
						</div>
					</div>
					<i class="caret down icon" style="left: auto !important;right: 0em !important;background-color: black;"></i>
					<div class="menu" style="background-color: black !important;"  id="n_remoteID">
					</div>
				</div>
	<br><p class="white">Filename</p>
	<div class="ts basic mini fluid input">
		<input id="filename" class="white" type="text" value="<?php echo $displayName;?>" readonly=true>
	</div>
	<br><p class="white">Target Filepath</p>
	<div class="ts basic mini fluid input">
		<input id="filepath" class="white" type="text" value="<?php echo $filename;?>" readonly=true>
	</div>
	<br><br>
	<div align="right">
		<button class="ts basic white mini button" onClick="createRequest();">Send</button>
	</div>
</div>
	<script>
	var rid = $("#rid").text().trim();
	ao_module_setWindowSize(385,420);
	
$(document).ready(function(){
	ts('.ts.dropdown:not(.basic)').dropdown();
	$(".ts.fluid.input").click(function(e) {
		e.stopPropagation();
	});
	var h = $(".ts.fluid.input").height();
	$(".ts.floating.dropdown.labeled.icon.button").attr("style",$(".ts.floating.dropdown.labeled.icon.button").attr("style").replace("39.97",h));
	//$(".caret.down.icon").attr("style",$(".caret.down.icon").attr("style").replace("39.97",h));
	update();
});
	
	setInterval(update, 10000);
function update(){
		var previousRemoteID = ao_module_getStorage("remoteplay","remoteID");
	$.get("opr.php?opr=scanalive",function(data){
		var obj = JSON.parse(data);
		$("#n_remoteID").html("");
		$("#n_remoteID").append($('<div class="item" style="color: white!important;"></div>').attr("value", "").text("Not selected"));
		$.each( obj, function( key, value ) {
			$("#n_remoteID").append($('<div class="item" style="color: white!important;"></div>').attr("value", value).text(value));
		});
		$("#n_remoteID").val("");
		/*
		if (previousRemoteID !== undefined && $(".item[value='" + previousRemoteID + "']").length > 0){
			$("#remoteID_tb").val(previousRemoteID);
			rid = previousRemoteID;
		}
		*/
		$("#remoteID_tb").val(previousRemoteID);
		$("#n_remoteID .item").on("click",function(){
			//console.log($(this).attr("value"));
			$("#remoteID_tb").val($(this).attr("value"));
			ao_module_saveStorage("remoteplay","remoteID",$(this).attr("value"));
			rid = $(this).attr("value");
		});
		$("#remoteID_tb").on("change",function(){
			ao_module_saveStorage("remoteplay","remoteID",$(this).val());
			rid = $(this).val();
		});
	});
}

	ao_module_setWindowTitle("Send to RemotePlay");
	ao_module_setWindowIcon("feed");
	
	$("#remoteID_tb").on("change",function(){
		ao_module_saveStorage("remoteplay","remoteID",$(this).val());
	});
	
	$("#remoteID_tb").on("keydown",function(e){
		if (e.keyCode == 13){
			//Enter is pressed
			createRequest();
		}
	});
	
	function createRequest(){
		var filepath = $("#filepath").val();
		var remoteID = $("#remoteID_tb").val();
		$.get("embedded.php?fp=" + filepath + "&rid=" + remoteID,function(data){
			if (data.includes("ERROR") == false){
				ao_module_close();
			}
		});
	}
	</script>
</body>
</html>