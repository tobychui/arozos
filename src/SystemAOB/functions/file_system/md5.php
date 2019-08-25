<?php
include_once '../../../auth.php';
?>
<?php
//Get md5 of a file on server side

function isJson($string) {
 json_decode($string);
 return (json_last_error() == JSON_ERROR_NONE);
}


if (isset($_GET['file']) && $_GET['file'] != ""){
	$file = $_GET['file'];
	if (isJson($file)){
	    //This is a json encoded string. Decode it first
	    $file = json_decode($file);
	}
	if (file_exists($file)){
		if (is_dir($file)){
			header('Content-Type: application/json');
			echo json_encode("N/A");
		}else{
			header('Content-Type: application/json');
			echo json_encode(md5_file($file));
		}
		
	}else{
		die("ERROR, file not exists.");
	}
}else{
	die("ERROR, undefined file variable.");
}
?>