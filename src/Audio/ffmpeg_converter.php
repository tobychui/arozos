<?php
include '../auth.php';
?>
<html>
<head>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<link rel="stylesheet" href="../script/css/font-awesome.min.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
</head>
<body style="background-color:white;">
   <div id="headerSection" class="ts borderless basic fluid menu">
        <a href="../index.php" class="item">ArOZβ</a>

        <div class="header stretched center aligned item">Music Bank</div>

        <a class="item">
             <i class="bed icon"></i>
        </a>
    </div>
	<div class="ts segment">
    <div class="ts active inverted dimmer">
        <div class="ts text loader">Processing Uploads</div>
    </div>
    <h3>Experimental FFmpeg based mp4 to mp3 converter</h3>
	Build v1.12 with FFmpeg build 12620a-win32-static OR ffmpeg.js if you run this on linux<br>
    <i class="caution circle icon"></i>WARNING! PLEASE BE PATIENT WHILE WAITING FOR THE CONVERSION<br>
    <i class="caution circle icon"></i>DO NOT CLOCSE THIS PAGE UNTIL THE PROCESS HAS BEEN FINISHED<br>
	<i class="coffee icon"></i>If you are using linux, you will see below a list of convert pending files.<br>
	White Blocks are files that is waiting to convert.<br>
	Blue Blocks and yello blocks are both converting files. But blue blocks means it is converting in local and yelow means converting on server side.<br>
	Lastly, Green Blocks means it has been converted and ready to stream!
	</div>
	<?php
	$isWindows = false;
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') { #Change this to !== "WIN" if you are debugging on window or want to use Linux Upload Mode
		//This is a window machine, use ffmpeg.exe to convert mp4 to mp3
		echo '<script>
			window.onload = function () { window.location.replace("ffmpeg_handler.php"); }
			</script>';
		$isWindows = true;
	}else{
		//This is a raspberry pi, use client devices to convert mp4 into aac first and fix the aac with server processing power
		//echo '<button onClick="nextFile();" class="ts button">Click here to start</button>';
		echo '<iframe id="convertWindow" src="" style="width:100%;height:50%;display:none;"></iframe>';
		echo '<div class="ts narrow container segment"><div class="ts segmented list"><div class="item selected">Convert Pending Files</div>';
		$convertTarget = [];
		$filenames = [];
		$count = 0;
		foreach (glob("uploads/*.mp4") as $filename) {
			array_push($convertTarget,$filename);
			array_push($filenames,basename($filename));
			$ext = pathinfo($filename, PATHINFO_EXTENSION);
			$realName = hex2bin(str_replace("inith","",basename($filename,"." . $ext))) . ".$ext";
			echo '<div class="item" id="file'.$count.'" style="width:100%;overflow-wrap: break-word;overflow-x:hidden;"><i id="icon'.$count.'" class="loading spinner icon"></i>&nbsp&nbsp&nbsp'.$realName.'</div>';
			$count++;
		}
		echo '</div></div>';
	}
	//FFMPEG JS sample command
	//input.mp4 need not to be changed as it is automaically mapped to the "filename" variable.
	// /ffmpegjs/?cmd=-i input.mp4 -vn -b:a 128K -strict -2 -y inithe381bbe38293e381a8e381afe381adefbca0e38199e3818ee38284e381bee38090e6ad8ce381a3e381a6e381bfe3819fe38091.aac&filename=../uploads/inithe381bbe38293e381a8e381afe381adefbca0e38199e3818ee38284e381bee38090e6ad8ce381a3e381a6e381bfe3819fe38091.mp4
	?>
	<script>
	var filesToBeConverted = <?php echo json_encode($convertTarget);?>;
	var fileNames = <?php echo json_encode($filenames);?>;
	var convertingID = 0;
	var VDI = !(!parent.isFunctionBar);
	var isWindows = <?php echo $isWindows ? "true" : "false";?>;
	$(document).ready(function(){
		if (isWindows == false){
			nextFile();
		}
		if (VDI){
			$('#headerSection').hide();
		}
	});
	
	function serverProcessing(){
		//Show that the file is being processed on the server side.
		$('#file' + (convertingID - 1)).css('background-color','#eaff96');
	}
	
	function nextFile(){
		//This was called within the iframe for converting the next item in array.
		if (filesToBeConverted.length > convertingID){
			$('#convertWindow').attr('src',"ffmpegjs.php?cmd=-i input.mp4 -vn -b:a 128K -strict -2 -y " + fileNames[convertingID].replace(".mp4",".aac") + "&filename=" + filesToBeConverted[convertingID]);
			$('#file' + (convertingID - 1)).css('background-color','#b2ffc8');
			$('#icon' + (convertingID - 1)).removeClass("loading spinner").addClass("checkmark");
			$('#file' + convertingID).css('background-color','#b2f8ff');
			convertingID ++;
		}else{
			//The conversion has been finished
			window.location.href = "index.php";
		}
	}
	
	</script>
</body>
</html>


