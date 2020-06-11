<?php
include_once("../auth.php");

$logDir = "log/";
$logs = glob($logDir . "*.log");
$results = [];
foreach ($logs as $log){
    $detailFile = $logDir . basename($log,".log") . ".inf";
    $filename = "Unknown";
    $cmd = "no-data";
    if (file_exists($detailFile)){
        $details = file_get_contents($detailFile);
        $details = explode(",",trim($details));
		$cmd = array_pop($details);
        $filename = implode(",",$details);
    }
    $content = file_get_contents($log);
	$tmp = explode("\n",trim($content));
    $data = array_pop($tmp);
    array_push($results,[basename($log,".log"),$log,$filename,$cmd,$data]);
}
header('Content-Type: application/json');
echo json_encode($results);
?>