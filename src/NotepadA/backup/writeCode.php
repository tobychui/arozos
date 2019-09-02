<?php
include_once '../auth.php';
include_once 'checkCodePathValid.php';
if (isset($_POST['filename']) && isset($_POST['content'])){
	$filename = $_POST['filename'];
	$content = $_POST['content'];
	if (checkIfFilepathAllowed($filename)){
		file_put_contents($filename,$content);
	}else{
		die("ERROR. No permission to write to this file.");
	}
	echo "DONE";
	exit(0);
}else{
	die("ERROR. filepath or content undefined.");
	
}


?>