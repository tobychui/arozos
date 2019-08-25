<?php
include '../../../auth.php';
?>
<?php
//Wifi restart using wpa_cli @ raspberry pi zero w
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR! This function is not supported on Windows System");
} else {
	$result = [];
    exec("sudo wpa_cli reconfigure");
	die("DONE");
}



?>