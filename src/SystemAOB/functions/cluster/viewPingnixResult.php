<?php
include_once("../../../auth.php");

$result = shell_exec('grep -H "Host Unreachable" ping/*.txt');
$result = explode("\n",$result);
foreach ($result as $ip){
    $filename = explode(":",$ip)[0];
    if (file_exists($filename)){
        unlink($filename);
    }
}
//Now, all the files that left inside the ping directory are those respones to ping

$files = glob("ping/*.txt");
foreach ($files as $file){
    echo str_replace("_",".",basename($file,".txt")) . '<br>';
}
?>



