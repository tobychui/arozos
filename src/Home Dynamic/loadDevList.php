<?php
include_once("../auth.php");
//Load all the ip address of the current online devices and return as json
$loadDir = ["../SystemAOB/system/iotpipe/devices/auto/"];
$devices = [];
foreach ($loadDir as $dir){
    $devs = glob($dir . "*.inf");
    $devices = array_merge($devices,$devs);
}
$ips = [];
foreach ($devices as $device){
    $info = explode(",",file_get_contents($device));
    //Only push the ipaddress into the return array
    array_push($ips,$info[0]);
}

header('Content-Type: application/json');
echo json_encode($ips);

?>