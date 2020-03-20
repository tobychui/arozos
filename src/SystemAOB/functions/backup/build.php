<?php
include_once("../../../auth.php");
if (isset($_GET['loadFileList'])){
	$files = glob("build_tool/*.zip");
	$data = [];
	foreach ($files as $file){
		$filesize = filesize($file);
		if ($filesize < 0){
			//Overflow
			$filesize = "> 2GB";
		}else{
			$filesize = formatSizeUnits($filesize);
		}
		array_push($data, [basename($file),$file,$filesize]);
	}
	header('Content-Type: application/json');
	echo json_encode($data);
	exit(0);
}

if (isset($_GET['updateVersionNumber']) && $_GET['updateVersionNumber'] != ""){
    $newVerNumber = strip_tags($_GET['updateVersionNumber']);
    if (file_exists("../info/version.inf")){
        file_put_contents("../info/version.inf",$newVerNumber);
        echo "DONE";
    }else{
        echo "ERROR. version.inf not found.";
    }
    exit(0);
}

function formatSizeUnits($bytes){
        if ($bytes >= 1073741824)
        {
            $bytes = number_format($bytes / 1073741824, 2) . ' GB';
        }
        elseif ($bytes >= 1048576)
        {
            $bytes = number_format($bytes / 1048576, 2) . ' MB';
        }
        elseif ($bytes >= 1024)
        {
            $bytes = number_format($bytes / 1024, 2) . ' KB';
        }
        elseif ($bytes > 1)
        {
            $bytes = $bytes . ' bytes';
        }
        elseif ($bytes == 1)
        {
            $bytes = $bytes . ' byte';
        }
        else
        {
            $bytes = '0 bytes';
        }

        return $bytes;
}
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
					<div class="content">
						<i class="zip icon"></i> Build System (Developer Only)
						<div class="sub header">Developer function for building or deploying your own ArOZ Online System <br> <mark>This function require 64bits operating system. (64bits Windows / Debian / Armbian for ARMv8 or above)</mark></div>
					</div>
				</h4>
			</div>
			<div class="ts segment">
				<h4>System Version Information</h4>
				<p style="display:inline;">Current Version: </p>
				<p id="versionTag" style="display:inline;">No version information found on this system. Is this a slimmed version of ArOZ Online?</p>
				<br>
				<p>Change Version Number</p>
				<div class="ts tiny fluid action input">
                    <input id="nvn" type="text" placeholder="New Version Number">
                    <button class="ts primary button" onClick="updateVersionNumber();">Update</button>
                </div>
			</div>
			<div class="ts segment">
				<p>Build Profiles</p>
				<select id="profileSelector" class="ts basic fluid dropdown">
					<?php
						$build_profile = glob("build_profile/*.config");
						foreach ($build_profile as $profile){
							echo '<option>' . basename($profile,".config") . '</option>';
						}
					?>
				</select>
				<p>Export filename (With file extension)</p>
				<div class="ts fluid input">
				<input id="filename" type="text" placeholder="Filename">
			</div>
			<small>To add / edit build profile, navigate to SystemAOB/functions/backup/build_profile/ and edit profiles with text editor.</small>
				<br><br>
				<div class="ts separated buttons">
					<button id="buildButton" class="ts primary button"><i class="zip icon"></i>Build</button>
				</div>
			</div>
			<div id="succ" class="ts inverted positive segment" style="display:none">
				<p><i class="checkmark icon"></i> Building task started in the background.</p>
			</div>
			<div id="fail" class="ts inverted negative segment" style="display:none;">
				<p><i class="remove icon"></i>Build tool returned an error code<span id="errMsg"></span></p>
			</div>
			<div class="ts segment">
			<p>Already build package list (Click to download)</p>
				<div id="packageList" class="ts ordered list">
					<div class="item">N/A</div>
				</div>
			<p><i class="refresh icon"></i>Last Update: <span id="lastupdateTime"></span></p>
			</div>
			<div class="ts segment">
			    <?php 
			    if (strtoupper(substr(PHP_OS, 0, 3)) !== 'WIN') {
			    ?>
			        <button class="ts primary tiny button" onClick="setPackageWritable();"><i class="edit icon"></i>Set Package Writable</button>
			    <?php }?>
                <button class="ts negative tiny button" onClick="clearAllPackages();"><i class="trash outline icon"></i>Clear all packages</button>
			</div>
			<div id="pupdate" class="ts inverted positive segment" style="display:none">
				<p><i class="checkmark icon"></i> Permission updated.</p>
			</div>
		</div>
		<br><br><br><br>
	<script>
	//Setup auto detect new package
	updateFileList();
	setInterval(updateFileList,10000);
	
	$("#buildButton").on("click",function(){
		if ($("#filename").val().length == 0){
			//Not input anything. Use default instead.
			$("#filename").parent().addClass("success");
			$("#filename").val("default")
		}else{
			$("#filename").parent().removeClass("success");
		}
		
		var filename = $("#filename").val();
		var profile = $("#profileSelector").val();
		$.get("build_tool/pack.php?filename=" + filename + "&profile=" + profile,function(data){
			if (data.includes("ERROR") == false){
				$("#succ").stop().finish().fadeIn('fast').delay(3000).fadeOut('fast');
			}else{
				$("#fail").stop().finish().fadeIn('fast').delay(3000).fadeOut('fast');
				var errMsg = data.replace("ERROR","");
				$("#errMsg").text(errMsg);
			}
		});
	});
	
	function updateVersionNumber(){
	    $.get("build.php?updateVersionNumber=" + $("#nvn").val(),function(data){
	        if (data.includes("ERROR") == false){
	            updateCurrentVersionLabel();
	        }else{
	            console.log(data);
	        }
	    });
	}
	
	function clearAllPackages(){
	    if (confirm("Are you sure you want to remove all built package from storage?")){
	         $.ajax("build_tool/pack.php?clear").done(function(data){
    	        console.log(data);
    	        if (data.includes("ERROR") == false){
    	            window.location.reload();
    	        }
    	    });
	    }
	   
	}
	
	function setPackageWritable(){
	    $.ajax("build_tool/pack.php?changePermission").done(function(data){
	        $("#pupdate").stop().finish().fadeIn('fast').delay(3000).fadeOut('fast');
	    });
	}
	
	function updateFileList(){
		$.get("build.php?loadFileList",function(data){
			if (data.length > 0){
				$("#packageList").html("");
				for (var i =0; i < data.length; i++){
					$("#packageList").append('<a  class="item" href="' + data[i][1] + '">' + data[i][0] + " (" +  data[i][2] + ")" + '</a>');
				}
			}else{
				//Nothing is left in the build folder
				$("#packageList").html('<div class="item">N/A</div>');
			}
			var today = new Date();
			var date = today.getDate() + "/" + (today.getMonth()+1) + "/" + today.getFullYear();
			var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
			var dateTime = time + " " + date;
			$("#lastupdateTime").text(dateTime);
		});
	}
	
	function updateCurrentVersionLabel(){
	    $.ajax({
              mimeType: 'text/plain; charset=x-user-defined',
              url:         "../info/version.inf",
              type:        "GET",
              dataType:    "text",
              cache:       false,
              success:     function(data){
    		    $("#versionTag").text(data);
    		    $("#nvn").val(data);
	            }
	    },'text');
	}
	updateCurrentVersionLabel();
	
	</script>
    </body>
</html>