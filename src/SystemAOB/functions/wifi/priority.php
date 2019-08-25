<!-- 
File : priority.php
Version : 1.3.0
Build Date : 2018/8/11
Author : Alanyeung


-->
<?php
include '../../../auth.php';
?>
<?php
$str = "";
	$file = fopen("priority.conf", "r");
	if($file != NULL){
		while (!feof($file)) {
			$str .= fgets($file);
		}
		fclose($file);
	}



$str = (int)$str +1;
echo $str;

$file = fopen("priority.conf","w");
fwrite($file,$str);
fclose($file);
