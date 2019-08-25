<?php
$smb = file_get_contents('/etc/samba/smb.conf');
$smb = preg_replace("/\[".$_GET["section"]."\].+?(?=\r?\n\[.*\]\r?\n|\n$)/s", "", $smb);
echo $smb;
$file = fopen("/etc/samba/smb.conf", "w") or die("Unable to open file!");
fwrite($file, $smb);


if(empty($_GET["section"])){
	preg_match("/path:([^;]*);/", $_GET["config"], $arr);
	$section = basename($arr[1]);
}else{
	$section = $_GET["section"];
}
if(isset($_GET["config"])){
	$str = explode(";",$_GET["config"]);
	array_pop($str);
	foreach($str as $value){
		$str_exploded = explode(":",$value);
		$tmp = $tmp.$str_exploded[0]." = ".$str_exploded[1]."\n";
	}
	echo "\n[".$section."]\n".$tmp;
	fwrite($file, "\n[".$section."]\n".$tmp);
}
fclose($file);
system("sudo service smbd restart");
?>