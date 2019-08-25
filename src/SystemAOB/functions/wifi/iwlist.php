<?php
include '../../../../auth.php';
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
    exec('sudo iwlist wlan0 scan |grep -e ESSID -e IEEE -e "Encryption key" -e "Quality" -e "Cell" -e "Authentication Suites (1) :"',$out);
foreach ($out as $line){
		$line = trim($line);
		$unprased_data .= $line;
	}
}

$prased_data = explode("Cell",$unprased_data);
array_shift($prased_data);
foreach ($prased_data as $data){
	// |Quality=|Signal level=|Encryption key:|ESSID:|IE: |Authentication Suites \(1\) : 
preg_match_all("/.+Address: ([0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+)/", $data, $tmp);
$split["Address"] = $tmp[1][0];

preg_match_all("/.+Quality=([0-9]+\/[0-9]+)/", $data, $tmp);
$split["Quality"] = $tmp[1][0];
if($split["Quality"] == null){
	$split["Quality"] = "0/70";
}


preg_match_all("/.+Signal level=-([0-9]+ dBm)/", $data, $tmp);
$split["Signal_Level"] = $tmp[1][0];
if($split["Encryption_Key"] == null){
	$split["Encryption_Key"] = "0 dBm";
}


preg_match_all("/.+Encryption key:(on|off)/", $data, $tmp);
$split["Encryption_Key"] = $tmp[1][0];
if($split["Encryption_Key"] == null){
	$split["Encryption_Key"] = "off";
}

preg_match_all('/.+ESSID:"(.+)"/', $data, $tmp);
if(strpos($tmp[1][0],"\\x00") !== false){
	$split["ESSID"] = "-Hidden Network-";
}else{
	$split["ESSID"] = $tmp[1][0];
}
if($split["ESSID"] == null){
	$split["ESSID"] = "-NO SSID-";
}


preg_match_all('/.+IE: (.+)/', $data, $tmp);
$split["Encrpytion_Method"] = explode("Authentication Suites (1) : ",$tmp[1][0])[0];
if($split["Encrpytion_Method"] == null){
	$split["Encrpytion_Method"] = "No Encryption";
}

$split["Encryption_Suites"] = explode("Authentication Suites (1) : ",$tmp[1][0])[1];
if($split["Encryption_Suites"] == null){
	$split["Encryption_Suites"] = "No Encryption";
}

array_push($result,$split);
	
}
header('Content-Type: application/json');
echo json_encode($result);

?>


