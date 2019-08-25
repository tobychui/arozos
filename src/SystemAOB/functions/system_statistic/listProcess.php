<?php
include '../../../auth.php';
if (isset($_GET['mode']) && $_GET['mode'] == "json"){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		echo 'ERROR. Not supported OS';
	} else {
		$returnval = shell_exec("top -bn1");
		$data = (explode("\n",$returnval));
		header('Content-Type: application/json');
		echo json_encode($data);
	}	
}else{
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		echo 'ERROR. Not supported OS';
	} else {
		$returnval = shell_exec("top -bn1");
		echo '<pre>' . $returnval  . '</pre>';
	}	
	
}

?>