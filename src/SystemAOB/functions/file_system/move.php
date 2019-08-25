<?php
include '../../../auth.php';
?>
<?php
//Require variable: from (Full path), to (Full path)
function mv($var){
	if (isset($_GET[$var]) !== false && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return null;
	}
}

$from = mv("from");
$to = mv("to");
if ($from != null && $to != null){
	if (file_exists($to)){
		die("ERROR. Target directory already eixsts.");
	}
	if (file_exists($from)){
		rename($from, $to);
		echo "DONE";
		return true;
		exit();
	}else{
	echo 'ERROR';
	return true;
	exit();
}
	
}



?>