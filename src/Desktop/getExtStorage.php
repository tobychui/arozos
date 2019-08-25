<?php
include '../auth.php';
$data = [];
$folders = glob("/media/storage*");
foreach ($folders as $folder){
	if (is_dir($folder)){
		$foldernameOnly = basename($folder);
		if(ctype_xdigit($foldernameOnly) && strlen($foldernameOnly) % 2 == 0) {
			$decodedName = hex2bin($foldernameOnly);
			$encodedFoldername = true;
		} else {
			$decodedName = $foldernameOnly;
			$encodedFoldername = false;
		}
		array_push($data,[basename($folder),$decodedName,$folder,$encodedFoldername]);
	}
}
header('Content-Type: application/json');
echo json_encode($data);

?>