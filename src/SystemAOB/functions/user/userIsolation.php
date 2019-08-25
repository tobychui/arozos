<?php
/*
ArOZ Online User Isolation Script for Secured Data Storage in System Configs
-------------------------------------------------------
This is a script that design to provide user isolations between the files of different users within the same ArOZ Online System.
To use this script, include this in the top part of your script that require user isolation.

In order to perform user isolation (in some scene, it cannot do much as users can always uplaod a php script to hack through the system)
But this provide a quick API for doing the isolation without the need to care about how it is done.
Please use with your own wish as you can do isolation yourself if you desired to do so.

THIS SCRIPT HAS TO BE USED WITH AUTH.PHP
*/
if (session_status() == PHP_SESSION_NONE) {
    //No auth has been done yet. Terminate the script
    exit("Invalid call to functional script.<br><br>ArOZ Online System - userIsolation.php");
}
$username = $_SESSION['login'];
$userConfigDirectory = "";
$systemConfigDirectory = "";
/*
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		$userConfigDirectory = "C:/AOB/users/" . $username . "/";
		$systemConfigDirectory = "C:/AOB/";
	}else{
		$userConfigDirectory = "/etc/AOB/users/" . $username . "/";
		$systemConfigDirectory = "/etc/AOB/";
}*/

$userConfigDirectory = $sysConfigDir . "users/" . $username . "/";
$systemConfigDirectory = $sysConfigDir;
if (!file_exists($userConfigDirectory)){
    mkdir($userConfigDirectory,0777,true);
}

function getUserDirectory(){
    global $userConfigDirectory;
    if ($userConfigDirectory != ""){
        return $userConfigDirectory;
    }else{
        return false;
    }
}

function getSystemDirectory(){
    global $systemConfigDirectory;
    if ($systemConfigDirectory != ""){
        return $systemConfigDirectory;
    }else{
        return false;
    }
}

//Please include the path as realpath instead of relative.
function checkPathInUserDirectory($path){
    global $userConfigDirectory;
    if (strpos($path,$userConfigDirectory) == 0){
        return true;
    }else{
        return false;
    }
}

?>