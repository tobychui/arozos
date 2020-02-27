<?php
include_once("../../../auth.php");
if (file_exists("out.txt")){
	$content = file_get_contents("out.txt");
	$content = trim($content);
	$content = explode("\n",$content);
	echo array_pop($content);
}

?>