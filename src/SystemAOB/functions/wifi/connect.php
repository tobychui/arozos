<?php
include '../../../auth.php';
?>

<?php
$priority = 1;

$data = file_get_contents('../priority.conf'); 

$priority = (int)$data + 1;


$wpa = fopen("/etc/wpa_supplicant/wpa_supplicant.conf", "a") or die("Error");

if($_GET["method"] == "PSK"){
$tmp = 'network={
	ssid="'.$_GET["ssid"].'"
	psk="'.$_GET["pwd"].'"
	priority='. $priority .'
}
';
}else if($_GET["method"] == "no"){
	$tmp = 'network={
	ssid="'.$_GET["ssid"].'"
	priority='. $priority .'
}
';
}else if($_GET["method"] == "802.1x"){
	$tmp = '
network={
	disabled=0
	auth_alg=OPEN
	ssid="'.$_GET["ssid"].'"
	scan_ssid=1
	key_mgmt=WPA-EAP
	proto=WPA RSN
	pairwise=CCMP TKIP
	eap=PEAP
	identity="'.$_GET["usr"].'"
	anonymous_identity="'.$_GET["usr"].'"
	password="'.$_GET["pwd"].'"
	phase1="peaplabel=0"
	phase2="auth=MSCHAPV2"
	priority='. $priority .'
}
';
};
fwrite($wpa, $tmp);
fclose($wpa);
//header('Location: wrestart.php');
?>