<?php
include '../auth.php';
?>
<?php
/*
In 2019/8/18 21:36PDT, opr == 2 has been deprecated and reduced to 2 opr only
keeping opr == 2 only for unexpected
1 = move
3 = delete
*/
//Video Processing System
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
