<?php
include_once("../auth.php");
$images = glob("uploads/*");
$result = [];
foreach ($images as $image){
	if (is_file($image)){
		array_push($result,$image);
	}
}
header('Content-Type: application/json');
echo json_encode($result);
?>