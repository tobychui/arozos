<?php
include_once("../auth.php");

if (isset($_GET['logCode']) && $_GET['logCode'] != ""){
    $logCode = $_GET['logCode'];
    $logDir = "log/";
    $logFile = $logDir . $logCode . ".log";
    $infFile = $logDir . $logCode . ".inf";
    if (file_exists($logFile)){
        unlink($logFile);
    }
    if (file_exists($infFile)){
        unlink($infFile);
    }
    echo "DONE";
}
?>