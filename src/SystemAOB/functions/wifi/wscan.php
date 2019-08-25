<?php
include '../../../auth.php';
?>
<?php
/*
//Wifi scanning function with bash @ raspberry pi zero w
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR! This function is not supported on Windows System");
} else {
	$result = [];
    exec("sudo iwlist wlan0 scan |grep ESSID",$out);
	foreach ($out as $line){
		$line = trim($line);
		$data = explode(':"',$line);
		$ssid = str_replace('"','',$data[1]);
		if (strpos($ssid,"\\x00") !== false){
			//Hidden network or not correctly setup wifi network
			array_push($result,"- Hidden Network -");
		}else if($ssid != ""){
			array_push($result,$ssid);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}

*/

?>
<?php
//Wifi scanning function with bash @ raspberry pi zero w
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR! This function is not supported on Windows System");
} else {
	$result = [];
    exec('sudo iwlist wlan0 scan |grep -e ESSID -e IEEE -e "Encryption key" -e "Quality" -e "Cell"',$out);
foreach ($out as $line){
		$line = trim($line);
		$unprased_data .= $line;
	}
}

$prased_data = explode("Cell",$unprased_data);
array_shift($prased_data);
foreach ($prased_data as $data){
$split = preg_split("/Address: |Quality=|Signal level=|Encryption key:|ESSID:|IE: /", $data);
$split[5] = str_replace('"','',$split[5]);
if (strpos($split[5],"\\x00") !== false){
	$split[5] = "- Hidden Network -";
}
array_push($result,$split);
	
}
header('Content-Type: application/json');
echo json_encode($result);
?>

