<?php
include_once '../../auth.php';
//Xsendfile support for Apache streaming outside of the web root
//Use the default videoStreamer.php if your system do not support XsendFile mod for Apache


function restoreTransferShortcuts($filename){
	//This function is designed for File Explorer to create download with filename that contains ? & or |
	$filename = str_replace("{QM}","?",$filename);
	$filename = str_replace("{AS}","&",$filename);
	$filename = str_replace("{VB}","|",$filename);
	$filename = str_replace("{LA}","<",$filename);
	$filename = str_replace("{RA}",">",$filename);
	return $filename;
}

if (isset($_GET['filename'])){
    $path = $_GET['filename'];
    $ct = mime_content_type($path);
    header("X-Sendfile: $path");
    header("Content-Type: $ct");
	$downloadName = $path;
	if (isset($_GET['downloadname']) && $_GET['downloadname'] != ""){
		$downloadName = $_GET['downloadname'];
		$downloadName = restoreTransferShortcuts($downloadName);
	}
    header("Content-Disposition: attachment; filename=\"$downloadName\"");
    exit;
}

    

?>