<?php
include_once '../auth.php';

if (isset($_GET['ext']) == true && $_GET['ext'] != ""){
	//Create a certain file on top of the desktop
	if (isset($_GET['username']) == true && $_GET['username'] != ""){
		if (file_exists("files/" . $_GET['username'])){
			$files = glob("script/newItem/*");
			foreach ($files as $file){
				if (is_file($file)){
					$ext = pathinfo($file, PATHINFO_EXTENSION);
					if ($ext == $_GET['ext']){
						//Extension found! Copy this file to the user desktop.
						$targetFilename = "files/" . $_GET['username'] . "/newfile." . $ext;
						$count = 1;
						while (file_exists($targetFilename)){
							$targetFilename = "files/" . $_GET['username'] . "/newfile(" . $count . ")." . $ext;
							$count++;
						}
						copy($file, $targetFilename);
						die(basename($targetFilename));
					}
				}
			}
			die("ERROR. Specified file extension is not in the sample file folder.");
		}else{
			die("ERROR. Desktop for this username does not exists.");
		}
	}else{
		die("ERROR. Invalid or empty username parameter.");
	}
	
}else{
	$files = glob("script/newItem/*");
	$fileType = [];
	$iconList = file_get_contents("script/newItem/.icon.json");
	$iconList = json_decode($iconList);

	foreach ($files as $file){
		if (is_file($file)){
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			if (property_exists($iconList,$ext)){
				$icon = $iconList->$ext;
			}else{
				$icon =  "file outline";
			}
			array_push($fileType,[baseName($file,"." . $ext),$ext,$icon]);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($fileType);
}


?>