<?php
include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//die('ERROR. Window not supported.');
	exec("RAMUsage.exe",$out);
	echo $out[0];
}else{
	//ps -eo pcpu,pid,user,args | sort -k 1 -r | head -10
	exec("free -m | grep Mem:",$out);
	$counter = 0;
	$value = $out[0];
	$value = preg_replace('!\s+!', ' ', $value);
	$data = explode(" ",$value);
	echo $data[2] . " MB," . $data[1] . " MB," . ($data[2] / $data[1]);
	
}

?>
