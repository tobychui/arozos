<?php
$driverRoot = "../SystemAOB/system/iotpipe/drivers/";
if (isset($_GET['driverClass']) && $_GET['driverClass'] != ""){
	$result = "img/system/unknown.png";
	$driverFound = file_exists($driverRoot . $_GET['driverClass']);
	if (file_exists($driverRoot . $_GET['driverClass'] ."/img/user.png")){
		$result = $driverRoot . $_GET['driverClass'] ."/img/user.png";
	}else if (file_exists($driverRoot . $_GET['driverClass'] ."/img/default.png")){
		$result = $driverRoot . $_GET['driverClass'] ."/img/default.png";
	}
	header('Content-Type: application/json');
	echo json_encode([$result,$driverFound]);
}

?>