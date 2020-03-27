<?php
include '../auth.php';
?>
<?php
//New Folder Creation PHP
$foldername = $_POST['name'];
$storage = $_POST['storage'];

//declare the PHP_VERSION_ID
if (!defined('PHP_VERSION_ID')) {
   $version = explode('.', PHP_VERSION);
   define('PHP_VERSION_ID', ($version[0] * 10000 + $version[1] * 100 + $version[2]));
}
		
//check if PHP was higher than 7.4, if true then not using inith filename
if(PHP_VERSION_ID >= 70404){
    if (file_exists($storage . $foldername . "/") == false){
		mkdir($storage . $foldername . "/", 0777);
		echo 'DONE';
	}
}else{
	if (file_exists($storage . $foldername . "/") == false){
		mkdir($storage . bin2hex($foldername) . "/", 0777);
		echo 'DONE';
	}
}
?>