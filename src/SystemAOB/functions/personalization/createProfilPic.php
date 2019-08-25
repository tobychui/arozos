<?php
include_once("../../../auth.php");
$userIconPath = "usericon/";
if (isset($_GET['imagePath']) && $_GET['imagePath'] != ""){
	$imageLocation = "../../../" . $_GET['imagePath']; //Image path from AOR
	if (file_exists($imageLocation)){
		//source file exists. Copying it to the usericon directory
		$mime = mime_content_type($imageLocation);
		$data = explode(".",$imageLocation);
		$ext = array_pop($data); //This method is used instead pathinfo is that this support multi-lanuage filename
		if (strpos($mime,"image") !== false){
			//This is an image file
			$oldImg = glob($userIconPath . $_SESSION['login'] . ".*");
			foreach ($oldImg as $img){
				if (is_file($img)){
					unlink($img);
				}
			}
			sleep(1);
			copy($imageLocation,$userIconPath . $_SESSION['login'] . "." . $ext);
			echo "DONE";
			exit(0);
		}else{
			die("ERROR. This is not an image or the file format is not supported.");
		}
	}else{
		die("ERROR. Image source does not exists.");
	}
}else{
	die("ERROR. Undefined imagePath");
}

?>