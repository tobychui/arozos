<?php
include_once '../auth.php';
?>
<!DOCTYPE HTML>
<html>
<head>
<script src="../script/jquery.min.js"></script>
<script src="../script/dropzone/dropzone.js"></script>
<link rel="stylesheet" href="../script/dropzone/min/dropzone.min.css">
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>

<title>ArOZ Onlineβ</title>
    <style type="text/css">
        body {
            //padding-top: 4em;
            background-color: rgb(250, 250, 250);
        }
        .ts.segmented.list {
            //height: 100vh;
        }
    </style>
</head>
<body>
	<?php
	$embeddMode = false;
	if (isset($_GET['embedded']) && $_GET['embedded'] == "true"){
		$embeddMode = true;
	}
	?>
	
	<br>
	<style>
        .dropzone-previews {
            height: 200px;
            width: 500px;
            border: dashed 1px red;
            background-color: lightblue;
        }
    </style>
	<?php
	$upload2module = "";
	//Check if the target module directory has been provided
	if (isset($_GET['target']) && $_GET['target'] != ""){
		$upload2module = $_GET['target'];
	}else{
		$errmsg = "The upload target directory is undefined.";
		$thisfile = basename($_SERVER['PHP_SELF']);
		header("Location: index.php?errmsg=" . $errmsg ."&source=" . $thisfile );
		die();
	}
	//Check if the target module support upload or notice
	if (!file_exists("../" . $upload2module . "/uploads/")){
		$errmsg = "The 'uploads' directory in the target directory were not found. Are you sure you have created an 'uploads' folder under your module's root directory?";
		$thisfile = basename($_SERVER['PHP_SELF']);
		header("Location: index.php?errmsg=" . $errmsg ."&source=" . $thisfile );
		die();
	}
	$reminder = '<dialog id="reminder" class="ts basic fullscreen modal" style="position:fixed;
    margin:0 auto;
    clear:left;
    height:auto;
    z-index: 1000;
	display:none;
	background:rgba(0,0,0,0.5);
    text-align:center;" open>
		<div class="ts icon header">
			<i class="notice circle icon"></i> Reminder from %MODULE_NAME% Module
		</div>
		<div class="content">
			<p>%REMINDER_TEXT%<br>
			%SYSTEMINFO%</p>
		</div>
		<div class="actions">
			<button class="ts inverted basic button" onClick="NSA()">
				Never shown again
			</button>
			<button class="ts inverted basic button" onClick="HideReminder()">
				OK
			</button>
		</div>
	</dialog>';
	
	if (isset($_GET['reminder']) && $_GET['reminder'] != ""){
		$rbox = str_replace("%MODULE_NAME%",$upload2module,$reminder);
		$rbox = str_replace("%REMINDER_TEXT%",$_GET['reminder'],$rbox);
		$systeminfo = "ArOZ Online BETA [Developmental Build] Upload Manager UI";
		$rbox = str_replace("%SYSTEMINFO%",$systeminfo,$rbox);
		echo $rbox;
	}
	$finishing = "";
	if (isset($_GET['finishing']) && $_GET['finishing'] != ""){
		$finishing = "../" . $upload2module . "/" . $_GET['finishing'];
	}else{
		$finishing = "../". $upload2module . "/";
	}
	?>
	<script>
	//Transfering variables from PHP to Javascript
	var modulename = "<?php echo $upload2module;?>";
	var finishingStep = "<?php echo $finishing;?>";
	</script>
	
	
    <div class="ts narrow container">

        <div class="ts breadcrumb">
            <div href="#!" class="section">Upload Manager UI</div>
            <div class="divider">/</div>
            <div href="" class="section"><i class="folder icon"></i> <?php echo $upload2module;?></div>
            <div class="divider">/</div>
            <div class="active section">
			<?php
			if (isset($_GET['ext']) && $_GET['ext'] != ""){
				if (strpos($_GET['ext'],"/media/") === 0){
					echo '<i class="usb icon"></i>'.$_GET['ext'];
				}else{
					die("ERROR. Invalid external upload path.");
				}
			}else{
				echo '<i class="folder icon"></i>Uploads';
			}
			?>
            </div>
        </div>
		<div class="active section" style="display:inline;position:absolute;right: 0;">
			<?php
			//Echo the internal storage path
				echo '<a class="ts label" onClick="changeUploadTarget(this);">
					<i class="folder icon"></i> ' . "Uploads" .'
				</a>';
				include("../SystemAOB/functions/system_statistic/listMountedStorage.php");
				foreach ($mountInfo as $usabledrive){
					echo '<a class="ts label" onClick="changeUploadTarget(this);">
							<i class="usb icon"></i> ' . $usabledrive[1] .'
						</a>';
				}
			?>
		</div>
<!-- END OF TOP BAR-->
		
        <br><br>
		<form action="upload_handler.php"
		  class="dropzone"
		  id="fileDropzone">
		  <input type="text" style="display:none;" name="targetModule" value="<?php echo $upload2module;?>">
		  <input type="text" style="display:none;" name="filetype" value="<?php
		  if (isset($_GET['filetype']) && $_GET['filetype'] != ""){
			  echo $_GET['filetype'];
		  }else{
			  echo '';
		  }
		  ?>">
		  <input type="text" style="display:none;" name="extmode" value="<?php
		  if (isset($_GET['ext']) && $_GET['ext'] != ""){
			  echo $_GET['ext'];
		  }else{
			  echo '';
		  }
		  ?>">
		</form>
	<p><i class="notice circle icon"></i>Supported Format: 
	<?php
	 if (isset($_GET['filetype']) && $_GET['filetype'] != ""){
			  echo $_GET['filetype'];
		  }else{
			  echo 'ALL';
		  }
	?></p>

	
<script>
var ao_module_virtualDesktop = !(!parent.isFunctionBar);
if (ao_module_virtualDesktop){
	$("#topMenu").hide();
	$("body").css("padding-bottom","50px");
}

function cancelOperation(){
	if (ao_module_virtualDesktop){
		if (ao_module_virtualDesktop)ao_module_windowID = $(window.frameElement).parent().attr("id");
		parent.closeWindow(ao_module_windowID);
	}else{
		window.location = '../';
	}
}
    $( document ).ready(function() {
        //Check if reminder should be shown
		var show_reminder = localStorage.getItem(modulename.toLowerCase() + "-reminder");
		console.log(show_reminder);
		if (show_reminder == '0'){
			$('#reminder').hide();
		}else{
			$('#reminder').show();
		}
    });
	
function traditional(){
	var uri = 'upload_interface_traditional.php';
	uri = uri + document.location.search;
	window.location.href=uri;
}
	
function DoneUpload(){
	window.location = finishingStep;
}
function HideReminder(){
	$('#reminder').fadeOut('slow');
}
function NSA(){
	//Never shown again for this module
	localStorage.setItem(modulename.toLowerCase() + "-reminder", 0);
	$('#reminder').fadeOut('slow');
}
function changeUploadTarget(object){
	var target = ($(object).text().trim());
	var newurl = window.location.href;
	if (target == "Uploads"){
		newurl = removeParam("ext",newurl);
	}else{
		newurl = removeParam("ext",newurl);
		newurl = newurl + "&ext=" + target;
	}
	window.location.href = newurl;
}
function removeParam(key, sourceURL) {
    var rtn = sourceURL.split("?")[0],
        param,
        params_arr = [],
        queryString = (sourceURL.indexOf("?") !== -1) ? sourceURL.split("?")[1] : "";
    if (queryString !== "") {
        params_arr = queryString.split("&");
        for (var i = params_arr.length - 1; i >= 0; i -= 1) {
            param = params_arr[i].split("=")[0];
            if (param === key) {
                params_arr.splice(i, 1);
            }
        }
        rtn = rtn + "?" + params_arr.join("&");
    }
    return rtn;
}

</script>

</body>
</html>