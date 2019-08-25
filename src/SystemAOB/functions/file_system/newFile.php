<?php
include_once("../../../auth.php");

if (isset($_GET['create']) && $_GET['create'] != "" && isset($_GET['path']) && $_GET['path'] != ""){
	//Given create (extension) and path (filepath) parameter, create a new file with the given source file
	$creationPath = $_GET['path'] . "/";
	$ext = $_GET['create'];
	if (file_exists($_GET['path'])){
		if (isset($_POST['filename'])){
			//Custom defined filename creation.
			if (isset($_POST['filename']) && $_POST['filename'] != ""){
					//Predefined Filename
					$filename = json_decode($_POST['filename']);
					if (file_exists($creationPath . $filename)){
						die("ERROR. File with filename " . $filename . " already exists.");
					}else{
						file_put_contents($creationPath . $filename,"");
						echo "DONE";
					}
			}else{
				die("ERROR. Filename cannot be empty.");
			}
		}else{
			$files = glob("newitem/*." . $ext);
			$filename = "new file." . $ext;
			$counter = 1;
			while(file_exists($creationPath . $filename)){
				$filename = "new file (" . $counter . ")." . $ext;
				$counter++;
			}
			if (count($files) == 0 ){
				//This file type is not inside the template.
				file_put_contents($creationPath . $filename,"");
			}else{
				//Load template information into the content of the new file
				$content = file_get_contents($files[0]);
				file_put_contents($creationPath . $filename,$content);
			}
		}
		echo "DONE";
	}else{
		die("ERROR. Given path not exists.");
	}
	
}else{
	//List all the allowed types of file
	if (!file_exists("newitem/")){
		mkdir("newitem/",0777);
		file_put_contents(".icon.json","[]");
	}
	$templates = glob("newitem/*");
	$iconTypes = json_decode(file_get_contents("newitem/.icon.json"),true);
	$result = [];
	foreach ($templates as $template){
		if (is_file($template)){
			$filename = basename($template);
			$ext = pathinfo($template, PATHINFO_EXTENSION);
			if ($filename != ".icon.json"){
				//This is a template file.
				$fileDescription = basename($template,"." . $ext);
				$fileIcon = "file outline";
				if (array_key_exists($ext,$iconTypes)){
					$fileIcon = $iconTypes[$ext];
				}
				array_push($result,[$fileDescription,$ext,$fileIcon]);
			}
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
	
}
?>