<?php
include_once("../auth.php");
$driverRoot = "../SystemAOB/system/iotpipe/drivers/";
if (isset($_GET['classType']) && $_GET['classType'] != ""){
	$classtype = $_GET['classType'];
	if (file_exists($driverRoot . $classtype . "/classname.inf")){
		echo file_get_contents($driverRoot . $classtype . "/classname.inf");
	}else{
		if (file_exists($driverRoot . $classtype . "/")){
			echo "Unknown Device";
		}else{
			echo "Driver Not Found";
		}
		
	}
}
?>