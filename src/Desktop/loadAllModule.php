<?php
//This php loads all the module that might be able to open files
include '../auth.php';
$folders = glob("../*");
$results = [];
foreach ($folders as $folder){
	if (is_dir($folder) && file_exists($folder . "/" . "index.php")){
		if (file_exists($folder . "/floatWindow.php")){
			$supportFloatWindow = true;
		}else{
			$supportFloatWindow = false;
		}
		if (file_exists($folder . "/embedded.php")){
			$supportEmbedded = true;
		}else{
			$supportEmbedded = false;
		}
		array_push($results,[$folder,$supportFloatWindow,$supportEmbedded]);
	}
}

header('Content-Type: application/json');
echo json_encode($results);

?>