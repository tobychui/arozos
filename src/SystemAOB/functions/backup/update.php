<?php
include_once("../../../auth.php");
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<link rel="manifest" href="manifest.json">
<html style="min-height:300px;">
    <head>
    	<meta charset="UTF-8">
    	<script type='text/javascript' charset='utf-8'>
    		// Hides mobile browser's address bar when page is done loading.
    		  window.addEventListener('load', function(e) {
    			setTimeout(function() { window.scrollTo(0, 1); }, 1);
    		  }, false);
    	</script>
        <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
    	<script src="../../../script/jquery.min.js"></script>
    	<script src="../../../script/ao_module.js"></script>
        <title>ArOZ System Update</title>
    </head>
    <body>
	<br><br>
        <div class="ts container">
			<div class="ts segment">
				<h4 class="ts header">
					<i class="upload icon"></i>
					<div class="content">
						System Update
						<div class="sub header">Update your ArOZ Online System to the latest version.</div>
					</div>
				</h4>
			</div>
			<div class="ts segment">
				<h4>Update Package Delivery Information</h4>
				<p style="display:inline;">Current Version: </p>
				<p id="versionTag" style="display:inline;">No version information found on this system. Is this a slimmed version of ArOZ Online?</p>
				<br>
				<p style="display:inline;">Latest Version: </p>
				<p id="latestVer" style="display:inline;">Internal Development Build / No version information</p>
				<br><br>
				<p style="display:inline;">Update Package URI: </p>
				<p id="packageServer" style="display:inline;"><?php
					if (file_exists("packageServer.config")){
						echo strip_tags(file_get_contents("packageServer.config"));
					}else{
						//No defined packageServer. Use localhost
						echo '127.0.0.1/update.zip';
					}
				?></p>
			</div>
			<div class="ts segment">
				<div class="ts separated buttons">
					<button class="ts primary button"><i class="upload icon" onClick="update();"></i> Update</button>
				</div>
			</div>
		</div>
	<script>
	
	function update(){
		
	}

	$.get("../info/version.inf",function(data){
		$("#versionTag").text(data);
	});
	</script>
    </body>
</html>