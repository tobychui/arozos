<?php
include '../auth.php';
?>
<?php
//New Folder Creation PHP
$foldername = $_POST['name'];
$storage = "storage/";

if (file_exists($storage . $foldername . "/") == false){
	mkdir($storage . $foldername . "/");
	echo 'DONE';
}
?>