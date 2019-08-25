<?php
include '../auth.php';
?>
<?php
//ffmpeg handler. Have to be modified after deploying on linux environment.
	$result = [];
	foreach (glob("uploads/*.aac") as $filename) {
		$aacfilename = $filename;
		$convertedFile = str_replace(".aac",".mp3",$aacfilename);
		array_push($result, $convertedFile);
		$mp3filename = str_replace(".aac",".mp3",$aacfilename);
		shell_exec("ffmpeg.exe -i ".$aacfilename." -b:a 128K ".$mp3filename);
		//Replace the above line with the line below for Raspberry pi with libav-tools 
		shell_exec("avconv -i ".$aacfilename." -b:a 128K ".$mp3filename." 2>&1");
		unlink($aacfilename);
		unlink(str_replace(".aac",".mp4",$aacfilename));
	}
	//print_r($result);
	echo "DONE";
?>