<?php
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

include_once("../../../auth.php");
if (isset($_POST['devIP']) && isset($_POST["driver"])){
    if (!file_exists("devices/fixed/")){
        mkdir("devices/fixed/",0777,true);
    }
    $devIP = $_POST['devIP'];
    $driver = $_POST["driver"];
    if (empty($devIP) || empty($driver)){
        die("ERROR. devIP or driver is empty.");
    }
    //Generate an UUID for the new record
    $uuid = gen_uuid();
    file_put_contents("devices/fixed/" . $uuid . ".inf",$devIP . "," . $driver);
}else{
    die("ERROR. Missing paramter devIP or driver.");
}
?>