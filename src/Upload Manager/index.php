<?php
include '../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<link rel="stylesheet" href="../script/css/font-awesome.min.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
</head>
<body>
	<nav id="navbar" class="ts attached inverted borderless large menu">
        <div class="ts narrow container">
            <a href="../index.php" class="item">ArOZ Online β</a>
        </div>
    </nav>
	<div class="ts container">
		<div class="ts slate">
			<i class="upload icon"></i>
			<span class="header">Hello there!</span>
			<span id="descriptionText" class="description">This is a developer function that accept external upload request by other functional modules.<br>
			If you enter here accidentally, please press <a href="../">HERE</a> and return to the function menu.</span>
		</div>
	<!-- 
	<div class="ts segment">
		Advance System Upload Functions <br><br>
		<button class="ts labeled icon basic button" onClick="ModuleInstall();">
			<i class="file archive outline icon"></i>
			Module Installer
		</button>
		<button class="ts labeled icon basic button">
			<i class="trash icon"></i>
			Module Uninstall
		</button>
	</div> -->
	<div class="ts segment">
    <details class="ts accordion">
        <summary>
            <i class="dropdown icon"></i> I am a developer! How can I use this module?
        </summary>
        <div class="content">
            <div class="ts padded slate">
				<span class="header">Wow! It's all so simple! :)</span>
				<span class="description">It is just as simple as passing parameters to the upload interface. Here is an example:</span>
				<div class="action">
				<blockquote class="ts secondary quote">
					Example Command for uploading files into the Audio Module:<br>
					<i class="code icon"></i>"Upload Manager/upload_interface.php?target=Audio"<br><br>
					Example Command for the above plus a reminder:<br>
					<i class="code icon"></i>"Upload Manager/upload_interface.php?target=Audio&reminder=This is a reminder :)"<br><br>
					Example Command for the above plus a limitation on upload file extensions:<br>
					<i class="code icon"></i>"Upload Manager/upload_interface.php?target=Audio&reminder=This is a reminder :)&filetype=mp3,mp4"<br><br>
					Example Command for the above plus an upload process handler that should run after uplaod finished.<br>
					<i class="code icon"></i>"Upload Manager/upload_interface.php?target=Audio&reminder=This is a reminder :)&filetype=mp3,mp4&finishing=process_handler.php"<br><br>
					<i class="caution sign icon"></i>Multiple file extensions have to be seperated with ","<br>
					<i class="caution sign icon"></i>Finishing process handler must be a php within the root of your module.<br>
					<i class="notice circle icon"></i>For more information, please visit the Github page or send an email to the developer.
				</blockquote>
				</div>
			</div>
        </div>
    </details>
	</div>
	<?php
	if (isset($_GET['errmsg']) && $_GET['errmsg'] != "" && isset($_GET['source']) && $_GET['source'] != ""){
		echo '<div class="ts text container">';
		echo '<div class="ts negative segment">
				<h3>Seems you call the API with wrong format :( </h3>
				<p>'.$_GET['errmsg'].'<br>
				Request denied by: '.$_GET['source'].'</p>
			</div>';
		echo '</div>';
	}
	
	?>
	</div>
	<script>
	if (ao_module_virtualDesktop){
		$("#navbar").hide();
		ao_module_setWindowIcon("upload");
		$("#descriptionText").html("This is a developer function that accept external upload request by other functional modules. <br>Please close this window if you open this function by accident.");
	}
	function ModuleInstall(){
		window.location.href = "upload_interface.php?target=Upload Manager&filetype=zip&finishing=moduleInstaller.php?rdt=um";
	}
	</script>
</body>
</html>