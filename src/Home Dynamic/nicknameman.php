<?php
include_once("../auth.php");
if (isset($_GET['nickname']) && isset($_GET['uuid'])){
    //Set nickname
    $uuid = str_replace("/","",str_replace("../","",strip_tags($_GET['uuid'])));
    $nickname = strip_tags($_GET['nickname']);
    file_put_contents("../SystemAOB/system/iotpipe/name/" . $uuid . ".inf",$nickname);
    echo "DONE";
} else if (isset($_GET['uuid'])){
    //Get the nickname of this device given device uuid
    $uuid = strip_tags($_GET['uuid']);
    $nickname = false;
    if (file_exists("../SystemAOB/system/iotpipe/name/" . $uuid . ".inf")){
        $nickname = trim(file_get_contents("../SystemAOB/system/iotpipe/name/" . $uuid . ".inf"));
    }
    header('Content-Type: application/json');
    echo json_encode($nickname);
    
}
?>