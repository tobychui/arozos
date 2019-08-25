<?php
include '../auth.php';
?>
<?php
include_once("Parsedown.php");

if (isset($_GET['filename']) && $_GET['filename'] != ""){
	$filename = hex2bin($_GET['filename']);
	if (file_exists($filename)){
			$content = file_get_contents($filename);
			$Parsedown = new Parsedown();
			echo $Parsedown->text($content);
	}else{
		die("ERROR. filename not exists.");
	}
}else{
	die("ERROR. filename is not defined.");
}

?>