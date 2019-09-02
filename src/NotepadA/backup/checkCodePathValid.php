<?php
include_once '../auth.php';
function checkIfFilepathAllowed($filepath){
	$allowedEditingDirectory = [realpath(__DIR__ . DIRECTORY_SEPARATOR . "../"),"/media/storage"]; //Default: AOR + /media/storage
	if (isset($filepath) != false && $filepath != ""){
		$realFilepath = realpath($filepath);
		$allowed = false;
		foreach ($allowedEditingDirectory as $dir){
			if (strpos($realFilepath,$dir) === 0){
				$allowed = true;
			}
		}
		return $allowed;
	}else{
		return false;
	}
}

//echo checkIfFilepathAllowed("/media/storage1/text.php")? "true" : "false";
?>