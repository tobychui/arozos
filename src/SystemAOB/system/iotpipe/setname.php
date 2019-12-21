<?php
include_once("../../../auth.php");
if (isset($_GET['name']) && isset($_GET['uuid'])){
    $devname = $_GET['name'];
    $devUUID = $_GET['uuid'];
    if (file_exists("devices/auto/" . $devUUID . ".inf") || file_exists("devices/fixed/" . $devUUID . ".inf")){
        //This uuid exists in the current scanning results
        file_put_contents("name/" . $devUUID . ".inf",strip_tags($devname));
        echo ("DONE");
    }else{
        //This devices not exists.
        die("ERROR. This uuid do not exists in the current scanned device list.");
    }
}else{
    die("ERROR. Unset name or uuid");
}
?>