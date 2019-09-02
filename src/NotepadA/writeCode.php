<?php
include_once '../auth.php';
include_once 'checkCodePathValid.php';
if (isset($_POST['filename']) && isset($_POST['content'])){
	$filename = $_POST['filename'];
	$content = $_POST['content'];
	if (!file_exists($filename)){
	    //Create a tmp file for realpath check
	    file_put_contents($filename,"");
	}
	if (checkIfFilepathAllowed($filename)){
		file_put_contents($filename,$content);
	}else{
	    //If you do not get the permission to write to this file, remove the tmp folder for realpath check
	    if (file_exists($filename)){
	        unlink($filename);
	    }
		die("ERROR. No permission to write to this file. " . $filename . " was given.");
	}
	echo "DONE";
	exit(0);
}else{
	die("ERROR. filepath or content undefined.");
	
}


?>