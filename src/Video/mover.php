<?php
include '../auth.php';
?>
<?php
//Video Processing System
$storage = "playlist/";
$files = explode(",",$_POST['files']);
$target = $_POST['dir'];
$opr = $_POST['opr'];
foreach ($files as $file){
	if ($opr == 1 || $opr == 2){
	//No idea why php rename does the moving job =w=
		rename($file, str_replace('uploads',$storage .$target,$file));	
	}
	if ($opr == 3){
		unlink($file);
	}
}
echo 'DONE';
?>
