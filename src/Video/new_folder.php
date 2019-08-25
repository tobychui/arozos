<?php
include '../auth.php';
?>
<?php
//New Folder Creation PHP
$foldername = $_POST['name'];
$storage = "playlist/";

if (file_exists($storage . $foldername . "/") == false){
	mkdir($storage . bin2hex($foldername) . "/");
	echo 'DONE';
}
?>