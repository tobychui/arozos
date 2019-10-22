<?php
header('Content-Type: application/json');
include_once("../../../auth.php");
if (!file_exists("endpoints.conf")){
	die("ERROR. endpoint.conf not found.");
}
$endpoints = json_decode(file_get_contents("endpoints.conf"),true);
$endpoints = $endpoints["arozsync"];
$targetEndPointName = "offical";
if (!isset($_GET['syncgroup']) || empty($_GET['syncgroup'])){
	die("ERROR. Undefined syncgroup id");
}
$syncgroup = $_GET['syncgroup'];
if (isset($_GET['epname'])){
	$targetEndPointName = $_GET['epname'];
}
foreach ($endpoints as $ep){
	if ($ep["name"] == $targetEndPointName){
		$epTarget = $ep["endpoint"];
	}
}

//Generate unique ID for this host + this user
$uuid = "";
if (file_exists($sysConfigDir . "device_identity.config")){
    $uuid = file_get_contents($sysConfigDir . "device_identity.config");
}else{
	die("ERROR. Device Identify ID not found. Please initiate your system ID before using sync.");
}

$username = $_SESSION['login'];
$uniqueID =  $uuid . $username;
$uniqueID = hash('sha512', $uniqueID);

//Send request to the endpoint for state checking
$output = file_get_contents($epTarget . "getlist.php?useruid=" . $uniqueID . "&syncgp=" . $syncgroup);
echo $output;
?>