<?php
$osname = shell_exec("lsb_release -a | grep Distributor");
$osname = trim(array_pop(explode(":",$osname)));
if (strpos($osname,"Ubuntu") !== false){
	//Ubuntu
	$result = shell_exec('sudo apt-get install ffmpeg -y');
}else{
	//Debian 
	$result = shell_exec('sudo apt-get install libav-tools -y');
}

echo '<pre>' . $result . '</pre>';
?>
<br>
<a href="index.php">Back</a>