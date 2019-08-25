<?php
include '../../../auth.php';
?>
<?php
if (isset($_GET['dir']) == false){
	die("ERROR, unknown dir variable.");
}
$dir = $_GET['dir'];
if ($dir != null || $dir != ""){
	if (ctype_xdigit($dir) && strlen($dir) % 2 == 0 && strlen($dir) > 2) {
		$result = hex2bin($dir);
		if ($result == ""){
		    //This is not a directory with hex codename even it can be decoded.
		    $result = $dir; 
		}
	} else {
		$result = $dir;
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}

?>