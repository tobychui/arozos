<?php
include_once("../auth.php");
function mv($val){
    if (isset($_GET[$val]) && $_GET[$val] != ""){
        return $_GET[$val];
    }else{
        return "";
    }
}
$logDir = "log/";
if (mv("displayText") != ""){
    $displayText = json_decode(mv("displayText"));
    if (mv("cmd") != ""){
        $cmd = json_decode(mv("cmd"));
        if (mv("logCode") != ""){
            $logCode = mv("logCode");
            //Build the inf file from the given information
            file_put_contents($logDir . $logCode . ".inf",$displayText . "," . $cmd);
            die("DONE");
        }else{
            die("ERROR. Undefined logCode.");
        }
    }else{
        die("ERROR. Undefined cmd.");
    }
}else{
    die("ERROR. Undefined displayText value.");
}
?>