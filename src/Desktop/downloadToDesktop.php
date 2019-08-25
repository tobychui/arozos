<?php
include '../auth.php';
if (isset($_GET['username']) && $_GET['username'] != ""){
	$username = $_GET['username'];
	if (isset($_POST['requesturl']) && $_POST['requesturl'] != ""){
		$url = json_decode($_POST['requesturl']);
		$userDesktop = "files/" . $username . "/";
		$filename = basename($url);
		$filename = urldecode($filename);
		$ext = pathinfo($filename, PATHINFO_EXTENSION);
		$filenameonly = str_replace(".$ext","",$filename);
		if (preg_match("/^[a-zA-Z0-9 ]*$/u", $filenameonly) == false || strlen($filenameonly) != strlen(utf8_decode($filenameonly))){
			//There is non alphbet and numeric char inside this string
			$encodedName = "inith" . bin2hex($filenameonly) . "." . $ext;
		}else{
			$encodedName = $filenameonly  . "." . $ext;
		}
		file_put_contents($userDesktop . $encodedName , fopen($url, 'r'));
		header('Content-Type: application/json');
		echo json_encode([$encodedName,$url]); 
	}else{
		die("ERROR. Undefined requesturl");
	}
}else{
	die("ERROR. Undefined username");
}
?>