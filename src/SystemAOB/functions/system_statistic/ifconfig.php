<?php
include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//die('ERROR. Window not supported.');
	exec("WIN32_ipconfig.exe",$out);
	sleep(1);
	$Networklist = fopen("WIN32_NetworkInterface.txt", "r") or die($out);
	$result = explode("\r\n",str_replace(",,",",N/A,",substr(fread($Networklist,filesize("WIN32_NetworkInterface.txt")),3)));
	fclose($Networklist);
	header('Content-Type: application/json');
	echo json_encode($result);
}else{
	$result = [];
	exec('ifconfig |grep "inet \|lo:\|wlan"',$output);
	foreach($output as $outline){
		array_push($result,$outline);
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}

?>