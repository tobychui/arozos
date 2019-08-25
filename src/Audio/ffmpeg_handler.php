<?php
include '../auth.php';
?>
<html>
<head>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
<script>
$( document ).ready(function() {
	//Comment the line below for debugging
    window.location.replace("index.php");
});
</script>
</head>
<body>
<br>
<div class="ts container">
<div class="ts segment">
<h1>DONE!</h1>
<div class="ts outlined message">
    <div class="header">Information</div>
    <p>If it cannot redirect itself, click <a href="index.php">HERE</a></p>
</div>
<?php
//ffmpeg handler. Have to be modified after deploying on linux environment.
	echo "Experimental Converter for mp4 to mp3 conversion.<br>";
	echo "If the conversion crashed, it might be you haven't correctly setup the FFmpeg or your PHP buffer is not enough.<br>";
	foreach (glob("uploads/*.mp4") as $filename) {
		$mp4filename = $filename;
		echo $mp4filename . "<br><br>";
		$mp3filename = str_replace(".mp4",".mp3",$mp4filename);
		echo shell_exec("ffmpeg -i ".$mp4filename." -b:a 320K ".$mp3filename." 2>&1");
		//Replace the above line with the line below for Raspberry pi with libav-tools 
		//echo shell_exec("avconv -i ".$mp4filename." -b:a 320K ".$mp3filename." 2>&1");
		unlink($mp4filename);
	}
	
	/*
	foreach (glob("uploads/*.aac") as $filename) {
		$aacfilename = $filename;
		echo $aacfilename . "<br><br>";
		$mp3filename = str_replace(".aac",".mp3",$aacfilename);
		echo shell_exec("ffmpeg -i ".$aacfilename." -b:a 320K ".$mp3filename." 2>&1");
		//Replace the above line with the line below for Raspberry pi with libav-tools 
		//echo shell_exec("avconv -i ".$aacfilename." -b:a 320K ".$mp3filename." 2>&1");
		unlink($aacfilename);
	}
	*/
	//header('Location: index.php');
	

?>
<br><br><br>
<div class="ts outlined message">
    <div class="header">Information</div>
    <p>If it cannot redirect itself, click <a href="index.php">HERE</a></p>
</div>
</div>
</div>
</body>
</html>