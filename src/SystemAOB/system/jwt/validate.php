<?php
/*
ArOZ Online JSON Web Token Validation Script
WARNING! This script is designed to be used with AROZ Online System and it is critical for the security of the system
DO NOT CHANGE ANYLINE / COPY AND PASTE ANYTHING FROM THE INETERNET TO THIS SCRIPT IF YOU DO NOT KNOW WHAT YOU ARE DOING.
*/

//Try to extract the system config directory without auth.php
$sysConfigDir = "/etc/AOB/";
if (filesize("../../../root.inf") != 0){
	$sysConfigDir = file_get_contents("../../../root.inf");
}else{
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		$sysConfigDir = "C:/AOB/";
	}else{
		$sysConfigDir = "/etc/AOB/";
	}
}

	
$token = null;
//Check if the token is valid
if (isset($_GET['token'])) {$token = $_GET['token'];}
$keyFileLocation = $sysConfigDir . "serverkey/deviceKey.akey";
if (!file_exists($keyFileLocation)){
	$returnArray = array('error' => 'This device do not have a server key. To validate a self generated token, you must call create.php once.');
}

if (!is_null($token)) {

	require_once('jwt.php');

	// Get our server-side secret key from a secure location.
	$serverKey = trim(file_get_contents($keyFileLocation));
	
	try {
		$payload = JWT::decode($token, $serverKey, array('HS256'));
		$returnArray = array('username' => $payload->user, 'signDevice' => $payload->sgd , 'createdTime' => $payload->crd);
		if (isset($payload->exp)) {
			$returnArray['expTime'] = $payload->exp;
		}else{
			$returnArray['expTime'] = -1;
		}
	}
	catch(Exception $e) {
		$returnArray = array('error' => $e->getMessage());
	}
	$hashedToken = hash('sha512',$_GET['token']);
	if (file_exists("tokenDB/" . $hashedToken . ".atok")){
		$returnArray['discarded'] = false;
	}else{
		$returnArray['discarded'] = true;
	}
} 
else {
	$returnArray = array('error' => 'Token not given.');
}

// return to caller
$jsonEncodedReturnArray = json_encode($returnArray, JSON_PRETTY_PRINT);
header('Content-Type: application/json');
echo $jsonEncodedReturnArray;
?>