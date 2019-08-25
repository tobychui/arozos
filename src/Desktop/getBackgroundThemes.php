<?php
include '../auth.php';
$data = [];
if (file_exists("img/bg")){
	$themes = glob("img/bg/*");
	foreach ($themes as $theme){
		if (is_dir($theme) && (file_exists($theme . "/0.jpg") || file_exists($theme . "/0.gif"))){
			//If it is a directory as well as it has image in it
			$images = glob($theme . "/*.{jpg,gif}", GLOB_BRACE);
			$bgcount = count($images);
			array_push($data,[basename($theme),$theme,$bgcount]);
		}
	}
}else{
	echo 'ERROR. Background directory not found.';
	exit(0);
}
header('Content-Type: application/json');
echo json_encode($data);

?>