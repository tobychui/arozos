<?php
include '../auth.php';
?>
<!DOCTYPE HTML>
<html>
<head>
<script src="../script/jquery.min.js"></script>
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
	<nav id="topMenu" class="ts attached inverted borderless large menu">
        <div class="ts narrow container">
            <a href="../index.php" class="item">ArOZ Online β</a>
        </div>
    </nav>
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
            <a href="../<?php echo $upload2module;?>/" class="section"><i class="folder icon"></i> <?php echo $upload2module;?></a>
            <div class="divider">/</div>
            <div class="active section">
                <i class="folder icon"></i>Uploads
            </div>
        </div>
<!-- END OF TOP BAR-->
		
        <br><br>
		<form action="upload_handler.php" method="POST" enctype="multipart/form-data">
		  <input type="text" style="display:none;" name="targetModule" value="<?php echo $upload2module;?>">
		  <input type="text" style="display:none;" name="filetype" value="<?php
		  if (isset($_GET['filetype']) && $_GET['filetype'] != ""){
			  echo $_GET['filetype'];
		  }else{
			  echo '';
		  }
		  ?>">
		  <div class="ts segment">
		  <input type='file' name='file' id="file" multiple>
		  </div>
		  <input class="ts tiny basic button" type="submit" value="Upload" name="submit">
		</form>
	<p><i class="notice circle icon"></i>Supported Format: 
	<?php
	 if (isset($_GET['filetype']) && $_GET['filetype'] != ""){
			  echo $_GET['filetype'];
		  }else{
			  echo 'ALL';
		  }
	?></p>

        <div class="ts grid">

            <div class="eleven wide column">

                <div class="ts selection segmented list">
					<?php
					$item_template = ' <a class="item">
                        <i class="%ICON_TYPE% icon"></i>
                        %FILE_NAME%
                    </a>';
					$path    = '../' . $upload2module . '/uploads/';
					$files = scandir($path);
					$files = array_diff(scandir($path), array('.', '..','Thumbs.db'));//If you are on windows,then ignore the Thumbs.db 
					foreach ($files as $file){
						//Decode File Name
						$filename = hex2bin(str_replace("." . pathinfo($file, PATHINFO_EXTENSION),"",str_replace("inith","",$file))) . "." . pathinfo($file, PATHINFO_EXTENSION);
						//echo $filename . "<br>";
						$mime = mime_content_type($path . $file);
						if(strstr($mime, "video/")){
							$icontype = "file video outline";
						}else if(strstr($mime, "image/")){
							$icontype = "file image outline";
						}else if(strstr($mime, "audio/")){
							$icontype = "file audio outline";
						}else{
							$icontype = "file outline";
						}
						//Echo each unit of file
						$itembox = str_replace("%ICON_TYPE%",$icontype,$item_template);
						$itembox = str_replace("%FILE_NAME%",$filename,$itembox);
						echo $itembox;
					}
					
						
					?>
                   
                    
                </div>

            </div>



            <div class="five wide column">
                <div class="ts card">
                    <div class="secondary very padded extra content">
                        <div class="ts icon header">
						<?php
						if (file_exists("../$upload2module/img/function_icon.png")){
                            echo '<img class="ts fluid image" src="../'.$upload2module.'/img/function_icon.png"></img>';
						}else{
							echo '<img class="ts fluid image" src="../img/no_icon.png"></img>';
						}
						?>
                        </div>
                    </div>

					<!-- Module description -->
                    <div class="extra content">
                        <div class="header"><?php 
						$description_path = "../" . $upload2module . "/description.txt";
						if (file_exists($description_path)){
							echo file_get_contents($description_path);
						}else{
							echo 'This module has no description.';
						}
						?></div>
                    </div>


                    <div class="extra content">
						<div class="ts fluid vertical buttons">
							<button onclick = "DoneUpload()" class="ts basic positive button">Done</button>
							<button onClick = "location.reload();" class="ts basic button">Update List</button>
							<button onClick = "wcancelOperation();" class="ts basic negative button">Cancel</button>
						</div>
					</div>
                <div class="ts horizontal right floated middoted link list">
                    <a class="item" onClick="traditional()">Dropzone Interface</a>
                    <div class="item">Upload Manager v1.0</div>
                </div>
            </div>

        </div>

    </div>

	
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
	
function DoneUpload(){
	window.location = finishingStep;
}
function traditional(){
	var uri = 'upload_interface.php';
	uri = uri + document.location.search;
	window.location.href=uri;
}
function HideReminder(){
	$('#reminder').fadeOut('slow');
}
function NSA(){
	//Never shown again for this module
	localStorage.setItem(modulename.toLowerCase() + "-reminder", 0);
	$('#reminder').fadeOut('slow');
}
</script>

</body>
</html>