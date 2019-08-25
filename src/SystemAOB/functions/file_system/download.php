<?php
include '../../../auth.php';
?>
<?php

function isJson($string) {
 json_decode($string);
 return (json_last_error() == JSON_ERROR_NONE);
}

if (isset($_GET['file_request']) && $_GET['file_request'] != ""){
	$file = $_GET['file_request'];
	if (isset($_GET['filename']) && $_GET['filename'] != ""){
		if (isJson($_GET['filename'])){
			$filename = json_decode($_GET['filename']);
		}else{
			$filename = $_GET['filename'];
		}
	}else{
		$filename = basename($file);
	}
	
	//Check if the file is located inside of AOR or external storage.
	if (strpos(realpath($rootPath), realpath($file)) !== 0 && strpos(realpath("/media/"), realpath($file)) !== 0 ){
		die("ERROR. Required file not inside ArOZ Online Root nor External Storage Directory.");
	}
	
	
	
	if (file_exists($file)) {
		header('Content-Description: File Transfer');
		header('Content-Type: application/octet-stream');
		header('Content-Disposition: attachment; filename="'.$filename.'"');
		header('Expires: 0');
		header('Cache-Control: must-revalidate');
		header('Pragma: public');
		header('Content-Length: ' . filesize($file));
		readfile($file);
		exit;
	}
}


?>