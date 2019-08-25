<?php
include_once '../auth.php';
?>
<?php
if (isset($_GET['filename']) !== false && $_GET['filename'] != ""){
	$filename = $_GET['filename'];
	if (is_file($filename) && file_exists('functions/' . basename($filename))){
		$content = file_get_contents($filename);
		header('Content-Type:text/plain');
		echo $content;
	}else{
		echo 'ERROR - NOT STAND ALONE FUNCTION SCRIPT';
	}
}else{
	echo 'ERROR - NO RAW FILE AVAILABLE';
}

?>