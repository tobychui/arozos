<?php
include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//die('ERROR. Window not supported.');
	exec("getCPUinfo.exe",$out);
	sleep(1);
	$result = explode(",",$out[0]);
	header('Content-Type: application/json');
	echo json_encode($result);
}else{
    $temp = shell_exec('sudo cat /proc/cpuinfo');
	$temp = str_replace(":","=",$temp);
	$temp = str_replace("\t","",$temp);
	$temp = str_replace("\n",",",$temp);
	$host = explode(",",$temp);
	$result = [];
	foreach ($host as $data){
		if ($data != ""){
		$data = explode("=",$data);
		array_push($result,[$data[0],trim($data[1])]);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}

?>