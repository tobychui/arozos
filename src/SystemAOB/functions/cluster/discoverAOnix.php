<?php
//This script is designed to scan ArOZ Online System nearby this host under Linux System
//Change the settings below if your cluster deployment is not on the default path

//Cannot include auth as this should be called via terminal
include_once("clusterSettingLoader.php");
$prefix = $clusterSetting["prefix"];
$port = $clusterSetting["port"];
$logFile = "clusterList.config";
ini_set('max_execution_time', 5);
//var_dump($argv);
if (isset($argv[1])){
	//The value is a filepath
	$filepath = $argv[1];
	if (file_exists($filepath)){
		$ip = basename($filepath,".txt");
		$ip = str_replace("_",".",$ip);
		$file_headers = @get_headers("http://$ip:$port/$prefix/hb.php");
		if($file_headers && strpos($file_headers[0],"HTTP/1.1 200") !== false) {
			//Bingo
			print_r($file_headers);
			file_put_contents($logFile,$ip . PHP_EOL ,FILE_APPEND | LOCK_EX);
		}else{
			//Nope
		}
		unlink($filepath);
	}else{
		die("ERROR. File not found.");
	}
}else{
	die("ERROR. Undefined ip to ping.");
}
?>