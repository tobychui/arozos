<?php
/*
ArOZ Online System User File Access Scope Checking Script
-----------------------------------------------------------------------
This script is designed to check any given path from AOR if it is correctly located
inside the given file system scope. (By default, AOR/* and /media (Linux only))

*/
include_once(__DIR__ . "/../personalization/configIO.php");
if (session_status() == PHP_SESSION_NONE) {
    //No auth has been done yet. Terminate the script
    exit("Invalid call to functional script.<br><br>ArOZ Online System - userIsolation.php");
}
//Get a list of valid scope for this user
function getAllFileScope(){
	global $sysConfigDir;
	$username = $_SESSION['login'];
	$paths = [];
	//Load the basic two system paths
	$root = str_replace("\\","/",realpath(__DIR__ . "/../../../")) . "/";
	array_push($paths,$root);
	$userConfig =  str_replace("\\","/",realpath($sysConfigDir . "users/" . $username)) . "/";
	//Load the extra paths allowed in the fsaccess config
	if (getConfig("fsaccess",true) !== false){
		$fsaccess = getConfig("fsaccess",true);
		$otherPaths = explode(";",$fsaccess["syspaths"][3]);
		foreach ($otherPaths as $opath){
			if (file_exists($opath)){
				array_push($paths,$opath);
			}
		}
	}
	return $paths;
}
//Check if a given file is inside the valid access scope of this user
function checkFilepathInScope($filepath){
	$scopes = getAllFileScope();
	$filepath = realpath($filepath);
	$filepath = str_replace("\\","/",$filepath);
	$valid = false;
	foreach ($scopes as $scope){
		if (strpos($filepath,$scope) !== false){
			
			$valid = true;
		}
	}
	return $valid;
}


?>