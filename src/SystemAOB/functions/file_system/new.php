<?php
include '../../../auth.php';
?>
<?php
//Require variable: filename, content
function mv($var){
	if (isset($_GET[$var]) !== false && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return null;
	}
}

$filename = mv("filename");
$content = mv("content");
if ($filename != null && $content != null){
	$file = fopen($filename,"w");
	fwrite($file,$content);
	fclose($file);
	echo "DONE";
	return true;
	exit();
}else{
	echo 'ERROR';
	return true;
	exit();
} 

?>