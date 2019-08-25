<?php
include '../../../auth.php';
?>
<?php
//New Folder
if (isset($_POST['folder']) && $_POST['folder'] != "" && isset($_POST['hex']) && $_POST['hex'] != "" && $_POST['foldername'] && $_POST['foldername'] != ""){
	$folder = $_POST['folder'];
	$foldername =  $_POST['foldername'];
	$hex = $_POST['hex'];
	if ($hex == "false"){
		//This folder need not to be bin2hex
		if (file_exists($folder . "/" . $foldername) && is_dir($folder . "/" . $foldername)){
			die("ERROR. Folder already exists.");
		}else{
			mkdir($folder . "/" . $foldername, 0777);
			echo 'DONE';
		}
	}else{
		if (file_exists($folder . "/" . bin2hex($foldername)) && is_dir($folder . "/" . bin2hex($foldername))){
			die("ERROR. Folder already exists.");
		}else{
			mkdir($folder . "/" . bin2hex($foldername), 0777);
			echo 'DONE';
		}
	}
	
}else{
	die("ERROR. Folder name / hex format not defined.");
	
}
?>