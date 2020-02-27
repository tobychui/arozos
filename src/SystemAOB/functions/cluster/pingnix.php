<?php
ini_set('max_execution_time', 5);
//var_dump($argv);
if (isset($argv[1])){
 $ip = $argv[1];
 $folder = "ping/";
 $filename = str_replace(".","_",$ip);
 $value = system("sudo ping " . $ip . " -c 1 >" . $folder . $filename . ".txt 2>&1 &");
 echo $value;
}else{
 die("ERROR. Undefined ip to ping.");
}

?>
