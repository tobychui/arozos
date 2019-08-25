<?php
include '../../../auth.php';
//Wifi Config display function with bash @ raspberry pi zero w
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR! This function is not supported on Windows System");
} else {
	$result = [];

	$filename = "/etc/hostapd/hostapd.conf";
	$handle = fopen($filename, "r");
	$unprased_data = fread($handle, filesize($filename));
	fclose($handle);
}

$prased_data = preg_split("/interface=|ssid=|hw_mode=|channel=|wmm_enabled=|macaddr_acl=|auth_algs=|ignore_broadcast_ssid=|wpa=|wpa_passphrase=|wpa_key_mgmt=|wpa_pairwise=|rsn_pairwise=/", $unprased_data,-1,PREG_SPLIT_NO_EMPTY);

header('Content-Type: application/json');
echo json_encode($prased_data);

?>