<?php
include_once("../auth.php");
$manulDevList = "../SystemAOB/system/iotpipe/devices/fixed/";
function gen_uuid() {
    return sprintf( '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        // 32 bits for "time_low"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ),

        // 16 bits for "time_mid"
        mt_rand( 0, 0xffff ),

        // 16 bits for "time_hi_and_version",
        // four most significant bits holds version number 4
        mt_rand( 0, 0x0fff ) | 0x4000,

        // 16 bits, 8 bits for "clk_seq_hi_res",
        // 8 bits for "clk_seq_low",
        // two most significant bits holds zero and one for variant DCE1.1
        mt_rand( 0, 0x3fff ) | 0x8000,

        // 48 bits for "node"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff )
    );
}
if (isset($_GET['ipaddr']) && isset($_GET['classType'])){
    $filename = gen_uuid();
    file_put_contents($manulDevList . $filename .  ".inf", $_GET['ipaddr'] . "," . $_GET['classType']);
    exit(0);
}
$devices = glob($manulDevList . "*.inf");
$data = [];
foreach ($devices as $dev){
    $info = explode(",",file_get_contents($dev));
    array_push($data,[basename($dev,".inf"),$info[0],$info[1]]);
}
header('Content-Type: application/json');
echo json_encode($data);
?>