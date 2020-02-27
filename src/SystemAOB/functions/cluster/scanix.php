<?php
$localIP = $_SERVER['SERVER_ADDR'];
$LANrange = explode(".",$localIP);
array_pop($LANrange);
$LANrange = implode(".",$LANrange);

for ($i =1; $i < 255; $i++){
    //echo $LANrange . "." . $i . '<br>';
    $output = shell_exec('sudo php pingnix.php ' . $LANrange . "." . $i);
}
die("DONE");
?>