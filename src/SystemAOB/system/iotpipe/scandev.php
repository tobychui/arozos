<?php
/*
Scan IoT devices in range. Using default settings.
*/
include_once("../../../auth.php");
include_once("../binsel.php");
binarySelectExecution("iotpipe","",false);
$devices = glob("devices/auto/*.inf");
echo "DONE";

?>