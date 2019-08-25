<?php
include '../auth.php';
$foundFiles = [];
function finddir($target) {
	global $foundFiles;
	if(is_dir($target)){
		$files = glob( $target . '*', GLOB_MARK );
			foreach( $files as $file ){
				finddir( $file );
			}
	}elseif(is_file($target)){
		$target = str_replace('\\', '/', $target);
		array_push($foundFiles,$target);
	}
}
	
if (isset($_GET['relativePath'])){
	if (is_dir($_GET['relativePath']) == false){
		die("ERROR. Path not found.");
	}
	finddir($_GET['relativePath']);
	header('Content-Type: application/json');
	echo json_encode($foundFiles);
}
?>