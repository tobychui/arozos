<?php
//Wifi Config display function with bash @ raspberry pi zero w
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR! This function is not supported on Windows System");
} else {
	$result = [];

	$filename = "/etc/wpa_supplicant/wpa_supplicant.conf";
	$handle = fopen($filename, "r");
	$unprased_data = fread($handle, filesize($filename));
	fclose($handle);
}
$prased_data = preg_split("/network={/", $unprased_data,-1,PREG_SPLIT_NO_EMPTY);




foreach ($prased_data as $data){
preg_match('/ssid=".*"/', $data,$split);
$split[0] = str_replace('ssid="',"",$split[0]);
$split[0] = str_replace('"',"",$split[0]);
array_push($result,$split);

}
array_shift($result);

header('Content-Type: application/json');
echo json_encode($result);
?>