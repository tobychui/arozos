<?php
include '../auth.php';
?>
<?php
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-cache');
header('Access-Control-Request-Headers: *');
header('Access-Control-Allow-Headers: Content-Type');
$ds = DIRECTORY_SEPARATOR;
$dataarr = [];
//Set storefolder to uploads/username
if(isset($_POST['targetModule']) !== False){
	if (isset($_POST['extmode']) && $_POST['extmode'] != ""){
		//request upload to external storage devices
		$storeFolder = $_POST['extmode'] . "/" . $_POST['targetModule'] . "/";
		//
	}else{
		//Use default module folder instead
		$storeFolder = "../" . $_POST['targetModule'] . "/uploads/";
	}
}else{
	echo 'Unset target Module.';
	http_response_code(404);
	die();
}

if(isset($_POST['filetype']) !== False && $_POST['filetype'] != ""){
	$rawformat = strtolower($_POST['filetype']);
	$allowtype = explode(",",$rawformat);
	$ext = pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION);
	if (!in_array(strtolower($ext),$allowtype)){
		echo 'This format is not supported.';
		http_response_code(404);
		die();
	}
}


	if (!empty($_FILES)) {
		$tempFile = $_FILES['file']['tmp_name'];
		if (strpos($storeFolder,"/media/") === 0){
			//Upload to external USB devices
			if (file_exists($storeFolder) == false){
				mkdir($storeFolder,0777);
			}
			$targetPath = $storeFolder;
		}else{
			//Uplaod to internal storage path
			$targetPath = dirname( __FILE__ ) . $ds. $storeFolder . $ds;
		}
		$ext = pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION);
		//$ext = strtolower($ext)
		$filename = str_replace("." . $ext,"",$_FILES['file']['name']);
		$targetFile =  $targetPath. "inith" . bin2hex($filename).".".strtolower($ext);
		//$targetFile =  $targetPath. "testt";
		move_uploaded_file($tempFile,$targetFile);
		header('Location: ' . "../" .$_POST['targetModule']);
	}else{
		echo 'Unknown Error.';
		http_response_code(404);
		die();
	}
?>