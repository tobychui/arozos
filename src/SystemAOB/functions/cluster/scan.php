<?php
include_once("../../../auth.php");
//Scanner for finding Host's nearby ArOZ Online System
//SCANNER FOR HOST LOCAL AREA NETWORK, NOT CLIENT'S

if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    //Window Hosts
	$commandString = "start /B /low clusterdiscovery.exe >out.txt"; 
	pclose(popen($commandString, 'r'));
	echo "DONE";
} else {
    //Linux Hosts
	header("Location: scanix.php");
}





?>