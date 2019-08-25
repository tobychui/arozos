<?php
include '../../../auth.php';
?>
<?php
$file = $_GET['filename'];
if ($file != null || $file != ""){
	$isfile = false;
	if (pathinfo($file, PATHINFO_EXTENSION) != null){
		$isfile = true;
	}
	//Update: added checking for non-um encoded filename
	$ext = pathinfo($file, PATHINFO_EXTENSION);
	$filename = str_replace("inith","",basename($file,"." . $ext));
	if (ctype_xdigit($filename) && strlen($filename) % 2 == 0){
		if ($isfile){
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
			$filename = hex2bin($filename);
			header('Content-Type: application/json');
			echo json_encode($filename . "." . $ext);
		}else{
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
			$filename = hex2bin($filename);
			header('Content-Type: application/json');
			echo json_encode($filename);
		}
		
	}else{
		//If it is not um-encoded, just echo out its original filename
		echo $file;
	}
	
	
}

?>