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




//query to find shit result;
foreach ($prased_data as $data){
	if(strpos($data, $_GET["ssid"]) !== false){
		$tmp = "network={".$data;
	}
}

$unprased_data = str_replace($tmp,"",$unprased_data);
echo $unprased_data;

$fp = fopen('/etc/wpa_supplicant/wpa_supplicant.conf', 'w');
fwrite($fp, $unprased_data);
fclose($fp);
?>