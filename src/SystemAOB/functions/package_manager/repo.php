<?php
if($_GET["method"] == "add" && !empty($_GET["url"])){
		$f = fopen("source.csv", "a") or die('{"status_code":500,"status_description":"source.csv write error"}');
		fwrite($f, $_GET["url"]."\r\n");
		fclose($f);
}else if($_GET["method"] == "remove" && !empty($_GET["url"])){
	$dda = "";
	$file = fopen("source.csv","r");
	while(!feof($file)){
		$tmp = fgets($file);
		$dda = $dda.$tmp;
	}
	fclose($file);
	$dda = str_replace($_GET["url"]."\r\n","",$dda);
	$f = fopen("source.csv", "w") or die('{"status_code":500,"status_description":"source.csv write error"}');
	fwrite($f, $dda);
	fclose($f);
	echo "OK";
}else{
	die('{"status_code":500,"status_description":"argurment error"}');
}