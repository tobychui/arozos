<?php
include_once("../../../auth.php");
set_time_limit(5);
ini_set('max_execution_time', 5);
ini_set("default_socket_timeout", 5);
error_reporting(0);
ini_set('display_errors', 0);
ini_set("user_agent","Mozilla Firefox Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:53.0) Gecko/20100101 Firefox/53.0.");

//This script is used for requesting Information from nearby clusters. No error will be shown if there are any.

function chkOnline($file){
	$file_headers = get_headers($file, 1);
	if(strpos($file_headers[0], '404') !== false){
		return false;
	} else {
		return true;
	}
}

if (isset($_GET['ip']) && $_GET['ip'] != ""){
	$ip = "http://" . $_GET['ip'];
	$returnResult = [];
	if (chkOnline($ip . "/hb.php")){
		$context = stream_context_create(array('http' => array('header'=>'Connection: close\r\n')));
		$hb = file_get_contents($ip . "/hb.php",false,$context);
	}else{
		$hb = "N/A";
	}
	if (chkOnline($ip . "/SystemAOB/functions/info/version.inf")){
		$aov = file_get_contents($ip . "/SystemAOB/functions/info/version.inf");
	}else{
		$aov = "N/A";
	}
	if (chkOnline($ip . "/SystemAOB/functions/system_statistic/getDriveStat.php")){
		$context = stream_context_create(array('http' => array('header'=>'Connection: close\r\n')));
		$drivestat = file_get_contents($ip . "/SystemAOB/functions/system_statistic/getDriveStat.php",false,$context);
	}else{
		$drivestat = "N/A";
	}
	$returnResult = [$hb,$aov,$drivestat];
	header('Content-Type: application/json');
	echo json_encode($returnResult);
}else{
	die("ERROR. Unset ip parameter.");
}
?>