<?php
include '../../../auth.php';
//Wifi Config display function with bash @ raspberry pi zero w
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR! This function is not supported on Windows System");
} else {
	exec("sudo systemctl stop hostapd");
	$result = [];
	$filename = "/etc/hostapd/hostapd.conf";
	exec("sudo chmod 777 $filename");
	$handle = fopen($filename, "r");
	$unprased_data = fread($handle, filesize($filename));
	fclose($handle);
}

$prased_data = preg_split("/interface=|ssid=|hw_mode=|channel=|wmm_enabled=|macaddr_acl=|auth_algs=|ignore_broadcast_ssid=|wpa=|wpa_passphrase=|wpa_key_mgmt=|wpa_pairwise=|rsn_pairwise=/", $unprased_data,-1,PREG_SPLIT_NO_EMPTY);

$unprased_data = str_replace("ssid=".$prased_data[1],"ssid=".$_GET["ssid"]."\n",$unprased_data);
$unprased_data = str_replace("wpa_passphrase=".$prased_data[9],"wpa_passphrase=".$_GET["pw"]."\n",$unprased_data);

$fp = fopen('/etc/hostapd/hostapd.conf', 'w');
fwrite($fp, $unprased_data);
fclose($fp);

exec("sudo systemctl start hostapd");
?>