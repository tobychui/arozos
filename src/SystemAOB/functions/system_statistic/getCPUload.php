<?php
include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//die('ERROR. Window not supported.');
	exec("getCPUload.exe",$out);
	echo $out[0];
}else{
	//ps -eo pcpu,pid,user,args | sort -k 1 -r | head -10
	exec("ps -eo pcpu,pid,user,args | sort -k 1 -r | head -10",$out);
	$counter = 0;
	foreach ($out as $result){
		if (strpos($result,"%CPU") === false){
			$dataChunk = explode(" ",trim($result));
			$counter += $dataChunk[0];
		}
		
	}
	if ($counter > 100){
		$counter = 100;
	}
	echo $counter . " %";
	
}

?>
