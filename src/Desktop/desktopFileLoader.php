<?php
//This php loads all the desktop content from a given username
include_once('../auth.php');
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}
//header('Content-Type: text/html; charset=utf-8');
function getDecodeFileName($filename){
	if (strpos($filename,"inith") !== false){
		$ext = pathinfo($filename, PATHINFO_EXTENSION);
		$filenameOnly = str_replace("." . $ext,"",$filename);
		$hexname = substr($filenameOnly,5);
		if (ctype_xdigit($hexname) && strlen($hexname) % 2 == 0) {
			$originalName = hex2bin($hexname);
			return $originalName . "." . $ext;
		} else {
			//This is not an encoded filename but just so luckly that is start with inith
			return $filename;
		}
		
	}else if (ctype_xdigit($filename) && strlen($filename) % 2 == 0 && strlen($filename) > 2) {
		//This is a folder encriped in hex filename format
		return hex2bin($filename);
	}else{
		return $filename;
	}
}

function getLineContain($content,$keyword){
	$content = explode(PHP_EOL,$content);
	foreach ($content as $line){
		if (strpos($line,$keyword) !== false){
			$pos = explode(",",$line);
			return [$pos[1],$pos[2]];
		}
	}
	return "";
}


if (isset($_GET['username']) && $_GET['username'] != ""){
	$username = $_GET['username'];
	if (file_exists("files/" . $username)){
		$userDesktop = "files/" . $username . "/";
		$validfile = [];
		$decodeFileList = [];
		$DesktopPos = [];
		$files = glob($userDesktop . "*");
		if (file_exists("deskinf/".$username.".deskinf")){
			$filePositions = file_get_contents("deskinf/".$username.".deskinf");
		}else{
			$filePositions = "";
		}
		
		//For all items on the desktop
		foreach ($files as $file){
			$decodedFilename = "";
			if (is_file($file) || is_dir($file)){
				array_push($validfile,urlencode(basename($file)));
				$fileDesktopPosition = getLineContain($filePositions,basename($file).",");
				$decodedFilename = getDecodeFileName(basename($file));
				//The filename has to be encoded into base64 first before sending to the Desktop as some UTF issue is happening here
				array_push($decodeFileList,$decodedFilename);
				array_push($DesktopPos,$fileDesktopPosition);
			}
		}
		//print_r($decodeFileList);
		header('Content-Type: application/json');
		echo json_encode([$validfile,$decodeFileList,$DesktopPos]);
		//Updated with all information pass through one single PHP callback
		/**
		if (file_exists("../SystemAOB/functions/file_system/listAllFiles.php")){
			$path = "../SystemAOB/functions/file_system/listAllFiles.php?dir=<aor>/Desktop/files/$username&filter=";
			header("Location: $path");
		}else{
			echo 'ERROR. Required SystemAOB Function listAllFiles.php NOT FOUND';
		}
		**/
	
	}else{
		mkdir("files/" . $username, 0777);
	}

}else{
	echo 'ERROR. Undefined username variable';

}
?>