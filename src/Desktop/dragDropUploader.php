<?php
header("Content-Type: text/html; charset=UTF-8");
include '../auth.php';
if (isset($_GET['username']) && $_GET['username'] != ""){
	if (file_exists("files/" . $_GET['username']) == false){
		echo "ERROR. Desktop not exists.";
		exit(0);
	}
	$path = "files/" . $_GET['username'] . "/";
	$filename = $_FILES['file']['name'];
	if (isset($_GET['filename']) && $_GET['filename'] != ""){
		//This method is used to solve the system encoding problem on many non-utf8 systems
		//Filename must be uploaded with JavaScript base64 function given here
		//https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/Base64_encoding_and_decoding
		$filename = trim($_GET['filename']);
		$encodedData = str_replace(' ','+',$filename);
		$filename = base64_decode($encodedData);
	}
	$ext = pathinfo($filename, PATHINFO_EXTENSION);
	$filenameonly = str_replace(".$ext","",$filename);
	if (preg_match("/^[a-zA-Z0-9 ]*$/u", $filenameonly) == 1 || preg_match("/\p{Han}+/u", $filenameonly) || strpos($filenameonly,".")){
		//There is non alphbet and numeric char inside this string
		$encodedName = "inith" . bin2hex($filenameonly) . "." . $ext;
	}else{
		if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
			$encodedName = "inith" . bin2hex($filenameonly) . "." . $ext;
		}else{
			$encodedName = $filenameonly  . "." . $ext;
		}	
	}
	if (move_uploaded_file($_FILES['file']['tmp_name'], $path . $encodedName)){
		echo $encodedName;
	}else{
		echo 'ERROR. Problems when moving uploaded file from tmp to target directory.';
	}
	
}else{
	die("ERROR. Username not defined");
}

?>