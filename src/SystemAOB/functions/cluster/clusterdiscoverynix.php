<?php
$localIP = $_SERVER['SERVER_ADDR'];
$LANrange = explode(".",$localIP);
array_pop($LANrange);
$LANrange = implode(".",$LANrange);
$ipFiles = glob("ping/*.txt");
if (file_exists("clusterList.config")){
	unlink("clusterList.config");
}
foreach ($ipFiles as $target){
    //echo $LANrange . "." . $i . '<br>';
    shell_exec('sudo php discoverAOnix.php ' . $target . "> /dev/null 2>/dev/null &");
	
}
die("DONE");
?>