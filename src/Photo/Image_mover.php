<?php
include '../auth.php';
?>
<?php
//Image Processing System
if(!isset($_POST["dir"]) || !isset($_POST["files"])){
	die('FAILED');
}
$files = explode(",",$_POST['files']);
$target = $_POST['dir'];
$opr = $_POST['opr'];
foreach ($files as $file){
	if ($opr == 1 || $opr == 2){
	//No idea why php rename does the moving job =w=
		rename($file, str_replace(pathinfo($file)['dirname'],$target,$file));	
	}
	if ($opr == 3){
		unlink($file);
	}
}
echo 'DONE';
?>
