<?php
include '../auth.php';
$data = [];
$hidden = ["../script","../msb","../img"];
if (isset($_GET['path'])){
	$realPath = "../" . $_GET['path'];
	if (file_exists($realPath)){
		$folders = glob($realPath . "/*");
		foreach ($folders as $folder){
			$folder = str_replace("//","/",$folder);
			if (is_dir($folder) && in_array($folder,$hidden) == false){
				$foldernameOnly = basename($folder);
				if(ctype_xdigit($foldernameOnly) && strlen($foldernameOnly) % 2 == 0) {
					$decodedName = hex2bin($foldernameOnly);
					$encodedFoldername = true;
				} else {
					$decodedName = $foldernameOnly;
					$encodedFoldername = false;
				}
				array_push($data,[basename($folder),$decodedName,$folder,$encodedFoldername]);
				//array_push($data,$folder);
			}else if (isset($_GET['mode']) && $_GET['mode'] == "file" && is_file($folder)){
				array_push($data,[basename($folder),$folder]);
			}
		}
		header('Content-Type: application/json');
		echo json_encode($data);
	}else if (file_exists($_GET['path'])){
		//If the path is starting from the root of Linux
		$folders = glob($_GET['path'] . "/*");
		if (strpos($_GET['path'],"/media") !== false){
			//This is inside the paths of valid positions
			foreach ($folders as $folder){
				$folder = str_replace("//","/",$folder);
				if (is_dir($folder) && in_array($folder,$hidden) == false){
					$foldernameOnly = basename($folder);
					if(ctype_xdigit($foldernameOnly) && strlen($foldernameOnly) % 2 == 0) {
						$decodedName = hex2bin($foldernameOnly);
						$encodedFoldername = true;
					} else {
						$decodedName = $foldernameOnly;
						$encodedFoldername = false;
					}
					array_push($data,[basename($folder),$decodedName,$folder,$encodedFoldername]);
					//array_push($data,$folder);
				}else if (isset($_GET['mode']) && $_GET['mode'] == "file" && is_file($folder)){
					array_push($data,[basename($folder),$folder]);
				}
			}
			header('Content-Type: application/json');
			echo json_encode($data);
		}else{
			echo 'ERROR. Access to outside /media is rejected.';
			exit(0);
		}
		
		
	}else{
		echo 'ERROR. Directory not found.';
		exit(0);
	}
}else{
	echo 'ERROR. Undefined path.';
}



?>