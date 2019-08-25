<?php
include '../../../auth.php';
?>
<?php
$result=[];
if(exec('iw dev wlan0 link') !== 'Not connected.'){
	
$ssid = exec("iwgetid -r");
array_push($result,$ssid);
$c = exec("iwgetid -c");
array_push($result,$c);
$f = exec("iwgetid -f");
array_push($result,$f);
}else{
	array_push($result,"No Wi-Fi network ");
	array_push($result,"");
	array_push($result,"");
}

header('Content-Type: application/json');
echo json_encode($result);
?>
