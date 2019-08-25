<?php
include_once("../../../auth.php");

if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    echo "N/A (Window Server)";
} else {
    $output = shell_exec("sudo vcgencmd get_throttled");
if (strpos($output,"throttled=0x500") == 0){
    $output = str_replace("throttled=0x500","",$output );
    $numeric = (int)$output;
    if ($numeric == 0){
        echo "Under-voltage";
    }else if ($numeric == 1){
        echo "ARM frequency capped";
    }else if ($numeric == 2){
        echo "Currently throttled";
    }else if ($numeric == 16){
        echo "Under-voltage has occurred";
    }else if ($numeric == 17){
        echo "ARM frequency capped has occurred";
    }else if ($numeric == 18){
        echo "Throttling has occurred";
    }else{
       echo "Operating Normally"; 
    }
}else{
    echo "Operating Normally";
}
/*
From Raspberry Pi Forum
0: under-voltage
1: arm frequency capped
2: currently throttled 
16: under-voltage has occurred
17: arm frequency capped has occurred
18: throttling has occurred

*/
}



?>